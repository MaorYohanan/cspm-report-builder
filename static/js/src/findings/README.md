# Findings Module

This directory contains the modularized findings management system, split from the monolithic `findings.js` file.

## Module Structure

### 1. `renderer.js` - Finding Card Rendering and HTML Generation
**Purpose:** Handles all HTML rendering and escaping functions

**Key Functions:**
- `escapeHtml(str)` - Sanitize HTML content
- `linesToListHtml(text)` - Convert text to bullet lists
- `splitLines(value)` - Parse multiline text
- `makeFindingAnchorId(id)` - Generate safe anchor IDs
- `buildSeverityChartSvg(counts, labels)` - Create pie charts
- `renderCategoryBadges(findings, element, filter, callback)` - Render category filters
- `resizeImage(dataUrl, maxW, maxH)` - Resize evidence images
- `sanitizeDataUrl(url)` / `isValidDataUrl(url)` - Security validation

**No Dependencies**

---

### 2. `filter-manager.js` - Severity, Status, and Search Filtering
**Purpose:** Handle all filtering logic for findings

**Key Functions:**
- `applyFilters(findings, filters)` - Apply search, category, severity filters
- `setupFilterListeners(elements, callback)` - Wire filter UI events
- `getCurrentFilters(elements)` - Get current filter state
- `clearAllFilters(elements, callback)` - Reset all filters

**No Dependencies**

---

### 3. `sort-manager.js` - Sorting Logic for Findings
**Purpose:** Handle sorting by column (ID, title, severity, category, owner)

**Key Functions:**
- `sortFindings(findings, sortState)` - Sort by column and direction
- `toggleSort(sortState, column)` - Toggle sort direction
- `getSortIndicator(sortState, column)` - Get sort arrow HTML
- `setupSortableHeaders(container, sortState, callback)` - Wire sortable columns

**Constants:**
- `SEVERITY_ORDER` - Severity sort order mapping

**No Dependencies**

---

### 4. `state-manager.js` - Finding State Management
**Purpose:** Manage pagination, selection, editing, and ID generation

**Classes:**
- `PaginationState` - Page navigation and item slicing
- `SelectionState` - Checkbox selection tracking
- `EditState` - Track editing mode and form drafts

**Key Functions:**
- `generateNextId(findings, prefix)` - Auto-generate sequential IDs
- `reorderFindingIds(findings)` - Re-number IDs per category
- `hasIdGaps(findings)` - Check for numbering gaps

**No Dependencies**

---

### 5. `export-handler.js` - CSV and Report Generation
**Purpose:** Generate HTML/PDF reports and handle data export

**Key Functions:**
- `buildReportHtml(data)` - Generate complete HTML report with embedded CSS
- `calcRiskScore(findings)` - Calculate weighted risk score
- `countSeverity(findings, severity)` - Count findings by severity
- `parseReportDate(str)` / `formatDate(d)` - Date parsing DD/MM/YYYY
- `getDaysForPriority(priority)` / `calcDueDate(reportDate, priority)` - Due date calculation
- `buildFilename(meta, ext)` - Generate filename from metadata

**Constants:**
- `i18n` - Hebrew/English translations for reports
- `categoryMap` - Category code to label mapping

**Dependencies:**
- `renderer.js` (escapeHtml, linesToListHtml, etc.)
- `ui-components.js` (severityMap)

---

### 6. `ui-components.js` - Reusable UI Components
**Purpose:** Shared UI component factories and constants

**Constants:**
- `severityMap` - Severity level configuration (text, class, color)

**Key Functions:**
- `showToast(message, type)` - Toast notifications
- `styledConfirm(message, options)` - Confirmation dialogs
- `createSeverityChip(severity)` - Severity badge HTML
- `createCategoryBadge(category, label)` - Category badge HTML
- `createActionButton(action, idx, icon, title)` - Action button HTML
- `createEditableCell(idx, field, value)` - Inline editable cell
- `createDragHandle()` - Drag handle icon
- `createPaginationControls(pageState, totalPages)` - Pagination UI
- `createEmptyState(message, actions)` - Empty state placeholder
- `createEvidenceThumbnail(dataUrl, idx)` - Evidence image thumbnail
- `createLoadingSpinner(message)` - Loading spinner
- `createDropdownMenu(items)` - Dropdown menu HTML
- `formatDateDDMMYYYY(date)` / `getTodayDDMMYYYY()` - Date formatting

**No Dependencies**

---

### 7. `index.js` - Main Orchestrator
**Purpose:** Central coordinator that imports and integrates all modules

**Main Class:**
- `FindingsManager` - Main API for findings operations

**Key Methods:**
- `init(config)` - Initialize with configuration
- `add(finding)` / `update(idx, finding)` / `delete(idx)` - CRUD operations
- `startEdit(idx)` / `stopEdit()` - Edit mode management
- `getProcessedFindings()` - Get filtered + sorted findings
- `render()` - Trigger UI update
- `exportHTML(meta, coverImage)` - Generate HTML report
- `buildSnapshot(meta)` / `loadSnapshot(snapshot)` - State persistence

**Factory Function:**
- `createFindingsManager(config)` - Create new manager instance

**Re-exports:** All sub-modules for direct access

---

## Usage Example

```javascript
import { createFindingsManager } from './findings/index.js';

// Initialize manager
const manager = createFindingsManager({
  filterElements: {
    searchInput: document.getElementById('findings-search'),
    categoryFilter: document.getElementById('findings-filter-category'),
    severityFilter: document.getElementById('findings-filter-severity')
  },
  onRender: (data) => {
    // Custom render logic
    console.log('Findings:', data.findings);
    console.log('Filtered:', data.filtered);
    console.log('Paginated:', data.paginated);
  }
});

// Add finding
manager.add({
  id: 'CSPM-001',
  title: 'S3 Bucket Public',
  severity: 'critical',
  category: 'CSPM',
  description: 'Bucket exposed to internet',
  // ... more fields
});

// Export HTML report
const html = manager.exportHTML({
  client: 'Acme Corp',
  reportDate: '31/05/2024',
  // ... more metadata
}, coverImageDataUrl);
```

## Direct Module Usage

If you need only specific functionality:

```javascript
import { Renderer, FilterManager, SortManager } from './findings/index.js';

// Use individual modules
const escaped = Renderer.escapeHtml(userInput);
const filtered = FilterManager.applyFilters(findings, { severity: 'critical' });
const sorted = SortManager.sortFindings(filtered, { col: 'id', dir: 'asc' });
```

## Module Dependencies Graph

```
index.js (orchestrator)
  ├── renderer.js (no deps)
  ├── filter-manager.js (no deps)
  ├── sort-manager.js (no deps)
  ├── state-manager.js (no deps)
  ├── export-handler.js
  │   ├── renderer.js
  │   └── ui-components.js
  └── ui-components.js (no deps)
```

## Migration from Monolithic findings.js

The original `static/js/src/findings.js` (2861 lines) has been split into:

1. **renderer.js** (~200 lines) - Rendering utilities
2. **filter-manager.js** (~60 lines) - Filtering logic
3. **sort-manager.js** (~80 lines) - Sorting logic
4. **state-manager.js** (~160 lines) - State management
5. **export-handler.js** (~600 lines) - Export and report generation
6. **ui-components.js** (~140 lines) - UI component factories
7. **index.js** (~120 lines) - Main orchestrator

**Total:** ~1360 lines of focused, documented, testable code

## Benefits

✅ **Separation of Concerns** - Each module has a single responsibility  
✅ **Testability** - Modules can be unit tested independently  
✅ **Maintainability** - Easy to locate and modify specific functionality  
✅ **Reusability** - Modules can be imported individually  
✅ **Type Safety Ready** - JSDoc comments enable TypeScript checking  
✅ **No Breaking Changes** - Original API contracts maintained  

## Next Steps

1. Update main findings.js to import and use these modules
2. Add unit tests for each module
3. Consider TypeScript migration for type safety
4. Add Storybook for UI component documentation
