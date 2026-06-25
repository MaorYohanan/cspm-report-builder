from __future__ import annotations

import calendar
from datetime import UTC, datetime

from flask import Blueprint, jsonify

from backend.models import Product, ReportSnapshot
from backend.services.auth_service import require_role

pipeline_bp = Blueprint("pipeline", __name__)

_FREQ_MONTHS = {
    "monthly": 1,
    "quarterly": 3,
    "annual": 12,
}

_STATUS_ORDER = {"overdue": 0, "due_this_month": 1, "upcoming": 2, "no_scans": 3}


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
            "lastPublishedAt": published_iso,
            "lastPublishedVersion": snap.version if snap else None,
            "nextDueAt": next_due,
            "status": status,
        })

    rows.sort(key=lambda r: (_STATUS_ORDER.get(r["status"], 9), r["name"]))
    return jsonify(rows), 200
