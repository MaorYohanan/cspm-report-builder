// Pure regression-chapter helpers (no DOM, no imports) so they can be unit-tested in Node.

/**
 * Detect zombie findings: findings that were previously excepted in the
 * baseline snapshot and now reappear as active (non-excepted) in the current
 * snapshot. Matching is done by normalised title (lowercase, trimmed).
 *
 * Baseline findings excepted via a temporary exception
 * (exception.source === 'temp_excepted') are NOT zombies: their reappearance
 * is the expected outcome of "review next cycle".
 *
 * Does NOT mutate either array.
 *
 * @param {Array} baselineFindings - Findings from the prior published snapshot.
 * @param {Array} currFindings     - Findings from the current snapshot.
 * @returns {Array} zombie finding objects with an extra `prevStatus` field.
 */
export function detectZombies(baselineFindings, currFindings) {
  var prevExceptedTitles = {};
  (baselineFindings || []).forEach(function(f) {
    if (!f || typeof f !== 'object') return;
    var normTitle = String(f.title || '').trim().toLowerCase();
    if (!normTitle) return;
    if (f.exception && f.exception.active) {
      if (f.exception.source === 'temp_excepted') return;
      prevExceptedTitles[normTitle] = 'הוחרג';
    }
  });

  var zombies = [];
  (currFindings || []).forEach(function(f) {
    if (!f || typeof f !== 'object') return;
    var normTitle = String(f.title || '').trim().toLowerCase();
    var currExcepted = f.exception && f.exception.active;
    if (currExcepted) return;
    if (prevExceptedTitles[normTitle]) {
      zombies.push(Object.assign({}, f, { prevStatus: prevExceptedTitles[normTitle] }));
    }
  });

  return zombies;
}
