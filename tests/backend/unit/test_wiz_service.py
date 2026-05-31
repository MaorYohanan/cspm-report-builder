"""
Unit tests for WizService.

Tests the WizService class methods including subscription resolution,
issue fetching, and paginated findings retrieval.
"""

import json
import time
from typing import Any, Dict
from unittest.mock import MagicMock, Mock

import pytest

# Import WizService using importlib to avoid triggering __init__.py
import importlib.util
import os
import sys

# Add project root to path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, project_root)

# Load wiz_service module directly without triggering package __init__
spec = importlib.util.spec_from_file_location(
    "wiz_service",
    os.path.join(project_root, "backend", "services", "wiz_service.py")
)
wiz_service_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wiz_service_module)
WizService = wiz_service_module.WizService
from tests.backend.fixtures.wiz_responses import (
    CLOUD_ACCOUNTS_EXACT_MATCH,
    CLOUD_ACCOUNTS_NO_MATCH,
    CLOUD_ACCOUNTS_PARTIAL_MATCH,
    CONFIG_FINDINGS_PAGE_1,
    CONFIG_FINDINGS_PAGE_2,
    GRAPHQL_ERROR_RESPONSE,
    ISSUES_SINGLE_PAGE,
    ISSUES_WITH_FILTERS,
    OAUTH_TOKEN_RESPONSE,
)


@pytest.fixture
def wiz_service():
    """Create a WizService instance for testing."""
    return WizService(
        client_id="test_client_id",
        client_secret="test_client_secret",
        api_url="https://api.test.wiz.io/graphql",
        auth_url="https://auth.test.wiz.io/oauth/token"
    )


@pytest.fixture
def mock_urlopen(monkeypatch):
    """Mock urllib.request.urlopen for HTTP requests."""
    from unittest.mock import MagicMock
    mock = MagicMock()
    monkeypatch.setattr("urllib.request.urlopen", mock)
    return mock


@pytest.fixture
def mock_time(monkeypatch):
    """Mock time.time() for token expiration tests."""
    from unittest.mock import MagicMock
    mock = MagicMock(return_value=1000.0)
    monkeypatch.setattr("time.time", mock)
    return mock


def create_mock_response(data: Dict[str, Any]) -> Mock:
    """
    Create a mock HTTP response object.

    Args:
        data: Dictionary to return as JSON response

    Returns:
        Mock response object with read() method
    """
    mock_response = Mock()
    mock_response.read.return_value = json.dumps(data).encode("utf-8")
    mock_response.__enter__ = Mock(return_value=mock_response)
    mock_response.__exit__ = Mock(return_value=False)
    return mock_response


class TestResolveSubscription:
    """Tests for resolve_subscription method."""

    def test_resolve_subscription_exact_match(self, wiz_service, mock_urlopen, mock_time):
        """Test subscription resolution with exact match."""
        # Setup mocks
        token_response = create_mock_response(OAUTH_TOKEN_RESPONSE)
        graphql_response = create_mock_response(CLOUD_ACCOUNTS_EXACT_MATCH)
        mock_urlopen.side_effect = [token_response, graphql_response]

        # Execute
        result = wiz_service.resolve_subscription("prod-subscription-1")

        # Verify
        assert result["ids"] == ["account-uuid-1"]
        assert result["externalIds"] == ["123456789012"]
        assert result["names"] == ["prod-subscription-1"]
        assert mock_urlopen.call_count == 2

    def test_resolve_subscription_partial_match(self, wiz_service, mock_urlopen, mock_time):
        """Test subscription resolution with partial match fallback."""
        # Setup mocks - first call returns no exact match, second call returns partial match
        token_response = create_mock_response(OAUTH_TOKEN_RESPONSE)
        no_match_response = create_mock_response(CLOUD_ACCOUNTS_NO_MATCH)
        partial_match_response = create_mock_response(CLOUD_ACCOUNTS_PARTIAL_MATCH)
        mock_urlopen.side_effect = [token_response, no_match_response, partial_match_response]

        # Execute - search for "prod-subscription" which should trigger partial matching
        result = wiz_service.resolve_subscription("aws-prod-subscription")

        # Verify - should find both accounts that match the partial search
        assert len(result["ids"]) == 2
        assert "account-uuid-2" in result["ids"]
        assert "account-uuid-3" in result["ids"]
        assert len(result["externalIds"]) == 2
        assert "234567890123" in result["externalIds"]
        assert "345678901234" in result["externalIds"]
        assert len(result["names"]) == 2

    def test_resolve_subscription_not_found(self, wiz_service, mock_urlopen, mock_time):
        """Test subscription resolution when no match is found."""
        # Setup mocks - both exact and partial searches return no matches
        token_response = create_mock_response(OAUTH_TOKEN_RESPONSE)
        no_match_response_1 = create_mock_response(CLOUD_ACCOUNTS_NO_MATCH)
        no_match_response_2 = create_mock_response(CLOUD_ACCOUNTS_NO_MATCH)
        mock_urlopen.side_effect = [token_response, no_match_response_1, no_match_response_2]

        # Execute
        result = wiz_service.resolve_subscription("nonexistent-subscription")

        # Verify - should return empty lists
        assert result["ids"] == []
        assert result["externalIds"] == []
        assert result["names"] == []


class TestFetchIssues:
    """Tests for fetch_issues method."""

    def test_fetch_issues_with_filters(self, wiz_service, mock_urlopen, mock_time):
        """Test fetching issues with severity and status filters."""
        # Setup mocks
        token_response = create_mock_response(OAUTH_TOKEN_RESPONSE)
        issues_response = create_mock_response(ISSUES_WITH_FILTERS)
        mock_urlopen.side_effect = [token_response, issues_response]

        # Execute
        filters = {
            "severity": ["CRITICAL"],
            "status": ["OPEN"]
        }
        result = wiz_service.fetch_issues(filters=filters, first=100)

        # Verify
        assert result["totalCount"] == 1
        assert len(result["nodes"]) == 1
        assert result["nodes"][0]["severity"] == "CRITICAL"
        assert result["nodes"][0]["status"] == "OPEN"
        assert result["pageInfo"]["hasNextPage"] is False

    def test_fetch_issues_pagination_params(self, wiz_service, mock_urlopen, mock_time):
        """Test that pagination parameters are passed correctly."""
        # Setup mocks
        token_response = create_mock_response(OAUTH_TOKEN_RESPONSE)
        issues_response = create_mock_response(ISSUES_SINGLE_PAGE)
        mock_urlopen.side_effect = [token_response, issues_response]

        # Execute with pagination cursor
        result = wiz_service.fetch_issues(first=50, after="cursor-start")

        # Verify
        assert result["totalCount"] == 2
        assert len(result["nodes"]) == 2
        assert result["pageInfo"]["endCursor"] == "cursor-end"

    def test_fetch_issues_no_filters(self, wiz_service, mock_urlopen, mock_time):
        """Test fetching issues without any filters."""
        # Setup mocks
        token_response = create_mock_response(OAUTH_TOKEN_RESPONSE)
        issues_response = create_mock_response(ISSUES_SINGLE_PAGE)
        mock_urlopen.side_effect = [token_response, issues_response]

        # Execute
        result = wiz_service.fetch_issues()

        # Verify
        assert result["totalCount"] == 2
        assert len(result["nodes"]) == 2


class TestFetchAllFindingsPaginated:
    """Tests for fetch_all_findings_paginated method."""

    def test_fetch_all_findings_paginated(self, wiz_service, mock_urlopen, mock_time):
        """Test that fetch_all_findings_paginated actually paginates through results."""
        # Setup mocks - token + page 1 + page 2
        token_response = create_mock_response(OAUTH_TOKEN_RESPONSE)
        page_1_response = create_mock_response(CONFIG_FINDINGS_PAGE_1)
        page_2_response = create_mock_response(CONFIG_FINDINGS_PAGE_2)
        mock_urlopen.side_effect = [token_response, page_1_response, page_2_response]

        # Execute
        result = wiz_service.fetch_all_findings_paginated(
            query_type="configurationFindings",
            filters={"severity": ["HIGH"]},
            page_size=500
        )

        # Verify
        # Should have fetched 500 items from page 1 + 250 items from page 2 = 750 total
        assert len(result) == 750
        assert result[0]["id"] == "finding-1"
        assert result[499]["id"] == "finding-500"
        assert result[500]["id"] == "finding-501"
        assert result[749]["id"] == "finding-750"

        # Verify that urlopen was called 3 times: token + page1 + page2
        assert mock_urlopen.call_count == 3

    def test_fetch_all_findings_single_page(self, wiz_service, mock_urlopen, mock_time):
        """Test fetch_all_findings_paginated with results that fit in one page."""
        # Setup mocks - modify page 1 to have hasNextPage=False
        token_response = create_mock_response(OAUTH_TOKEN_RESPONSE)
        single_page_data = CONFIG_FINDINGS_PAGE_1.copy()
        single_page_data["data"]["configurationFindings"]["pageInfo"]["hasNextPage"] = False
        single_page_data["data"]["configurationFindings"]["totalCount"] = 500
        single_page_response = create_mock_response(single_page_data)
        mock_urlopen.side_effect = [token_response, single_page_response]

        # Execute
        result = wiz_service.fetch_all_findings_paginated(
            query_type="configurationFindings",
            page_size=500
        )

        # Verify
        assert len(result) == 500
        # Should only call urlopen twice: token + single page
        assert mock_urlopen.call_count == 2

    def test_fetch_all_findings_invalid_query_type(self, wiz_service):
        """Test that invalid query type raises ValueError."""
        with pytest.raises(ValueError, match="Unknown query type"):
            wiz_service.fetch_all_findings_paginated(
                query_type="invalidQueryType"
            )

    def test_fetch_all_findings_graphql_error(self, wiz_service, mock_urlopen, mock_time):
        """Test that GraphQL errors are raised as RuntimeError."""
        # Setup mocks
        token_response = create_mock_response(OAUTH_TOKEN_RESPONSE)
        error_response = create_mock_response(GRAPHQL_ERROR_RESPONSE)
        mock_urlopen.side_effect = [token_response, error_response]

        # Execute and verify error is raised
        with pytest.raises(RuntimeError, match="GraphQL error: Authentication failed"):
            wiz_service.fetch_all_findings_paginated(
                query_type="configurationFindings"
            )


class TestTokenManagement:
    """Tests for OAuth token management."""

    def test_token_cached_when_not_expired(self, wiz_service, mock_urlopen, mock_time):
        """Test that token is cached and reused when not expired."""
        # Setup mocks
        token_response = create_mock_response(OAUTH_TOKEN_RESPONSE)
        issues_response = create_mock_response(ISSUES_SINGLE_PAGE)
        mock_urlopen.side_effect = [token_response, issues_response, issues_response]

        # First call - should fetch token
        wiz_service.fetch_issues()
        assert mock_urlopen.call_count == 2  # token + issues

        # Second call - should reuse token (time hasn't changed)
        wiz_service.fetch_issues()
        assert mock_urlopen.call_count == 3  # only issues call, no new token

    def test_token_refreshed_when_expired(self, wiz_service, mock_urlopen, monkeypatch):
        """Test that token is refreshed when expired."""
        # Mock time to progress
        from unittest.mock import MagicMock
        mock_time = MagicMock()
        mock_time.side_effect = [1000.0, 5000.0]  # Second call is after expiry
        monkeypatch.setattr("time.time", mock_time)

        # Setup mocks
        token_response_1 = create_mock_response(OAUTH_TOKEN_RESPONSE)
        issues_response_1 = create_mock_response(ISSUES_SINGLE_PAGE)
        token_response_2 = create_mock_response(OAUTH_TOKEN_RESPONSE)
        issues_response_2 = create_mock_response(ISSUES_SINGLE_PAGE)
        mock_urlopen.side_effect = [
            token_response_1,
            issues_response_1,
            token_response_2,
            issues_response_2
        ]

        # First call
        wiz_service.fetch_issues()
        assert mock_urlopen.call_count == 2

        # Second call - token should be expired and re-fetched
        wiz_service.fetch_issues()
        assert mock_urlopen.call_count == 4  # new token + issues
