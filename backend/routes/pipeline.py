from __future__ import annotations

import calendar
import logging
import os
import threading
from datetime import UTC, datetime

from flask import Blueprint, current_app, jsonify, request

from backend.database import db
from backend.models import Finding, Product, ProductMemoryEntry, ReportSnapshot
from backend.services.auth_service import require_role
from backend.services.wiz_service import WizService

pipeline_bp = Blueprint("pipeline", __name__)
_log = logging.getLogger(__name__)

_FREQ_MONTHS = {
    "monthly": 1,
    "quarterly": 3,
    "annual": 12,
}

_STATUS_ORDER = {"overdue": 0, "due_this_month": 1, "upcoming": 2, "no_scans": 3}

# In-memory job tracker: snapshot_id → {status, done, total, findings_count, error}
_scan_jobs: dict = {}

# Number of query types in bulk_fetch_for_subscriptions — must match the list there
_BULK_QUERY_TYPE_COUNT = 9


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_id(v) -> str | None:
    v = str(v or "").strip()
    return v if v else None


def _add_months(dt: datetime, months: int) -> datetime:
    total_months = dt.month + months - 1
    year = dt.year + total_months // 12
    month = total_months % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def _last_published(product_id: str) -> ReportSnapshot | None:
    return (
        ReportSnapshot.query
        .filter_by(product_id=product_id, status="published")
        .order_by(ReportSnapshot.published_at.desc())
        .first()
    )


def _pipeline_status(published_at: datetime | None, frequency: str) -> tuple[str, str | None]:
    if published_at is None:
        return "no_scans", None

    months = _FREQ_MONTHS.get(frequency, 3)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=UTC)
    next_due = _add_months(published_at, months)
    today = datetime.now(UTC)

    if next_due < today:
        status = "overdue"
    elif next_due.year == today.year and next_due.month == today.month:
        status = "due_this_month"
    else:
        status = "upcoming"

    return status, next_due.strftime("%Y-%m-%dT%H:%M:%SZ")


def _next_major_version(product_id: str) -> tuple[str, str]:
    """Return (version_str, "major") for a new scan.

    Uses id DESC so that a published snapshot always beats an old abandoned draft.
    Raises ValueError("draft_exists") if the most recent snapshot is a draft.
    """
    last = (
        ReportSnapshot.query
        .filter_by(product_id=product_id)
        .order_by(ReportSnapshot.id.desc())
        .first()
    )
    if last is None:
        return "1.0", "major"
    if last.status == "draft":
        raise ValueError("draft_exists")
    try:
        major = int(last.version.split(".")[0])
    except (ValueError, AttributeError):
        major = 1
    return f"{major + 1}.0", "major"


def _extract_finding_title(f: dict) -> str:
    """Mirror wizi.js import function title extraction for exception-key matching.

    Each branch matches the corresponding importXxxFinding function so that
    titles stored by the UI (via saveToProductMemory) round-trip correctly.
    """
    qtype = f.get("queryType", "")

    if qtype == "issues":
        rules = f.get("sourceRules") or []
        rule_name = rules[0].get("name") if rules else ""
        return rule_name or f.get("description") or f.get("id", "")

    if qtype in ("configurationFindings", "inventoryFindings"):
        rule = f.get("rule") or {}
        return rule.get("name") or f.get("name") or ""

    if qtype == "vulnerabilityFindings":
        return f.get("name") or f.get("detailedName") or ""

    if qtype == "hostConfigurationRuleAssessments":
        rule = f.get("rule") or {}
        return rule.get("name") or ""

    if qtype == "dataFindingsV2":
        classifier = f.get("dataClassifier") or {}
        return f.get("name") or classifier.get("name") or ""

    if qtype == "secretInstances":
        rule = f.get("rule") or {}
        return f.get("name") or rule.get("name") or ""

    if qtype == "excessiveAccessFindings":
        return f.get("name") or ""

    if qtype == "networkExposures":
        entity = f.get("exposedEntity") or {}
        return "Network Exposure — " + (entity.get("name") or f.get("id", ""))

    if qtype == "endOfLifeFindings":
        tech = f.get("technology") or {}
        asset = f.get("vulnerableAsset") or {}
        res = f.get("resource") or {}
        tech_label = f.get("detailedName") or tech.get("name") or "End of Life Asset"
        if not f.get("detailedName") and tech.get("version"):
            tech_label = tech_label + " " + tech.get("version")
        resource_name = asset.get("name") or res.get("name") or ""
        return tech_label + (" — " + resource_name if resource_name else "")

    return f.get("name") or ""


def _run_wiz_fetch(app, snapshot_id: int, selected_subs: list) -> None:
    """Background thread: fetch from Wiz and persist findings to the snapshot."""
    with app.app_context():
        client_id = os.environ.get("WIZI_CLIENT_ID", "")
        client_secret = os.environ.get("WIZI_CLIENT_SECRET", "")
        api_url = os.environ.get("WIZI_API_URL", "https://api.il1.app.wiz.io/graphql")
        auth_url = os.environ.get("WIZI_AUTH_URL", "https://auth.app.wiz.io/oauth/token")

        if not client_id or not client_secret:
            if snapshot_id in _scan_jobs:
                _scan_jobs[snapshot_id]["status"] = "error"
                _scan_jobs[snapshot_id]["error"] = "Wiz credentials not configured"
            return

        wiz = WizService(
            client_id=client_id,
            client_secret=client_secret,
            api_url=api_url,
            auth_url=auth_url,
        )

        def _progress(done: int, total: int) -> None:
            if snapshot_id in _scan_jobs:
                _scan_jobs[snapshot_id].update(done=done, total=total)

        try:
            findings = wiz.bulk_fetch_for_subscriptions(selected_subs, _progress)

            snap = db.session.get(ReportSnapshot, snapshot_id)
            exceptions = ProductMemoryEntry.query.filter_by(product_id=snap.product_id).all()
            exception_keys = {(e.subscription, e.title) for e in exceptions}

            weights = {"critical": 4, "high": 3, "medium": 2, "low": 1}
            risk = 0

            # Batch-commit every 200 findings to keep each write transaction short.
            # Long single-transaction commits hold the SQLite write lock for the
            # entire duration, blocking all concurrent Flask requests.
            _BATCH = 200
            for i, f in enumerate(findings):
                sev = (f.get("severity") or "").lower()
                title = _extract_finding_title(f).lower().strip()
                sub = (f.get("_sourceSubscription") or "").lower().strip()
                is_excepted = (sub, title) in exception_keys
                db.session.add(Finding(
                    snapshot_id=snapshot_id,
                    severity=sev,
                    finding_data=f,
                    exception_active=is_excepted,
                ))
                if not is_excepted:
                    risk += weights.get(sev, 0)
                if (i + 1) % _BATCH == 0:
                    db.session.commit()

            # Final batch + update snapshot metadata
            snap = db.session.get(ReportSnapshot, snapshot_id)
            snap.risk_score = risk
            snap_data = dict(snap.snapshot_data or {})
            snap_data["findings_count"] = len(findings)
            snap.snapshot_data = snap_data

            product = db.session.get(Product, snap.product_id)
            if product:
                product.latest_risk_score = risk

            db.session.commit()

            if snapshot_id in _scan_jobs:
                _scan_jobs[snapshot_id]["status"] = "done"
                _scan_jobs[snapshot_id]["findings_count"] = len(findings)

        except Exception as exc:
            db.session.rollback()
            _log.error("Background Wiz fetch failed for snapshot %s: %s", snapshot_id, exc, exc_info=True)
            if snapshot_id in _scan_jobs:
                _scan_jobs[snapshot_id]["status"] = "error"
                _scan_jobs[snapshot_id]["error"] = str(exc)
        finally:
            # Release the thread-local session back to the pool so the
            # SQLite connection is not kept open past this thread's lifetime.
            db.session.remove()


# ── Routes ───────────────────────────────────────────────────────────────────

@pipeline_bp.route("/api/pipeline", methods=["GET"])
@require_role("viewer")
def get_pipeline():
    products = Product.query.order_by(Product.name).all()
    rows = []
    for p in products:
        snap = _last_published(p.id)
        published_at = snap.published_at if snap else None
        status, next_due = _pipeline_status(published_at, p.scan_frequency)

        published_iso = None
        if published_at:
            if published_at.tzinfo is None:
                published_at = published_at.replace(tzinfo=UTC)
            published_iso = published_at.strftime("%Y-%m-%dT%H:%M:%SZ")

        rows.append({
            "id": p.id,
            "name": p.name,
            "owner": p.owner,
            "env": p.env,
            "scanFrequency": p.scan_frequency,
            "subscriptionIds": p.subscription_ids or [],
            "lastPublishedAt": published_iso,
            "lastPublishedVersion": snap.version if snap else None,
            "nextDueAt": next_due,
            "status": status,
        })

    rows.sort(key=lambda r: (_STATUS_ORDER.get(r["status"], 9), r["name"]))
    return jsonify(rows), 200


@pipeline_bp.route("/api/pipeline/<product_id>/start-scan", methods=["POST"])
@require_role("editor")
def start_scan(product_id):
    """Create a new draft snapshot and start a background Wiz fetch."""
    safe_id = _safe_id(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not os.environ.get("WIZI_CLIENT_ID") or not os.environ.get("WIZI_CLIENT_SECRET"):
        return jsonify({"error": "Wiz integration not configured"}), 501

    product = db.session.get(Product, safe_id)
    if product is None:
        return jsonify({"error": "Product not found"}), 404

    data = request.get_json(force=True, silent=True) or {}
    selected_subs = data.get("subscription_ids", [])
    if not selected_subs or not isinstance(selected_subs, list):
        return jsonify({"error": "No subscriptions selected"}), 400
    if not all(isinstance(s, str) and 0 < len(s) <= 200 for s in selected_subs):
        return jsonify({"error": "Invalid subscription_ids"}), 400

    try:
        version, ver_type = _next_major_version(safe_id)
    except ValueError as exc:
        if str(exc) == "draft_exists":
            return jsonify({
                "error": "draft_exists",
                "message": "טיוטה פעילה קיימת. השלם או מחק אותה לפני פתיחת סריקה חדשה.",
            }), 409
        raise

    last = _last_published(safe_id)
    snap_data = dict(last.snapshot_data) if last else {}

    new_snap = ReportSnapshot(
        product_id=safe_id,
        version=version,
        version_type=ver_type,
        version_notes="",
        status="draft",
        saved_at=datetime.now(UTC),
        risk_score=0,
        snapshot_data=snap_data,
    )
    db.session.add(new_snap)
    db.session.flush()
    snapshot_id = new_snap.id
    db.session.commit()

    _scan_jobs[snapshot_id] = {
        "status": "fetching",
        "done": 0,
        "total": len(selected_subs) * _BULK_QUERY_TYPE_COUNT,
        "findings_count": 0,
        "error": None,
    }

    app_obj = current_app._get_current_object()
    t = threading.Thread(
        target=_run_wiz_fetch,
        args=(app_obj, snapshot_id, selected_subs),
        daemon=True,
    )
    t.start()

    return jsonify({"snapshot_id": snapshot_id, "version": version, "status": "fetching"}), 202


@pipeline_bp.route("/api/pipeline/<product_id>/scan-status/<int:snapshot_id>", methods=["GET"])
@require_role("viewer")
def get_scan_status(product_id, snapshot_id):
    """Poll the status of an in-progress background scan."""
    safe_id = _safe_id(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    job = _scan_jobs.get(snapshot_id)
    if job is not None:
        return jsonify(job), 200

    # Job missing — server likely restarted mid-fetch; surface the draft from DB
    snap = db.session.get(ReportSnapshot, snapshot_id)
    if snap is None or snap.product_id != safe_id:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({
        "status": "error",
        "done": 0,
        "total": 0,
        "findings_count": 0,
        "error": "השרת הופעל מחדש במהלך הסריקה. אנא מחק את הטיוטה ונסה שוב.",
    }), 200
