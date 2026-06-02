from __future__ import annotations

import json
import re
import unicodedata
import uuid
from pathlib import Path

from flask import Blueprint

products_bp = Blueprint('products', __name__)

# Set by init_products_dir(); None until initialised.
PRODUCTS_DIR: Path | None = None

# Set to True when the products directory cannot be created at startup.
_storage_error: bool = False


def init_products_dir(products_dir: Path) -> None:
    """Initialise the products storage directory.

    Called once at application startup (mirrors the pattern in files.py).
    On OSError the module-level _storage_error flag is set so that every
    subsequent request handler returns HTTP 500.
    """
    global PRODUCTS_DIR, _storage_error
    PRODUCTS_DIR = products_dir
    try:
        products_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        import logging
        logging.getLogger(__name__).error(
            "Failed to create products directory %s: %s", products_dir, exc
        )
        _storage_error = True


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def _safe_param(value: str) -> str:
    """Strip path-traversal sequences and dangerous characters.

    Removes forward-slashes, back-slashes, ".." sequences, and null bytes.
    Returns empty string if nothing valid remains.
    """
    # Remove null bytes (chr(0) == \x00 == \u0000 — they are all the same code point)
    value = value.translate({0: None})
    # Remove path separators and ".." sequences
    value = value.replace("/", "").replace("\\", "")
    value = value.replace("..", "")
    return value.strip()


def _valid_version_str(ver: str) -> bool:
    r"""Return True only when *ver* matches ``^\d+\.\d+$``."""
    return bool(re.match(r"^\d+\.\d+$", ver))


# Hebrew → ASCII phonetic transliteration table.
# Multi-character outputs (e.g. shin → "sh", het → "ch", tsadi → "ts") are
# handled by mapping to a temporary private-use placeholder then expanding
# after the Unicode normalisation step.
_HEBREW_TABLE: dict[str, str] = {
    "\u05d0": "a",   # alef   א
    "\u05d1": "b",   # bet    ב
    "\u05d2": "g",   # gimel  ג
    "\u05d3": "d",   # dalet  ד
    "\u05d4": "h",   # he     ה
    "\u05d5": "v",   # vav    ו
    "\u05d6": "z",   # zayin  ז
    "\u05d7": "ch",  # het    ח
    "\u05d8": "t",   # tet    ט
    "\u05d9": "y",   # yod    י
    "\u05db": "k",   # kaf    כ
    "\u05da": "k",   # khaf (final kaf) ך
    "\u05dc": "l",   # lamed  ל
    "\u05de": "m",   # mem    מ
    "\u05dd": "m",   # mem-sofit ם
    "\u05e0": "n",   # nun    נ
    "\u05df": "n",   # nun-sofit ן
    "\u05e1": "s",   # samekh ס
    "\u05e2": "a",   # ayin   ע
    "\u05e4": "p",   # pe     פ
    "\u05e3": "p",   # fe-sofit ף
    "\u05e6": "ts",  # tsadi  צ
    "\u05e5": "ts",  # tsadi-sofit ץ
    "\u05e7": "k",   # qof    ק
    "\u05e8": "r",   # resh   ר
    "\u05e9": "sh",  # shin   שׁ (also covers sin שׂ below)
    "\u05e9\u05c1": "sh",  # shin with dot
    "\u05e9\u05c2": "s",   # sin with dot
    "\u05ea": "t",   # tav    ת
}

# Standalone sin (without dagesh dot) also maps to "s".
_SIN = "\u05e9"  # Base letter for both shin and sin; we default to "sh" above.


def _slugify(name: str) -> str:
    """Convert an arbitrary product name into a URL-safe ASCII slug.

    Steps
    -----
    1. Transliterate Hebrew characters.
    2. NFD-normalise; strip diacritics (non-ASCII combining marks).
    3. Lowercase.
    4. Replace spaces and underscores with hyphens.
    5. Remove characters not in ``[a-z0-9-]``.
    6. Collapse consecutive hyphens.
    7. Strip leading/trailing hyphens.
    8. Truncate to 100 characters.
    9. Empty result → fallback ``product-{uuid4_hex[:8]}``.
    """
    # Step 1: transliterate Hebrew.  Process longest matches first (shin+dot
    # before bare shin) by iterating character by character with look-ahead.
    result_chars: list[str] = []
    i = 0
    while i < len(name):
        # Try two-character match first (e.g. shin + dagesh dot).
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

    # Step 2: NFD normalise then strip diacritics.
    slug = unicodedata.normalize("NFD", slug)
    slug = "".join(c for c in slug if unicodedata.category(c) != "Mn" and ord(c) < 128)

    # Step 3: lowercase.
    slug = slug.lower()

    # Step 4: spaces and underscores → hyphens.
    slug = slug.replace(" ", "-").replace("_", "-")

    # Step 5: remove characters not in [a-z0-9-].
    slug = re.sub(r"[^a-z0-9-]", "", slug)

    # Step 6: collapse consecutive hyphens.
    slug = re.sub(r"-{2,}", "-", slug)

    # Step 7: strip leading/trailing hyphens.
    slug = slug.strip("-")

    # Step 8: truncate.
    slug = slug[:100]

    # Step 9: fallback.
    if not slug:
        slug = f"product-{uuid.uuid4().hex[:8]}"

    return slug


def _unique_slug(base: str) -> str:
    """Return *base* if its directory does not yet exist; otherwise try
    ``{base}-2`` … ``{base}-99``.  Raises ``ValueError`` if all are taken.
    """
    if PRODUCTS_DIR is None:
        raise RuntimeError("PRODUCTS_DIR is not initialised")

    if not (PRODUCTS_DIR / base).exists():
        return base

    for suffix in range(2, 100):
        candidate = f"{base}-{suffix}"
        if not (PRODUCTS_DIR / candidate).exists():
            return candidate

    raise ValueError("Slug namespace exhausted")


# Severity weights for risk-score computation.
_SEVERITY_WEIGHTS: dict[str, int] = {
    "critical": 4,
    "high": 3,
    "medium": 2,
    "low": 1,
}


def _compute_risk_score(snapshot: dict) -> int:
    """Compute the risk score from a snapshot dict.

    ``Critical×4 + High×3 + Medium×2 + Low×1``; unrecognised severities
    contribute 0.
    """
    findings = snapshot.get("findings", [])
    total = 0
    for f in findings:
        if not isinstance(f, dict):
            continue
        severity = str(f.get("severity", "")).lower()
        total += _SEVERITY_WEIGHTS.get(severity, 0)
    return total


def _scan_latest_version(product_dir: Path) -> tuple[str | None, int]:
    """Return ``(version_string, risk_score)`` for the highest-numbered version.

    Globs ``v*.*.json`` files, parses ``(major, minor)`` tuples, selects the
    maximum, reads ``riskScore`` from that file.  Returns ``(None, 0)`` when
    no version files exist.
    """
    pattern = "v*.*.json"
    version_files = list(product_dir.glob(pattern))
    if not version_files:
        return None, 0

    best_key: tuple[int, int] | None = None
    best_file: Path | None = None

    for vf in version_files:
        # Filename looks like "v2.1.json"; strip leading "v" and trailing ".json".
        stem = vf.stem  # e.g. "v2.1"
        if not stem.startswith("v"):
            continue
        parts = stem[1:].split(".")
        if len(parts) != 2:
            continue
        try:
            major, minor = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        key = (major, minor)
        if best_key is None or key > best_key:
            best_key = key
            best_file = vf

    if best_file is None or best_key is None:
        return None, 0

    try:
        data = json.loads(best_file.read_text(encoding="utf-8"))
    except Exception:
        return None, 0

    version_str = f"{best_key[0]}.{best_key[1]}"
    risk_score = int(data.get("riskScore", 0))
    return version_str, risk_score


# ---------------------------------------------------------------------------
# Validation helpers (used by CRUD handlers)
# ---------------------------------------------------------------------------

import shutil
from datetime import datetime

from flask import jsonify, request


def _contains_traversal(value: str) -> bool:
    """Return True if *value* contains path-traversal or null-byte sequences."""
    return "../" in value or "..\\" in value or "\x00" in value


def _validate_product_fields(data: dict, require_all: bool = True) -> tuple[dict | None, tuple | None]:
    """Validate product fields from a request body.

    If *require_all* is True (POST), all fields are mandatory.
    If *require_all* is False (PUT), only provided fields are validated.

    Returns (cleaned_data, None) on success or (None, (response, status)) on failure.
    """
    REQUIRED_FIELDS = ["name", "owner", "ownerEmail", "env", "subscriptionIds"]

    if require_all:
        for field in REQUIRED_FIELDS:
            if field not in data:
                return None, (jsonify({"error": f"Missing required field: {field}"}), 400)

    cleaned: dict = {}

    # Traverse check on every string field present in body
    for key, val in data.items():
        if isinstance(val, str) and _contains_traversal(val):
            return None, (jsonify({"error": f"Invalid field value: {key}"}), 400)
        if isinstance(val, list):
            for item in val:
                if isinstance(item, str) and _contains_traversal(item):
                    return None, (jsonify({"error": f"Invalid field value: {key}"}), 400)

    # name
    if "name" in data:
        name = data["name"]
        if not isinstance(name, str) or len(name) > 100:
            return None, (jsonify({"error": "name: must be a string of max 100 characters"}), 400)
        cleaned["name"] = name

    # owner
    if "owner" in data:
        owner = data["owner"]
        if not isinstance(owner, str) or len(owner) > 100:
            return None, (jsonify({"error": "owner: must be a string of max 100 characters"}), 400)
        cleaned["owner"] = owner

    # ownerEmail
    if "ownerEmail" in data:
        email = data["ownerEmail"]
        if not isinstance(email, str) or "@" not in email or len(email) > 254:
            return None, (jsonify({"error": "ownerEmail: must be a valid email address of max 254 characters"}), 400)
        cleaned["ownerEmail"] = email

    # env
    if "env" in data:
        env = data["env"]
        if not isinstance(env, str) or len(env) > 100:
            return None, (jsonify({"error": "env: must be a string of max 100 characters"}), 400)
        cleaned["env"] = env

    # subscriptionIds
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
# Product CRUD endpoints
# ---------------------------------------------------------------------------


@products_bp.route("/api/products", methods=["GET"])
def list_products():
    """Return a JSON array of all product summaries, sorted by name."""
    if _storage_error:
        return jsonify({"error": "Products storage unavailable"}), 500

    products = []
    for entry in PRODUCTS_DIR.iterdir():
        if not entry.is_dir():
            continue
        meta_path = entry / "meta.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            continue

        latest_ver, latest_risk = _scan_latest_version(entry)

        # Determine lastChecked from the latest version file's savedAt field
        last_checked = None
        if latest_ver is not None:
            ver_file = entry / f"v{latest_ver}.json"
            try:
                ver_data = json.loads(ver_file.read_text(encoding="utf-8"))
                last_checked = ver_data.get("savedAt")
            except Exception:
                pass

        products.append({
            "id": meta.get("id"),
            "name": meta.get("name"),
            "owner": meta.get("owner"),
            "env": meta.get("env"),
            "latestVersion": latest_ver,
            "latestRiskScore": latest_risk if latest_ver is not None else 0,
            "lastChecked": last_checked,
        })

    products.sort(key=lambda p: (p.get("name") or "").lower())
    return jsonify(products), 200


@products_bp.route("/api/products", methods=["POST"])
def create_product():
    """Create a new product."""
    if _storage_error:
        return jsonify({"error": "Products storage unavailable"}), 500

    data = request.get_json(silent=True) or {}

    cleaned, err = _validate_product_fields(data, require_all=True)
    if err is not None:
        return err

    # Generate slug
    base_slug = _slugify(cleaned["name"])
    try:
        slug = _unique_slug(base_slug)
    except ValueError:
        return jsonify({"error": "Slug namespace exhausted"}), 409

    product_dir = PRODUCTS_DIR / slug
    product_dir.mkdir(parents=True, exist_ok=True)

    meta = {
        "id": slug,
        "name": cleaned["name"],
        "owner": cleaned["owner"],
        "ownerEmail": cleaned["ownerEmail"],
        "env": cleaned["env"],
        "subscriptionIds": cleaned["subscriptionIds"],
        "createdAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "latestVersion": None,
        "latestRiskScore": None,
    }

    (product_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return jsonify(meta), 201


@products_bp.route("/api/products/<product_id>", methods=["GET"])
def get_product(product_id: str):
    """Return the full metadata for a single product."""
    if _storage_error:
        return jsonify({"error": "Products storage unavailable"}), 500

    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    product_dir = PRODUCTS_DIR / safe_id
    if not product_dir.is_dir():
        return jsonify({"error": "Product not found"}), 404

    meta_path = product_dir / "meta.json"
    if not meta_path.exists():
        return jsonify({"error": "Product not found"}), 404

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return jsonify({"error": "Failed to read product metadata"}), 500

    return jsonify(meta), 200


@products_bp.route("/api/products/<product_id>", methods=["PUT"])
def update_product(product_id: str):
    """Update mutable product metadata fields."""
    if _storage_error:
        return jsonify({"error": "Products storage unavailable"}), 500

    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    product_dir = PRODUCTS_DIR / safe_id
    if not product_dir.is_dir():
        return jsonify({"error": "Product not found"}), 404

    meta_path = product_dir / "meta.json"
    if not meta_path.exists():
        return jsonify({"error": "Product not found"}), 404

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return jsonify({"error": "Failed to read product metadata"}), 500

    data = request.get_json(silent=True) or {}

    cleaned, err = _validate_product_fields(data, require_all=False)
    if err is not None:
        return err

    # Mutable fields only (id and slug are immutable)
    for field in ("name", "owner", "ownerEmail", "env", "subscriptionIds"):
        if field in cleaned:
            meta[field] = cleaned[field]

    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    return jsonify(meta), 200


@products_bp.route("/api/products/<product_id>", methods=["DELETE"])
def delete_product(product_id: str):
    """Delete a product directory and all its contents."""
    if _storage_error:
        return jsonify({"error": "Products storage unavailable"}), 500

    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    product_dir = PRODUCTS_DIR / safe_id
    if not product_dir.is_dir():
        return jsonify({"error": "Product not found"}), 404

    shutil.rmtree(product_dir)
    return jsonify({"deleted": True, "id": safe_id}), 200


# ---------------------------------------------------------------------------
# Version helpers
# ---------------------------------------------------------------------------


def _next_version(product_dir: Path, requested_type: str) -> str:
    """Compute the next version string for a save request.

    Rules (per requirements 4.1 – 4.4):
    - No existing versions → "1.0"
    - Latest is a draft   → return same version string (overwrite)
    - Latest is published + major → (M+1).0
    - Latest is published + minor → M.(m+1), rolls to (M+1).0 if m+1 >= 10
    """
    latest_ver_str, _ = _scan_latest_version(product_dir)

    if latest_ver_str is None:
        return "1.0"

    ver_file = product_dir / f"v{latest_ver_str}.json"
    try:
        data = json.loads(ver_file.read_text(encoding="utf-8"))
    except Exception:
        return "1.0"

    if data.get("status") == "draft":
        return latest_ver_str  # overwrite same version

    # Latest is published — compute increment
    parts = latest_ver_str.split(".")
    try:
        major, minor = int(parts[0]), int(parts[1])
    except (ValueError, IndexError):
        return "1.0"

    if requested_type == "major":
        return f"{major + 1}.0"
    else:  # minor
        if minor + 1 >= 10:
            return f"{major + 1}.0"
        return f"{major}.{minor + 1}"


# ---------------------------------------------------------------------------
# Version endpoints
# ---------------------------------------------------------------------------


@products_bp.route("/api/products/<product_id>/versions", methods=["GET"])
def list_versions(product_id: str):
    """Return all versions for a product, sorted by savedAt descending."""
    if _storage_error:
        return jsonify({"error": "Products storage unavailable"}), 500

    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    product_dir = PRODUCTS_DIR / safe_id
    if not product_dir.is_dir():
        return jsonify({"error": "Product not found"}), 404

    versions = []
    for vf in product_dir.glob("v*.*.json"):
        try:
            data = json.loads(vf.read_text(encoding="utf-8"))
        except Exception:
            continue
        versions.append({
            "version": data.get("version"),
            "reportVersion": data.get("reportVersion"),
            "versionNotes": data.get("versionNotes"),
            "versionType": data.get("versionType"),
            "status": data.get("status"),
            "savedAt": data.get("savedAt"),
            "publishedAt": data.get("publishedAt"),
            "riskScore": data.get("riskScore"),
        })

    versions.sort(key=lambda v: v.get("savedAt") or "", reverse=True)
    return jsonify(versions), 200


@products_bp.route("/api/products/<product_id>/versions", methods=["POST"])
def save_version(product_id: str):
    """Save the current editor snapshot as a new (or overwritten draft) version."""
    if _storage_error:
        return jsonify({"error": "Products storage unavailable"}), 500

    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    product_dir = PRODUCTS_DIR / safe_id
    if not product_dir.is_dir():
        return jsonify({"error": "Product not found"}), 404

    # Enforce 50 MB body limit
    content_length = request.content_length
    if content_length is not None and content_length > 50 * 1024 * 1024:
        return jsonify({"error": "Snapshot too large"}), 413

    data = request.get_json(silent=True) or {}

    # Validate required fields
    for field in ("type", "notes", "snapshot"):
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400

    version_type = data["type"]
    if version_type not in ("major", "minor"):
        return jsonify({"error": "type: must be 'major' or 'minor'"}), 400

    notes = data["notes"]
    snapshot = data["snapshot"]

    if not isinstance(snapshot, dict):
        return jsonify({"error": "snapshot: must be an object"}), 400

    # Traversal check on notes
    if isinstance(notes, str) and _contains_traversal(notes):
        return jsonify({"error": "Invalid field value: notes"}), 400

    # Check snapshot body size after parsing (belt-and-suspenders)
    raw_body = request.get_data()
    if len(raw_body) > 50 * 1024 * 1024:
        return jsonify({"error": "Snapshot too large"}), 413

    version_str = _next_version(product_dir, version_type)

    risk_score = _compute_risk_score(snapshot)
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    # Determine reportVersion from snapshot meta if present
    report_version = "1.0"
    if isinstance(snapshot.get("meta"), dict):
        report_version = str(snapshot["meta"].get("reportVersion", "1.0"))

    version_data = {
        "version": version_str,
        "reportVersion": report_version,
        "versionNotes": notes,
        "versionType": version_type,
        "status": "draft",
        "savedAt": now,
        "publishedAt": None,
        "riskScore": risk_score,
        **snapshot,
    }

    ver_file = product_dir / f"v{version_str}.json"
    ver_file.write_text(json.dumps(version_data, ensure_ascii=False), encoding="utf-8")

    # Update meta.json
    meta_path = product_dir / "meta.json"
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        meta = {}
    meta["latestVersion"] = version_str
    meta["latestRiskScore"] = risk_score
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    return jsonify({
        "version": version_str,
        "reportVersion": report_version,
        "versionNotes": notes,
        "versionType": version_type,
        "status": "draft",
        "savedAt": now,
        "publishedAt": None,
        "riskScore": risk_score,
    }), 201


@products_bp.route("/api/products/<product_id>/versions/<ver>", methods=["GET"])
def get_version(product_id: str, ver: str):
    """Return the full version file for a specific version."""
    if _storage_error:
        return jsonify({"error": "Products storage unavailable"}), 500

    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not _valid_version_str(ver):
        return jsonify({"error": "Invalid version format"}), 400

    product_dir = PRODUCTS_DIR / safe_id
    if not product_dir.is_dir():
        return jsonify({"error": "Product not found"}), 404

    ver_file = product_dir / f"v{ver}.json"
    if not ver_file.exists():
        return jsonify({"error": "Version not found"}), 404

    try:
        data = json.loads(ver_file.read_text(encoding="utf-8"))
    except Exception:
        return jsonify({"error": "Failed to read version"}), 500

    return jsonify(data), 200


@products_bp.route("/api/products/<product_id>/versions/<ver>", methods=["DELETE"])
def delete_version(product_id: str, ver: str):
    """Delete a draft version. Published versions cannot be deleted."""
    if _storage_error:
        return jsonify({"error": "Products storage unavailable"}), 500

    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not _valid_version_str(ver):
        return jsonify({"error": "Invalid version format"}), 400

    product_dir = PRODUCTS_DIR / safe_id
    if not product_dir.is_dir():
        return jsonify({"error": "Product not found"}), 404

    ver_file = product_dir / f"v{ver}.json"
    if not ver_file.exists():
        return jsonify({"error": "Version not found"}), 404

    try:
        data = json.loads(ver_file.read_text(encoding="utf-8"))
    except Exception:
        return jsonify({"error": "Failed to read version"}), 500

    if data.get("status") == "published":
        return jsonify({"error": "Cannot delete a published version"}), 409

    deleted_meta = {
        "version": data.get("version"),
        "reportVersion": data.get("reportVersion"),
        "versionNotes": data.get("versionNotes"),
        "versionType": data.get("versionType"),
        "status": data.get("status"),
        "savedAt": data.get("savedAt"),
        "publishedAt": data.get("publishedAt"),
        "riskScore": data.get("riskScore"),
    }

    ver_file.unlink()

    # Update meta.json to reflect the new latest (or null if none remain)
    meta_path = product_dir / "meta.json"
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        meta = {}

    new_latest_ver, new_latest_risk = _scan_latest_version(product_dir)
    meta["latestVersion"] = new_latest_ver
    meta["latestRiskScore"] = new_latest_risk if new_latest_ver is not None else None
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    return jsonify(deleted_meta), 200


@products_bp.route("/api/products/<product_id>/versions/<ver>/publish", methods=["POST"])
def publish_version(product_id: str, ver: str):
    """Publish a draft version, making it immutable."""
    if _storage_error:
        return jsonify({"error": "Products storage unavailable"}), 500

    safe_id = _safe_param(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not _valid_version_str(ver):
        return jsonify({"error": "Invalid version format"}), 400

    product_dir = PRODUCTS_DIR / safe_id
    if not product_dir.is_dir():
        return jsonify({"error": "Product not found"}), 404

    ver_file = product_dir / f"v{ver}.json"
    if not ver_file.exists():
        return jsonify({"error": "Version not found"}), 404

    try:
        data = json.loads(ver_file.read_text(encoding="utf-8"))
    except Exception:
        return jsonify({"error": "Failed to read version"}), 500

    if data.get("status") == "published":
        return jsonify({"error": "Version already published"}), 409

    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    data["status"] = "published"
    data["publishedAt"] = now

    ver_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    return jsonify({
        "version": data.get("version"),
        "reportVersion": data.get("reportVersion"),
        "versionNotes": data.get("versionNotes"),
        "versionType": data.get("versionType"),
        "status": "published",
        "savedAt": data.get("savedAt"),
        "publishedAt": now,
        "riskScore": data.get("riskScore"),
    }), 200
