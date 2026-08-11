"""Regression tests for build_bulk_filter in backend/services/wiz_service.py.

Locks down the per-query-type filter shape returned to the Wiz GraphQL API.
The Wiz schema is unforgiving — a misnamed field or wrong wrapping silently
returns zero results. Run after any change to backend/services/wiz_service.py:

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
        # endOfLifeFindings maps to the Wiz 'vulnerabilityFindings' GraphQL query.
        # The filter type is VulnerabilityFindingFilters — uses plain-list severity/status
        # and subscriptionExternalId (NOT resource.subscriptionId which belongs to
        # inventory-type filters). isEndOfLife=True narrows to EOL findings only.
        # Severity defaults to MEDIUM+HIGH+CRITICAL (Medium-and-above) because most
        # actionable EOL signals surface at MEDIUM; other query types default to
        # CRITICAL+HIGH only. Bulk import has no per-import severity override.
        "endOfLifeFindings",
        {
            "severity": ["MEDIUM", "HIGH", "CRITICAL"],
            "status": ["OPEN", "IN_PROGRESS"],
            "isEndOfLife": True,
            "subscriptionExternalId": SUB_EXT_IDS,
        },
    ),
    (
        # softwareSupplyChainFindings: Wiz's SoftwareSupplyChainFindingFilters type
        # does NOT support severity or status fields — sending them causes a Wiz API
        # 400 error. No subscription scope field either. Filter must be empty.
        "softwareSupplyChainFindings",
        {},
    ),
    (
        "malwareFindings",
        {
            "severity": {"equals": ["CRITICAL", "HIGH"]},
            "status": {"equals": ["OPEN", "IN_PROGRESS"]},
            "cloudAccount": {"id": {"equals": SUB_IDS}},
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


def test_ssc_has_no_severity_or_status_keys():
    """softwareSupplyChainFindings uses a Wiz filter type that rejects severity/status."""
    actual = build_bulk_filter("softwareSupplyChainFindings", SUB_IDS, SUB_EXT_IDS)
    assert "severity" not in actual
    assert "status" not in actual


# NOTE: endOfLifeFindings uses VulnerabilityFindingFilters (plain-list severity/status,
# isEndOfLife=True, subscriptionExternalId). softwareSupplyChainFindings uses its own
# filter type with no subscription scope field.
