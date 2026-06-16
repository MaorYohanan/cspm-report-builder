"""
Reports Blueprint - PDF rendering and HTML upload routes.

Routes:
  POST /api/render-pdf       → accepts JSON state, returns PDF
  POST /api/upload-html      → upload an HTML report file
"""

from __future__ import annotations

import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from backend.services.pdf_service import PDFService

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


@reports_bp.route("/api/render-pdf", methods=["POST"])
def api_render_pdf():
    """
    Accept JSON body with { html: "<full report html>", meta: {...} }
    Return the rendered PDF file.
    """
    data = request.get_json(force=True)
    html_content = data.get("html", "")
    meta = data.get("meta", {})

    if not html_content:
        return jsonify({"error": "Missing 'html' field"}), 400

    try:
        pdf_bytes = pdf_service.render_pdf(html_content, meta)
    except Exception as e:
        return jsonify({"error": f"PDF rendering failed: {e}"}), 500

    # Also save to output/
    out_name = f"cspm_report_{uuid.uuid4().hex[:8]}.pdf"
    out_path = OUTPUT_DIR / out_name
    out_path.write_bytes(pdf_bytes)

    return send_file(
        out_path,
        mimetype="application/pdf",
        as_attachment=True,
        download_name="cspm_report.pdf",
    )


@reports_bp.route("/api/upload-html", methods=["POST"])
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
