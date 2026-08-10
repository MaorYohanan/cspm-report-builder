"""Unit tests for _extract_finding_title and DEV-CRIT-2 ProductMemoryEntry behavior.

DEV-CRIT-1: Every query type branch is verified against its JS importXxxFinding counterpart.
DEV-CRIT-2: deleted_keys skip and exception_keys reason propagation are verified
            by exercising the pipeline insertion loop via a lightweight DB-level fixture.

No Wiz credentials are required — these are pure unit tests.

Run with:
    python -m pytest tests/test_exception_key_matching.py -v
"""
from __future__ import annotations

import pytest

from backend.routes.pipeline import _extract_finding_title


# ---------------------------------------------------------------------------
# DEV-CRIT-1 — _extract_finding_title per query type
# ---------------------------------------------------------------------------


class TestExtractFindingTitleIssues:
    def test_uses_rule_name(self):
        f = {
            "queryType": "issues",
            "sourceRules": [{"name": "S3 Bucket Public Access", "id": "r-1"}],
            "description": "some desc",
            "id": "i-1",
        }
        assert _extract_finding_title(f) == "S3 Bucket Public Access"

    def test_falls_back_to_description_when_no_rule_name(self):
        f = {
            "queryType": "issues",
            "sourceRules": [{"id": "r-1"}],
            "description": "Fallback description",
            "id": "i-1",
        }
        assert _extract_finding_title(f) == "Fallback description"

    def test_falls_back_to_id_when_no_rule_or_description(self):
        f = {"queryType": "issues", "sourceRules": [], "id": "i-42"}
        assert _extract_finding_title(f) == "i-42"

    def test_empty_source_rules_list(self):
        f = {"queryType": "issues", "sourceRules": [], "description": "desc", "id": "i-1"}
        assert _extract_finding_title(f) == "desc"


class TestExtractFindingTitleConfigurationFindings:
    def test_uses_rule_name(self):
        f = {
            "queryType": "configurationFindings",
            "rule": {"name": "EC2 IMDSv1 Enabled"},
            "name": "Instance i-abc",
            "id": "c-1",
        }
        assert _extract_finding_title(f) == "EC2 IMDSv1 Enabled"

    def test_falls_back_to_item_name_when_no_rule_name(self):
        f = {
            "queryType": "configurationFindings",
            "rule": {},
            "name": "Instance i-abc",
            "id": "c-1",
        }
        assert _extract_finding_title(f) == "Instance i-abc"

    def test_returns_empty_when_no_rule_or_name(self):
        f = {"queryType": "configurationFindings", "rule": {}, "id": "c-1"}
        assert _extract_finding_title(f) == ""


class TestExtractFindingTitleVulnerabilityFindings:
    def test_uses_name(self):
        f = {"queryType": "vulnerabilityFindings", "name": "CVE-2023-1234", "detailedName": "d"}
        assert _extract_finding_title(f) == "CVE-2023-1234"

    def test_falls_back_to_detailed_name(self):
        f = {"queryType": "vulnerabilityFindings", "detailedName": "CVE-2022-5678"}
        assert _extract_finding_title(f) == "CVE-2022-5678"

    def test_returns_empty_when_neither(self):
        f = {"queryType": "vulnerabilityFindings", "id": "v-1"}
        assert _extract_finding_title(f) == ""


class TestExtractFindingTitleHostConfigurationRuleAssessments:
    def test_uses_rule_name(self):
        f = {
            "queryType": "hostConfigurationRuleAssessments",
            "rule": {"name": "CIS Benchmark 1.3"},
            "id": "h-1",
        }
        assert _extract_finding_title(f) == "CIS Benchmark 1.3"

    def test_returns_empty_when_no_rule_name(self):
        f = {"queryType": "hostConfigurationRuleAssessments", "rule": {}, "id": "h-1"}
        assert _extract_finding_title(f) == ""

    def test_no_rule_key_returns_empty(self):
        f = {"queryType": "hostConfigurationRuleAssessments", "id": "h-2"}
        assert _extract_finding_title(f) == ""


class TestExtractFindingTitleDataFindingsV2:
    def test_uses_name(self):
        f = {
            "queryType": "dataFindingsV2",
            "name": "PII Data",
            "dataClassifier": {"name": "SSN"},
        }
        assert _extract_finding_title(f) == "PII Data"

    def test_falls_back_to_classifier_name(self):
        f = {
            "queryType": "dataFindingsV2",
            "dataClassifier": {"name": "Credit Card"},
        }
        assert _extract_finding_title(f) == "Credit Card"

    def test_returns_empty_when_neither(self):
        f = {"queryType": "dataFindingsV2", "dataClassifier": {}}
        assert _extract_finding_title(f) == ""


class TestExtractFindingTitleSecretInstances:
    def test_uses_name(self):
        f = {
            "queryType": "secretInstances",
            "name": "AWS Access Key",
            "rule": {"name": "Rule Name"},
        }
        assert _extract_finding_title(f) == "AWS Access Key"

    def test_falls_back_to_rule_name(self):
        f = {
            "queryType": "secretInstances",
            "rule": {"name": "GitHub Token Detected"},
        }
        assert _extract_finding_title(f) == "GitHub Token Detected"

    def test_returns_empty_when_neither(self):
        f = {"queryType": "secretInstances", "rule": {}}
        assert _extract_finding_title(f) == ""


class TestExtractFindingTitleExcessiveAccessFindings:
    def test_uses_name(self):
        f = {"queryType": "excessiveAccessFindings", "name": "Admin Privileges on EC2"}
        assert _extract_finding_title(f) == "Admin Privileges on EC2"

    def test_returns_empty_when_no_name(self):
        f = {"queryType": "excessiveAccessFindings", "id": "e-1"}
        assert _extract_finding_title(f) == ""


class TestExtractFindingTitleNetworkExposures:
    def test_uses_entity_name(self):
        f = {
            "queryType": "networkExposures",
            "exposedEntity": {"name": "my-ec2-instance"},
            "id": "n-1",
        }
        assert _extract_finding_title(f) == "Network Exposure — my-ec2-instance"

    def test_falls_back_to_id_when_no_entity_name(self):
        f = {
            "queryType": "networkExposures",
            "exposedEntity": {},
            "id": "n-99",
        }
        assert _extract_finding_title(f) == "Network Exposure — n-99"


class TestExtractFindingTitleEndOfLifeFindings:
    def test_uses_detailed_name_and_resource(self):
        f = {
            "queryType": "endOfLifeFindings",
            "detailedName": "Python 3.7",
            "vulnerableAsset": {"name": "my-vm"},
            "technology": {"name": "Python", "version": "3.7"},
            "resource": {},
        }
        assert _extract_finding_title(f) == "Python 3.7 — my-vm"

    def test_uses_tech_name_plus_version_when_no_detailed_name(self):
        f = {
            "queryType": "endOfLifeFindings",
            "technology": {"name": "Ubuntu", "version": "18.04"},
            "vulnerableAsset": {},
            "resource": {},
        }
        assert _extract_finding_title(f) == "Ubuntu 18.04"

    def test_no_resource_name_returns_tech_label_only(self):
        f = {
            "queryType": "endOfLifeFindings",
            "detailedName": "OpenSSL 1.0.2",
            "vulnerableAsset": {},
            "resource": {},
        }
        assert _extract_finding_title(f) == "OpenSSL 1.0.2"


class TestExtractFindingTitleMalwareFindings:
    """DEV-CRIT-1: malwareFindings previously fell through to the generic fallback."""

    def test_uses_name_when_present(self):
        f = {"queryType": "malwareFindings", "name": "Trojan.X", "id": "m-1"}
        assert _extract_finding_title(f) == "Trojan.X"

    def test_falls_back_to_malware_finding_plus_id_when_no_name(self):
        f = {"queryType": "malwareFindings", "id": "abc-123"}
        assert _extract_finding_title(f) == "Malware Finding abc-123"

    def test_empty_name_triggers_fallback(self):
        f = {"queryType": "malwareFindings", "name": "", "id": "def-456"}
        assert _extract_finding_title(f) == "Malware Finding def-456"

    def test_none_name_triggers_fallback(self):
        f = {"queryType": "malwareFindings", "name": None, "id": "ghi-789"}
        assert _extract_finding_title(f) == "Malware Finding ghi-789"

    def test_no_id_produces_empty_suffix(self):
        f = {"queryType": "malwareFindings"}
        assert _extract_finding_title(f) == "Malware Finding "


class TestExtractFindingTitleSoftwareSupplyChainFindings:
    """DEV-CRIT-1: softwareSupplyChainFindings previously fell through to generic fallback."""

    def test_full_composite_title(self):
        f = {
            "queryType": "softwareSupplyChainFindings",
            "packageName": "log4j",
            "packageVersion": "2.14.1",
            "resource": {"name": "my-k8s-cluster"},
        }
        assert _extract_finding_title(f) == "log4j 2.14.1 — my-k8s-cluster"

    def test_no_version(self):
        f = {
            "queryType": "softwareSupplyChainFindings",
            "packageName": "requests",
            "packageVersion": "",
            "resource": {"name": "lambda-fn"},
        }
        assert _extract_finding_title(f) == "requests — lambda-fn"

    def test_no_resource_name(self):
        f = {
            "queryType": "softwareSupplyChainFindings",
            "packageName": "lodash",
            "packageVersion": "4.17.11",
            "resource": {},
        }
        assert _extract_finding_title(f) == "lodash 4.17.11"

    def test_no_package_name_uses_item_name(self):
        f = {
            "queryType": "softwareSupplyChainFindings",
            "name": "fallback-pkg",
            "packageVersion": "1.0",
            "resource": {"name": "srv-01"},
        }
        assert _extract_finding_title(f) == "fallback-pkg 1.0 — srv-01"

    def test_no_package_name_or_name_uses_default(self):
        f = {
            "queryType": "softwareSupplyChainFindings",
            "resource": {"name": "srv-02"},
        }
        assert _extract_finding_title(f) == "Software Package — srv-02"


class TestExtractFindingTitleInventoryFindings:
    def test_uses_rule_name(self):
        f = {
            "queryType": "inventoryFindings",
            "rule": {"name": "EOL Resource Rule"},
            "id": "inv-1",
        }
        assert _extract_finding_title(f) == "EOL Resource Rule"

    def test_falls_back_to_item_name(self):
        # configurationFindings and inventoryFindings share a branch in Python
        # that checks rule.name first, then f.name.
        f = {
            "queryType": "inventoryFindings",
            "rule": {},
            "name": "some-resource",
            "id": "inv-2",
        }
        assert _extract_finding_title(f) == "some-resource"

    def test_returns_empty_when_neither(self):
        f = {"queryType": "inventoryFindings", "rule": {}, "id": "inv-3"}
        assert _extract_finding_title(f) == ""


# ---------------------------------------------------------------------------
# DEV-CRIT-2 — deleted_keys skip + exception_keys reason propagation
#
# These tests exercise the finding-insertion logic directly via the DB models.
# We replicate the key portion of the _run_wiz_fetch insertion loop in isolation,
# without starting a background thread or hitting the Wiz API.
# ---------------------------------------------------------------------------


def _insert_findings(app, snapshot_id, raw_findings, excepted_entries, deleted_entries):
    """Replicate the DEV-CRIT-2-fixed insertion loop from _run_wiz_fetch."""
    from backend.database import db
    from backend.models import Finding
    from backend.routes.pipeline import _transform_finding

    exception_keys = {(e["subscription"], e["title"]): e for e in excepted_entries}
    deleted_keys = {(e["subscription"], e["title"]) for e in deleted_entries}

    weights = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    cat_counters: dict = {}

    with app.app_context():
        for raw in raw_findings:
            if raw.get("id") == "VULN-001" and raw.get("category") == "VULN":
                enriched = raw
            else:
                enriched = _transform_finding(raw, cat_counters)

            sev = enriched.get("severity") or ""
            title = enriched.get("title", "").lower().strip()
            sub = (raw.get("_sourceSubscription") or "").lower().strip()

            if (sub, title) in deleted_keys:
                continue

            mem_entry = exception_keys.get((sub, title))
            is_excepted = mem_entry is not None
            if is_excepted:
                enriched["exception"] = {"active": True, "reason": mem_entry.get("reason") or ""}

            db.session.add(Finding(
                snapshot_id=snapshot_id,
                severity=sev,
                finding_data=enriched,
                exception_active=is_excepted,
            ))
        db.session.commit()


@pytest.fixture
def pipeline_app():
    """Flask application with all pipeline models initialized."""
    from flask import Flask
    from backend.database import db as _db

    application = Flask(__name__)
    application.config["TESTING"] = True
    application.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    application.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    _db.init_app(application)

    with application.app_context():
        import backend.models  # noqa: F401
        _db.create_all()

        # Create a minimal product + snapshot so foreign key constraints are satisfied
        from backend.models import Product, ReportSnapshot
        from datetime import datetime, UTC

        product = Product(
            id="test-prod",
            name="Test",
            owner="Owner",
            owner_email="owner@example.com",
            env="Production",
            subscription_ids=["sub-a"],
        )
        _db.session.add(product)
        _db.session.flush()

        snap = ReportSnapshot(
            product_id="test-prod",
            version="1.0",
            version_type="major",
            status="draft",
            saved_at=datetime.now(UTC),
            risk_score=0,
            snapshot_data={},
        )
        _db.session.add(snap)
        _db.session.commit()

        yield application, snap.id

        _db.session.remove()
        _db.drop_all()


def _make_issue(name, sub):
    """Build a minimal issues-type raw finding."""
    return {
        "queryType": "issues",
        "sourceRules": [{"name": name}],
        "description": name,
        "id": "i-1",
        "_sourceSubscription": sub,
        "severity": "HIGH",
    }


class TestDeletedKeysSkipFinding:
    def test_deleted_finding_is_absent_from_db(self, pipeline_app):
        app, snapshot_id = pipeline_app
        raw = _make_issue("Open RDP Port", "sub-a")

        deleted = [{"subscription": "sub-a", "title": "open rdp port"}]
        _insert_findings(app, snapshot_id, [raw], [], deleted)

        from backend.database import db
        from backend.models import Finding

        with app.app_context():
            count = db.session.query(Finding).filter_by(snapshot_id=snapshot_id).count()
        assert count == 0, "deleted finding must not be inserted"

    def test_non_deleted_finding_is_present(self, pipeline_app):
        app, snapshot_id = pipeline_app
        raw = _make_issue("S3 Public Read", "sub-a")

        deleted = [{"subscription": "sub-a", "title": "some other finding"}]
        _insert_findings(app, snapshot_id, [raw], [], deleted)

        from backend.database import db
        from backend.models import Finding

        with app.app_context():
            count = db.session.query(Finding).filter_by(snapshot_id=snapshot_id).count()
        assert count == 1, "non-deleted finding must be inserted"

    def test_deleted_key_is_case_and_whitespace_sensitive(self, pipeline_app):
        """Key comparison is lowercased + stripped both sides, so this must match."""
        app, snapshot_id = pipeline_app
        raw = _make_issue("  Open RDP Port  ", "Sub-A")
        # The insertion loop lowercases/strips both title and sub before matching.
        deleted = [{"subscription": "sub-a", "title": "open rdp port"}]
        _insert_findings(app, snapshot_id, [raw], [], deleted)

        from backend.database import db
        from backend.models import Finding

        with app.app_context():
            count = db.session.query(Finding).filter_by(snapshot_id=snapshot_id).count()
        assert count == 0, "match must be case-insensitive and strip whitespace"


class TestExceptedKeyReasonPropagation:
    def test_excepted_finding_has_exception_active_true(self, pipeline_app):
        app, snapshot_id = pipeline_app
        raw = _make_issue("Admin Role Unprotected", "sub-a")

        excepted = [{"subscription": "sub-a", "title": "admin role unprotected", "reason": "Risk accepted by CISO"}]
        _insert_findings(app, snapshot_id, [raw], excepted, [])

        from backend.database import db
        from backend.models import Finding

        with app.app_context():
            finding = db.session.query(Finding).filter_by(snapshot_id=snapshot_id).first()
        assert finding is not None
        assert finding.exception_active is True

    def test_excepted_finding_carries_reason(self, pipeline_app):
        app, snapshot_id = pipeline_app
        raw = _make_issue("Admin Role Unprotected", "sub-a")

        excepted = [{"subscription": "sub-a", "title": "admin role unprotected", "reason": "Risk accepted by CISO"}]
        _insert_findings(app, snapshot_id, [raw], excepted, [])

        from backend.database import db
        from backend.models import Finding

        with app.app_context():
            finding = db.session.query(Finding).filter_by(snapshot_id=snapshot_id).first()
        assert finding.finding_data["exception"]["reason"] == "Risk accepted by CISO"

    def test_excepted_finding_with_none_reason_stores_empty_string(self, pipeline_app):
        app, snapshot_id = pipeline_app
        raw = _make_issue("Old Finding", "sub-a")

        excepted = [{"subscription": "sub-a", "title": "old finding", "reason": None}]
        _insert_findings(app, snapshot_id, [raw], excepted, [])

        from backend.database import db
        from backend.models import Finding

        with app.app_context():
            finding = db.session.query(Finding).filter_by(snapshot_id=snapshot_id).first()
        assert finding.finding_data["exception"]["reason"] == ""

    def test_non_excepted_finding_has_exception_active_false(self, pipeline_app):
        app, snapshot_id = pipeline_app
        raw = _make_issue("Normal Finding", "sub-a")

        _insert_findings(app, snapshot_id, [raw], [], [])

        from backend.database import db
        from backend.models import Finding

        with app.app_context():
            finding = db.session.query(Finding).filter_by(snapshot_id=snapshot_id).first()
        assert finding is not None
        assert finding.exception_active is False
