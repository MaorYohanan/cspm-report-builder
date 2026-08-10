from __future__ import annotations

import calendar
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from backend.database import db
from backend.models import Finding, Product, ProductMemoryEntry, ReportSnapshot
from backend.scan_state import scan_jobs as _scan_jobs, scan_jobs_lock as _lock
from backend.services.auth_service import require_role
from backend.graphql.queries import QUERY_TYPE_MAP
from backend.services.wiz_service import WizService, build_bulk_filter

pipeline_bp = Blueprint("pipeline", __name__)
_log = logging.getLogger(__name__)

_FREQ_MONTHS = {
    "monthly": 1,
    "quarterly": 3,
    "annual": 12,
}

_STATUS_ORDER = {"overdue": 0, "due_this_month": 1, "upcoming": 2, "no_scans": 3}

# Completed scan jobs are kept in _scan_jobs for this many seconds so in-flight
# polls can still read the final status, then they are evicted.
_SCAN_JOB_TTL = 600  # 10 minutes


# ── Helpers ──────────────────────────────────────────────────────────────────

def _evict_stale_scan_jobs() -> None:
    """Remove completed/errored scan jobs older than _SCAN_JOB_TTL seconds.
    Must be called with _lock already held by the caller.
    """
    cutoff = time.monotonic() - _SCAN_JOB_TTL
    stale = [
        sid for sid, job in _scan_jobs.items()
        if job.get("status") in ("done", "error") and job.get("completed_at", 0) < cutoff
    ]
    for sid in stale:
        _scan_jobs.pop(sid, None)


def _safe_id(v) -> str | None:
    v = str(v or "").strip()
    return v if v else None


def _add_months(dt: datetime, months: int) -> datetime:
    total_months = dt.month + months - 1
    year = dt.year + total_months // 12
    month = total_months % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def _last_published(product_id: str) -> ReportSnapshot | None:
    return (
        ReportSnapshot.query
        .filter_by(product_id=product_id, status="published")
        .order_by(ReportSnapshot.published_at.desc())
        .first()
    )


def _pipeline_status(published_at: datetime | None, frequency: str) -> tuple[str, str | None]:
    if published_at is None:
        return "no_scans", None

    months = _FREQ_MONTHS.get(frequency, 3)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=UTC)
    next_due = _add_months(published_at, months)
    today = datetime.now(UTC)

    if next_due < today:
        status = "overdue"
    elif next_due.year == today.year and next_due.month == today.month:
        status = "due_this_month"
    else:
        status = "upcoming"

    return status, next_due.strftime("%Y-%m-%dT%H:%M:%SZ")


def _next_major_version(product_id: str) -> tuple[str, str]:
    """Return (version_str, "major") for a new scan.

    Uses id DESC so that a published snapshot always beats an old abandoned draft.
    Raises ValueError("draft_exists") if the most recent snapshot is a draft.
    """
    last = (
        ReportSnapshot.query
        .filter_by(product_id=product_id)
        .order_by(ReportSnapshot.id.desc())
        .first()
    )
    if last is None:
        return "1.0", "major"
    if last.status == "draft":
        raise ValueError("draft_exists")
    try:
        major = int(last.version.split(".")[0])
    except (ValueError, AttributeError):
        major = 1
    return f"{major + 1}.0", "major"


def _extract_finding_title(f: dict) -> str:
    """Mirror wizi.js import function title extraction for exception-key matching.

    Each branch matches the corresponding importXxxFinding function so that
    titles stored by the UI (via saveToProductMemory) round-trip correctly.
    """
    qtype = f.get("queryType", "")

    if qtype == "issues":
        rules = f.get("sourceRules") or []
        rule_name = rules[0].get("name") if rules else ""
        return rule_name or f.get("description") or f.get("id", "")

    if qtype == "configurationFindings":
        rule = f.get("rule") or {}
        return rule.get("name") or f.get("name") or ""

    if qtype == "inventoryFindings":
        rule = f.get("rule") or {}
        return rule.get("name") or f"Inventory Finding {f.get('id', '')}"

    if qtype == "vulnerabilityFindings":
        return f.get("name") or f.get("detailedName") or ""

    if qtype == "hostConfigurationRuleAssessments":
        rule = f.get("rule") or {}
        return rule.get("name") or ""

    if qtype == "dataFindingsV2":
        classifier = f.get("dataClassifier") or {}
        return f.get("name") or classifier.get("name") or ""

    if qtype == "secretInstances":
        rule = f.get("rule") or {}
        return f.get("name") or rule.get("name") or ""

    if qtype == "excessiveAccessFindings":
        return f.get("name") or ""

    if qtype == "networkExposures":
        entity = f.get("exposedEntity") or {}
        return "Network Exposure — " + (entity.get("name") or f.get("id", ""))

    if qtype == "endOfLifeFindings":
        tech = f.get("technology") or {}
        asset = f.get("vulnerableAsset") or {}
        res = f.get("resource") or {}
        tech_label = f.get("detailedName") or tech.get("name") or "End of Life Asset"
        if not f.get("detailedName") and tech.get("version"):
            tech_label = tech_label + " " + tech.get("version")
        resource_name = asset.get("name") or res.get("name") or ""
        return tech_label + (" — " + resource_name if resource_name else "")

    if qtype == "malwareFindings":
        return f.get("name") or f"Malware Finding {f.get('id', '')}".strip()

    if qtype == "softwareSupplyChainFindings":
        res = f.get("resource") or {}
        pkg_name = f.get("packageName") or f.get("name") or "Software Package"
        pkg_version = f.get("packageVersion") or ""
        return pkg_name + (" " + pkg_version if pkg_version else "") + (" — " + res["name"] if res.get("name") else "")

    return f.get("name") or ""


def _extract_rule_id(f: dict) -> str:
    """Return a stable rule-level key for aggregating findings across subscriptions.

    Mirrors getWiziRuleId() from wizi.js: uses the rule/CVE/classifier ID so the
    same rule found in multiple subscriptions collapses into one Finding record.
    """
    qtype = f.get("queryType", "")
    fid = f.get("id", "")

    if qtype == "issues":
        rules = f.get("sourceRules") or []
        return (rules[0].get("id") or rules[0].get("name") if rules else "") or fid

    if qtype in ("configurationFindings", "hostConfigurationRuleAssessments", "inventoryFindings"):
        rule = f.get("rule") or {}
        return rule.get("id") or rule.get("shortId") or fid

    if qtype == "vulnerabilityFindings":
        return f.get("name") or f.get("detailedName") or fid

    if qtype == "endOfLifeFindings":
        return f.get("detailedName") or f.get("name") or fid

    if qtype == "dataFindingsV2":
        cls = f.get("dataClassifier") or {}
        return cls.get("id") or cls.get("name") or fid

    if qtype == "secretInstances":
        rule = f.get("rule") or {}
        return f.get("name") or rule.get("name") or fid

    if qtype == "excessiveAccessFindings":
        return f.get("name") or fid

    if qtype == "softwareSupplyChainFindings":
        return (f.get("packageName") or "") + "@" + (f.get("packageVersion") or "")

    if qtype == "networkExposures":
        return (f.get("type") or "") + "_" + (f.get("portRange") or "")

    return fid


# ── Finding-transformation helpers (mirror importXxxFinding in wizi.js) ──────

_SEV_MAP = {
    "CRITICAL": "critical", "HIGH": "high", "MEDIUM": "medium",
    "LOW": "low", "INFORMATIONAL": "info", "INFO": "info", "NONE": "info",
}
_SEV_LABELS = {
    "critical": "קריטי", "high": "גבוה", "medium": "בינוני",
    "low": "נמוך", "info": "מידע",
}


def _map_severity(sev: str) -> str:
    return _SEV_MAP.get((sev or "").upper(), "medium")


def _map_category_from_entity(entity: dict) -> str:
    """Mirror mapWiziCategory() from wizi.js."""
    t = (entity.get("type") or "").lower()
    nt = (entity.get("nativeType") or "").lower()
    if "kubernetes" in t or "k8s" in nt or "kube" in nt:
        return "KSPM"
    if "database" in t or "storage" in t or "rds" in nt or "s3" in nt:
        return "DSPM"
    if "network" in t or "firewall" in t or "security_group" in t or "securitygroup" in nt:
        return "NEXP"
    if "iam" in t or "role" in t or "policy" in t or "iam" in nt:
        return "EAPM"
    if "virtual_machine" in t or "host" in t or "ec2" in nt or "vm" in nt:
        return "HSPM"
    if "secret" in t or "secret" in nt:
        return "SECR"
    return "CSPM"


def _extract_recs(rule: dict, sev_label: str) -> list:
    """Mirror extractRecommendations() from wizi.js."""
    recs: list = []
    ri = (rule.get("remediationInstructions") or "").strip()
    if ri:
        cleaned = re.sub(r'```(?:\w*\n)?([\s\S]*?)```', lambda m: m.group(1).strip(), ri)
        cleaned = re.sub(r'\s*\n\s*', '\n', cleaned)
        for line in cleaned.split('\n'):
            line = line.strip()
            if len(line) < 15 or re.match(r'^note:', line, re.IGNORECASE):
                continue
            recs.append(line)

    if not recs and rule.get("description"):
        for s in re.split(r'(?:\.\s+|\n)', rule["description"]):
            s = re.sub(r'\s+', ' ', s).strip()
            if re.match(r'^this rule (checks|fails|skips|is)', s, re.IGNORECASE):
                continue
            if re.search(r'it is recommended|you should|we recommend|consider ', s, re.IGNORECASE) and 20 <= len(s) < 400:
                recs.append(s.rstrip('.'))

    if not recs:
        recs.append(f'לטפל בממצא בהתאם לרמת החומרה ({sev_label})')
    return recs


def _first_sentence(text: str) -> str:
    if not text:
        return ""
    lines = [s.strip() for s in re.split(r'[.\n]', text) if s.strip()]
    return lines[0] if lines else ""


def _transform_finding(f: dict, cat_counters: dict) -> dict:
    """Transform a raw Wiz API node into the enriched finding format.

    Mirrors importIssueFinding / importConfigFinding / … from wizi.js so that
    pipeline-scan findings are stored in the same shape as Wizi-bulk-import
    findings and the report editor can render them without special-casing.
    """
    qtype = f.get("queryType", "")
    subs = f.get("_subscriptions") or []
    owner = ", ".join(subs) if subs else (f.get("_sourceSubscription") or "")

    # ── issues ────────────────────────────────────────────────────────────────
    if qtype == "issues":
        rules = f.get("sourceRules") or []
        rule = rules[0] if rules else {}
        entity = f.get("entitySnapshot") or {}
        sev = _map_severity(f.get("severity", ""))
        cat = _map_category_from_entity(entity)
        sev_label = _SEV_LABELS.get(sev, sev)
        title = rule.get("name") or f.get("description") or f"Wiz Issue {f.get('id', '')}"
        description = f.get("description") or rule.get("name") or ""
        impact = f"חשיפת משאב לסיכון ברמת {sev_label}"
        if entity.get("name"):
            impact += f" — {entity['name']}"
        technical: list = []
        for key, label in [("cloudPlatform", "Cloud"), ("subscriptionName", "Subscription"),
                            ("region", "Region"), ("name", "Entity"), ("nativeType", "Type")]:
            if entity.get(key):
                technical.append(f"{label}: {entity[key]}")
        fs = _first_sentence(rule.get("description", ""))
        if fs:
            technical.append(f"Rule: {fs}")
        recs = _extract_recs(rule, sev_label)
        projects = [p.get("name") for p in (f.get("projects") or []) if p.get("name")]
        if projects:
            owner = ", ".join(projects)
        elif entity.get("subscriptionName") and not owner:
            owner = entity["subscriptionName"]
        policies: list = []

    # ── configurationFindings ─────────────────────────────────────────────────
    elif qtype == "configurationFindings":
        rule = f.get("rule") or {}
        resource = f.get("resource") or {}
        sub = resource.get("subscription") or {}
        sev = _map_severity(f.get("severity", ""))
        cat = "CSPM"
        sev_label = _SEV_LABELS.get(sev, sev)
        title = rule.get("name") or f.get("name") or f"Config Finding {f.get('id', '')}"
        description = f.get("name") or rule.get("name") or ""
        impact = f"חשיפת משאב לסיכון ברמת {sev_label}"
        if resource.get("name"):
            impact += f" — {resource['name']}"
        technical = []
        for key, label in [("cloudProvider", "Cloud"), ("name", "Subscription")]:
            if sub.get(key):
                technical.append(f"{label}: {sub[key]}")
        for key, label in [("region", "Region"), ("name", "Resource")]:
            if resource.get(key):
                technical.append(f"{label}: {resource[key]}")
        rtype = resource.get("nativeType") or resource.get("type") or ""
        if rtype:
            technical.append(f"Type: {rtype}")
        if f.get("result"):
            technical.append(f"Result: {f['result']}")
        fs = _first_sentence(rule.get("description", ""))
        if fs:
            technical.append(f"Rule Detail: {fs}")
        recs = _extract_recs(rule, sev_label)
        # Map securitySubCategories → framework names (same logic as JS)
        _framework_priority = [
            "ISO 27001", "NIST CSF", "CIS Controls", "PCI-DSS", "SOC 2",
            "NIST 800-53", "NIST CSF 2.0", "DORA", "NIS2", "CSA CCM",
            "AWS Security Best Practices", "CIS AWS Benchmark", "C5", "IT Security Standards",
        ]
        _framework_patterns = [
            (re.compile(r'^(?:Organizational|Technological|People) controls', re.I), "ISO 27001"),
            (re.compile(r'^\d+ (?:Inventory and Control|Secure Configuration|Account Management|Access Control Management|Malware Defenses|Network Infrastructure|Network Monitoring|Penetration Testing|Reduce Attack|Prevent Compromise|Restrict Internet)', re.I), "CIS Controls"),
            (re.compile(r'^Data and Infrastructure Security|^Access control of cloud service|^Technical vulnerability management|^Security in development', re.I), "CSA CCM"),
            (re.compile(r'^(?:SI|AC|AU|CA|CM|CP|IA|IR|MA|MP|PE|PL|PM|PS|RA|SA|SC|SE) ', re.I), "NIST 800-53"),
            (re.compile(r'^Art \d+.*CHAPTER', re.I), "DORA"),
            (re.compile(r'^Article \d+.*Cybersecurity', re.I), "NIS2"),
            (re.compile(r'^(?:ID|PR|DE|RS|RC|GV)\.[A-Z]{2}', re.I), "NIST CSF"),
            (re.compile(r'^PROTECT -|^IDENTIFY -|^DETECT -|^RESPOND -|^RECOVER -|^GOVERN -', re.I), "NIST CSF 2.0"),
            (re.compile(r'^Elastic Compute Cloud|^Amazon |^AWS ', re.I), "AWS Security Best Practices"),
            (re.compile(r'^A\d+ ', re.I), "CIS AWS Benchmark"),
            (re.compile(r'^\d+\.\d+ (?:System components|Malicious software|Restrict physical|Maintain a policy|Build and maintain|Protect stored|Encrypt transmission|Track and monitor|Regularly test)', re.I), "PCI-DSS"),
            (re.compile(r'^CC\d+', re.I), "SOC 2"),
            (re.compile(r'^Patch Management|^Software & Application Management', re.I), "IT Security Standards"),
        ]
        policy_set: set = set()
        for sc in (f.get("securitySubCategories") or []):
            cat_name = ((sc.get("category") or {}).get("name") or "").strip()
            sc_title = sc.get("title") or ""
            full_text = f"{cat_name} {sc_title}" if cat_name else sc_title
            for pat, name in _framework_patterns:
                if pat.match(full_text) or pat.match(cat_name):
                    policy_set.add(name)
                    break
        policies = [fw for fw in _framework_priority if fw in policy_set][:4]
        if not owner:
            owner = sub.get("name") or ""

    # ── vulnerabilityFindings ─────────────────────────────────────────────────
    elif qtype == "vulnerabilityFindings":
        sev = _map_severity(f.get("severity", ""))
        cat = "VULN"
        sev_label = _SEV_LABELS.get(sev, sev)
        title = f.get("name") or f.get("detailedName") or f"Vuln Finding {f.get('id', '')}"
        description = f.get("CVEDescription") or f.get("description") or title
        impact = f"פגיעות ברמת {sev_label}"
        score = f.get("score")
        if score is not None:
            impact += f" (CVSS: {score})"
        if f.get("hasExploit"):
            impact += " — קיים Exploit ידוע"
        technical = []
        if score is not None:
            technical.append(f"CVSS Score: {score}")
        if f.get("version"):
            technical.append(f"Affected Version: {f['version']}")
        if f.get("hasExploit"):
            technical.append("Exploit Available: כן")
        if f.get("hasFix"):
            technical.append("Fix Available: כן")
        if f.get("fixedVersion"):
            technical.append(f"Fixed Version: {f['fixedVersion']}")
        projects = [p.get("name") for p in (f.get("projects") or []) if p.get("name")]
        if projects:
            technical.append(f"Projects: {', '.join(projects)}")
        if f.get("firstDetectedAt"):
            technical.append(f"First Detected: {f['firstDetectedAt'][:10]}")
        recs = []
        if f.get("remediation"):
            recs.append(f.get("remediation"))
        if f.get("fixedVersion"):
            recs.append(f"עדכון לגרסה: {f['fixedVersion']}")
        if not recs:
            recs.append(f"לטפל בפגיעות בהתאם לרמת החומרה ({sev_label})")
        policies = []
        if not owner and projects:
            owner = ", ".join(projects)

    # ── hostConfigurationRuleAssessments ─────────────────────────────────────
    elif qtype == "hostConfigurationRuleAssessments":
        rule = f.get("rule") or {}
        res = f.get("resource") or {}
        sub = res.get("subscription") or {}
        sev = _map_severity(f.get("severity", ""))
        cat = "HSPM"
        sev_label = _SEV_LABELS.get(sev, sev)
        title = rule.get("name") or f"Host Config Finding {f.get('id', '')}"
        description = rule.get("name") or ""
        impact = f"חשיפת Host לסיכון ברמת {sev_label}"
        if res.get("name"):
            impact += f" — {res['name']}"
        technical = []
        if res.get("cloudPlatform"):
            technical.append(f"Cloud: {res['cloudPlatform']}")
        if sub.get("name"):
            technical.append(f"Subscription: {sub['name']}")
        for key, label in [("region", "Region"), ("name", "Resource"), ("nativeType", "Type")]:
            if res.get(key):
                technical.append(f"{label}: {res[key]}")
        if f.get("result"):
            technical.append(f"Result: {f['result']}")
        if f.get("filePath"):
            technical.append(f"File Path: {f['filePath']}")
        fs = _first_sentence(rule.get("description", ""))
        if fs:
            technical.append(f"Rule Detail: {fs}")
        recs = _extract_recs(rule, sev_label)
        policies = []
        if not owner:
            owner = sub.get("name") or ""

    # ── malwareFindings ───────────────────────────────────────────────────────
    elif qtype == "malwareFindings":
        res = f.get("resource") or {}
        account = res.get("cloudAccount") or {}
        file_details = f.get("fileDetails") or {}
        clf = f.get("classification") or {}
        clf_label = " / ".join(filter(None, [clf.get("familyName"), clf.get("type"), clf.get("platform")]))
        sev = _map_severity(f.get("severity", ""))
        cat = "HSPM"
        sev_label = _SEV_LABELS.get(sev, sev)
        title = f.get("name") or f"Malware Finding {f.get('id', '')}"
        description = f.get("description") or (clf_label + " malware detected" if clf_label else title)
        impact = f"זוהתה תוכנה זדונית ברמת חומרה {sev_label}"
        if res.get("name"):
            impact += f" — {res['name']}"
        technical = []
        if account.get("cloudProvider"):
            technical.append(f"Cloud: {account['cloudProvider']}")
        if account.get("name"):
            technical.append(f"Subscription: {account['name']}")
        if res.get("name"):
            technical.append(f"Resource: {res['name']}")
        rtype = res.get("nativeType") or res.get("type") or ""
        if rtype:
            technical.append(f"Type: {rtype}")
        if file_details.get("path"):
            technical.append(f"File Path: {file_details['path']}")
        if clf_label:
            technical.append(f"Classification: {clf_label}")
        if f.get("detectionType"):
            technical.append(f"Detection Type: {f['detectionType']}")
        if f.get("confidenceLevel"):
            technical.append(f"Confidence: {f['confidenceLevel']}")
        if f.get("sha256"):
            technical.append(f"SHA256: {f['sha256']}")
        recs = [
            "לבצע בידוד מיידי של המשאב הנגוע",
            f"לזהות ולהסיר את קובץ התוכנה הזדונית: {file_details.get('path', 'לא ידוע')}",
            "לבצע סריקה מלאה של הסביבה לזיהוי התפשטות",
        ]
        policies = []
        projects = [p.get("name") for p in (f.get("projects") or []) if p.get("name")]
        if projects:
            owner = ", ".join(projects)
        elif not owner:
            owner = account.get("name") or ""

    # ── dataFindingsV2 ────────────────────────────────────────────────────────
    elif qtype == "dataFindingsV2":
        classifier = f.get("dataClassifier") or {}
        entity = f.get("graphEntity") or {}
        account = f.get("cloudAccount") or {}
        sev = _map_severity(f.get("severity", ""))
        cat = "DSPM"
        sev_label = _SEV_LABELS.get(sev, sev)
        title = f.get("name") or classifier.get("name") or f"Data Finding {f.get('id', '')}"
        description = f"זוהה מידע רגיש מסוג {classifier.get('name') or f.get('name') or 'לא ידוע'}"
        if entity.get("name"):
            description += f" במשאב {entity['name']}"
        impact = f"חשיפת נתונים רגישים ברמת {sev_label}"
        if classifier.get("category"):
            impact += f" (קטגוריה: {classifier['category']})"
        technical = []
        if account.get("cloudProvider"):
            technical.append(f"Cloud: {account['cloudProvider']}")
        if account.get("name"):
            technical.append(f"Account: {account['name']}")
        if entity.get("name"):
            technical.append(f"Entity: {entity['name']}")
        if entity.get("type"):
            technical.append(f"Type: {entity['type']}")
        if classifier.get("category"):
            technical.append(f"Category: {classifier['category']}")
        recs = ["לבצע סיווג נתונים ולהגדיר בקרות גישה מתאימות", "לוודא הצפנת נתונים רגישים"]
        policies = []
        if not owner:
            owner = account.get("name") or ""

    # ── secretInstances ───────────────────────────────────────────────────────
    elif qtype == "secretInstances":
        rule = f.get("rule") or {}
        res = f.get("resource") or {}
        sev = _map_severity(f.get("severity", ""))
        cat = "SECR"
        sev_label = _SEV_LABELS.get(sev, sev)
        title = f.get("name") or rule.get("name") or f"Secret Finding {f.get('id', '')}"
        description = f"זוהה סוד חשוף מסוג {f.get('type') or title or 'לא ידוע'}"
        impact = f"חשיפת סוד ברמת {sev_label} — עלול לאפשר גישה לא מורשית למשאבים"
        technical = []
        if res.get("cloudPlatform"):
            technical.append(f"Cloud: {res['cloudPlatform']}")
        for key, label in [("name", "Resource"), ("nativeType", "Type"), ("region", "Region")]:
            if res.get(key):
                technical.append(f"{label}: {res[key]}")
        if f.get("type"):
            technical.append(f"Secret Type: {f['type']}")
        if f.get("path"):
            technical.append(f"Path: {f['path']}")
        recs = ["לבצע רוטציה מיידית של הסוד החשוף", "להעביר סודות ל-Secrets Manager / Key Vault"]
        policies = []
        if not owner:
            owner = res.get("name") or res.get("cloudPlatform") or ""

    # ── excessiveAccessFindings ───────────────────────────────────────────────
    elif qtype == "excessiveAccessFindings":
        principal = f.get("principal") or {}
        ge = principal.get("graphEntity") or {}
        ca = principal.get("cloudAccount") or {}
        sev = _map_severity(f.get("severity", ""))
        cat = "EAPM"
        sev_label = _SEV_LABELS.get(sev, sev)
        title = f.get("name") or f"Excessive Access {f.get('id', '')}"
        description = f.get("description") or title
        impact = f"הרשאות יתר ברמת {sev_label}"
        if ge.get("name"):
            impact += f" — {ge['name']}"
        if ge.get("type"):
            impact += f" ({ge['type']})"
        technical = []
        if f.get("cloudPlatform"):
            technical.append(f"Cloud: {f['cloudPlatform']}")
        if ca.get("name"):
            technical.append(f"Account: {ca['name']}")
        if ge.get("name"):
            technical.append(f"Principal: {ge['name']}")
        if ge.get("type"):
            technical.append(f"Principal Type: {ge['type']}")
        if f.get("remediationType"):
            technical.append(f"Remediation Type: {f['remediationType']}")
        for pol in (f.get("involvedPolicies") or []):
            if isinstance(pol, dict):
                pname = pol.get("name", str(pol))
                ptype = pol.get("type", "")
                technical.append(f"  • {pname}{(' (' + ptype + ')') if ptype else ''}")
        fake_rule = {
            "remediationInstructions": f.get("remediationInstructions") or "",
            "description": f.get("description") or "",
        }
        recs = _extract_recs(fake_rule, sev_label)
        policies = []
        if not owner:
            owner = ca.get("name") or ""

    # ── networkExposures ──────────────────────────────────────────────────────
    elif qtype == "networkExposures":
        entity = f.get("exposedEntity") or {}
        cat = "NEXP"
        is_public = "0.0.0.0" in (f.get("sourceIpRange") or "")
        sev = "high" if is_public else "medium"
        sev_label = _SEV_LABELS.get(sev, sev)
        title = f"Network Exposure — {entity.get('name') or f.get('id', '')}"
        description = f"חשיפת רשת של {entity.get('name') or 'משאב'} מ-{f.get('sourceIpRange') or 'unknown'}"
        if f.get("portRange"):
            description += f" בפורטים {f['portRange']}"
        impact = f"חשיפת רשת ברמת {sev_label}"
        if is_public:
            impact += " — המשאב נגיש מהאינטרנט (0.0.0.0/0)"
        technical = []
        if entity.get("name"):
            technical.append(f"Entity: {entity['name']}")
        if entity.get("type"):
            technical.append(f"Type: {entity['type']}")
        if f.get("sourceIpRange"):
            technical.append(f"Source IP: {f['sourceIpRange']}")
        if f.get("portRange"):
            technical.append(f"Port Range: {f['portRange']}")
        if f.get("type"):
            technical.append(f"Exposure Type: {f['type']}")
        recs = []
        if is_public:
            recs.append("להגביל גישה מ-0.0.0.0/0 לטווחי IP ספציפיים")
        recs.extend(["לוודא שרק פורטים נדרשים פתוחים", "להשתמש ב-Private Endpoint / VPN במידת האפשר"])
        policies = []
        if not owner:
            owner = entity.get("name") or ""

    # ── inventoryFindings ─────────────────────────────────────────────────────
    elif qtype == "inventoryFindings":
        rule = f.get("rule") or {}
        res = f.get("resource") or {}
        ca = res.get("cloudAccount") or {}
        sev = _map_severity(f.get("severity", ""))
        cat = "EOLM"
        sev_label = _SEV_LABELS.get(sev, sev)
        title = rule.get("name") or f"Inventory Finding {f.get('id', '')}"
        description = f.get("name") or rule.get("name") or ""
        impact = f"משאב בסוף חיים (EOL) ברמת {sev_label}"
        if res.get("name"):
            impact += f" — {res['name']}"
        technical = []
        if res.get("cloudPlatform"):
            technical.append(f"Cloud: {res['cloudPlatform']}")
        if ca.get("name"):
            technical.append(f"Account: {ca['name']}")
        for key, label in [("region", "Region"), ("name", "Resource"), ("nativeType", "Type")]:
            if res.get(key):
                technical.append(f"{label}: {res[key]}")
        fs = _first_sentence(rule.get("description", ""))
        if fs:
            technical.append(f"Rule Detail: {fs}")
        recs = ["לעדכן או להחליף את המשאב לגרסה נתמכת", "לתכנן מיגרציה בהתאם ללוח הזמנים של הספק"]
        policies = []
        if not owner:
            owner = ca.get("name") or ""

    # ── endOfLifeFindings ─────────────────────────────────────────────────────
    elif qtype == "endOfLifeFindings":
        tech = f.get("technology") or {}
        asset = f.get("vulnerableAsset") or {}
        res = f.get("resource") or {}
        ca = res.get("cloudAccount") or {}
        sev = _map_severity(f.get("severity", ""))
        cat = "EOLM"
        sev_label = _SEV_LABELS.get(sev, sev)
        tech_label = f.get("detailedName") or tech.get("name") or "End of Life Asset"
        if not f.get("detailedName") and tech.get("version"):
            tech_label += f" {tech['version']}"
        resource_name = asset.get("name") or res.get("name") or ""
        subscription_name = asset.get("subscriptionName") or ca.get("name") or ""
        eol_date = tech.get("endOfLifeDate") or ""
        vendor_status = tech.get("vendorSupportStatus") or ""
        title = tech_label + (f" — {resource_name}" if resource_name else "")
        description = f"{tech_label} הגיע לסוף תמיכה (EOL)"
        if eol_date:
            description += f" בתאריך {eol_date}"
        if vendor_status:
            description += f". סטטוס תמיכת ספק: {vendor_status}"
        impact = f"רכיב בסוף חיים ברמת {sev_label}"
        if resource_name:
            impact += f" — {resource_name}"
        if eol_date:
            impact += f" (EOL: {eol_date})"
        technical = []
        cloud = subscription_name or res.get("cloudPlatform") or ""
        if cloud:
            technical.append(f"Subscription: {cloud}")
        if resource_name:
            technical.append(f"Resource: {resource_name}")
        asset_type = asset.get("type") or res.get("nativeType") or ""
        if asset_type:
            technical.append(f"Type: {asset_type}")
        ver = f.get("version") or tech.get("version") or ""
        if ver:
            technical.append(f"Version: {ver}")
        if eol_date:
            technical.append(f"EOL Date: {eol_date}")
        if vendor_status:
            technical.append(f"Vendor Support Status: {vendor_status}")
        if f.get("hasFix"):
            fv = f.get("fixedVersion") or ""
            technical.append(f"Fix Available: Yes{(' (' + fv + ')') if fv else ''}")
        recs = [
            f"לשדרג את {tech_label} לגרסה נתמכת בהקדם",
            "לתכנן מיגרציה בהתאם ללוח הזמנים של הספק",
            "לבחון חשיפות אבטחה הנובעות מחוסר עדכוני אבטחה ב-EOL",
        ]
        policies = []
        if not owner:
            owner = subscription_name

    # ── softwareSupplyChainFindings ───────────────────────────────────────────
    elif qtype == "softwareSupplyChainFindings":
        res = f.get("resource") or {}
        ca = res.get("cloudAccount") or {}
        sev = _map_severity(f.get("severity", ""))
        cat = "EOLM"
        sev_label = _SEV_LABELS.get(sev, sev)
        pkg_name = f.get("packageName") or f.get("name") or "Software Package"
        pkg_version = f.get("packageVersion") or ""
        title = pkg_name + (f" {pkg_version}" if pkg_version else "") + (f" — {res['name']}" if res.get("name") else "")
        description = f"ממצא אבטחה בשרשרת האספקה: {pkg_name}"
        if pkg_version:
            description += f" גרסה {pkg_version}"
        if res.get("name"):
            description += f" ב-{res['name']}"
        impact = f"רכיב תוכנה ברמת {sev_label}"
        if res.get("name"):
            impact += f" — {res['name']}"
        technical = []
        if res.get("cloudPlatform"):
            technical.append(f"Cloud: {res['cloudPlatform']}")
        if ca.get("name"):
            technical.append(f"Account: {ca['name']}")
        for key, label in [("region", "Region"), ("name", "Resource"), ("nativeType", "Type")]:
            if res.get(key):
                technical.append(f"{label}: {res[key]}")
        if pkg_name:
            technical.append(f"Package: {pkg_name}")
        if pkg_version:
            technical.append(f"Version: {pkg_version}")
        recs = [
            f"לעדכן את {pkg_name} לגרסה נתמכת ומאובטחת",
            "לבחון את תלויות שרשרת האספקה ולצמצם חשיפה",
            "לבדוק אם קיימים ניצולים ידועים (CVEs) עבור גרסה זו",
        ]
        policies = []
        if not owner:
            owner = ca.get("name") or ""

    # ── fallback ──────────────────────────────────────────────────────────────
    else:
        sev = _map_severity(f.get("severity", ""))
        cat = "CSPM"
        sev_label = _SEV_LABELS.get(sev, sev)
        title = f.get("name") or f.get("description") or f"Finding {f.get('id', '')}"
        description = title
        impact = f"ממצא ברמת {sev_label}"
        technical = []
        recs = [f"לטפל בממצא בהתאם לרמת החומרה ({sev_label})"]
        policies = []

    # Generate sequential ID per category (mirrors generateNextId() in wizi.js)
    cat_counters[cat] = cat_counters.get(cat, 0) + 1
    finding_id = f"{cat}-{cat_counters[cat]:03d}"

    return {
        "id": finding_id,
        "category": cat,
        "title": title,
        "severity": sev,
        "description": description,
        "impact": impact,
        "technical": technical,
        "policies": policies,
        "recs": recs,
        "priority": "",
        "owner": owner,
        "evidence": [],
        "exception": {"active": False, "reason": ""},
        "notes": [],
    }


def _fetch_qtype(wiz, qtype: str, sub_name: str, sub_ids: list, sub_ext_ids: list, sub_names: list) -> tuple:
    """Fetch one query type for one subscription. Runs in a thread-pool worker."""
    filter_by = build_bulk_filter(qtype, sub_ids, sub_ext_ids, sub_names)
    nodes = wiz.fetch_all_findings_paginated(qtype, filter_by)
    for n in nodes:
        n["queryType"] = qtype
        n["_sourceSubscription"] = sub_name
    return qtype, nodes


def _aggregate_vulns(vuln_nodes: list) -> dict:
    """Combine all vulnerability findings into a single summary finding.

    Mirrors the wizi.js >5-vuln special-case aggregation so pipeline scans
    produce one tidy VULN finding instead of hundreds of individual CVE rows.
    """
    weights = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    crit_count = high_count = 0
    highest_sev = "high"
    resource_names: list = []
    subscription_names: list = []

    for item in vuln_nodes:
        sev = _map_severity(item.get("severity", ""))
        if sev == "critical":
            crit_count += 1
            highest_sev = "critical"
        elif sev == "high":
            high_count += 1

        asset = item.get("vulnerableAsset") or {}
        res_name = asset.get("name") or ""
        if res_name and res_name not in resource_names:
            resource_names.append(res_name)

        sub_name = (item.get("_sourceSubscription") or "")
        if sub_name and sub_name not in subscription_names:
            subscription_names.append(sub_name)

    total = len(vuln_nodes)
    technical: list = [f"Total Vulnerabilities: {total}"]
    if crit_count:
        technical.append(f"Critical: {crit_count}")
    if high_count:
        technical.append(f"High: {high_count}")
    if resource_names:
        technical.append(f"Affected Resources: {', '.join(resource_names)}")
    if subscription_names:
        technical.append(f"Subscriptions: {', '.join(subscription_names)}")

    return {
        "id": "VULN-001",
        "category": "VULN",
        "title": "Multiple vulnerabilities with high and above severity",
        "severity": highest_sev,
        "description": f"נמצאו {total} פגיעויות ברמת חומרה גבוהה ומעלה",
        "impact": f"פגיעויות מרובות ברמת חומרה גבוהה ומעלה — {crit_count} קריטיות, {high_count} גבוהות",
        "technical": technical,
        "policies": [],
        "recs": ["לטפל בפגיעויות בהתאם לרמת החומרה ולעדכן את הרכיבים הפגיעים"],
        "priority": "",
        "owner": ", ".join(subscription_names),
        "evidence": [],
        "exception": {"active": False, "reason": ""},
        "notes": [],
    }


def _run_wiz_fetch(app, snapshot_id: int, selected_subs: list) -> None:
    """Background thread: fetch from Wiz and persist findings to the snapshot."""
    with app.app_context():
        client_id = os.environ.get("WIZI_CLIENT_ID", "")
        client_secret = os.environ.get("WIZI_CLIENT_SECRET", "")
        api_url = os.environ.get("WIZI_API_URL", "https://api.il1.app.wiz.io/graphql")
        auth_url = os.environ.get("WIZI_AUTH_URL", "https://auth.app.wiz.io/oauth/token")

        if not client_id or not client_secret:
            with _lock:
                if snapshot_id in _scan_jobs:
                    _scan_jobs[snapshot_id]["status"] = "error"
                    _scan_jobs[snapshot_id]["error"] = "Wiz credentials not configured"
            return

        wiz = WizService(
            client_id=client_id,
            client_secret=client_secret,
            api_url=api_url,
            auth_url=auth_url,
        )

        QUERY_TYPES = list(QUERY_TYPE_MAP.keys())
        scan_total = len(selected_subs) * len(QUERY_TYPES)
        done = 0

        # Pre-authenticate once so thread-pool workers share the cached token
        # without racing on the OAuth refresh path.
        wiz._get_token()

        try:
            # Aggregate by (queryType, ruleId) across all subscriptions.
            # Same rule in multiple subscriptions → one Finding record with
            # all contributing subscriptions listed in _subscriptions.
            aggregated: dict = {}

            for sub_name in selected_subs:
                resolved = wiz.resolve_subscription(sub_name)
                if not resolved["ids"] and not resolved["externalIds"]:
                    raise RuntimeError(
                        f"Subscription '{sub_name}' not found in Wiz cloud accounts. "
                        "Verify the subscription name in product settings exactly "
                        "matches a Wiz cloud account name."
                    )
                sub_ids = resolved["ids"]
                sub_ext_ids = resolved["externalIds"]
                sub_names = resolved.get("names", [])
                _log.info(
                    "pipeline fetch: sub=%r ids=%s extIds=%s",
                    sub_name, sub_ids, sub_ext_ids,
                )

                # Run all query types for this subscription in parallel (max 3
                # concurrent Wiz API calls to stay within rate limits).
                futures = {}
                with ThreadPoolExecutor(max_workers=3) as pool:
                    for qtype in QUERY_TYPES:
                        fut = pool.submit(
                            _fetch_qtype, wiz, qtype,
                            sub_name, sub_ids, sub_ext_ids, sub_names,
                        )
                        futures[fut] = qtype

                    for fut in as_completed(futures):
                        qtype = futures[fut]
                        try:
                            _, nodes = fut.result()
                            for n in nodes:
                                key = (qtype, _extract_rule_id(n))
                                if key in aggregated:
                                    subs = aggregated[key]["_subscriptions"]
                                    if sub_name not in subs:
                                        subs.append(sub_name)
                                else:
                                    n["_subscriptions"] = [sub_name]
                                    aggregated[key] = n
                        except Exception as exc:
                            _log.warning(
                                "pipeline fetch skipped %s/%s: %s",
                                sub_name, qtype, exc,
                            )
                        done += 1
                        with _lock:
                            if snapshot_id in _scan_jobs:
                                _scan_jobs[snapshot_id].update(
                                    done=done, total=scan_total
                                )

            raw_findings = list(aggregated.values())

            # ── VULN aggregation ─────────────────────────────────────────────
            # Combine all vulnerability findings into a single summary finding
            # (mirrors wizi.js >5-vuln special-case) so the report shows one
            # tidy VULN finding instead of hundreds of individual CVE rows.
            vuln_raw = [f for f in raw_findings if f.get("queryType") == "vulnerabilityFindings"]
            other_raw = [f for f in raw_findings if f.get("queryType") != "vulnerabilityFindings"]
            findings_to_store = other_raw + ([_aggregate_vulns(vuln_raw)] if vuln_raw else [])

            snap = db.session.get(ReportSnapshot, snapshot_id)
            # DEV-CRIT-3: abort if snapshot was published while we were fetching
            if snap is None or snap.status == "published":
                _log.error("scan aborted: snapshot %s is published or missing", snapshot_id)
                with _lock:
                    if snapshot_id in _scan_jobs:
                        _scan_jobs[snapshot_id]["status"] = "error"
                        _scan_jobs[snapshot_id]["error"] = "aborted: snapshot was published"
                if snap is not None:
                    _d = dict(snap.snapshot_data or {})
                    _d["_scan_status"] = "error"
                    _d["_scan_error"] = "aborted: snapshot was published"
                    snap.snapshot_data = _d
                    db.session.commit()
                return
            excepted_entries = ProductMemoryEntry.query.filter_by(
                product_id=snap.product_id, source="excepted"
            ).all()
            # Dict mapping (subscription, title) → entry object so we can read .reason
            exception_keys = {(e.subscription, e.title): e for e in excepted_entries}
            deleted_entries = ProductMemoryEntry.query.filter_by(
                product_id=snap.product_id, source="deleted"
            ).all()
            deleted_keys = {(e.subscription, e.title) for e in deleted_entries}

            weights = {"critical": 4, "high": 3, "medium": 2, "low": 1}
            risk = 0
            cat_counters: dict = {}

            # Batch-flush every 200 findings to keep each write transaction short.
            # Use written_count (not enumerate index) so skipped findings do not
            # distort the flush interval or the final reported count.
            _BATCH = 200
            written_count = 0
            for raw in findings_to_store:
                # Aggregated VULN finding is already in enriched format;
                # all other raw nodes need transformation.
                if raw.get("id") == "VULN-001" and raw.get("category") == "VULN":
                    enriched = raw
                else:
                    enriched = _transform_finding(raw, cat_counters)
                sev = enriched.get("severity") or ""
                title = enriched.get("title", "").lower().strip()
                sub = (raw.get("_sourceSubscription") or "").lower().strip()
                # DEV-CRIT-2: skip findings that the user has permanently deleted
                if (sub, title) in deleted_keys:
                    continue
                mem_entry = exception_keys.get((sub, title))
                is_excepted = mem_entry is not None
                if is_excepted:
                    enriched["exception"] = {"active": True, "reason": mem_entry.reason or ""}
                db.session.add(Finding(
                    snapshot_id=snapshot_id,
                    severity=sev,
                    finding_data=enriched,
                    exception_active=is_excepted,
                ))
                if not is_excepted:
                    risk += weights.get(sev, 0)
                written_count += 1
                if written_count % _BATCH == 0:
                    db.session.flush()

            # Final commit + update snapshot metadata
            snap = db.session.get(ReportSnapshot, snapshot_id)
            snap.risk_score = risk
            snap_data = dict(snap.snapshot_data or {})
            snap_data["findings_count"] = written_count
            snap_data["_scan_status"] = "done"
            snap.snapshot_data = snap_data

            product = db.session.get(Product, snap.product_id)
            if product:
                product.latest_risk_score = risk

            db.session.commit()

            with _lock:
                if snapshot_id in _scan_jobs:
                    _scan_jobs[snapshot_id]["status"] = "done"
                    _scan_jobs[snapshot_id]["findings_count"] = written_count
                    _scan_jobs[snapshot_id]["completed_at"] = time.monotonic()

        except Exception as exc:
            db.session.rollback()
            _log.error("Background Wiz fetch failed for snapshot %s: %s", snapshot_id, exc, exc_info=True)
            with _lock:
                if snapshot_id in _scan_jobs:
                    _scan_jobs[snapshot_id]["status"] = "error"
                    _scan_jobs[snapshot_id]["error"] = str(exc)
                    _scan_jobs[snapshot_id]["completed_at"] = time.monotonic()
            try:
                snap = db.session.get(ReportSnapshot, snapshot_id)
                if snap:
                    _d = dict(snap.snapshot_data or {})
                    _d["_scan_status"] = "error"
                    _d["_scan_error"] = str(exc)
                    snap.snapshot_data = _d
                    db.session.commit()
            except Exception:
                pass  # best-effort; in-memory status already set
        finally:
            # Release the thread-local session back to the pool so the
            # SQLite connection is not kept open past this thread's lifetime.
            db.session.remove()


# ── Routes ───────────────────────────────────────────────────────────────────

@pipeline_bp.route("/api/pipeline", methods=["GET"])
@require_role("viewer")
def get_pipeline():
    # Single query: for each product, find the most recent published snapshot.
    # Subquery: per product_id, the highest snapshot id among published rows.
    latest_pub_sq = (
        db.session.query(
            ReportSnapshot.product_id,
            func.max(ReportSnapshot.id).label("max_id"),
        )
        .filter(ReportSnapshot.status == "published")
        .group_by(ReportSnapshot.product_id)
        .subquery()
    )
    # LEFT OUTER JOIN so products with no published snapshot still appear.
    # select_from(Product) anchors the FROM clause to products only — without it
    # SQLAlchemy puts both mapped entities in FROM producing a cartesian product.
    results = (
        db.session.query(Product, ReportSnapshot)
        .select_from(Product)
        .outerjoin(latest_pub_sq, latest_pub_sq.c.product_id == Product.id)
        .outerjoin(ReportSnapshot, ReportSnapshot.id == latest_pub_sq.c.max_id)
        .order_by(Product.name)
        .all()
    )

    rows = []
    for p, snap in results:
        published_at = snap.published_at if snap else None
        status, next_due = _pipeline_status(published_at, p.scan_frequency)

        published_iso = None
        if published_at:
            if published_at.tzinfo is None:
                published_at = published_at.replace(tzinfo=UTC)
            published_iso = published_at.strftime("%Y-%m-%dT%H:%M:%SZ")

        rows.append({
            "id": p.id,
            "name": p.name,
            "owner": p.owner,
            "env": p.env,
            "scanFrequency": p.scan_frequency,
            "subscriptionIds": p.subscription_ids or [],
            "lastPublishedAt": published_iso,
            "lastPublishedVersion": snap.version if snap else None,
            "nextDueAt": next_due,
            "status": status,
        })

    rows.sort(key=lambda r: (_STATUS_ORDER.get(r["status"], 9), r["name"]))
    return jsonify(rows), 200


@pipeline_bp.route("/api/pipeline/<product_id>/start-scan", methods=["POST"])
@require_role("editor")
def start_scan(product_id):
    """Create a new draft snapshot and start a background Wiz fetch."""
    safe_id = _safe_id(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    if not os.environ.get("WIZI_CLIENT_ID") or not os.environ.get("WIZI_CLIENT_SECRET"):
        return jsonify({"error": "Wiz integration not configured"}), 501

    product = db.session.get(Product, safe_id)
    if product is None:
        return jsonify({"error": "Product not found"}), 404

    data = request.get_json(force=True, silent=True) or {}
    selected_subs = data.get("subscription_ids", [])
    if not selected_subs or not isinstance(selected_subs, list):
        return jsonify({"error": "No subscriptions selected"}), 400
    if not all(isinstance(s, str) and 0 < len(s) <= 200 for s in selected_subs):
        return jsonify({"error": "Invalid subscription_ids"}), 400
    allowed = set(product.subscription_ids or [])
    if not allowed or not all(s in allowed for s in selected_subs):
        return jsonify({"error": "subscription_ids must be a subset of the product's configured subscriptions"}), 400

    try:
        version, ver_type = _next_major_version(safe_id)
    except ValueError as exc:
        if str(exc) == "draft_exists":
            return jsonify({
                "error": "draft_exists",
                "message": "טיוטה פעילה קיימת. השלם או מחק אותה לפני פתיחת סריקה חדשה.",
            }), 409
        raise

    last = _last_published(safe_id)
    snap_data = dict(last.snapshot_data) if last else {}

    # Ensure a minimal meta block exists so the report editor can open this
    # snapshot without the "JSON format mismatch" error from applySnapshot().
    if "meta" not in snap_data:
        snap_data["meta"] = {
            "client": product.name,
            "subscriptionIds": ", ".join(selected_subs),
            "reportVersion": "1.0",
        }

    scan_total = len(selected_subs) * len(QUERY_TYPE_MAP)
    snap_data["_scan_status"] = "fetching"
    snap_data["_scan_total"] = scan_total

    new_snap = ReportSnapshot(
        product_id=safe_id,
        version=version,
        version_type=ver_type,
        version_notes="",
        status="draft",
        saved_at=datetime.now(UTC),
        risk_score=0,
        snapshot_data=snap_data,
    )
    db.session.add(new_snap)
    try:
        db.session.flush()
        snapshot_id = new_snap.id
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({
            "error": "draft_exists",
            "message": "טיוטה פעילה קיימת. השלם או מחק אותה לפני פתיחת סריקה חדשה.",
        }), 409

    with _lock:
        _scan_jobs[snapshot_id] = {
            "status": "fetching",
            "done": 0,
            "total": scan_total,
            "findings_count": 0,
            "error": None,
            "product_id": safe_id,  # cached for ownership check without a DB round-trip
        }

    app_obj = current_app._get_current_object()
    t = threading.Thread(
        target=_run_wiz_fetch,
        args=(app_obj, snapshot_id, selected_subs),
        daemon=True,
    )
    t.start()

    return jsonify({"snapshot_id": snapshot_id, "version": version, "status": "fetching"}), 202


@pipeline_bp.route("/api/pipeline/<product_id>/scan-status/<int:snapshot_id>", methods=["GET"])
@require_role("viewer")
def get_scan_status(product_id, snapshot_id):
    """Poll the status of an in-progress background scan."""
    safe_id = _safe_id(product_id)
    if not safe_id:
        return jsonify({"error": "Invalid parameter"}), 400

    with _lock:
        _evict_stale_scan_jobs()
        job = _scan_jobs.get(snapshot_id)
        if job is not None:
            # Ownership check via the cached product_id — no DB round-trip needed.
            if job.get("product_id") != safe_id:
                return jsonify({"error": "Job not found"}), 404
            # Strip internal fields before returning to the client.
            public = {k: v for k, v in job.items() if k not in ("product_id", "completed_at")}
            return jsonify(public), 200

    # Job not in this worker — read status from DB (handles multi-worker gunicorn)
    snap = db.session.get(ReportSnapshot, snapshot_id)
    if snap is None or snap.product_id != safe_id:
        return jsonify({"error": "Job not found"}), 404

    scan_data = snap.snapshot_data or {}
    scan_status = scan_data.get("_scan_status")
    total = scan_data.get("_scan_total", 0)

    if scan_status == "fetching":
        return jsonify({"status": "fetching", "done": 0, "total": total,
                        "findings_count": 0, "error": None}), 200
    elif scan_status == "done":
        return jsonify({"status": "done", "done": total, "total": total,
                        "findings_count": scan_data.get("findings_count", 0), "error": None}), 200
    elif scan_status == "error":
        return jsonify({"status": "error", "done": 0, "total": total,
                        "findings_count": 0,
                        "error": scan_data.get("_scan_error", "שגיאה לא ידועה")}), 200
    else:
        return jsonify({"error": "Job not found"}), 404
