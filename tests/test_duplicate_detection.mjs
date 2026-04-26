/**
 * Property 4: Duplicate detection skips already-imported findings
 * Tag: Feature: subscription-bulk-import, Property 4: Duplicate detection skips already-imported findings
 * Validates: Requirements 4.5
 *
 * Tests the core duplicate detection logic from importSelectedBulkFindings()
 * in isolation. The logic is:
 *   - If node.id exists and matches an existing finding's _wizSourceId → skip
 *   - Otherwise → import (push new finding with _wizSourceId = node.id)
 */
import fc from 'fast-check';

/**
 * Standalone version of the duplicate detection logic extracted from
 * importSelectedBulkFindings() in builder.js.
 */
function bulkImportWithDuplicateDetection(existingFindings, nodesToImport) {
  var findings = existingFindings.slice(); // shallow copy
  var imported = 0;
  var skipped = 0;

  nodesToImport.forEach(function (node) {
    if (node.id && findings.some(function (f) { return f._wizSourceId === node.id; })) {
      skipped++;
      return;
    }
    // Simulate import: push a new finding tagged with the node's source id
    findings.push({ id: 'FINDING-' + findings.length, _wizSourceId: node.id });
    imported++;
  });

  return { findings: findings, imported: imported, skipped: skipped };
}

// --- Generators ---

/** Generate a _wizSourceId value (non-empty string or undefined). */
const wizSourceIdArb = fc.oneof(
  { weight: 3, arbitrary: fc.stringMatching(/^[a-z0-9-]{1,36}$/) },
  { weight: 1, arbitrary: fc.constant(undefined) }
);

/** Generate an existing finding with an optional _wizSourceId. */
const existingFindingArb = fc.record({
  id: fc.stringMatching(/^[A-Z]{4}-\d{1,3}$/),
  _wizSourceId: wizSourceIdArb
});

/**
 * Generate an array of existing findings with unique _wizSourceId values.
 * This reflects the real invariant: the import logic never allows duplicate
 * _wizSourceId values in the findings array, so the test input must not
 * contain duplicates either.
 */
const existingFindingsArb = fc.array(existingFindingArb, { minLength: 0, maxLength: 20 })
  .map(arr => {
    const seen = new Set();
    return arr.filter(f => {
      if (f._wizSourceId === undefined) return true; // undefined is fine (not tracked)
      if (seen.has(f._wizSourceId)) return false;
      seen.add(f._wizSourceId);
      return true;
    });
  });

/** Generate a node to import with an optional id. */
const nodeArb = fc.record({
  id: wizSourceIdArb
});

// --- Test execution ---

console.log('Running Property 4: Duplicate detection skips already-imported findings');
console.log('Validates: Requirements 4.5\n');

let allPassed = true;

try {
  fc.assert(
    fc.property(
      existingFindingsArb,
      fc.array(nodeArb, { minLength: 1, maxLength: 30 }),
      (existingFindings, nodesToImport) => {
        const result = bulkImportWithDuplicateDetection(existingFindings, nodesToImport);

        // Compute expected duplicate count: a node is a duplicate if its id is
        // truthy AND already present in existingFindings' _wizSourceId values.
        // We also need to account for nodes that duplicate *each other* within
        // the import batch — the first occurrence imports, subsequent ones are dupes.
        const seenIds = new Set(
          existingFindings
            .map(f => f._wizSourceId)
            .filter(id => id !== undefined)
        );
        let expectedSkipped = 0;
        let expectedImported = 0;
        for (const node of nodesToImport) {
          if (node.id && seenIds.has(node.id)) {
            expectedSkipped++;
          } else {
            expectedImported++;
            if (node.id) {
              seenIds.add(node.id);
            }
          }
        }

        // 1. findings.length increases by exactly the imported count
        if (result.findings.length !== existingFindings.length + result.imported) {
          return false;
        }

        // 2. imported + skipped === total nodes to import
        if (result.imported + result.skipped !== nodesToImport.length) {
          return false;
        }

        // 3. skip count equals expected duplicate count
        if (result.skipped !== expectedSkipped) {
          return false;
        }

        // 4. imported count equals expected imported count
        if (result.imported !== expectedImported) {
          return false;
        }

        // 5. No two findings in the result share the same truthy _wizSourceId
        const resultIds = result.findings
          .map(f => f._wizSourceId)
          .filter(id => id !== undefined);
        if (new Set(resultIds).size !== resultIds.length) {
          return false;
        }

        return true;
      }
    ),
    { numRuns: 200, verbose: true }
  );
  console.log('\nPASS: Property 4 — all 200 iterations passed');
  console.log('  For every combination of existing findings and nodes to import,');
  console.log('  duplicate detection correctly skips already-imported findings.');
} catch (e) {
  console.error('\nFAIL: Property 4');
  console.error(e.message);
  allPassed = false;
}

if (!allPassed) {
  process.exit(1);
}
