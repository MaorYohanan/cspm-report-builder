// Pure helper (no DOM, no imports) — strips internal temp-action bookkeeping
// from findings before they leave the browser in a ZIP / interactive-HTML export.
// Works on COPIES; never mutates the input array or its findings.
//
// NOT used for autosave, saved versions, applySnapshot or the JSON round-trip
// export, which must keep these fields.

/**
 * @param {Array} findings
 * @returns {Array} new array of shallow-copied findings without internal fields
 */
export function stripInternalExportFields(findings) {
  return (findings || []).map(function(f) {
    if (!f || typeof f !== 'object') return f;
    var copy = Object.assign({}, f);
    delete copy._wasTempActioned;
    delete copy._tempActionReason;
    delete copy._sourceSubscription;
    if (copy.exception && typeof copy.exception === 'object') {
      var exc = Object.assign({}, copy.exception);
      if (exc.source === 'temp_excepted') delete exc.source;
      copy.exception = exc;
    }
    return copy;
  });
}

/**
 * BL-23: drop findings dismissed with exception.kind === 'acknowledge'. Customer-facing
 * artifacts (PDF, interactive HTML, ZIP findings JSON) omit them; the internal
 * JSON snapshot and CSV keep them. Returns a new array; never mutates the input.
 *
 * @param {Array} findings
 * @returns {Array}
 */
export function omitAcknowledgedFindings(findings) {
  return (findings || []).filter(function(f) {
    return !(f && f.exception && f.exception.active && f.exception.kind === 'acknowledge');
  });
}
