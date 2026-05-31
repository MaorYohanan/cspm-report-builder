/**
 * Export Handler Module
 * Handles CSV export and report generation
 */

import { escapeHtml, linesToListHtml, makeFindingAnchorId, buildSeverityChartSvg, sanitizeDataUrl, isValidDataUrl, splitLines } from './renderer.js';
import { severityMap } from './ui-components.js';

/**
 * i18n translations for report output
 */
export const i18n = {
  he: {
    dir: 'rtl', lang: 'he',
    toc: 'תוכן עניינים',
    execSummary: '1. תקציר מנהלים',
    riskLabel: 'הערכת סיכון כללית',
    riskScoreLabel: 'ציון סיכון מחושב',
    riskScoreSuffix: '— מבוסס על התפלגות חומרת הממצאים.',
    scopeMethod: '2. תחום הבדיקה ומתודולוגיה',
    scopeTitle: '2.1 תחום בדיקה',
    scopeText: 'הבדיקה בוצעה על גבי חשבונות הענן / מנויים / פרויקטים כפי שסוכם עם הלקוח. נכללו שירותי IaaS / PaaS רלוונטיים, לרבות סביבת Prod ו/או Non-Prod בהתאם להיקף שסוכם.',
    toolsTitle: '2.2 כלי בדיקה',
    toolsText: 'הבדיקה התבססה על כלי CSPM / CNAPP של הארגון, בשילוב בדיקות ידניות והצלבת מידע עם מסמכי מדיניות ותצורה קיימים.',
    methodTitle: '2.3 מתודולוגיית עבודה',
    methodItems: ['איסוף ממצאים מהמערכת (Alerts / Issues / Misconfigurations).','קיבוץ ממצאים לפי חומרה, שירות וסביבה.','וולידציה של ממצאים קריטיים ואיתור False Positive.','גיבוש המלצות לתיקון, הגדרת עדיפויות ותכנית טיפול.'],
    findingsSummary: '3. סיכום ממצאים לפי רמת חומרה',
    findingsSummaryText: 'הטבלה להלן מסכמת את כמות הממצאים שנמצאו לפי רמת חומרה.',
    sevHeader: 'רמת חומרה', countHeader: 'מספר ממצאים', notesHeader: 'הערות',
    critical: 'קריטי', high: 'גבוה', medium: 'בינוני', low: 'נמוך', info: 'מידע',
    critNote: 'חשיפה ישירה, הרשאות יתר, פגיעה חמורה זמינות/סודיות.',
    highNote: 'תצורות לא מאובטחות משמעותית, סיכון מוגבר לדליפה/השבתה.',
    medNote: 'Best Practices לא מיושמים במלואם, פוטנציאל להחמרת סיכון.',
    lowNote: 'שיפורי הקשחה ותפעול שאינם דחופים.',
    infoNote: 'מידע לתכנון עתידי (End of Support, המלצות לשדרוג וכד\').',
    keyTopics: '3.1 נושאי מפתח',
    catBreakdown: '3.2 פילוח לפי קטגוריה',
    catHeader: 'קטגוריה', totalHeader: 'סה"כ',
    detailedFindings: '4. ממצאים עיקריים',
    detailedFindingsText: 'להלן כרטיסי הממצאים שנכללים בדו"ח זה, כפי שנאספו במערכת ואושרו לאחר בדיקה ידנית.',
    noFindings: 'לא נוספו ממצאים.',
    findingDesc: 'תיאור הממצא', findingImpact: 'השפעה עסקית / סיכון',
    findingTech: 'פרטים טכניים', findingPolicies: 'חוקים / מדיניות רלוונטיים',
    findingRecs: 'המלצות', findingPriority: 'עדיפות טיפול',
    findingEvidence: 'הוכחות ממצא',
    evidenceText: 'צילומי מסך / הוכחות טכניות כפי שצורפו בבדיקה. לחץ על תמונה להגדלה.',
    noTech: 'לא סופקו פרטים טכניים.', noPolicies: 'לא סומנו מדיניות / תקנים.',
    noRecs: 'לא סופקו המלצות.', noPriority: 'לא הוגדרה עדיפות טיפול.',
    recommendations: '5. המלצות ותכנית טיפול',
    recsText: 'סעיף זה מרכז את הממצאים בטבלת עבודה, לצורך מעקב אחר סטטוס סגירה ובעלות.',
    colId: 'מזהה ממצא', colDesc: 'תיאור קצר', colSev: 'חומרה', colOwner: 'בעלים', colDue: 'יעד סגירה', colStatus: 'סטטוס',
    ownerPlaceholder: 'Owner / Team', statusOpen: 'פתוח',
    appendix: 'נספח א\' – מיפוי ממצאים למדיניות / תקנים',
    appendixText: 'הנספח ממפה כל ממצא למרכיבים רלוונטיים במדיניות הארגונית ו/או תקנים חיצוניים.',
    colPolicy: 'מדיניות ארגונית / סעיף', colFramework: 'תקן / Framework', colNotes: 'הערות',
    findingIdLabel: 'מזהה ממצא',
    coverSubtitle: 'בדיקת מצב אבטחה, תצורה ועמידה במדיניות בסביבת הענן הארגונית',
    clientLabel: 'שם הלקוח', envLabel: 'סביבת בדיקה / ענן', rangeLabel: 'טווח הבדיקה',
    consultantLabel: 'יועץ / גורם מבצע', dateLabel: 'תאריך דו"ח', versionLabel: 'גרסה',
    reportDateFooter: 'תאריך הדו"ח',
    defaultExecSummary: 'הדו"ח מסכם את מצב ה-POSTURE בסביבת הענן שנבדקה, לרבות ממצאים קריטיים, תרחישי סיכון מרכזיים והערכת סיכון כללית.',
    defaultKeyTopics: 'ניתן להרחיב נושאי מפתח כגון IAM, חשיפה לאינטרנט, הצפנה, רשתות, Kubernetes ועוד.',
    image: 'תמונה', images: 'תמונות',
  },
  en: {
    dir: 'ltr', lang: 'en',
    toc: 'Table of Contents',
    execSummary: '1. Executive Summary',
    riskLabel: 'Overall Risk Assessment',
    riskScoreLabel: 'Calculated Risk Score',
    riskScoreSuffix: '— based on severity distribution of findings.',
    scopeMethod: '2. Scope & Methodology',
    scopeTitle: '2.1 Scope',
    scopeText: 'The assessment was performed on cloud accounts / subscriptions / projects as agreed with the client. Relevant IaaS / PaaS services were included, covering Prod and/or Non-Prod environments per the agreed scope.',
    toolsTitle: '2.2 Assessment Tools',
    toolsText: 'The assessment leveraged the organization\'s CSPM / CNAPP tools, combined with manual checks and cross-referencing with existing policy and configuration documents.',
    methodTitle: '2.3 Methodology',
    methodItems: ['Collect findings from the platform (Alerts / Issues / Misconfigurations).','Group findings by severity, service, and environment.','Validate critical findings and identify False Positives.','Formulate remediation recommendations, set priorities, and build a treatment plan.'],
    findingsSummary: '3. Findings Summary by Severity',
    findingsSummaryText: 'The table below summarizes the number of findings by severity level.',
    sevHeader: 'Severity', countHeader: 'Count', notesHeader: 'Notes',
    critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info',
    critNote: 'Direct exposure, excessive permissions, severe impact on availability/confidentiality.',
    highNote: 'Significantly insecure configurations, increased risk of breach/outage.',
    medNote: 'Best practices not fully implemented, potential for risk escalation.',
    lowNote: 'Hardening and operational improvements, not urgent.',
    infoNote: 'Informational for future planning (End of Support, upgrade recommendations, etc.).',
    keyTopics: '3.1 Key Topics',
    catBreakdown: '3.2 Category Breakdown',
    catHeader: 'Category', totalHeader: 'Total',
    detailedFindings: '4. Detailed Findings',
    detailedFindingsText: 'Below are the finding cards included in this report, as collected and validated.',
    noFindings: 'No findings added.',
    findingDesc: 'Description', findingImpact: 'Business Impact / Risk',
    findingTech: 'Technical Details', findingPolicies: 'Policies / Standards',
    findingRecs: 'Recommendations', findingPriority: 'Remediation Priority',
    findingEvidence: 'Evidence',
    evidenceText: 'Screenshots / technical evidence as attached during the assessment. Click to enlarge.',
    noTech: 'No technical details provided.', noPolicies: 'No policies / standards tagged.',
    noRecs: 'No recommendations provided.', noPriority: 'No remediation priority set.',
    recommendations: '5. Recommendations & Treatment Plan',
    recsText: 'This section consolidates findings into a work table for tracking closure status and ownership.',
    colId: 'Finding ID', colDesc: 'Description', colSev: 'Severity', colOwner: 'Owner', colDue: 'Target Date', colStatus: 'Status',
    ownerPlaceholder: 'Owner / Team', statusOpen: 'Open',
    appendix: 'Appendix A – Findings to Policy Mapping',
    appendixText: 'This appendix maps each finding to relevant organizational policy and/or external standards.',
    colPolicy: 'Organizational Policy', colFramework: 'Standard / Framework', colNotes: 'Notes',
    findingIdLabel: 'Finding ID',
    coverSubtitle: 'Cloud Security Posture Assessment – Configuration, Compliance & Risk Analysis',
    clientLabel: 'Client', envLabel: 'Environment / Cloud', rangeLabel: 'Assessment Period',
    consultantLabel: 'Consultant', dateLabel: 'Report Date', versionLabel: 'Version',
    reportDateFooter: 'Report Date',
    defaultExecSummary: 'This report summarizes the security posture of the assessed cloud environment, including critical findings, key risk scenarios, and an overall risk assessment.',
    defaultKeyTopics: 'Key topics may include IAM, internet exposure, encryption, networking, Kubernetes, and more.',
    image: 'image', images: 'images',
  }
};

/**
 * Category definitions
 */
export const categoryMap = {
  'CSPM': 'Cloud Configuration',
  'KSPM': 'Kubernetes',
  'DSPM': 'Data Security',
  'VULN': 'Vulnerability',
  'NEXP': 'Network Exposure',
  'EAPM': 'Excessive Access',
  'HSPM': 'Host Configuration',
  'SECR': 'Secrets',
  'EOLM': 'End of Life'
};

/**
 * Calculate risk score from findings
 * @param {Array} findings - All findings
 * @returns {Object} {score, percent, label, level}
 */
export function calcRiskScore(findings) {
  var weights = { critical: 10, high: 7, medium: 4, low: 1, info: 0 };
  var total = 0;
  var maxPossible = findings.length * 10;

  findings.forEach(function(f) {
    total += weights[f.severity] || 0;
  });

  if (!findings.length) return { score: 0, percent: 0, label: '—', level: '' };

  var percent = Math.round((total / maxPossible) * 100);
  var label, level;

  if (percent >= 75) { label = 'קריטית'; level = 'critical'; }
  else if (percent >= 50) { label = 'גבוהה'; level = 'high'; }
  else if (percent >= 25) { label = 'בינונית'; level = 'medium'; }
  else { label = 'נמוכה'; level = 'low'; }

  return { score: total, percent: percent, label: label, level: level };
}

/**
 * Count findings by severity
 * @param {Array} findings - All findings
 * @param {string} severity - Severity level
 * @returns {number} Count
 */
export function countSeverity(findings, severity) {
  return findings.filter(f => f.severity === severity).length;
}

/**
 * Parse date in DD/MM/YYYY format
 * @param {string} str - Date string
 * @returns {Date|null}
 */
export function parseReportDate(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.split(/[.\-\/]/).map(Number);
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  if (!day || !month || !year || isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/**
 * Format date as DD/MM/YYYY
 * @param {Date} d - Date object
 * @returns {string}
 */
export function formatDate(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Get days to add based on priority
 * @param {string} priority - Priority text
 * @returns {number|null}
 */
export function getDaysForPriority(priority) {
  switch (priority) {
    case 'מיידי (0–7 ימים)':       return 7;
    case 'גבוהה (עד 30 ימים)':     return 30;
    case 'בינונית (30–60 ימים)':   return 60;
    case 'נמוכה (60–120 ימים)':    return 120;
    case 'למעקב':                  return 180;
    default:                        return null;
  }
}

/**
 * Calculate due date based on report date and priority
 * @param {string} reportDateStr - Report date DD/MM/YYYY
 * @param {string} priority - Priority text
 * @returns {string} Due date DD/MM/YYYY or empty
 */
export function calcDueDate(reportDateStr, priority) {
  const base = parseReportDate(reportDateStr);
  const days = getDaysForPriority(priority);
  if (!base || !days) return '';
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

/**
 * Build HTML report
 * @param {Object} data - Report data
 * @param {Array} data.findings - All findings
 * @param {Object} data.meta - Report metadata
 * @param {string} data.coverImageDataUrl - Cover image data URL
 * @returns {string} Complete HTML report
 */
export function buildReportHtml(data) {
  const { findings, meta, coverImageDataUrl } = data;
  const lang = meta.reportLang || 'he';
  const t = i18n[lang] || i18n.he;

  const critCount = countSeverity(findings, 'critical');
  const highCount = countSeverity(findings, 'high');
  const medCount = countSeverity(findings, 'medium');
  const lowCount = countSeverity(findings, 'low');
  const infoCount = countSeverity(findings, 'info');
  const riskScore = calcRiskScore(findings);

  // Group findings by category
  var findingsByCategory = {};
  findings.forEach(function(f) {
    var cat = f.category || 'CSPM';
    if (!findingsByCategory[cat]) findingsByCategory[cat] = [];
    findingsByCategory[cat].push(f);
  });

  var catKeys = Object.keys(findingsByCategory);

  // Build category-severity matrix
  var catMatrixHtml = '';
  if (catKeys.length > 0) {
    catMatrixHtml = '<table><thead><tr><th>' + t.catHeader + '</th><th>' + t.critical + '</th><th>' + t.high + '</th><th>' + t.medium + '</th><th>' + t.low + '</th><th>' + t.info + '</th><th>' + t.totalHeader + '</th></tr></thead><tbody>';
    catKeys.forEach(function(cat) {
      var items = findingsByCategory[cat];
      var c = items.filter(f => f.severity === 'critical').length;
      var h = items.filter(f => f.severity === 'high').length;
      var m = items.filter(f => f.severity === 'medium').length;
      var l = items.filter(f => f.severity === 'low').length;
      var inf = items.filter(f => f.severity === 'info').length;
      catMatrixHtml += '<tr><td>' + escapeHtml(cat + ' – ' + (categoryMap[cat] || cat)) + '</td><td>' + c + '</td><td>' + h + '</td><td>' + m + '</td><td>' + l + '</td><td>' + inf + '</td><td>' + items.length + '</td></tr>';
    });
    catMatrixHtml += '</tbody></table>';
  }

  // Severity text helper
  function sevText(key) {
    return t[key] || (severityMap[key] || {}).text || key;
  }

  // Build finding cards HTML
  var findingsCardsHtml = '';
  catKeys.forEach(function(cat) {
    var catLabel = categoryMap[cat] || cat;
    var catFindings = findingsByCategory[cat];
    var isFirstInCat = true;

    catFindings.forEach(function(f) {
      var catHeaderHtml = '';
      if (isFirstInCat && catKeys.length > 1) {
        catHeaderHtml = '<h2 style="margin-top:18px;margin-bottom:6px;border-right:3px solid #1d4ed8;padding-right:5px;">' + escapeHtml(cat + ' – ' + catLabel) + '</h2>\n';
        isFirstInCat = false;
      }

      const sev = severityMap[f.severity] || severityMap.medium;
      const anchorId = makeFindingAnchorId(f.id);

      const technicalHtml = f.technical.length
        ? `<ul>${f.technical.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : `<p class="muted">${t.noTech}</p>`;

      const policyHtml = f.policies.length
        ? `<ul class="tag-list">${f.policies.slice(0, 4).map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
        : `<p class="muted">${t.noPolicies}</p>`;

      const recHtml = f.recs.length
        ? `<ul>${f.recs.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
        : `<p class="muted">${t.noRecs}</p>`;

      const priorityHtml = f.priority
        ? `<p><strong>${escapeHtml(f.priority)}</strong></p>`
        : `<p class="muted">${t.noPriority}</p>`;

      var evidenceArr = Array.isArray(f.evidence) ? f.evidence : (f.evidence ? [f.evidence] : []);
      evidenceArr = evidenceArr.filter(ev => isValidDataUrl(ev));

      const evidenceHtml = evidenceArr.length
        ? `
           <div class="finding-section-title">${t.findingEvidence} (${evidenceArr.length} ${evidenceArr.length === 1 ? t.image : t.images})</div>
           <p class="muted">${t.evidenceText}</p>
           ${evidenceArr.map(function(ev, ei) {
             return '<div style="width:800px; max-width:100%; margin-top:8px;"><img src="' + sanitizeDataUrl(ev) + '" alt="Evidence ' + (ei + 1) + '" class="evidence-img" style="width:100%; height:auto; border:1px solid #ccc; border-radius:4px; display:block; cursor:pointer;" onclick="document.getElementById(\'lightbox-overlay\').style.display=\'flex\'; document.getElementById(\'lightbox-img\').src=this.src;"></div>';
           }).join('')}
          `
        : '';

      findingsCardsHtml += `
      <div class="finding-wrap">
      ${catHeaderHtml}
      <div class="finding-card" id="${anchorId}">
        <div class="finding-header">
          <div>
            <div class="finding-title">${escapeHtml(f.title)}</div>
            <div class="finding-id">${t.findingIdLabel}: ${escapeHtml(f.id)}</div>
          </div>
          <div class="severity-badge ${sev.class}">${sevText(f.severity)}</div>
        </div>

        <div class="finding-section-title">${t.findingDesc}</div>
        ${Array.isArray(f.description)
          ? (f.description.length ? '<ul>' + f.description.map(d => '<li>' + escapeHtml(d) + '</li>').join('') + '</ul>' : '<p></p>')
          : '<p>' + escapeHtml(f.description) + '</p>'}

        <div class="finding-section-title">${t.findingImpact}</div>
        ${Array.isArray(f.impact)
          ? (f.impact.length ? '<ul>' + f.impact.map(d => '<li>' + escapeHtml(d) + '</li>').join('') + '</ul>' : '<p></p>')
          : '<p>' + escapeHtml(f.impact) + '</p>'}

        <div class="two-column">
          <div>
            <div class="finding-section-title">${t.findingTech}</div>
            ${technicalHtml}
          </div>
          <div>
            <div class="finding-section-title">${t.findingPolicies}</div>
            ${policyHtml}
          </div>
        </div>

        <div class="finding-section-title">${t.findingRecs}</div>
        ${recHtml}

        <div class="finding-section-title">${t.findingPriority}</div>
        ${priorityHtml}
        ${evidenceHtml}
      </div>
      </div>`;
    });
  });

  // Build treatment table
  const treatmentTableHtml = findings.map(f => {
    const sev = severityMap[f.severity] || severityMap.medium;
    const anchorId = makeFindingAnchorId(f.id);
    let dueDate = calcDueDate(meta.reportDate, f.priority);
    if (!dueDate) dueDate = 'DD/MM/YYYY';

    const linkOpen = `<a href="#${anchorId}">`;
    const linkClose = `</a>`;

    return (
      '<tr>' +
        '<td>' + linkOpen + escapeHtml(f.id) + linkClose + '</td>' +
        '<td>' + linkOpen + escapeHtml(f.title) + linkClose + '</td>' +
        '<td>' + sevText(f.severity) + '</td>' +
        '<td>' + (escapeHtml(f.owner) || t.ownerPlaceholder) + '</td>' +
        '<td>' + dueDate + '</td>' +
        '<td>' + t.statusOpen + '</td>' +
      '</tr>'
    );
  }).join('\n');

  // Build appendix table
  const appendixHtml = findings.map(f => {
    const firstPolicy = f.policies[0] || '';
    return `
      <tr>
        <td>${escapeHtml(f.id)}</td>
        <td>${firstPolicy ? escapeHtml(firstPolicy) : '—'}</td>
        <td>${firstPolicy ? 'ISO / NIST' : '—'}</td>
        <td></td>
      </tr>`;
  }).join('\n');

  const execSummaryHtml = meta.execSummary
    ? `<p>${escapeHtml(meta.execSummary)}</p>`
    : `<p>${t.defaultExecSummary}</p>`;

  const keyTopicsHtml = linesToListHtml(meta.keyTopics) || `<p class="muted">${t.defaultKeyTopics}</p>`;

  // Complete HTML with embedded CSS
  const html = `<!DOCTYPE html>
<html lang="${t.lang}" dir="${t.dir}">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(meta.teamName)}</title>
  <style>
    /* Complete CSS from original - preserving all styles */
    * { box-sizing: border-box; }
    @page { size: A4; margin: 0 0 20mm 0; }
    body { margin: 0; padding-top: 30mm; padding-bottom: 22mm; font-family: Arial, "Segoe UI", Tahoma, sans-serif; background: #e5edf7; color: #222; }
    .print-header { position: fixed; top: 0; left: 0; right: 0; height: 22mm; display: flex; align-items: center; justify-content: space-between; padding: 4mm 20mm; background: linear-gradient(to left, #0b3c5d, #15559b); color: #f9fafb; font-size: 11px; z-index: 1000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .print-footer { position: fixed; bottom: 0; left: 0; right: 0; height: 15mm; display: flex; align-items: center; justify-content: space-between; padding: 3mm 20mm; border-top: 1px solid #cbd5e1; background: #f8fafc; color: #64748b; font-size: 11px; z-index: 1000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page-title-main { font-weight: bold; font-size: 14px; letter-spacing: 0.5px; }
    .page-logo { font-size: 11px; opacity: 0.9; }
    .report-content { margin-top: 0; margin-bottom: 0; padding: 0 15mm; }
    .page-section { page-break-after: always; background: #ffffff; margin: 0 auto 10mm auto; padding: 14mm 10mm 12mm 10mm; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.18); border-radius: 6px; border-top: 5px solid #0b3c5d; }
    .page-section:last-child { page-break-after: auto; margin-bottom: 0; }
    h1, h2, h3, h4 { margin-top: 8px; margin-bottom: 8px; color: #0b3c5d; }
    h1 { font-size: 26px; border-right: 4px solid #15559b; padding-right: 6px; margin-bottom: 10px; padding-top: 4px; }
    h2 { font-size: 19px; margin-top: 18px; border-right: 3px solid #1d4ed8; padding-right: 5px; }
    h3 { font-size: 15px; margin-top: 12px; color: #1e293b; }
    p { font-size: 13px; line-height: 1.6; margin: 4px 0; color: #111827; }
    ul, ol { font-size: 13px; line-height: 1.6; margin: 4px 0 4px 20px; color: #111827; }
    .muted { color: #6b7280; font-size: 12px; }
    .section-divider { border-top: 1px dashed #cbd5e1; margin: 15px 0; }
    .cover-page-inner { display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; min-height: 220mm; }
    .cover-image { width: 100%; margin-bottom: 24px; }
    .cover-image img { display: block; margin: 0 auto; }
    .cover-main-title { font-size: 30px; font-weight: bold; margin-bottom: 10px; color: #0b3c5d; }
    .cover-subtitle { font-size: 16px; margin-bottom: 20px; color: #1f2937; }
    .cover-meta { margin-top: 25px; font-size: 14px; background: #eff6ff; border-radius: 6px; padding: 10px 12px; border: 1px solid #bfdbfe; }
    .cover-meta p { margin: 4px 0; }
    .cover-badge { margin-top: 40px; padding: 10px 15px; border-radius: 6px; font-size: 12px; background: #0b3c5d; color: #f9fafb; box-shadow: 0 2px 6px rgba(15, 23, 42, 0.35); }
    .toc-list { list-style: none; padding: 0; margin: 8px 0 0 0; font-size: 13px; }
    .toc-list a { color: #0b3c5d; text-decoration: none; }
    .toc-list a:hover { text-decoration: underline; }
    h1[id], h2[id], h3[id] { scroll-margin-top: 40mm; }
    .toc-item { display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0; }
    .toc-item span { display: inline-block; }
    .toc-finding { padding-right: 20px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
    th, td { padding: 6px 8px; vertical-align: top; border: 1px solid #d1d5db; }
    th { background: linear-gradient(to left, #0b3c5d, #15559b); color: #f9fafb; font-weight: bold; }
    tbody tr:nth-child(odd) { background: #f9fbff; }
    tbody tr:nth-child(even) { background: #ffffff; }
    .finding-wrap { margin-top: 8px; }
    .finding-wrap:first-child { margin-top: 0; }
    .finding-card { border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; font-size: 12px; background: #f9fafb; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); overflow: hidden; }
    .finding-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    .finding-title { font-weight: bold; font-size: 13px; color: #0b3c5d; }
    .finding-id { font-size: 11px; color: #6b7280; }
    .severity-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; color: #fff; font-weight: bold; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.35); }
    .sev-critical { background: #b91c1c; }
    .sev-high { background: #ef4444; }
    .sev-medium { background: #f97316; }
    .sev-low { background: #22c55e; }
    .sev-info { background: #6b7280; }
    .finding-section-title { font-weight: bold; margin-top: 6px; margin-bottom: 2px; color: #111827; }
    .tag-list { margin: 0; padding: 0; list-style: none; font-size: 11px; }
    .tag-list li { display: inline-block; margin-left: 5px; margin-bottom: 3px; padding: 1px 6px; border-radius: 999px; border: 1px solid #cbd5e1; background: #eff6ff; color: #1e3a8a; word-break: break-word; max-width: 100%; }
    .two-column { display: flex; gap: 10px; margin-top: 4px; }
    .two-column > div { flex: 1; min-width: 0; background: #ffffff; border-radius: 4px; border: 1px solid #e5e7eb; padding: 6px; overflow: hidden; word-wrap: break-word; overflow-wrap: break-word; }
    img { max-width: 100%; height: auto; }
    @media print {
      body { background: #ffffff; margin: 0; padding: 0; }
      .print-header { position: static !important; height: auto; padding: 4mm 20mm 2mm; z-index: 0; }
      .print-footer { position: fixed !important; bottom: 0; left: 0; right: 0; height: 15mm; padding: 3mm 20mm; border-top: 1px solid #cbd5e1; background: #f8fafc; z-index: 10; }
      .report-content { margin-top: 0; margin-bottom: 0; padding: 0 15mm 0 15mm; }
      .page-section { box-shadow: none; margin: 0 auto 10mm auto; border-radius: 0; page-break-after: always; }
      .page-section:last-child { page-break-after: auto; }
      h1, h2, h3, h4 { margin-top: 8px; }
      .finding-wrap { break-inside: auto; page-break-inside: auto; margin-top: 10px; }
      .finding-wrap:first-child { padding-top: 0; }
      .finding-card { page-break-inside: auto; break-inside: auto; margin: 0 0 10px 0; overflow: visible; }
      .finding-header { break-inside: avoid; page-break-inside: avoid; break-after: avoid; page-break-after: avoid; }
      .finding-section-title { break-after: avoid; page-break-after: avoid; }
      .finding-card li { break-inside: avoid; page-break-inside: avoid; }
    }
  </style>
</head>
<body>

  <div class="print-header">
    <div class="page-title-main">${escapeHtml(meta.teamName)}</div>
    ${meta.orgName ? '<div class="page-logo">' + escapeHtml(meta.orgName) + '</div>' : ''}
  </div>

  <div class="print-footer">
    ${meta.footerText ? '<div>' + escapeHtml(meta.footerText) + '</div>' : '<div></div>'}
    <div>${t.reportDateFooter}: ${escapeHtml(meta.reportDate || 'DD/MM/YYYY')}</div>
  </div>

  <main class="report-content">

    <section class="page-section cover">
      <div class="cover-page-inner">
        <div class="cover-main-title">${escapeHtml(meta.teamName)}</div>
        <div class="cover-subtitle">${t.coverSubtitle}</div>
        ${coverImageDataUrl ? '<div class="cover-image"><img src="' + coverImageDataUrl + '" alt="CSPM Report Cover" style="width:100%;max-height:280px;object-fit:contain;border-radius:8px;"></div>' : ''}

        <div class="cover-meta">
          <p><strong>${t.clientLabel}:</strong> ${escapeHtml(meta.client || '__________')}</p>
          <p><strong>${t.envLabel}:</strong> ${escapeHtml(meta.env || '__________')}</p>
          <p><strong>${t.rangeLabel}:</strong> ${escapeHtml(meta.range || '__________')}</p>
          <p><strong>${t.consultantLabel}:</strong> ${escapeHtml(meta.consultant || '__________')}</p>
          <p><strong>${t.dateLabel}:</strong> ${escapeHtml(meta.reportDate || '__________')}</p>
          <p><strong>${t.versionLabel}:</strong> ${escapeHtml(meta.reportVersion || '1.0')}</p>
        </div>

        <div class="cover-badge">
          ${escapeHtml(meta.coverNote || '')}
        </div>
      </div>
    </section>

    <section class="page-section">
      <h1>${t.toc}</h1>
      <ul class="toc-list">
        <li class="toc-item"><span><a href="#exec-summary">${t.execSummary}</a></span></li>
        <li class="toc-item"><span><a href="#scope-method">${t.scopeMethod}</a></span></li>
        <li class="toc-item"><span><a href="#findings-summary">${t.findingsSummary}</a></span></li>
        <li class="toc-item"><span><a href="#detailed-findings">${t.detailedFindings}</a></span></li>
        ${findings.map(function(f) {
          var sev = severityMap[f.severity] || severityMap.medium;
          return '<li class="toc-item toc-finding"><span><a href="#' + makeFindingAnchorId(f.id) + '">' + escapeHtml(f.id) + ' – ' + escapeHtml(f.title) + '</a></span><span class="severity-badge ' + sev.class + '" style="font-size:9px;padding:1px 6px;">' + sevText(f.severity) + '</span></li>';
        }).join('\n')}
        <li class="toc-item"><span><a href="#recommendations">${t.recommendations}</a></span></li>
        <li class="toc-item"><span><a href="#appendix-a">${t.appendix}</a></span></li>
      </ul>
    </section>

    <section class="page-section">
      <h1 id="exec-summary">${t.execSummary}</h1>
      ${execSummaryHtml}
      <p><strong>${t.riskLabel}:</strong> ${escapeHtml(meta.reportRisk || (t[riskScore.level] || riskScore.label))}.</p>
      ${findings.length ? '<p><strong>' + t.riskScoreLabel + ':</strong> ' + riskScore.percent + '% (' + (t[riskScore.level] || riskScore.label) + ') ' + t.riskScoreSuffix + '</p>' : ''}

      <div class="section-divider"></div>

      <h2 id="scope-method">${t.scopeMethod}</h2>
      <h3>${t.scopeTitle}</h3>
      <p>${t.scopeText}</p>

      <h3>${t.toolsTitle}</h3>
      <p>${t.toolsText}</p>

      <h3>${t.methodTitle}</h3>
      <ul>
        ${t.methodItems.map(item => '<li>' + item + '</li>').join('\n        ')}
      </ul>
    </section>

    <section class="page-section">
      <h1 id="findings-summary">${t.findingsSummary}</h1>
      <p>${t.findingsSummaryText}</p>

      ${buildSeverityChartSvg(
        { critical: critCount, high: highCount, medium: medCount, low: lowCount, info: infoCount },
        { critical: t.critical, high: t.high, medium: t.medium, low: t.low, info: t.info }
      )}

      <table>
        <thead>
          <tr>
            <th>${t.sevHeader}</th>
            <th>${t.countHeader}</th>
            <th>${t.notesHeader}</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>${t.critical}</td><td>${critCount}</td><td>${t.critNote}</td></tr>
          <tr><td>${t.high}</td><td>${highCount}</td><td>${t.highNote}</td></tr>
          <tr><td>${t.medium}</td><td>${medCount}</td><td>${t.medNote}</td></tr>
          <tr><td>${t.low}</td><td>${lowCount}</td><td>${t.lowNote}</td></tr>
          <tr><td>${t.info}</td><td>${infoCount}</td><td>${t.infoNote}</td></tr>
        </tbody>
      </table>

      <h2>${t.keyTopics}</h2>
      ${keyTopicsHtml}

      ${catKeys.length > 1 ? '<h2>' + t.catBreakdown + '</h2>' + catMatrixHtml : ''}
    </section>

    <section class="page-section">
      <h1 id="detailed-findings">${t.detailedFindings}</h1>
      <p>${t.detailedFindingsText}</p>
      ${findingsCardsHtml || '<p class="muted">' + t.noFindings + '</p>'}
    </section>

    <section class="page-section">
      <h1 id="recommendations">${t.recommendations}</h1>
      <p>${t.recsText}</p>
      <table>
        <thead>
          <tr>
            <th>${t.colId}</th>
            <th>${t.colDesc}</th>
            <th>${t.colSev}</th>
            <th>${t.colOwner}</th>
            <th>${t.colDue}</th>
            <th>${t.colStatus}</th>
          </tr>
        </thead>
        <tbody>
          ${treatmentTableHtml || '<tr><td colspan="6">' + t.noFindings + '</td></tr>'}
        </tbody>
      </table>
    </section>

    <section class="page-section">
      <h1 id="appendix-a">${t.appendix}</h1>
      <p>${t.appendixText}</p>
      <table>
        <thead>
          <tr>
            <th>${t.colId}</th>
            <th>${t.colPolicy}</th>
            <th>${t.colFramework}</th>
            <th>${t.colNotes}</th>
          </tr>
        </thead>
        <tbody>
          ${appendixHtml || '<tr><td colspan="4">' + t.noFindings + '</td></tr>'}
        </tbody>
      </table>
    </section>

  </main>

  <div id="lightbox-overlay" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:9999; justify-content:center; align-items:center; cursor:pointer;" onclick="this.style.display='none';">
    <img id="lightbox-img" src="" alt="תמונה מוגדלת" style="max-width:95vw; max-height:95vh; border-radius:6px; box-shadow:0 0 30px rgba(0,0,0,0.5);">
  </div>

</body>
</html>`;

  return html;
}

/**
 * Build filename from metadata
 * @param {Object} meta - Report metadata
 * @param {string} ext - File extension
 * @returns {string} Filename
 */
export function buildFilename(meta, ext) {
  var client = (meta.client || '').trim().replace(/[^\w֐-׿\s-]/g, '').replace(/\s+/g, '_');
  var date = (meta.reportDate || '').replace(/\//g, '-');
  var parts = ['cspm_report'];
  if (client) parts.push(client);
  if (date) parts.push(date);
  return parts.join('_') + '.' + ext;
}
