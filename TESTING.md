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

## Running Tests

```bash
python -m pytest tests/ -v
```

Run after any change to `backend/routes/products.py` or `backend/routes/wiz.py`.
