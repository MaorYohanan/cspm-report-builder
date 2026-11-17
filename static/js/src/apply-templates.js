// ═══════════════════════════════════════════
// Apply the smart EAPM / SECR / VPC / CSPM / HSPM / EOLM templates to imported findings in one go
// Pure functions (no DOM). Only description, impact and recommendations are rewritten: the title is
// left as Wiz wrote it because product memory and exception rules match findings by title.
// A finding is only planned when every value was found, so no <PLACEHOLDER> is left behind.
// ═══════════════════════════════════════════
import { extractEapmData, buildEapmFinding, pickEapmVariant } from './template-fill.js';
import { VPC_MULTI, isVpcMultiTitle, buildVpcFinding } from './vpc-fill.js';
import { extractConfigData, pickConfigVariant, buildConfigFinding } from './config-fill.js';
import { extractSecretData, buildSecretFinding, pickSecretVariant } from './secret-fill.js';

function sourceOf(f) {
  return { title: f.title, description: f.description, impact: f.impact, technical: f.technical, recs: f.recs };
}

/** [{finding, fields}] for every finding a template fits completely. Does not change anything. */
export function planTemplates(findings) {
  var plan = [];
  (findings || []).forEach(function(f) {
    var built = null;
    if (f.category === 'EAPM') {
      var ed = extractEapmData(sourceOf(f));
      var ev = pickEapmVariant(ed);
      if (ev) built = buildEapmFinding(ev, ed);
    } else if (f.category === 'SECR') {
      var sd = extractSecretData(sourceOf(f));
      var sv = pickSecretVariant(sd);
      if (sv) built = buildSecretFinding(sv, sd, f.title);
    } else if (f.category === 'CSPM' && isVpcMultiTitle(f.title)) {
      built = buildVpcFinding(f.description);
    } else {
      var cv = pickConfigVariant(f.category, f.title);
      if (cv) built = buildConfigFinding(cv, extractConfigData(sourceOf(f)), f.title);
    }
    if (built && !built.missing.length) plan.push({ finding: f, fields: built.fields });
  });
  return plan;
}

/** Write a plan into its findings; returns the number of findings changed. */
export function applyPlan(plan) {
  plan.forEach(function(p) {
    p.finding.description = p.fields.description;
    p.finding.impact = p.fields.impact;
    p.finding.recs = p.fields.recs.split('\n').filter(Boolean);
  });
  return plan.length;
}
