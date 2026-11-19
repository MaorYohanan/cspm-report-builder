"""BL-35: base severity chips and the findings-table ID cell must be >= 4.5:1 (WCAG 1.4.3) on the dark theme.

Pure CSS-source check (no browser): reads the oklch colours straight from static/css/builder.css (the built
output of static/css/src/*.css), converts them to sRGB, composites the chip tint over each dark surface the
chip can sit on and asserts the text/background contrast ratio. Backgrounds mirror base.css variables
(--bg-surface, --bg-card) plus the striped-row tint from components.css.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

import pytest

CSS = (Path(__file__).resolve().parent.parent / "static" / "css" / "builder.css").read_text(encoding="utf-8")

SURFACE = (0x11, 0x18, 0x27)   # --bg-surface: plain table row
CARD = (0x16, 0x1F, 0x30)      # --bg-card
STRIPE = tuple(c * 0.985 + 255 * 0.015 for c in SURFACE)  # tbody tr:nth-child(even) rgba(255,255,255,.015)
DARK_BGS = {"surface": SURFACE, "stripe": STRIPE, "card": CARD}  # the surfaces chips actually sit on


def _oklch_to_rgb(L: float, C: float, h: float):
    a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
    l_, m_, s_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    lin = (4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
           -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
           -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_)
    gam = lambda x: 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
    return tuple(min(max(gam(x), 0), 1) * 255 for x in lin)


def _lum(c):
    f = lambda v: v / 255 / 12.92 if v / 255 <= 0.03928 else ((v / 255 + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def _ratio(fg, bg):
    x, y = _lum(fg), _lum(bg)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)


def _rule(selector_regex: str) -> str:
    m = re.search(selector_regex + r"\s*\{([^}]*)\}", CSS)
    assert m, f"rule not found: {selector_regex}"
    return m.group(1)


def _oklch(decl: str, prop: str):
    m = re.search(r"(?<![-\w])" + prop + r":\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*/\s*([\d.]+))?\)", decl)
    assert m, f"no oklch {prop} in: {decl}"
    L, C, h = map(float, m.group(1, 2, 3))
    return L, C, h, float(m.group(4)) if m.group(4) else 1.0


@pytest.mark.parametrize("sev", ["critical", "high", "medium", "low", "info"])
@pytest.mark.parametrize("bg_name", list(DARK_BGS))
def test_dark_chip_text_meets_aa(sev, bg_name):
    decl = _rule(r"(?m)^\.sev-" + sev + r"(?![\w-])(?=\s*\{)")
    L, C, h, _ = _oklch(decl, "color")
    _, _, _, alpha = _oklch(decl, "background")
    fg = _oklch_to_rgb(L, C, h)
    bg = DARK_BGS[bg_name]
    chip_bg = tuple(fg[i] * alpha + bg[i] * (1 - alpha) for i in range(3))
    assert _ratio(fg, chip_bg) >= 4.5, f".sev-{sev} on {bg_name}: {_ratio(fg, chip_bg):.2f}:1"


@pytest.mark.parametrize("bg_name", ["surface", "stripe", "card"])
def test_dark_id_cell_meets_aa(bg_name):
    decl = _rule(r"(?m)^\.finding-id-cell(?=\s*\{)")
    L, C, h, _ = _oklch(decl, "color")
    assert _ratio(_oklch_to_rgb(L, C, h), DARK_BGS[bg_name]) >= 4.5


def test_hues_preserved():
    expected = {"critical": 15, "low": 155, "info": 220}
    for sev, hue in expected.items():
        _, _, h, _ = _oklch(_rule(r"(?m)^\.sev-" + sev + r"(?![\w-])(?=\s*\{)"), "color")
        assert h == hue
    assert _oklch(_rule(r"(?m)^\.finding-id-cell(?=\s*\{)"), "color")[2] == 260
