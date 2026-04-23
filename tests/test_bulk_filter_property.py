"""
Property 1: Filter construction produces correct filter object per query type.

Feature: subscription-bulk-import, Property 1: Filter construction produces correct filter object per query type

Validates: Requirements 2.2, 2.3, 2.6
"""
import sys
import os
import uuid

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# Add project root to path so we can import app helpers
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import build_bulk_filter

# --- Constants ---

ALL_QUERY_TYPES = [
    "issues",
    "configurationFindings",
    "vulnerabilityFindings",
    "hostConfigurationRuleAssessments",
    "dataFindingsV2",
    "secretInstances",
    "excessiveAccessFindings",
    "networkExposures",
    "inventoryFindings",
]

# Severity: plain list
PLAIN_SEVERITY_TYPES = {
    "issues",
    "configurationFindings",
    "vulnerabilityFindings",
    "hostConfigurationRuleAssessments",
}

# Severity: {equals: [...]}
EQUALS_SEVERITY_TYPES = {
    "dataFindingsV2",
    "secretInstances",
    "excessiveAccessFindings",
    "inventoryFindings",
}

# No severity filter
NO_SEVERITY_TYPES = {"networkExposures"}

# Status: result=["FAIL"]
FAIL_STATUS_TYPES = {"configurationFindings"}

# Status: plain list ["OPEN", "IN_PROGRESS"]
PLAIN_STATUS_TYPES = {
    "issues",
    "vulnerabilityFindings",
    "hostConfigurationRuleAssessments",
}

# Status: {equals: ["OPEN", "IN_PROGRESS"]}
EQUALS_STATUS_TYPES = {
    "dataFindingsV2",
    "secretInstances",
    "excessiveAccessFindings",
    "inventoryFindings",
}

# No status filter
NO_STATUS_TYPES = {"networkExposures"}

# Subscription filter: UUID-based
UUID_SUB_TYPES = {
    "issues",
    "configurationFindings",
    "hostConfigurationRuleAssessments",
    "inventoryFindings",
}

# Subscription filter: externalId-based
EXTID_SUB_TYPES = {
    "vulnerabilityFindings",
    "dataFindingsV2",
    "secretInstances",
    "networkExposures",
}

# No subscription filter
NO_SUB_TYPES = {"excessiveAccessFindings"}

# Expected subscription filter key per query type (when IDs are present)
UUID_SUB_FIELD = {
    "issues": "cloudAccountOrCloudOrganizationId",
    "configurationFindings": "resource",
    "hostConfigurationRuleAssessments": "resource",
    "inventoryFindings": "resource",
}

EXTID_SUB_FIELD = {
    "vulnerabilityFindings": "subscriptionExternalId",
    "dataFindingsV2": "graphEntityCloudAccount",
    "secretInstances": "cloudAccount",
    "networkExposures": "cloudAccount",
}

# --- Strategies ---

query_type_st = st.sampled_from(ALL_QUERY_TYPES)
uuid_st = st.text(
    alphabet="0123456789abcdef-",
    min_size=36,
    max_size=36,
).map(lambda _: str(uuid.uuid4()))
uuid_list_st = st.lists(uuid_st, min_size=0, max_size=5)
ext_id_st = st.text(min_size=1, max_size=30, alphabet=st.characters(whitelist_categories=("L", "N", "Pd")))
ext_id_list_st = st.lists(ext_id_st, min_size=0, max_size=5)


# --- Property Tests ---


@given(query_type=query_type_st, sub_ids=uuid_list_st, sub_ext_ids=ext_id_list_st)
@settings(max_examples=200)
def test_severity_filter_correct_per_query_type(query_type, sub_ids, sub_ext_ids):
    """Severity is always CRITICAL/HIGH in the correct format per query type."""
    f = build_bulk_filter(query_type, sub_ids, sub_ext_ids)

    if query_type in PLAIN_SEVERITY_TYPES:
        assert "severity" in f, f"Expected plain severity for {query_type}"
        assert f["severity"] == ["CRITICAL", "HIGH"]
    elif query_type in EQUALS_SEVERITY_TYPES:
        assert "severity" in f, f"Expected equals-wrapped severity for {query_type}"
        assert f["severity"] == {"equals": ["CRITICAL", "HIGH"]}
    elif query_type in NO_SEVERITY_TYPES:
        assert "severity" not in f, f"Expected no severity for {query_type}"
    else:
        pytest.fail(f"Unhandled query type for severity: {query_type}")


@given(query_type=query_type_st, sub_ids=uuid_list_st, sub_ext_ids=ext_id_list_st)
@settings(max_examples=200)
def test_status_filter_correct_per_query_type(query_type, sub_ids, sub_ext_ids):
    """Status filter uses FAIL for configurationFindings, OPEN/IN_PROGRESS for others."""
    f = build_bulk_filter(query_type, sub_ids, sub_ext_ids)

    if query_type in FAIL_STATUS_TYPES:
        assert "result" in f, f"Expected result key for {query_type}"
        assert f["result"] == ["FAIL"]
        assert "status" not in f
    elif query_type in PLAIN_STATUS_TYPES:
        assert "status" in f, f"Expected plain status for {query_type}"
        assert f["status"] == ["OPEN", "IN_PROGRESS"]
        assert "result" not in f
    elif query_type in EQUALS_STATUS_TYPES:
        assert "status" in f, f"Expected equals-wrapped status for {query_type}"
        assert f["status"] == {"equals": ["OPEN", "IN_PROGRESS"]}
        assert "result" not in f
    elif query_type in NO_STATUS_TYPES:
        assert "status" not in f, f"Expected no status for {query_type}"
        assert "result" not in f
    else:
        pytest.fail(f"Unhandled query type for status: {query_type}")


@given(
    query_type=query_type_st,
    sub_ids=st.lists(uuid_st, min_size=1, max_size=5),
    sub_ext_ids=st.lists(ext_id_st, min_size=1, max_size=5),
)
@settings(max_examples=200)
def test_subscription_filter_correct_per_query_type(query_type, sub_ids, sub_ext_ids):
    """Subscription filter uses the correct field and ID type per query type.

    Uses non-empty ID lists so the subscription filter is always present
    (except for excessiveAccessFindings which never has one).
    """
    f = build_bulk_filter(query_type, sub_ids, sub_ext_ids)

    if query_type == "excessiveAccessFindings":
        # No subscription filter key should be present
        for key in (
            "cloudAccountOrCloudOrganizationId",
            "subscriptionExternalId",
            "graphEntityCloudAccount",
            "cloudAccount",
            "resource",
        ):
            assert key not in f, (
                f"excessiveAccessFindings should have no subscription filter, "
                f"but found key '{key}'"
            )
    elif query_type in UUID_SUB_TYPES:
        expected_key = UUID_SUB_FIELD[query_type]
        assert expected_key in f, (
            f"Expected subscription key '{expected_key}' for {query_type}"
        )
        # Verify the filter references UUIDs (sub_ids), not externalIds
        _assert_contains_ids(f, expected_key, sub_ids, query_type)
    elif query_type in EXTID_SUB_TYPES:
        expected_key = EXTID_SUB_FIELD[query_type]
        assert expected_key in f, (
            f"Expected subscription key '{expected_key}' for {query_type}"
        )
        _assert_contains_ids(f, expected_key, sub_ext_ids, query_type)
    else:
        pytest.fail(f"Unhandled query type for subscription: {query_type}")


def _assert_contains_ids(filter_dict, key, expected_ids, query_type):
    """Helper: verify the subscription filter value contains the expected IDs."""
    val = filter_dict[key]
    # The value can be a plain list, a dict with nested structure, or a dict with 'equals'
    if isinstance(val, list):
        assert val == expected_ids, (
            f"{query_type}: expected {expected_ids}, got {val}"
        )
    elif isinstance(val, dict):
        # Drill into the dict to find the ID list
        ids_found = _extract_ids_from_dict(val)
        assert ids_found == expected_ids, (
            f"{query_type}: expected {expected_ids} in nested dict, got {ids_found}"
        )
    else:
        pytest.fail(f"{query_type}: unexpected filter value type: {type(val)}")


def _extract_ids_from_dict(d):
    """Recursively extract the leaf list of IDs from a nested filter dict."""
    for v in d.values():
        if isinstance(v, list):
            return v
        elif isinstance(v, dict):
            return _extract_ids_from_dict(v)
    return None
