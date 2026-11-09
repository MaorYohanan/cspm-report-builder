"""BL-24: Product Memory matching for exception carry-forward.

Single Python definition of

* the stable rule key (``<queryType>|<rule id>``, lower-cased) -- mirrored by
  ``buildRuleKey`` in ``static/js/src/memory-match.js`` (a cross-language test
  keeps both in step), and
* the matching algorithm used when a new scan is stored: stable rule key first,
  ``(subscription, title)`` as the fallback.

Matching rules
--------------
* A finding carries a list of candidate subscriptions (its source subscription
  plus every contributing subscription of an aggregated pipeline finding).
* Exact match: an entry whose ``(subscription, title)`` equals a candidate pair.
* Rule match: an entry with the same ``rule_key`` whose subscription is one of
  the candidate subscriptions.  The subscription must agree, so a rule that was
  excepted in subscription A never silently excepts the same rule in B.  A rule
  match without an exact match is *loose* (the title changed).
* Aggregated (cross-subscription) pipeline findings list every contributing
  subscription as a candidate, so an entry in ANY contributing subscription
  matches (flagged loose where only the rule key matched).  Intentional.
* A loose (rule-only) 'deleted' match never drops a finding: it is kept visible
  as a flagged exception (``_matchedLoosely``), like the browser.  Only an exact
  (subscription, title) deleted match drops.  A loose match that is only a
  temp_excepted entry never sets the loose flag (the finding stays active).
* Per memory source the exact entry wins over a rule entry.  Precedence between
  sources is unchanged from before: deleted drops the finding, then excepted,
  then acknowledged; temp_excepted is independent (reminder + single use).
"""
from __future__ import annotations

from typing import Any, Iterable

SOURCES = ("excepted", "deleted", "temp_excepted", "acknowledged")

# Query types whose Wiz nodes expose a stable rule id.
_RULE_ID_TYPES = ("configurationFindings", "hostConfigurationRuleAssessments", "inventoryFindings")


def rule_key_for(node: dict) -> str | None:
    """Return ``<queryType>|<rule id>`` (lower-cased) for a raw Wiz node, or None.

    Only types with a real rule id get a key; types without one
    (secrets, excessive access, EOL, supply chain, network exposure, data,
    vulnerabilities) stay on title matching.  Never falls back to the
    instance/issue id, which changes on every scan.
    """
    qtype = (node.get("queryType") or "").strip()
    rid = None
    if qtype == "issues":
        rules = node.get("sourceRules") or []
        first = rules[0] if rules and isinstance(rules[0], dict) else {}
        rid = first.get("id") or (node.get("control") or {}).get("id")
    elif qtype in _RULE_ID_TYPES:
        rid = (node.get("rule") or {}).get("id")
    if not qtype or rid is None or str(rid).strip() == "":
        return None
    return f"{qtype}|{str(rid).strip()}".lower()


def norm(value: str | None) -> str:
    return (value or "").lower().strip()


class MemoryIndex:
    """Lookup structure over ProductMemoryEntry rows (objects with
    ``id, subscription, title, source, reason, rule_key``)."""

    def __init__(self, entries: Iterable[Any]):
        self.entries = sorted(entries, key=lambda e: e.id or 0)
        self.by_key: dict[tuple[str, str], Any] = {}
        self.by_rule: dict[str, list] = {}
        for e in self.entries:
            self.by_key[(norm(e.subscription), norm(e.title))] = e
            rk = norm(getattr(e, "rule_key", None))
            if rk:
                self.by_rule.setdefault(rk, []).append(e)

    def resolve(self, title: str, rule_key: str | None, subs: list[str]) -> "Resolution":
        subs = [s for s in dict.fromkeys(norm(s) for s in subs) if s]
        title = norm(title)
        exact: dict[str, Any] = {}
        for s in subs:
            e = self.by_key.get((s, title))
            if e is not None:
                exact.setdefault(e.source, e)
        by_rule: dict[str, Any] = {}
        rk = norm(rule_key)
        if rk:
            for e in self.by_rule.get(rk, []):
                if norm(e.subscription) in subs:
                    by_rule.setdefault(e.source, e)
        # Every rule-matching entry in an agreeing subscription counts as "seen"
        # (even superseded duplicates), so they are not reported as stale.
        matched = list(exact.values())
        if rk:
            matched += [e for e in self.by_rule.get(rk, []) if norm(e.subscription) in subs]
        return Resolution(exact, by_rule, matched)


class Resolution:
    def __init__(self, exact: dict, by_rule: dict, matched: list):
        self.exact = exact
        self.by_rule = by_rule
        self.matched = matched

    def pick(self, source: str):
        """Return ``(entry, loose)`` for a memory source, or ``(None, False)``."""
        if source in self.exact:
            return self.exact[source], False
        if source in self.by_rule:
            return self.by_rule[source], True
        return None, False


def in_scope(sub: str, scope: set[str]) -> bool:
    """True when an entry's subscription belongs to the scanned scope.

    The aggregated VULN finding is stored under the comma-joined subscription
    names, so a joined value is in scope when every part is.
    """
    s = norm(sub)
    if s in scope:
        return True
    if "," in s:
        parts = [p.strip() for p in s.split(",") if p.strip()]
        return bool(parts) and all(p in scope for p in parts)
    return False


def compute_unmatched(entries: Iterable[Any], matched_ids: set, scope_subs: Iterable[str],
                      failed_types: Iterable[str] | None = None) -> list[dict]:
    """Entries (all sources) in scope that matched no finding in this scan.

    ``failed_types``: query types that failed / were not fetched.  Absence of
    their findings proves nothing, so entries with a rule key of such a type are
    skipped, and so are title-only entries (no rule key: cannot be attributed to
    a type) whenever any type failed.
    """
    scope = {norm(s) for s in scope_subs if norm(s)}
    failed = {norm(t) for t in (failed_types or []) if norm(t)}
    out = []
    for e in sorted(entries, key=lambda x: x.id or 0):
        if e.id in matched_ids:
            continue
        if not in_scope(e.subscription, scope):
            continue
        if failed:
            rk = norm(getattr(e, "rule_key", None))
            if not rk or rk.split("|", 1)[0] in failed:
                continue
        out.append({
            "subscription": e.subscription,
            "title": e.title,
            "source": e.source,
            "reason": e.reason or "",
            "ruleKey": getattr(e, "rule_key", None),
        })
    return out
