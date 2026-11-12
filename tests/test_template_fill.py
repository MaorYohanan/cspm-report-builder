"""Smart EAPM templates (static/js/src/template-fill.js): data is pulled from the open finding."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

MOD = (Path(__file__).resolve().parent.parent / "static" / "js" / "src" / "template-fill.js").as_uri()

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def _run(variant, src):
    script = (
        f"import * as m from {json.dumps(MOD)};"
        f"const src = {json.dumps(src)};"
        f"const d = m.extractEapmData(src);"
        f"console.log(JSON.stringify({{data: d, built: m.buildEapmFinding({json.dumps(variant)}, d)}}));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


GCP_SA_EN = {
    "title": "GCP excessive access for service account subnet-calculator@dgt-gcp-cgov-net-office-0.iam.gserviceaccount.com",
    "description": ("The service account `subnet-calculator@dgt-gcp-cgov-net-office-0.iam.gserviceaccount.com` is currently "
                    "assigned the `Compute Network Admin` role, but it has `10` unused services and `775` unused permissions "
                    "that can be **fully removed** without losing any functionality."),
    "technical": ["Cloud: GCP",
                  "Principal: projects/dgt-gcp-cgov-net-office-0/serviceAccounts/subnet-calculator@dgt-gcp-cgov-net-office-0.iam.gserviceaccount.com",
                  "Principal Type: SERVICE_ACCOUNT", "Remediation Type: DETACH_POLICY"],
    "recs": ['gcloud projects remove-iam-policy-binding dgt-gcp-cgov-net-office-0 --member="serviceAccount:x@y" --role="roles/compute.networkAdmin"'],
}


def test_gcp_service_account_english_wiz_text_fills_everything():
    r = _run("gcp-sa", GCP_SA_EN)
    d, b = r["data"], r["built"]
    assert d["serviceAccount"] == "subnet-calculator@dgt-gcp-cgov-net-office-0.iam.gserviceaccount.com"
    assert (d["role"], d["services"], d["permissions"], d["project"], d["roleId"]) == \
        ("Compute Network Admin", 10, 775, "dgt-gcp-cgov-net-office-0", "compute.networkAdmin")
    assert b["missing"] == []
    f = b["fields"]
    assert f["title"].endswith("subnet-calculator@dgt-gcp-cgov-net-office-0.iam.gserviceaccount.com")
    assert "`Compute Network Admin`" in f["description"] and "10 שירותים ו-775 הרשאות" in f["description"]
    assert "ניתן להסיר" in f["description"]                                   # DETACH_POLICY wording
    assert 'gcloud projects remove-iam-policy-binding dgt-gcp-cgov-net-office-0 --member="serviceAccount:subnet-calculator@' in f["recs"]
    assert 'roles/compute.networkAdmin"' in f["recs"]
    assert "<" not in f["recs"] and "<" not in f["description"]


def test_gcp_service_account_hebrew_text_and_replace_policy():
    r = _run("gcp-sa", {
        "title": "GCP excessive access for service account t-flow-gke-mng@dgt-gcp-ssrv-t-flow.iam.gserviceaccount.com",
        "description": "ל-service account `t-flow-gke-mng@dgt-gcp-ssrv-t-flow.iam.gserviceaccount.com` מוקצה ה-role מסוג `Kubernetes Engine Admin`. role זה כולל 3 שירותים ו-366 הרשאות שאינם בשימוש.",
        "technical": ["Cloud: GCP", "Principal: projects/dgt-gcp-ssrv-t-flow/serviceAccounts/t-flow-gke-mng@dgt-gcp-ssrv-t-flow.iam.gserviceaccount.com",
                      "Principal Type: SERVICE_ACCOUNT", "Remediation Type: REPLACE_POLICY"],
        "recs": "יש לבדוק האם ניתן לצמצם הרשאות.",
    })
    d, f = r["data"], r["built"]["fields"]
    assert (d["role"], d["services"], d["permissions"], d["project"]) == ("Kubernetes Engine Admin", 3, 366, "dgt-gcp-ssrv-t-flow")
    assert "3 שירותים ו-366 הרשאות" in f["description"] and "custom role" in f["description"]
    assert "gcloud" not in f["recs"]            # replace-policy: no remove-binding command


def test_single_service_and_default_google_sa():
    r = _run("gcp-sa", {
        "title": "GCP excessive access for service account 183967726178-compute@developer.gserviceaccount.com",
        "description": "The service account `183967726178-compute@developer.gserviceaccount.com` is currently assigned the `Service Usage Admin` role, but it has `1` unused service and `10` unused permissions.",
        "technical": ["Principal: 183967726178-compute@developer.gserviceaccount.com", "Remediation Type: DETACH_POLICY"],
    })
    f = r["built"]["fields"]
    assert "שירות אחד ו-10 הרשאות" in f["description"]
    assert "ברירת המחדל של גוגל" in f["recs"]
    assert "PROJECT_ID" in r["built"]["missing"] and "ROLE_ID" in r["built"]["missing"]   # nothing says the project / role id
    assert "<PROJECT_ID>" in f["recs"]


def test_gcp_group():
    r = _run("gcp-group", {
        "title": "GCP excessive access for group flowdevops",
        "description": "לקבוצת `flowdevops` מוקצה תפקיד `Storage Admin` הכולל שירות אחד ו-32 הרשאות שאינם בשימוש.",
        "technical": ["Cloud: GCP", "Principal: flowdevops", "Principal Type: GROUP", "Remediation Type: REPLACE_POLICY"],
    })
    d, f = r["data"], r["built"]["fields"]
    assert (d["group"], d["role"], d["services"], d["permissions"]) == ("flowdevops", "Storage Admin", 1, 32)
    assert f["title"] == "GCP excessive access for group flowdevops"
    assert "שירות אחד ו-32 הרשאות" in f["description"] and r["built"]["missing"] == []


def test_aws_unused_role_is_deleted():
    r = _run("aws-role", {
        "title": "AWS excessive access for role Dynatrace_monitoring_role",
        "description": "ה-role `Dynatrace_monitoring_role` אינו בשימוש. מחיקתו תאפשר עמידה בעקרון ה-least privilege.",
        "technical": ["Cloud: AWS", "Principal: Dynatrace_monitoring_role", "Principal Type: SERVICE_ACCOUNT", "Remediation Type: DELETE_PRINCIPAL"],
    })
    f = r["built"]["fields"]
    assert "`Dynatrace_monitoring_role` אינו בשימוש" in f["description"] and "למחוק" in f["description"]
    assert r["built"]["missing"] == []


def test_aws_policy_replace_with_only_permissions():
    r = _run("aws-role", {
        "title": "AWS excessive access for role ecr-secret-updater-govforms-preprod-eks-2",
        "description": "The role `ecr-secret-updater-govforms-preprod-eks-2` currently has the policy `ecr-secret-updater-govforms-preprod-eks-2` attached, but it has `4` unused permissions. This policy can therefore be **replaced**.",
        "technical": ["Cloud: AWS", "Principal: ecr-secret-updater-govforms-preprod-eks-2", "Remediation Type: REPLACE_POLICY"],
    })
    d, f = r["data"], r["built"]["fields"]
    assert (d["roleName"], d["policy"], d["services"], d["permissions"]) == \
        ("ecr-secret-updater-govforms-preprod-eks-2", "ecr-secret-updater-govforms-preprod-eks-2", None, 4)
    assert "4 הרשאות שאינם בשימוש" in f["description"] and "custom policy" in f["description"]
    assert r["built"]["missing"] == []          # no services is normal for AWS policies


def test_missing_data_leaves_visible_placeholders_and_reports_them():
    r = _run("gcp-sa", {"title": "", "description": "", "technical": "", "recs": ""})
    b = r["built"]
    assert "SERVICE_ACCOUNT_EMAIL" in b["missing"] and "ROLE" in b["missing"]
    assert "<SERVICE_ACCOUNT_EMAIL>" in b["fields"]["title"]
    assert "<UNUSED_SERVICES> שירותים ו-<UNUSED_PERMISSIONS> הרשאות" in b["fields"]["description"]


def test_unknown_variant_returns_null():
    assert _run("nope", {})["built"] is None


def test_gcp_user_replace_policy_with_display_name_and_project_from_wiz_gcloud():
    r = _run("gcp-user", {
        "title": "GCP excessive access for user rachelsi@digital.gov.il",
        "description": ("The user `rachelsi@digital.gov.il` is currently assigned the `Compute Instance Admin (v1)` role, but it has "
                        "`1` unused service and `373` unused permissions. This role can therefore be **replaced** by the custom role."),
        "technical": ["Cloud: GCP", "Principal: Rachel Simon", "Principal Type: USER_ACCOUNT", "Remediation Type: REPLACE_POLICY"],
        "recs": ['gcloud projects remove-iam-policy-binding dgt-gcp-cgov-p-govextra --member="user:rachelsi@digital.gov.il" --role="roles/compute.instanceAdmin.v1"'],
    })
    d, f = r["data"], r["built"]["fields"]
    assert (d["user"], d["displayName"], d["role"], d["services"], d["permissions"], d["project"]) == \
        ("rachelsi@digital.gov.il", "Rachel Simon", "Compute Instance Admin (v1)", 1, 373, "dgt-gcp-cgov-p-govextra")
    assert f["title"] == "GCP excessive access for user rachelsi@digital.gov.il"
    assert "`rachelsi@digital.gov.il` (Rachel Simon)" in f["description"] and "שירות אחד ו-373 הרשאות" in f["description"]
    assert "custom role" in f["recs"] and "gcloud" not in f["recs"]        # replace: no remove-binding command
    assert r["built"]["missing"] == []


def test_gcp_user_detach_policy_builds_gcloud_with_user_member():
    r = _run("gcp-user", {
        "title": "GCP excessive access for user test-security-tech@digital.gov.il",
        "description": ("The user `test-security-tech@digital.gov.il` is currently assigned the `Editor (Legacy)` role, but it has "
                        "`255` unused services and `8618` unused permissions that can be **fully removed**."),
        "technical": ["Principal: test-security-tech test-security-tech", "Principal Type: USER_ACCOUNT", "Remediation Type: DETACH_POLICY"],
        "recs": 'gcloud projects remove-iam-policy-binding dgt-gcp-ssrv-s-sec-lab --member="user:test-security-tech@digital.gov.il" --role="roles/editor"',
    })
    f = r["built"]["fields"]
    assert 'gcloud projects remove-iam-policy-binding dgt-gcp-ssrv-s-sec-lab --member="user:test-security-tech@digital.gov.il" --role="roles/editor"' in f["recs"]
    assert "255 שירותים ו-8618 הרשאות" in f["description"] and "ניתן להסיר" in f["description"]
    assert r["built"]["missing"] == []


NEW_RECS = [
    'יש לבחון האם ההרשאה הנ"ל נדרשת או שניתן לצמצם הרשאות ל role יותר מתאים.',
    "במידה ונדרשות הרשאות מועטות יש לשקול ליצור custom role המכיל את ההרשאות הנדרשות בלבד.",
    "מבדיקה ב GCP IAM Recommender ניתן להסיר את כל ההרשאות המצוינות בתיאור ומפורטות בממצא ב WIZ.",
]
OLD_RECS = ["(כפי שמפורט בממצא ב-Wiz) ולהחליף בו את ה-role הנוכחי", "בהתאם ל-GCP IAM Recommender",
            "יש לבחון מה משתמש ב-SA ומדוע הוא קיבל הרשאה כל כך גבוהה"]


@pytest.mark.parametrize("remediation", ["REPLACE_POLICY", "DETACH_POLICY"])
def test_service_account_and_user_recs_start_with_the_new_three_lines(remediation):
    sa = _run("gcp-sa", {**GCP_SA_EN, "technical": ["Principal Type: SERVICE_ACCOUNT", f"Remediation Type: {remediation}"]})
    usr = _run("gcp-user", {
        "title": "GCP excessive access for user a@b.gov.il",
        "description": "The user `a@b.gov.il` is currently assigned the `Editor` role, but it has `2` unused services and `5` unused permissions.",
        "technical": [f"Remediation Type: {remediation}"], "recs": "",
    })
    for built in (sa["built"], usr["built"]):
        lines = built["fields"]["recs"].split("\n")
        assert lines[:3] == NEW_RECS
        for old in OLD_RECS:
            assert old not in built["fields"]["recs"]
