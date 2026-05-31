# Wizi Integration Modules

This directory contains the modularized Wizi integration code, split from the monolithic `static/js/src/wizi.js` file.

## Module Structure

### 1. **api-client.js**
Handles all API calls to `/api/wizi/*` endpoints.

**Exports:**
- `checkWiziStatus()` - Check if Wizi is enabled
- `fetchSubscriptions()` - Fetch subscriptions for autocomplete
- `fetchIssues(params)` - Fetch issues/findings from Wizi
- `findById(params)` - Find finding by ID
- `bulkFetch(subscription)` - Bulk fetch all finding types
- `summarizeRemediation(params)` - Summarize remediation using AI

**Usage:**
```javascript
import { fetchIssues } from './api-client.js';

const data = await fetchIssues({
  queryType: 'issues',
  first: 10,
  severity: ['CRITICAL', 'HIGH'],
  status: ['OPEN']
});
```

---

### 2. **subscription-manager.js**
Manages subscription selection and filtering logic.

**Exports:**
- `setSubscriptions(subs)` - Update subscriptions list
- `getSubscriptions()` - Get subscriptions for autocomplete
- `getNodeSubscriptionName(node, queryType)` - Extract subscription name from finding
- `extractAutoFillData(nodes, queryType)` - Extract auto-fill data from results

**Usage:**
```javascript
import { getNodeSubscriptionName } from './subscription-manager.js';

const subName = getNodeSubscriptionName(finding, 'configurationFindings');
```

---

### 3. **filters.js**
Handles filter UI and state management.

**Exports:**
- `statusOptions` - Status options per query type
- `severityOptions` - Severity options per query type
- `updateFilterOptions(queryType, statusSelect, severitySelect)` - Update filter UI
- `getSelectedValues(selectEl)` - Get selected values from multi-select
- `getPresets()` - Get saved query presets
- `savePreset(preset)` - Save query preset
- `deletePreset(index)` - Delete query preset

**Usage:**
```javascript
import { updateFilterOptions, getSelectedValues } from './filters.js';

updateFilterOptions('issues', statusSelectEl, severitySelectEl);
const selectedSeverities = getSelectedValues(severitySelectEl);
```

---

### 4. **bulk-actions.js**
Handles bulk fetch and export functionality.

**Exports:**
- `queryTypeLabels` - Human-readable labels for query types
- `renderBulkResults(data, options)` - Render bulk import results
- `renderBulkPage(qt, results, pageState, options)` - Render paginated table
- `updateBulkSelectedCount()` - Update selected count display

**Usage:**
```javascript
import { renderBulkResults } from './bulk-actions.js';

const { bulkImportResults, bulkPageState } = renderBulkResults(data, {
  progressDiv,
  resultsDiv,
  actionsDiv,
  updateSelectedCount,
  severityMap,
  getWiziItemTitle,
  showToast
});
```

---

### 5. **ui-helpers.js**
DOM manipulation and UI utilities.

**Exports:**
- `escapeHtml(str)` - Escape HTML special characters
- `setupAutocomplete(input, hiddenInput, listEl, getItems)` - Setup autocomplete
- `mapWiziSeverity(sev)` - Map Wizi severity to internal severity
- `mapWiziCategory(entity)` - Map Wizi entity to category
- `getWiziItemTitle(item, queryType)` - Get finding title
- `getWiziRuleId(item, queryType)` - Get rule ID for consolidation
- `extractResourceName(item, queryType)` - Extract resource name
- `extractRecommendations(rule, sevLabel)` - Extract recommendations from rule

**Usage:**
```javascript
import { escapeHtml, mapWiziSeverity } from './ui-helpers.js';

const safeHtml = escapeHtml(userInput);
const severity = mapWiziSeverity('HIGH'); // returns 'high'
```

---

### 6. **index.js**
Main orchestration module that coordinates all Wizi functionality.

**Exports:**
- `initWizi(context, isCloud)` - Initialize Wizi integration
- All functions from other modules (re-exported for convenience)

**Usage:**
```javascript
import { initWizi } from './wizi/index.js';

const wiziContext = initWizi(appContext, isCloud);
```

---

## Migration from Monolithic wizi.js

The original `static/js/src/wizi.js` (~3200 lines) has been split into these focused modules:

1. **API Client** (2.6 KB) - ~90 lines
2. **Subscription Manager** (5.5 KB) - ~150 lines
3. **Filters** (8.1 KB) - ~240 lines
4. **Bulk Actions** (14 KB) - ~350 lines
5. **UI Helpers** (11 KB) - ~290 lines
6. **Main Index** (5.0 KB) - ~130 lines

**Total: ~1,250 lines** (modularized with clear separation of concerns)

---

## Benefits of Modular Structure

1. **Maintainability** - Each module has a single responsibility
2. **Testability** - Modules can be tested in isolation
3. **Reusability** - Functions can be imported only where needed
4. **Performance** - Modules can be lazy-loaded
5. **Documentation** - JSDoc comments provide clear API contracts
6. **Debugging** - Easier to locate and fix issues

---

## Integration with Builder

To use in the main application, import the modules:

```javascript
// ES6 modules
import * as Wizi from './wizi/index.js';

// Initialize
const wiziContext = Wizi.initWizi({ findings, severityMap }, isCloud);

// Use specific functions
const title = Wizi.getWiziItemTitle(item, 'issues');
const severity = Wizi.mapWiziSeverity('CRITICAL');
```

---

## API Contracts

All modules maintain the existing API contracts from the original wizi.js:
- No breaking changes to HTML structure
- Same function signatures
- Same data formats
- Same DOM element IDs

The modular structure is a **refactor, not a rewrite** - all existing functionality is preserved.
