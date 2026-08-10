"""Unit tests for _transform_finding() in backend/routes/pipeline.py.

_transform_finding() takes a raw Wiz API node dict (with a "queryType" key
injected by the pipeline fetcher) and returns an enriched finding dict in the
format expected by the report editor.

No Flask app context is needed — the function is pure (no DB / HTTP calls).

Run with:
    python -m pytest tests/test_transform_finding.py -v
"""
from __future__ import annotations

import pytest

from backend.routes.pipeline import _transform_finding

# Required keys in every enriched finding
_REQUIRED_KEYS = {"id", "category", "title", "severity", "description",
                  "impact", "technical", "policies", "recs", "priority",
                  "owner", "evidence", "exception"}


def _tf(node: dict) -> dict:
    """Convenience wrapper: always pass a fresh cat_counters dict."""
    return _transform_finding(node, {})


# ---------------------------------------------------------------------------
# issues
# ---------------------------------------------------------------------------

class TestTransformIssues:
    def test_has_required_keys(self):
        node = {"queryType": "issues", "severity": "HIGH", "id": "issue-1"}
        result = _tf(node)
        assert _REQUIRED_KEYS <= set(result.keys())

    def test_severity_mapped_to_lowercase(self):
        node = {"queryType": "issues", "severity": "CRITICAL"}
        assert _tf(node)["severity"] == "critical"

    def test_title_falls_back_to_description(self):
        node = {"queryType": "issues", "description": "Exposed S3 bucket", "severity": "HIGH"}
        assert _tf(node)["title"] == "Exposed S3 bucket"

    def test_category_id_prefixed_correctly(self):
        node = {"queryType": "issues", "severity": "HIGH",
                "entitySnapshot": {"type": "iam", "nativeType": ""}}
        result = _tf(node)
        assert result["id"].startswith("EAPM-")

    def test_recs_is_non_empty_list(self):
        node = {"queryType": "issues", "severity": "MEDIUM"}
        result = _tf(node)
        assert isinstance(result["recs"], list)
        assert len(result["recs"]) > 0

    def test_exception_default_inactive(self):
        node = {"queryType": "issues", "severity": "LOW"}
        assert _tf(node)["exception"] == {"active": False, "reason": ""}


# ---------------------------------------------------------------------------
# configurationFindings
# ---------------------------------------------------------------------------

class TestTransformConfigurationFindings:
    def test_category_is_cspm(self):
        node = {"queryType": "configurationFindings", "severity": "HIGH"}
        assert _tf(node)["category"] == "CSPM"

    def test_title_from_rule_name(self):
        node = {
            "queryType": "configurationFindings",
            "severity": "HIGH",
            "rule": {"name": "S3 bucket public access"},
        }
        assert _tf(node)["title"] == "S3 bucket public access"

    def test_id_starts_with_cspm(self):
        node = {"queryType": "configurationFindings", "severity": "HIGH"}
        assert _tf(node)["id"].startswith("CSPM-")

    def test_technical_includes_result_field(self):
        node = {
            "queryType": "configurationFindings",
            "severity": "HIGH",
            "result": "FAIL",
        }
        technical = _tf(node)["technical"]
        assert any("Result: FAIL" in t for t in technical)


# ---------------------------------------------------------------------------
# vulnerabilityFindings
# ---------------------------------------------------------------------------

class TestTransformVulnerabilityFindings:
    def test_category_is_vuln(self):
        node = {"queryType": "vulnerabilityFindings", "severity": "HIGH"}
        assert _tf(node)["category"] == "VULN"

    def test_id_starts_with_vuln(self):
        node = {"queryType": "vulnerabilityFindings", "severity": "CRITICAL"}
        assert _tf(node)["id"].startswith("VULN-")

    def test_cvss_score_in_impact(self):
        node = {"queryType": "vulnerabilityFindings", "severity": "CRITICAL", "score": 9.8}
        assert "9.8" in _tf(node)["impact"]

    def test_recs_include_fixed_version(self):
        node = {
            "queryType": "vulnerabilityFindings",
            "severity": "HIGH",
            "fixedVersion": "2.0.1",
        }
        recs = _tf(node)["recs"]
        assert any("2.0.1" in r for r in recs)


# ---------------------------------------------------------------------------
# hostConfigurationRuleAssessments
# ---------------------------------------------------------------------------

class TestTransformHostConfig:
    def test_category_is_hspm(self):
        node = {"queryType": "hostConfigurationRuleAssessments", "severity": "HIGH"}
        assert _tf(node)["category"] == "HSPM"

    def test_id_starts_with_hspm(self):
        node = {"queryType": "hostConfigurationRuleAssessments", "severity": "HIGH"}
        assert _tf(node)["id"].startswith("HSPM-")

    def test_title_from_rule(self):
        node = {
            "queryType": "hostConfigurationRuleAssessments",
            "severity": "MEDIUM",
            "rule": {"name": "CIS Benchmark Check"},
        }
        assert _tf(node)["title"] == "CIS Benchmark Check"

    def test_file_path_in_technical_when_present(self):
        node = {
            "queryType": "hostConfigurationRuleAssessments",
            "severity": "HIGH",
            "filePath": "/etc/passwd",
        }
        technical = _tf(node)["technical"]
        assert any("/etc/passwd" in t for t in technical)


# ---------------------------------------------------------------------------
# malwareFindings
# ---------------------------------------------------------------------------

class TestTransformMalwareFindings:
    def test_category_is_hspm(self):
        node = {"queryType": "malwareFindings", "severity": "CRITICAL"}
        assert _tf(node)["category"] == "HSPM"

    def test_id_starts_with_hspm(self):
        node = {"queryType": "malwareFindings", "severity": "CRITICAL"}
        assert _tf(node)["id"].startswith("HSPM-")

    def test_recs_contains_isolation_instruction(self):
        node = {"queryType": "malwareFindings", "severity": "HIGH"}
        recs = _tf(node)["recs"]
        # The first recommendation should mention isolation
        assert any("בידוד" in r or "isolat" in r.lower() for r in recs)

    def test_file_path_in_technical_when_present(self):
        node = {
            "queryType": "malwareFindings",
            "severity": "CRITICAL",
            "fileDetails": {"path": "/tmp/evil.sh"},
        }
        technical = _tf(node)["technical"]
        assert any("/tmp/evil.sh" in t for t in technical)

    def test_classification_in_technical(self):
        node = {
            "queryType": "malwareFindings",
            "severity": "HIGH",
            "classification": {"familyName": "Mirai", "type": "Trojan", "platform": "Linux"},
        }
        technical = _tf(node)["technical"]
        assert any("Mirai" in t for t in technical)

    def test_sha256_in_technical(self):
        node = {
            "queryType": "malwareFindings",
            "severity": "HIGH",
            "sha256": "abc123",
        }
        technical = _tf(node)["technical"]
        assert any("abc123" in t for t in technical)

    def test_title_falls_back_to_id(self):
        node = {"queryType": "malwareFindings", "severity": "HIGH", "id": "mf-42"}
        result = _tf(node)
        assert "mf-42" in result["title"]

    def test_exception_default_inactive(self):
        node = {"queryType": "malwareFindings", "severity": "MEDIUM"}
        assert _tf(node)["exception"] == {"active": False, "reason": ""}


# ---------------------------------------------------------------------------
# Counter increments per category across multiple calls
# ---------------------------------------------------------------------------

class TestCategoryCounters:
    def test_counters_increment_per_category(self):
        counters: dict = {}
        r1 = _transform_finding({"queryType": "malwareFindings", "severity": "HIGH"}, counters)
        r2 = _transform_finding({"queryType": "malwareFindings", "severity": "HIGH"}, counters)
        assert r1["id"] == "HSPM-001"
        assert r2["id"] == "HSPM-002"

    def test_different_categories_have_independent_counters(self):
        counters: dict = {}
        r1 = _transform_finding({"queryType": "malwareFindings", "severity": "HIGH"}, counters)
        r2 = _transform_finding(
            {"queryType": "configurationFindings", "severity": "HIGH"}, counters
        )
        assert r1["id"] == "HSPM-001"
        assert r2["id"] == "CSPM-001"
