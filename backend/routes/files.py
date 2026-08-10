from __future__ import annotations

import json
import logging
import os
import re
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from backend.services.auth_service import require_role

_log = logging.getLogger(__name__)

# State IDs are uuid4().hex[:12] — exactly 12 lowercase hex chars
_STATE_ID_RE = re.compile(r"^[0-9a-f]{12}$")

files_bp = Blueprint('files', __name__)

# Import BASE_DIR, STATES_DIR, OUTPUT_DIR from app
# These will be set by app.py after import
BASE_DIR = None
STATES_DIR = None
OUTPUT_DIR = None


def init_directories(base_dir: Path, states_dir: Path, output_dir: Path):
    """Initialize directory paths from app.py"""
    global BASE_DIR, STATES_DIR, OUTPUT_DIR
    BASE_DIR = base_dir
    STATES_DIR = states_dir
    OUTPUT_DIR = output_dir


def _safe_filename(name: str) -> str:
    """Strip path separators to prevent directory traversal."""
    return Path(name).name


@files_bp.route("/api/upload-state", methods=["POST"])
@require_role("editor")
def api_upload_state():
    """Upload a JSON state file. Accepts multipart file or raw JSON body."""
    if "file" in request.files:
        f = request.files["file"]
        content = f.read().decode("utf-8")
    else:
        content = request.get_data(as_text=True)

    # Validate JSON
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON"}), 400

    state_id = uuid.uuid4().hex[:12]
    filename = f"state_{state_id}.json"
    final_path = STATES_DIR / filename
    tmp_path = STATES_DIR / f".tmp_{state_id}.json"
    tmp_path.write_text(
        json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(tmp_path, final_path)

    return jsonify({"id": state_id, "filename": filename}), 201


@files_bp.route("/api/download-state/<state_id>")
@require_role("viewer")
def api_download_state(state_id: str):
    """Download a previously uploaded state file."""
    if not _STATE_ID_RE.match(state_id):
        return jsonify({"error": "State not found"}), 404
    filename = f"state_{state_id}.json"
    path = STATES_DIR / filename
    if not path.exists():
        return jsonify({"error": "State not found"}), 404
    return send_file(path, mimetype="application/json", as_attachment=True,
                     download_name="cspm_report_state.json")


@files_bp.route("/api/list-states")
@require_role("viewer")
def api_list_states():
    """List all uploaded state files."""
    states = []
    for f in sorted(STATES_DIR.glob("state_*.json")):
        corrupted = False
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            meta = data.get("meta", {})
        except Exception as exc:
            _log.warning("Could not read state file %s: %s", f.name, exc)
            meta = {}
            corrupted = True
        states.append({
            "id": f.stem.replace("state_", ""),
            "filename": f.name,
            "client": meta.get("client", ""),
            "reportDate": meta.get("reportDate", ""),
            "size": f.stat().st_size,
            "corrupted": corrupted,
        })
    return jsonify(states)


@files_bp.route("/api/delete-state/<state_id>", methods=["DELETE"])
@require_role("editor")
def api_delete_state(state_id: str):
    """Delete a state file."""
    if not _STATE_ID_RE.match(state_id):
        return jsonify({"error": "State not found"}), 404
    path = STATES_DIR / f"state_{state_id}.json"
    if not path.exists():
        return jsonify({"error": "State not found"}), 404
    path.unlink()
    return jsonify({"deleted": True})


@files_bp.route("/api/download-output/<filename>")
@require_role("viewer")
def api_download_output(filename: str):
    """Download a file from the output directory."""
    safe = _safe_filename(filename)
    path = OUTPUT_DIR / safe
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    return send_file(path, as_attachment=True, download_name=safe)


@files_bp.route("/api/list-outputs")
@require_role("viewer")
def api_list_outputs():
    """List files in the output directory with optional pagination.

    Query params:
      page      — 1-based page number (default: 1)
      page_size — items per page (default: 100, max: 200)
    """
    try:
        page = max(1, int(request.args.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = max(1, min(200, int(request.args.get("page_size", 100))))
    except (TypeError, ValueError):
        page_size = 100

    all_files = []
    for f in sorted(OUTPUT_DIR.iterdir()):
        if f.is_file():
            all_files.append({
                "filename": f.name,
                "size": f.stat().st_size,
                "type": f.suffix.lstrip("."),
            })

    total = len(all_files)
    start = (page - 1) * page_size
    page_files = all_files[start:start + page_size]

    return jsonify({
        "files": page_files,
        "total": total,
        "page": page,
        "page_size": page_size,
    })


@files_bp.route("/api/delete-output/<filename>", methods=["DELETE"])
@require_role("editor")
def api_delete_output(filename: str):
    """Delete an output file."""
    safe = _safe_filename(filename)
    path = OUTPUT_DIR / safe
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    path.unlink()
    return jsonify({"deleted": True})
