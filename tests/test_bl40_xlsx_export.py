"""BL-40: POST /api/export/xlsx (openpyxl read-back tests)."""
from __future__ import annotations

import io
import os
import zipfile
from unittest.mock import patch

import pytest
from flask import Flask
from openpyxl import load_workbook

from backend.database import db as _db
from backend.models import User
from backend.routes.reports import reports_bp
from backend.services.xlsx_service import HEADERS, build_findings_xlsx, sanitize_cell_text

EXPECTED_HEADERS = ["כותרת", "חומרה", "קטגוריה", "תיאור", "השפעה", "פרטים טכניים",
                    "מדיניות", "המלצות", "עדיפות", "בעלים", "מוחרג", "סיבת חריג"]


@pytest.fixture
def app():
    a = Flask(__name__)
    a.config.update(TESTING=True, SECRET_KEY="t", SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
                    SQLALCHEMY_TRACK_MODIFICATIONS=False)
    _db.init_app(a)
    a.register_blueprint(reports_bp)
    with a.app_context():
        import backend.models  # noqa: F401
        _db.create_all()
        _db.session.add(User(email="viewer@example.com", role="viewer"))
        _db.session.commit()
        yield a
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


def _f(title, sev, **kw):
    d = {"id": title, "title": title, "severity": sev}
    d.update(kw)
    return d


def _post(client, findings, meta=None):
    return client.post("/api/export/xlsx", json={"meta": meta or {}, "findings": findings})


def _sheet(resp):
    assert resp.status_code == 200, resp.get_data(as_text=True)
    wb = load_workbook(io.BytesIO(resp.data))
    assert len(wb.worksheets) == 1
    return wb.active


def test_headers_order_and_sheet_setup(client):
    ws = _sheet(_post(client, [_f("a", "high")]))
    assert HEADERS == EXPECTED_HEADERS
    assert [c.value for c in ws[1]] == EXPECTED_HEADERS
    assert ws.sheet_view.rightToLeft is True
    assert ws.freeze_panes == "A2"
    assert ws.auto_filter.ref == "A1:L2"
    assert ws["A1"].font.bold and ws["A1"].fill.start_color.rgb.endswith("1F3864")


def test_response_headers_and_filename(client):
    r = _post(client, [_f("a", "low")],
              meta={"client": "Acme", "cloud": "Azure", "env": "prod", "reportDate": "05/11/2026"})
    assert r.status_code == 200
    assert r.mimetype == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert 'filename="Acme-Azure-prod-2026-11-05.xlsx"' in r.headers["Content-Disposition"]


def test_severity_sort_and_fills(client):
    fs = [_f("i", "info"), _f("l", "low"), _f("c", "critical"), _f("m", "medium"),
          _f("h", "high"), _f("u", "weird")]
    ws = _sheet(_post(client, fs))
    assert [ws.cell(r, 1).value for r in range(2, 8)] == ["c", "h", "m", "l", "i", "u"]
    assert ws["B2"].fill.start_color.rgb.endswith("FEE2E2")
    assert ws["B2"].font.color.rgb.endswith("7F1D1D")
    assert ws["B7"].fill.fill_type is None  # unknown severity: no fill


def test_array_fields_newline_joined_and_wrap(client):
    ws = _sheet(_post(client, [_f("a", "high", technical=["t1", "t2"], policies=["p"], recs=["r1", "r2"])]))
    assert ws["F2"].value == "t1\nt2"
    assert ws["G2"].value == "p"
    assert ws["H2"].value == "r1\nr2"
    assert ws["F2"].alignment.wrap_text is True


def test_exception_columns_and_no_id(client):
    fs = [_f("x", "high", exception={"active": True, "reason": "risk accepted"}),
          _f("y", "low", priority="P1", owner="bob")]
    ws = _sheet(_post(client, fs))
    assert (ws["K2"].value, ws["L2"].value) == ("כן", "risk accepted")
    assert (ws["K3"].value, ws["L3"].value) == ("לא", None)
    assert (ws["I3"].value, ws["J3"].value) == ("P1", "bob")
    assert ws.max_column == 12
    assert "id" not in [c.value for c in ws[1]]


def test_acknowledged_dropped_and_internal_not_exported(client):
    fs = [_f("ACK-SECRET", "critical", exception={"active": True, "kind": "acknowledge", "reason": "r"}),
          _f("keep", "low", exception={"active": True, "kind": "exclude", "reason": "legacy"})]
    r = _post(client, fs)
    ws = _sheet(r)
    assert ws.max_row == 2 and ws["A2"].value == "keep"
    with zipfile.ZipFile(io.BytesIO(r.data)) as z:
        assert b"ACK-SECRET" not in b"".join(z.read(n) for n in z.namelist())


def test_all_acknowledged_returns_400(client):
    fs = [_f("a", "low", exception={"active": True, "kind": "acknowledge"})]
    assert _post(client, fs).status_code == 400


@pytest.mark.parametrize("payload", ["", "[]", "not json", '{"findings": "x"}', '{"findings": []}', '{"meta": {}}'])
def test_invalid_input_400_generic(client, payload):
    r = client.post("/api/export/xlsx", data=payload, content_type="application/json")
    assert r.status_code == 400
    assert "Traceback" not in r.get_data(as_text=True)


@pytest.mark.parametrize("evil", ["=1+1", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1", "=HYPERLINK(\"http://x\",\"y\")"])
def test_formula_injection_cells_inert(client, evil):
    r = _post(client, [_f(evil, "high", description=evil, owner=evil,
                          technical=[evil], exception={"active": True, "reason": evil})])
    ws = _sheet(r)
    for coord in ("A2", "D2", "F2", "J2", "L2"):
        c = ws[coord]
        assert c.data_type == "s", coord
        # no apostrophe added (XML parsing may normalise a leading CR to LF)
        assert c.value.replace("\n", "\r") == evil, (coord, c.value)
        assert c.quotePrefix is True, coord
    with zipfile.ZipFile(io.BytesIO(r.data)) as z:
        sheet_xml = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
        styles_xml = z.read("xl/styles.xml").decode("utf-8")
    assert "<f>" not in sheet_xml and "<f " not in sheet_xml
    assert 'quotePrefix="1"' in styles_xml


def test_plain_cells_have_no_quote_prefix(client):
    r = _post(client, [_f("hello - world", "high", description="plain")])
    ws = _sheet(r)
    assert ws["A2"].value == "hello - world" and not ws["A2"].quotePrefix
    assert not ws["D2"].quotePrefix
    with zipfile.ZipFile(io.BytesIO(r.data)) as z:
        assert 'quotePrefix="1"' not in z.read("xl/styles.xml").decode("utf-8")


def test_plain_text_not_prefixed():
    assert sanitize_cell_text("hello - world") == "hello - world"
    assert sanitize_cell_text("=1+1") == "=1+1"
    assert sanitize_cell_text(None) == ""
    assert sanitize_cell_text(5) == "5"


def test_meta_non_string_values_coerced_or_ignored(client):
    r = _post(client, [_f("a", "low")], meta={"client": 5, "cloud": "Azure", "env": ["a"], "reportDate": {"x": 1}})
    assert r.status_code == 200
    assert 'filename="5-Azure.xlsx"' in r.headers["Content-Disposition"]
    r = _post(client, [_f("a", "low")], meta={"client": 1.5, "env": ["a", "b"], "cloud": None})
    assert r.status_code == 200


def test_illegal_control_chars_stripped_not_500(client):
    ws = _sheet(_post(client, [_f("bad\x00ti\x07tle\x1f", "high", description="x\x0by",
                                  technical=["a\x08b"])]))
    assert ws["A2"].value == "bad" + "ti" + "tle"
    assert ws["D2"].value == "xy"
    assert ws["F2"].value == "ab"


def test_long_cell_truncated():
    wb = load_workbook(io.BytesIO(build_findings_xlsx([_f("a", "low", description="x" * 40000)])))
    assert len(wb.active["D2"].value) <= 32767


def test_non_dict_findings_ignored(client):
    ws = _sheet(_post(client, ["str", 5, None, _f("ok", "low")]))
    assert ws.max_row == 2


def test_size_cap_413(client):
    r = client.post("/api/export/xlsx", data=b"x" * (20 * 1024 * 1024 + 1), content_type="application/json")
    assert r.status_code == 413


def test_viewer_forbidden(client):
    import backend.services.auth_service as auth_mod
    with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "fake"}):
        orig = auth_mod._OAUTH_ENABLED
        auth_mod._OAUTH_ENABLED = True
        try:
            with client.session_transaction() as s:
                s["user_email"] = "viewer@example.com"
                s["user_role"] = "viewer"
            r = _post(client, [_f("a", "low")])
            assert r.status_code == 403
            with client.session_transaction() as s:
                s.clear()
            assert _post(client, [_f("a", "low")]).status_code in (401, 302, 403)
        finally:
            auth_mod._OAUTH_ENABLED = orig
