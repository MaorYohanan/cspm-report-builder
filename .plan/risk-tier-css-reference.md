# Risk Score 4-Tier CSS Reference

**Status:** Part 1 (Designer) complete — CSS classes ready  
**Next:** Part 2 (Developer) — backend API + JS tier logic update

---

## Visual Treatment Approach

The 4-tier system uses the same dual visual treatment as the existing 3-tier system:

1. **Accent bar** (3px solid bar at top of product card)
2. **Badge styling** (10% opacity background + 30% opacity border + solid text color)

This approach is applied consistently across:
- Products page (card accent + stat chip badge)
- Pipeline dashboard (risk score column badges)

---

## CSS Class Names

### Tier Definitions

| Tier | Range | Class Name | Color | Usage |
|------|-------|------------|-------|-------|
| **Tier 1** | 0-15 | `.risk-tier-green` | `oklch(0.62 0.17 155)` | Clean/low risk |
| **Tier 2** | 16-35 | `.risk-tier-orange` | `oklch(0.72 0.16 60)` | Moderate risk |
| **Tier 3** | 36-60 | `.risk-tier-red` | `oklch(0.58 0.22 15)` | Concerning/high risk |
| **Tier 4** | 60+ | `.risk-tier-crimson` | `oklch(0.48 0.24 10)` | Serious/critical risk |

### Application Classes

**Products page:**
- `.product-card-accent.risk-tier-{green|orange|red|crimson}` — card top accent bar
- `.product-stat-chip.risk-tier-{green|orange|red|crimson}` — risk score badge

**Pipeline dashboard:**
- `.pipeline-risk-badge.risk-tier-{green|orange|red|crimson}` — risk score column badge

---

## Accessibility

All color/background combinations meet **WCAG 2.1 AA** contrast requirements (4.5:1) on dark theme.

**Note:** The crimson tier badge text color is lightened to `oklch(0.55 0.25 10)` (vs. accent bar at `0.48`) to ensure sufficient contrast against the dark background.

---

## RTL Compatibility

All classes are RTL-correct:
- No directional properties (left/right) are used
- Badge padding and border are uniform (no side-specific values)
- Accent bar spans full width with no directional constraints

---

## Legacy Classes (Backward Compatibility)

The old 3-tier classes are **maintained** until Developer updates the JS logic:
- `.product-card-accent.risk-low|risk-medium|risk-high`
- `.product-stat-chip.risk-low|risk-medium|risk-high`

These can be removed after `products.js` (lines 283, 285, 295) and `pipeline.js` are updated to use the new tier classes.

---

## Files Modified

- `static/css/src/products.css` — added 4-tier accent bar + badge classes
- `static/css/src/pipeline.css` — added 4-tier badge classes
- `static/css/builder.css` — compiled output (verified)

---

## Developer Tasks (Part 2)

1. **Backend API** — Update `/api/products` to return `riskTier` field (1-4) based on risk score
2. **Products.js** — Replace 3-tier logic (line 283) with 4-tier logic referencing new CSS classes
3. **Pipeline.js** — Add risk score column with 4-tier badge styling
4. **Testing** — Verify all 4 tiers render correctly in both views

---

**Designer:** CSS implementation complete ✅  
**Next step:** Hand off to Developer for backend + JS integration
