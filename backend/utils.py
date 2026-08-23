"""Shared utility functions for CSPM Report Builder backend routes."""

from __future__ import annotations

_SEVERITY_WEIGHTS: dict[str, int] = {
    "critical": 4,
    "high": 3,
    "medium": 2,
    "low": 1,
}


def compute_risk_score(snapshot: dict) -> int:
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
