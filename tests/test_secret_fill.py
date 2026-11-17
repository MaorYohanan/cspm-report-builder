"""Smart SECR templates (static/js/src/secret-fill.js): data is pulled from the open exposed-secret finding."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

MOD = (Path(__file__).resolve().parent.parent / "static" / "js" / "src" / "secret-fill.js").as_uri()

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def _run(variant, src):
    script = (
        f"import * as m from {json.dumps(MOD)};"
        f"const src = {json.dumps(src)};"
        f"const d = m.extractSecretData(src);"
        f"console.log(JSON.stringify({{data: d, built: m.buildSecretFinding({json.dumps(variant)}, d, src.title)}}));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


GIT = {
    "title": "Git Credentials (https://aviram26:---REDACTED---@github.com/edx-olive/blender.git) in Web and API Files",
    "technical": ["Cloud: AWS", "Resource: 1.dkr.ecr.il-central-1.amazonaws.com/blender-webpage@358b1777", "Type: image",
                  "Secret Type: GIT_CREDENTIAL", "Path: /usr/src/app/build/docker/moodle/README.md"],
}


def test_git_credentials_fill_repo_user_host_and_image_rebuild():
    r = _run("secret-git", GIT)
    d, f = r["data"], r["built"]["fields"]
    assert (d["gitUser"], d["gitHost"], d["gitUrl"]) == ("aviram26", "github.com", "https://github.com/edx-olive/blender.git")
    assert r["built"]["missing"] == []
    assert f["title"] == GIT["title"]                                  # Wiz title kept
    assert "`https://github.com/edx-olive/blender.git`" in f["description"] and "container image" in f["description"]
    assert "`aviram26` ב-github.com" in f["recs"] and "לבנות מחדש את ה-image" in f["recs"]
    assert f["recs"].splitlines()[-1].startswith("להעביר את הסודות ל-Secrets Manager")


def test_git_credentials_redacted_user_and_empty_form_use_placeholder():
    r = _run("secret-git", {"title": "Git Credentials (https://---REDACTED---@github.com/hunters972/THOS.git) in Scripts and Code",
                            "technical": ["Cloud: AWS", "Type: virtualMachine", "Affected Paths (2): /a/b.sh, /c/d.sh"]})
    assert r["data"]["gitUser"] is None and r["data"]["paths"] == ["/a/b.sh", "/c/d.sh"]
    assert "ב-2 קבצים" in r["built"]["fields"]["description"] and "של המשתמש" not in r["built"]["fields"]["recs"]
    empty = _run("secret-git", {"title": "", "technical": ""})
    assert empty["built"]["missing"] == ["REPO_URL"] and "<REPO_URL>" in empty["built"]["fields"]["title"]


def test_private_key_ssh_vs_certificate_wording():
    cert = _run("secret-private-key", {"title": "Private Key in Certificates and Keys",
                                      "technical": ["Resource: controller", "Type: hostedContainer", "Secret Type: PRIVATE_KEY",
                                                    "Affected Paths (2): /etc/ssl/a.pem, /tmp/tls.key"]})["built"]["fields"]
    assert "בקונטיינר `controller`" in cert["description"] and "ב-2 קבצים" in cert["description"]
    assert cert["recs"].splitlines() == [
        'יש לבצע בדיקה מה המפתח / התעודה הנ"ל יש לבדוק האם ניתן להגדיר אותם בתוך Secret Manager או Key Vault.',
        "במידה וכן, יש לבצע זאת ולמחוק את הקובץ עם המלצה לבצע רוטציה של המפתח"]
    ssh = _run("secret-private-key", {"title": "SSH Private Key in Scripts and Code",
                                     "technical": ["Resource: vm1", "Type: virtualMachine", "Path: /home/u/.ssh/id_rsa"]})["built"]["fields"]
    assert "מפתח SSH פרטי" in ssh["description"] and ssh["recs"] == cert["recs"]


def test_aws_access_keys_temporary_and_long_lived():
    tmp = _run("secret-cloud-key", {"title": "AWS Access Key  in Scripts and Code",
                                    "technical": ["Cloud: AWS", "Resource: vm", "Type: virtualMachine", "Secret Type: CLOUD_KEY",
                                                  "Path: /home/ssm-user/.bash_history",
                                                  "AccessKeyIds: ASIAAAAAAAAAAAAAAAA1", "ASIAAAAAAAAAAAAAAAA2"]})
    assert tmp["data"]["awsKeyIds"] == ["ASIAAAAAAAAAAAAAAAA1", "ASIAAAAAAAAAAAAAAAA2"] and tmp["built"]["missing"] == []
    f = tmp["built"]["fields"]
    assert "זוהו 2 AWS Access Keys" in f["description"] and "מפתחות זמניים" in f["description"]
    assert "history" in f["recs"] and "update-access-key" not in f["recs"]
    lived = _run("secret-cloud-key", {"title": "AWS Access Key (AccessKeyId=AKIAAAAAAAAAAAAAAAAA) in Scripts and Code",
                                      "technical": ["Cloud: AWS", "Path: /x/.env"]})["built"]["fields"]
    assert "--access-key-id AKIAAAAAAAAAAAAAAAAA --status Inactive" in lived["recs"] and "history" not in lived["recs"]


def test_gcp_service_account_key():
    r = _run("secret-cloud-key", {"title": "GCP Service Account Key (ServiceAccount=sa@proj.iam.gserviceaccount.com) in Scripts and Code",
                                  "technical": ["Cloud: GCP", "Resource: svc", "Type: run#revision", "Path: /app/sa-key.json"]})
    f = r["built"]["fields"]
    assert r["built"]["missing"] == [] and "`sa@proj.iam.gserviceaccount.com`" in f["description"]
    assert "--iam-account=sa@proj.iam.gserviceaccount.com" in f["recs"] and "serverless" in f["description"]


def test_gcp_refresh_token_logs_vs_credentials_and_user_from_path():
    logs = _run("secret-gcp-refresh", {"title": "GCP Refresh Token in Log Files",
                                       "technical": ["Cloud: GCP", "Resource: vm", "Type: compute#instance",
                                                     "Path: /home/u/.config/gcloud/logs/2026.11.10/x.log"]})["built"]["fields"]
    assert "בקבצי לוג" in logs["description"] and logs["recs"].startswith("יש למחוק את קבצי הלוג")
    cred = _run("secret-gcp-refresh", {"title": "GCP Refresh Token in Dedicated Secret Files",
                                       "technical": ["Resource: vm", "Type: compute#instance",
                                                     "Affected Paths (2): /h/.config/gcloud/credentials.db, /h/.config/gcloud/legacy_credentials/tal@digital.gov.il/adc.json"]})
    assert cred["data"]["userEmail"] == "tal@digital.gov.il" and "`tal@digital.gov.il`" in cred["built"]["fields"]["description"]
    assert cred["built"]["fields"]["recs"].startswith("יש למחוק את קבצי ה-credentials")


def test_api_token_provider_specific_revoke_hint_and_unknown_variant():
    r = _run("secret-api-token", {"title": "GitHub Fine-grained PAT in Scripts and Code",
                                  "technical": ["Resource: repo-vm", "Type: virtualMachine", "Path: /a/.env"]})
    f = r["built"]["fields"]
    assert r["data"]["name"] == "GitHub Fine-grained PAT" and "`GitHub Fine-grained PAT`" in f["description"]
    assert "ב-GitHub" in f["recs"] and "היסטוריית ה-Git" in f["recs"]
    assert _run("nope", GIT)["built"] is None
