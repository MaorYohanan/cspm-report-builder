/**
 * Property 2: Total finding count equals sum of per-query-type counts
 * Tag: Feature: subscription-bulk-import, Property 2: Total finding count equals sum of per-query-type counts
 * Validates: Requirements 3.2
 *
 * Tests the counting logic extracted from renderBulkResults() in builder.js.
 * For any bulk import result containing findings across multiple query types,
 * the total count must equal the sum of the individual per-query-type counts.
 */
import fc from 'fast-check';

// The 9 query types used by the bulk import feature
const QUERY_TYPES = [
  'issues',
  'configurationFindings',
  'vulnerabilityFindings',
  'hostConfigurationRuleAssessments',
  'dataFindingsV2',
  'secretInstances',
  'excessiveAccessFindings',
  'networkExposures',
  'inventoryFindings'
];

/**
 * Standalone version of the counting logic from renderBulkResults() in builder.js.
 * Iterates query types, counts nodes per type, and computes the total.
 */
function computeBulkCounts(results) {
  var totalCount = 0;
  var perType = {};
  QUERY_TYPES.forEach(function (qt) {
    var r = results[qt] || {};
    var nodes = r.nodes || [];
    if (nodes.length) {
      perType[qt] = nodes.length;
      totalCount += nodes.length;
    }
  });
  return { totalCount: totalCount, perType: perType };
}

// --- Generators ---

/** Generate a simple node object (just needs an id). */
const nodeArb = fc.record({
  id: fc.stringMatching(/^[a-z0-9-]{1,36}$/)
});

/** Generate a nodes array for a single query type (0 to 50 items). */
const nodesArrayArb = fc.array(nodeArb, { minLength: 0, maxLength: 50 });

/**
 * Generate a random bulk results object where each of the 9 query types
 * may or may not be present, and each has a random array of nodes.
 */
const bulkResultsArb = fc.record(
  Object.fromEntries(
    QUERY_TYPES.map(qt => [
      qt,
      fc.oneof(
        { weight: 1, arbitrary: fc.constant(undefined) },
        { weight: 3, arbitrary: nodesArrayArb.map(nodes => ({ nodes: nodes, totalCount: nodes.length })) }
      )
    ])
  )
);

// --- Test execution ---

console.log('Running Property 2: Total finding count equals sum of per-query-type counts');
console.log('Validates: Requirements 3.2\n');

let allPassed = true;

try {
  fc.assert(
    fc.property(
      bulkResultsArb,
      (results) => {
        const { totalCount, perType } = computeBulkCounts(results);

        // 1. totalCount equals sum of all perType values
        const sumPerType = Object.values(perType).reduce((a, b) => a + b, 0);
        if (totalCount !== sumPerType) {
          return false;
        }

        // 2. totalCount equals sum of nodes.length across all query types in the input
        let sumFromInput = 0;
        for (const qt of QUERY_TYPES) {
          const r = results[qt];
          if (r && r.nodes) {
            sumFromInput += r.nodes.length;
          }
        }
        if (totalCount !== sumFromInput) {
          return false;
        }

        // 3. perType only contains entries for query types with non-empty nodes
        for (const [qt, count] of Object.entries(perType)) {
          const r = results[qt];
          if (!r || !r.nodes || r.nodes.length === 0) {
            return false; // perType should not have an entry for empty types
          }
          if (count !== r.nodes.length) {
            return false; // count must match actual nodes length
          }
        }

        return true;
      }
    ),
    { numRuns: 200, verbose: true }
  );
  console.log('\nPASS: Property 2 — all 200 iterations passed');
  console.log('  For every random combination of query type results,');
  console.log('  totalCount equals the sum of per-query-type counts.');
} catch (e) {
  console.error('\nFAIL: Property 2');
  console.error(e.message);
  allPassed = false;
}

if (!allPassed) {
  process.exit(1);
}
