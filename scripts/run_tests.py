"""Run only the tests affected by what changed (git working tree vs HEAD, plus untracked files).

    python scripts/run_tests.py              # affected tests; browser tests only if UI files changed
    python scripts/run_tests.py --browser    # force-include browser tests
    python scripts/run_tests.py --all        # full suite incl. browser (pre-merge)
    python scripts/run_tests.py --base main  # diff against another ref (e.g. a feature branch vs main)
    python scripts/run_tests.py --list       # show the selection, run nothing

How a test file is matched to a change: a test is "affected" when its source mentions the changed
file's path or module name (e.g. `backend.routes.products`, `config-fill.js`, `pipeline.js`), or the
test file itself changed. Changes to shared plumbing (models, database, conftest, pytest.ini) run
everything except browser tests. Changes with no matching test fall back to the fast tier.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"

# Changing these can affect any test -> run the whole non-browser suite.
SHARED = ("backend/models", "backend/database", "tests/conftest.py", "pytest.ini", "requirements.txt")
# Changing these can affect the rendered page -> include browser tests.
UI_PREFIXES = ("static/js/", "static/css/", "index.html", "templates/", "app.py")


def _git(*args: str) -> list[str]:
    out = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [line for line in out.splitlines() if line.strip()]


def changed_files(base: str) -> list[str]:
    files = set(_git("diff", "--name-only", base))
    files |= set(_git("ls-files", "--others", "--exclude-standard"))
    return sorted(f.replace("\\", "/") for f in files)


def needles(rel: str) -> set[str]:
    """Strings whose presence in a test file's source links it to the changed file."""
    p = Path(rel)
    out = {rel, p.name}
    if p.suffix == ".py":
        out.add(".".join(p.with_suffix("").parts))  # backend.routes.products
        if p.stem != "__init__":
            out.add(f"{p.parent.name}.{p.stem}" if p.parent.name else p.stem)
    return {n for n in out if len(n) > 3}


def _docs_only(f: str) -> bool:
    return f.endswith((".md", ".txt", ".png")) or f.startswith(("docs/", ".plan/", "memory/"))


def select(files: list[str]) -> tuple[list[str], bool, str]:
    """Return (test file paths, include_browser, reason)."""
    if any(f.startswith(SHARED) for f in files):
        return [], False, "shared plumbing changed -> full non-browser suite"
    browser = any(f.startswith(UI_PREFIXES) for f in files)
    sources = {t: t.read_text(encoding="utf-8", errors="ignore") for t in TESTS.glob("test_*.py")}
    hit: set[str] = set()
    for f in files:
        if f.startswith("tests/") and f.endswith(".py"):
            if (ROOT / f).exists() and Path(f).name.startswith("test_"):
                hit.add(f)
            continue
        if _docs_only(f):
            continue  # docs never need tests
        ns = needles(f)
        hit.update(t.relative_to(ROOT).as_posix() for t, s in sources.items() if any(n in s for n in ns))
    return sorted(hit), browser, "matched by changed files"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all", action="store_true", help="full suite including browser tests")
    ap.add_argument("--browser", action="store_true", help="include browser tests")
    ap.add_argument("--base", default="HEAD", help="git ref to diff against (default HEAD)")
    ap.add_argument("--list", action="store_true", help="print the selection and exit")
    ap.add_argument("pytest_args", nargs="*", help="extra args passed to pytest")
    args = ap.parse_args()

    cmd = [sys.executable, "-m", "pytest", "-q"]
    if args.all:
        cmd += ["-m", ""]
        print("selection: full suite incl. browser")
    else:
        files = changed_files(args.base)
        if files and all(_docs_only(f) for f in files):
            print("only docs changed -> no tests needed")
            return 0
        tests, browser, why = select(files)
        browser = browser or args.browser
        print(f"changed: {len(files)} file(s); {why}")
        if not files:
            print("nothing changed vs", args.base, "-> running the fast tier")
        if browser:
            cmd += ["-m", ""]
        if tests and browser:
            tests = sorted(set(tests) | {t.relative_to(ROOT).as_posix() for t in TESTS.glob("test_*.py")
                                         if "sync_playwright" in t.read_text(encoding="utf-8", errors="ignore")})
        if tests:
            print("selected:", *(Path(t).name for t in tests))
            cmd += tests
        else:
            print("selected: fast tier (all non-browser tests)" + (" + browser" if browser else ""))
        if browser:
            print("browser tests included (UI files changed or --browser)")
    cmd += args.pytest_args
    if args.list:
        return 0
    return subprocess.call(cmd, cwd=ROOT)


if __name__ == "__main__":
    sys.exit(main())
