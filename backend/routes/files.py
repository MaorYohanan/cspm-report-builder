from __future__ import annotations

import json
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

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
    (STATES_DIR / filename).write_text(
        json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return jsonify({"id": state_id, "filename": filename}), 201


@files_bp.route("/api/download-state/<state_id>")
def api_download_state(state_id: str):
    """Download a previously uploaded state file."""
    safe_id = _safe_filename(state_id)
    filename = f"state_{safe_id}.json"
    path = STATES_DIR / filename
    if not path.exists():
        return jsonify({"error": "State not found"}), 404
    return send_file(path, mimetype="application/json", as_attachment=True,
                     download_name="cspm_report_state.json")


@files_bp.route("/api/list-states")
def api_list_states():
    """List all uploaded state files."""
    states = []
    for f in sorted(STATES_DIR.glob("state_*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            meta = data.get("meta", {})
        except Exception:
            meta = {}
        states.append({
            "id": f.stem.replace("state_", ""),
            "filename": f.name,
            "client": meta.get("client", ""),
            "reportDate": meta.get("reportDate", ""),
            "size": f.stat().st_size,
        })
    return jsonify(states)


@files_bp.route("/api/delete-state/<state_id>", methods=["DELETE"])
def api_delete_state(state_id: str):
    """Delete a state file."""
    safe_id = _safe_filename(state_id)
    path = STATES_DIR / f"state_{safe_id}.json"
    if not path.exists():
        return jsonify({"error": "State not found"}), 404
    path.unlink()
    return jsonify({"deleted": True})


@files_bp.route("/api/download-output/<filename>")
def api_download_output(filename: str):
    """Download a file from the output directory."""
    safe = _safe_filename(filename)
    path = OUTPUT_DIR / safe
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    return send_file(path, as_attachment=True, download_name=safe)


@files_bp.route("/api/list-outputs")
def api_list_outputs():
    """List all files in the output directory."""
    files = []
    for f in sorted(OUTPUT_DIR.iterdir()):
        if f.is_file():
            files.append({
                "filename": f.name,
                "size": f.stat().st_size,
                "type": f.suffix.lstrip("."),
            })
    return jsonify(files)


@files_bp.route("/api/delete-output/<filename>", methods=["DELETE"])
def api_delete_output(filename: str):
    """Delete an output file."""
    safe = _safe_filename(filename)
    path = OUTPUT_DIR / safe
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    path.unlink()
    return jsonify({"deleted": True})
