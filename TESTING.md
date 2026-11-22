# Testing Guide

The project has a lean pytest regression suite — runs in under a second, no external dependencies beyond `requirements.txt`. No frontend testing (the frontend is a compiled bundle, not importable modules). No CI/CD pipeline.

## Test Structure

```
tests/
├── conftest.py          # Shared fixtures: tmp_products_dir, client (Flask test client)
├── test_products.py     # Products blueprint — slugify, versioning, risk score, endpoint smoke tests
└── test_bulk_filter.py  # Bulk filter shapes — locks down the per-type GraphQL filter contract
```

## What Each File Covers

**`test_products.py`**
- `_slugify` — Hebrew → ASCII slug conversion, collision suffixes
- `_safe_param` — path-traversal prevention
- `_valid_version_str` — version string validation
- `_compute_risk_score` — severity weighting, exception exclusion
- `_next_version` — major/minor/draft increment logic
- 8 endpoint smoke tests against `products_bp` (create, get, list, update, delete, version save, publish, version delete)

**`test_bulk_filter.py`**
- Verifies the filter shape returned by `build_bulk_filter` for each of the 11 query types
- Catches silent breakage when Wiz filter field names change or new query types are added

**`test_ssc_query.py`**
- Validates the software supply chain (`softwareSupplyChainFinding`) query filter shape
- Catches regressions specific to the SSC query type

## Running Tests

The suite is ~830 tests / ~195s in full. Most of that is 31 real-browser tests (~90s) and ~360 tests that shell out to `node` (~1-2s each on Windows). Tests are auto-tagged in `tests/conftest.py`: `browser` (uses Playwright) and `node` (spawns node).

| When | Command | ~Time |
|------|---------|-------|
| While iterating (default) | `python scripts/run_tests.py` — runs only tests related to files changed vs HEAD | seconds |
| One feature | `python -m pytest tests/test_products.py -q` | seconds |
| Fast tier, no browser | `python -m pytest` (browser tests are deselected by default) | ~95s |
| Skip node tests too | `python -m pytest -m "not node"` | ~25s |
| UI / JS / template change | `python scripts/run_tests.py` (auto-adds browser tests) or `python -m pytest -m browser` | ~90s |
| Before merge to main | `python scripts/run_tests.py --all` | ~195s |

`run_tests.py` links a changed file to tests that mention its path or module name; changes to models, database, conftest or pytest.ini run the whole non-browser suite; docs-only changes run nothing. Use `--base main` to diff a branch against main, `--list` to preview the selection.

Browser tests need ports 8765/8766 free and Microsoft Edge; they skip themselves otherwise.

Optional speed-up: `pip install pytest-xdist` then add `-n 4` for the non-browser tests (not installed by default; do not combine with `-m browser` since those files share ports).

---

## PDF Geometry Verification

After any change to `backend/services/pdf_service.py` (card splitter, height constants, or print CSS), render a real report to PDF and inspect the page geometry to catch spill pages, near-blank pages, and content overflow before merging.

### Setup

Install `pymupdf` from `requirements-dev.txt` (not a runtime dependency — do not add it to `requirements.txt` or the Dockerfile):

```bash
pip install -r requirements-dev.txt
```

### Approach

1. Export a representative report to PDF via the app (use a report with at least one multi-page finding and one table-heavy section).
2. Run the geometry check script (or inline in a scratch file):

```python
import fitz  # pymupdf

doc = fitz.open("path/to/report.pdf")
for i, page in enumerate(doc):
    page_h = page.rect.height
    blocks = page.get_text("blocks")  # list of (x0, y0, x1, y1, text, ...)
    if not blocks:
        print(f"Page {i+1}: BLANK")
        continue
    last_y = max(b[3] for b in blocks)
    content_h = last_y - min(b[1] for b in blocks)
    pct_blank = round((page_h - last_y) / page_h * 100, 1)
    print(f"Page {i+1}: last_y={last_y:.1f}, content_h={content_h:.1f}, blank={pct_blank}%")
doc.close()
```

3. Flag pages where:
   - `last_y` exceeds `page_h` (content spilled past the bottom of the page)
   - `pct_blank` exceeds ~60% (near-blank page — likely a sparse continuation)
   - A page with very low content immediately follows a dense page (orphaned heading or tail)

The constants that govern splitter behavior are `MAX_PAGE_CARD_HEIGHT_PX` (guard, `offsetHeight`-based) and `MAX_PACK_HEIGHT_PX` (packer, BCR-delta-based) inside `pdf_service.py`. Any change to those values requires a re-run of this check on a real render.
