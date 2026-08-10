"""Unit tests for WizService.resolve_subscription (DEV-CRIT-4).

Tests:
  - Happy-path UUID lookup returns ids/externalIds/names from the API node.
  - When _graphql raises during the id-based UUID lookup, the exception is
    swallowed (logged), nodes falls back to [], and the function returns the
    UUID directly as an externalId (the "use UUID as externalId" fallback).
  - Non-UUID subscription names that match nothing raise nothing from
    resolve_subscription; they return empty ids/externalIds and the caller
    decides what to do.

No Wiz credentials or network access required.

Run with:
    python -m pytest tests/test_wiz_service.py -v
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from backend.services.wiz_service import WizService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_service():
    """Return a WizService instance with dummy credentials."""
    return WizService(
        client_id="dummy-id",
        client_secret="dummy-secret",
        api_url="https://api.example.com/graphql",
        auth_url="https://auth.example.com/oauth/token",
    )


def _cloud_account_response(nodes):
    """Wrap nodes in the shape returned by the Wiz GraphQL cloudAccounts query."""
    return {
        "data": {
            "cloudAccounts": {
                "nodes": nodes,
                "pageInfo": {"hasNextPage": False, "endCursor": None},
            }
        }
    }


# ---------------------------------------------------------------------------
# resolve_subscription — happy-path UUID lookup
# ---------------------------------------------------------------------------


class TestResolveSubscriptionUuidHappyPath:
    """When the API finds the account by UUID id-filter, return its ids/externalIds/names."""

    def test_uuid_lookup_returns_account_fields(self):
        svc = _make_service()
        uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

        empty_response = _cloud_account_response([])
        uuid_response = _cloud_account_response([
            {"id": "wiz-internal-id", "externalId": uuid, "name": "My Azure Subscription"}
        ])

        # The UUID has hyphen segments that qualify as "significant" (len >= 4, not in
        # the exclusion list), so step 2 (partial token search) makes several calls
        # before step 3 (id-based UUID lookup) is reached.  We use a side_effect
        # function instead of a list so that all the intermediate empty responses are
        # handled automatically and only the final id-based call returns the match.
        def graphql_side_effect(query, variables=None):
            fby = (variables or {}).get("filterBy", {})
            if fby.get("id") == [uuid]:
                return uuid_response
            return empty_response

        with patch.object(svc, "_graphql", side_effect=graphql_side_effect):
            result = svc.resolve_subscription(uuid)

        assert result["ids"] == ["wiz-internal-id"]
        assert result["externalIds"] == [uuid]
        assert result["names"] == ["My Azure Subscription"]

    def test_uuid_lookup_called_with_id_filter(self):
        svc = _make_service()
        uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

        empty_response = _cloud_account_response([])
        uuid_response = _cloud_account_response([
            {"id": "wiz-id", "externalId": uuid, "name": "Sub"}
        ])

        captured_calls = []

        def graphql_side_effect(query, variables=None):
            captured_calls.append(variables or {})
            fby = (variables or {}).get("filterBy", {})
            if fby.get("id") == [uuid]:
                return uuid_response
            return empty_response

        with patch.object(svc, "_graphql", side_effect=graphql_side_effect):
            svc.resolve_subscription(uuid)

        # At least one call must use the id-based filter
        id_filter_calls = [v for v in captured_calls if v.get("filterBy", {}).get("id") == [uuid]]
        assert id_filter_calls, "Expected a call with filterBy.id = [uuid]"
        assert id_filter_calls[0] == {"first": 1, "filterBy": {"id": [uuid]}}


# ---------------------------------------------------------------------------
# resolve_subscription — UUID fallback when id-based lookup raises
# ---------------------------------------------------------------------------


class TestResolveSubscriptionUuidFallbackOnException:
    """DEV-CRIT-4: if _graphql raises during the UUID id-based lookup,
    the exception must be logged (not silenced without trace) and the function
    must return the UUID as an externalId rather than propagating the error."""

    def test_exception_during_uuid_lookup_returns_external_id_fallback(self):
        svc = _make_service()
        uuid = "deadbeef-dead-beef-dead-beefdeadbeef"

        empty_response = _cloud_account_response([])

        def graphql_side_effect(query, variables=None):
            fby = (variables or {}).get("filterBy", {})
            # id-based lookup: raise to simulate unsupported filter
            if fby.get("id") == [uuid]:
                raise ConnectionError("tenant does not support id filter")
            # All other calls (text search, partial token search): return empty
            return empty_response

        with patch.object(svc, "_graphql", side_effect=graphql_side_effect):
            result = svc.resolve_subscription(uuid)

        assert result["ids"] == []
        assert result["externalIds"] == [uuid]
        assert result["names"] == []

    def test_exception_during_uuid_lookup_does_not_propagate(self):
        """The caller must not receive an exception — only the fallback dict."""
        svc = _make_service()
        uuid = "cafebabe-cafe-babe-cafe-babecafebabe"

        empty_response = _cloud_account_response([])

        def graphql_side_effect(query, variables=None):
            fby = (variables or {}).get("filterBy", {})
            if fby.get("id") == [uuid]:
                raise RuntimeError("Wiz 400: filterBy.id unsupported")
            return empty_response

        with patch.object(svc, "_graphql", side_effect=graphql_side_effect):
            # Must not raise
            result = svc.resolve_subscription(uuid)

        assert "externalIds" in result
        assert uuid in result["externalIds"]

    def test_exception_is_logged_as_warning(self, caplog):
        """After DEV-CRIT-4, the exception must appear in the log (not silently dropped)."""
        import logging

        svc = _make_service()
        uuid = "11111111-2222-3333-4444-555555555555"

        empty_response = _cloud_account_response([])

        def graphql_side_effect(query, variables=None):
            fby = (variables or {}).get("filterBy", {})
            if fby.get("id") == [uuid]:
                raise ValueError("simulated filter rejection")
            return empty_response

        with patch.object(svc, "_graphql", side_effect=graphql_side_effect):
            with caplog.at_level(logging.WARNING, logger="backend.services.wiz_service"):
                svc.resolve_subscription(uuid)

        # The warning message must mention the subscription name
        assert any(uuid in r.message for r in caplog.records), (
            f"Expected a log record mentioning {uuid!r}; got: {[r.message for r in caplog.records]}"
        )


# ---------------------------------------------------------------------------
# resolve_subscription — non-UUID name that finds nothing
# ---------------------------------------------------------------------------


class TestResolveSubscriptionNonUuidNotFound:
    def test_non_uuid_name_with_no_results_returns_empty(self):
        """A plain name that matches nothing returns empty ids (no exception)."""
        svc = _make_service()

        empty_response = _cloud_account_response([])

        with patch.object(svc, "_graphql", return_value=empty_response):
            result = svc.resolve_subscription("NonExistentSubscription")

        assert result["ids"] == []
        assert result["externalIds"] == []


# ---------------------------------------------------------------------------
# resolve_subscription — successful text search (step 1)
# ---------------------------------------------------------------------------


class TestResolveSubscriptionTextSearchSuccess:
    def test_text_search_result_returned_directly(self):
        svc = _make_service()

        node = {"id": "wiz-id-1", "externalId": "ext-1", "name": "My Production Account"}
        response = _cloud_account_response([node])

        with patch.object(svc, "_graphql", return_value=response):
            result = svc.resolve_subscription("My Production Account")

        assert result["ids"] == ["wiz-id-1"]
        assert result["externalIds"] == ["ext-1"]
        assert result["names"] == ["My Production Account"]
