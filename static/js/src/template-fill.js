// ═══════════════════════════════════════════
// Smart EAPM (excessive access) templates
// Picking one of these templates while a finding is open pulls the data out of that finding
// (principal, role / policy, unused services and permissions, project, remediation type) and
// writes it into the template text. Values that cannot be found stay as visible <PLACEHOLDERS>.
// Pure functions (no DOM) so they can be tested in Node.
// ═══════════════════════════════════════════

// Wiz text often has invisible RTL marks (U+200E / U+200F) next to a backtick, so every \s in the
// description patterns also accepts them.
function rx(re) {
  return new RegExp(re.source.replace(/\\s/g, '[\\s\\u200e\\u200f]'), re.flags);
}

function firstMatch(text, regexes) {
  for (var i = 0; i < regexes.length; i++) {
    var m = rx(regexes[i]).exec(text);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return null;
}

function techValue(technical, key) {
  var lines = Array.isArray(technical) ? technical : String(technical || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var m = new RegExp('^\\s*' + key + '\\s*:\\s*(.+)$', 'i').exec(String(lines[i]));
    if (m) return m[1].trim();
  }
  return null;
}

function toText(v) {
  return Array.isArray(v) ? v.join('\n') : String(v || '');
}

/**
 * Read the data a Wiz excessive-access finding carries.
 * src: {title, description, impact, technical, recs} (strings or arrays, as in the edit form).
 * Works with the English Wiz wording and with the Hebrew rewrites.
 */
export function extractEapmData(src) {
  src = src || {};
  var desc = toText(src.description);
  var title = toText(src.title);
  var recs = toText(src.recs);
  var out = {};

  out.cloud = techValue(src.technical, 'Cloud');
  out.principalType = (techValue(src.technical, 'Principal Type') || '').toUpperCase() || null;
  out.remediation = (techValue(src.technical, 'Remediation Type') || '').toUpperCase() || null;

  // Principal: "Principal: projects/<project>/serviceAccounts/<email>" or just the name / email
  var principal = techValue(src.technical, 'Principal');
  if (principal) {
    var pm = /^projects\/([^/]+)\/serviceAccounts\/(.+)$/i.exec(principal);
    if (pm) { out.project = pm[1]; principal = pm[2]; }
    out.principal = principal;
  }

  // Names from the description / title when the technical line is missing
  out.serviceAccount = out.principal && out.principal.indexOf('@') > -1 ? out.principal : firstMatch(desc, [
    /service account\s+`([^`]+)`/i, /חשבון\s+(?:ה-?)?שירות\s+`([^`]+)`/
  ]) || firstMatch(title, [/service account\s+(\S+)$/i]);
  if (out.serviceAccount) {
    // the description sometimes quotes the full "projects/<project>/serviceAccounts/<email>" resource name
    var sa0 = /^projects\/([^/]+)\/serviceAccounts\/(.+)$/i.exec(out.serviceAccount);
    if (sa0) { out.serviceAccount = sa0[2]; if (!out.project) out.project = sa0[1]; }
  }
  // GCP user: the email is in the description / title; the Principal line is only the display name
  out.user = firstMatch(desc, [/\buser\s+`([^`]+)`/i, /(?:המשתמש|למשתמש|משתמש)\s+`([^`]+)`/])
    || firstMatch(title, [/\buser\s+(\S+)$/i]);
  if (out.principalType === 'USER_ACCOUNT' && out.principal && out.principal !== out.user) out.displayName = out.principal;
  out.group = (out.principalType === 'GROUP' && out.principal) || firstMatch(desc, [
    /(?:\bgroup|קבוצת|קבוצה)\s+`([^`]+)`/i
  ]) || firstMatch(title, [/\bgroup\s+(.+)$/i]);
  out.roleName = out.principal && out.principalType !== 'GROUP' && out.principal.indexOf('@') === -1 ? out.principal : firstMatch(desc, [
    /\brole\s+`([^`]+)`\s+(?:currently|is|אינו)/i, /ה-role\s+`([^`]+)`/, /\brole\s+`([^`]+)`/i
  ]) || firstMatch(title, [/\brole\s+(\S+)$/i]);

  // The role granted: GCP "assigned the `X` role" / Hebrew "role מסוג `X`", "תפקיד `X`", "תפקיד ה-`X`", "לתפקיד `X`"
  out.role = firstMatch(desc, [
    /assigned the\s+`([^`]+)`\s+role/i,
    /(?:\brole|תפקיד|התפקיד|לתפקיד|הרשאת)\s+(?:ה-)?(?:מסוג\s+)?`([^`]+)`/i
  ]);
  out.policy = firstMatch(desc, [/policy\s+`([^`]+)`/i, /(?:מדיניות|המדיניות)\s+(?:ה-)?(?:IAM\s+)?`([^`]+)`/]);

  // Unused services / permissions: "`2` unused services", "3 שירותים", "`1` שירות", "שירות אחד",
  // "`6` unused permissions", "32 הרשאות", "108 permissions"
  var sm = rx(/`?(\d+)`?\s+(?:unused\s+services?|שירותים|שירות)/i).exec(desc);
  out.services = sm ? parseInt(sm[1], 10) : (/שירות\s+אחד|one unused service/i.test(desc) ? 1 : null);
  var pmatch = rx(/`?(\d+)`?\s+(?:unused\s+permissions?|permissions|הרשאות|הרשאה)/i).exec(desc);
  out.permissions = pmatch ? parseInt(pmatch[1], 10) : (/הרשאה\s+אחת|one unused permission/i.test(desc) ? 1 : null);

  // Exact gcloud command Wiz wrote: gives the project and the role id
  var gm = /remove-iam-policy-binding\s+(\S+)/i.exec(recs);
  if (gm && !out.project) out.project = gm[1].replace(/^["']|["']$/g, '');
  var rid = /--role="?roles\/([^"\s]+)"?/i.exec(recs);
  if (rid) out.roleId = rid[1];
  if (!out.project && out.serviceAccount) {
    var em = /@([a-z][a-z0-9-]*)\.iam\.gserviceaccount\.com$/i.exec(out.serviceAccount);
    if (em) out.project = em[1];
  }
  return out;
}

function pick(value, placeholder, missing) {
  if (value !== null && value !== undefined && value !== '') return value;
  if (missing.indexOf(placeholder) === -1) missing.push(placeholder);
  return '<' + placeholder + '>';
}

function unusedPhrase(d, missing) {
  var parts = [];
  if (d.services === 1) parts.push('שירות אחד');
  else if (d.services > 1) parts.push(d.services + ' שירותים');
  if (d.permissions === 1) parts.push('הרשאה אחת');
  else if (d.permissions > 1) parts.push(d.permissions + ' הרשאות');
  if (!parts.length) {
    missing.push('UNUSED_SERVICES', 'UNUSED_PERMISSIONS');
    return '<UNUSED_SERVICES> שירותים ו-<UNUSED_PERMISSIONS> הרשאות';
  }
  return parts.join(' ו-');
}

// Opening recommendations shared by the GCP service account and user templates
var GCP_ROLE_REVIEW_RECS = [
  'יש לבחון האם ההרשאה הנ"ל נדרשת או שניתן לצמצם הרשאות ל role יותר מתאים.',
  'במידה ונדרשות הרשאות מועטות יש לשקול ליצור custom role המכיל את ההרשאות הנדרשות בלבד.',
  'מבדיקה ב GCP IAM Recommender ניתן להסיר את כל ההרשאות המצוינות בתיאור ומפורטות בממצא ב WIZ.'
];

function gcpRemediation(d) {
  if (d.remediation === 'DETACH_POLICY') return 'ניתן להסיר את ה-role במלואו ללא פגיעה בפונקציונליות.';
  if (d.remediation === 'REPLACE_POLICY') return 'מומלץ להחליף את ה-role ב-custom role המכיל רק את ההרשאות הנדרשות.';
  return 'מומלץ לצמצם את ההרשאות לעקרון ה-Least Privilege.';
}

function isGoogleDefaultSa(email) {
  return /@(developer|cloudservices|cloudbuild)\.gserviceaccount\.com$|@appspot\.gserviceaccount\.com$|-compute@developer\.gserviceaccount\.com$/i
    .test(email || '');
}

/**
 * Build the finding text for one EAPM template variant from extracted data.
 * variant: 'gcp-sa' | 'gcp-group' | 'aws-role'
 * Returns {fields:{title, description, impact, recs}, missing:[PLACEHOLDER names left unresolved]}.
 */
export function buildEapmFinding(variant, data) {
  var d = data || {};
  var missing = [];
  var f;

  if (variant === 'gcp-sa') {
    var sa = pick(d.serviceAccount, 'SERVICE_ACCOUNT_EMAIL', missing);
    var role = pick(d.role, 'ROLE', missing);
    var recs = GCP_ROLE_REVIEW_RECS.slice();
    if (isGoogleDefaultSa(d.serviceAccount)) {
      recs.push('מדובר ב-SA ברירת המחדל של גוגל - לא אמורים להשתמש בו אלא למטרות שאין ברירה');
    }
    if (d.remediation !== 'REPLACE_POLICY') {
      recs.push('gcloud projects remove-iam-policy-binding ' + pick(d.project, 'PROJECT_ID', missing) +
        ' --member="serviceAccount:' + sa + '" --role="roles/' + pick(d.roleId, 'ROLE_ID', missing) + '"');
    }
    f = {
      title: 'GCP excessive access for service account ' + sa,
      description: 'ל-service account `' + sa + '` מוקצה ה-role `' + role + '`. role זה כולל ' + unusedPhrase(d, missing) +
        ' שאינם בשימוש, המעידים על הרשאות עודפות (over-privilege) ועל חריגה מעקרון ה-Least Privilege. ' + gcpRemediation(d) +
        '\n\nההמלצה מבוססת על ה-GCP IAM Recommender וכוללת הסרת הרשאות בהתאם להמלצות GCP.',
      impact: 'ה-SA מחזיק בהרשאות יתר מורחבות, דבר העלול לאפשר לתוקף שישיג שליטה על ה-SA גישה נרחבת למשאבים בפרויקט.',
      recs: recs.join('\n')
    };
  } else if (variant === 'gcp-user') {
    var usr = pick(d.user, 'USER_EMAIL', missing);
    var urole = pick(d.role, 'ROLE', missing);
    var urecs = GCP_ROLE_REVIEW_RECS.slice();
    urecs.push('יש להעדיף מתן הרשאות באמצעות קבוצה ובאופן זמני (Just-in-Time) על פני הרשאות קבועות למשתמש');
    if (d.remediation !== 'REPLACE_POLICY') {
      urecs.push('gcloud projects remove-iam-policy-binding ' + pick(d.project, 'PROJECT_ID', missing) +
        ' --member="user:' + usr + '" --role="roles/' + pick(d.roleId, 'ROLE_ID', missing) + '"');
    }
    f = {
      title: 'GCP excessive access for user ' + usr,
      description: 'למשתמש `' + usr + '`' + (d.displayName ? ' (' + d.displayName + ')' : '') + ' מוקצה ה-role `' + urole +
        '`. role זה כולל ' + unusedPhrase(d, missing) + ' שאינם בשימוש, המעידים על הרשאות עודפות (over-privilege) ועל חריגה מעקרון ה-Least Privilege. ' +
        gcpRemediation(d) + '\n\nההמלצה מבוססת על ה-GCP IAM Recommender וכוללת הסרת הרשאות בהתאם להמלצות GCP.',
      impact: 'למשתמש הרשאות יתר מורחבות - תוקף שישיג שליטה על ההזדהות של המשתמש (כגון באמצעות Info stealer או Phishing) יקבל גישה נרחבת למשאבי הפרויקט.',
      recs: urecs.join('\n')
    };
  } else if (variant === 'gcp-group') {
    var grp = pick(d.group, 'GROUP_NAME', missing);
    var grole = pick(d.role, 'ROLE', missing);
    f = {
      title: 'GCP excessive access for group ' + grp,
      description: 'לקבוצה `' + grp + '` מוקצה תפקיד `' + grole + '` הכולל ' + unusedPhrase(d, missing) + ' שאינם בשימוש. ' +
        (d.remediation === 'DETACH_POLICY'
          ? 'ניתן להסיר את התפקיד במלואו ללא פגיעה בפונקציונליות.'
          : 'מומלץ להחליף תפקיד זה בתפקיד מותאם אישית (custom role) המכיל רק את ההרשאות הנדרשות, ובכך לצמצם הרשאות עודפות.'),
      impact: 'קבוצה עם הרשאות גבוהות - תוקף שישיג שליטה על אחת מההזדהויות של חברי הקבוצה (כגון באמצעות Info stealer) יקבל את מלוא ההרשאות, ולכן יש לבדוק היטב האם נדרשת הרשאת Admin.',
      recs: ['יש לבדוק האם ניתן לצמצם הרשאות לתפקיד מצומצם יותר או ל-custom role',
        'יש להסיר חברי קבוצה שאינם נדרשים',
        'יש לבחון האם נדרשת הרשאת Admin ולהגבילה לזמן הנדרש בלבד (Just-in-Time)'].join('\n')
    };
  } else if (variant === 'aws-role') {
    var rname = pick(d.roleName, 'ROLE_NAME', missing);
    var recsAws = [];
    var descAws;
    if (d.remediation === 'DELETE_PRINCIPAL') {
      descAws = 'ה-role `' + rname + '` אינו בשימוש בתקופה שהוגדרה ב-Wiz (ניתוח AWS Activity Logs), ולכן ניתן למחוק אותו ללא פגיעה בפונקציונליות ובכך ליישם את עקרון ה-Least Privilege.';
      recsAws.push('יש לוודא שה-role אינו בשימוש (CloudTrail / IAM Access Advisor) ולמחוק אותו');
    } else {
      var pol = pick(d.policy, 'POLICY_NAME', missing);
      var detach = d.remediation === 'DETACH_POLICY';
      descAws = 'ל-role `' + rname + '` מצורפת המדיניות `' + pol + '`, הכוללת ' + unusedPhrase(d, missing) + ' שאינם בשימוש. ' +
        (detach ? 'ניתן להסיר (detach) את המדיניות במלואה ללא פגיעה בפונקציונליות.'
                : 'ניתן להחליף את המדיניות ב-custom policy המצומצמת להרשאות בשימוש, ללא פגיעה בפונקציונליות.');
      recsAws.push(detach
        ? 'יש להסיר (detach) את המדיניות `' + pol + '` מה-role'
        : 'יש להחליף את המדיניות `' + pol + '` ב-custom policy המצומצמת להרשאות בשימוש, כפי שמפורט בממצא ב-Wiz');
    }
    recsAws.push('יש להטמיע את התיקון גם ב-IaC (למשל Terraform) כדי למנוע חזרה של הבעיה');
    f = {
      title: 'AWS excessive access for role ' + rname,
      description: descAws,
      impact: 'ל-role הרשאות יתר, דבר העלול לאפשר לתוקף שישיג שליטה עליו גישה נרחבת למשאבי ה-AWS.',
      recs: recsAws.join('\n')
    };
  } else {
    return null;
  }
  return { fields: f, missing: missing };
}

export var EAPM_VARIANTS = ['gcp-sa', 'gcp-user', 'gcp-group', 'aws-role'];
