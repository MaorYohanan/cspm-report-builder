// ═══════════════════════════════════════════
// Smart CSPM / HSPM / EOLM templates (firewall rules, subnets, default service account, host
// configuration, end of life). Same idea as the SECR templates: the text is rebuilt from the data of
// the finding (resource names, region, subscriptions, components). The wording is in
// .plan/smart-templates-draft-text.md. Values that cannot be found stay as visible <PLACEHOLDERS>.
// Pure functions (no DOM) so they can be tested in Node.
// ═══════════════════════════════════════════
import { techValue, toText, pick } from './template-fill.js';

var EXCEPTION = 'אם יש צורך עסקי בכך, יש לציין את הסיבה ונשקול החרגה.';
var MAX_LISTED = 8;

function splitList(text) {
  return String(text || '').split(/,\s*/).map(function(s) { return s.trim(); }).filter(Boolean);
}

// "a, b ועוד 3..." (Wiz shortened list written by the import) -> names + the number that was cut
function namesOf(text) {
  var more = 0;
  var cleaned = String(text || '').replace(/[\s,]*ועוד\s+(\d+)\.*\s*$/, function(_, n) { more = parseInt(n, 10); return ''; });
  return { names: splitList(cleaned), more: more };
}

/**
 * Read the data these findings carry.
 * src: {title, technical} (strings or arrays, as in the edit form).
 * Everything comes from the technical details, so it also works on findings whose text was rewritten by hand.
 */
export function extractConfigData(src) {
  src = src || {};
  var res = namesOf(techValue(src.technical, 'Resource'));
  var out = { resources: res.names, moreResources: res.more };
  out.regions = splitList(techValue(src.technical, 'Region'));
  out.subscriptions = splitList(techValue(src.technical, 'Subscription'));
  // End of life: one "- name." (optionally ", EOL date YYYY-MM-DD") line per component
  var lines = Array.isArray(src.technical) ? src.technical : String(src.technical || '').split('\n');
  out.components = [];
  lines.forEach(function(line) {
    var m = /^\s*-\s+(.+?)\s*$/.exec(String(line));
    if (!m) return;
    var name = m[1].replace(/,\s*EOL date\b.*$/i, '').replace(/\.$/, '').trim();
    if (name && out.components.indexOf(name) === -1) out.components.push(name);
  });
  return out;
}

// `a`, `b` ועוד 3  (the list is capped; a number that Wiz or the cap cut is written as "ועוד N")
function listText(names, more, cap) {
  var shown = names.slice(0, cap || MAX_LISTED);
  var rest = (more || 0) + names.length - shown.length;
  return shown.map(function(n) { return '`' + n + '`'; }).join(', ') + (rest > 0 ? ' ועוד ' + rest : '');
}

function resourcesText(d, missing) {
  return d.resources.length ? listText(d.resources, d.moreResources) : pick(null, 'RESOURCES', missing);
}

// The one name a command example can use; the placeholder stays when the finding has several
function singleName(d, placeholder) {
  return d.resources.length === 1 && !d.moreResources ? d.resources[0] : '<' + placeholder + '>';
}

var VARIANTS = {
  'vpc-any-ip': {
    category: 'CSPM',
    title: 'VPC firewall rule should not allow access from any IP',
    titleRe: /should not allow access from any IP/i,
    build: function(d, missing) {
      return {
        description: 'זוהו חוקי firewall המאפשרים גישה מכל כתובת IP (0.0.0.0/0 או ::/0): ' + resourcesText(d, missing) +
          '. כלומר, כל כתובת באינטרנט יכולה לנסות להתחבר למשאבים שהחוקים חושפים, בפורטים שהחוקים מאפשרים.',
        impact: 'פתיחה לכל האינטרנט חושפת את השירות לסריקות אוטומטיות, לניסיונות ניחוש סיסמאות ולניצול פגיעויות ידועות. כל תוקף בעולם יכול לנסות, בלי גישה מוקדמת לרשת הארגון.',
        recs: [
          'יש להחליף את מקור הגישה בטווחי ה-IP שבאמת צריכים גישה (כתובות הארגון, VPN או ה-Load Balancer).',
          'אם השירות מיועד לציבור (למשל אתר HTTP/HTTPS), יש לוודא שהוא מאחורי Load Balancer / WAF, ולהגביל את החוק לפורטים הנדרשים בלבד.',
          EXCEPTION
        ]
      };
    }
  },
  'vpc-private-networks': {
    category: 'CSPM',
    title: 'VPC firewall rule should allow access to specific private networks only',
    titleRe: /allow access to specific private networks only/i,
    build: function(d, missing) {
      return {
        description: 'זוהו חוקי firewall המאפשרים גישה מכל הטווחים הפרטיים (10.0.0.0/8, 172.16.0.0/12 ו-192.168.0.0/16): ' + resourcesText(d, missing) +
          '. כלומר, הגישה פתוחה מכל מכונה ברשת הפנימית ולא רק ממכונות שצריכות אותה.',
        impact: 'אם מכונה כלשהי ברשת נפרצת, התוקף יכול לגשת ממנה למשאבים האלה ולהתקדם הלאה ברשת (תנועה לרוחב). ככל שהטווח רחב יותר, יותר מכונות יכולות לשמש נקודת פתיחה לתוקף.',
        recs: [
          'יש לבדוק אילו מכונות או subnets צריכים גישה בפועל, ולהגדיר אותם בלבד כמקור (source ranges, network tags או service accounts).',
          'אם נדרשת גישה מכל הרשת הפנימית, יש לציין את הסיבה ונשקול החרגה.'
        ]
      };
    }
  },
  'vpc-all-ports': {
    category: 'CSPM',
    title: 'VPC firewall rule should allow access over specific ports only',
    titleRe: /allow access over specific ports only/i,
    build: function(d, missing) {
      return {
        description: 'זוהו חוקי firewall המאפשרים גישה בכל הפורטים: ' + resourcesText(d, missing) + '. כלומר, הגישה פתוחה גם לפורטים שהשירות לא צריך.',
        impact: 'כל שירות שרץ על המכונות, כולל שירותי ניהול ובסיסי נתונים שלא נועדו לגישה מבחוץ, נגיש למי שמגיע לחוק. תוקף יכול למצוא שירות חלש או לא מוגן ולהיכנס דרכו.',
        recs: [
          'יש לבדוק באילו פורטים השירות באמת מקבל חיבורים, ולהגדיר בחוק רק אותם, באמצעות הפרמטר: --allow tcp:<PORT>',
          'יש להגביל גם את המקור (source ranges) למי שצריך גישה.',
          'אם יש צורך עסקי בפתיחת כל הפורטים, יש לציין את הסיבה ונשקול החרגה.'
        ]
      };
    }
  },
  'vpc-uncommon-ports': {
    category: 'CSPM',
    title: 'VPC firewall rule should restrict access over uncommon ports',
    titleRe: /restrict access over uncommon ports/i,
    build: function(d, missing) {
      return {
        description: 'זוהו חוקי firewall המאפשרים גישה לפחות לאחד מהפורטים של בסיסי נתונים ושל RDP: 1433 (SQL Server), 1521 (Oracle), 3306 (MySQL), 3389 (RDP) ו-5432 (PostgreSQL): ' +
          resourcesText(d, missing) + '.',
        impact: 'פורטים אלה מיועדים לבסיסי נתונים ולשולחן עבודה מרוחק, ואינם אמורים להיות חשופים לרשת רחבה. תוקף שמגיע אליהם יכול לנסות ניחוש סיסמאות, לנצל פגיעויות ולהגיע ישירות לנתונים או לשליטה מלאה במכונה.',
        recs: [
          'יש לסגור את הפורטים האלה, או להגביל אותם רק למכונות וכתובות שצריכות אותם.',
          'לגישה של אנשים (תחזוקה, ניהול) יש להעדיף VPN, IAP או Bastion במקום פתיחת הפורט. אם משתמשים ב-IAP, יש להתיר בחוק רק את טווח ה-IP שלו: 35.235.240.0/20',
          EXCEPTION
        ]
      };
    }
  },
  'vpc-vnc': {
    category: 'CSPM',
    title: 'VPC firewall rule should restrict VNC access (TCP - ports 5500, 5800 and 5900)',
    titleRe: /restrict VNC access/i,
    build: function(d, missing) {
      return {
        description: 'זוהו חוקי firewall המאפשרים גישה לפורטי VNC (TCP 5500, 5800 ו-5900): ' + resourcesText(d, missing) +
          '. VNC הוא פרוטוקול לשליטה גרפית מרחוק במכונה.',
        impact: 'VNC נותן שליטה מלאה במסך ובמקלדת של המכונה. הוא בדרך כלל מוגן רק בסיסמה פשוטה, ולעיתים התעבורה אינה מוצפנת. מי שנכנס דרכו שולט במכונה כאילו ישב מולה.',
        recs: [
          'יש לסגור את פורטים 5500, 5800 ו-5900 בחוקים.',
          'לגישה מרחוק יש להשתמש ב-IAP TCP forwarding, ב-SSH tunnel או ב-VPN.',
          'אם VNC חייב להישאר פתוח, יש להגביל אותו לכתובות ספציפיות, לציין את הסיבה ונשקול החרגה.'
        ]
      };
    }
  },
  'subnet-private-google-access': {
    category: 'CSPM',
    title: 'VPC subnet should have Private Google Access enabled',
    titleRe: /subnet should have Private Google Access enabled/i,
    build: function(d, missing) {
      var region = d.regions.length ? d.regions[0] : null;
      var where = d.regions.length > 1 ? 'באזורים ' + listText(d.regions, 0) : 'באזור ' + (region ? '`' + region + '`' : pick(null, 'REGION', missing));
      return {
        description: 'ב-subnets הבאים ' + where + ' לא מופעל Private Google Access: ' + resourcesText(d, missing) +
          '. מכונות ב-subnet שאין להן כתובת IP חיצונית לא יכולות לגשת לשירותי Google (כמו Cloud Storage ו-API של GCP) דרך הרשת הפרטית.',
        impact: 'כשאין Private Google Access, הצוותים נאלצים לתת למכונות כתובת חיצונית או להעביר את התעבורה דרך האינטרנט. זה מרחיב את החשיפה לאינטרנט, ומקשה להגביל את הגישה ל-API של Google לערוץ פרטי בלבד.',
        recs: [
          'יש להפעיל Private Google Access בכל subnet שיש בו מכונות שפונות ל-API של Google, באמצעות הפקודה: gcloud compute networks subnets update ' +
            singleName(d, 'SUBNET') + ' --region=' + (d.regions.length === 1 ? d.regions[0] : '<REGION>') + ' --enable-private-ip-google-access',
          'אם ב-subnet אין מכונות שצריכות גישה ל-API של Google, יש לציין זאת ונשקול החרגה.'
        ]
      };
    }
  },
  'default-service-account': {
    category: 'CSPM',
    title: 'Compute instance should not use the default Compute Engine service account with full API access',
    titleRe: /default Compute Engine service account with full API access/i,
    build: function(d, missing) {
      return {
        description: 'זוהו מכונות שרצות עם ה-service account של ברירת המחדל של Compute Engine, כשה-access scope שלהן הוא Full access to all Cloud APIs: ' + resourcesText(d, missing) + '.',
        impact: 'אם תוקף משיג הרצת קוד על המכונה (למשל דרך פגיעות באפליקציה), הוא יכול לבקש מהמכונה token של ה-service account ולפעול מול שירותי GCP בהרשאות שלו. בפרויקטים רבים יש לחשבון ברירת המחדל הרשאת Editor על כל הפרויקט, ולכן פריצה של מכונה אחת עלולה להפוך לפריצה של הפרויקט כולו.',
        recs: [
          'יש ליצור service account ייעודי לכל מכונה (או סוג מכונה) עם ההרשאות IAM שהיא צריכה בלבד.',
          'יש להחליף אותו במכונה (היא צריכה להיות כבויה) ולהגדיר scopes מצומצמים, באמצעות הפקודה: gcloud compute instances set-service-account ' +
            singleName(d, 'INSTANCE') + ' --zone=<ZONE> --service-account=<NEW_SA> --scopes=<MINIMAL_SCOPES>',
          'יש לבדוק אילו הרשאות יש לחשבון ברירת המחדל בפרויקט, ולהסיר ממנו Editor רק אחרי שמוודאים שאף מכונה אחרת לא נשענת עליו.',
          'אם יש צורך עסקי בהרשאה המלאה, יש לציין את הסיבה ונשקול החרגה.'
        ]
      };
    }
  },
  'hspm-kernel-modules': {
    category: 'HSPM',
    title: 'Ensure CopyFail2 and DirtyFrag vulnerable kernel modules are disabled',
    titleRe: /CopyFail2 and DirtyFrag/i,
    build: function(d, missing) {
      return {
        description: 'במכונות הבאות לא נחסמה האפשרות לטעון את מודולי הליבה esp4, esp6 ו-rxrpc, שבהם יש פגיעויות (CopyFail2 ו-DirtyFrag): ' + resourcesText(d, missing) + '.',
        impact: 'פגיעות בליבה (kernel) ניתנת לניצול ממכונה שהתוקף כבר נכנס אליה, למשל דרך אפליקציה פגיעה או סיסמה גנובה. ניצול כזה עלול לתת לו שליטה רחבה בהרבה מההרשאות שקיבל בכניסה.',
        recs: [
          'יש לעדכן את ה-kernel לגרסה שבה הפגיעויות תוקנו.',
          'עד העדכון, יש לחסום את טעינת המודולים באמצעות הוספת השורות הבאות לקובץ ב-/etc/modprobe.d: install esp4 /bin/false, install esp6 /bin/false, install rxrpc /bin/false',
          'אם המודולים כבר טעונים, יש להסיר אותם באמצעות הפקודה: modprobe -r esp4 esp6 rxrpc',
          'esp4 ו-esp6 משמשים ל-IPsec, ולכן לפני החסימה יש לוודא שהמכונה לא משתמשת ב-IPsec.'
        ]
      };
    }
  },
  'hspm-cups-browsed': {
    category: 'HSPM',
    title: 'Check if CUPS browsed was installed and was active at least once',
    titleRe: /CUPS browsed/i,
    build: function(d, missing) {
      return {
        description: 'במכונות הבאות הותקן השירות cups-browsed (שירות לגילוי מדפסות ברשת), והוא פעל לפחות פעם אחת: ' + resourcesText(d, missing) + '.',
        impact: 'השירות מקבל הודעות מהרשת, ונמצאו בו פגיעויות להרצת קוד מרחוק (למשל CVE-2024-47176). לשרת אין צורך בהדפסה, ולכן זהו משטח תקיפה מיותר שמאפשר לתוקף ברשת להריץ פקודות על המכונה.',
        recs: [
          'יש להשבית את השירות באמצעות הפקודה: systemctl disable --now cups-browsed',
          'יש להסיר את החבילה מהמכונה (בהפצות מבוססות Debian / Ubuntu): apt remove cups-browsed',
          'מאחר שהשירות פעל, יש לבדוק שלא נעשה בו שימוש חריג, למשל מדפסות לא מוכרות שהוגדרו במכונה.',
          'אם השירות נדרש, יש לעדכן אותו לגרסה האחרונה ולחסום UDP 631 ב-firewall, ולציין את הסיבה ונשקול החרגה.'
        ]
      };
    }
  },
  'hspm-redis-protected-mode': {
    category: 'HSPM',
    title: "Ensure Redis is in 'protected-mode'",
    titleRe: /Redis is in .?protected-mode.?/i,
    build: function(d, missing) {
      return {
        description: 'בשרתי Redis במכונות הבאות מצב protected-mode כבוי: ' + resourcesText(d, missing) +
          '. מצב זה חוסם חיבורים מכתובות חיצוניות כשלא הוגדרו סיסמה ו-bind מפורש.',
        impact: 'בלי protected-mode ובלי הגבלות רשת, כל מי שמגיע לפורט 6379 יכול לקרוא, לשנות ולמחוק את כל הנתונים ב-Redis. ידועה גם שיטת תקיפה שמנצלת את הפקודה CONFIG כדי לכתוב קובץ למכונה (למשל מפתח SSH) ולקבל גישה אליה.',
        recs: [
          'יש להפעיל את מצב protected-mode ולהגביל את כתובת ה-bind לכתובת פנימית, בקובץ ההגדרות של Redis.',
          'יש לחסום את פורט 6379 ב-firewall, ולאפשר אותו רק למכונות שצריכות לגשת ל-Redis.',
          'אם ה-Redis הוא חלק ממוצר של יצרן, יש לוודא מול היצרן לפני שינוי, לציין זאת ונשקול החרגה.'
        ]
      };
    }
  },
  'hspm-redis-password': {
    category: 'HSPM',
    title: 'Ensure Redis is configured with a strong password',
    titleRe: /Redis is configured with a strong password/i,
    build: function(d, missing) {
      return {
        description: 'שרתי Redis במכונות הבאות פועלים ללא סיסמה (לא הוגדרו requirepass, user או aclfile), ולכן כל מי שמגיע אליהם יכול להתחבר בלי הזדהות: ' +
          resourcesText(d, missing) + '.',
        impact: 'כל מי שמגיע לפורט 6379 מקבל גישה מלאה לנתונים ולפקודות הניהול, בלי להזדהות. אפשר לגנוב או למחוק נתונים, ולעיתים להשתמש בפקודות הניהול כדי להשתלט על המכונה.',
        recs: [
          'יש להגדיר סיסמה חזקה (הפרמטר requirepass), או משתמשי ACL ייעודיים לכל אפליקציה.',
          'יש להגביל את הגישה לפורט 6379 למכונות שצריכות אותו בלבד.',
          'מאחר שהשירות היה פתוח, יש לבדוק שלא נכתבו במכונה מפתחות SSH או משימות cron לא מוכרים, ושלא נוספו או נמחקו מפתחות ב-Redis.',
          'אם ה-Redis הוא חלק ממוצר של יצרן, יש לוודא מול היצרן לפני שינוי, לציין זאת ונשקול החרגה.'
        ]
      };
    }
  },
  'eolm-end-of-life': {
    category: 'EOLM',
    title: 'רכיבים בסוף חיים (End of Life)',
    titleRe: /End of Life|סוף חיים/i,
    severity: 'medium',
    build: function(d, missing) {
      var subs = d.subscriptions.length
        ? (d.subscriptions.length > 1 ? 'במנויים ' : 'במנוי ') + listText(d.subscriptions, 0)
        : 'במנוי ' + pick(null, 'SUBSCRIPTIONS', missing);
      var n = d.components.length;
      var what;
      if (!n) {
        what = 'זוהו ' + pick(null, 'COUNT', missing) + ' רכיבים שהגיעו לסוף תמיכה (End of Life): ' + pick(null, 'COMPONENTS', missing);
      } else {
        what = (n === 1 ? 'זוהה רכיב אחד שהגיע' : 'זוהו ' + n + ' רכיבים שהגיעו') + ' לסוף תמיכה (End of Life): ' + listText(d.components, 0);
      }
      return {
        description: subs + ' ' + what + '.',
        impact: 'רכיב שהגיע לסוף תמיכה לא מקבל עוד עדכוני אבטחה. פגיעויות חדשות שיתגלו בו לא יתוקנו ויישארו ניתנות לניצול לאורך זמן, ובדרך כלל פרטיהן מתפרסמים ברבים.',
        recs: [
          'ספריות (רכיבים שמופיעים כ-pkg): יש לעדכן את התלות בקוד לגרסה נתמכת ולבנות מחדש את ה-image או את האפליקציה.',
          'מערכות הפעלה, runtime ואפליקציות (למשל Ubuntu, Python, Edge): יש לשדרג לגרסה נתמכת, או לתכנן מיגרציה בהתאם ללוח הזמנים של היצרן.',
          'אם לא ניתן לשדרג כעת, יש לבודד את הרכיב (הגבלת גישת רשת) ולהקשיח אותו עד לשדרוג.',
          'אם יש צורך עסקי בכך, יש לציין את תוכנית המיגרציה ונשקול החרגה זמנית.'
        ]
      };
    }
  }
};

export var CONFIG_VARIANTS = Object.keys(VARIANTS);

/** Entries for the finding templates dropdown. */
export function configDropdownEntries() {
  return CONFIG_VARIANTS.map(function(key) {
    var v = VARIANTS[key];
    return { category: v.category, smart: key, title: v.title, severity: v.severity || 'high' };
  });
}

/** Which variant fits a finding (null when none does). Matches the category and the Wiz rule title. */
export function pickConfigVariant(category, title) {
  var t = String(title || '');
  for (var i = 0; i < CONFIG_VARIANTS.length; i++) {
    var v = VARIANTS[CONFIG_VARIANTS[i]];
    if (v.category === category && v.titleRe.test(t)) return CONFIG_VARIANTS[i];
  }
  return null;
}

/**
 * Build the finding text for one variant. The title is kept as Wiz wrote it when it already fits the variant.
 * Returns {fields:{title, description, impact, recs}, missing:[PLACEHOLDER names left unresolved]} or null.
 */
export function buildConfigFinding(variant, data, currentTitle) {
  var v = VARIANTS[variant];
  if (!v) return null;
  var missing = [];
  var b = v.build(data || {}, missing);
  var t = toText(currentTitle).trim();
  return {
    fields: {
      title: t && v.titleRe.test(t) ? t : v.title,
      description: b.description,
      impact: b.impact,
      recs: b.recs.join('\n')
    },
    missing: missing
  };
}
