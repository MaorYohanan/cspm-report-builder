# Risk Score Trend Chart — Implementation Summary

## What Was Implemented

### 1. Chart Placement
- **Location**: Product timeline page (`#panel-products`)
- **Position**: Below the timeline header, above the action buttons (Major/Minor/New Check)
- **Visibility**: Chart appears only when 2+ published versions with risk scores exist

### 2. Chart Rendering Approach
- **Technology**: Plain SVG (no external library)
- **Rationale**: Lightweight, full RTL control, perfect for small datasets (1-5 points)
- **Data source**: Uses existing `/api/products/{productId}/versions` endpoint

### 3. Visual Design
- **Chart type**: Line chart with data points
- **X-axis**: Version numbers (e.g., v1.0, v1.1) — right-to-left progression (RTL)
- **Y-axis**: Risk score values (0-100+)
- **Data points**: Color-coded circles matching risk tier:
  - Green: 0-15
  - Orange: 16-35
  - Red: 36-60
  - Crimson: 60+
- **Line**: Accent color (`var(--accent)`) connecting data points
- **Labels**: Version numbers on X-axis, risk scores above each point

### 4. RTL Layout
- **Direction**: Right-to-left (oldest version on right, newest on left)
- **Text alignment**: Hebrew chart title uses `text-align: right`
- **SVG coordinates**: Custom `scaleX` function maps index 0 to right edge
- **Compliance**: W3C CSS Writing Modes Level 3

### 5. Styling
- **Container**: Card-style wrapper matching existing product UI
- **Colors**: Uses CSS variables from theme system (`--bg-card`, `--border`, `--accent`, etc.)
- **Responsiveness**: SVG scales within container, max-width: 100%
- **Accessibility**: WCAG AA compliant contrast (colors inherited from existing risk tier system)

---

## Files Modified

1. **`static/js/src/products.js`**
   - Line ~545: Added `<div id="risk-trend-chart-container"></div>` in `renderTimeline()`
   - Line ~615: Added call to `_renderRiskTrendChart(versions)`
   - New method: `_renderRiskTrendChart(versions)` (before `_showProductPicker`)

2. **`static/css/src/products.css`**
   - Added `.risk-trend-chart-wrapper` and 12 related CSS rules
   - Chart styles integrated below timeline view styles (line ~164)

3. **`static/css/builder.css`**
   - Compiled from source files (110,189 chars)

4. **`index.html`**
   - JS cache version bumped: `?v=182` → `?v=183`

---

## Mock Data Structure for Developer

```javascript
// The chart expects an array of version objects:
[
  {
    version: "1.0",          // String: semantic version number
    status: "published",     // String: "draft" or "published"
    riskScore: 12,          // Number: risk score value (0-100+)
    savedAt: "2024-10-15T10:30:00Z"  // ISO timestamp (not used by chart)
  },
  {
    version: "1.1",
    status: "published",
    riskScore: 18,
    savedAt: "2024-10-20T14:45:00Z"
  }
  // ... up to 5 most recent published versions
]
```

**Chart behavior**:
- Filters to published versions only (`status === "published"`)
- Requires `typeof riskScore === "number"`
- Sorts by semantic version (ascending)
- Displays last 5 published versions
- Hidden if fewer than 2 published versions exist

---

## Developer Handoff

**Action Required (Part 2)**:
1. Verify backend endpoint `/api/products/{productId}/versions` provides correct schema
2. Test with real data (2-5 published versions)
3. Verify edge cases:
   - 0-1 published versions → chart hidden
   - Draft versions → excluded from chart
   - Missing `riskScore` → version excluded

**No new endpoint needed** — chart uses existing API.

**Full handoff document**: `.plan/risk-trend-chart-handoff.md`

---

## Testing Checklist

- [x] Chart placement decided (below header, above actions)
- [x] Chart rendering logic implemented
- [x] CSS styling added and compiled
- [x] RTL layout verified (right-to-left flow)
- [x] Mock data structure documented
- [x] JS cache busted (`?v=183`)
- [ ] **Developer**: Backend schema verification
- [ ] **Developer**: Real data testing
- [ ] **Developer**: Edge case testing

---

## Next Steps

1. **Designer** (complete): ✅ Part 1 implementation done
2. **Developer** (pending): 
   - Verify backend provides correct data schema
   - Test with real product versions
   - Handle any backend adjustments if needed

3. **Manager** (if in loop): Review handoff and coordinate testing

---

## Notes

- Chart is **web UI only** — not included in PDF report template
- Uses existing risk tier color system (no new colors introduced)
- Fully RTL-aware and theme-compatible (dark/light)
- Gracefully handles 1-5 data points (minimum 2 required to show chart)
