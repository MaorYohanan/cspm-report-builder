"""
Reports Blueprint - PDF rendering and HTML upload routes.

Routes:
  POST /api/render-pdf       → accepts JSON state, returns PDF
  POST /api/upload-html      → upload an HTML report file
"""

from __future__ import annotations

import logging
import re
import unicodedata
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from backend.services.pdf_service import PDFService
from backend.services.auth_service import require_role

_log = logging.getLogger(__name__)
reports_bp = Blueprint('reports', __name__)

# Initialize PDF service
pdf_service = PDFService()

# Directories
BASE_DIR = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def _safe_filename(name: str) -> str:
    """Strip path separators to prevent directory traversal."""
    return Path(name).name


def _build_pdf_filename(meta: dict) -> str:
    """Build a descriptive PDF download filename from report metadata."""

    def slug(s: str) -> str:
        s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
        s = re.sub(r'[^\w\s.\-]', '', s)
        s = re.sub(r'[\s_]+', '-', s).strip('-')
        return s

    client = slug(meta.get("client", "") or "")
    cloud = slug(meta.get("cloud", "") or "")
    env_raw = meta.get("env", "") or ""
    env_slug = "-".join(slug(v.strip()) for v in env_raw.split(",") if v.strip()) if env_raw else ""

    # report date: expected DD/MM/YYYY → convert to YYYY-MM-DD
    raw_date = meta.get("reportDate", "") or ""
    date_slug = ""
    try:
        parts = raw_date.strip().split("/")
        if len(parts) == 3:
            date_slug = f"{parts[2]}-{parts[1]}-{parts[0]}"
    except Exception:
        pass

    parts_list = [p for p in [client, cloud, env_slug, date_slug] if p]
    name = "-".join(parts_list) or "cspm_report"
    name = name[:60].rstrip('-')  # max 60 chars; strip any trailing hyphen from truncation
    return f"{name}.pdf"


@reports_bp.route("/api/render-pdf", methods=["POST"])
@require_role("editor")
def api_render_pdf():
    """
    Accept JSON body with { html: "<full report html>", meta: {...} }
    Return the rendered PDF file.
    """
    data = request.get_json(force=True, silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400
    html_content = data.get("html", "")
    meta = data.get("meta", {})

    if not html_content:
        return jsonify({"error": "Missing 'html' field"}), 400
    if len(html_content) > 20 * 1024 * 1024:
        return jsonify({"error": "HTML content too large (max 20 MB)"}), 413

    # Optional query params for timeline export — validate and log for auditing.
    # The cover-page version override is handled on the frontend before the HTML
    # is submitted, so these params serve as audit metadata only.
    product_id = request.args.get("productId")
    ver = request.args.get("ver")
    if product_id or ver:
        if not product_id or not ver:
            return jsonify({"error": "Both productId and ver are required together"}), 400
        if len(product_id) > 200 or len(ver) > 20:
            return jsonify({"error": "invalid productId or ver"}), 400
        if not re.fullmatch(r'[\w.\-]+', product_id):
            return jsonify({"error": "invalid productId"}), 400
        if not re.fullmatch(r'[\d.]+', ver):
            return jsonify({"error": "invalid ver"}), 400
        _log.info("render-pdf: timeline export productId=%s ver=%s", product_id, ver)

    try:
        pdf_bytes = pdf_service.render_pdf(html_content, meta)
    except Exception as e:
        _log.error("PDF rendering failed: %s", e, exc_info=True)
        return jsonify({"error": f"PDF rendering failed: {e}"}), 500

    # Also save to output/
    out_name = f"cspm_report_{uuid.uuid4().hex[:8]}.pdf"
    out_path = OUTPUT_DIR / out_name
    out_path.write_bytes(pdf_bytes)

    filename = _build_pdf_filename(meta)
    return send_file(
        out_path,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )


@reports_bp.route("/api/upload-html", methods=["POST"])
@require_role("editor")
def api_upload_html():
    """Upload an HTML report to the output folder."""
    if "file" in request.files:
        f = request.files["file"]
        content = f.read()
        original_name = _safe_filename(f.filename or "report.html")
        if Path(original_name).suffix.lower() != ".html":
            return jsonify({"error": "Only .html files are accepted"}), 400
    else:
        content = request.get_data()
        original_name = "report.html"

    stem = Path(original_name).stem
    out_name = f"{stem}_{uuid.uuid4().hex[:8]}.html"
    out_path = OUTPUT_DIR / out_name
    out_path.write_bytes(content)

    return jsonify({"filename": out_name}), 201
