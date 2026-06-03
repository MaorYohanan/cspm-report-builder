// tests/frontend/__tests__/products.test.js
//
// Tests for pure helper functions from static/js/src/products.js.
// The functions are duplicated here for isolated testing (they live inside
// a concatenated IIFE in builder.js and are not importable as a module).

// ---------------------------------------------------------------------------
// Inline copies of the pure functions under test
// (kept in sync with static/js/src/products.js)
// ---------------------------------------------------------------------------

function computeDiff(baseline, target) {
  // Returns { added, resolved, changed, unchanged }
  var baseById = {};
  (baseline || []).forEach(function(f) { if (f && f.id) baseById[f.id] = f; });
  var targetById = {};
  (target || []).forEach(function(f) { if (f && f.id) targetById[f.id] = f; });

  var added = [], resolved = [], changed = [], unchanged = [];

  Object.keys(targetById).forEach(function(id) {
    if (!baseById[id]) {
      added.push(targetById[id]);
    } else if ((baseById[id].severity || '').toLowerCase() !== (targetById[id].severity || '').toLowerCase()) {
      changed.push({ before: baseById[id], after: targetById[id] });
    } else {
      unchanged.push(targetById[id]);
    }
  });

  Object.keys(baseById).forEach(function(id) {
    if (!targetById[id]) resolved.push(baseById[id]);
  });

  return { added: added, resolved: resolved, changed: changed, unchanged: unchanged };
}

function computeRiskDelta(baselineVer, targetVer) {
  var b = (baselineVer && typeof baselineVer.riskScore === 'number') ? baselineVer.riskScore : null;
  var t = (targetVer && typeof targetVer.riskScore === 'number') ? targetVer.riskScore : null;
  if (b === null || t === null) return null;
  return t - b;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fc = require('fast-check');

/** Build a finding object with the given id and severity. */
function makeFinding(id, severity) {
  return { id: id, title: 'Finding ' + id, severity: severity };
}

// ---------------------------------------------------------------------------
// Property 21: Diff computation correctness
// Validates: Requirements 12.3, 12.4
// ---------------------------------------------------------------------------

describe('Property 21: computeDiff — every finding accounted for exactly once', () => {
  test('property: no finding appears in more than one category and all findings accounted for', () => {
    // Validates: Requirements 12.3, 12.4
    const severities = ['critical', 'high', 'medium', 'low', 'info'];

    // Arbitrary: generate two arrays of findings (objects with id and severity).
    // Use fc.uniqueArray with a reasonable id alphabet to keep ids collision-free
    // within each array while allowing overlaps between arrays (to exercise
    // changed / unchanged / added / resolved paths).
    const findingArb = fc.record({
      id: fc.stringMatching(/^[a-h1-3]{1,4}$/),
      severity: fc.constantFrom(...severities),
      title: fc.string({ minLength: 0, maxLength: 20 }),
    });

    const findingsArrayArb = fc.array(findingArb, { minLength: 0, maxLength: 8 }).map(arr => {
      // De-duplicate by id (keep last) to ensure each id is unique within an array,
      // matching how computeDiff uses id as the key.
      const seen = new Map();
      arr.forEach(f => seen.set(f.id, f));
      return Array.from(seen.values());
    });

    fc.assert(
      fc.property(findingsArrayArb, findingsArrayArb, (baseline, target) => {
        const diff = computeDiff(baseline, target);

        // Collect all ids per category
        const addedIds    = diff.added.map(f => f.id);
        const resolvedIds = diff.resolved.map(f => f.id);
        const changedIds  = diff.changed.map(c => c.after.id);
        const unchangedIds = diff.unchanged.map(f => f.id);

        const allDiffIds = [...addedIds, ...resolvedIds, ...changedIds, ...unchangedIds];

        // 1. No finding appears in more than one category (no duplicate ids in the combined list)
        const uniqueDiffIds = new Set(allDiffIds);
        if (uniqueDiffIds.size !== allDiffIds.length) return false;

        // 2. Every target finding is accounted for (added | changed | unchanged)
        const targetIds = target.map(f => f.id);
        const targetCovered = [...addedIds, ...changedIds, ...unchangedIds];
        for (const id of targetIds) {
          if (!targetCovered.includes(id)) return false;
        }

        // 3. Every baseline finding is accounted for (resolved | changed | unchanged)
        const baseIds = baseline.map(f => f.id);
        const baseCovered = [...resolvedIds, ...changedIds, ...unchangedIds];
        for (const id of baseIds) {
          if (!baseCovered.includes(id)) return false;
        }

        // 4. added count: ids in target not in baseline
        const baseIdSet = new Set(baseIds);
        const expectedAdded = targetIds.filter(id => !baseIdSet.has(id)).length;
        if (addedIds.length !== expectedAdded) return false;

        // 5. resolved count: ids in baseline not in target
        const targetIdSet = new Set(targetIds);
        const expectedResolved = baseIds.filter(id => !targetIdSet.has(id)).length;
        if (resolvedIds.length !== expectedResolved) return false;

        return true;
      }),
      { numRuns: 200, verbose: false }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 22: Risk score delta arithmetic
// Validates: Requirements 12.6
// ---------------------------------------------------------------------------

describe('Property 22: computeRiskDelta — delta equals target.riskScore - baseline.riskScore', () => {
  test('property: for any two objects with numeric riskScore, delta equals target - baseline', () => {
    // Validates: Requirements 12.6
    fc.assert(
      fc.property(
        fc.record({ riskScore: fc.integer({ min: 0, max: 10000 }) }),
        fc.record({ riskScore: fc.integer({ min: 0, max: 10000 }) }),
        (baselineVer, targetVer) => {
          const delta = computeRiskDelta(baselineVer, targetVer);
          return delta === targetVer.riskScore - baselineVer.riskScore;
        }
      ),
      { numRuns: 200, verbose: false }
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests — computeDiff
// ---------------------------------------------------------------------------

describe('computeDiff — unit tests', () => {
  test('identical arrays produce zero added, resolved, and changed', () => {
    const findings = [
      makeFinding('F-001', 'high'),
      makeFinding('F-002', 'medium'),
      makeFinding('F-003', 'low'),
    ];
    const diff = computeDiff(findings, findings);
    expect(diff.added).toHaveLength(0);
    expect(diff.resolved).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(3);
  });

  test('finding only in target is classified as added', () => {
    const baseline = [makeFinding('F-001', 'high')];
    const target   = [makeFinding('F-001', 'high'), makeFinding('F-002', 'critical')];
    const diff = computeDiff(baseline, target);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].id).toBe('F-002');
    expect(diff.resolved).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  test('finding only in baseline is classified as resolved', () => {
    const baseline = [makeFinding('F-001', 'high'), makeFinding('F-002', 'critical')];
    const target   = [makeFinding('F-001', 'high')];
    const diff = computeDiff(baseline, target);
    expect(diff.resolved).toHaveLength(1);
    expect(diff.resolved[0].id).toBe('F-002');
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  test('same id but different severity is classified as changed', () => {
    const baseline = [makeFinding('F-001', 'low')];
    const target   = [makeFinding('F-001', 'critical')];
    const diff = computeDiff(baseline, target);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].before.severity).toBe('low');
    expect(diff.changed[0].after.severity).toBe('critical');
    expect(diff.added).toHaveLength(0);
    expect(diff.resolved).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  test('same version selected (same array reference) produces zero changes', () => {
    const findings = [
      makeFinding('F-001', 'critical'),
      makeFinding('F-002', 'high'),
    ];
    // Simulate "same version selected" — diff of identical content
    const diff = computeDiff(findings, findings);
    expect(diff.added).toHaveLength(0);
    expect(diff.resolved).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  test('empty arrays produce empty diff', () => {
    const diff = computeDiff([], []);
    expect(diff.added).toHaveLength(0);
    expect(diff.resolved).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — computeRiskDelta
// ---------------------------------------------------------------------------

describe('computeRiskDelta — unit tests', () => {
  test('returns null when baseline riskScore is null', () => {
    expect(computeRiskDelta({ riskScore: null }, { riskScore: 10 })).toBeNull();
  });

  test('returns null when target riskScore is null', () => {
    expect(computeRiskDelta({ riskScore: 10 }, { riskScore: null })).toBeNull();
  });

  test('returns null when baseline riskScore is missing', () => {
    expect(computeRiskDelta({}, { riskScore: 10 })).toBeNull();
  });

  test('returns null when target riskScore is missing', () => {
    expect(computeRiskDelta({ riskScore: 10 }, {})).toBeNull();
  });

  test('returns null when both versions are null', () => {
    expect(computeRiskDelta(null, null)).toBeNull();
  });

  test('returns correct positive delta', () => {
    expect(computeRiskDelta({ riskScore: 10 }, { riskScore: 25 })).toBe(15);
  });

  test('returns correct negative delta', () => {
    expect(computeRiskDelta({ riskScore: 30 }, { riskScore: 12 })).toBe(-18);
  });

  test('returns zero when scores are equal', () => {
    expect(computeRiskDelta({ riskScore: 7 }, { riskScore: 7 })).toBe(0);
  });
});
