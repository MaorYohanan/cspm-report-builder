"""Regression tests for build_bulk_filter in backend/routes/wiz.py.

Locks down the per-query-type filter shape returned to the Wiz GraphQL API.
The Wiz schema is unforgiving — a misnamed field or wrong wrapping silently
returns zero results. Run after any change to backend/routes/wiz.py:

    python -m pytest tests/test_bulk_filter.py -v
"""
from __future__ import annotations

import pytest

from backend.routes.wiz import build_bulk_filter


SUB_IDS = ["uuid-1", "uuid-2"]
SUB_EXT_IDS = ["ext-1", "ext-2"]


# (query_type, expected_filter_dict)
CASES = [
    (
        "issues",
        {
            "severity": ["CRITICAL", "HIGH"],
            "status": ["OPEN", "IN_PROGRESS"],
            "cloudAccountOrCloudOrganizationId": SUB_IDS,
        },
    ),
    (
        "configurationFindings",
        {
            "severity": ["CRITICAL", "HIGH"],
            "result": ["FAIL"],  # the only query type using "result" instead of "status"
            "resource": {"subscriptionId": SUB_IDS},
        },
    ),
    (
        "vulnerabilityFindings",
        {
            "severity": ["CRITICAL", "HIGH"],
            "status": ["OPEN", "IN_PROGRESS"],
            "subscriptionExternalId": SUB_EXT_IDS,
        },
    ),
    (
        "hostConfigurationRuleAssessments",
        {
            "severity": ["CRITICAL", "HIGH"],
            "status": ["OPEN", "IN_PROGRESS"],
            "resource": {"subscriptionId": SUB_IDS},
        },
    ),
    (
        "dataFindingsV2",
        {
            "severity": {"equals": ["CRITICAL", "HIGH"]},
            "status": {"equals": ["OPEN", "IN_PROGRESS"]},
            "graphEntityCloudAccount": {"equals": SUB_EXT_IDS},
        },
    ),
    (
        "secretInstances",
        {
            "severity": {"equals": ["CRITICAL", "HIGH"]},
            "status": {"equals": ["OPEN", "IN_PROGRESS"]},
            "cloudAccount": {"equals": SUB_EXT_IDS},
        },
    ),
    (
        "excessiveAccessFindings",
        # Custom filter schema — NO severity/status keys, uses sub_ids (not ext_ids)
        {"scope": {"id": {"equals": SUB_IDS}}},
    ),
    (
        "networkExposures",
        # Custom filter schema — NO severity/status keys, plain cloudAccount list
        {"cloudAccount": SUB_EXT_IDS},
    ),
    (
        "inventoryFindings",
        {
            "severity": {"equals": ["CRITICAL", "HIGH"]},
            "status": {"equals": ["OPEN", "IN_PROGRESS"]},
            "resource": {"subscriptionId": {"equals": SUB_IDS}},
        },
    ),
    (
        # endOfLifeFindings shares inventoryFindings' filter shape — it MUST
        # carry the severity/status keys so the bulk import respects the
        # "CRITICAL+HIGH only" contract documented at build_bulk_filter line 496.
        # Previously it was lumped with networkExposures/excessiveAccessFindings
        # under a `pass` branch and silently fetched every severity.
        "endOfLifeFindings",
        {
            "severity": {"equals": ["CRITICAL", "HIGH"]},
            "status": {"equals": ["OPEN", "IN_PROGRESS"]},
            "resource": {"subscriptionId": {"equals": SUB_IDS}},
        },
    ),
    (
        "softwareSupplyChainFindings",
        {
            "severity": {"equals": ["CRITICAL", "HIGH"]},
            "status": {"equals": ["OPEN", "IN_PROGRESS"]},
            "resource": {"subscriptionId": {"equals": SUB_IDS}},
        },
    ),
]


@pytest.mark.parametrize("query_type,expected", CASES, ids=[c[0] for c in CASES])
def test_build_bulk_filter_per_query_type(query_type, expected):
    """Verify build_bulk_filter returns the exact filter shape for each query type."""
    actual = build_bulk_filter(query_type, SUB_IDS, SUB_EXT_IDS)
    assert actual == expected


def test_excessive_access_has_no_severity_or_status_keys():
    """excessiveAccessFindings uses a custom Wiz filter type that rejects severity/status."""
    actual = build_bulk_filter("excessiveAccessFindings", SUB_IDS, SUB_EXT_IDS)
    assert "severity" not in actual
    assert "status" not in actual


# NOTE: endOfLifeFindings and softwareSupplyChainFindings are not tested
# explicitly — they follow the same shape as inventoryFindings. Add cases
# above if either diverges.
