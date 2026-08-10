"""Regression tests for backend/routes/products.py.

Run after any major change to products.py:
    python -m pytest tests/test_products.py -v
"""
from __future__ import annotations

import pytest

from backend.routes.products import (
    _compute_risk_score,
    _next_version,
    _safe_param,
    _slugify,
    _valid_version_str,
)


# ---------------------------------------------------------------------------
# Pure-helper tests (no database needed)
# ---------------------------------------------------------------------------


class TestSlugify:
    def test_hebrew_word_produces_ascii_slug(self):
        slug = _slugify("שלום")
        assert slug.isascii()
        assert slug == "shlvm"

    def test_ascii_input_lowercased(self):
        assert _slugify("HelloWorld") == "helloworld"

    def test_spaces_and_underscores_become_hyphens(self):
        assert _slugify("hello world_foo") == "hello-world-foo"

    def test_disallowed_chars_stripped(self):
        assert _slugify("hello!@#$world") == "helloworld"

    def test_empty_input_falls_back_to_uuid(self):
        slug = _slugify("")
        assert slug.startswith("product-")
        assert len(slug) == len("product-") + 8

    def test_truncated_to_100_chars(self):
        assert len(_slugify("a" * 200)) == 100


class TestSafeParam:
    def test_strips_double_dots(self):
        assert _safe_param("..") == ""

    def test_strips_slashes(self):
        assert _safe_param("a/b\\c") == "abc"

    def test_strips_null_bytes(self):
        assert _safe_param("foo\x00bar") == "foobar"

    def test_clean_input_passes_through(self):
        assert _safe_param("hello-world") == "hello-world"


class TestValidVersionStr:
    @pytest.mark.parametrize("ver", ["1.0", "99.42", "0.0", "100.100"])
    def test_valid_versions_accepted(self, ver):
        assert _valid_version_str(ver) is True

    @pytest.mark.parametrize("ver", ["v1.0", "1", "1.0.0", "a.b", "", "1.0a"])
    def test_invalid_versions_rejected(self, ver):
        assert _valid_version_str(ver) is False


class TestComputeRiskScore:
    def test_formula(self):
        snapshot = {"findings": [
            {"severity": "Critical"},
            {"severity": "High"},
            {"severity": "Medium"},
            {"severity": "Low"},
        ]}
        assert _compute_risk_score(snapshot) == 10  # 4+3+2+1

    def test_case_insensitive(self):
        snapshot = {"findings": [{"severity": "CRITICAL"}, {"severity": "critical"}]}
        assert _compute_risk_score(snapshot) == 8

    def test_unrecognized_severity_contributes_zero(self):
        snapshot = {"findings": [{"severity": "Trivial"}, {"severity": "High"}]}
        assert _compute_risk_score(snapshot) == 3

    def test_exception_active_excluded(self):
        snapshot = {"findings": [
            {"severity": "Critical"},
            {"severity": "Critical", "exception": {"active": True}},
            {"severity": "Critical", "exception": {"active": False}},
        ]}
        assert _compute_risk_score(snapshot) == 8


class TestNextVersion:
    def test_first_save_returns_1_0(self, client):
        pid = client.post("/api/products", json=VALID_PRODUCT).get_json()["id"]
        # No versions yet — _next_version should return "1.0"
        rv = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "first", "snapshot": {"findings": []},
        })
        assert rv.get_json()["version"] == "1.0"

    def test_major_after_published(self, client):
        pid = client.post("/api/products", json=VALID_PRODUCT).get_json()["id"]
        client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "v1", "snapshot": {"findings": []},
        })
        client.post(f"/api/products/{pid}/versions/1.0/publish")
        rv = client.post(f"/api/products/{pid}/versions", json={
            "type": "major", "notes": "v2", "snapshot": {"findings": []},
        })
        assert rv.get_json()["version"] == "2.0"

    def test_minor_after_published(self, client):
        pid = client.post("/api/products", json=VALID_PRODUCT).get_json()["id"]
        client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "v1", "snapshot": {"findings": []},
        })
        client.post(f"/api/products/{pid}/versions/1.0/publish")
        rv = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "v1.1", "snapshot": {"findings": []},
        })
        assert rv.get_json()["version"] == "1.1"


# ---------------------------------------------------------------------------
# Endpoint smoke tests
# ---------------------------------------------------------------------------

VALID_PRODUCT = {
    "name": "Test Product",
    "owner": "Owner Name",
    "ownerEmail": "owner@example.com",
    "env": "Production",
    "subscriptionIds": ["sub-001"],
}


def test_create_product_happy_path(client):
    rv = client.post("/api/products", json=VALID_PRODUCT)
    assert rv.status_code == 201
    body = rv.get_json()
    assert body["name"] == "Test Product"
    assert body["id"] == "test-product"


def test_create_product_missing_name_rejected(client):
    payload = {k: v for k, v in VALID_PRODUCT.items() if k != "name"}
    rv = client.post("/api/products", json=payload)
    assert rv.status_code == 400


def test_create_product_traversal_in_field_rejected(client):
    payload = {**VALID_PRODUCT, "name": "foo../bar"}
    rv = client.post("/api/products", json=payload)
    assert rv.status_code == 400


def test_get_nonexistent_product_returns_404(client):
    rv = client.get("/api/products/does-not-exist")
    assert rv.status_code == 404


def test_save_version_happy_path(client):
    pid = client.post("/api/products", json=VALID_PRODUCT).get_json()["id"]

    rv = client.post(f"/api/products/{pid}/versions", json={
        "type": "minor",
        "notes": "First save",
        "snapshot": {"findings": [{"severity": "High"}]},
    })
    assert rv.status_code == 201
    body = rv.get_json()
    assert body["version"] == "1.0"
    assert body["status"] == "draft"
    assert body["riskScore"] == 3

    # Verify latestVersion is reflected in list_products
    products = client.get("/api/products").get_json()
    assert products[0]["latestVersion"] == "1.0"


def test_get_version_roundtrip(client):
    """get_version must return the exact findings that were saved."""
    pid = client.post("/api/products", json=VALID_PRODUCT).get_json()["id"]
    findings = [{"severity": "Critical", "title": "Open port"}]
    client.post(f"/api/products/{pid}/versions", json={
        "type": "minor", "notes": "v1",
        "snapshot": {"findings": findings, "executiveSummary": "test"},
    })
    rv = client.get(f"/api/products/{pid}/versions/1.0")
    assert rv.status_code == 200
    body = rv.get_json()
    assert body["findings"] == findings
    assert body["executiveSummary"] == "test"
    assert body["status"] == "draft"


def test_publish_draft_flips_status(client):
    pid = client.post("/api/products", json=VALID_PRODUCT).get_json()["id"]
    client.post(f"/api/products/{pid}/versions", json={
        "type": "minor", "notes": "v1", "snapshot": {"findings": []},
    })

    rv = client.post(f"/api/products/{pid}/versions/1.0/publish")
    assert rv.status_code == 200
    assert rv.get_json()["status"] == "published"
    assert rv.get_json()["publishedAt"] is not None


def test_publish_already_published_rejected(client):
    pid = client.post("/api/products", json=VALID_PRODUCT).get_json()["id"]
    client.post(f"/api/products/{pid}/versions", json={
        "type": "minor", "notes": "v1", "snapshot": {"findings": []},
    })
    client.post(f"/api/products/{pid}/versions/1.0/publish")

    rv = client.post(f"/api/products/{pid}/versions/1.0/publish")
    assert rv.status_code == 409


def test_delete_nonexistent_version_returns_404(client):
    pid = client.post("/api/products", json=VALID_PRODUCT).get_json()["id"]
    rv = client.delete(f"/api/products/{pid}/versions/9.9")
    assert rv.status_code == 404


def test_delete_version_updates_product_latest(client):
    """After deleting the only version, latestVersion must be None."""
    pid = client.post("/api/products", json=VALID_PRODUCT).get_json()["id"]
    client.post(f"/api/products/{pid}/versions", json={
        "type": "minor", "notes": "v1", "snapshot": {"findings": []},
    })
    client.delete(f"/api/products/{pid}/versions/1.0")

    products = client.get("/api/products").get_json()
    assert products[0]["latestVersion"] is None


# ---------------------------------------------------------------------------
# DEV-H-4: body-size guard must fire before get_json() consumes the body
# ---------------------------------------------------------------------------


def test_save_version_body_size_limit(client):
    """POST to save_version with a body > 50 MB must return HTTP 413.

    The guard is implemented using request.get_data(cache=True) BEFORE
    request.get_json(), so the size check is never dead even when Flask has
    already buffered the body.  We mock get_data on the request object so we
    do not have to actually transmit 50 MB over the wire.
    """
    from unittest.mock import patch

    pid = client.post("/api/products", json=VALID_PRODUCT).get_json()["id"]

    oversized = b"x" * (50 * 1024 * 1024 + 1)

    # Patch flask.Request.get_data on the class so that every request inside
    # this call returns the oversized bytes, regardless of what was actually sent.
    with patch("flask.Request.get_data", return_value=oversized):
        rv = client.post(
            f"/api/products/{pid}/versions",
            data=b'{"type":"minor","notes":"n","snapshot":{}}',
            content_type="application/json",
        )

    assert rv.status_code == 413, (
        f"Expected 413 for oversized body, got {rv.status_code}: {rv.get_json()}"
    )
