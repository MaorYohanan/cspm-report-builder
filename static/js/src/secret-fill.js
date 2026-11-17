// ═══════════════════════════════════════════
// Smart SECR (exposed secret) templates
// Picking one of these templates while a finding is open pulls the data out of that finding
// (secret kind, repo / key id / service account, affected paths, resource and its type) and writes
// it into the template text. Values that cannot be found stay as visible <PLACEHOLDERS>.
// Pure functions (no DOM) so they can be tested in Node.
// ═══════════════════════════════════════════
import { techValue, toText, pick } from './template-fill.js';

var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// How the resource type from the Wiz "Type:" line reads in a Hebrew sentence
function whereText(type) {
  var t = String(type || '').toLowerCase();
  if (/^image$|containerimage/.test(t)) return 'ב-container image';
  if (/virtualmachine|compute#instance|^vm$/.test(t)) return 'במכונה';
  if (/hostedcontainer|container/.test(t)) return 'בקונטיינר';
  if (/bucket/.test(t)) return 'ב-bucket';
  if (/run#revision|function|lambda/.test(t)) return 'בשירות serverless';
  return 'במשאב';
}

function pathsOf(technical) {
  var lines = Array.isArray(technical) ? technical : String(technical || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var m = /^\s*(?:Path|Affected Paths(?:\s*\(\d+\))?)\s*:\s*(.+)$/i.exec(String(lines[i]));
    if (m) return m[1].split(/,\s+(?=\/|[A-Za-z]:\\|[A-Za-z0-9_.-]+\/)/).map(function(p) { return p.trim(); }).filter(Boolean);
  }
  return [];
}

/**
 * Read the data a Wiz exposed-secret finding carries.
 * src: {title, description, impact, technical, recs} (strings or arrays, as in the edit form).
 * Everything comes from the title and the technical details, so it also works on findings whose
 * description / recommendations were rewritten by hand.
 */
export function extractSecretData(src) {
  src = src || {};
  var title = toText(src.title).trim();
  var out = {};
  out.cloud = techValue(src.technical, 'Cloud');
  out.secretType = (techValue(src.technical, 'Secret Type') || '').toUpperCase() || null;
  out.resourceType = techValue(src.technical, 'Type');
  var res = techValue(src.technical, 'Resource');
  out.resources = res ? res.split(/,\s*/).filter(Boolean) : [];
  out.paths = pathsOf(src.technical);

  // "Git Credentials (https://user:---REDACTED---@host/group/repo.git) in Scripts and Code"
  var paren = /\(([^)]*)\)/.exec(title);
  out.detail = paren ? paren[1] : null;
  var rest = title.replace(/\s*\([^)]*\)/, '');
  var ctx = /\s+in\s+(.+)$/i.exec(rest);
  out.context = ctx ? ctx[1].trim() : null;
  out.name = rest.replace(/\s+in\s+.+$/i, '').trim() || null;

  var git = out.detail && /^(?:https?:\/\/)?(?:([^:@\/]+)(?::[^@\/]*)?@)?([^\/@]+)\/(.+?)(?:\.git)?$/i.exec(out.detail);
  if (git) {
    out.gitUser = git[1] && !/REDACTED/i.test(git[1]) ? git[1] : null;
    out.gitHost = git[2];
    out.gitRepo = git[3];
    out.gitUrl = 'https://' + git[2] + '/' + git[3] + '.git';
  }
  // one key in the title ("AccessKeyId=ASIA..."), or several listed in the technical details ("AccessKeyIds: ...")
  var techText = toText(src.technical);
  out.awsKeyIds = (out.detail && /AccessKeyId=/.test(out.detail) ? out.detail : techText).match(/\bA[SK]IA[A-Z0-9]{12,}\b/g) || [];
  out.awsKeyIds = out.awsKeyIds.filter(function(k, i, a) { return a.indexOf(k) === i; });
  out.awsKeyId = out.awsKeyIds[0] || null;
  out.serviceAccount = out.detail && (/ServiceAccount=([^\s,)]+)/.exec(out.detail) || [])[1] || null;
  // gcloud keeps the account in the path: .../legacy_credentials/<email>/adc.json
  var pe = null;
  out.paths.forEach(function(p) { if (!pe) pe = EMAIL_RE.exec(p); });
  out.userEmail = pe ? pe[0] : null;
  out.fromLogs = out.paths.length > 0 && out.paths.every(function(p) { return /\/logs\/|\.log$/i.test(p); });
  out.fromHistory = out.paths.some(function(p) { return /_history$/i.test(p); });
  return out;
}

// " ב-container image `x`" / " במכונה `x`"; empty when the finding has no resource line
function whereClause(d) {
  if (!d.resources.length) return '';
  if (d.resources.length > 1) return ' ב-' + d.resources.length + ' משאבים (מפורטים בפרטים הטכניים)';
  return ' ' + whereText(d.resourceType) + ' `' + d.resources[0] + '`';
}

// " בנתיב `p`" / " ב-3 קבצים (מפורטים בפרטים הטכניים)"
function pathClause(d) {
  if (!d.paths.length) return '';
  if (d.paths.length === 1) return ' בנתיב `' + d.paths[0] + '`';
  return ' ב-' + d.paths.length + ' קבצים (מפורטים בפרטים הטכניים)';
}

var MOVE_TO_VAULT = 'להעביר את הסודות ל-Secrets Manager / Key Vault';

// Where the user revokes a token, per provider named in the Wiz title
function revokeHint(name) {
  var n = String(name || '');
  if (/github/i.test(n)) return 'יש לבטל את ה-token ב-GitHub (Settings → Developer settings → Tokens) וליצור חדש עם הרשאות מינימליות ותוקף מוגבל';
  if (/gitlab/i.test(n)) return 'יש לבטל את ה-token ב-GitLab (Access Tokens של המשתמש / הפרויקט) וליצור חדש עם הרשאות מינימליות ותוקף מוגבל';
  if (/openai/i.test(n)) return 'יש לבטל את המפתח ב-OpenAI (API keys) וליצור מפתח חדש';
  if (/minio/i.test(n)) return 'יש להחליף את ה-Secret Key של המשתמש / ה-Access Key ב-MinIO';
  if (/google oauth/i.test(n)) return 'יש לבצע Reset ל-Client Secret ב-Google Cloud Console (APIs & Services → Credentials)';
  if (/wiz/i.test(n)) return 'יש למחוק את ה-Service Account ב-Wiz (Settings → Service Accounts) וליצור חדש';
  return 'יש לבטל את הסוד אצל הספק שהנפיק אותו וליצור סוד חדש';
}

var IMPACT = {
  git: 'תוקף שישיג גישה לקבצים הנ"ל יוכל להשתמש בפרטי ההזדהות כדי לגשת ל-repository, לקרוא את קוד המקור והסודות שבו ואף לשנות קוד (Supply Chain).',
  privateKey: 'תוקף שישיג אחיזה בשרת יוכל לפתוח את התקשורת המוצפנת / להזדהות למערכות באופן חופשי ובכך לייצא מידע או לבצע פעולות אקטיביות.',
  awsKey: 'תוקף שישיג גישה לקבצים הנ"ל יוכל להשתמש במפתח כדי לבצע פעולות בחשבון ה-AWS בהרשאות של ה-IAM identity שמשויכת אליו.',
  gcpSaKey: 'תוקף שישיג גישה לקובץ המפתח יוכל להזדהות כ-service account ולבצע פעולות ב-GCP בהרשאות שלו, גם מחוץ לסביבה.',
  gcpRefresh: 'תוקף שמשיג גישה לשרת יכול לקרוא את נתוני ההזדהות בקבצים הנ"ל ולקבל את ההרשאות של אותו משתמש.',
  apiToken: 'תוקף שישיג גישה לקבצים הנ"ל יוכל להשתמש בסוד כדי לגשת לשירות שהוא מגן עליו, לקרוא נתונים ולבצע פעולות בהרשאות הסוד.'
};

/**
 * Build the finding text for one SECR template variant from extracted data.
 * variant: 'secret-git' | 'secret-private-key' | 'secret-cloud-key' | 'secret-gcp-refresh' | 'secret-api-token'
 * Returns {fields:{title, description, impact, recs}, missing:[PLACEHOLDER names left unresolved]} or null.
 * The title is kept as Wiz wrote it when it already fits the variant.
 */
export function buildSecretFinding(variant, data, currentTitle) {
  var d = data || {};
  var missing = [];
  var f;
  var where = whereClause(d);
  var at = pathClause(d);
  var keepTitle = function(re, fallback) {
    var t = String(currentTitle || '').trim();
    return t && re.test(t) ? t : fallback;
  };

  if (variant === 'secret-git') {
    var url = pick(d.gitUrl, 'REPO_URL', missing);
    var user = d.gitUser ? ' של המשתמש `' + d.gitUser + '`' : '';
    var recs = [
      'יש לבטל מיידית (Revoke) את הסיסמה / ה-token' + user + (d.gitHost ? ' ב-' + d.gitHost : ' בשרת ה-Git') + ' ולבצע רוטציה של פרטי ההזדהות',
      'יש להסיר את פרטי ההזדהות מכתובת ה-remote ומהקבצים הנ"ל, ולהשתמש בהזדהות שאינה שומרת סוד בקוד (SSH deploy key / credential helper / משתנה סביבה בזמן ה-build בלבד)'
    ];
    if (/image/i.test(d.resourceType || '')) {
      recs.push('יש לבנות מחדש את ה-image ללא הסוד (כולל השכבות הקודמות) ולמחוק מה-registry את הגרסאות שמכילות אותו');
    }
    recs.push('יש לבדוק ב-audit log של שרת ה-Git האם נעשה שימוש חריג בפרטי ההזדהות');
    recs.push(MOVE_TO_VAULT);
    f = {
      title: keepTitle(/git credentials/i, 'Git Credentials (' + url + ')'),
      description: 'זוהו פרטי הזדהות ל-Git בטקסט גלוי' + (d.gitUrl ? ' עבור ה-repository `' + d.gitUrl + '`' : '') +
        (user ? ' (משתמש `' + d.gitUser + '`)' : '') + where + at + '. כל מי שיש לו גישה לקבצים יכול להשתמש בהם לגישה ל-repository.',
      impact: IMPACT.git,
      recs: recs.join('\n')
    };
  } else if (variant === 'secret-private-key') {
    var ssh = /ssh/i.test(d.name || '');
    var prs = [
      'יש לבצע בדיקה מה המפתח / התעודה הנ"ל יש לבדוק האם ניתן להגדיר אותם בתוך Secret Manager או Key Vault.',
      'במידה וכן, יש לבצע זאת ולמחוק את הקובץ עם המלצה לבצע רוטציה של המפתח'
    ];
    f = {
      title: keepTitle(/private key/i, 'Private Key'),
      description: 'זוהה ' + (ssh ? 'מפתח SSH פרטי' : 'מפתח פרטי (Private Key)') + where + at + '. מפתח פרטי הנשמר בקובץ גלוי מאפשר לכל מי שניגש לקובץ להזדהות או לפענח תקשורת בשם הבעלים שלו.',
      impact: IMPACT.privateKey,
      recs: prs.join('\n')
    };
  } else if (variant === 'secret-cloud-key') {
    var isAws = /aws/i.test(d.name || '') || d.awsKeyId || /^AWS$/i.test(d.cloud || '');
    if (isAws) {
      var kid = pick(d.awsKeyId, 'ACCESS_KEY_ID', missing);
      var temp = /^ASIA/.test(d.awsKeyId || '');  // ASIA = temporary STS credentials, AKIA = long-lived
      var ars = temp
        ? ['מדובר במפתחות זמניים (STS, מתחילים ב-ASIA) שתוקפם מוגבל, אך ניתן להשתמש בהם עד לפקיעתם. יש לבטל את ה-sessions (Revoke active sessions על ה-role) ולוודא שאינם נשמרים בקבצים']
        : ['יש להשבית (Inactive) ולמחוק את ה-Access Key: aws iam update-access-key --access-key-id ' + kid + ' --status Inactive --user-name <IAM_USER>',
           'יש ליצור מפתח חדש רק אם נדרש, ולהעדיף IAM Role (Instance Profile / IRSA) על פני מפתח סטטי'];
      if (d.fromHistory) ars.push('יש לנקות את קובץ ה-history (bash/zsh) מהמכונה ולהימנע מהקלדת מפתחות בשורת הפקודה');
      ars.push('יש לבדוק ב-CloudTrail האם נעשה שימוש חריג במפתח');
      ars.push(MOVE_TO_VAULT);
      f = {
        title: keepTitle(/aws access key/i, 'AWS Access Key (AccessKeyId=' + kid + ')'),
        description: (d.awsKeyIds.length > 1
          ? 'זוהו ' + d.awsKeyIds.length + ' AWS Access Keys (כולל `' + kid + '`)'
          : 'זוהה AWS Access Key `' + kid + '`') + (temp ? (d.awsKeyIds.length > 1 ? ' (מפתחות זמניים)' : ' (מפתח זמני)') : '') + where + at + ' בטקסט גלוי.',
        impact: IMPACT.awsKey,
        recs: ars.join('\n')
      };
    } else {
      var sa = pick(d.serviceAccount, 'SERVICE_ACCOUNT_EMAIL', missing);
      var grs = [
        'יש למחוק את מפתח ה-service account: gcloud iam service-accounts keys delete <KEY_ID> --iam-account=' + sa,
        'יש להעדיף שימוש ב-service account המשויך למשאב (Attached SA) או ב-Workload Identity על פני קובץ מפתח',
        'יש לבדוק ב-Cloud Audit Logs האם נעשה שימוש חריג במפתח',
        MOVE_TO_VAULT
      ];
      f = {
        title: keepTitle(/service account key/i, 'GCP Service Account Key (ServiceAccount=' + sa + ')'),
        description: 'זוהה קובץ מפתח של ה-service account `' + sa + '`' + where + at + ' בטקסט גלוי.',
        impact: IMPACT.gcpSaKey,
        recs: grs.join('\n')
      };
    }
  } else if (variant === 'secret-gcp-refresh') {
    var who = d.userEmail ? ' של המשתמש `' + d.userEmail + '`' : ' של משתמש';
    var rrs = [d.fromLogs ? 'יש למחוק את קבצי הלוג הנ"ל מהמכונה.' : 'יש למחוק את קבצי ה-credentials של gcloud הנ"ל מהמכונה (gcloud auth revoke).',
      'אין לבצע gcloud auth login בתוך מכונה. בשביל זה יש SA שמוצמד למכונה, ניתן לתת לו את ההרשאות הנדרשות לביצוע פעולות מאותו ה-VM',
      'יש לבטל את ה-session של המשתמש (gcloud auth revoke / ניהול טוקנים בחשבון Google) ולהחליף את הסיסמה במידת הצורך'];
    f = {
      title: keepTitle(/refresh token/i, 'GCP Refresh Token'),
      description: 'זוהו פרטי הזדהות' + who + ' (Refresh Token) ' + (d.fromLogs ? 'בקבצי לוג של gcloud' : 'בקבצים של gcloud') + where + at +
        '. טוקן רענון מאפשר ליצור Access Token חדשים ללא הזדהות נוספת, עד לביטולו.',
      impact: IMPACT.gcpRefresh,
      recs: rrs.join('\n')
    };
  } else if (variant === 'secret-api-token') {
    var nm = pick(d.name, 'SECRET_NAME', missing);
    var trs = [
      revokeHint(d.name) + ', ולבצע רוטציה מיידית של הסוד החשוף',
      'יש להסיר את הסוד מהקוד / מהקבצים הנ"ל' + (/repo|git|code|infrastructure|configuration/i.test(d.context || '') ? ' וכן מהיסטוריית ה-Git (git filter-repo / BFG)' : ''),
      'יש לבדוק בלוגים של השירות האם נעשה שימוש חריג בסוד',
      MOVE_TO_VAULT
    ];
    f = {
      title: keepTitle(/./, nm),
      description: 'זוהה סוד מסוג `' + nm + '`' + where + at + ' בטקסט גלוי.',
      impact: IMPACT.apiToken,
      recs: trs.join('\n')
    };
  } else {
    return null;
  }
  return { fields: f, missing: missing };
}

export var SECRET_VARIANTS = ['secret-git', 'secret-private-key', 'secret-cloud-key', 'secret-gcp-refresh', 'secret-api-token'];

/** Which SECR variant fits the data of a finding. */
export function pickSecretVariant(d) {
  d = d || {};
  var n = d.name || '';
  if (/git credentials/i.test(n) || d.secretType === 'GIT_CREDENTIAL') return 'secret-git';
  if (d.secretType === 'PRIVATE_KEY' || /private key/i.test(n)) return 'secret-private-key';
  if (/refresh token/i.test(n)) return 'secret-gcp-refresh';
  if (/aws access key|service account key/i.test(n)) return 'secret-cloud-key';
  if (d.secretType === 'SAAS_API_KEY') return 'secret-api-token';
  return null;
}
