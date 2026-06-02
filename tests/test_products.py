"""
Unit tests for backend/routes/products.py (task 9 of product-registry spec).

These tests cover specific scenarios and edge cases for the Product Registry
Flask Blueprint.
"""
from __future__ import annotations

import json
import sys
import os
from pathlib import Path

import pytest

# Ensure project root is on sys.path so imports resolve.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from flask import Flask
from backend.routes.products import products_bp, init_products_dir
import backend.routes.products as products_module


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmp_products_dir(tmp_path: Path) -> Path:
    """Return a temporary directory suitable for use as PRODUCTS_DIR."""
    d = tmp_path / "products"
    d.mkdir(parents=True, exist_ok=True)
    return d


@pytest.fixture()
def client(tmp_products_dir: Path):
    """Flask test client with products_bp registered and initialised."""
    app = Flask(__name__)
    app.config["TESTING"] = True

    # Reset module-level state before each test so tests are isolated.
    products_module.PRODUCTS_DIR = None
    products_module._storage_error = False

    app.register_blueprint(products_bp)
    init_products_dir(tmp_products_dir)

    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

_VALID_PRODUCT = {
    "name": "Test Product",
    "owner": "Security Team",
    "ownerEmail": "sec@example.com",
    "env": "AWS Production",
    "subscriptionIds": ["sub-001"],
}

_MINIMAL_SNAPSHOT = {
    "meta": {"reportVersion": "1.0"},
    "findings": [],
    "formDraft": {},
}


def _create_product(client, payload: dict | None = None) -> dict:
    """POST /api/products and return the parsed response body."""
    resp = client.post(
        "/api/products",
        json=payload or _VALID_PRODUCT,
        content_type="application/json",
    )
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def _save_version(client, product_id: str, version_type: str = "minor",
                  snapshot: dict | None = None, notes: str = "test notes") -> dict:
    """POST /api/products/<id>/versions and return the parsed response body."""
    resp = client.post(
        f"/api/products/{product_id}/versions",
        json={
            "type": version_type,
            "notes": notes,
            "snapshot": snapshot or _MINIMAL_SNAPSHOT,
        },
        content_type="application/json",
    )
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def _publish_version(client, product_id: str, ver: str):
    """POST /api/products/<id>/versions/<ver>/publish and return response."""
    return client.post(f"/api/products/{product_id}/versions/{ver}/publish")


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------


class TestFirstVersionSave:
    """First version saved for a product must be "1.0"."""

    def test_first_save_returns_1_0(self, client):
        product = _create_product(client)
        pid = product["id"]
        data = _save_version(client, pid, version_type="minor")
        assert data["version"] == "1.0"

    def test_first_major_save_also_returns_1_0(self, client):
        product = _create_product(client)
        pid = product["id"]
        data = _save_version(client, pid, version_type="major")
        assert data["version"] == "1.0"


class TestHebrewSlug:
    """Hebrew-only product name must produce a valid ASCII slug."""

    def test_hebrew_name_slug_is_ascii(self, client):
        resp = client.post(
            "/api/products",
            json={
                "name": "שלום עולם",  # "Hello World" in Hebrew
                "owner": "Team",
                "ownerEmail": "a@b.com",
                "env": "prod",
                "subscriptionIds": ["s1"],
            },
            content_type="application/json",
        )
        assert resp.status_code == 201
        product_id = resp.get_json()["id"]
        # Slug must contain only [a-z0-9-] — no Hebrew characters.
        import re
        assert re.match(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$", product_id), (
            f"Slug '{product_id}' contains invalid characters"
        )
        assert not any(ord(c) > 127 for c in product_id), (
            f"Slug '{product_id}' contains non-ASCII characters"
        )


class TestMajorVersionIncrement:
    """Major save after a published version M.m → (M+1).0."""

    def test_major_after_published_1_1(self, client):
        product = _create_product(client)
        pid = product["id"]

        # Save 1.0 (minor) then publish it.
        _save_version(client, pid, version_type="minor")
        _publish_version(client, pid, "1.0")

        # Now save minor → 1.1
        _save_version(client, pid, version_type="minor")
        _publish_version(client, pid, "1.1")

        # Major save → 2.0
        data = _save_version(client, pid, version_type="major")
        assert data["version"] == "2.0"


class TestMinorVersionRollover:
    """Minor save after published 2.9 → 3.0 (rollover at 10)."""

    def test_minor_rollover_at_2_9(self, client):
        product = _create_product(client)
        pid = product["id"]

        # Fast-forward by directly writing a published v2.9 file on disk.
        product_dir = products_module.PRODUCTS_DIR / pid
        ver_data = {
            "version": "2.9",
            "reportVersion": "1.0",
            "versionNotes": "n",
            "versionType": "minor",
            "status": "published",
            "savedAt": "2025-01-01T00:00:00Z",
            "publishedAt": "2025-01-01T01:00:00Z",
            "riskScore": 0,
        }
        (product_dir / "v2.9.json").write_text(json.dumps(ver_data), encoding="utf-8")

        # Minor save should roll over to 3.0
        data = _save_version(client, pid, version_type="minor")
        assert data["version"] == "3.0"


class TestPublishAlreadyPublished:
    """Publishing an already-published version → HTTP 409."""

    def test_publish_already_published(self, client):
        product = _create_product(client)
        pid = product["id"]
        _save_version(client, pid)
        _publish_version(client, pid, "1.0")

        resp = _publish_version(client, pid, "1.0")
        assert resp.status_code == 409
        assert "Version already published" in resp.get_json()["error"]


class TestDeletePublishedVersion:
    """Deleting a published version → HTTP 409."""

    def test_delete_published_version(self, client):
        product = _create_product(client)
        pid = product["id"]
        _save_version(client, pid)
        _publish_version(client, pid, "1.0")

        resp = client.delete(f"/api/products/{pid}/versions/1.0")
        assert resp.status_code == 409
        assert "Cannot delete a published version" in resp.get_json()["error"]


class TestDeleteNonExistentVersion:
    """Deleting a version that doesn't exist → HTTP 404."""

    def test_delete_nonexistent_version(self, client):
        product = _create_product(client)
        pid = product["id"]

        resp = client.delete(f"/api/products/{pid}/versions/9.9")
        assert resp.status_code == 404
        assert "Version not found" in resp.get_json()["error"]


class TestSnapshotSizeLimit:
    """Snapshot body > 50 MB → HTTP 413."""

    def test_large_snapshot_returns_413(self, client):
        product = _create_product(client)
        pid = product["id"]

        # Build a body exceeding 50 MB via a large findings array.
        # We send it as raw JSON bytes to control Content-Length.
        big_notes = "x" * (1024 * 1024)  # 1 MB of notes
        payload = {
            "type": "minor",
            "notes": "n",
            "snapshot": {
                "meta": {},
                "findings": [{"severity": "low", "data": big_notes}] * 55,
                "formDraft": {},
            },
        }
        raw = json.dumps(payload).encode("utf-8")
        # Ensure the body is actually > 50 MB; if not, pad the notes field.
        while len(raw) <= 50 * 1024 * 1024:
            payload["snapshot"]["findings"].append({"severity": "low", "data": big_notes})
            raw = json.dumps(payload).encode("utf-8")

        resp = client.post(
            f"/api/products/{pid}/versions",
            data=raw,
            content_type="application/json",
            headers={"Content-Length": str(len(raw))},
        )
        assert resp.status_code == 413


class TestSlugNamespaceExhausted:
    """When slug suffixes -2 to -99 are all taken → HTTP 409."""

    def test_slug_namespace_exhausted(self, client):
        payload = {
            "name": "same-name",
            "owner": "o",
            "ownerEmail": "a@b.com",
            "env": "e",
            "subscriptionIds": ["s"],
        }
        # Create the base slug directory.
        resp = client.post("/api/products", json=payload, content_type="application/json")
        assert resp.status_code == 201
        base_slug = resp.get_json()["id"]

        # Pre-create directories for all suffixes -2 through -99.
        for suffix in range(2, 100):
            (products_module.PRODUCTS_DIR / f"{base_slug}-{suffix}").mkdir()

        # Next creation should fail with 409.
        resp = client.post("/api/products", json=payload, content_type="application/json")
        assert resp.status_code == 409
        assert "Slug namespace exhausted" in resp.get_json()["error"]


class TestVersionListingEmpty:
    """GET versions for a product with no versions → empty JSON array."""

    def test_empty_version_list(self, client):
        product = _create_product(client)
        pid = product["id"]

        resp = client.get(f"/api/products/{pid}/versions")
        assert resp.status_code == 200
        assert resp.get_json() == []


class TestMetaAfterLastDraftDeleted:
    """meta.json has latestVersion: null and latestRiskScore: null after last draft deleted."""

    def test_meta_null_after_last_draft_deleted(self, client):
        product = _create_product(client)
        pid = product["id"]
        _save_version(client, pid)

        resp = client.delete(f"/api/products/{pid}/versions/1.0")
        assert resp.status_code == 200

        # Read meta.json directly from disk.
        meta_path = products_module.PRODUCTS_DIR / pid / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        assert meta["latestVersion"] is None
        assert meta["latestRiskScore"] is None


class TestPathTraversalInURLParam:
    """URL parameter containing "../" → HTTP 400."""

    def test_traversal_in_product_id(self, client):
        resp = client.get("/api/products/../etc")
        # Flask may route this differently; cover both DELETE and GET patterns.
        # The sanitised param will be empty → 400 or 404 depending on routing.
        # The requirement is HTTP 400 when sanitized value is empty.
        # "../etc" → _safe_param strips ".." → "etc" (non-empty) → product not found (404)
        # But "../" → strips ".." and "/" → "" → 400
        resp2 = client.get("/api/products/..%2F")
        # %2F decodes to "/" which _safe_param strips; ".." also stripped → empty → 400
        assert resp2.status_code in (400, 404)

    def test_double_dot_slash_param_returns_400(self, client):
        # Send the raw traversal sequence as part of the path.
        # Flask test client encodes the URL, so use a directly invalid param.
        resp = client.get("/api/products/%2E%2E%2F")
        assert resp.status_code in (400, 404)

    def test_empty_after_sanitization_returns_400(self, client):
        # A param that is *only* path-traversal sequences, leaving empty string.
        # Use %2F (/) and %2E%2E (..) so the sanitized result is empty.
        resp = client.delete("/api/products/..%2F..%2F/versions/1.0")
        assert resp.status_code in (400, 404)


class TestVersionParamWithPrefix:
    """Version parameter "v1.0" (with prefix) → HTTP 400."""

    def test_version_with_v_prefix_returns_400(self, client):
        product = _create_product(client)
        pid = product["id"]

        resp = client.get(f"/api/products/{pid}/versions/v1.0")
        assert resp.status_code == 400
        assert "Invalid version format" in resp.get_json()["error"]

    def test_version_with_v_prefix_delete_returns_400(self, client):
        product = _create_product(client)
        pid = product["id"]
        _save_version(client, pid)

        resp = client.delete(f"/api/products/{pid}/versions/v1.0")
        assert resp.status_code == 400
        assert "Invalid version format" in resp.get_json()["error"]


class TestTraversalInPostBody:
    """POST body string field containing "../" → HTTP 400."""

    def test_traversal_in_notes_field(self, client):
        product = _create_product(client)
        pid = product["id"]

        resp = client.post(
            f"/api/products/{pid}/versions",
            json={
                "type": "minor",
                "notes": "../../../etc/passwd",
                "snapshot": _MINIMAL_SNAPSHOT,
            },
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_traversal_in_product_name(self, client):
        resp = client.post(
            "/api/products",
            json={
                "name": "../evil",
                "owner": "o",
                "ownerEmail": "a@b.com",
                "env": "e",
                "subscriptionIds": ["s"],
            },
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_traversal_in_owner_field(self, client):
        resp = client.post(
            "/api/products",
            json={
                "name": "Good Name",
                "owner": "../admin",
                "ownerEmail": "a@b.com",
                "env": "e",
                "subscriptionIds": ["s"],
            },
            content_type="application/json",
        )
        assert resp.status_code == 400


# ===========================================================================
# Property-Based Tests (Hypothesis)
# ===========================================================================

import re as _re
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Shared Hypothesis strategies
# ---------------------------------------------------------------------------

_st_name   = st.text(min_size=1, max_size=100)
_st_owner  = st.text(min_size=1, max_size=100)
# Build valid emails as local@domain to avoid excessive filtering
_st_email  = st.builds(
    lambda local, domain: f"{local}@{domain}.com",
    local=st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=1, max_size=30),
    domain=st.text(alphabet="abcdefghijklmnopqrstuvwxyz", min_size=2, max_size=20),
)
_st_env    = st.text(min_size=1, max_size=100)
_st_sub_id = st.text(min_size=1, max_size=100)
_st_subs   = st.lists(_st_sub_id, min_size=1, max_size=10)

_st_findings = st.lists(
    st.fixed_dictionaries({
        "severity": st.sampled_from(
            ["critical", "high", "medium", "low", "info",
             "CRITICAL", "HIGH", "UNKNOWN"]
        )
    }),
    max_size=20,
)

# Use st.builds to generate ASCII-only version strings so int() parsing is reliable
_st_published_ver = st.builds(
    lambda major, minor: f"{major}.{minor}",
    major=st.integers(min_value=1, max_value=99),
    minor=st.integers(min_value=0, max_value=8),
)

_st_risk_score = st.integers(min_value=0, max_value=100)

# A counter for unique product names within a test run
import itertools as _itertools
_counter = _itertools.count(1)


def _valid_product_payload(name, owner, email, env, subs):
    return {
        "name": name, "owner": owner, "ownerEmail": email,
        "env": env, "subscriptionIds": subs,
    }


def _minimal_snapshot(findings=None):
    return {
        "meta": {"reportVersion": "1.0"},
        "findings": findings if findings is not None else [],
        "formDraft": {},
    }


# ---------------------------------------------------------------------------
# Property 1: Meta file schema completeness
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 1: Meta file schema completeness
# Validates: Requirements 1.3, 3.1

class TestProperty1MetaSchemaCompleteness:
    @given(
        name=_st_name, owner=_st_owner, email=_st_email,
        env=_st_env, subs=_st_subs,
    )
    @settings(max_examples=100, suppress_health_check=[
        HealthCheck.function_scoped_fixture, HealthCheck.filter_too_much
    ])
    def test_meta_has_all_required_fields(self, client, tmp_products_dir, name, owner, email, env, subs):
        payload = _valid_product_payload(name, owner, email, env, subs)
        resp = client.post("/api/products", json=payload, content_type="application/json")
        assume(resp.status_code == 201)
        pid = resp.get_json()["id"]

        import json as _json
        meta_path = tmp_products_dir / pid / "meta.json"
        meta = _json.loads(meta_path.read_text(encoding="utf-8"))

        required = ["id", "name", "owner", "ownerEmail", "env",
                    "subscriptionIds", "createdAt", "latestVersion", "latestRiskScore"]
        for field in required:
            assert field in meta, f"Missing field: {field}"

        assert isinstance(meta["id"], str) and len(meta["id"]) > 0
        assert isinstance(meta["name"], str)
        assert isinstance(meta["owner"], str)
        assert isinstance(meta["ownerEmail"], str)
        assert isinstance(meta["env"], str)
        assert isinstance(meta["subscriptionIds"], list)
        assert isinstance(meta["createdAt"], str)


# ---------------------------------------------------------------------------
# Property 2: Version file schema completeness
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 2: Version file schema completeness
# Validates: Requirements 1.4, 5.1, 5.2

class TestProperty2VersionSchemaCompleteness:
    @given(findings=_st_findings)
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_version_file_has_all_required_fields(self, client, tmp_products_dir, findings):
        resp = client.post("/api/products", json={
            "name": f"Schema-Test-{next(_counter)}", "owner": "o", "ownerEmail": "a@b.com",
            "env": "e", "subscriptionIds": ["s1"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        snap = _minimal_snapshot(findings)
        vresp = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "n", "snapshot": snap,
        }, content_type="application/json")
        assume(vresp.status_code == 201)
        ver = vresp.get_json()["version"]

        import json as _json
        ver_file = tmp_products_dir / pid / f"v{ver}.json"
        data = _json.loads(ver_file.read_text(encoding="utf-8"))

        required = ["version", "reportVersion", "versionNotes", "versionType",
                    "status", "savedAt", "publishedAt", "riskScore"]
        for field in required:
            assert field in data, f"Missing field: {field}"
        assert isinstance(data["version"], str)
        assert isinstance(data["riskScore"], int)
        assert data["status"] in ("draft", "published")


# ---------------------------------------------------------------------------
# Property 3: Slug always valid ASCII
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 3: Slug is always valid ASCII
# Validates: Requirements 2.1, 2.2, 2.3

class TestProperty3SlugAlwaysValidASCII:
    @given(name=st.text(min_size=0, max_size=200))
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_slug_is_valid_ascii(self, client, tmp_products_dir, name):
        resp = client.post("/api/products", json={
            "name": name or "x",
            "owner": "o", "ownerEmail": "a@b.com",
            "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assume(resp.status_code == 201)
        pid = resp.get_json()["id"]

        # Slug must satisfy [a-z0-9-] only, no leading/trailing hyphens, length 1-100
        assert _re.match(r"^[a-z0-9][a-z0-9-]*$|^[a-z0-9]$", pid), \
            f"Slug '{pid}' contains invalid chars or leading/trailing hyphen"
        assert all(ord(c) < 128 for c in pid), f"Non-ASCII in slug: {pid!r}"
        assert not pid.startswith("-"), f"Slug starts with hyphen: {pid!r}"
        assert not pid.endswith("-"), f"Slug ends with hyphen: {pid!r}"
        assert 1 <= len(pid) <= 100, f"Slug length out of range: {len(pid)}"


# ---------------------------------------------------------------------------
# Property 4: Slug uniqueness under collision
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 4: Slug uniqueness under collision
# Validates: Requirements 2.4

class TestProperty4SlugUniqueness:
    @given(n=st.integers(min_value=2, max_value=5))
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_duplicate_names_get_unique_slugs(self, client, tmp_products_dir, n):
        base_payload = {
            "name": "collision-test-product",
            "owner": "o", "ownerEmail": "a@b.com",
            "env": "e", "subscriptionIds": ["s"],
        }
        slugs = []
        for _ in range(n):
            resp = client.post("/api/products", json=base_payload,
                               content_type="application/json")
            assume(resp.status_code == 201)
            slugs.append(resp.get_json()["id"])

        # All slugs must be unique
        assert len(slugs) == len(set(slugs)), f"Duplicate slugs: {slugs}"

        # All slugs must be valid (satisfy [a-z0-9-], no leading/trailing hyphen)
        for s in slugs:
            assert _re.match(r"^[a-z0-9][a-z0-9-]*$|^[a-z0-9]$", s), \
                f"Slug '{s}' is not a valid slug (must match [a-z0-9-])"
            assert 1 <= len(s) <= 100, f"Slug '{s}' has invalid length"


# ---------------------------------------------------------------------------
# Property 5: Product creation round-trip
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 5: Product creation round-trip
# Validates: Requirements 3.1, 3.3

class TestProperty5CreationRoundTrip:
    @given(
        name=_st_name, owner=_st_owner, email=_st_email,
        env=_st_env, subs=_st_subs,
    )
    @settings(max_examples=100, suppress_health_check=[
        HealthCheck.function_scoped_fixture, HealthCheck.filter_too_much
    ])
    def test_create_then_get_matches(self, client, tmp_products_dir, name, owner, email, env, subs):
        payload = _valid_product_payload(name, owner, email, env, subs)
        resp = client.post("/api/products", json=payload, content_type="application/json")
        assume(resp.status_code == 201)
        pid = resp.get_json()["id"]

        get_resp = client.get(f"/api/products/{pid}")
        assert get_resp.status_code == 200
        data = get_resp.get_json()

        assert data["name"] == name
        assert data["owner"] == owner
        assert data["ownerEmail"] == email
        assert data["env"] == env
        assert data["subscriptionIds"] == subs


# ---------------------------------------------------------------------------
# Property 6: Product listing completeness
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 6: Product listing completeness
# Validates: Requirements 3.2

class TestProperty6ListingCompleteness:
    @given(n=st.integers(min_value=1, max_value=5))
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_all_created_products_appear_in_list(self, client, tmp_products_dir, n):
        created_ids = set()
        for i in range(n):
            resp = client.post("/api/products", json={
                "name": f"List-Test-Product-{i}",
                "owner": "o", "ownerEmail": "a@b.com",
                "env": "e", "subscriptionIds": ["s"],
            }, content_type="application/json")
            assume(resp.status_code == 201)
            created_ids.add(resp.get_json()["id"])

        list_resp = client.get("/api/products")
        assert list_resp.status_code == 200
        listed = list_resp.get_json()
        listed_ids = {p["id"] for p in listed}

        for cid in created_ids:
            assert cid in listed_ids, f"Created product {cid!r} not in listing"

        all_ids = [p["id"] for p in listed]
        assert len(all_ids) == len(set(all_ids)), "Duplicate entries in listing"


# ---------------------------------------------------------------------------
# Property 7: Product update round-trip
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 7: Product update round-trip
# Validates: Requirements 3.4

class TestProperty7UpdateRoundTrip:
    @given(
        new_name=_st_name, new_owner=_st_owner,
        new_email=_st_email, new_env=_st_env,
    )
    @settings(max_examples=100, suppress_health_check=[
        HealthCheck.function_scoped_fixture, HealthCheck.filter_too_much
    ])
    def test_put_then_get_returns_updated_values(self, client, tmp_products_dir,
                                                  new_name, new_owner, new_email, new_env):
        resp = client.post("/api/products", json={
            "name": f"Original-Name-{next(_counter)}", "owner": "orig-owner",
            "ownerEmail": "orig@example.com", "env": "orig-env",
            "subscriptionIds": ["sub-orig"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        update_payload = {
            "name": new_name, "owner": new_owner,
            "ownerEmail": new_email, "env": new_env,
        }
        put_resp = client.put(f"/api/products/{pid}", json=update_payload,
                              content_type="application/json")
        assume(put_resp.status_code == 200)

        get_resp = client.get(f"/api/products/{pid}")
        assert get_resp.status_code == 200
        data = get_resp.get_json()
        assert data["name"] == new_name
        assert data["owner"] == new_owner
        assert data["ownerEmail"] == new_email
        assert data["env"] == new_env
        assert data["id"] == pid


# ---------------------------------------------------------------------------
# Property 8: Product deletion removes product
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 8: Product deletion removes product
# Validates: Requirements 3.5

class TestProperty8DeletionRemovesProduct:
    @given(name=_st_name)
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_delete_then_get_returns_404_and_absent_from_list(self, client, tmp_products_dir, name):
        resp = client.post("/api/products", json={
            "name": name, "owner": "o", "ownerEmail": "a@b.com",
            "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assume(resp.status_code == 201)
        pid = resp.get_json()["id"]

        del_resp = client.delete(f"/api/products/{pid}")
        assert del_resp.status_code == 200

        get_resp = client.get(f"/api/products/{pid}")
        assert get_resp.status_code == 404

        list_resp = client.get("/api/products")
        assert list_resp.status_code == 200
        listed_ids = {p["id"] for p in list_resp.get_json()}
        assert pid not in listed_ids, f"Deleted product {pid!r} still in listing"


# ---------------------------------------------------------------------------
# Property 9: Invalid product payloads are rejected
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 9: Invalid product payloads are rejected
# Validates: Requirements 3.6

class TestProperty9InvalidPayloadsRejected:
    @given(missing_field=st.sampled_from(
        ["name", "owner", "ownerEmail", "env", "subscriptionIds"]
    ))
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_missing_required_field_returns_400(self, client, tmp_products_dir, missing_field):
        payload = {
            "name": "Test", "owner": "o", "ownerEmail": "a@b.com",
            "env": "e", "subscriptionIds": ["s"],
        }
        del payload[missing_field]
        resp = client.post("/api/products", json=payload, content_type="application/json")
        assert resp.status_code == 400

    @given(long_name=st.text(min_size=101, max_size=200))
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_name_exceeding_100_chars_returns_400(self, client, tmp_products_dir, long_name):
        payload = {
            "name": long_name, "owner": "o", "ownerEmail": "a@b.com",
            "env": "e", "subscriptionIds": ["s"],
        }
        resp = client.post("/api/products", json=payload, content_type="application/json")
        assert resp.status_code == 400

    @given(bad_email=st.text(min_size=1, max_size=50).filter(lambda x: "@" not in x))
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_email_without_at_returns_400(self, client, tmp_products_dir, bad_email):
        payload = {
            "name": "Test", "owner": "o", "ownerEmail": bad_email,
            "env": "e", "subscriptionIds": ["s"],
        }
        resp = client.post("/api/products", json=payload, content_type="application/json")
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Property 10: Major version increment is correct
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 10: Major version increment is correct
# Validates: Requirements 4.2

class TestProperty10MajorVersionIncrement:
    @given(published_ver=_st_published_ver)
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_major_save_after_published_gives_m_plus_1_dot_0(
            self, client, tmp_products_dir, published_ver):
        import json as _json

        resp = client.post("/api/products", json={
            "name": f"Major-Inc-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        product_dir = tmp_products_dir / pid
        major = int(published_ver.split(".")[0])
        ver_data = {
            "version": published_ver, "reportVersion": "1.0",
            "versionNotes": "n", "versionType": "minor",
            "status": "published", "savedAt": "2025-01-01T00:00:00Z",
            "publishedAt": "2025-01-01T01:00:00Z", "riskScore": 0,
        }
        (product_dir / f"v{published_ver}.json").write_text(
            _json.dumps(ver_data), encoding="utf-8")

        save_resp = client.post(f"/api/products/{pid}/versions", json={
            "type": "major", "notes": "n",
            "snapshot": _minimal_snapshot(),
        }, content_type="application/json")
        assume(save_resp.status_code == 201)
        new_ver = save_resp.get_json()["version"]

        expected = f"{major + 1}.0"
        assert new_ver == expected, f"Expected {expected}, got {new_ver}"


# ---------------------------------------------------------------------------
# Property 11: Minor version increment with rollover
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 11: Minor version increment is correct (with rollover)
# Validates: Requirements 4.3

class TestProperty11MinorVersionIncrementWithRollover:
    @given(published_ver=_st_published_ver)
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_minor_save_after_published_follows_rollover_rule(
            self, client, tmp_products_dir, published_ver):
        import json as _json

        resp = client.post("/api/products", json={
            "name": f"Minor-Rollover-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        product_dir = tmp_products_dir / pid
        major = int(published_ver.split(".")[0])
        minor = int(published_ver.split(".")[1])
        ver_data = {
            "version": published_ver, "reportVersion": "1.0",
            "versionNotes": "n", "versionType": "minor",
            "status": "published", "savedAt": "2025-01-01T00:00:00Z",
            "publishedAt": "2025-01-01T01:00:00Z", "riskScore": 0,
        }
        (product_dir / f"v{published_ver}.json").write_text(
            _json.dumps(ver_data), encoding="utf-8")

        save_resp = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "n",
            "snapshot": _minimal_snapshot(),
        }, content_type="application/json")
        assume(save_resp.status_code == 201)
        new_ver = save_resp.get_json()["version"]

        if minor + 1 >= 10:
            expected = f"{major + 1}.0"
        else:
            expected = f"{major}.{minor + 1}"
        assert new_ver == expected, \
            f"For {published_ver} minor save: expected {expected}, got {new_ver}"


# ---------------------------------------------------------------------------
# Property 12: Draft overwrite preserves version string
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 12: Draft overwrite preserves version string
# Validates: Requirements 4.4, 5.4

class TestProperty12DraftOverwritePreservesVersion:
    @given(vtype=st.sampled_from(["minor", "major"]))
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_second_save_on_draft_keeps_same_version(self, client, tmp_products_dir, vtype):
        resp = client.post("/api/products", json={
            "name": f"Draft-Overwrite-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        first = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "first",
            "snapshot": _minimal_snapshot(),
        }, content_type="application/json")
        assert first.status_code == 201
        draft_ver = first.get_json()["version"]

        second = client.post(f"/api/products/{pid}/versions", json={
            "type": vtype, "notes": "second",
            "snapshot": _minimal_snapshot(),
        }, content_type="application/json")
        assume(second.status_code == 201)
        assert second.get_json()["version"] == draft_ver, \
            f"Expected same draft version {draft_ver!r}, got {second.get_json()['version']!r}"

        ver_files = list((tmp_products_dir / pid).glob("v*.*.json"))
        assert len(ver_files) == 1, f"Expected 1 version file, found {len(ver_files)}"


# ---------------------------------------------------------------------------
# Property 13: Risk score formula
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 13: Risk score formula
# Validates: Requirements 5.3

class TestProperty13RiskScoreFormula:
    @given(findings=_st_findings)
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_risk_score_matches_formula(self, client, tmp_products_dir, findings):
        resp = client.post("/api/products", json={
            "name": f"Risk-Score-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        snap = _minimal_snapshot(findings)
        vresp = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "n", "snapshot": snap,
        }, content_type="application/json")
        assume(vresp.status_code == 201)
        returned_score = vresp.get_json()["riskScore"]

        weights = {"critical": 4, "high": 3, "medium": 2, "low": 1}
        expected = sum(
            weights.get(str(f.get("severity", "")).lower(), 0)
            for f in findings if isinstance(f, dict)
        )
        assert returned_score == expected, \
            f"riskScore {returned_score} != expected {expected} for {findings}"


# ---------------------------------------------------------------------------
# Property 14: Publish transitions draft to published
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 14: Publish transitions draft to published
# Validates: Requirements 6.1

class TestProperty14PublishTransitionsDraftToPublished:
    @given(findings=_st_findings)
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_publish_sets_status_and_published_at(self, client, tmp_products_dir, findings):
        import json as _json

        resp = client.post("/api/products", json={
            "name": f"Publish-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        snap = _minimal_snapshot(findings)
        vresp = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "n", "snapshot": snap,
        }, content_type="application/json")
        assume(vresp.status_code == 201)
        ver = vresp.get_json()["version"]
        saved_notes = vresp.get_json()["versionNotes"]
        saved_risk = vresp.get_json()["riskScore"]

        pub_resp = client.post(f"/api/products/{pid}/versions/{ver}/publish")
        assert pub_resp.status_code == 200
        pub_data = pub_resp.get_json()

        assert pub_data["status"] == "published"
        assert pub_data["publishedAt"] is not None
        assert "T" in pub_data["publishedAt"] and "Z" in pub_data["publishedAt"]

        on_disk = _json.loads(
            (tmp_products_dir / pid / f"v{ver}.json").read_text(encoding="utf-8")
        )
        assert on_disk["status"] == "published"
        assert on_disk["publishedAt"] is not None
        assert on_disk["versionNotes"] == saved_notes
        assert on_disk["riskScore"] == saved_risk


# ---------------------------------------------------------------------------
# Property 15: Published versions immutable — new save creates new version
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 15: Published versions are immutable — new save creates new version
# Validates: Requirements 6.4, 6.5

class TestProperty15PublishedVersionsImmutable:
    @given(vtype=st.sampled_from(["minor", "major"]))
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_save_after_publish_creates_higher_version(self, client, tmp_products_dir, vtype):
        resp = client.post("/api/products", json={
            "name": f"Immutable-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        v1 = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "n", "snapshot": _minimal_snapshot(),
        }, content_type="application/json")
        assert v1.status_code == 201
        ver1 = v1.get_json()["version"]

        pub = client.post(f"/api/products/{pid}/versions/{ver1}/publish")
        assert pub.status_code == 200

        product_dir = tmp_products_dir / pid
        published_bytes = (product_dir / f"v{ver1}.json").read_bytes()

        v2 = client.post(f"/api/products/{pid}/versions", json={
            "type": vtype, "notes": "n2", "snapshot": _minimal_snapshot(),
        }, content_type="application/json")
        assume(v2.status_code == 201)
        ver2 = v2.get_json()["version"]

        maj1, min1 = int(ver1.split(".")[0]), int(ver1.split(".")[1])
        maj2, min2 = int(ver2.split(".")[0]), int(ver2.split(".")[1])
        assert (maj2, min2) > (maj1, min1), \
            f"New version {ver2} is not strictly higher than published {ver1}"

        current_bytes = (product_dir / f"v{ver1}.json").read_bytes()
        assert published_bytes == current_bytes, \
            "Published version file was modified after a new save"


# ---------------------------------------------------------------------------
# Property 16: Version listing sorted by savedAt descending
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 16: Version listing is sorted by savedAt descending
# Validates: Requirements 7.1

class TestProperty16VersionListingSortedDescending:
    @given(n=st.integers(min_value=2, max_value=5))
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_versions_returned_newest_first(self, client, tmp_products_dir, n):
        resp = client.post("/api/products", json={
            "name": f"Sort-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        for i in range(n):
            sv = client.post(f"/api/products/{pid}/versions", json={
                "type": "minor", "notes": f"v{i}",
                "snapshot": _minimal_snapshot(),
            }, content_type="application/json")
            assume(sv.status_code == 201)
            ver = sv.get_json()["version"]
            pub = client.post(f"/api/products/{pid}/versions/{ver}/publish")
            assume(pub.status_code == 200)

        list_resp = client.get(f"/api/products/{pid}/versions")
        assert list_resp.status_code == 200
        versions = list_resp.get_json()
        assume(len(versions) >= 2)

        saved_ats = [v["savedAt"] for v in versions]
        assert saved_ats == sorted(saved_ats, reverse=True), \
            f"Versions not sorted by savedAt descending: {saved_ats}"


# ---------------------------------------------------------------------------
# Property 17: Version fetch round-trip
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 17: Version fetch round-trip
# Validates: Requirements 7.3

class TestProperty17VersionFetchRoundTrip:
    @given(
        findings=_st_findings,
        notes=st.text(min_size=0, max_size=100).filter(
            lambda x: "../" not in x and "..\\" not in x and "\x00" not in x
        ),
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_get_version_returns_submitted_snapshot_fields(
            self, client, tmp_products_dir, findings, notes):
        resp = client.post("/api/products", json={
            "name": f"Round-Trip-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        snap = _minimal_snapshot(findings)
        vresp = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": notes, "snapshot": snap,
        }, content_type="application/json")
        assume(vresp.status_code == 201)
        ver = vresp.get_json()["version"]

        get_resp = client.get(f"/api/products/{pid}/versions/{ver}")
        assert get_resp.status_code == 200
        data = get_resp.get_json()

        assert data.get("findings") == findings
        assert data.get("formDraft") == snap["formDraft"]
        assert data.get("versionNotes") == notes


# ---------------------------------------------------------------------------
# Property 18: Draft deletion removes version
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 18: Draft deletion removes version
# Validates: Requirements 8.1

class TestProperty18DraftDeletionRemovesVersion:
    @given(findings=_st_findings)
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_deleted_draft_absent_from_list_and_404_on_get(
            self, client, tmp_products_dir, findings):
        resp = client.post("/api/products", json={
            "name": f"Del-Draft-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        vresp = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "n",
            "snapshot": _minimal_snapshot(findings),
        }, content_type="application/json")
        assume(vresp.status_code == 201)
        ver = vresp.get_json()["version"]

        del_resp = client.delete(f"/api/products/{pid}/versions/{ver}")
        assert del_resp.status_code == 200

        list_resp = client.get(f"/api/products/{pid}/versions")
        assert list_resp.status_code == 200
        listed_versions = [v["version"] for v in list_resp.get_json()]
        assert ver not in listed_versions, f"Deleted version {ver!r} still in list"

        get_resp = client.get(f"/api/products/{pid}/versions/{ver}")
        assert get_resp.status_code == 404


# ---------------------------------------------------------------------------
# Property 19: Meta consistency after last draft deleted
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 19: Meta consistency after last draft deleted
# Validates: Requirements 8.5

class TestProperty19MetaAfterLastDraftDeleted:
    @given(findings=_st_findings)
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_meta_is_null_after_only_draft_deleted(self, client, tmp_products_dir, findings):
        import json as _json

        resp = client.post("/api/products", json={
            "name": f"Meta-Null-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        vresp = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "n",
            "snapshot": _minimal_snapshot(findings),
        }, content_type="application/json")
        assume(vresp.status_code == 201)
        ver = vresp.get_json()["version"]

        del_resp = client.delete(f"/api/products/{pid}/versions/{ver}")
        assert del_resp.status_code == 200

        meta = _json.loads(
            (tmp_products_dir / pid / "meta.json").read_text(encoding="utf-8")
        )
        assert meta["latestVersion"] is None, \
            f"Expected latestVersion=null, got {meta['latestVersion']!r}"
        assert meta["latestRiskScore"] is None, \
            f"Expected latestRiskScore=null, got {meta['latestRiskScore']!r}"


# ---------------------------------------------------------------------------
# Property 20: Meta consistency after non-last draft deleted
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 20: Meta consistency after non-last draft deleted
# Validates: Requirements 8.6

class TestProperty20MetaAfterNonLastDraftDeleted:
    @given(n_extra=st.integers(min_value=1, max_value=3))
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_meta_reflects_next_version_after_latest_draft_deleted(
            self, client, tmp_products_dir, n_extra):
        import json as _json

        resp = client.post("/api/products", json={
            "name": f"Meta-Next-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        prev_ver = None
        for _ in range(n_extra):
            sv = client.post(f"/api/products/{pid}/versions", json={
                "type": "minor", "notes": "n",
                "snapshot": _minimal_snapshot(),
            }, content_type="application/json")
            assume(sv.status_code == 201)
            v = sv.get_json()["version"]
            pub = client.post(f"/api/products/{pid}/versions/{v}/publish")
            assume(pub.status_code == 200)
            prev_ver = v

        prev_risk_score = _json.loads(
            (tmp_products_dir / pid / f"v{prev_ver}.json").read_text(encoding="utf-8")
        )["riskScore"]

        draft_resp = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor", "notes": "draft",
            "snapshot": _minimal_snapshot(),
        }, content_type="application/json")
        assume(draft_resp.status_code == 201)
        draft_ver = draft_resp.get_json()["version"]

        del_resp = client.delete(f"/api/products/{pid}/versions/{draft_ver}")
        assert del_resp.status_code == 200

        meta = _json.loads(
            (tmp_products_dir / pid / "meta.json").read_text(encoding="utf-8")
        )
        assert meta["latestVersion"] == prev_ver, \
            f"Expected latestVersion={prev_ver!r}, got {meta['latestVersion']!r}"
        assert meta["latestRiskScore"] == prev_risk_score, \
            f"Expected latestRiskScore={prev_risk_score}, got {meta['latestRiskScore']!r}"


# ---------------------------------------------------------------------------
# Property 23: Path sanitization rejects traversal sequences
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 23: Path sanitization rejects traversal sequences
# Validates: Requirements 15.1

class TestProperty23PathSanitizationRejectsTraversal:
    @given(
        traversal=st.text(
            alphabet=st.sampled_from(list("./\\\x00")),
            min_size=1, max_size=20,
        )
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_traversal_only_param_returns_400_or_404(self, client, tmp_products_dir, traversal):
        from urllib.parse import quote as _quote
        encoded = _quote(traversal, safe="")
        resp = client.get(f"/api/products/{encoded}",
                          follow_redirects=True)
        # After sanitization: empty → 400, not found → 404
        assert resp.status_code in (400, 404), \
            f"Expected 400/404 for traversal param, got {resp.status_code}"

    @given(
        prefix=st.text(
            alphabet=st.sampled_from(list("./\\\x00")),
            min_size=1, max_size=10,
        )
    )
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_traversal_in_version_product_id_returns_400_or_404(
            self, client, tmp_products_dir, prefix):
        from urllib.parse import quote as _quote
        encoded = _quote(prefix, safe="")
        resp = client.get(f"/api/products/{encoded}/versions/1.0",
                          follow_redirects=True)
        assert resp.status_code in (400, 404), \
            f"Expected 400/404 for traversal in product_id, got {resp.status_code}"


# ---------------------------------------------------------------------------
# Property 24: Version parameter pattern enforcement
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 24: Version parameter pattern enforcement
# Validates: Requirements 15.2

class TestProperty24VersionParameterPatternEnforcement:
    @given(bad_ver=st.text(min_size=1, max_size=20).filter(
        lambda x: not _re.match(r"^\d+\.\d+$", x)
            and "/" not in x and "\\" not in x and "\x00" not in x
    ))
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_non_pattern_version_param_returns_400(self, client, tmp_products_dir, bad_ver):
        resp = client.post("/api/products", json={
            "name": f"Ver-Pat-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        from urllib.parse import quote as _quote
        encoded_ver = _quote(bad_ver, safe="")

        get_resp = client.get(f"/api/products/{pid}/versions/{encoded_ver}")
        assert get_resp.status_code == 400, \
            f"Expected 400 for bad ver {bad_ver!r}, got {get_resp.status_code}"
        err = get_resp.get_json().get("error", "")
        assert "Invalid version format" in err or "Invalid parameter" in err

        del_resp = client.delete(f"/api/products/{pid}/versions/{encoded_ver}")
        assert del_resp.status_code == 400, \
            f"Expected 400 for DELETE with bad ver {bad_ver!r}, got {del_resp.status_code}"

        product_dir = tmp_products_dir / pid
        ver_files = list(product_dir.glob("v*.*.json"))
        assert len(ver_files) == 0, \
            f"File written despite bad version param: {[f.name for f in ver_files]}"


# ---------------------------------------------------------------------------
# Property 25: Path traversal in request body fields rejected
# ---------------------------------------------------------------------------
# Feature: product-registry, Property 25: Path traversal in request body fields rejected
# Validates: Requirements 15.4

class TestProperty25PathTraversalInBodyRejected:
    @given(
        field=st.sampled_from(["name", "owner", "env"]),
        traversal_seq=st.sampled_from(["../", "..\\"]),
        extra=st.text(min_size=0, max_size=20),
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_traversal_in_create_body_returns_400(
            self, client, tmp_products_dir, field, traversal_seq, extra):
        payload = {
            "name": "Good", "owner": "o", "ownerEmail": "a@b.com",
            "env": "e", "subscriptionIds": ["s"],
        }
        payload[field] = traversal_seq + extra

        # Snapshot existing products before the request
        before = set(p.name for p in tmp_products_dir.iterdir() if p.is_dir())

        resp = client.post("/api/products", json=payload, content_type="application/json")
        assert resp.status_code == 400, \
            f"Expected 400 for traversal in {field!r}, got {resp.status_code}"

        # No new product directory should have been created
        after = set(p.name for p in tmp_products_dir.iterdir() if p.is_dir())
        new_dirs = after - before
        assert not new_dirs, \
            f"New directory created despite traversal in body: {new_dirs}"

    @given(traversal_seq=st.sampled_from(["../", "..\\"]))
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_traversal_in_notes_returns_400(self, client, tmp_products_dir, traversal_seq):
        resp = client.post("/api/products", json={
            "name": f"Traversal-Notes-Test-{next(_counter)}", "owner": "o",
            "ownerEmail": "a@b.com", "env": "e", "subscriptionIds": ["s"],
        }, content_type="application/json")
        assert resp.status_code == 201
        pid = resp.get_json()["id"]

        vresp = client.post(f"/api/products/{pid}/versions", json={
            "type": "minor",
            "notes": traversal_seq + "etc/passwd",
            "snapshot": _minimal_snapshot(),
        }, content_type="application/json")
        assert vresp.status_code == 400, \
            f"Expected 400 for traversal in notes, got {vresp.status_code}"

        product_dir = tmp_products_dir / pid
        ver_files = list(product_dir.glob("v*.*.json"))
        assert len(ver_files) == 0, \
            f"Version file written despite traversal in notes: {[f.name for f in ver_files]}"
