/**
 * Property 3: Import routing calls the correct import function per query type
 * Tag: Feature: subscription-bulk-import, Property 3: Import routing calls the correct import function per query type
 * Validates: Requirements 4.1
 *
 * Since builder.js is an IIFE that runs in the browser, we cannot import
 * importFnMap directly. Instead, we extract the mapping from the source code
 * and verify that each query type routes to the correct import function.
 */
import fc from 'fast-check';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The 9 valid query types and their expected import function names per the design doc
const EXPECTED_MAP = {
  'issues': 'importIssueFinding',
  'configurationFindings': 'importConfigFinding',
  'vulnerabilityFindings': 'importVulnFinding',
  'hostConfigurationRuleAssessments': 'importHostConfigFinding',
  'dataFindingsV2': 'importDataFinding',
  'secretInstances': 'importSecretFinding',
  'excessiveAccessFindings': 'importExcessiveAccessFinding',
  'networkExposures': 'importNetworkExposureFinding',
  'inventoryFindings': 'importInventoryFinding'
};

const QUERY_TYPES = Object.keys(EXPECTED_MAP);

/**
 * Extract the importFnMap from builder.js source code.
 * Returns an object mapping query type strings to function name strings.
 */
function extractImportFnMapFromSource() {
  const src = readFileSync(join(__dirname, '..', 'static', 'js', 'builder.js'), 'utf-8');

  // Match the importFnMap block: var importFnMap = { ... };
  const mapMatch = src.match(/var\s+importFnMap\s*=\s*\{([^}]+)\}/);
  if (!mapMatch) {
    throw new Error('Could not find importFnMap definition in builder.js');
  }

  const mapBody = mapMatch[1];
  const result = {};

  // Match each key-value pair: 'queryType': functionName
  const entryRegex = /['"](\w+)['"]\s*:\s*(\w+)/g;
  let match;
  while ((match = entryRegex.exec(mapBody)) !== null) {
    result[match[1]] = match[2];
  }

  return result;
}

/**
 * Verify that each import function referenced in importFnMap actually exists
 * as a function definition in builder.js.
 */
function extractDefinedFunctions(src) {
  const fnNames = new Set();
  const fnRegex = /function\s+(\w+)\s*\(/g;
  let match;
  while ((match = fnRegex.exec(src)) !== null) {
    fnNames.add(match[1]);
  }
  return fnNames;
}

// --- Test execution ---

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error('FAIL:', message);
  } else {
    passed++;
  }
}

// Extract the actual map from source
const actualMap = extractImportFnMapFromSource();
const src = readFileSync(join(__dirname, '..', 'static', 'js', 'builder.js'), 'utf-8');
const definedFunctions = extractDefinedFunctions(src);

// Pre-check: all 9 query types are present in the actual map
assert(
  Object.keys(actualMap).length === 9,
  `importFnMap should have exactly 9 entries, got ${Object.keys(actualMap).length}`
);

// Pre-check: all expected query types are present
for (const qt of QUERY_TYPES) {
  assert(qt in actualMap, `importFnMap should contain key '${qt}'`);
}

// Property test: for any randomly chosen query type, the mapping matches the expected function
console.log('Running Property 3: Import routing calls the correct import function per query type');
console.log(`Validates: Requirements 4.1\n`);

try {
  fc.assert(
    fc.property(
      fc.constantFrom(...QUERY_TYPES),
      (queryType) => {
        // The actual map from source must map this query type to the expected function name
        const actualFnName = actualMap[queryType];
        const expectedFnName = EXPECTED_MAP[queryType];

        // 1. The mapping must exist
        if (actualFnName === undefined) {
          return false;
        }

        // 2. The mapped function name must match the expected one
        if (actualFnName !== expectedFnName) {
          return false;
        }

        // 3. The referenced function must actually be defined in builder.js
        if (!definedFunctions.has(actualFnName)) {
          return false;
        }

        return true;
      }
    ),
    { numRuns: 100, verbose: true }
  );
  console.log('\nPASS: Property 3 — all 100 iterations passed');
  console.log('  For every randomly selected query type, importFnMap routes to the correct import function.');
} catch (e) {
  console.error('\nFAIL: Property 3');
  console.error(e.message);
  process.exit(1);
}

// Summary
console.log(`\nPre-checks: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
