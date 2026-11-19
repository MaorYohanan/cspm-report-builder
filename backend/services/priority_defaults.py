"""BL-39: severity -> treatment-priority defaults (backend mirror).

Mirror of ``static/js/src/priority-defaults.js``; a parity test
(tests/test_bl39_priority_defaults.py) fails if the two maps drift apart.
``info`` and unknown severities have no default (priority stays empty).
"""
from __future__ import annotations

SEVERITY_PRIORITY_MAP: dict[str, str] = {
    "critical": "מיידי (0–7 ימים)",
    "high": "גבוהה (עד 30 ימים)",
    "medium": "בינונית (30–60 ימים)",
    "low": "נמוכה (60–120 ימים)",
}


def default_priority_for_severity(severity) -> str:
    """Default priority text for a severity, or '' when it has none."""
    if not isinstance(severity, str):
        return ""
    return SEVERITY_PRIORITY_MAP.get(severity.strip().lower(), "")
