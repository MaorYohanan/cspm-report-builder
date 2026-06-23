from __future__ import annotations

import re
import unicodedata
import uuid
from datetime import UTC, datetime

from flask import Blueprint, jsonify, request
from sqlalchemy.exc import IntegrityError

from backend.database import db
from backend.models import Finding, Product, ProductMemoryEntry, ReportSnapshot

products_bp = Blueprint("products", __name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MAX_MEMORY_ENTRIES = 2000
_MAX_SUBSCRIPTION_LEN = 200
_MAX_TITLE_LEN = 500
_MAX_REASON_LEN = 1000

# ---------------------------------------------------------------------------
# Pure helpers (unchanged — also imported directly by tests)
# ---------------------------------------------------------------------------

def _safe_param(value: str) -> str:
    """Strip path-traversal sequences and dangerous characters."""
    value = value.translate({0: None})
    value = value.replace("/", "").replace("\\", "")
    value = value.replace("..", "")
    return value.strip()


def _valid_version_str(ver: str) -> bool:
    r"""Return True only when *ver* matches ``^\d+\.\d+$``."""
    return bool(re.match(r"^\d+\.\d+$", ver))


_HEBREW_TABLE: dict[str, str] = {
    "א": "a",
    "ב": "b",
    "ג": "g",
    "ד": "d",
    "ה": "h",
    "ו": "v",
    "ז": "z",
    "ח": "ch",
    "ט": "t",
    "י": "y",
    "כ": "k",
    "ך": "k",
    "ל": "l",
    "מ": "m",
    "ם": "m",
    "נ": "n",
    "ן": "n",
    "ס": "s",
    "ע": "a",
    "פ": "p",
    "ף": "p",
    "צ": "ts",
    "ץ": "ts",
    "ק": "k",
    "ר": "r",
    "ש": "sh",
    "שׁ": "sh",
    "שׂ": "s",
    "ת": "t",
}


def _slugify(name: str) -> str:
    """Convert an arbitrary product name into a URL-safe ASCII slug."""
    result_chars: list[str] = []
    i = 0
    while i < len(name):
        two = name[i : i + 2]
        if two in _HEBREW_TABLE:
            result_chars.append(_HEBREW_TABLE[two])
            i += 2
            continue
        one = name[i]
        if one in _HEBREW_TABLE:
            result_chars.append(_HEBREW_TABLE[one])
        else:
            result_chars.append(one)
        i += 1
    slug = "".join(result_chars)

    slug = unicodedata.normalize("NFD", slug)
    slug = "".join(c for c in slug if unicodedata.category(c) != "Mn" and ord(c) < 128)
    slug = slug.lower()
    slug = slug.replace(" ", "-").replace("_", "-")
    slug = re.sub(r"[^a-z0-9-]", "", slug)
    slug = re.sub(r"-{2,}", "-", slug)
    slug = slug.strip("-")
    slug = slug[:100]

    if not slug:
        slug = f"product-{uuid.uuid4().hex[:8]}"

    return slug


_SEVERITY_WEIGHTS: dict[str, int] = {
    "critical": 4,
    "high": 3,
    "medium": 2,
    "low": 1,
}


def _compute_risk_score(snapshot: dict) -> int:
    """Compute ``Critical×4 + High×3 + Medium×2 + Low×1``.

    Findings with an active exception are excluded.
    """
    findings = snapshot.get("findings", [])
    total = 0
    for f in findings:
        if not isinstance(f, dict):
            continue
        exc = f.get("exception")
        if isinstance(exc, dict) and exc.get("active"):
            continue
        severity = str(f.get("severity", "")).lower()
        total += _SEVERITY_WEIGHTS.get(severity, 0)
    return total


def _contains_traversal(value: str) -> bool:
    return "../" in value or "..\\" in value or "\x00" in value


def _validate_product_fields(data: dict, require_all: bool = True) -> tuple[dict | None, tuple | None]:
    REQUIRED_FIELDS = ["name", "owner", "ownerEmail", "env", "subscriptionIds"]

    if require_all:
        for field in REQUIRED_FIELDS:
            if field not in data:
                return None, (jsonify({"error": f"Missing required field: {field}"}), 400)

    cleaned: dict = {}

    for key, val in data.items():
        if isinstance(val, str) and _contains_traversal(val):
            return None, (jsonify({"error": f"Invalid field value: {key}"}), 400)
        if isinstance(val, list):
            for item in val:
                if isinstance(item, str) and _contains_traversal(item):
                    return None, (jsonify({"error": f"Invalid field value: {key}"}), 400)

    if "name" in data:
        name = data["name"]
        if not isinstance(name, str) or len(name) > 100:
            return None, (jsonify({"error": "name: must be a string of max 100 characters"}), 400)
        cleaned["name"] = name

    if "owner" in data:
        owner = data["owner"]
        if not isinstance(owner, str) or len(owner) > 100:
            return None, (jsonify({"error": "owner: must be a string of max 100 characters"}), 400)
        cleaned["owner"] = owner

    if "ownerEmail" in data:
        email = data["ownerEmail"]
        if not isinstance(email, str) or "@" not in email or len(email) > 254:
            return None, (jsonify({"error": "ownerEmail: must be a valid email address of max 254 characters"}), 400)
        cleaned["ownerEmail"] = email

    if "env" in data:
        env = data["env"]
        if not isinstance(env, str) or len(env) > 100:
            return None, (jsonify({"error": "env: must be a string of max 100 characters"}), 400)
        cleaned["env"] = env

    if "subscriptionIds" in data:
        subs = data["subscriptionIds"]
        if not isinstance(subs, list) or len(subs) < 1 or len(subs) > 50:
            return None, (jsonify({"error": "subscriptionIds: must be a non-empty array of 1-50 items"}), 400)
        for item in subs:
            if not isinstance(item, str) or len(item) > 100:
                return None, (
                    jsonify({"error": "subscriptionIds: each item must be a string of max 100 characters"}),
                    400,
                )
        cleaned["subscriptionIds"] = subs

    return cleaned, None


# ---------------------------------------------------------------------------
# ORM helpers
# ---------------------------------------------------------------------------

def _unique_slug(base: str) -> str:
    """Return *base* if no Product with that id exists; else try ``{base}-2`` … ``{base}-99``."""
    if not db.session.get(Product, base):
        return base
    for suffix in range(2, 100):
        candidate = f"{base}-{suffix}"
        if not db.session.get(Product, candidate):
            return candidate
    raise ValueError("Slug namespace exhausted")


def _latest_snapshot(product_id: str) -> ReportSnapshot | None:
    """Return the highest-versioned ReportSnapshot for a product, or None."""
    snapshots = ReportSnapshot.query.filter_by(product_id=product_id).all()
    if not snapshots:
        return None
    return max(snapshots, key=lambda s: tuple(int(x) for x in s.version.split(".")))


def _fmt_dt(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _snapshot_to_dict(snapshot: ReportSnapshot) -> dict:
    """Reconstruct the full snapshot payload the frontend expects."""
    result = dict(snapshot.snapshot_data or {})
    result["findings"] = [f.finding_data for f in snapshot.findings]
    result["version"] = snapshot.version
    result["reportVersion"] = snapshot.report_version
    result["versionNotes"] = snapshot.version_notes
    result["versionType"] = snapshot.version_type
    result["status"] = snapshot.status
    result["savedAt"] = _fmt_dt(snapshot.saved_at)
    result["publishedAt"] = _fmt_dt(snapshot.published_at)
    result["riskScore"] = snapshot.risk_score
    return result


def _version_summary(snapshot: ReportSnapshot) -> dict:
    return {
        "version": snapshot.version,
        "reportVersion": snapshot.report_version,
        "versionNotes": snapshot.version_notes,
        "versionType": snapshot.version_type,
        "status": snapshot.status,
        "savedAt": _fmt_dt(snapshot.saved_at),
        "publishedAt": _fmt_dt(snapshot.published_at),
        "riskScore": snapshot.risk_score,
    }


def _next_version(product_id: str, requested_type: str) -> str:
    """Compute the next version string."""
    latest = _latest_snapshot(product_id)

    if latest is None:
        return "1.0"

    if requested_type == "draft":
        return latest.version

    if latest.status != "published":
        return latest.version

    parts = latest.version.split(".")
    try:
        major, minor = int(parts[0]), int(parts[1])
    except (ValueError, IndexError):
        return "1.0"

    if requested_type == "major":
        return f"{major + 1}.0"
    else:
        if minor + 1 >= 10:
            return f"{major + 1}.0"
        return f"{major}.{minor + 1}"


def _refresh_product_latest(product: Product) -> None:
    """Update the denormalized latest_version / latest_risk_score on *product*."""
    latest = _latest_snapshot(product.id)
    if latest is None:
        product.latest_version = None
        product.latest_risk_score = None
    else:
        product.latest_version = latest.version
        product.latest_risk_score = latest.risk_score


# ---------------------------------------------------------------------------
# Product CRUD endpoints
# ---------------------------------------------------------------------------

@products_bp.route("/api/products", methods=["GET"])
def list_products():
    products = Product.query.order_by(Product.name).all()
    result = []
    for p in products:
        latest = _latest_snapshot(p.id)
        last_checked = _fmt_dt(latest.saved_at) if latest else None
        result.append({
            "id": p.id,
            "name": p.name,
            "owner": p.owner,
            "env": p.env,
            "latestVersion": p.latest_version,
            "latestRiskScore": p.latest_risk_score if p.latest_version is not None else 0,
            "lastChecked": last_checked,
        })
    return jsonify(result), 200


@products_bp.route("/api/products", methods=["POST"])
def create_product():
    data = request.get_json(silent=True) or {}

    cleaned, err = _validate_product_fields(data, require_all=True)
    if err is not None:
        return err

    base_slug = _slugify(cleaned["name"])
    try:
        slug = _unique_slug(base_slug)
    except ValueError:
        return jsonify({"error": "Slug namespace exhausted"}), 409

    product = Product(
        id=slug,
        name=cleaned["name"],
        owner=cleaned["owner"],
        owner_email=cleaned["ownerEmail"],
        env=cleaned["env"],
        subscription_ids=cleaned["subscriptionIds"],
        created_at=datetime.now(UTC),
    )
    db.session.add(product)
    db.session.commit()

    return jsonify(_product_to_dict(product)), 201


def _product_to_dict(p: Product) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "owner": p.owner,
        "ownerEmail": p.owner_email,
        "env": p.env,
        "subscriptionIds": p.subscription_ids,
        "createdAt": _fmt_dt(p.created_at),
        "latestVersion": p.latest_version,
        "latestRiskScore": p.latest_risk_score,
    }


@products_bp.route("/api/products/<product_id>", methods=["GET"])
def get_product(product_id: str):
    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    product = db.session.get(Product, safe_id)
    if product is None:
        return jsonify({"error": "Product not found"}), 404

    return jsonify(_product_to_dict(product)), 200


@products_bp.route("/api/products/<product_id>", methods=["PUT"])
def update_product(product_id: str):
    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    product = db.session.get(Product, safe_id)
    if product is None:
        return jsonify({"error": "Product not found"}), 404

    data = request.get_json(silent=True) or {}

    cleaned, err = _validate_product_fields(data, require_all=False)
    if err is not None:
        return err

    if "name" in cleaned:
        product.name = cleaned["name"]
    if "owner" in cleaned:
        product.owner = cleaned["owner"]
    if "ownerEmail" in cleaned:
        product.owner_email = cleaned["ownerEmail"]
    if "env" in cleaned:
        product.env = cleaned["env"]
    if "subscriptionIds" in cleaned:
        product.subscription_ids = cleaned["subscriptionIds"]

    db.session.commit()
    return jsonify(_product_to_dict(product)), 200


@products_bp.route("/api/products/<product_id>", methods=["DELETE"])
def delete_product(product_id: str):
    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    product = db.session.get(Product, safe_id)
    if product is None:
        return jsonify({"error": "Product not found"}), 404

    db.session.delete(product)
    db.session.commit()
    return jsonify({"deleted": True, "id": safe_id}), 200


# ---------------------------------------------------------------------------
# Version endpoints
# ---------------------------------------------------------------------------

@products_bp.route("/api/products/<product_id>/versions", methods=["GET"])
def list_versions(product_id: str):
    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not db.session.get(Product, safe_id):
        return jsonify({"error": "Product not found"}), 404

    snapshots = (
        ReportSnapshot.query
        .filter_by(product_id=safe_id)
        .all()
    )
    snapshots.sort(key=lambda s: s.saved_at or datetime.min, reverse=True)
    return jsonify([_version_summary(s) for s in snapshots]), 200


@products_bp.route("/api/products/<product_id>/versions", methods=["POST"])
def save_version(product_id: str):
    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not db.session.get(Product, safe_id):
        return jsonify({"error": "Product not found"}), 404

    content_length = request.content_length
    if content_length is not None and content_length > 50 * 1024 * 1024:
        return jsonify({"error": "Snapshot too large"}), 413

    data = request.get_json(silent=True) or {}

    for field in ("type", "notes", "snapshot"):
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400

    version_type = data["type"]
    if version_type not in ("major", "minor", "draft"):
        return jsonify({"error": "type: must be 'major', 'minor', or 'draft'"}), 400

    notes = data["notes"]
    snapshot = data["snapshot"]

    if not isinstance(snapshot, dict):
        return jsonify({"error": "snapshot: must be an object"}), 400

    if isinstance(notes, str) and _contains_traversal(notes):
        return jsonify({"error": "Invalid field value: notes"}), 400

    raw_body = request.get_data()
    if len(raw_body) > 50 * 1024 * 1024:
        return jsonify({"error": "Snapshot too large"}), 413

    latest = _latest_snapshot(safe_id)
    latest_status = latest.status if latest else None

    if version_type == "draft":
        if latest is None or latest_status != "draft":
            return jsonify({"error": "אין טיוטה לעדכון"}), 400
    else:
        if latest_status == "draft":
            return jsonify({
                "error": "יש לפרסם או למחוק את הטיוטה הקיימת לפני יצירת גרסה חדשה"
            }), 409

    version_str = _next_version(safe_id, version_type)
    risk_score = _compute_risk_score(snapshot)
    now = datetime.now(UTC)

    report_version = "1.0"
    if isinstance(snapshot.get("meta"), dict):
        report_version = str(snapshot["meta"].get("reportVersion", "1.0"))

    findings_list = snapshot.get("findings", [])
    snapshot_data = {k: v for k, v in snapshot.items() if k != "findings"}

    if version_type == "draft" and latest is not None:
        # Overwrite the existing draft snapshot
        snap = latest
        snap.version_notes = notes
        snap.risk_score = risk_score
        snap.saved_at = now
        snap.report_version = report_version
        snap.snapshot_data = snapshot_data
        # Replace findings
        Finding.query.filter_by(snapshot_id=snap.id).delete()
        for fd in findings_list:
            if isinstance(fd, dict):
                exc = fd.get("exception")
                db.session.add(Finding(
                    snapshot_id=snap.id,
                    severity=str(fd.get("severity", "")).lower() or None,
                    exception_active=bool(isinstance(exc, dict) and exc.get("active")),
                    finding_data=fd,
                ))
    else:
        snap = ReportSnapshot(
            product_id=safe_id,
            version=version_str,
            report_version=report_version,
            version_notes=notes,
            version_type=version_type,
            status="draft",
            saved_at=now,
            published_at=None,
            risk_score=risk_score,
            snapshot_data=snapshot_data,
        )
        db.session.add(snap)
        db.session.flush()  # assign snap.id before inserting findings
        for fd in findings_list:
            if isinstance(fd, dict):
                exc = fd.get("exception")
                db.session.add(Finding(
                    snapshot_id=snap.id,
                    severity=str(fd.get("severity", "")).lower() or None,
                    exception_active=bool(isinstance(exc, dict) and exc.get("active")),
                    finding_data=fd,
                ))

    # Keep denormalized fields on Product in sync
    product = db.session.get(Product, safe_id)
    product.latest_version = version_str
    product.latest_risk_score = risk_score

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Version conflict — please retry"}), 409

    return jsonify(_version_summary(snap)), 201


@products_bp.route("/api/products/<product_id>/versions/<ver>", methods=["GET"])
def get_version(product_id: str, ver: str):
    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not _valid_version_str(ver):
        return jsonify({"error": "Invalid version format"}), 400

    if not db.session.get(Product, safe_id):
        return jsonify({"error": "Product not found"}), 404

    snap = ReportSnapshot.query.filter_by(product_id=safe_id, version=ver).first()
    if snap is None:
        return jsonify({"error": "Version not found"}), 404

    return jsonify(_snapshot_to_dict(snap)), 200


@products_bp.route("/api/products/<product_id>/versions/<ver>", methods=["DELETE"])
def delete_version(product_id: str, ver: str):
    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not _valid_version_str(ver):
        return jsonify({"error": "Invalid version format"}), 400

    if not db.session.get(Product, safe_id):
        return jsonify({"error": "Product not found"}), 404

    snap = ReportSnapshot.query.filter_by(product_id=safe_id, version=ver).first()
    if snap is None:
        return jsonify({"error": "Version not found"}), 404

    summary = _version_summary(snap)
    db.session.delete(snap)

    product = db.session.get(Product, safe_id)
    _refresh_product_latest(product)

    db.session.commit()
    return jsonify(summary), 200


@products_bp.route("/api/products/<product_id>/versions/<ver>/publish", methods=["POST"])
def publish_version(product_id: str, ver: str):
    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not _valid_version_str(ver):
        return jsonify({"error": "Invalid version format"}), 400

    if not db.session.get(Product, safe_id):
        return jsonify({"error": "Product not found"}), 404

    snap = ReportSnapshot.query.filter_by(product_id=safe_id, version=ver).first()
    if snap is None:
        return jsonify({"error": "Version not found"}), 404

    if snap.status == "published":
        return jsonify({"error": "Version already published"}), 409

    snap.status = "published"
    snap.published_at = datetime.now(UTC)
    db.session.commit()

    return jsonify(_version_summary(snap)), 200


# ---------------------------------------------------------------------------
# Product Memory endpoints
# ---------------------------------------------------------------------------

def _memory_key(subscription: str, title: str) -> str:
    return subscription.lower().strip() + "::" + title.lower().strip()


def _memory_to_dict(product_id: str) -> dict:
    """Build the memory response dict from ProductMemoryEntry rows."""
    entries = ProductMemoryEntry.query.filter_by(product_id=product_id).all()
    return {
        "version": 1,
        "entries": {
            _memory_key(e.subscription, e.title): {
                "exception": True,
                "reason": e.reason or "",
                "source": e.source,
            }
            for e in entries
        },
    }


@products_bp.route("/api/products/<product_id>/memory", methods=["GET"])
def get_memory(product_id: str):
    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not db.session.get(Product, safe_id):
        return jsonify({"error": "Product not found"}), 404

    return jsonify(_memory_to_dict(safe_id)), 200


@products_bp.route("/api/products/<product_id>/memory/entry", methods=["POST"])
def upsert_memory_entry(product_id: str):
    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not db.session.get(Product, safe_id):
        return jsonify({"error": "Product not found"}), 404

    data = request.get_json(silent=True) or {}
    subscription = data.get("subscription", "")
    title = data.get("title", "")
    reason = data.get("reason", "")
    source = data.get("source", "excepted")

    if not isinstance(subscription, str) or not subscription.strip():
        return jsonify({"error": "subscription: required non-empty string"}), 400
    if not isinstance(title, str) or not title.strip():
        return jsonify({"error": "title: required non-empty string"}), 400
    if len(subscription) > _MAX_SUBSCRIPTION_LEN:
        return jsonify({"error": "subscription: too long"}), 400
    if len(title) > _MAX_TITLE_LEN:
        return jsonify({"error": "title: too long"}), 400
    if not isinstance(reason, str) or len(reason) > _MAX_REASON_LEN:
        reason = ""
    if source not in ("excepted", "deleted"):
        source = "excepted"
    if _contains_traversal(subscription) or _contains_traversal(title):
        return jsonify({"error": "Invalid field value"}), 400

    count = ProductMemoryEntry.query.filter_by(product_id=safe_id).count()
    if count >= _MAX_MEMORY_ENTRIES:
        return jsonify({"error": "Memory limit reached"}), 429

    existing = ProductMemoryEntry.query.filter_by(
        product_id=safe_id,
        subscription=subscription.lower().strip(),
        title=title.lower().strip(),
    ).first()

    if existing:
        existing.reason = reason
        existing.source = source
    else:
        db.session.add(ProductMemoryEntry(
            product_id=safe_id,
            subscription=subscription.lower().strip(),
            title=title.lower().strip(),
            reason=reason,
            source=source,
        ))

    db.session.commit()
    key = _memory_key(subscription, title)
    return jsonify({"ok": True, "key": key}), 200


@products_bp.route("/api/products/<product_id>/memory/entry", methods=["DELETE"])
def delete_memory_entry(product_id: str):
    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not db.session.get(Product, safe_id):
        return jsonify({"error": "Product not found"}), 404

    data = request.get_json(silent=True) or {}
    subscription = data.get("subscription", "")
    title = data.get("title", "")

    if not isinstance(subscription, str) or not isinstance(title, str):
        return jsonify({"error": "subscription and title required"}), 400

    entry = ProductMemoryEntry.query.filter_by(
        product_id=safe_id,
        subscription=subscription.lower().strip(),
        title=title.lower().strip(),
    ).first()

    if entry:
        db.session.delete(entry)
        db.session.commit()

    return jsonify({"ok": True}), 200
