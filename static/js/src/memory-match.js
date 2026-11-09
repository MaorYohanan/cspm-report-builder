// BL-24 — Product Memory matching for exception carry-forward (browser side).
//
// Pure, DOM-free logic (testable under Node) plus two small helpers that touch
// `document` / `fetch` only when CALLED (nothing runs at import time).
//
// Python mirror: backend/services/memory_matching.py (same rule key, same
// precedence). A cross-language test keeps buildRuleKey and rule_key_for aligned.
//
// Matching: stable rule key first (entry.rule_key === finding._ruleKey and the entry's
// subscription agrees), (subscription, title) as the fallback. A rule-only match (the title
// changed) restores the exception and sets finding._matchedLoosely = true (UI-only marker).

import { state } from './state.js';

var RULE_ID_TYPES = ['configurationFindings', 'hostConfigurationRuleAssessments', 'inventoryFindings'];

export function norm(s) {
  return String(s == null ? '' : s).toLowerCase().trim();
}

/**
 * Stable rule key '<queryType>|<rule id>' (lower-cased) or null.
 * Only types with a real rule id get a key; never falls back to an instance/issue id.
 */
export function buildRuleKey(item, qt) {
  qt = String(qt || '').trim();
  if (!item || !qt) return null;
  var rid = null;
  if (qt === 'issues') {
    var rules = item.sourceRules || [];
    var first = (rules.length && rules[0] && typeof rules[0] === 'object') ? rules[0] : {};
    rid = first.id || (item.control || {}).id;
  } else if (RULE_ID_TYPES.indexOf(qt) !== -1) {
    rid = (item.rule || {}).id;
  }
  if (rid == null || String(rid).trim() === '') return null;
  return (qt + '|' + String(rid).trim()).toLowerCase();
}

/** GET /memory response ({entries:{key:{...}}}) -> array of entries with normalised fields. */
export function memoryEntriesToList(entriesObj) {
  return Object.keys(entriesObj || {}).map(function(key) {
    var e = entriesObj[key] || {};
    var sub = e.subscription;
    var title = e.title;
    if (sub == null || title == null) {
      var i = key.indexOf('::');
      sub = i >= 0 ? key.slice(0, i) : '';
      title = i >= 0 ? key.slice(i + 2) : key;
    }
    return {
      key: key,
      subscription: norm(sub),
      title: norm(title),
      source: e.source || 'excepted',
      reason: e.reason || '',
      ruleKey: norm(e.rule_key) || null
    };
  });
}

function pick(res, sources) {
  for (var i = 0; i < sources.length; i++) {
    var s = sources[i];
    if (res.exact[s]) return { entry: res.exact[s], loose: false };
    if (res.byRule[s]) return { entry: res.byRule[s], loose: true };
  }
  return null;
}

/**
 * Apply remembered entries to freshly imported findings (mutates the findings).
 *
 * @param {Array} findings        newly imported findings (title, _ruleKey?, exception?)
 * @param {Array} entryList       from memoryEntriesToList()
 * @param {string} subscription   the subscription the import ran for
 * @returns {{matched:number, matchedAck:number, tempFlagged:number, loose:number,
 *            tempToConsume:Array, matchedKeys:Set<string>}}
 */
export function applyMemoryToFindings(findings, entryList, subscription) {
  var sub = norm(subscription);
  var byKey = {};
  var byRule = {};
  entryList.forEach(function(e) {
    byKey[e.subscription + '::' + e.title] = e;
    if (e.ruleKey) (byRule[e.ruleKey] = byRule[e.ruleKey] || []).push(e);
  });

  var out = { matched: 0, matchedAck: 0, tempFlagged: 0, loose: 0, tempToConsume: [], matchedKeys: new Set() };
  (findings || []).forEach(function(f) {
    if (!f || !f.title) return;
    var title = norm(f.title);
    var rk = norm(f._ruleKey);
    var res = { exact: {}, byRule: {} };
    var matched = [];
    var ex = byKey[sub + '::' + title];
    if (ex) { res.exact[ex.source] = ex; matched.push(ex); }
    if (rk && byRule[rk]) {
      byRule[rk].forEach(function(e) {
        if (e.subscription !== sub) return;
        if (!res.byRule[e.source]) res.byRule[e.source] = e;
        if (matched.indexOf(e) === -1) matched.push(e);
      });
    }
    matched.forEach(function(e) { out.matchedKeys.add(e.key); });
    if (!matched.length) return;

    var loose = false;
    // BL-12: temp exception was for the previous report only. The finding stays ACTIVE (counts
    // toward risk), gets a UI-only reminder flag, and the temp entry is consumed once (skip if
    // already flagged so a repeated call never fires a second DELETE).
    var temp = pick(res, ['temp_excepted']);
    if (temp && !f._wasTempActioned) {
      f._wasTempActioned = true;
      f._tempActionReason = 'excepted';
      out.tempFlagged++;
      // A rule-only temp match does NOT set the loose flag: the finding stays active and the
      // loose banner claims an exception was restored.
      matched.forEach(function(e) {
        if (e.source === 'temp_excepted') out.tempToConsume.push({ subscription: e.subscription, title: e.title });
      });
    }
    // Permanent kinds. 'deleted' restores as an exclusion (visible, never dropped); the server
    // drops a finding only on an EXACT deleted match and restores a rule-only deleted match the
    // same way as here, flagged loose.
    var perm = pick(res, ['excepted', 'deleted', 'acknowledged']);
    if (perm && !(f.exception && f.exception.active)) {
      f.exception = { active: true, reason: perm.entry.reason || '' };
      // BL-23: 'acknowledged' memory source -> kind 'acknowledge' (hidden from the PDF).
      if (perm.entry.source === 'acknowledged') { f.exception.kind = 'acknowledge'; out.matchedAck++; }
      else out.matched++;
      loose = loose || perm.loose;
    }
    if (loose) { f._matchedLoosely = true; out.loose++; }
  });
  return out;
}

/**
 * Remembered entries in scope that matched no finding this scan.
 *
 * @param {Array} entryList   from memoryEntriesToList()
 * @param {Set<string>} matchedKeys  keys matched by applyMemoryToFindings
 * @param {{subscription:string, queryType?:string}} scope
 *        queryType (single-query import only): restrict to entries whose rule key belongs to that
 *        query type; entries without a rule key cannot be attributed to a type and are skipped.
 *        failedTypes (optional): query types that failed to fetch; their rule-keyed entries and all
 *        title-only entries are skipped (no false stale claims on a partial fetch).
 * @param {Array<{subscription?:string,title?:string,ruleKey?:string}>} seen
 *        everything known to be present in the scan (fetched nodes + findings already in the report)
 *        that was not necessarily imported, so it must not be reported as stale.
 * @returns {Array<{subscription,title,source,reason,ruleKey}>}
 */
export function computeUnmatchedEntries(entryList, matchedKeys, scope, seen) {
  var scopeSub = norm(scope && scope.subscription);
  var qt = scope && scope.queryType ? String(scope.queryType).toLowerCase() : '';
  // Query types that failed / were not fetched: absence of their findings proves nothing.
  var failed = ((scope && scope.failedTypes) || []).map(function(t) { return String(t).toLowerCase().trim(); });
  var seenList = (seen || []).map(function(s) {
    return { subscription: norm(s.subscription), title: norm(s.title), ruleKey: norm(s.ruleKey) };
  });
  if (!scopeSub) return [];
  return entryList.filter(function(e) {
    if (matchedKeys && matchedKeys.has(e.key)) return false;
    if (e.subscription !== scopeSub) return false;
    if (qt && !(e.ruleKey && e.ruleKey.indexOf(qt + '|') === 0)) return false;
    if (failed.length) {
      // Title-only entries cannot be attributed to a type, so skip them when any type failed.
      if (!e.ruleKey) return false;
      if (failed.indexOf(e.ruleKey.split('|')[0]) !== -1) return false;
    }
    var present = seenList.some(function(s) {
      if (s.subscription && s.subscription !== e.subscription) return false;
      if (s.title && s.title === e.title) return true;
      return !!(e.ruleKey && s.ruleKey && s.ruleKey === e.ruleKey);
    });
    return !present;
  }).map(function(e) {
    return { subscription: e.subscription, title: e.title, source: e.source, reason: e.reason, ruleKey: e.ruleKey };
  });
}

/**
 * Store the unmatched list in app state and notify the UI. ALWAYS call after an import
 * (empty list hides the panel).
 *   document event 'memory:unmatched', detail { entries: [{subscription,title,source,reason,ruleKey}],
 *                                               scope: {type, productId, subscription|subscriptions, ...} }
 */
export function publishUnmatchedMemory(entries, scope) {
  state.unmatchedMemory = { entries: entries || [], scope: scope || null };
  if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
    document.dispatchEvent(new CustomEvent('memory:unmatched', {
      detail: { entries: state.unmatchedMemory.entries.slice(), scope: state.unmatchedMemory.scope }
    }));
  }
}

/**
 * Drop a stale Product Memory entry (DELETE /api/products/<id>/memory/entry, editor role).
 * Resolves {ok:true} and removes the entry from state.unmatchedMemory, re-publishing the event
 * with the remaining entries. Rejects (Error) on HTTP failure; state is left untouched then.
 */
export function dropMemoryEntry(productId, entry) {
  if (!productId || !entry) return Promise.reject(new Error('productId and entry required'));
  return fetch('/api/products/' + encodeURIComponent(productId) + '/memory/entry', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: entry.subscription, title: entry.title, rule_key: entry.ruleKey || undefined })
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var cur = state.unmatchedMemory || { entries: [], scope: null };
    var remaining = cur.entries.filter(function(e) {
      return !(norm(e.subscription) === norm(entry.subscription) && norm(e.title) === norm(entry.title));
    });
    publishUnmatchedMemory(remaining, cur.scope);
    return { ok: true };
  });
}
