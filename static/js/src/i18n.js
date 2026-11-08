// i18n.js — UI language module for the CSPM Report Builder
// Keys are Hebrew strings verbatim (matching data-i18n / data-i18n-title attribute values).
// TRANSLATIONS.he is intentionally empty: the key IS the Hebrew string (fallback to key).
// English translations cover all data-i18n and data-i18n-title keys present in index.html.

const TRANSLATIONS = {
  he: {},
  en: {
    // ── Keyboard overlay ──
    'קיצורי מקלדת': 'Keyboard Shortcuts',
    'הצג/הסתר קיצורים': 'Show/Hide Shortcuts',
    'ניווט בטבלת ממצאים': 'Navigate findings table',
    'ערוך ממצא נבחר': 'Edit selected finding',
    'מחק ממצא נבחר': 'Delete selected finding',
    'הוסף/עדכן ממצא': 'Add / Update finding',
    'הדבק תמונת הוכחה': 'Paste evidence image',
    'ניווט בין טאבים': 'Navigate between tabs',
    // ── Preview panel ──
    'תצוגה מקדימה': 'Preview',
    'ערוך ממצא': 'Edit Finding',
    // ── Autofill ──
    'מלא אוטומטית': 'Auto-fill',
    // ── Sidebar sections & items ──
    'דו"ח חדש': 'New Report',
    'לא הוגדרה סביבה': 'No environment set',
    'אזור עבודה': 'Workspace',
    'לוח בקרה': 'Dashboard',
    'פרטי דו"ח': 'Report Details',
    'ממצאים': 'Findings',
    'הוסף ממצא': 'Add Finding',
    'קבצים ודוחות': 'Files & Reports',
    'קבצי שרת': 'Server Files',
    'מוצרים': 'Products',
    'לוח סריקות': 'Scan Board',
    'רשימת חריגות': 'Exceptions List',
    'רשימת סינון': 'Filter Rules',
    // ── Progress bar ──
    'התקדמות': 'Progress',
    '0 מתוך 4 שלבים': '0 of 4 steps',
    'שם לקוח': 'Client Name',
    'סביבת ענן': 'Cloud Environment',
    'ייצוא דו"ח': 'Export Report',
    // ── Dashboard ──
    'סה"כ ממצאים': 'Total Findings',
    'קריטי': 'Critical',
    'גבוה': 'High',
    'בינוני': 'Medium',
    'נמוך': 'Low',
    'פילוח חומרה': 'Severity Breakdown',
    'פילוח קטגוריות': 'Category Breakdown',
    'הערכת סיכון': 'Risk Assessment',
    'ממצאים אחרונים': 'Recent Findings',
    'הצג הכל ←': 'Show All →',
    // ── Report details panel ──
    '💾 שמור כברירת מחדל': '💾 Save as Default',
    '📂 טען ברירת מחדל': '📂 Load Default',
    '✕ מחק ברירת מחדל': '✕ Delete Default',
    '📦 שמור כגרסת מוצר': '📦 Save as Product Version',
    'פרטי לקוח': 'Client Details',
    'תאריכים והערכה': 'Dates & Assessment',
    'תוכן הדו"ח': 'Report Content',
    'הגדרות ועיצוב': 'Settings & Design',
    'שם הלקוח': 'Client Name',
    'ענן': 'Cloud',
    'סביבת בדיקה': 'Test Environment',
    'יועץ / גוף מבצע': 'Consultant / Executing Body',
    'שם הצוות / כותרת': 'Team Name / Title',
    'שם הארגון': 'Organization Name',
    'תאריך הדו"ח': 'Report Date',
    'טווח הבדיקה': 'Assessment Range',
    'הערכת סיכון כללית': 'Overall Risk Assessment',
    'גרסה': 'Version',
    'תקציר מנהלים': 'Executive Summary',
    'נושאי מפתח': 'Key Topics',
    'טקסט תחתית': 'Footer Text',
    'הערת שער': 'Cover Note',
    'שפה': 'Language',
    'תמונת שער': 'Cover Image',
    'מודל AI': 'AI Model',
    '-- לא נבחר --': '-- Not Selected --',
    'נמוכה': 'Low',
    'בינונית': 'Medium',
    'גבוהה': 'High',
    'קריטית': 'Critical',
    'עברית': 'Hebrew',
    // ── Finding form ──
    'תבנית מוכנה': 'Template',
    'קטגוריה': 'Category',
    'מזהה *': 'ID *',
    'כותרת ממצא *': 'Finding Title *',
    'חומרה': 'Severity',
    'תיאור': 'Description',
    'השפעה / סיכון': 'Impact / Risk',
    'פרטים טכניים': 'Technical Details',
    'מדיניות / תקנים': 'Policies / Standards',
    'המלצות': 'Recommendations',
    'בעלים / צוות אחראי': 'Owner / Responsible Team',
    'עדיפות טיפול': 'Remediation Priority',
    'הוכחה (תמונה)': 'Evidence (Image)',
    '-- בחר תבנית --': '-- Select Template --',
    'מידע': 'Info',
    '-- לא צוין --': '-- Not Specified --',
    'מיידי (0–7 ימים)': 'Immediate (0–7 days)',
    'גבוהה (עד 30 ימים)': 'High (up to 30 days)',
    'בינונית (30–60 ימים)': 'Medium (30–60 days)',
    'נמוכה (60–120 ימים)': 'Low (60–120 days)',
    'למעקב': 'Follow-up',
    'אחר (טקסט חופשי)': 'Other (free text)',
    'בטל עריכה': 'Cancel Edit',
    'נקה טופס': 'Clear Form',
    '⚠ מוחרג — ממצא זה אושר כחריגה': '⚠ Excluded — this finding has been acknowledged',
    'סיבת ההחרגה (אופציונלי)': 'Exclusion Reason (optional)',
    'גרור / לחץ / ': 'Drag / Click / ',
    // ── Findings list ──
    'כל הקטגוריות': 'All Categories',
    'כל החומרות': 'All Severities',
    'הצג את כל המוסתרים (מוחרגים + מאושרים)': 'Show all dismissed (excluded + acknowledged)',
    'עוד': 'More',
    'פעולות נוספות': 'More actions',
    'עדיפות': 'Priority',
    'מיידי': 'Immediate',
    'מיין ↓': 'Sort ↓',
    'מזהה': 'ID',
    'כותרת': 'Title',
    'בעלים': 'Owner',
    '🤖 שיפור המלצות לנבחרים': '🤖 Improve Selected Recommendations',
    '🤖 שיפור המלצות להכל': '🤖 Improve All Recommendations',
    '🔍 זהה כפילויות': '🔍 Detect Duplicates',
    '🗑️ מחק נבחרים': '🗑️ Delete Selected',
    '✕ מחק הכל': '✕ Delete All',
    '+ הוסף': '+ Add',
    'בחר ממצא מהרשימה לצפייה בפרטים': 'Select a finding from the list to view details',
    // ── Duplicates modal ──
    'ממצאים כפולים': 'Duplicate Findings',
    'סגור': 'Close',
    'השפעה': 'Impact',
    'טכני': 'Technical',
    'תקנים': 'Standards',
    'הוכחות': 'Evidence',
    'מידע נוסף': 'Additional Info',
    'הערות': 'Notes',
    'מוחרג': 'Excluded',
    'ביטול': 'Cancel',
    '⚠ אשר החרגה': '⚠ Confirm Exclusion',
    '→ הקודם': '→ Previous',
    'הבא ←': 'Next ←',
    '📋 העתק': '📋 Copy',
    '⚠ החרג': '⚠ Exclude',
    '✓ אשר והסתר': '✓ Acknowledge & hide',
    '✓ בטל אישור': '✓ Undo acknowledge',
    '✓ בטל החרגה': '✓ Undo exclusion',
    'החרג — נשאר בדו"ח כחריגה מאושרת': 'Exclude — stays in the report as an accepted exception',
    'אשר — הממצא מוסתר לחלוטין מהדו"ח': 'Acknowledge — the finding is hidden from the report entirely',
    'הצג מאושרים (מוסתרים מהדו"ח) בלבד': 'Show acknowledged (hidden from report) only',
    'הצג מוחרגים (מופיעים בדו"ח) בלבד': 'Show excluded (appear in report) only',
    'האישור בוטל': 'Acknowledgement cancelled',
    'ההחרגה בוטלה': 'Exclusion cancelled',
    'הממצא אושר והוסתר מהדו"ח': 'Finding acknowledged and hidden from the report',
    'הממצא סומן כמוחרג': 'Finding marked as excluded',
    '⚠ מוחרג': '⚠ Excluded',
    'לא הוזנה סיבה.': 'No reason provided.',
    'ממצא זה אינו מוחרג או מאושר.': 'This finding is neither excluded nor acknowledged.',
    'מאושר': 'Acknowledged',
    'מאושר — לא יודפס': 'Acknowledged — not printed',
    'מאושר — מוסתר לחלוטין מהדו"ח': 'Acknowledged — hidden from the report entirely',
    '⏱ פעולה זמנית': '⏱ Temporary action',
    'פעולה זמנית — לדו"ח זה בלבד': 'Temporary action — this report only',
    'ערוך': 'Edit',
    'מחק': 'Delete',
    // ── Export panel ──
    '📤 ייצוא דו"ח': '📤 Export Report',
    '📥 ייבוא ותצורה': '📥 Import & Configuration',
    '☁️ שמירה בשרת': '☁️ Save to Server',
    '📄 ייצא PDF': '📄 Export PDF',
    '👁 תצוגה מקדימה': '👁 Preview',
    '🌐 הורד HTML': '🌐 Download HTML',
    'ייצוא HTML אינטראקטיבי': 'Export Interactive HTML',
    '📊 ייצוא CSV': '📊 Export CSV',
    '💾 הורד תצורה': '💾 Download Config',
    '📂 טען תצורה': '📂 Load Config',
    '📄 ייבוא CSV': '📄 Import CSV',
    '📈 השוואה לקודם': '📈 Compare to Previous',
    '☁️ שמור בשרת': '☁️ Save to Server',
    'כלול פרק "Golden 5"': 'Include "Golden 5" Chapter',
    // ── Wizi panel ──
    '📦 ייבוא מרוכז': '📦 Bulk Import',
    '🔎 שליפה לפי מזהה': '🔎 Fetch by ID',
    '🔍 שאילתה מסוננת': '🔍 Filtered Query',
    '🚫 סינון ממצאים': '🚫 Filter Rules',
    '📦 ייבוא מרוכז לפי Subscription': '📦 Bulk Import by Subscription',
    'ייבוא מרוכז': 'Bulk Import',
    'מייבא נתונים...': 'Importing data...',
    'ייבא נבחרים לדו"ח': 'Import Selected to Report',
    'בחר/בטל הכל': 'Select/Deselect All',
    '🔎 שליפה לפי מזהה ממצא או Rule ID': '🔎 Fetch by Finding ID or Rule ID',
    'סינון לפי Subscription / פרויקט (אופציונלי)': 'Filter by Subscription / Project (optional)',
    'שלוף וייבא': 'Fetch & Import',
    'סוג שאילתה': 'Query Type',
    'פרויקט / Subscription': 'Project / Subscription',
    'פרויקט / Subscription בטקסט חופשי': 'Project / Subscription (free text)',
    'סטטוס': 'Status',
    'כמות': 'Amount',
    'שלוף ממצאים': 'Fetch Findings',
    '📌 טען פריסט...': '📌 Load Preset...',
    '💾 שמור פריסט': '💾 Save Preset',
    '🗑 מחק': '🗑 Delete',
    'שולף נתונים...': 'Fetching data...',
    'טען עוד': 'Load More',
    'כללי סינון פעילים:': 'Active Filter Rules:',
    'ניהול כללי סינון': 'Manage Filter Rules',
    // ── Exceptions panel ──
    'סוג': 'Type',
    'החרגה': 'Exclusion',
    'אישור (מוסתר)': 'Acknowledged (hidden)',
    'לא ניתן להחיל פעולה זמנית על ממצא מאושר. בטל את האישור תחילה.': 'A temporary action cannot be applied to an acknowledged finding. Cancel the acknowledgement first.',
    // Auto-carry-forward toast: phrase (singular / plural) + suffix, composed in wizi.js
    'ממצא אחד': 'One finding',
    '{n} ממצאים': '{n} findings',
    'ממצא אחד נבחר': 'One finding selected',
    '{n} ממצאים נבחרו': '{n} findings selected',
    'ממצא אחד סומן כמוחרג': 'One finding was excluded',
    '{n} ממצאים סומנו כמוחרגים': '{n} findings were excluded',
    'ממצא אחד אושר והוסתר': 'One finding was acknowledged and hidden',
    '{n} ממצאים אושרו והוסתרו': '{n} findings were acknowledged and hidden',
    '{x} ו-{a}': '{x} and {a}',
    '{p} אוטומטית על פי היסטוריה קודמת': '{p} automatically based on previous history',
    'מוצר': 'Product',
    'ממצא': 'Finding',
    'סיבת חריגה': 'Exception Reason',
    'תאריך': 'Date',
    // ── Exclude rules panel ──
    'רשימת סינון ממצאים': 'Finding Filter Rules',
    'כללים לסינון ממצאים בייבוא מכמה (Wiz)': 'Rules for filtering findings in bulk import (Wiz)',
    'מתחיל ב-': 'Starts with',
    'מכיל': 'Contains',
    'ביטוי רגולרי': 'Regular Expression',
    'פעיל': 'Active',
    'הוסף כלל': 'Add Rule',
    'תבנית': 'Pattern',
    'שדה': 'Field',
    'אופרטור': 'Operator',
    'מחיקה': 'Delete',
    // ── Cloud manager ──
    'טוען...': 'Loading...',
    'העלאת תצורה (JSON)': 'Upload Config (JSON)',
    // ── data-i18n-title keys (tooltip titles) ──
    'לוח בקרה': 'Dashboard',          // already in data-i18n above — shared key
    'דו״ח חדש': 'New Report',     // data-i18n-title uses geresh ״ (U+05F4)
    'פרטי דו״ח': 'Report Details',
    'ממצאים': 'Findings',             // already mapped
    'הוסף ממצא': 'Add Finding',       // already mapped
    'קבצים ודוחות': 'Files & Reports',// already mapped
    'קבצי שרת': 'Server Files',       // already mapped
    'מוצרים': 'Products',             // already mapped
    'לוח סריקות': 'Scan Board',       // already mapped
    'רשימת חריגות': 'Exceptions List',// already mapped
    'רשימת סינון ממצאים': 'Finding Filter Rules', // already mapped
    'החלף ערכת נושא': 'Toggle Theme',
    'קיצורי מקלדת (?)': 'Keyboard Shortcuts (?)',
    'כווץ תפריט': 'Collapse Sidebar',
    'ניהול משתמשים': 'User Management',
    'התנתק': 'Logout',
    'בחר תאריך': 'Select Date',
    'היום': 'Today',
    'סיום היום': 'End Today',
    'העתק לקליפבורד': 'Copy to Clipboard',
    'הרחב': 'Expand',
    'צמצם': 'Collapse',
    '⛶ הרחב': '⛶ Expand',
    '✕ צמצם': '✕ Collapse',
    'סמן כמוחרג': 'Mark as Excluded',
    'הרחב הכל': 'Expand All',
    'כווץ הכל': 'Collapse All',
  }
};

/**
 * Returns the current UI language code ('he' or 'en').
 * Reads from localStorage key 'ui-lang'; defaults to 'he'.
 */
export function getLang() {
  return localStorage.getItem('ui-lang') || 'he';
}

/**
 * Sets the UI language, updates the DOM, and persists the choice.
 * @param {string} lang - 'he' or 'en'
 */
export function setLang(lang) {
  const supported = ['he', 'en'];
  if (!supported.includes(lang)) lang = 'he';
  localStorage.setItem('ui-lang', lang);
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');

  // Translate all data-i18n elements (textContent — XSS-safe, no innerHTML)
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    el.textContent = (TRANSLATIONS[lang] && TRANSLATIONS[lang][key] !== undefined)
      ? TRANSLATIONS[lang][key]
      : (TRANSLATIONS.he[key] !== undefined ? TRANSLATIONS.he[key] : key);
  });

  // Translate data-i18n-title tooltip attributes
  document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-title');
    el.title = (TRANSLATIONS[lang] && TRANSLATIONS[lang][key] !== undefined)
      ? TRANSLATIONS[lang][key]
      : (TRANSLATIONS.he[key] !== undefined ? TRANSLATIONS.he[key] : key);
  });

  // Update lang toggle button label
  var toggleBtn = document.getElementById('btn-lang-toggle');
  if (toggleBtn) toggleBtn.textContent = lang === 'he' ? 'EN' : 'HE';
}

/**
 * Translates a single key to the current language.
 * Falls back to the Hebrew key string if no translation exists.
 * @param {string} key
 * @returns {string}
 */
export function t(key) {
  var lang = getLang();
  return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key] !== undefined)
    ? TRANSLATIONS[lang][key]
    : (TRANSLATIONS.he[key] !== undefined ? TRANSLATIONS.he[key] : key);
}
