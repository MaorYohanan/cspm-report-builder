// ═══════════════════════════════════════════
// Resource-list cap for imported findings (BL-38 follow-up)
// A finding consolidated from many resources keeps only the first RESOURCE_CAP names in its
// technical-details line, followed by "ועוד N...". The full list is kept on finding._resources so
// a later merge into the same finding does not lose or double-count the hidden resources.
// ═══════════════════════════════════════════

export var RESOURCE_CAP = 5;

var LINE_PREFIXES = ['Entity:', 'Resource:', 'Principal:', 'Affected Resources:'];
// "ועוד 7..." (current) and "(+ 7 more — see Wiz report)" (legacy 10-cap) suffixes
var MORE_SUFFIX = /\s*(?:ועוד\s+\d+\.{0,3}|\(\+\s*\d+\s+more[^)]*\))\s*$/;

export function findResourceLineIndex(technical) {
  for (var i = 0; i < technical.length; i++) {
    for (var p = 0; p < LINE_PREFIXES.length; p++) {
      if (typeof technical[i] === 'string' && technical[i].startsWith(LINE_PREFIXES[p])) return i;
    }
  }
  return -1;
}

export function parseResourceValue(value) {
  var text = String(value || '').replace(MORE_SUFFIX, '');
  return text.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

export function formatResourceValue(names) {
  if (names.length <= RESOURCE_CAP) return names.join(', ');
  return names.slice(0, RESOURCE_CAP).join(', ') + ' ועוד ' + (names.length - RESOURCE_CAP) + '...';
}

// Full resource list of a finding: the stored list if present, else parsed from the line.
export function getFullResources(finding) {
  if (Array.isArray(finding._resources) && finding._resources.length) return finding._resources.slice();
  var idx = findResourceLineIndex(finding.technical || []);
  if (idx < 0) return [];
  var line = finding.technical[idx];
  return parseResourceValue(line.slice(line.indexOf(':') + 1));
}

// Rewrite the resource line of `finding` from `names` (default: its current full list).
export function capResourceLine(finding, names) {
  if (!finding || !Array.isArray(finding.technical)) return;
  var all = names || getFullResources(finding);
  var idx = findResourceLineIndex(finding.technical);
  if (idx < 0) return;
  var prefix = finding.technical[idx].split(':')[0];
  if (all.length > RESOURCE_CAP) finding._resources = all.slice();
  else delete finding._resources;
  if (all.length) finding.technical[idx] = prefix + ': ' + formatResourceValue(all);
}

// When the list was capped and a Wiz reference URL was attached at import time
// (finding._wizRef), add a "Reference: <url>" technical line after the resource line.
function applyReference(finding) {
  var url = finding._wizRef;
  delete finding._wizRef;
  if (!url || !Array.isArray(finding.technical)) return;
  if (!finding._resources || finding._resources.length <= RESOURCE_CAP) return;
  finding.technical = finding.technical.filter(function(l) { return !(typeof l === 'string' && /^Reference:/i.test(l)); });
  var idx = findResourceLineIndex(finding.technical);
  if (idx >= 0) finding.technical.splice(idx + 1, 0, 'Reference: ' + url);
}

export function capResourceLines(findings) {
  (findings || []).forEach(function(f) { capResourceLine(f); applyReference(f); });
}
