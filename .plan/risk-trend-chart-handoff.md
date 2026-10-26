# Risk Score Trend Chart — Designer → Developer Handoff

## Overview
The risk score trend chart UI component is now implemented on the product timeline page. This document describes the mock data structure, rendering logic, and what Developer needs to implement in Part 2.

---

## What Designer Implemented (Part 1)

### Files Changed
1. **`static/js/src/products.js`**
   - Added chart container div in `renderTimeline()` function (line ~545)
   - Added `_renderRiskTrendChart(versions)` method (new method before `_showProductPicker`)
   - Chart is called after DOM insertion in `renderTimeline()`

2. **`static/css/src/products.css`**
   - Added `.risk-trend-chart-wrapper` and related chart styles
   - SVG element styles: `.risk-trend-line`, `.risk-trend-point`, `.risk-trend-axis-label`, etc.
   - Risk tier color classes for data points: `.risk-tier-green`, `.risk-tier-orange`, `.risk-tier-red`, `.risk-tier-crimson`

3. **`static/css/builder.css`** (compiled)
   - Built from source files via `python3 build_css.py`

4. **`index.html`**
   - Bumped JS cache version from `?v=182` to `?v=183`

---

## Chart Placement
- **Location**: Product timeline page, below the timeline header and above the action buttons (Major/Minor/New Check)
- **Container ID**: `risk-trend-chart-container`
- **Visibility logic**: Chart displays only when there are **2 or more published versions** with valid `riskScore` values

---

## Mock Data Structure
The chart rendering function `_renderRiskTrendChart(versions)` expects an array of version objects with the following structure:

```javascript
[
  {
    version: "1.0",           // String: semantic version number
    status: "published",      // String: "draft" or "published" (chart filters to published only)
    riskScore: 12,            // Number: risk score value (required for chart rendering)
    savedAt: "2024-10-15T10:30:00Z",  // ISO 8601 timestamp (not used by chart, but expected in version object)
    versionNotes: "Initial release"   // String (not used by chart)
  },
  {
    version: "1.1",
    status: "published",
    riskScore: 18,
    savedAt: "2024-10-20T14:45:00Z",
    versionNotes: "Security fixes"
  },
  {
    version: "1.2",
    status: "published",
    riskScore: 15,
    savedAt: "2024-10-22T09:00:00Z",
    versionNotes: null
  }
]
```

### Key Fields for Chart:
- **`version`** (required): Used for X-axis labels (e.g., "v1.0", "v1.1")
- **`status`** (required): Must be `"published"` — draft versions are excluded from the chart
- **`riskScore`** (required): Numeric value rendered on Y-axis and as data point labels

### Chart Behavior:
- Filters to **published versions only** where `typeof riskScore === 'number'`
- Sorts versions by semantic version number (ascending) using `compareVersionNumbers()`
- Takes the **last 5 published versions** (`.slice(-5)`)
- If fewer than 2 published versions exist, the chart container is hidden (`display: none`)

---

## RTL Layout Notes
The chart is fully RTL-correct:
- **X-axis direction**: Right-to-left (oldest version on the right, newest on the left)
- **scaleX function**: Maps index 0 to the right edge, last index to the left edge
- **Text alignment**: Hebrew chart title uses `text-align: right`
- **SVG text anchors**: Set programmatically in JS (`text-anchor="middle"` for version labels, `text-anchor="start"` for Y-axis labels)

---

## Developer Tasks (Part 2)

### 1. Backend Endpoint (if needed)
Currently, the chart uses the existing `/api/products/{productId}/versions` endpoint. **No new endpoint is required** unless you need to:
- Pre-filter published versions on the backend
- Optimize response payload for large version histories

If the current endpoint is sufficient, no backend changes are needed.

### 2. Data Fetching Logic
The chart already receives data from the existing `ProductsPanel.fetchVersions(productId)` call in `renderTimeline()`. 

**Action required**: Verify that the backend response includes:
- `version` (string)
- `status` (string: "draft" or "published")
- `riskScore` (number or null)

If any of these fields are missing or named differently, update the backend to match the expected schema.

### 3. Testing with Real Data
- Create 5+ published versions for a test product
- Verify the chart renders correctly
- Test edge cases:
  - Only 1 published version (chart should not appear)
  - Mix of draft and published versions (chart shows published only)
  - Flat risk score trend (all values identical)
  - Missing `riskScore` values (version is excluded from chart)

---

## Design Decisions That Affect Developer

### Class Names for Risk Tier Styling
The chart uses these CSS classes for data point colors:
- `.risk-tier-green` — score 0-15
- `.risk-tier-orange` — score 16-35
- `.risk-tier-red` — score 36-60
- `.risk-tier-crimson` — score 60+

**Do not override or rename these classes** — they are used throughout the products module (product cards, version rows, chart points).

### DOM Structure
The chart container is injected via:
```javascript
html += '<div id="risk-trend-chart-container"></div>';
```

The chart wrapper is:
```html
<div class="risk-trend-chart-wrapper">
  <div class="risk-trend-chart-title">📊 מגמת ציון סיכון (5 גרסאות אחרונות)</div>
  <svg class="risk-trend-chart" width="600" height="200">...</svg>
</div>
```

**Do not modify this structure** — CSS relies on these class names.

### Data Flow
```
ProductsPanel.renderTimeline(versions)
  ↓
  [DOM injection with chart container]
  ↓
ProductsPanel._renderRiskTrendChart(versions)
  ↓
  [Filter to published versions with riskScore]
  ↓
  [Sort by version number, take last 5]
  ↓
  [Generate SVG and inject into #risk-trend-chart-container]
```

---

## Constraints for Developer

1. **Do not change CSS class names** used in the chart (`.risk-trend-chart-wrapper`, `.risk-trend-point`, etc.) — Designer owns all CSS.
2. **Do not modify the chart rendering logic** in `_renderRiskTrendChart()` — if you need changes to the chart appearance, request Designer.
3. **Do not add the chart to the PDF report template** — this is a web UI feature only.
4. **Data schema must match**: Ensure backend provides `version`, `status`, and `riskScore` fields exactly as documented above.

---

## Testing Checklist for Developer

- [ ] Verify `/api/products/{productId}/versions` returns correct schema
- [ ] Test with 2-5 published versions (chart appears)
- [ ] Test with 0-1 published versions (chart hidden)
- [ ] Test with mix of draft/published (only published in chart)
- [ ] Test with missing `riskScore` values (those versions excluded)
- [ ] Verify RTL layout (oldest version on right, newest on left)
- [ ] Verify risk tier colors match the risk score ranges
- [ ] Test responsive behavior (chart scales within its container)

---

## Questions?
If you encounter any issues or need clarification on the mock data structure, escalate to Designer or Manager.
