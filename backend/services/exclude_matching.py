r"""BL-37: server-side ExcludeRule matching for pipeline scans.

Mirrors ``isExcludedByRules`` / ``getWiziItemPaths`` in ``static/js/src/exclude_rules.js``
and the raw-item helpers in ``static/js/src/wizi.js`` (``getWiziItemTitle``,
``extractResourceName``, ``_resolveItemCategory``/``mapWiziCategory``) so a scan run by the
server drops exactly the raw Wiz nodes the browser import would drop.

Semantics (identical to the JS unless listed under "Differences"):

* Only active rules are applied; matching is case-insensitive (value and pattern are
  lowercased; regex runs with the ignore-case flag against the lowercased value).
* ``title`` / ``category`` rules test the item title / resolved category.
* ``path`` (legacy) excludes the item when ANY of its paths matches.
* ``title_path`` needs the title pattern AND any path to match; ``title_resource`` needs
  title AND resource (an item with no resource never matches). Their two patterns are JSON
  in ``pattern`` (``{"title":..., "resource"|"path":...}``, both non-empty strings); the
  operator applies to both.
* Rules run on RAW nodes, before consolidation, so excluded nodes never become findings.

Differences from the JS (all on the safe side, none change a valid rule's result):

* A rule that cannot be applied (unknown field/operator, malformed pair JSON, empty or
  >500-char pattern, invalid or UNSAFE regex) is SKIPPED and logged once by id. The browser
  skips an invalid regex per call too, but treats an unknown field as a ``category`` rule.
  The same validator (``regex_error``) rejects such rules when they are saved
  (``_pattern_error`` in ``backend/routes/wiz.py``), so skipping only affects legacy rows.
* Regex safety. Python ``re`` cannot be interrupted and holds the GIL, so one runaway match
  would freeze the whole process. ``regex_error`` therefore parses the pattern with the
  stdlib parser (fails closed if the parser is unavailable) and REJECTS: a repeat whose body
  holds another repeat or an alternation, unless it is just ``?`` (``(a+)+``, ``(a|aa)+``, ``(.*a){12}``, also bounded
  ``{n}``), lookaround, backreferences, atomic/possessive/conditional constructs, ``(?P<..>)``,
  adjacent unbounded repeats (``.*.*x``), more than 3 wide repeats in a ``^``-anchored pattern (2 when
  unanchored, because ``search`` retries at every offset; worst case measured ~1.5 s at 1024 chars), and anything outside a small whitelist of parser opcodes. The matched text is also
  capped at ``MAX_MATCH_TEXT`` (1024) characters: titles, resource names and paths are short.
* Regex dialect: Python ``re`` with ``re.ASCII | re.IGNORECASE``. Remaining differences
  from JS ``RegExp``:

  - ``\w`` / ``\d`` / ``\s`` are ASCII-only here (``re.ASCII``); in JS ``\s`` also
    matches Unicode spaces (NBSP, etc.), ``\w`` / ``\d`` are ASCII in both;
  - ``$`` also matches just before a trailing newline in Python (JS: only at the very end);
  - ``{,n}`` means ``{0,n}`` in Python but is a literal in JS;
  - possessive quantifiers / atomic groups (3.11+) and inline flags such as ``(?i)`` are
    Python-only syntax; lookaround and backreferences exist in both but are rejected here;
  - named groups: JS ``(?<name>..)`` is a Python syntax error, Python ``(?P<name>..)`` is a
    JS syntax error (both rejected).
"""
from __future__ import annotations

import json
import logging
import re

_log = logging.getLogger(__name__)

VALID_OPERATORS = frozenset({"startsWith", "contains", "regex"})
PAIR_KEYS = {"title_resource": "resource", "title_path": "path"}
VALID_FIELDS = frozenset({"title", "category", "path"}) | frozenset(PAIR_KEYS)
MAX_PATTERN_LEN = 500       # same cap the exclude-rule API enforces
MAX_MATCH_TEXT = 1024       # regex haystack cap (ReDoS bound; titles/resources/paths are far shorter)
MAX_WIDE_REPEATS = 3        # wide (unbounded / large) repeats allowed in a ^-anchored regex
MAX_WIDE_REPEATS_UNANCHORED = 2  # search() retries at every offset (one extra power of n)

# queryType -> category assigned at import time (mirror of _QUERY_TYPE_TO_CAT in wizi.js).
QUERY_TYPE_TO_CAT = {
    "configurationFindings": "CSPM",
    "vulnerabilityFindings": "VULN",
    "hostConfigurationRuleAssessments": "HSPM",
    "dataFindingsV2": "DSPM",
    "secretInstances": "SECR",
    "excessiveAccessFindings": "EAPM",
    "networkExposures": "NEXP",
    "inventoryFindings": "EOLM",
    "endOfLifeFindings": "EOLM",
    "softwareSupplyChainFindings": "EOLM",
    "malwareFindings": "HSPM",
}


def _s(v) -> str:
    return v if isinstance(v, str) else ""


def _d(v) -> dict:
    return v if isinstance(v, dict) else {}


# ── Raw-node helpers (mirror wizi.js) ───────────────────────────────────────────

def map_category_from_entity(entity: dict) -> str:
    """Mirror mapWiziCategory() from wizi.js (category of an 'issues' node)."""
    entity = _d(entity)
    t = _s(entity.get("type")).lower()
    nt = _s(entity.get("nativeType")).lower()
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


def item_category(item: dict, qt: str) -> str:
    """_resolveItemCategory(): 'issues' resolves from the entity snapshot, others by query type."""
    if qt == "issues":
        return map_category_from_entity(_d(item.get("entitySnapshot")))
    return QUERY_TYPE_TO_CAT.get(qt, "CSPM")


def item_title(item: dict, qt: str) -> str:
    """getWiziItemTitle()."""
    if qt == "issues":
        rules = item.get("sourceRules") or []
        if rules:
            return _s(_d(rules[0]).get("name"))
        return _s(item.get("description"))
    if qt in ("configurationFindings", "hostConfigurationRuleAssessments", "inventoryFindings"):
        return _s(_d(item.get("rule")).get("name")) or _s(item.get("name"))
    if qt == "endOfLifeFindings":
        asset = _d(item.get("vulnerableAsset"))
        tech = _d(item.get("technology"))
        res = _d(item.get("resource"))
        label = _s(item.get("detailedName")) or _s(tech.get("name")) or _s(item.get("name"))
        if not item.get("detailedName") and tech.get("version"):
            label += " " + str(tech["version"])
        rname = _s(asset.get("name")) or _s(res.get("name"))
        return label + (" — " + rname if rname else "")
    if qt == "softwareSupplyChainFindings":
        pkg = _s(item.get("packageName")) or _s(item.get("name"))
        ver = _s(item.get("packageVersion"))
        rname = _s(_d(item.get("resource")).get("name"))
        return pkg + (" " + ver if ver else "") + (" — " + rname if rname else "")
    if qt == "vulnerabilityFindings":
        return _s(item.get("name")) or _s(item.get("detailedName"))
    if qt == "dataFindingsV2":
        return _s(item.get("name")) or _s(_d(item.get("dataClassifier")).get("name"))
    if qt == "secretInstances":
        return _s(item.get("name")) or _s(_d(item.get("rule")).get("name"))
    if qt == "excessiveAccessFindings":
        return _s(item.get("name"))
    if qt == "networkExposures":
        return "Network Exposure — " + (_s(_d(item.get("exposedEntity")).get("name")) or str(item.get("id", "")))
    return _s(item.get("name"))


def item_resource(item: dict, qt: str) -> str | None:
    """extractResourceName(): the resource/entity name, or None."""
    if qt == "issues":
        return _s(_d(item.get("entitySnapshot")).get("name")) or None
    if qt in ("configurationFindings", "hostConfigurationRuleAssessments", "inventoryFindings"):
        return _s(_d(item.get("resource")).get("name")) or None
    if qt == "vulnerabilityFindings":
        asset_name = _s(_d(item.get("vulnerableAsset")).get("name"))
        if asset_name:
            return asset_name
        dn = _s(item.get("detailedName"))
        idx = dn.rfind(" on ")
        if idx > 0:
            return dn[idx + 4:] or None
        names = [_s(_d(p).get("name")) for p in (item.get("projects") or [])]
        names = [n for n in names if n]
        return names[0] if names else None
    if qt == "dataFindingsV2":
        return _s(_d(item.get("graphEntity")).get("name")) or None
    if qt == "secretInstances":
        return _s(_d(item.get("resource")).get("name")) or None
    if qt == "excessiveAccessFindings":
        return _s(_d(_d(item.get("principal")).get("graphEntity")).get("name")) or None
    if qt == "endOfLifeFindings":
        return _s(_d(item.get("vulnerableAsset")).get("name")) or _s(_d(item.get("resource")).get("name")) or None
    if qt == "softwareSupplyChainFindings":
        return _s(_d(item.get("resource")).get("name")) or None
    if qt == "networkExposures":
        return _s(_d(item.get("exposedEntity")).get("name")) or None
    return None


def item_paths(item: dict) -> list:
    """getWiziItemPaths(): secret path, host-config filePath, malware fileDetails.path."""
    return [p for p in (item.get("path"), item.get("filePath"), _d(item.get("fileDetails")).get("path"))
            if isinstance(p, str) and p]


# ── Rule compilation + matching ─────────────────────────────────────────────────

def _parse_pair(pattern: str, key: str):
    try:
        p = json.loads(pattern)
    except (ValueError, TypeError):
        return None
    if isinstance(p, dict) and isinstance(p.get("title"), str) and isinstance(p.get(key), str) \
            and p["title"] and p[key]:
        return p["title"], p[key]
    return None


# ── Regex safety validator (static analysis only; never runs the regex) ─────────

try:  # stdlib parser; module moved in 3.11. Fail closed if neither import works.
    from re import _constants as _sc, _parser as _sp  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - Python < 3.11
    try:
        import sre_constants as _sc  # type: ignore[no-redef]
        import sre_parse as _sp  # type: ignore[no-redef]
    except ImportError:
        _sc = _sp = None

_WIDE_MIN_SPAN = 64   # a bounded repeat spanning more than this counts as wide


def _op(name: str):
    return getattr(_sc, name, None) if _sc is not None else None


def _allowed_ops() -> frozenset:
    names = ("LITERAL", "NOT_LITERAL", "IN", "ANY", "AT", "CATEGORY", "BRANCH",
             "SUBPATTERN", "MAX_REPEAT", "MIN_REPEAT")
    return frozenset(o for o in (_op(n) for n in names) if o is not None)


def _is_repeat(op) -> bool:
    return op is not None and op in (_op("MAX_REPEAT"), _op("MIN_REPEAT"))


def _is_wide(lo, hi) -> bool:
    return hi == _sc.MAXREPEAT or (hi != lo and hi - lo > _WIDE_MIN_SPAN)


def _contains(sub, pred) -> bool:
    """True when any node in the sub-pattern (recursively) satisfies ``pred(op)``."""
    for op, av in sub:
        if pred(op):
            return True
        for child in _children(op, av):
            if _contains(child, pred):
                return True
    return False


def _children(op, av):
    if op == _op("SUBPATTERN"):
        return [av[3]]
    if op == _op("BRANCH"):
        return list(av[1])
    if _is_repeat(op):
        return [av[2]]
    return []


def _walk(sub, allowed, counts, limit) -> None:
    prev_unbounded = False
    for op, av in sub:
        if op not in allowed:
            raise ValueError("unsupported regex construct")
        unbounded = False
        if _is_repeat(op):
            lo, hi, body = av
            # An optional group (``(..)?``, max 1) cannot multiply paths; anything repeating more can.
            if hi > 1 and _contains(body, lambda o: _is_repeat(o) or o == _op("BRANCH")):
                raise ValueError("nested quantifier or alternation under a quantifier")
            if _is_wide(lo, hi):
                counts[0] += 1
                unbounded = True
                if counts[0] > limit:
                    raise ValueError("too many unbounded quantifiers")
                if prev_unbounded:
                    raise ValueError("adjacent unbounded quantifiers")
        prev_unbounded = unbounded
        for child in _children(op, av):
            _walk(child, allowed, counts, limit)


def regex_error(pattern: str):
    """Return a short reason when ``pattern`` is not a safe, JS-compatible regex, else None.

    Pure static analysis of the stdlib parse tree: the pattern is never matched here, so it
    is safe to call on hostile input (save time and load time)."""
    if not isinstance(pattern, str) or not pattern or len(pattern) > MAX_PATTERN_LEN:
        return "pattern empty or too long"
    if _sp is None or _sc is None:
        return "regex parser unavailable"
    if "(?P" in pattern:
        return "named groups are not supported"
    try:
        tree = _sp.parse(pattern, re.IGNORECASE | re.ASCII)
        first = tree[0] if len(tree) else None
        anchored = bool(first) and first[0] == _op("AT") and first[1] == _op("AT_BEGINNING")
        _walk(tree, _allowed_ops(), [0], MAX_WIDE_REPEATS if anchored else MAX_WIDE_REPEATS_UNANCHORED)
        re.compile(pattern, re.IGNORECASE | re.ASCII)
    except ValueError as e:
        return str(e) or "invalid regex"
    except (re.error, RecursionError, OverflowError, TypeError, AttributeError, IndexError):
        return "invalid regex"
    return None


def _compile_one(operator: str, raw_pattern: str):
    """Return a predicate(value)->bool for one pattern, or raise ValueError/re.error."""
    if not raw_pattern or len(raw_pattern) > MAX_PATTERN_LEN:
        raise ValueError("pattern empty or too long")
    if operator == "regex":
        reason = regex_error(raw_pattern)
        if reason:
            raise ValueError(reason)
        rx = re.compile(raw_pattern, re.IGNORECASE | re.ASCII)
        return lambda v: rx.search(v[:MAX_MATCH_TEXT]) is not None
    low = raw_pattern.lower()
    if operator == "startsWith":
        return lambda v: v.startswith(low)
    if operator == "contains":
        return lambda v: low in v
    raise ValueError("unknown operator")


class _Compiled:
    __slots__ = ("field", "first", "second")

    def __init__(self, field, first, second=None):
        self.field, self.first, self.second = field, first, second

    def matches(self, title: str, category: str, paths: list, resource) -> bool:
        lo = str.lower
        if self.field == "title_resource":
            return bool(resource) and self.first(lo(title)) and self.second(lo(resource))
        if self.field == "title_path":
            return self.first(lo(title)) and any(self.second(lo(p)) for p in paths)
        if self.field == "path":
            return any(self.first(lo(p)) for p in paths)
        return self.first(lo(title if self.field == "title" else category))


class ExcludeMatcher:
    """Compiled set of active exclude rules. Build once per scan, call ``is_excluded`` per raw node."""

    def __init__(self, rules):
        """``rules``: iterable of objects/dicts with id, field, operator, pattern, active."""
        self._rules: list = []
        self.skipped_ids: list = []
        self.load_failed = False   # True when the rules could not be read from the DB
        for r in rules or []:
            get = (lambda k, r=r: r.get(k)) if isinstance(r, dict) else (lambda k, r=r: getattr(r, k, None))
            if not get("active"):
                continue
            rid = get("id")
            try:
                self._rules.append(self._compile(get("field"), get("operator"), get("pattern")))
            except (ValueError, TypeError, re.error, RecursionError, OverflowError):
                self.skipped_ids.append(rid)
        if self.skipped_ids:
            # Ids only: never log the pattern.
            _log.warning("exclude rules skipped (invalid, scan continues): ids=%s", self.skipped_ids)

    @staticmethod
    def _compile(field, operator, pattern) -> _Compiled:
        if field not in VALID_FIELDS or operator not in VALID_OPERATORS or not isinstance(pattern, str):
            raise ValueError("invalid rule")
        if field in PAIR_KEYS:
            pair = _parse_pair(pattern, PAIR_KEYS[field])
            if pair is None:
                raise ValueError("invalid pair rule")
            return _Compiled(field, _compile_one(operator, pair[0]), _compile_one(operator, pair[1]))
        return _Compiled(field, _compile_one(operator, pattern))

    def __len__(self) -> int:
        return len(self._rules)

    def matches_values(self, title: str, category: str, paths=None, resource=None) -> bool:
        """Python twin of ``isExcludedByRules(itemTitle, itemCategory, itemPaths, itemResource)``."""
        paths = [p for p in (paths or []) if isinstance(p, str)]
        resource = resource if isinstance(resource, str) else None
        title = title if isinstance(title, str) else ""
        category = category if isinstance(category, str) else ""
        return any(c.matches(title, category, paths, resource) for c in self._rules)

    def is_excluded(self, item: dict) -> bool:
        """True when a raw Wiz node (with ``queryType``) matches any active rule."""
        if not self._rules:
            return False
        qt = item.get("queryType") or ""
        return self.matches_values(item_title(item, qt), item_category(item, qt),
                                   item_paths(item), item_resource(item, qt))


def load_active_matcher() -> ExcludeMatcher:
    """Build a matcher from the active ExcludeRule rows. A DB error degrades to 'no rules' (``load_failed`` is set)."""
    from backend.models import ExcludeRule
    try:
        rows = ExcludeRule.query.filter_by(active=True).order_by(ExcludeRule.id).all()
        return ExcludeMatcher(
            [{"id": r.id, "field": r.field, "operator": r.operator,
              "pattern": r.pattern, "active": True} for r in rows])
    except Exception:  # noqa: BLE001 - never fail a scan because rules could not be read
        from backend.database import db
        db.session.rollback()
        _log.warning("exclude rules could not be loaded; scan continues WITHOUT exclude rules",
                     exc_info=True)
        m = ExcludeMatcher([])
        m.load_failed = True
        return m
