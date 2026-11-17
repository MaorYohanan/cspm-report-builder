// ═══════════════════════════════════════════
// Smart VPC firewall template ("VPC firewall rules should restrict MULTIPLE accesses")
// Fixed impact and recommendations; the title and the description of the finding are kept as they are
// (the description carries the rule count and the resource). Pure functions (no DOM).
// ═══════════════════════════════════════════
export var VPC_MULTI = 'vpc-multi';

export var VPC_MULTI_TITLE = 'VPC firewall rules should restrict MULTIPLE accesses';

var VPC_IMPACT = 'ריבוי פורטים פתוחים מהווה סיכון לחדירה לא מורשית למערכות, או להתפשטות תוקף בתוך הרשת.';
var VPC_RECS = [
  'יש לבחון את החוק ולבדוק אילו פורטים נדרשים ולפתוח אותם בלבד.',
  'במידה וכל הפורטים נדרשים, יש לציין את הסיבה ונשקול החרגה.'
];
var VPC_DEFAULT_DESCRIPTION = 'נמצאו כללי VPC firewall על המשאב';

/** True for the merged "MULTIPLE accesses" finding. */
export function isVpcMultiTitle(title) {
  return String(title || '').trim().toLowerCase() === VPC_MULTI_TITLE.toLowerCase();
}

/** {fields:{title, description, impact, recs}, missing:[]} - same shape as the EAPM / SECR builders. */
export function buildVpcFinding(currentDescription) {
  var desc = String(currentDescription || '').trim();
  return {
    fields: {
      title: VPC_MULTI_TITLE,
      description: desc || VPC_DEFAULT_DESCRIPTION,
      impact: VPC_IMPACT,
      recs: VPC_RECS.join('\n')
    },
    missing: []
  };
}
