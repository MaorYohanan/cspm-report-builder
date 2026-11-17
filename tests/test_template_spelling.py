"""Spell / style guard for the smart finding templates (template-fill.js and secret-fill.js).

There is no Hebrew spell-check dictionary in the project, so this renders every template variant with
sample data (full, singular / plural, and empty) and checks the text for known misspellings and for
Hebrew writing mistakes the templates are prone to. Add a word to MISSPELLED when a typo is found.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent.parent / "static" / "js" / "src"
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")

# wrong form -> correct form
MISSPELLED = {
    "קובץים": "קבצים", "הקובץים": "הקבצים", "מפתחים פרטיים": "מפתחות פרטיים", "הרשאים": "הרשאות",
    "שירותות": "שירותים", "תעודים": "תעודות", "סיסמאות": None,  # None = allowed, kept to show the format
}
HEB = "א-ת"
PATTERNS = {
    "Hebrew prefix hyphenated to a Hebrew word (write ב-service but בשרת)": re.compile(rf"(?<![{HEB}A-Za-z])[בלמהכוש]-[{HEB}]"),
    "double space": re.compile(r"[^\s] {2,}[^\s]"),
    "space before punctuation": re.compile(r" [.,;:]( |$)"),
    "doubled word": re.compile(rf"\b([{HEB}]{{2,}}) \1\b"),
    "doubled punctuation": re.compile(r"[.,]{2,}"),
}

TECH_GIT = ["Cloud: AWS", "Resource: a/img@1", "Type: image", "Secret Type: GIT_CREDENTIAL", "Path: /a/b.md"]
SECRET_CASES = [
    ("secret-git", "Git Credentials (https://u:---REDACTED---@github.com/o/r.git) in Scripts and Code", TECH_GIT),
    ("secret-git", "Git Credentials (https://---REDACTED---@h.com/o/r.git)", ["Affected Paths (2): /a.sh, /b.sh", "Type: virtualMachine", "Resource: x, y"]),
    ("secret-git", "", []),
    ("secret-private-key", "Private Key in Certificates and Keys", ["Resource: c", "Type: hostedContainer", "Affected Paths (3): /a.pem, /b.key, /c.key"]),
    ("secret-private-key", "SSH Private Key", ["Resource: v", "Type: virtualMachine", "Path: /h/.ssh/id_rsa"]),
    ("secret-private-key", "", []),
    ("secret-cloud-key", "AWS Access Key (AccessKeyId=AKIAAAAAAAAAAAAAAAAA)", ["Cloud: AWS", "Path: /x/.env"]),
    ("secret-cloud-key", "AWS Access Key", ["Cloud: AWS", "Path: /h/.bash_history", "AccessKeyIds: ASIAAAAAAAAAAAAAAAA1", "ASIAAAAAAAAAAAAAAAA2"]),
    ("secret-cloud-key", "GCP Service Account Key (ServiceAccount=s@p.iam.gserviceaccount.com)", ["Cloud: GCP", "Resource: r", "Type: run#revision", "Path: /app/k.json"]),
    ("secret-cloud-key", "", []),
    ("secret-gcp-refresh", "GCP Refresh Token in Log Files", ["Resource: v", "Type: compute#instance", "Path: /h/.config/gcloud/logs/1/x.log"]),
    ("secret-gcp-refresh", "GCP Refresh Token", ["Resource: v", "Affected Paths (2): /h/.config/gcloud/credentials.db, /h/legacy_credentials/a@b.gov.il/adc.json"]),
    ("secret-api-token", "GitHub Fine-grained PAT in Scripts and Code", ["Resource: v", "Type: virtualMachine", "Path: /a/.env"]),
    ("secret-api-token", "OpenAI Project-based API Key in Dedicated Secret Files", ["Resource: s", "Type: run#revision", "Path: /app/.env"]),
    ("secret-api-token", "", []),
]

# every CONFIG variant is rendered with one resource, several resources (cut by Wiz) and none
_CFG_ONE = ["Region: me-west1", "Subscription: s1", "Resource: r1", "- Linux Ubuntu."]
_CFG_MANY = ["Region: me-west1, us-east1", "Subscription: s1, s2", "Resource: r1, r2, r3 ועוד 4...", "- OpenSSL, EOL date 2025-01-31.", "- pkg:python/boto."] + [f"- c{i}." for i in range(9)]
_CFG_NONE = ["Cloud: GCP"]
CONFIG_VARIANTS = ["vpc-any-ip", "vpc-private-networks", "vpc-all-ports", "vpc-uncommon-ports", "vpc-vnc", "subnet-private-google-access",
                   "default-service-account", "hspm-kernel-modules", "hspm-cups-browsed", "hspm-redis-protected-mode",
                   "hspm-redis-password", "eolm-end-of-life"]
CONFIG_TECH = [[v, t] for v in CONFIG_VARIANTS for t in (_CFG_ONE, _CFG_MANY, _CFG_NONE)]


def _eapm_cases():
    sa = {"title": "x", "description": "ל-service account `a@p.iam.gserviceaccount.com` מוקצה ה-role `Editor`. role זה כולל 3 שירותים ו-30 הרשאות.",
          "technical": ["Principal Type: SERVICE_ACCOUNT", "Remediation Type: DETACH_POLICY"], "recs": ""}
    rep = dict(sa, technical=["Principal Type: SERVICE_ACCOUNT", "Remediation Type: REPLACE_POLICY"],
               description="`1` unused services and `1` unused permissions", recs="")
    aws = {"title": "AWS excessive access for role r", "description": "policy `P` role `r` 2 permissions",
           "technical": ["Principal: r", "Remediation Type: DETACH_POLICY"], "recs": ""}
    out = []
    for v in ("gcp-sa", "gcp-user", "gcp-group", "aws-role"):
        for src in (sa, rep, aws, {"title": "", "description": "", "technical": [], "recs": ""}):
            out.append((v, src))
    out.append(("aws-role", dict(aws, technical=["Principal: r", "Remediation Type: DELETE_PRINCIPAL"])))
    return out


def _render():
    """Every text field of every template variant, as (label, text) pairs."""
    script = f"""
import * as t from {json.dumps((SRC / 'template-fill.js').as_uri())};
import * as s from {json.dumps((SRC / 'secret-fill.js').as_uri())};
import * as c from {json.dumps((SRC / 'config-fill.js').as_uri())};
const config = {json.dumps(CONFIG_TECH)};
const secret = {json.dumps(SECRET_CASES)};
const eapm = {json.dumps(_eapm_cases())};
const out = [];
for (const [v, title, tech] of secret) {{
  const src = {{title, technical: tech}};
  const b = s.buildSecretFinding(v, s.extractSecretData(src), title);
  for (const [k, val] of Object.entries(b.fields)) out.push([v + ' ' + k, val]);
}}
for (const [v, src] of eapm) {{
  const b = t.buildEapmFinding(v, t.extractEapmData(src));
  for (const [k, val] of Object.entries(b.fields)) out.push([v + ' ' + k, val]);
}}
for (const [v, tech] of config) {{
  for (const t of c.configDropdownEntries().filter(e => e.smart === v)) {{
    const b = c.buildConfigFinding(v, c.extractConfigData({{technical: tech}}), t.title);
    for (const [k, val] of Object.entries(b.fields)) out.push([v + ' ' + k, val]);
  }}
}}
console.log(JSON.stringify(out));
"""
    r = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True, timeout=60)
    return json.loads(r.stdout)


@pytest.fixture(scope="module")
def rendered():
    return _render()


def test_templates_render_something(rendered):
    labels = {label.split(" ")[0] for label, _ in rendered}
    assert {"secret-git", "secret-private-key", "secret-cloud-key", "secret-gcp-refresh", "secret-api-token",
            "gcp-sa", "gcp-user", "gcp-group", "aws-role"} | set(CONFIG_VARIANTS) <= labels


def test_no_known_misspellings(rendered):
    bad = [(label, wrong, right) for label, text in rendered for wrong, right in MISSPELLED.items()
           if right and wrong in text]
    assert not bad, f"misspelled words in templates: {bad}"


@pytest.mark.parametrize("name", list(PATTERNS))
def test_no_hebrew_writing_mistakes(rendered, name):
    hits = []
    for label, text in rendered:
        for line in text.split("\n"):
            m = PATTERNS[name].search(line)
            if m:
                hits.append((label, line[max(0, m.start() - 15): m.end() + 15]))
    assert not hits, f"{name}: {hits[:5]}"


def test_backticks_balanced(rendered):
    bad = [label for label, text in rendered for line in text.split("\n") if line.count("`") % 2]
    assert not bad, f"unbalanced backticks in: {sorted(set(bad))}"
