// ═══════════════════════════════════════════
// Wiz portal "Reference" link for consolidated findings (BL-38 follow-up)
// Builds a filtered Wiz portal view for a finding whose resource list was capped, so the
// reader can see the rest. URL shapes are copied from the Reference links already used in
// real reports (vulnerability / EOL: JSON `filters=` query; configuration / host
// configuration: Rison fragment). Returns null when no reliable link can be built.
// ═══════════════════════════════════════════

var BASE = 'https://app.wiz.io';

function jsonFilters(obj) {
  return encodeURIComponent(JSON.stringify(obj));
}

// Wiz's fragment format: strings are ~'value with NO closing quote; the whole fragment is
// percent-encoded (~ ( ) ' included), exactly like links copied from the portal.
function encodeFragment(raw) {
  return encodeURIComponent(raw).replace(/[~()']/g, function(c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function risonId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '');
}

function subscriptionIds(items) {
  var ids = [];
  (items || []).forEach(function(it) {
    var id = (((it || {}).resource || {}).subscription || {}).id;
    if (id && ids.indexOf(id) === -1) ids.push(id);
  });
  return ids;
}

function firstRuleId(items, qt) {
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i] || {};
    var id = qt === 'issues' ? ((it.sourceRules || [])[0] || {}).id : (it.rule || {}).id;
    if (id) return id;
  }
  return null;
}

export function buildWizReference(qt, items, ctx) {
  ctx = ctx || {};
  var acct = ctx.subscriptionExternalId ? String(ctx.subscriptionExternalId).trim() : '';

  if (qt === 'vulnerabilityFindings') {
    if (!acct) return null;
    return BASE + '/findings/vulnerability-findings?filters=' + jsonFilters({
      severity: { equals: ['HIGH', 'CRITICAL'] },
      hasFix: { equals: true },
      hasExploit: { equals: true },
      cloudAccount: { equals: [acct] },
      validatedInRuntime: { equals: true }
    }) + '&groupBy=' + encodeURIComponent('["VULNERABLE_ASSET"]');
  }
  if (qt === 'endOfLifeFindings') {
    if (!acct) return null;
    return BASE + '/findings/end-of-life-findings?filters=' + jsonFilters({
      cloudAccount: { equals: [acct] }
    }) + '&groupBy=' + encodeURIComponent('["VULNERABLE_ASSET"]');
  }
  if (qt === 'configurationFindings') {
    var cid = firstRuleId(items, qt);
    if (!cid) return null;
    // Same shape as a working portal link: rule + cloud account (Wiz account id) + empty groupBy
    var accts = subscriptionIds(items).map(function(a) { return "~'" + risonId(a); }).join('');
    return BASE + '/findings/configuration-findings/cloud#' + encodeFragment(
      "~(filters~(status~(equals~(~'OPEN))~rule~(equals~(~'" + risonId(cid) + '))' +
      (accts ? '~cloudAccount~(equals~(' + accts + '))' : '') + ')~groupBy~(~))');
  }
  if (qt === 'hostConfigurationRuleAssessments') {
    var hid = firstRuleId(items, qt);
    if (!hid) return null;
    var haccts = subscriptionIds(items).map(function(a) { return "~'" + risonId(a); }).join('');
    return BASE + '/findings/host-configuration#' + encodeFragment(
      "~(filters~(status~(equals~(~'OPEN))~hostConfigurationRule~(equals~(~'" + risonId(hid) + '))' +
      (haccts ? '~cloudAccount~(equals~(' + haccts + '))' : '') + '))');
  }
  if (qt === 'issues') {
    var title = ctx.title ? String(ctx.title).trim() : '';
    if (!title) return null;
    // Portal links write spaces in the search text as '+' (not %20 / %2B)
    return BASE + '/issues?filters=' + jsonFilters({
      status: { equals: ['OPEN', 'IN_PROGRESS'] },
      search: { contains: title }
    }).replace(/%20/g, '+');
  }
  return null;
}
