"""Unit tests for pipeline helper functions (DEV-M-13, DEV-M-14).

Tests _pipeline_status and _aggregate_vulns directly without a DB or Wiz
credentials. No network access is required.

Run with:
    python -m pytest tests/test_pipeline_logic.py -v
"""
from __future__ import annotations

import calendar
from datetime import UTC, datetime, timedelta

import pytest

from backend.routes.pipeline import _aggregate_vulns, _pipeline_status


# ---------------------------------------------------------------------------
# _pipeline_status — exact-boundary date (DEV-M-14)
# ---------------------------------------------------------------------------


class TestPipelineStatusBoundary:
    """Verify the exact-boundary behaviour of _pipeline_status."""

    def test_due_today_is_due_this_month(self):
        """When next_due is exactly today (same date), status should be
        'due_this_month', not 'overdue'.
        The fix uses .date() comparison so the hour/minute of today's datetime
        does not accidentally push next_due < today when they share the same date.
        """
        today = datetime.now(UTC)
        # Compute published_at as the month-arithmetic inverse of _add_months(published_at, 1).
        # _add_months(dt, 1) advances by one calendar month and clamps day to the
        # target month's last day.  To guarantee next_due.date() == today.date() on
        # any calendar date (including 29th/30th/31st), we go one month back and
        # clamp today's day to the prior month's actual length — mirroring the
        # same clamping that _add_months applies on the forward pass.
        prev_month = today.month - 1 if today.month > 1 else 12
        prev_year = today.year if today.month > 1 else today.year - 1
        prev_day = min(today.day, calendar.monthrange(prev_year, prev_month)[1])
        one_month_ago = today.replace(year=prev_year, month=prev_month, day=prev_day)
        status, next_due = _pipeline_status(one_month_ago, "monthly")
        # next_due may be a few seconds before 'today' in wall time if the test
        # runs near midnight, but .date() should be equal → due_this_month.
        assert status == "due_this_month", (
            f"Expected 'due_this_month', got {status!r}. next_due={next_due}, today={today}"
        )

    def test_next_due_in_future_is_upcoming(self):
        """next_due more than 30 days away → 'upcoming'."""
        # published_at = 1 day ago, frequency = annual → next_due ~364 days from now
        published_at = datetime.now(UTC) - timedelta(days=1)
        status, next_due = _pipeline_status(published_at, "annual")
        assert status == "upcoming"

    def test_next_due_in_past_is_overdue(self):
        """next_due strictly before today → 'overdue'."""
        # published_at = 100 days ago, monthly → next_due 70 days ago
        published_at = datetime.now(UTC) - timedelta(days=100)
        status, next_due = _pipeline_status(published_at, "monthly")
        assert status == "overdue"

    def test_no_published_at_is_no_scans(self):
        """None published_at → 'no_scans'."""
        status, next_due = _pipeline_status(None, "quarterly")
        assert status == "no_scans"
        assert next_due is None

    def test_next_due_within_30_days_is_due_this_month(self):
        """next_due within the next 30 days → 'due_this_month'."""
        # published_at = quarterly - 80 days ago → next_due 10 days from now
        published_at = datetime.now(UTC) - timedelta(days=80)
        status, next_due = _pipeline_status(published_at, "quarterly")
        assert status == "due_this_month"


# ---------------------------------------------------------------------------
# _aggregate_vulns — highest_sev initialisation (DEV-M-13)
# ---------------------------------------------------------------------------


class TestAggregateVulns:
    """Verify that _aggregate_vulns returns the correct severity."""

    def test_all_low_severity_returns_low(self):
        """When every vuln node is LOW, the aggregated finding must report 'low',
        not the previously hard-coded 'high' default.
        """
        nodes = [
            {"severity": "LOW", "vulnerableAsset": {"name": "asset-1"}, "_sourceSubscription": "sub-a"},
            {"severity": "LOW", "vulnerableAsset": {"name": "asset-2"}, "_sourceSubscription": "sub-a"},
            {"severity": "LOW", "vulnerableAsset": {"name": "asset-3"}, "_sourceSubscription": "sub-b"},
        ]
        result = _aggregate_vulns(nodes)
        assert result["severity"] == "low", (
            f"Expected severity='low' for all-LOW nodes, got {result['severity']!r}"
        )

    def test_mixed_critical_and_high_returns_critical(self):
        """CRITICAL finding in the list → aggregated severity must be 'critical'."""
        nodes = [
            {"severity": "CRITICAL", "vulnerableAsset": {"name": "res-1"}, "_sourceSubscription": "sub-a"},
            {"severity": "HIGH", "vulnerableAsset": {"name": "res-2"}, "_sourceSubscription": "sub-a"},
            {"severity": "HIGH", "vulnerableAsset": {"name": "res-3"}, "_sourceSubscription": "sub-b"},
        ]
        result = _aggregate_vulns(nodes)
        assert result["severity"] == "critical"

    def test_only_high_returns_high(self):
        """Only HIGH severity nodes → aggregated severity should be 'high'."""
        nodes = [
            {"severity": "HIGH", "vulnerableAsset": {"name": "r"}, "_sourceSubscription": "s"},
        ]
        result = _aggregate_vulns(nodes)
        assert result["severity"] == "high"

    def test_total_count_in_technical(self):
        """The 'Total Vulnerabilities' count in technical matches node count."""
        nodes = [
            {"severity": "LOW", "vulnerableAsset": {}, "_sourceSubscription": "s"},
            {"severity": "LOW", "vulnerableAsset": {}, "_sourceSubscription": "s"},
        ]
        result = _aggregate_vulns(nodes)
        total_line = next(
            (t for t in result["technical"] if t.startswith("Total Vulnerabilities:")), None
        )
        assert total_line is not None
        assert "2" in total_line

    def test_empty_nodes_returns_low_severity(self):
        """Empty list → highest_sev should stay at the initialized 'low', not 'high'."""
        result = _aggregate_vulns([])
        assert result["severity"] == "low"
