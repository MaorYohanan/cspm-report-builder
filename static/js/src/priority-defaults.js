// ═══════════════════════════════════════════
// BL-39: the ONE severity -> treatment-priority map (pure, no DOM, no imports).
// Backend mirror: backend/services/priority_defaults.py (parity test: tests/test_bl39_priority_defaults.py).
// 'info' (and unknown severities) intentionally have no default: priority stays empty.
// The values must equal the option values of #f-priority-select in index.html.
// ═══════════════════════════════════════════
export const SEVERITY_PRIORITY_MAP = Object.freeze({
  critical: 'מיידי (0–7 ימים)',
  high: 'גבוהה (עד 30 ימים)',
  medium: 'בינונית (30–60 ימים)',
  low: 'נמוכה (60–120 ימים)'
});

function normSeverity(sev) {
  return typeof sev === 'string' ? sev.trim().toLowerCase() : '';
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Default priority text for a severity, or '' when the severity has none. */
export function defaultPriorityForSeverity(sev) {
  var key = normSeverity(sev);
  return hasOwn(SEVERITY_PRIORITY_MAP, key) ? SEVERITY_PRIORITY_MAP[key] : '';
}

/** A priority counts as set when it is a non-blank string (custom free text is a valid priority). */
export function hasPriority(priority) {
  return typeof priority === 'string' && priority.trim() !== '';
}

/**
 * Fill a missing priority from the finding's severity. Never overwrites a set priority.
 * Mutates and returns the finding (null-safe).
 */
export function applyPriorityDefault(finding) {
  if (!finding || typeof finding !== 'object') return finding;
  if (!hasPriority(finding.priority)) {
    finding.priority = defaultPriorityForSeverity(finding.severity);
  }
  return finding;
}

/** applyPriorityDefault over a list; returns how many findings received a default. */
export function fillPriorityDefaults(findings) {
  var n = 0;
  (findings || []).forEach(function(f) {
    if (!f || typeof f !== 'object') return;
    var before = f.priority;
    applyPriorityDefault(f);
    if (f.priority !== before && hasPriority(f.priority)) n++;
  });
  return n;
}

/**
 * Batch severity edit (BL-09): after finding.severity changed from oldSev to its new value,
 * let the priority follow ONLY if it is empty or still equals the OLD severity's default.
 * A manually set different priority (or a custom text) is never overwritten.
 * Returns true when the priority was changed.
 */
export function followSeverityChange(finding, oldSev) {
  if (!finding || typeof finding !== 'object') return false;
  var current = hasPriority(finding.priority) ? finding.priority : '';
  var oldDefault = defaultPriorityForSeverity(oldSev);
  if (current !== '' && current !== oldDefault) return false;
  var next = defaultPriorityForSeverity(finding.severity);
  if (next === current) return false;
  // New severity has no default (info): clear a priority that was only the old default.
  finding.priority = next;
  return true;
}
