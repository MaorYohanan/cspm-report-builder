"""Shared utility functions for CSPM Report Builder backend routes."""

from __future__ import annotations

_SEVERITY_WEIGHTS: dict[str, int] = {
    "critical": 4,
    "high": 3,
    "medium": 2,
    "low": 1,
}


def is_acknowledged(finding) -> bool:
    """BL-23: True when the finding carries an active exception of kind 'acknowledge'.

    Acknowledged findings are hidden entirely from customer-facing output.
    kind absent / 'exclude' is the legacy exception (kept in the PDF with a banner).
    """
    if not isinstance(finding, dict):
        return False
    exc = finding.get("exception")
    return bool(isinstance(exc, dict) and exc.get("active") and exc.get("kind") == "acknowledge")


def drop_acknowledged_findings(findings) -> list:
    """Return a new list without acknowledged findings (never mutates the input)."""
    return [f for f in (findings or []) if not is_acknowledged(f)]


def compute_risk_score(snapshot: dict) -> int:
    """Compute ``Critical×4 + High×3 + Medium×2 + Low×1``.

    Findings with an active exception are skipped, whatever its kind: legacy
    'exclude' exceptions (kept in the PDF with a banner) and BL-23
    'acknowledge' exceptions (hidden from the PDF) both score zero.
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
