// ═══════════════════════════════════════════
// New-finding tracking for Wiz imports (BL-39 follow-up)
// Imports must find "the findings this import created" without positional slicing: the SECR
// duplicate-merge splices elements out of state.findings during an import, so
// findings.slice(beforeCount) can skip the first k new findings. Tracking object identity is
// immune to removals and reordering; merged/updated existing findings are in the snapshot, so
// they are never treated as new.
// ═══════════════════════════════════════════

/** Snapshot the finding objects that exist before an import starts. */
export function snapshotFindings(findings) {
  var set = new Set();
  (findings || []).forEach(function(f) { if (f && typeof f === 'object') set.add(f); });
  return set;
}

/** Findings currently in the list that were not part of the snapshot (in list order). */
export function newFindingsSince(snapshot, findings) {
  return (findings || []).filter(function(f) { return f && typeof f === 'object' && !snapshot.has(f); });
}
