    (function() {
      const findings = [];
      let editingIndex = null;

      const severityMap = {
        critical: { text: 'קריטי', class: 'sev-critical' },
        high:     { text: 'גבוה',  class: 'sev-high' },
        medium:   { text: 'בינוני',class: 'sev-medium' },
        low:      { text: 'נמוך',  class: 'sev-low' },
        info:     { text: 'מידע',  class: 'sev-info' }
      };

      const addBtn        = document.getElementById('btn-add-finding');
      const cancelEditBtn = document.getElementById('btn-cancel-edit');
      const genBtn        = document.getElementById('btn-generate');
      const dlBtn         = document.getElementById('btn-download');
      const tableWrapper  = document.getElementById('findings-table-wrapper');
      const statusMsg     = document.getElementById('status-msg');
      const editState     = document.getElementById('edit-state');

      const prioritySelect = document.getElementById('f-priority-select');
      const priorityCustom = document.getElementById('f-priority-custom');
      const evidenceInput  = document.getElementById('f-evidence');

      const exportJsonBtn   = document.getElementById('btn-export-json');
      const importJsonBtn   = document.getElementById('btn-import-json');
      const importJsonInput = document.getElementById('input-import-json');

      // ── Tab navigation ──
      function switchToTab(tabId) {
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
          btn.classList.remove('active');
          btn.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.tab-panel').forEach(function(panel) {
          panel.classList.remove('active');
        });
        var tab = document.getElementById(tabId);
        if (tab) {
          tab.classList.add('active');
          tab.setAttribute('aria-selected', 'true');
          var panelId = tab.getAttribute('aria-controls');
          var panel = document.getElementById(panelId);
          if (panel) panel.classList.add('active');
        }
        try { localStorage.setItem('cspm_active_tab', tabId); } catch(e) {}
      }

      // Restore last active tab
      (function() {
        var saved = localStorage.getItem('cspm_active_tab');
        if (saved && document.getElementById(saved)) {
          switchToTab(saved);
        }
      })();

      document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          switchToTab(btn.id);
        });
        // Arrow key navigation between tabs
        btn.addEventListener('keydown', function(e) {
          var tabs = Array.from(document.querySelectorAll('.tab-btn'));
          var idx = tabs.indexOf(btn);
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            // RTL: ArrowRight = previous, ArrowLeft = next
            var dir = e.key === 'ArrowLeft' ? 1 : -1;
            var next = tabs[(idx + dir + tabs.length) % tabs.length];
            next.focus();
            switchToTab(next.id);
          }
        });
      });

      // ממיר מחרוזת תאריך בפורמט DD/MM/YYYY לאובייקט Date
      function parseReportDate(str) {
        if (!str) return null;
        const parts = str.split(/[.\-\/]/).map(Number);
        if (parts.length !== 3) return null;
        const [day, month, year] = parts;
        if (!day || !month || !year) return null;
        const d = new Date(year, month - 1, day);
        // בדיקת sanity בסיסית
        if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
          return null;
        }
        return d;
      }

      // פורמט חזרה ל-DD/MM/YYYY
      function formatDate(d) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      }

      // כמה ימים להוסיף לפי עדיפות הטיפול
      function getDaysForPriority(priority) {
        switch (priority) {
          case 'מיידי (0–7 ימים)':       return 7;
          case 'גבוהה (עד 30 ימים)':     return 30;
          case 'בינונית (30–60 ימים)':   return 60;
          case 'נמוכה (60–120 ימים)':    return 120;
          case 'למעקב':                  return 180;  // או 0 אם אתה לא רוצה יעד
          default:                        return null; // custom / לא צוין
        }
      }

      // מחזיר תאריך יעד סגירה לפי תאריך דו"ח + עדיפות
      function calcDueDate(reportDateStr, priority) {
        const base = parseReportDate(reportDateStr);
        const days = getDaysForPriority(priority);
        if (!base || !days) return '';
        const d = new Date(base.getTime());
        d.setDate(d.getDate() + days);
        return formatDate(d);
      }

      // מייצר מזהה עוגן בטוח ל-HTML עבור ממצא
      function makeFindingAnchorId(id) {
        const safe = (id || '')
          .toString()
          .trim()
          .replace(/\s+/g, '-')      // רווחים -> מקף
          .replace(/[^\w\-]+/g, ''); // להסיר תווים לא חוקיים לאנקור
        return 'finding-' + (safe || 'no-id');
      }

      function splitLines(value) {
        const s = (value || '').toString()
          .replace(/\\n/g, '\n')     // הופך "\n" מילולי לשבירת שורה
          .replace(/\r\n/g, '\n');  // Windows newlines
        return s.split('\n').map(l => l.trim()).filter(Boolean);
      }

      // --- Category definitions ---
      var categoryMap = {
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

      // --- Finding templates ---
      var findingTemplates = [
        { category: 'CSPM', title: 'S3 Bucket ציבורי עם נתונים רגישים', severity: 'critical', description: 'זוהה S3 Bucket עם הרשאות גישה ציבוריות המכיל נתונים רגישים.', impact: 'חשיפת נתונים רגישים לגורמים לא מורשים, סיכון לדליפת מידע ופגיעה רגולטורית.', recs: 'לבטל גישה ציבורית ל-Bucket\nלהפעיל הצפנה Server-Side (SSE-S3/SSE-KMS)\nלהגדיר Bucket Policy מגביל\nלהפעיל S3 Block Public Access' },
        { category: 'CSPM', title: 'Security Group פתוח לכל העולם (0.0.0.0/0)', severity: 'high', description: 'זוהה Security Group המאפשר תעבורה נכנסת מכל כתובת IP.', impact: 'חשיפת שירותים פנימיים לתקיפות מהאינטרנט, סיכון לגישה לא מורשית.', recs: 'להגביל את ה-Security Group לטווחי IP ספציפיים\nלהסיר כללי Inbound עם 0.0.0.0/0\nלהשתמש ב-VPN או Bastion Host לגישה מרחוק' },
        { category: 'CSPM', title: 'MFA לא מופעל למשתמשי Root/Admin', severity: 'critical', description: 'חשבונות Root או Admin ללא אימות דו-שלבי (MFA).', impact: 'סיכון גבוה לגניבת חשבון ניהולי, גישה מלאה לכל משאבי הענן.', recs: 'להפעיל MFA לכל חשבונות Root ו-Admin\nלהשתמש ב-Hardware MFA Token לחשבון Root\nלהגדיר מדיניות ארגונית המחייבת MFA' },
        { category: 'CSPM', title: 'הצפנה לא מופעלת על אחסון (EBS/Disk)', severity: 'medium', description: 'זוהו דיסקים (EBS Volumes / Managed Disks) ללא הצפנה.', impact: 'נתונים בדיסק חשופים במקרה של גישה פיזית או גניבת Snapshot.', recs: 'להפעיל הצפנת ברירת מחדל לכל הדיסקים החדשים\nלהצפין דיסקים קיימים באמצעות Snapshot + Copy with encryption\nלהשתמש ב-KMS Keys מנוהלים' },
        { category: 'CSPM', title: 'IAM Policy עם הרשאות Admin מלאות (*:*)', severity: 'high', description: 'זוהתה מדיניות IAM המעניקה הרשאות מלאות (AdministratorAccess או *:*).', impact: 'הרשאות יתר מאפשרות גישה בלתי מוגבלת לכל המשאבים, עקרון Least Privilege מופר.', recs: 'להחליף ב-IAM Policies ממוקדות לפי תפקיד\nליישם עקרון Least Privilege\nלבצע IAM Access Analyzer לזיהוי הרשאות לא בשימוש' },
        { category: 'CSPM', title: 'CloudTrail / Audit Logging לא מופעל', severity: 'high', description: 'שירות רישום פעולות (CloudTrail / Activity Log) לא מופעל או מוגדר חלקית.', impact: 'חוסר יכולת לזהות פעילות חשודה, קושי בחקירת אירועים ועמידה ברגולציה.', recs: 'להפעיל CloudTrail / Audit Logging בכל האזורים\nלהגדיר שמירה ב-S3 Bucket מוצפן עם Lifecycle Policy\nלהפעיל Log File Validation' },
        { category: 'KSPM', title: 'Pod רץ עם הרשאות Root', severity: 'high', description: 'זוהו Pods הרצים עם SecurityContext של root (runAsUser: 0).', impact: 'פריצה ל-Pod עם הרשאות root מאפשרת Container Escape ופגיעה ב-Node.', recs: 'להגדיר runAsNonRoot: true ב-SecurityContext\nלהשתמש ב-PodSecurityPolicy / PodSecurityStandards\nלהגביל capabilities עם drop: ALL' },
        { category: 'NEXP', title: 'Database חשוף לאינטרנט', severity: 'critical', description: 'שירות Database (RDS/SQL/CosmosDB) נגיש ישירות מהאינטרנט.', impact: 'חשיפה ישירה של בסיס הנתונים לתקיפות Brute Force, SQL Injection ודליפת מידע.', recs: 'להעביר את ה-Database ל-Private Subnet\nלבטל Public Accessibility\nלהגדיר גישה דרך VPN או Private Endpoint בלבד' },
        { category: 'VULN', title: 'ספריות עם פגיעויות ידועות (CVE)', severity: 'high', description: 'זוהו ספריות / חבילות תוכנה עם פגיעויות ידועות ברמת חומרה גבוהה.', impact: 'ניצול פגיעויות ידועות עלול לאפשר הרצת קוד מרחוק, דליפת מידע או השבתת שירות.', recs: 'לעדכן את הספריות לגרסאות מתוקנות\nלהפעיל סריקת פגיעויות אוטומטית ב-CI/CD\nלהגדיר מדיניות חסימה לפגיעויות Critical/High' },
        { category: 'DSPM', title: 'נתונים רגישים ללא סיווג או הגנה', severity: 'medium', description: 'זוהו מאגרי נתונים המכילים מידע רגיש (PII/PHI/PCI) ללא סיווג או בקרות הגנה מתאימות.', impact: 'חוסר סיווג מקשה על אכיפת מדיניות הגנת מידע ועמידה ברגולציה.', recs: 'לבצע סריקת Data Discovery וסיווג אוטומטי\nלהגדיר תגיות סיווג (Classification Tags)\nליישם בקרות גישה מבוססות סיווג' },
      ];

      // Populate template dropdown
      var templateSelect = document.getElementById('f-template');
      findingTemplates.forEach(function(t, idx) {
        var opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = '[' + t.category + '] ' + t.title;
        templateSelect.appendChild(opt);
      });

      templateSelect.addEventListener('change', function() {
        if (this.value === '') return;
        var t = findingTemplates[parseInt(this.value)];
        if (!t) return;
        document.getElementById('f-category').value = t.category;
        prefillId();
        document.getElementById('f-title').value = t.title;
        document.getElementById('f-severity').value = t.severity;
        document.getElementById('f-description').value = t.description || '';
        document.getElementById('f-impact').value = t.impact || '';
        document.getElementById('f-recs').value = t.recs || '';
        this.value = '';
        document.getElementById('f-title').focus();
      });

      // --- Auto-generate finding ID per category ---
      function generateNextId(prefix) {
        prefix = prefix || 'CSPM';
        var max = 0;
        findings.forEach(function(f) {
          var m = (f.id || '').match(new RegExp('^' + prefix + '-(\\d+)'));
          if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        return prefix + '-' + String(max + 1).padStart(3, '0');
      }

      function prefillId() {
        var idField = document.getElementById('f-id');
        if (editingIndex === null) {
          var cat = document.getElementById('f-category').value;
          idField.value = generateNextId(cat);
          idField.readOnly = true;
        }
      }

      // Update ID when category changes
      document.getElementById('f-category').addEventListener('change', function() {
        if (editingIndex === null) {
          prefillId();
        }
      });

      // Allow clicking the ID field to make it editable
      document.getElementById('f-id').addEventListener('click', function() {
        this.readOnly = false;
        this.select();
      });

      // --- Date field: convert date input (YYYY-MM-DD) to DD/MM/YYYY for display ---
      const dateInput = document.getElementById('report-date');

      function getDateAsDDMMYYYY() {
        const val = dateInput.value; // YYYY-MM-DD from native picker
        if (!val) return '';
        const [y, m, d] = val.split('-');
        return d + '/' + m + '/' + y;
      }

      function setDateFromDDMMYYYY(str) {
        if (!str) { dateInput.value = ''; return; }
        const parts = str.split(/[.\-\/]/);
        if (parts.length !== 3) { dateInput.value = ''; return; }
        const [d, m, y] = parts;
        dateInput.value = y + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0');
      }

      // --- Priority custom field toggle ---
      const priorityCustomWrapper = document.getElementById('priority-custom-wrapper');

      function updatePriorityCustomVisibility() {
        if (prioritySelect.value === 'custom') {
          priorityCustomWrapper.classList.remove('hidden');
          priorityCustomWrapper.classList.add('visible');
          priorityCustom.focus();
        } else {
          priorityCustomWrapper.classList.remove('visible');
          priorityCustomWrapper.classList.add('hidden');
          priorityCustom.value = '';
        }
      }

      prioritySelect.addEventListener('change', updatePriorityCustomVisibility);
      updatePriorityCustomVisibility();

      // --- Ctrl+Enter shortcut ---
      document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          const active = document.activeElement;
          const findingForm = document.getElementById('panel-finding-form');
          if (findingForm && findingForm.contains(active)) {
            e.preventDefault();
            handleAddOrUpdateFinding();
          }
        }
      });

      // --- Keyboard navigation for findings table (J/K/E/D) ---
      var kbSelectedIdx = -1;

      function highlightFindingRow(idx) {
        var rows = tableWrapper.querySelectorAll('tbody tr');
        rows.forEach(function(r, i) {
          r.style.outline = i === idx ? '2px solid var(--accent)' : '';
          r.style.outlineOffset = i === idx ? '-2px' : '';
        });
        if (rows[idx]) rows[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }

      document.addEventListener('keydown', function(e) {
        // Only when not focused on an input/textarea/select
        var tag = (document.activeElement || {}).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (!findings.length) return;

        if (e.key === 'j' || e.key === 'J') {
          e.preventDefault();
          kbSelectedIdx = Math.min(kbSelectedIdx + 1, findings.length - 1);
          highlightFindingRow(kbSelectedIdx);
        } else if (e.key === 'k' || e.key === 'K') {
          e.preventDefault();
          kbSelectedIdx = Math.max(kbSelectedIdx - 1, 0);
          highlightFindingRow(kbSelectedIdx);
        } else if ((e.key === 'e' || e.key === 'E') && kbSelectedIdx >= 0) {
          e.preventDefault();
          startEditFinding(kbSelectedIdx);
        } else if ((e.key === 'd' || e.key === 'D') && kbSelectedIdx >= 0) {
          e.preventDefault();
          if (confirm('למחוק ממצא ' + (findings[kbSelectedIdx].id || '') + '?')) {
            findings.splice(kbSelectedIdx, 1);
            if (kbSelectedIdx >= findings.length) kbSelectedIdx = findings.length - 1;
            renderFindingsTable();
            highlightFindingRow(kbSelectedIdx);
          }
        }
      });

      // בניית Snapshot של כל הדו"ח (meta + findings)
      function buildSnapshot() {
        const snapshot = {
          version: 1,
          meta: {
            client:      document.getElementById('report-client').value,
            env:         document.getElementById('report-env').value,
            range:       document.getElementById('report-range').value,
            consultant:  document.getElementById('report-consultant').value,
            reportDate:  getDateAsDDMMYYYY(),
            reportRisk:  document.getElementById('report-risk').value,
            execSummary: document.getElementById('report-exec-summary').value,
            keyTopics:   document.getElementById('report-key-topics').value,
            teamName:    document.getElementById('report-team-name').value,
            orgName:     document.getElementById('report-org-name').value,
            footerText:  document.getElementById('report-footer-text').value,
            coverNote:   document.getElementById('report-cover-note').value,
            coverImage:  (coverImageDataUrl !== defaultCoverImageDataUrl) ? coverImageDataUrl : null,
            reportVersion: document.getElementById('report-version').value,
            reportLang: document.getElementById('report-lang').value
          },
          findings: findings  // JSON.stringify יעשה deep copy
        };
        return snapshot;
      }

      // טעינת Snapshot לדו"ח
      function applySnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') {
          alert('קובץ JSON לא תקין.');
          return;
        }
        if (!snapshot.meta || !Array.isArray(snapshot.findings)) {
          alert('קובץ JSON לא תואם לפורמט המחולל.');
          return;
        }

        const m = snapshot.meta;

        document.getElementById('report-client').value      = m.client      || '';
        document.getElementById('report-env').value         = m.env         || '';
        document.getElementById('report-range').value       = m.range       || '';
        document.getElementById('report-consultant').value  = m.consultant  || '';
        setDateFromDDMMYYYY(m.reportDate || '');
        document.getElementById('report-risk').value        = m.reportRisk  || '';
        document.getElementById('report-exec-summary').value= m.execSummary || '';
        document.getElementById('report-key-topics').value  = m.keyTopics   || '';
        document.getElementById('report-team-name').value   = m.teamName    || '';
        document.getElementById('report-org-name').value    = m.orgName     || '';
        document.getElementById('report-footer-text').value = m.footerText  || '';
        document.getElementById('report-cover-note').value  = m.coverNote   || '';
        document.getElementById('report-version').value    = m.reportVersion || '1.0';
        document.getElementById('report-lang').value       = m.reportLang || 'he';

        // Restore custom cover image if present
        if (m.coverImage) {
          showCoverPreview(m.coverImage);
        } else {
          coverImageDataUrl = defaultCoverImageDataUrl;
          coverImagePreview.innerHTML = '';
          coverImageInput.value = '';
        }

        // ניקוי רשימת הממצאים והזנתם מחדש
        findings.length = 0;

        snapshot.findings.forEach(f => {
          findings.push({
            id:          f.id          || '',
            title:       f.title       || '',
            severity:    f.severity    || 'medium',
            category:    f.category    || 'CSPM',
            description: f.description || '',
            impact:      f.impact      || '',
            technical: Array.isArray(f.technical)
              ? f.technical
              : splitLines(f.technical || ''),
            policies: Array.isArray(f.policies)
              ? f.policies
              : splitLines(f.policies || ''),
            recs: Array.isArray(f.recs)
              ? f.recs
              : splitLines(f.recs || ''),
            priority: f.priority || '',
            evidence: Array.isArray(f.evidence) ? f.evidence : (f.evidence ? [f.evidence] : [])
          });
        });

        resetEditState();
        renderFindingsTable();

        statusMsg.textContent =
          'נטען דו"ח קיים' +
          (m.reportDate ? ' (תאריך דו"ח: ' + m.reportDate + ').' : '.');
      }

      function renderFindingsTable() {
        // Update findings count badge on tab
        var findingsTab = document.getElementById('tab-findings-list');
        if (findingsTab) {
          findingsTab.textContent = 'ממצאים שנוספו' + (findings.length ? ' (' + findings.length + ')' : '');
        }

        if (!findings.length) {
          tableWrapper.innerHTML = '<p class="muted">אין עדיין ממצאים.</p>';
          genBtn.disabled = true;
          dlBtn.disabled  = true;
          return;
        }

        let html = '<table><caption class="muted small-text">רשימת ממצאים שנוספו לדו"ח</caption><thead><tr>' +
          '<th>#</th><th>מזהה</th><th>קטגוריה</th><th>כותרת</th><th>חומרה</th><th>מדיניות / תקנים</th><th>הוכחה</th><th>פעולות</th>' +
          '</tr></thead><tbody>';

        findings.forEach((f, idx) => {
          const sev = severityMap[f.severity] || severityMap.medium;
          const catLabel = categoryMap[f.category] || f.category || 'CSPM';
          const policiesInline = f.policies.length
            ? f.policies.map(p => '<span class="tag-inline">' + p + '</span>').join(' ')
            : '<span class="muted">—</span>';

          var evidenceArr = Array.isArray(f.evidence) ? f.evidence : (f.evidence ? [f.evidence] : []);
          const evidenceText = evidenceArr.length ? '✓ ' + evidenceArr.length + ' תמונ' + (evidenceArr.length === 1 ? 'ה' : 'ות') : '<span class="muted">אין</span>';

          html += '<tr>' +
            '<td>' + (idx + 1) + '</td>' +
            '<td>' + (f.id || '') + '</td>' +
            '<td><span class="tag-inline">' + (f.category || 'CSPM') + '</span></td>' +
            '<td>' + (f.title || '') + '</td>' +
            '<td><span class="severity-chip ' + sev.class + '">' + sev.text + '</span></td>' +
            '<td>' + policiesInline + '</td>' +
            '<td>' + evidenceText + '</td>' +
            '<td>' +
              '<button class="btn btn-secondary btn-sm" data-action="edit" data-idx="' + idx + '" aria-label="ערוך ממצא ' + (f.id || '') + '">ערוך</button>' +
              '<button class="btn btn-secondary btn-sm" data-action="dup" data-idx="' + idx + '" aria-label="שכפל ממצא ' + (f.id || '') + '">שכפל</button>' +
              '<button class="btn btn-danger btn-sm" data-action="delete" data-idx="' + idx + '" aria-label="מחק ממצא ' + (f.id || '') + '">מחק</button>' +
              '<button class="btn btn-secondary btn-sm" data-action="up" data-idx="' + idx + '" aria-label="העבר למעלה ממצא ' + (f.id || '') + '">▲</button>' +
              '<button class="btn btn-secondary btn-sm" data-action="down" data-idx="' + idx + '" aria-label="העבר למטה ממצא ' + (f.id || '') + '">▼</button>' +
            '</td>' +
            '</tr>';
        });

        html += '</tbody></table>';
        tableWrapper.innerHTML = html;
        genBtn.disabled = false;
        dlBtn.disabled  = false;

        tableWrapper.querySelectorAll('button[data-action]').forEach(btn => {
          btn.addEventListener('click', function() {
            const action = this.getAttribute('data-action');
            const idx = parseInt(this.getAttribute('data-idx'), 10);
            if (Number.isNaN(idx)) return;

            if (action === 'delete') {
              findings.splice(idx, 1);
              if (editingIndex === idx) resetEditState();
              else if (editingIndex !== null && idx < editingIndex) editingIndex--;
              renderFindingsTable();
            } else if (action === 'edit') {
              startEditFinding(idx);
            } else if (action === 'dup') {
              const orig = findings[idx];
              const dup = JSON.parse(JSON.stringify(orig));
              dup.id = generateNextId(dup.category || 'CSPM');
              findings.splice(idx + 1, 0, dup);
              statusMsg.textContent = 'שוכפל ממצא ' + orig.id + ' → ' + dup.id;
              renderFindingsTable();
            } else if (action === 'up') {
              if (idx > 0) {
                const tmp = findings[idx - 1];
                findings[idx - 1] = findings[idx];
                findings[idx] = tmp;
                if (editingIndex === idx) editingIndex = idx - 1;
                else if (editingIndex === idx - 1) editingIndex = idx;
                renderFindingsTable();
              }
            } else if (action === 'down') {
              if (idx < findings.length - 1) {
                const tmp = findings[idx + 1];
                findings[idx + 1] = findings[idx];
                findings[idx] = tmp;
                if (editingIndex === idx) editingIndex = idx + 1;
                else if (editingIndex === idx + 1) editingIndex = idx;
                renderFindingsTable();
              }
            }
          });
        });
      }

      function resetEditState() {
        editingIndex = null;
        addBtn.textContent = 'הוסף ממצא לרשימה';
        cancelEditBtn.style.display = 'none';
        editState.textContent = '';
        clearFindingForm();
      }

      function clearFindingForm() {
        document.getElementById('f-id').value = '';
        document.getElementById('f-title').value = '';
        document.getElementById('f-severity').value = 'medium';
        document.getElementById('f-category').value = 'CSPM';
        document.getElementById('f-description').value = '';
        document.getElementById('f-impact').value = '';
        document.getElementById('f-technical').value = '';
        document.getElementById('f-policies').value = '';
        document.getElementById('f-recs').value = '';
        prioritySelect.value = '';
        priorityCustom.value = '';
        evidenceInput.value = '';
        clearEvidencePreview();
        updatePriorityCustomVisibility();
        prefillId();
      }

      function startEditFinding(idx) {
        const f = findings[idx];
        editingIndex = idx;

        const idField = document.getElementById('f-id');
        idField.value = f.id;
        idField.readOnly = false;
        document.getElementById('f-title').value = f.title;
        document.getElementById('f-severity').value = f.severity;
        document.getElementById('f-category').value = f.category || 'CSPM';
        document.getElementById('f-description').value = f.description;
        document.getElementById('f-impact').value = f.impact;
        document.getElementById('f-technical').value = f.technical.join('\\n');
        document.getElementById('f-policies').value = f.policies.join('\\n');
        document.getElementById('f-recs').value = f.recs.join('\\n');

        const knownPriorities = ['', 'מיידי (0–7 ימים)', 'גבוהה (עד 30 ימים)', 'בינונית (30–60 ימים)', 'נמוכה (60–120 ימים)', 'למעקב'];
        if (knownPriorities.includes(f.priority)) {
          prioritySelect.value = f.priority;
          priorityCustom.value = '';
        } else if (f.priority) {
          prioritySelect.value = 'custom';
          priorityCustom.value = f.priority;
        } else {
          prioritySelect.value = '';
          priorityCustom.value = '';
        }

        updatePriorityCustomVisibility();
        evidenceInput.value = '';
        var prevEvidence = f.evidence;
        if (Array.isArray(prevEvidence) && prevEvidence.length) {
          pendingEvidenceList = prevEvidence.slice();
          renderEvidencePreviews();
        } else if (prevEvidence && typeof prevEvidence === 'string') {
          pendingEvidenceList = [prevEvidence];
          renderEvidencePreviews();
        } else {
          clearEvidencePreview();
        }

        addBtn.textContent = 'עדכן ממצא';
        cancelEditBtn.style.display = 'inline-block';
        editState.textContent = 'מצב: עריכת ממצא #' + (idx + 1);

        // Scroll to form and focus title
        switchToTab('tab-finding-form');
        setTimeout(() => document.getElementById('f-title').focus(), 100);
      }

      function getPriorityFromUI() {
        const selected = prioritySelect.value;
        if (selected === 'custom') {
          return priorityCustom.value.trim();
        }
        return selected;
      }

      // --- Resize evidence image to consistent dimensions ---
      const EVIDENCE_MAX_W = 800;
      const EVIDENCE_MAX_H = 500;

      function resizeImage(dataUrl) {
        return new Promise(function(resolve) {
          var img = new Image();
          img.onload = function() {
            var w = img.width;
            var h = img.height;
            // Scale down to fit within max bounds, keep aspect ratio
            if (w > EVIDENCE_MAX_W || h > EVIDENCE_MAX_H) {
              var ratio = Math.min(EVIDENCE_MAX_W / w, EVIDENCE_MAX_H / h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/png'));
          };
          img.src = dataUrl;
        });
      }

      // --- Evidence: drag-drop, paste, preview (multiple images) ---
      let pendingEvidenceList = [];
      const dropZone = document.getElementById('evidence-drop-zone');
      const evidencePreview = document.getElementById('evidence-preview');

      function renderEvidencePreviews() {
        if (!pendingEvidenceList.length) {
          evidencePreview.innerHTML = '';
          return;
        }
        var html = '';
        pendingEvidenceList.forEach(function(dataUrl, idx) {
          html += '<span class="evidence-thumb" style="display:inline-block;position:relative;margin-left:8px;margin-bottom:6px;">' +
            '<img src="' + dataUrl + '" alt="הוכחה ' + (idx + 1) + '" style="max-width:120px;max-height:80px;border-radius:6px;border:1px solid var(--border);vertical-align:middle;">' +
            '<span class="clear-btn" data-evidence-idx="' + idx + '" style="position:absolute;top:-4px;right:-4px;background:var(--danger);color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;line-height:18px;text-align:center;cursor:pointer;">✕</span>' +
            '</span>';
        });
        evidencePreview.innerHTML = html;
        evidencePreview.querySelectorAll('.clear-btn[data-evidence-idx]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var idx = parseInt(this.getAttribute('data-evidence-idx'));
            pendingEvidenceList.splice(idx, 1);
            renderEvidencePreviews();
          });
        });
      }

      function clearEvidencePreview() {
        pendingEvidenceList = [];
        evidencePreview.innerHTML = '';
        evidenceInput.value = '';
      }

      function handleEvidenceFile(file) {
        if (!file || !file.type.startsWith('image/')) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          resizeImage(ev.target.result).then(function(resized) {
            pendingEvidenceList.push(resized);
            renderEvidencePreviews();
          });
        };
        reader.readAsDataURL(file);
      }

      // File input change
      evidenceInput.addEventListener('change', function() {
        if (this.files && this.files[0]) handleEvidenceFile(this.files[0]);
      });

      // Drag and drop
      dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        this.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', function() {
        this.classList.remove('drag-over');
      });
      dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        this.classList.remove('drag-over');
        var files = e.dataTransfer.files;
        if (files && files[0]) handleEvidenceFile(files[0]);
      });

      // Clipboard paste (Ctrl+V anywhere in the finding form)
      document.addEventListener('paste', function(e) {
        var items = (e.clipboardData || {}).items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            e.preventDefault();
            handleEvidenceFile(items[i].getAsFile());
            return;
          }
        }
      });

      function handleAddOrUpdateFinding() {
        const id          = document.getElementById('f-id').value.trim();
        const title       = document.getElementById('f-title').value.trim();
        const severity    = document.getElementById('f-severity').value;
        const category    = document.getElementById('f-category').value;
        const description = document.getElementById('f-description').value.trim();
        const impact      = document.getElementById('f-impact').value.trim();
        const technical   = splitLines(document.getElementById('f-technical').value);
        const policies    = splitLines(document.getElementById('f-policies').value);
        const recs        = splitLines(document.getElementById('f-recs').value);
        const priority    = getPriorityFromUI();

        if (!id || !title) {
          alert('מזהה וכותרת הם שדות חובה.');
          return;
        }

        const readerNeeded = pendingEvidenceList.length;

        const applyFinding = () => {
          let evidence = pendingEvidenceList.length ? pendingEvidenceList.slice() : [];

          if (!evidence.length && editingIndex !== null) {
            var prev = findings[editingIndex].evidence;
            evidence = Array.isArray(prev) ? prev : (prev ? [prev] : []);
          }

          const newFinding = {
            id,
            title,
            severity,
            category,
            description,
            impact,
            technical,
            policies,
            recs,
            priority,
            evidence
          };

          if (editingIndex === null) {
            findings.push(newFinding);
            statusMsg.textContent = 'נוסף ממצא. סה״כ: ' + findings.length;
          } else {
            findings[editingIndex] = newFinding;
            statusMsg.textContent = 'עודכן ממצא #' + (editingIndex + 1);
            resetEditState();
          }

          clearFindingForm();
          renderFindingsTable();

          // Auto-focus title for quick next entry
          setTimeout(() => document.getElementById('f-title').focus(), 100);
        };

        applyFinding();
      }

      addBtn.addEventListener('click', handleAddOrUpdateFinding);

      cancelEditBtn.addEventListener('click', function() {
        resetEditState();
      });

      // Sort findings by severity (critical first)
      document.getElementById('btn-sort-severity').addEventListener('click', function() {
        var sevOrder = { critical: 1, high: 2, medium: 3, low: 4, info: 5 };
        findings.sort(function(a, b) {
          return (sevOrder[a.severity] || 9) - (sevOrder[b.severity] || 9);
        });
        if (editingIndex !== null) resetEditState();
        renderFindingsTable();
        statusMsg.textContent = 'ממצאים מוינו לפי חומרה (קריטי ← מידע).';
      });

      // Clear all findings
      document.getElementById('btn-clear-all-findings').addEventListener('click', function() {
        if (!findings.length) return;
        if (!confirm('למחוק את כל ' + findings.length + ' הממצאים?')) return;
        findings.length = 0;
        resetEditState();
        renderFindingsTable();
        prefillId();
        statusMsg.textContent = 'כל הממצאים נמחקו.';
      });

      // Clear form
      document.getElementById('btn-clear-form').addEventListener('click', function() {
        resetEditState();
        statusMsg.textContent = 'הטופס נוקה.';
      });

      // Build a dynamic filename from client name + report date
      function buildFilename(ext) {
        var client = (document.getElementById('report-client').value || '').trim().replace(/[^\w\u0590-\u05FF\s-]/g, '').replace(/\s+/g, '_');
        var date = getDateAsDDMMYYYY().replace(/\//g, '-');
        var parts = ['cspm_report'];
        if (client) parts.push(client);
        if (date) parts.push(date);
        return parts.join('_') + '.' + ext;
      }

      // --- Cover image: preload default + custom upload ---
      var coverImageDataUrl = '';
      var defaultCoverImageDataUrl = '';

      fetch('/assets/cover.png')
        .then(function(r) { if (r.ok) return r.blob(); throw new Error('no cover'); })
        .then(function(blob) {
          return new Promise(function(resolve) {
            var reader = new FileReader();
            reader.onload = function() { resolve(reader.result); };
            reader.readAsDataURL(blob);
          });
        })
        .then(function(dataUrl) {
          defaultCoverImageDataUrl = dataUrl;
          if (!coverImageDataUrl) coverImageDataUrl = dataUrl;
        })
        .catch(function() { /* no cover image — that's fine */ });

      // Custom cover image upload
      var coverImageInput = document.getElementById('report-cover-image');
      var coverImagePreview = document.getElementById('cover-image-preview');

      function showCoverPreview(dataUrl) {
        coverImageDataUrl = dataUrl;
        coverImagePreview.innerHTML =
          '<img src="' + dataUrl + '" alt="תצוגה מקדימה של תמונת שער" style="max-width:300px;max-height:180px;border-radius:8px;border:1px solid var(--border);">' +
          '<span class="clear-btn" id="clear-cover-image">✕ חזור לברירת מחדל</span>';
        document.getElementById('clear-cover-image').addEventListener('click', function() {
          coverImageDataUrl = defaultCoverImageDataUrl;
          coverImagePreview.innerHTML = '';
          coverImageInput.value = '';
        });
      }

      coverImageInput.addEventListener('change', function() {
        var file = this.files[0];
        if (!file || !file.type.startsWith('image/')) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          showCoverPreview(ev.target.result);
        };
        reader.readAsDataURL(file);
      });

      function countSeverity(key) {
        return findings.filter(f => f.severity === key).length;
      }

      // --- Risk score calculation ---
      function calcRiskScore() {
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

      function escapeHtml(str) {
        return (str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }

      function linesToListHtml(text) {
        const lines = splitLines(text);
        if (!lines.length) return '';
        return '<ul>' + lines.map(l => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>';
      }

      function buildSeverityChartSvg(counts, labelOverrides) {
        // counts = { critical: N, high: N, medium: N, low: N, info: N }
        var colors = { critical: '#b91c1c', high: '#ef4444', medium: '#f97316', low: '#22c55e', info: '#6b7280' };
        var labels = labelOverrides || { critical: 'קריטי', high: 'גבוה', medium: 'בינוני', low: 'נמוך', info: 'מידע' };
        var total = 0;
        var slices = [];
        ['critical', 'high', 'medium', 'low', 'info'].forEach(function(k) {
          var n = counts[k] || 0;
          if (n > 0) slices.push({ key: k, count: n, color: colors[k], label: labels[k] });
          total += n;
        });
        if (total === 0) return '';

        // Build SVG pie chart (pie only, no legend inside SVG)
        var cx = 100, cy = 100, r = 80;
        var angle = -Math.PI / 2;
        var paths = '';
        slices.forEach(function(s) {
          var sweep = (s.count / total) * 2 * Math.PI;
          var x1 = cx + r * Math.cos(angle);
          var y1 = cy + r * Math.sin(angle);
          var x2 = cx + r * Math.cos(angle + sweep);
          var y2 = cy + r * Math.sin(angle + sweep);
          var large = sweep > Math.PI ? 1 : 0;
          paths += '<path d="M' + cx + ',' + cy + ' L' + x1.toFixed(2) + ',' + y1.toFixed(2) +
            ' A' + r + ',' + r + ' 0 ' + large + ',1 ' + x2.toFixed(2) + ',' + y2.toFixed(2) +
            ' Z" fill="' + s.color + '"/>';
          angle += sweep;
        });

        // HTML legend beside the chart
        var legendItems = '';
        slices.forEach(function(s) {
          legendItems += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
            '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:' + s.color + ';flex-shrink:0;"></span>' +
            '<span style="font-size:13px;color:#333;font-family:Arial;">' + s.label + ' (' + s.count + ')</span>' +
            '</div>';
        });

        return '<div style="display:flex;align-items:center;justify-content:center;gap:30px;margin:16px 0;">' +
          '<svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">' +
          paths + '</svg>' +
          '<div style="display:flex;flex-direction:column;">' + legendItems + '</div>' +
          '</div>';
      }

      // --- i18n for report output ---
      var i18n = {
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

      function buildReportHtml() {
        const lang = document.getElementById('report-lang').value || 'he';
        const t = i18n[lang] || i18n.he;
        const client      = document.getElementById('report-client').value.trim();
        const env         = document.getElementById('report-env').value.trim();
        const range       = document.getElementById('report-range').value.trim();
        const consultant  = document.getElementById('report-consultant').value.trim();
        const reportDate  = getDateAsDDMMYYYY();
        const reportRisk  = document.getElementById('report-risk').value.trim();
        const execSummary = document.getElementById('report-exec-summary').value.trim();
        const keyTopics   = document.getElementById('report-key-topics').value;
        const teamName    = document.getElementById('report-team-name').value.trim() || 'CSPM Report';
        const orgName     = document.getElementById('report-org-name').value.trim();
        const footerText  = document.getElementById('report-footer-text').value.trim();
        const coverNote   = document.getElementById('report-cover-note').value.trim() || 'מסמך זה מסכם את ממצאי בדיקת האבטחה כפי שאותרו, כולל ניתוח סיכונים והמלצות לטיפול.';
        const reportVersion = document.getElementById('report-version').value.trim() || '1.0';

        const critCount  = countSeverity('critical');
        const highCount  = countSeverity('high');
        const medCount   = countSeverity('medium');
        const lowCount   = countSeverity('low');
        const infoCount  = countSeverity('info');
        const riskScore  = calcRiskScore();

        // Group findings by category
        var findingsByCategory = {};
        findings.forEach(function(f) {
          var cat = f.category || 'CSPM';
          if (!findingsByCategory[cat]) findingsByCategory[cat] = [];
          findingsByCategory[cat].push(f);
        });

        // Build category-severity matrix for dashboard
        var catKeys = Object.keys(findingsByCategory);
        var catMatrixHtml = '';
        if (catKeys.length > 0) {
          catMatrixHtml = '<table><thead><tr><th>' + t.catHeader + '</th><th>' + t.critical + '</th><th>' + t.high + '</th><th>' + t.medium + '</th><th>' + t.low + '</th><th>' + t.info + '</th><th>' + t.totalHeader + '</th></tr></thead><tbody>';
          catKeys.forEach(function(cat) {
            var items = findingsByCategory[cat];
            var c = items.filter(function(f){return f.severity==='critical';}).length;
            var h = items.filter(function(f){return f.severity==='high';}).length;
            var m = items.filter(function(f){return f.severity==='medium';}).length;
            var l = items.filter(function(f){return f.severity==='low';}).length;
            var inf = items.filter(function(f){return f.severity==='info';}).length;
            catMatrixHtml += '<tr><td>' + escapeHtml(cat + ' – ' + (categoryMap[cat]||cat)) + '</td><td>' + c + '</td><td>' + h + '</td><td>' + m + '</td><td>' + l + '</td><td>' + inf + '</td><td>' + items.length + '</td></tr>';
          });
          catMatrixHtml += '</tbody></table>';
        }

        // Severity text in current report language
        function sevText(key) {
          return t[key] || (severityMap[key] || {}).text || key;
        }

        var findingsCardsHtml = '';
        catKeys.forEach(function(cat) {
          var catLabel = categoryMap[cat] || cat;
          if (catKeys.length > 1) {
            findingsCardsHtml += '<h2 style="margin-top:18px;border-right:3px solid #1d4ed8;padding-right:5px;">' + escapeHtml(cat + ' – ' + catLabel) + '</h2>\n';
          }
          findingsByCategory[cat].forEach(function(f) {

          const sev = severityMap[f.severity] || severityMap.medium;
          const anchorId = makeFindingAnchorId(f.id);

          const technicalHtml = f.technical.length
            ? `<ul>${f.technical.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
            : `<p class="muted">${t.noTech}</p>`;

          const policyHtml = f.policies.length
            ? `<ul class="tag-list">${f.policies.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
            : `<p class="muted">${t.noPolicies}</p>`;

          const recHtml = f.recs.length
            ? `<ul>${f.recs.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
            : `<p class="muted">${t.noRecs}</p>`;

          const priorityHtml = f.priority
            ? `<p><strong>${escapeHtml(f.priority)}</strong></p>`
            : `<p class="muted">${t.noPriority}</p>`;

          var evidenceArr = Array.isArray(f.evidence) ? f.evidence : (f.evidence ? [f.evidence] : []);
          const evidenceHtml = evidenceArr.length
            ? `
               <div class="finding-section-title">${t.findingEvidence} (${evidenceArr.length} ${evidenceArr.length === 1 ? t.image : t.images})</div>
               <p class="muted">${t.evidenceText}</p>
               ${evidenceArr.map(function(ev, ei) { return '<div style="width:800px; max-width:100%; margin-top:8px;"><img src="' + ev + '" alt="Evidence ' + (ei+1) + '" class="evidence-img" style="width:100%; height:auto; border:1px solid #ccc; border-radius:4px; display:block; cursor:pointer;" onclick="document.getElementById(\'lightbox-overlay\').style.display=\'flex\'; document.getElementById(\'lightbox-img\').src=this.src;"></div>'; }).join('')}
              `
            : '';

          findingsCardsHtml += `
          <div class="finding-wrap">
          <div class="finding-card" id="${anchorId}">
            <div class="finding-header">
              <div>
                <div class="finding-title">${escapeHtml(f.title)}</div>
                <div class="finding-id">${t.findingIdLabel}: ${escapeHtml(f.id)}</div>
              </div>
              <div class="severity-badge ${sev.class}">${sevText(f.severity)}</div>
            </div>

            <div class="finding-section-title">${t.findingDesc}</div>
            <p>${escapeHtml(f.description)}</p>

            <div class="finding-section-title">${t.findingImpact}</div>
            <p>${escapeHtml(f.impact)}</p>

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
          findingsCardsHtml += '\n';
          });
        });

        const treatmentTableHtml = findings.map(f => {
          const sev = severityMap[f.severity] || severityMap.medium;
          const anchorId = makeFindingAnchorId(f.id);

          // חישוב יעד סגירה לפי תאריך דו"ח + עדיפות הממצא
          let dueDate = calcDueDate(reportDate, f.priority);
          if (!dueDate) {
            // אם אין תאריך דו"ח או עדיפות לא ידועה – השאר placeholder
            dueDate = 'DD/MM/YYYY';
          }
          
          const linkOpen  = `<a href="#${anchorId}">`;
          const linkClose = `</a>`;

          return (
            '<tr>' +
              '<td>' + linkOpen + escapeHtml(f.id)   + linkClose + '</td>' +
              '<td>' + linkOpen + escapeHtml(f.title)+ linkClose + '</td>' +
              '<td>' + sevText(f.severity) + '</td>' +
              '<td>' + t.ownerPlaceholder + '</td>' +
              '<td>' + dueDate + '</td>' +
              '<td>' + t.statusOpen + '</td>' +
            '</tr>'
          );
        }).join('\n');

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

        const execSummaryHtml = execSummary
          ? `<p>${escapeHtml(execSummary)}</p>`
          : `<p>${t.defaultExecSummary}</p>`;

        const keyTopicsHtml = linesToListHtml(keyTopics) ||
          `<p class="muted">${t.defaultKeyTopics}</p>`;

        const html = `<!DOCTYPE html>
<html lang="${t.lang}" dir="${t.dir}">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(teamName)}</title>

<style>
  * { box-sizing: border-box; }

  @page {
    size: A4;
    margin: 0 0 20mm 0;  /* בלי מרווח למעלה, 20mm מרווח לתחתית בשביל הפוטר */
  }

  body {
    margin: 0;
    padding-top: 30mm;    /* למסך – גובה ההאדר (22mm) + מרווח */
    padding-bottom: 22mm; /* למסך – גובה הפוטר (15mm) + מרווח */
    font-family: Arial, "Segoe UI", Tahoma, sans-serif;
    background: #e5edf7;
    color: #222;
  }

  .print-header {
    position: fixed;      /* למסך – קבוע */
    top: 0;
    left: 0;
    right: 0;
    height: 22mm;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4mm 20mm;
    background: linear-gradient(to left, #0b3c5d, #15559b);
    color: #f9fafb;
    font-size: 11px;
    z-index: 1000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .print-footer {
    position: fixed;      /* למסך – קבוע */
    bottom: 0;
    left: 0;
    right: 0;
    height: 15mm;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3mm 20mm;
    border-top: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #64748b;
    font-size: 11px;
    z-index: 1000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page-title-main {
    font-weight: bold;
    font-size: 14px;
    letter-spacing: 0.5px;
  }

  .page-logo {
    font-size: 11px;
    opacity: 0.9;
  }

  .report-content {
    margin-top: 0;
    margin-bottom: 0;
    padding: 0 15mm;
  }

  .page-section {
    page-break-after: always;
    background: #ffffff;
    margin: 0 auto 10mm auto;
    padding: 14mm 10mm 12mm 10mm;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.18);
    border-radius: 6px;
    border-top: 5px solid #0b3c5d;
  }

  .page-section:last-child {
    page-break-after: auto;
    margin-bottom: 0;
  }

  h1, h2, h3, h4 {
    margin-top: 8px;
    margin-bottom: 8px;
    color: #0b3c5d;
  }

  h1 {
    font-size: 26px;
    border-right: 4px solid #15559b;
    padding-right: 6px;
    margin-bottom: 10px;
    padding-top: 4px;
  }

  h2 {
    font-size: 19px;
    margin-top: 18px;
    border-right: 3px solid #1d4ed8;
    padding-right: 5px;
  }

  h3 {
    font-size: 15px;
    margin-top: 12px;
    color: #1e293b;
  }

  p {
    font-size: 13px;
    line-height: 1.6;
    margin: 4px 0;
    color: #111827;
  }

  ul, ol {
    font-size: 13px;
    line-height: 1.6;
    margin: 4px 0 4px 20px;
    color: #111827;
  }

  .muted {
    color: #6b7280;
    font-size: 12px;
  }

  .section-divider {
    border-top: 1px dashed #cbd5e1;
    margin: 15px 0;
  }

  .cover-page-inner {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    min-height: 220mm;
  }

  .cover-image {
    width: 100%;
    margin-bottom: 24px;
  }

  .cover-image img {
    display: block;
    margin: 0 auto;
  }

  .cover-main-title {
    font-size: 30px;
    font-weight: bold;
    margin-bottom: 10px;
    color: #0b3c5d;
  }

  .cover-subtitle {
    font-size: 16px;
    margin-bottom: 20px;
    color: #1f2937;
  }

  .cover-meta {
    margin-top: 25px;
    font-size: 14px;
    background: #eff6ff;
    border-radius: 6px;
    padding: 10px 12px;
    border: 1px solid #bfdbfe;
  }

  .cover-meta p {
    margin: 4px 0;
  }

  .cover-badge {
    margin-top: 40px;
    padding: 10px 15px;
    border-radius: 6px;
    font-size: 12px;
    background: #0b3c5d;
    color: #f9fafb;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.35);
  }

  .toc-list {
    list-style: none;
    padding: 0;
    margin: 8px 0 0 0;
    font-size: 13px;
  }

  .toc-list a {
    color: #0b3c5d;
    text-decoration: none;
  }

  .toc-list a:hover {
    text-decoration: underline;
  }

  /* למסך – קפיצה מה-TOC עם מרווח מתחת להאדר */
  h1[id], h2[id], h3[id] {
    scroll-margin-top: 40mm;
  }

  .toc-item {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px dotted #cbd5e1;
    padding: 4px 0;
  }

  .toc-item span {
    display: inline-block;
  }

  .toc-finding {
    padding-right: 20px;
    font-size: 12px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0;
    font-size: 12px;
  }

  th, td {
    padding: 6px 8px;
    vertical-align: top;
    border: 1px solid #d1d5db;
  }

  th {
    background: linear-gradient(to left, #0b3c5d, #15559b);
    color: #f9fafb;
    font-weight: bold;
  }

  tbody tr:nth-child(odd) {
    background: #f9fbff;
  }

  tbody tr:nth-child(even) {
    background: #ffffff;
  }

  .finding-wrap {
    margin-top: 8px;
  }

  .finding-wrap:first-child {
    margin-top: 0;
  }

  .finding-card {
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 10px;
    font-size: 12px;
    background: #f9fafb;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  }

  .finding-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 4px;
  }

  .finding-title {
    font-weight: bold;
    font-size: 13px;
    color: #0b3c5d;
  }

  .finding-id {
    font-size: 11px;
    color: #6b7280;
  }

  .severity-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    color: #fff;
    font-weight: bold;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.35);
  }

  .sev-critical { background: #b91c1c; }
  .sev-high     { background: #ef4444; }
  .sev-medium   { background: #f97316; }
  .sev-low      { background: #22c55e; }
  .sev-info     { background: #6b7280; }

  .finding-section-title {
    font-weight: bold;
    margin-top: 6px;
    margin-bottom: 2px;
    color: #111827;
  }

  .tag-list {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 11px;
  }

  .tag-list li {
    display: inline-block;
    margin-left: 5px;
    margin-bottom: 3px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid #cbd5e1;
    background: #eff6ff;
    color: #1e3a8a;
  }

  .two-column {
    display: flex;
    gap: 10px;
    margin-top: 4px;
  }

  .two-column > div {
    flex: 1;
    background: #ffffff;
    border-radius: 4px;
    border: 1px solid #e5e7eb;
    padding: 6px;
  }

  img {
    max-width: 100%;
    height: auto;
  }

  /* --------- PRINT – יציב ל-PDF --------- */
  @media print {
    body {
      background: #ffffff;
      margin: 0;
      padding: 0;       /* לא סומכים על padding של body בפרינט */
    }

    /* האדר: פעם אחת בראש המסמך, לא קבוע מעל שאר הדפים */
    .print-header {
      position: static !important;
      height: auto;
      padding: 4mm 20mm 2mm;
      z-index: 0;
    }

    /* הפוטר: קבוע בתחתית כל עמוד, מרחף מעל מרווח ה-@page התחתון */
    .print-footer {
      position: fixed !important;
      bottom: 0;
      left: 0;
      right: 0;
      height: 15mm;
      padding: 3mm 20mm;
      border-top: 1px solid #cbd5e1;
      background: #f8fafc;
      z-index: 10;
    }

    .report-content {
      margin-top: 0;
      margin-bottom: 0;
      padding: 0 15mm 0 15mm;
    }

    .page-section {
      box-shadow: none;
      margin: 0 auto 10mm auto;
      border-radius: 0;
      page-break-after: always;
    }

    .page-section:last-child {
      page-break-after: auto;
    }

    h1, h2, h3, h4 {
      margin-top: 8px;  /* בפרינט אין header fixed מעליהם */
    }

    .finding-wrap {
      break-inside: avoid;
      page-break-inside: avoid;
      margin-top: 10px;
      padding-top: 18mm;
    }

    .finding-wrap:first-child {
      padding-top: 0;
    }

    .finding-card {
      page-break-inside: avoid;
      break-inside: avoid;
      margin: 0 0 10px 0;
    }
  }
</style>

</head>
<body>

  <div class="print-header">
    <div class="page-title-main">${escapeHtml(teamName)}</div>
    ${orgName ? '<div class="page-logo">' + escapeHtml(orgName) + '</div>' : ''}
  </div>

  <div class="print-footer">
    ${footerText ? '<div>' + escapeHtml(footerText) + '</div>' : '<div></div>'}
    <div>${t.reportDateFooter}: ${escapeHtml(reportDate || 'DD/MM/YYYY')}</div>
  </div>

  <main class="report-content">

    <section class="page-section cover">
      <div class="cover-page-inner">
        <div class="cover-main-title">${escapeHtml(teamName)}</div>
        <div class="cover-subtitle">${t.coverSubtitle}</div>
        ${coverImageDataUrl ? '<div class="cover-image"><img src="' + coverImageDataUrl + '" alt="CSPM Report Cover" style="width:100%;max-height:280px;object-fit:contain;border-radius:8px;"></div>' : ''}

        <div class="cover-meta">
          <p><strong>${t.clientLabel}:</strong> ${escapeHtml(client || '__________')}</p>
          <p><strong>${t.envLabel}:</strong> ${escapeHtml(env || '__________')}</p>
          <p><strong>${t.rangeLabel}:</strong> ${escapeHtml(range || '__________')}</p>
          <p><strong>${t.consultantLabel}:</strong> ${escapeHtml(consultant || '__________')}</p>
          <p><strong>${t.dateLabel}:</strong> ${escapeHtml(reportDate || '__________')}</p>
          <p><strong>${t.versionLabel}:</strong> ${escapeHtml(reportVersion)}</p>
        </div>

        <div class="cover-badge">
          ${escapeHtml(coverNote)}
        </div>
      </div>
    </section>

    <section class="page-section">
      <h1>${t.toc}</h1>

        <ul class="toc-list">
        <li class="toc-item">
            <span><a href="#exec-summary">${t.execSummary}</a></span>
        </li>
        <li class="toc-item">
            <span><a href="#scope-method">${t.scopeMethod}</a></span>
        </li>
        <li class="toc-item">
            <span><a href="#findings-summary">${t.findingsSummary}</a></span>
        </li>
        <li class="toc-item">
            <span><a href="#detailed-findings">${t.detailedFindings}</a></span>
        </li>
        ${findings.map(function(f) {
          var sev = severityMap[f.severity] || severityMap.medium;
          return '<li class="toc-item toc-finding"><span><a href="#' + makeFindingAnchorId(f.id) + '">' + escapeHtml(f.id) + ' – ' + escapeHtml(f.title) + '</a></span><span class="severity-badge ' + sev.class + '" style="font-size:9px;padding:1px 6px;">' + sevText(f.severity) + '</span></li>';
        }).join('\n')}
        <li class="toc-item">
            <span><a href="#recommendations">${t.recommendations}</a></span>
        </li>
        <li class="toc-item">
            <span><a href="#appendix-a">${t.appendix}</a></span>
        </li>
        </ul>

    </section>

    <section class="page-section">
      <h1 id="exec-summary">${t.execSummary}</h1>
      ${execSummaryHtml}
      <p><strong>${t.riskLabel}:</strong> ${escapeHtml(reportRisk || (t[riskScore.level] || riskScore.label))}.</p>
      ${findings.length ? '<p><strong>' + t.riskScoreLabel + ':</strong> ' + riskScore.percent + '% (' + (t[riskScore.level] || riskScore.label) + ') ' + t.riskScoreSuffix + '</p>' : ''}

      <div class="section-divider"></div>

      <h2 id="scope-method">${t.scopeMethod}</h2>
      <h3>${t.scopeTitle}</h3>
      <p>${t.scopeText}</p>

      <h3>${t.toolsTitle}</h3>
      <p>${t.toolsText}</p>

      <h3>${t.methodTitle}</h3>
      <ul>
        ${t.methodItems.map(function(item) { return '<li>' + item + '</li>'; }).join('\n        ')}
      </ul>
    </section>

    <section class="page-section">
      <h1 id="findings-summary">${t.findingsSummary}</h1>
      <p>${t.findingsSummaryText}</p>

      ${buildSeverityChartSvg({ critical: critCount, high: highCount, medium: medCount, low: lowCount, info: infoCount }, { critical: t.critical, high: t.high, medium: t.medium, low: t.low, info: t.info })}

      <table>
        <thead>
          <tr>
            <th>${t.sevHeader}</th>
            <th>${t.countHeader}</th>
            <th>${t.notesHeader}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${t.critical}</td>
            <td>${critCount}</td>
            <td>${t.critNote}</td>
          </tr>
          <tr>
            <td>${t.high}</td>
            <td>${highCount}</td>
            <td>${t.highNote}</td>
          </tr>
          <tr>
            <td>${t.medium}</td>
            <td>${medCount}</td>
            <td>${t.medNote}</td>
          </tr>
          <tr>
            <td>${t.low}</td>
            <td>${lowCount}</td>
            <td>${t.lowNote}</td>
          </tr>
          <tr>
            <td>${t.info}</td>
            <td>${infoCount}</td>
            <td>${t.infoNote}</td>
          </tr>
        </tbody>
      </table>

      <h2>${t.keyTopics}</h2>
      ${keyTopicsHtml}

      ${catKeys.length > 1 ? '<h2>' + t.catBreakdown + '</h2>' + catMatrixHtml : ''}
    </section>

    <section class="page-section">
      <h1 id="detailed-findings">${t.detailedFindings}</h1>
      <p>
        ${t.detailedFindingsText}
      </p>
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

      genBtn.addEventListener('click', function() {
        if (!findings.length) {
          alert('אין ממצאים לייצוא.');
          return;
        }
        const html = buildReportHtml();
        const win = window.open('', '_blank');
        if (!win) {
          alert('הדפדפן חסם פתיחת חלון. צריך לאפשר Popups לדף הזה.');
          return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
        statusMsg.textContent = 'נוצר דו"ח בחלון חדש. אפשר להדפיס ל-PDF.';
      });

      dlBtn.addEventListener('click', function() {
        if (!findings.length) {
          alert('אין ממצאים לייצוא.');
          return;
        }
        const html = buildReportHtml();
        const blob = new Blob([html], { type: 'text/html' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = buildFilename('html');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        statusMsg.textContent = 'קובץ HTML של הדו"ח ירד למחשב – אפשר לפתוח/לערוך אותו כרצונך.';
      });
      
      // ייצוא Snapshot כקובץ JSON
      exportJsonBtn.addEventListener('click', function() {
        const snapshot = buildSnapshot();
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
          type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href = url;
        a.download = buildFilename('json');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        statusMsg.textContent = 'תצורת הדו"ח יוצאה כקובץ JSON (meta + ממצאים).';
      });

      // פתיחת דיאלוג טעינת JSON
      importJsonBtn.addEventListener('click', function() {
        importJsonInput.click();
      });

      // קריאת קובץ JSON והחלתו
      importJsonInput.addEventListener('change', function() {
        const file = this.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(ev) {
          try {
            const snapshot = JSON.parse(ev.target.result);
            applySnapshot(snapshot);
          } catch (e) {
            console.error(e);
            alert('קריאת קובץ JSON נכשלה. ודא שהקובץ נוצר מהמחולל.');
          } finally {
            importJsonInput.value = ''; // לנקות לחיצה הבאה
          }
        };
        reader.readAsText(file, 'utf-8');
      });

      // --- CSV bulk import ---
      const importCsvBtn = document.getElementById('btn-import-csv');
      const importCsvInput = document.getElementById('input-import-csv');

      importCsvBtn.addEventListener('click', function() {
        importCsvInput.click();
      });

      function parseCSV(text) {
        // RFC 4180 compliant CSV parser — handles multiline quoted fields
        var rows = [];
        var row = [];
        var field = '';
        var inQuotes = false;
        var i = 0;
        while (i < text.length) {
          var ch = text[i];
          if (inQuotes) {
            if (ch === '"') {
              if (i + 1 < text.length && text[i + 1] === '"') {
                field += '"';
                i += 2;
              } else {
                inQuotes = false;
                i++;
              }
            } else {
              field += ch;
              i++;
            }
          } else {
            if (ch === '"') {
              inQuotes = true;
              i++;
            } else if (ch === ',') {
              row.push(field);
              field = '';
              i++;
            } else if (ch === '\r') {
              // skip \r, handle \r\n
              i++;
            } else if (ch === '\n') {
              row.push(field);
              field = '';
              if (row.some(function(c) { return c.trim() !== ''; })) rows.push(row);
              row = [];
              i++;
            } else {
              field += ch;
              i++;
            }
          }
        }
        // Last field/row
        row.push(field);
        if (row.some(function(c) { return c.trim() !== ''; })) rows.push(row);
        return rows;
      }

      function mapSeverity(val) {
        var v = (val || '').toLowerCase().trim();
        if (v === 'critical' || v === 'קריטי') return 'critical';
        if (v === 'high' || v === 'גבוה') return 'high';
        if (v === 'medium' || v === 'בינוני') return 'medium';
        if (v === 'low' || v === 'נמוך') return 'low';
        if (v === 'info' || v === 'informational' || v === 'מידע') return 'info';
        return 'medium';
      }

      importCsvInput.addEventListener('change', function() {
        var file = this.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          try {
            var rows = parseCSV(ev.target.result);
            if (rows.length < 2) { alert('קובץ CSV ריק או ללא שורות נתונים.'); return; }
            var headers = rows[0].map(function(h) { return h.toLowerCase().trim(); });

            // Detect Wiz cloud configuration format
            var isWiz = headers.indexOf('rule.shortid') >= 0 || headers.indexOf('rule.name') >= 0;

            var count = 0;

            if (isWiz) {
              // --- Wiz cloud configuration CSV ---
              var col = {};
              ['rule.shortid', 'rule.name', 'rule.severity', 'rule.description',
               'rule.remediationinstructions', 'rule.cloudprovider', 'rule.servicetype',
               'rule.targetnativetype', 'rule.risks', 'rule.externalreferences',
               'rule.securitysubcategories', 'analytics.totalfindingcount',
               'analytics.resourcecount', 'analytics.criticalseverityfindingcount',
               'analytics.highseverityfindingcount'].forEach(function(key) {
                col[key] = headers.indexOf(key);
              });

              for (var i = 1; i < rows.length; i++) {
                var r = rows[i];
                var name = col['rule.name'] >= 0 ? (r[col['rule.name']] || '') : '';
                if (!name) continue;

                var shortId = col['rule.shortid'] >= 0 ? (r[col['rule.shortid']] || '') : '';
                var sev = col['rule.severity'] >= 0 ? mapSeverity(r[col['rule.severity']]) : 'medium';
                var desc = col['rule.description'] >= 0 ? (r[col['rule.description']] || '') : '';
                var remediation = col['rule.remediationinstructions'] >= 0 ? (r[col['rule.remediationinstructions']] || '') : '';
                var cloud = col['rule.cloudprovider'] >= 0 ? (r[col['rule.cloudprovider']] || '') : '';
                var service = col['rule.servicetype'] >= 0 ? (r[col['rule.servicetype']] || '') : '';
                var targetType = col['rule.targetnativetype'] >= 0 ? (r[col['rule.targetnativetype']] || '') : '';
                var totalFindings = col['analytics.totalfindingcount'] >= 0 ? (r[col['analytics.totalfindingcount']] || '') : '';
                var resourceCount = col['analytics.resourcecount'] >= 0 ? (r[col['analytics.resourcecount']] || '') : '';
                var risksRaw = col['rule.risks'] >= 0 ? (r[col['rule.risks']] || '') : '';
                var refsRaw = col['rule.externalreferences'] >= 0 ? (r[col['rule.externalreferences']] || '') : '';

                // Build technical details
                var technical = [];
                if (cloud) technical.push('Cloud Provider: ' + cloud);
                if (service) technical.push('Service: ' + service);
                if (targetType) technical.push('Resource Type: ' + targetType);
                if (totalFindings) technical.push('Total Findings: ' + totalFindings);
                if (resourceCount) technical.push('Affected Resources: ' + resourceCount);

                // Parse risks JSON array for impact
                var impact = '';
                try {
                  var risks = JSON.parse(risksRaw);
                  if (Array.isArray(risks) && risks.length) impact = risks.join(', ');
                } catch(e) { impact = risksRaw; }

                // Parse external references for policies
                var policies = [];
                try {
                  var refs = JSON.parse(refsRaw);
                  if (Array.isArray(refs)) {
                    refs.forEach(function(ref) {
                      var label = '';
                      if (ref.id) label += ref.id;
                      if (ref.name && ref.name !== ref.id) label += (label ? ' – ' : '') + ref.name;
                      if (label) policies.push(label);
                    });
                  }
                } catch(e) {}

                // Auto-detect category from cloud provider / service
                var category = 'CSPM';
                var cloudLower = cloud.toLowerCase();
                var serviceLower = service.toLowerCase();
                if (cloudLower === 'kubernetes' || serviceLower === 'kubernetes') {
                  category = 'KSPM';
                }

                // Parse remediation into lines
                var recs = remediation ? splitLines(remediation) : [];

                findings.push({
                  id: shortId || generateNextId(category),
                  title: name,
                  severity: sev,
                  category: category,
                  description: desc,
                  impact: impact,
                  technical: technical,
                  policies: policies,
                  recs: recs,
                  priority: '',
                  evidence: []
                });
                count++;
              }
            } else {
              // --- Generic CSV format ---
              var colId = headers.findIndex(function(h) { return h === 'id' || h === 'finding id' || h === 'מזהה'; });
              var colTitle = headers.findIndex(function(h) { return h === 'title' || h === 'name' || h === 'כותרת' || h === 'issue'; });
              var colSev = headers.findIndex(function(h) { return h === 'severity' || h === 'חומרה' || h === 'risk'; });
              var colDesc = headers.findIndex(function(h) { return h === 'description' || h === 'תיאור' || h === 'details'; });
              var colImpact = headers.findIndex(function(h) { return h === 'impact' || h === 'השפעה'; });
              var colRec = headers.findIndex(function(h) { return h === 'recommendation' || h === 'remediation' || h === 'המלצה' || h === 'fix'; });

              if (colTitle === -1) {
                alert('לא נמצאה עמודת כותרת (title/name/issue) ב-CSV.');
                return;
              }

              for (var i = 1; i < rows.length; i++) {
                var r = rows[i];
                var title = r[colTitle] || '';
                if (!title) continue;
                findings.push({
                  id: (colId >= 0 && r[colId]) ? r[colId] : generateNextId('CSPM'),
                  title: title,
                  severity: colSev >= 0 ? mapSeverity(r[colSev]) : 'medium',
                  category: 'CSPM',
                  description: colDesc >= 0 ? (r[colDesc] || '') : '',
                  impact: colImpact >= 0 ? (r[colImpact] || '') : '',
                  technical: [],
                  policies: [],
                  recs: colRec >= 0 ? splitLines(r[colRec] || '') : [],
                  priority: '',
                  evidence: []
                });
                count++;
              }
            }

            renderFindingsTable();
            prefillId();
            switchToTab('tab-findings-list');
            statusMsg.textContent = 'יובאו ' + count + ' ממצאים מ-CSV' + (isWiz ? ' (Wiz format)' : '') + '. סה״כ: ' + findings.length;
          } catch (e) {
            console.error(e);
            alert('שגיאה בקריאת CSV.');
          } finally {
            importCsvInput.value = '';
          }
        };
        reader.readAsText(file, 'utf-8');
      });

      // --- Trend comparison (import previous JSON, show delta) ---
      var baselineBtn = document.getElementById('btn-import-baseline');
      var baselineInput = document.getElementById('input-import-baseline');
      var trendContainer = document.getElementById('trend-comparison');

      baselineBtn.addEventListener('click', function() { baselineInput.click(); });

      baselineInput.addEventListener('change', function() {
        var file = this.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          try {
            var baseline = JSON.parse(ev.target.result);
            if (!baseline.findings || !Array.isArray(baseline.findings)) {
              alert('קובץ JSON לא תואם לפורמט המחולל.'); return;
            }
            showTrendComparison(baseline.findings);
          } catch(e) { alert('שגיאה בקריאת קובץ JSON.'); }
          finally { baselineInput.value = ''; }
        };
        reader.readAsText(file, 'utf-8');
      });

      function showTrendComparison(baselineFindings) {
        var prevIds = {};
        baselineFindings.forEach(function(f) { prevIds[f.id] = f; });
        var currIds = {};
        findings.forEach(function(f) { currIds[f.id] = f; });

        var newFindings = findings.filter(function(f) { return !prevIds[f.id]; });
        var resolvedFindings = baselineFindings.filter(function(f) { return !currIds[f.id]; });
        var sevChanged = findings.filter(function(f) {
          return prevIds[f.id] && prevIds[f.id].severity !== f.severity;
        });

        var html = '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-top:8px;">';
        html += '<h3 style="margin-top:0;">📊 השוואה לדו"ח קודם</h3>';
        html += '<p class="muted small-text">בסיס: ' + baselineFindings.length + ' ממצאים | נוכחי: ' + findings.length + ' ממצאים</p>';

        // Summary chips
        html += '<div style="display:flex;gap:10px;margin:10px 0;flex-wrap:wrap;">';
        html += '<span class="severity-chip sev-high">חדשים: ' + newFindings.length + '</span>';
        html += '<span class="severity-chip sev-low">נסגרו: ' + resolvedFindings.length + '</span>';
        html += '<span class="severity-chip sev-medium">שינוי חומרה: ' + sevChanged.length + '</span>';
        html += '</div>';

        if (newFindings.length) {
          html += '<h3>ממצאים חדשים</h3><ul class="small-text">';
          newFindings.forEach(function(f) {
            var sev = severityMap[f.severity] || severityMap.medium;
            html += '<li><span class="severity-chip ' + sev.class + '" style="font-size:10px;padding:1px 6px;">' + sev.text + '</span> ' + escapeHtml(f.id) + ' – ' + escapeHtml(f.title) + '</li>';
          });
          html += '</ul>';
        }
        if (resolvedFindings.length) {
          html += '<h3>ממצאים שנסגרו</h3><ul class="small-text">';
          resolvedFindings.forEach(function(f) {
            html += '<li style="text-decoration:line-through;color:var(--text-muted);">' + escapeHtml(f.id) + ' – ' + escapeHtml(f.title) + '</li>';
          });
          html += '</ul>';
        }
        if (sevChanged.length) {
          html += '<h3>שינויי חומרה</h3><ul class="small-text">';
          sevChanged.forEach(function(f) {
            var prev = severityMap[prevIds[f.id].severity] || severityMap.medium;
            var curr = severityMap[f.severity] || severityMap.medium;
            html += '<li>' + escapeHtml(f.id) + ': <span class="severity-chip ' + prev.class + '" style="font-size:10px;padding:1px 6px;">' + prev.text + '</span> → <span class="severity-chip ' + curr.class + '" style="font-size:10px;padding:1px 6px;">' + curr.text + '</span></li>';
          });
          html += '</ul>';
        }
        html += '</div>';
        trendContainer.innerHTML = html;
        trendContainer.style.display = 'block';
      }

      // --- Auto-save to localStorage ---
      const AUTOSAVE_KEY = 'cspm_report_autosave';
      const autosaveIndicator = document.getElementById('autosave-indicator');

      function showAutosaveStatus(text, saving) {
        autosaveIndicator.textContent = text;
        autosaveIndicator.classList.toggle('saving', !!saving);
        autosaveIndicator.classList.add('visible');
      }

      function autoSave() {
        try {
          const snapshot = buildSnapshot();
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
          var now = new Date();
          var hh = String(now.getHours()).padStart(2, '0');
          var mm = String(now.getMinutes()).padStart(2, '0');
          var ss = String(now.getSeconds()).padStart(2, '0');
          showAutosaveStatus('💾 נשמר ' + hh + ':' + mm + ':' + ss);
        } catch (e) { /* quota exceeded or private mode — ignore */ }
      }

      function autoRestore() {
        try {
          const raw = localStorage.getItem(AUTOSAVE_KEY);
          if (!raw) return false;
          const snapshot = JSON.parse(raw);
          if (snapshot && snapshot.meta && Array.isArray(snapshot.findings) && snapshot.findings.length > 0) {
            applySnapshot(snapshot);
            statusMsg.textContent = 'שוחזר אוטומטית מהשמירה האחרונה.';
            return true;
          }
        } catch (e) { /* corrupt data — ignore */ }
        return false;
      }

      // Save every 10 seconds and on page unload
      setInterval(autoSave, 10000);
      window.addEventListener('beforeunload', autoSave);

      // Restore on load
      autoRestore();

      // --- Report defaults (save/load profile) ---
      const DEFAULTS_KEY = 'cspm_report_defaults';
      const defaultsStatus = document.getElementById('defaults-status');

      const defaultFields = [
        'report-client', 'report-env', 'report-consultant',
        'report-team-name', 'report-org-name', 'report-footer-text',
        'report-cover-note', 'report-lang', 'report-exec-summary',
        'report-key-topics'
      ];

      function saveDefaults() {
        var data = {};
        defaultFields.forEach(function(id) {
          var el = document.getElementById(id);
          if (el) data[id] = el.value;
        });
        try {
          localStorage.setItem(DEFAULTS_KEY, JSON.stringify(data));
          defaultsStatus.textContent = '✓ ברירת מחדל נשמרה';
          setTimeout(function() { defaultsStatus.textContent = ''; }, 3000);
        } catch (e) {
          defaultsStatus.textContent = 'שגיאה בשמירה';
        }
      }

      function loadDefaults() {
        try {
          var raw = localStorage.getItem(DEFAULTS_KEY);
          if (!raw) {
            defaultsStatus.textContent = 'אין ברירת מחדל שמורה';
            setTimeout(function() { defaultsStatus.textContent = ''; }, 3000);
            return false;
          }
          var data = JSON.parse(raw);
          defaultFields.forEach(function(id) {
            var el = document.getElementById(id);
            if (el && data[id] !== undefined) el.value = data[id];
          });
          defaultsStatus.textContent = '✓ ברירת מחדל נטענה';
          setTimeout(function() { defaultsStatus.textContent = ''; }, 3000);
          return true;
        } catch (e) { return false; }
      }

      function clearDefaults() {
        localStorage.removeItem(DEFAULTS_KEY);
        defaultsStatus.textContent = '✓ ברירת מחדל נמחקה';
        setTimeout(function() { defaultsStatus.textContent = ''; }, 3000);
      }

      document.getElementById('btn-save-defaults').addEventListener('click', saveDefaults);
      document.getElementById('btn-load-defaults').addEventListener('click', loadDefaults);
      document.getElementById('btn-clear-defaults').addEventListener('click', clearDefaults);

      // Auto-load defaults on fresh page (no autosave data and no findings)
      if (!findings.length && !localStorage.getItem(AUTOSAVE_KEY)) {
        loadDefaults();
      }

      // Default report date to today if not already set (e.g. from auto-restore)
      if (!dateInput.value) {
        dateInput.valueAsDate = new Date();
      }

      prefillId();
      renderFindingsTable();

      // =====================================================================
      // Cloud API integration
      // =====================================================================
      const isCloud = (window.location.protocol === 'http:' || window.location.protocol === 'https:') && !window.location.protocol.startsWith('file');

      const renderPdfBtn = document.getElementById('btn-render-pdf');
      const saveStateCloudBtn = document.getElementById('btn-save-state-cloud');
      const cloudUploadStateInput = document.getElementById('cloud-upload-state');

      // Enable PDF button when findings exist
      function updateCloudButtons() {
        if (renderPdfBtn) renderPdfBtn.disabled = !findings.length;
      }

      // Override the renderFindingsTable to also update cloud buttons
      const _origRender = renderFindingsTable;
      // We already call renderFindingsTable at the end, so just hook into the table update
      const origObserver = new MutationObserver(updateCloudButtons);
      origObserver.observe(tableWrapper, { childList: true });

      // --- Render PDF via server ---
      if (renderPdfBtn) {
        renderPdfBtn.addEventListener('click', async function() {
          if (!findings.length) { alert('אין ממצאים לייצוא.'); return; }
          statusMsg.textContent = 'מייצר PDF בשרת...';
          renderPdfBtn.disabled = true;
          try {
            const html = buildReportHtml();
            const snapshot = buildSnapshot();
            const resp = await fetch('/api/render-pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ html: html, meta: snapshot.meta })
            });
            if (!resp.ok) {
              const err = await resp.json().catch(() => ({}));
              throw new Error(err.error || 'Server error');
            }
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = buildFilename('pdf');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            statusMsg.textContent = 'PDF נוצר והורד בהצלחה.';
            refreshOutputsList();
          } catch (e) {
            statusMsg.textContent = 'שגיאה ביצירת PDF: ' + e.message;
          } finally {
            renderPdfBtn.disabled = !findings.length;
          }
        });
      }

      // --- Save state to server ---
      if (saveStateCloudBtn) {
        saveStateCloudBtn.addEventListener('click', async function() {
          const snapshot = buildSnapshot();
          try {
            const resp = await fetch('/api/upload-state', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(snapshot)
            });
            if (!resp.ok) throw new Error('Upload failed');
            const result = await resp.json();
            statusMsg.textContent = 'תצורה נשמרה בשרת (ID: ' + result.id + ')';
            refreshStatesList();
          } catch (e) {
            statusMsg.textContent = 'שגיאה בשמירה: ' + e.message;
          }
        });
      }

      // --- Upload state file to server ---
      if (cloudUploadStateInput) {
        cloudUploadStateInput.addEventListener('change', async function() {
          const file = this.files[0];
          if (!file) return;
          const formData = new FormData();
          formData.append('file', file);
          try {
            const resp = await fetch('/api/upload-state', { method: 'POST', body: formData });
            if (!resp.ok) throw new Error('Upload failed');
            const result = await resp.json();
            statusMsg.textContent = 'קובץ תצורה הועלה (ID: ' + result.id + ')';
            refreshStatesList();
          } catch (e) {
            statusMsg.textContent = 'שגיאה בהעלאה: ' + e.message;
          } finally {
            cloudUploadStateInput.value = '';
          }
        });
      }

      // --- Refresh states list ---
      async function refreshStatesList() {
        const container = document.getElementById('states-list');
        if (!container) return;
        try {
          const resp = await fetch('/api/list-states');
          const states = await resp.json();
          if (!states.length) {
            container.innerHTML = '<p class="muted">אין תצורות שמורות.</p>';
            return;
          }
          let html = '<table><caption class="muted small-text">תצורות שמורות בשרת</caption><thead><tr><th>לקוח</th><th>תאריך</th><th>גודל</th><th>פעולות</th></tr></thead><tbody>';
          states.forEach(s => {
            html += '<tr>' +
              '<td>' + (s.client || '—') + '</td>' +
              '<td>' + (s.reportDate || '—') + '</td>' +
              '<td>' + Math.round(s.size / 1024) + ' KB</td>' +
              '<td>' +
                '<button class="btn btn-secondary btn-sm" data-cloud-action="load" data-cloud-id="' + s.id + '">טען</button> ' +
                '<a class="btn btn-secondary btn-sm" href="/api/download-state/' + s.id + '" download>הורד</a> ' +
                '<button class="btn btn-danger btn-sm" data-cloud-action="delete-state" data-cloud-id="' + s.id + '">מחק</button>' +
              '</td></tr>';
          });
          html += '</tbody></table>';
          container.innerHTML = html;
          // Event delegation for states table
          container.querySelectorAll('button[data-cloud-action]').forEach(function(btn) {
            btn.addEventListener('click', function() {
              var action = this.getAttribute('data-cloud-action');
              var id = this.getAttribute('data-cloud-id');
              if (action === 'load') cloudLoadState(id);
              else if (action === 'delete-state') cloudDeleteState(id);
            });
          });
        } catch (e) {
          container.innerHTML = '<p class="muted">שגיאה בטעינת רשימה.</p>';
        }
      }

      // --- Refresh outputs list ---
      async function refreshOutputsList() {
        const container = document.getElementById('outputs-list');
        if (!container) return;
        try {
          const resp = await fetch('/api/list-outputs');
          const files = await resp.json();
          if (!files.length) {
            container.innerHTML = '<p class="muted">אין קבצי פלט.</p>';
            return;
          }
          let html = '<table><caption class="muted small-text">קבצי פלט בשרת</caption><thead><tr><th>שם קובץ</th><th>סוג</th><th>גודל</th><th>פעולות</th></tr></thead><tbody>';
          files.forEach(f => {
            html += '<tr>' +
              '<td>' + f.filename + '</td>' +
              '<td>' + f.type.toUpperCase() + '</td>' +
              '<td>' + Math.round(f.size / 1024) + ' KB</td>' +
              '<td>' +
                '<a class="btn btn-secondary btn-sm" href="/api/download-output/' + f.filename + '" download>הורד</a> ' +
                '<button class="btn btn-danger btn-sm" data-cloud-action="delete-output" data-cloud-id="' + f.filename + '">מחק</button>' +
              '</td></tr>';
          });
          html += '</tbody></table>';
          container.innerHTML = html;
          // Event delegation for outputs table
          container.querySelectorAll('button[data-cloud-action]').forEach(function(btn) {
            btn.addEventListener('click', function() {
              var action = this.getAttribute('data-cloud-action');
              var id = this.getAttribute('data-cloud-id');
              if (action === 'delete-output') cloudDeleteOutput(id);
            });
          });
        } catch (e) {
          container.innerHTML = '<p class="muted">שגיאה בטעינת רשימה.</p>';
        }
      }

      // Cloud action functions
      window.cloudLoadState = async function(id) {
        try {
          const resp = await fetch('/api/download-state/' + id);
          if (!resp.ok) throw new Error('Not found');
          const snapshot = await resp.json();
          applySnapshot(snapshot);
          statusMsg.textContent = 'תצורה נטענה מהשרת.';
        } catch (e) {
          statusMsg.textContent = 'שגיאה בטעינה: ' + e.message;
        }
      };

      window.cloudDeleteState = async function(id) {
        if (!confirm('למחוק תצורה זו?')) return;
        try {
          await fetch('/api/delete-state/' + id, { method: 'DELETE' });
          refreshStatesList();
        } catch (e) {
          statusMsg.textContent = 'שגיאה במחיקה.';
        }
      };

      window.cloudDeleteOutput = async function(filename) {
        if (!confirm('למחוק קובץ זה?')) return;
        try {
          await fetch('/api/delete-output/' + filename, { method: 'DELETE' });
          refreshOutputsList();
        } catch (e) {
          statusMsg.textContent = 'שגיאה במחיקה.';
        }
      };

      // Initial load of cloud file lists
      if (isCloud) {
        refreshStatesList();
        refreshOutputsList();
      }

      // =====================================================================
      // AI writing assistant (requires GEMINI_API_KEY on server)
      // =====================================================================

      // Fields that get the AI suggest button
      var aiFields = [
        { id: 'f-description',       label: 'תיאור ממצא' },
        { id: 'f-impact',            label: 'השפעה עסקית / סיכון' },
        { id: 'f-recs',              label: 'המלצות' },
        { id: 'report-exec-summary', label: 'תקציר מנהלים' },
        { id: 'report-key-topics',   label: 'נושאי מפתח' },
      ];

      var aiEnabled = false;
      var aiModelSelect = document.getElementById('ai-model');
      var aiModelRow = document.getElementById('ai-model-row');

      // Check if AI is available on the server
      if (isCloud) {
        fetch('/api/health').then(function(r) { return r.json(); }).then(function(d) {
          if (d.ai_enabled) {
            aiEnabled = true;
            // Populate model dropdown
            if (d.ai_models && d.ai_models.length && aiModelSelect) {
              d.ai_models.forEach(function(m) {
                var opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                if (m === d.ai_default_model) opt.selected = true;
                aiModelSelect.appendChild(opt);
              });
              aiModelRow.style.display = '';
            }
            aiFields.forEach(attachAiButton);
          }
        }).catch(function() {});
      }

      function attachAiButton(field) {
        var el = document.getElementById(field.id);
        if (!el) return;

        var wrapper = document.createElement('div');
        wrapper.className = 'ai-suggest-row';

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ai btn-sm';
        btn.textContent = '✨ שפר ניסוח';
        btn.title = 'שלח לבינה מלאכותית לשיפור הניסוח';

        var resultBox = document.createElement('div');
        resultBox.className = 'ai-suggestion-box';
        resultBox.style.display = 'none';

        wrapper.appendChild(btn);
        wrapper.appendChild(resultBox);
        el.parentNode.insertBefore(wrapper, el.nextSibling);

        btn.addEventListener('click', function() {
          var text = el.value.trim();
          if (!text) { statusMsg.textContent = 'אין טקסט לשיפור.'; return; }

          btn.disabled = true;
          btn.textContent = '⏳ מעבד...';
          resultBox.style.display = 'none';

          fetch('/api/suggest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, field: field.label, model: aiModelSelect ? aiModelSelect.value : '' })
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.error) {
              statusMsg.textContent = 'שגיאת AI: ' + data.error;
              return;
            }
            resultBox.style.display = 'block';
            resultBox.innerHTML = '';

            var header = document.createElement('div');
            header.className = 'ai-suggestion-header';
            header.textContent = 'הצעת שיפור:';

            var content = document.createElement('div');
            content.className = 'ai-suggestion-content';
            content.textContent = data.suggestion;

            var actions = document.createElement('div');
            actions.className = 'ai-suggestion-actions';

            var acceptBtn = document.createElement('button');
            acceptBtn.type = 'button';
            acceptBtn.className = 'btn btn-primary btn-sm';
            acceptBtn.textContent = '✓ קבל';
            acceptBtn.addEventListener('click', function() {
              el.value = data.suggestion;
              resultBox.style.display = 'none';
            });

            var dismissBtn = document.createElement('button');
            dismissBtn.type = 'button';
            dismissBtn.className = 'btn btn-secondary btn-sm';
            dismissBtn.textContent = '✕ בטל';
            dismissBtn.addEventListener('click', function() {
              resultBox.style.display = 'none';
            });

            actions.appendChild(acceptBtn);
            actions.appendChild(dismissBtn);
            resultBox.appendChild(header);
            resultBox.appendChild(content);
            resultBox.appendChild(actions);
          })
          .catch(function(e) {
            statusMsg.textContent = 'שגיאת רשת: ' + e.message;
          })
          .finally(function() {
            btn.disabled = false;
            btn.textContent = '✨ שפר ניסוח';
          });
        });
      }

      // =====================================================================
      // Wizi integration
      // =====================================================================
      var wiziResults = document.getElementById('wizi-results');
      var wiziStatusMsg = document.getElementById('wizi-status-msg');
      var wiziFetchBtn = document.getElementById('btn-wizi-fetch');
      var wiziLoadMoreBtn = document.getElementById('btn-wizi-load-more');
      var wiziImportBtn = document.getElementById('btn-wizi-import-selected');
      var wiziSelectAllBtn = document.getElementById('btn-wizi-select-all');
      var wiziActionsDiv = document.getElementById('wizi-actions');
      var wiziSelectedCount = document.getElementById('wizi-selected-count');
      var wiziProjectInput = document.getElementById('wizi-project');
      var wiziProjectId = document.getElementById('wizi-project-id');
      var wiziProjectList = document.getElementById('wizi-project-list');
      var wiziSubInput = document.getElementById('wizi-subscription');
      var wiziSubId = document.getElementById('wizi-subscription-id');
      var wiziIssues = [];
      var wiziEndCursor = null;
      var wiziHasNextPage = false;
      var wiziEnabled = false;
      var wiziProjects = [];
      var wiziSubscriptions = [];

      // --- Autocomplete helper ---
      function setupAutocomplete(input, hiddenInput, listEl, getItems) {
        var activeIdx = -1;

        function render(query) {
          var items = getItems();
          var q = (query || '').toLowerCase();
          var filtered = q ? items.filter(function(it) {
            return it.label.toLowerCase().includes(q) || (it.sub || '').toLowerCase().includes(q);
          }) : items;
          filtered = filtered.slice(0, 50); // cap results

          if (!filtered.length) {
            listEl.classList.remove('open');
            return;
          }

          listEl.innerHTML = filtered.map(function(it, i) {
            return '<div class="autocomplete-item" data-id="' + it.id + '" data-label="' + it.label.replace(/"/g, '&quot;') + '">' +
              it.label + (it.sub ? ' <span class="ac-sub">' + it.sub + '</span>' : '') +
              '</div>';
          }).join('');
          listEl.classList.add('open');
          activeIdx = -1;
        }

        input.addEventListener('input', function() {
          hiddenInput.value = '';
          render(input.value);
        });

        input.addEventListener('focus', function() {
          if (!input.value) render('');
        });

        listEl.addEventListener('click', function(e) {
          var item = e.target.closest('.autocomplete-item');
          if (item) {
            input.value = item.getAttribute('data-label');
            hiddenInput.value = item.getAttribute('data-id');
            listEl.classList.remove('open');
          }
        });

        input.addEventListener('keydown', function(e) {
          var items = listEl.querySelectorAll('.autocomplete-item');
          if (!items.length) return;

          if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, items.length - 1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, 0);
          } else if (e.key === 'Enter' && activeIdx >= 0) {
            e.preventDefault();
            items[activeIdx].click();
            return;
          } else if (e.key === 'Escape') {
            listEl.classList.remove('open');
            return;
          } else {
            return;
          }

          items.forEach(function(el, i) {
            el.classList.toggle('active', i === activeIdx);
          });
          if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
        });

        // Close on outside click
        document.addEventListener('click', function(e) {
          if (!input.contains(e.target) && !listEl.contains(e.target)) {
            listEl.classList.remove('open');
          }
        });

        // Clear button behavior — if user clears the field, reset hidden ID
        input.addEventListener('change', function() {
          if (!input.value.trim()) hiddenInput.value = '';
        });
      }

      setupAutocomplete(wiziProjectInput, wiziProjectId, wiziProjectList, function() {
        return wiziProjects;
      });

      function loadWiziFilters() {
        // Try to load projects via raw GraphQL
        fetch('/api/wizi/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ projects(first: 500) { nodes { id name slug } } }' })
        })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var nodes = (data.data || {}).projects ? data.data.projects.nodes || [] : [];
            if (nodes.length) {
              wiziProjects = nodes.map(function(p) {
                return { id: p.id, label: p.name, sub: p.slug || '' };
              });
              console.log('Wizi: loaded ' + wiziProjects.length + ' projects');
            } else {
              console.warn('Wizi projects: no data or unsupported query', data);
            }
          }).catch(function(e) { console.warn('Wizi projects fetch failed:', e); });

        // Try to load subscriptions — no root query available, use free text search
        // Subscriptions are filtered via relatedEntity.subscriptionSearch in the issues query
        console.log('Wizi: subscription filter uses free-text search (no root query available)');
      }

      // Check if Wizi is enabled on load
      if (isCloud) {
        fetch('/api/wizi/status')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.enabled) {
              wiziEnabled = true;
              wiziStatusMsg.textContent = '✓ Wizi מחובר — ' + (data.totalIssues || 0) + ' issues בסה"כ';
              loadWiziFilters();
              // Update status after filters load
              setTimeout(function() {
                var parts = ['✓ Wizi מחובר'];
                parts.push(data.totalIssues + ' issues');
                if (wiziProjects.length) parts.push(wiziProjects.length + ' projects');
                wiziStatusMsg.textContent = parts.join(' · ');
              }, 3000);
            } else {
              wiziStatusMsg.textContent = 'Wizi לא מוגדר — הגדר WIZI_CLIENT_ID ו-WIZI_CLIENT_SECRET ב-.env';
            }
          })
          .catch(function() {
            wiziStatusMsg.textContent = 'לא ניתן להתחבר לשרת.';
          });
      } else {
        wiziStatusMsg.textContent = 'Wizi זמין רק בהרצה דרך Docker.';
      }

      function getSelectedValues(selectEl) {
        var vals = [];
        for (var i = 0; i < selectEl.options.length; i++) {
          if (selectEl.options[i].selected) vals.push(selectEl.options[i].value);
        }
        return vals;
      }

      function mapWiziSeverity(sev) {
        var m = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFORMATIONAL: 'info' };
        return m[(sev || '').toUpperCase()] || 'medium';
      }

      function mapWiziCategory(entity) {
        if (!entity) return 'CSPM';
        var t = (entity.type || '').toLowerCase();
        var nt = (entity.nativeType || '').toLowerCase();
        if (t.includes('kubernetes') || nt.includes('k8s') || nt.includes('kube')) return 'KSPM';
        if (t.includes('database') || t.includes('storage') || nt.includes('rds') || nt.includes('s3')) return 'DSPM';
        if (t.includes('network') || t.includes('firewall') || t.includes('security_group') || nt.includes('securitygroup')) return 'NEXP';
        if (t.includes('iam') || t.includes('role') || t.includes('policy') || nt.includes('iam')) return 'EAPM';
        if (t.includes('virtual_machine') || t.includes('host') || nt.includes('ec2') || nt.includes('vm')) return 'HSPM';
        if (t.includes('secret') || nt.includes('secret')) return 'SECR';
        return 'CSPM';
      }

      function updateWiziSelectedCount() {
        var total = document.querySelectorAll('.wizi-check').length;
        var checked = document.querySelectorAll('.wizi-check:checked').length;
        wiziSelectedCount.textContent = checked + ' / ' + total + ' נבחרו';
      }

      function renderWiziTable() {
        if (!wiziIssues.length) {
          wiziResults.innerHTML = '<p class="muted">לא נמצאו ממצאים.</p>';
          wiziActionsDiv.style.display = 'none';
          return;
        }

        var html = '<table><caption>ממצאי Wizi — סמן לייבוא</caption><thead><tr>' +
          '<th><input type="checkbox" id="wizi-check-all" checked></th>' +
          '<th>Rule</th><th>חומרה</th><th>Entity</th><th>Subscription</th><th>Cloud</th><th>Region</th><th>סטטוס</th>' +
          '</tr></thead><tbody>';

        wiziIssues.forEach(function(issue, idx) {
          var sev = (issue.severity || 'MEDIUM').toUpperCase();
          var sevClass = 'sev-' + mapWiziSeverity(sev);
          var entity = issue.entitySnapshot || {};
          var rules = issue.sourceRules || [];
          var ruleName = rules.length ? rules[0].name : (issue.description || 'N/A');
          var ruleDesc = rules.length ? rules[0].description : '';
          html += '<tr>' +
            '<td><input type="checkbox" class="wizi-check" data-idx="' + idx + '" checked></td>' +
            '<td title="' + (ruleDesc).replace(/"/g, '&quot;') + '">' + ruleName + '</td>' +
            '<td><span class="severity-chip ' + sevClass + '">' + sev + '</span></td>' +
            '<td>' + (entity.name || 'N/A') + '<br><span class="muted">' + (entity.nativeType || entity.type || '') + '</span></td>' +
            '<td>' + (entity.subscriptionName || '') + '</td>' +
            '<td>' + (entity.cloudPlatform || '') + '</td>' +
            '<td>' + (entity.region || '') + '</td>' +
            '<td>' + (issue.status || '') + '</td>' +
            '</tr>';
        });

        html += '</tbody></table>';
        wiziResults.innerHTML = html;
        wiziActionsDiv.style.display = '';

        // Check-all toggle
        document.getElementById('wizi-check-all').addEventListener('change', function() {
          var checked = this.checked;
          document.querySelectorAll('.wizi-check').forEach(function(cb) { cb.checked = checked; });
          updateWiziSelectedCount();
        });

        // Individual checkbox change
        wiziResults.addEventListener('change', function(e) {
          if (e.target.classList.contains('wizi-check')) updateWiziSelectedCount();
        });

        updateWiziSelectedCount();
      }

      wiziFetchBtn.addEventListener('click', function() {
        wiziIssues = [];
        wiziEndCursor = null;
        fetchWiziIssues(false);
      });

      wiziLoadMoreBtn.addEventListener('click', function() {
        fetchWiziIssues(true);
      });

      function fetchWiziIssues(append) {
        var sevFilter = getSelectedValues(document.getElementById('wizi-severity'));
        var statusFilter = getSelectedValues(document.getElementById('wizi-status'));
        var limit = parseInt(document.getElementById('wizi-limit').value) || 10;
        var project = wiziProjectId.value || wiziProjectInput.value.trim() || null;
        var subscription = wiziSubInput.value.trim() || null;

        wiziFetchBtn.disabled = true;
        wiziStatusMsg.textContent = 'שולף ממצאים מ-Wizi...';

        var body = { first: limit, severity: sevFilter, status: statusFilter };
        if (project) body.project = project;
        if (subscription) body.subscription = subscription;
        if (append && wiziEndCursor) body.after = wiziEndCursor;

        fetch('/api/wizi/issues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.error) {
            wiziStatusMsg.textContent = 'שגיאה: ' + data.error;
            return;
          }
          var issues = data.issues || {};
          var nodes = issues.nodes || [];
          var pageInfo = issues.pageInfo || {};

          if (append) {
            wiziIssues = wiziIssues.concat(nodes);
          } else {
            wiziIssues = nodes;
          }

          wiziEndCursor = pageInfo.endCursor || null;
          wiziHasNextPage = pageInfo.hasNextPage || false;
          wiziLoadMoreBtn.style.display = wiziHasNextPage ? '' : 'none';

          wiziStatusMsg.textContent = 'נמצאו ' + wiziIssues.length + ' ממצאים' +
            (issues.totalCount ? ' (מתוך ' + issues.totalCount + ')' : '') +
            (wiziHasNextPage ? ' — יש עוד' : '');

          renderWiziTable();
        })
        .catch(function(e) {
          wiziStatusMsg.textContent = 'שגיאת רשת: ' + e.message;
        })
        .finally(function() {
          wiziFetchBtn.disabled = false;
        });
      }

      wiziSelectAllBtn.addEventListener('click', function() {
        var checks = document.querySelectorAll('.wizi-check');
        var allChecked = Array.from(checks).every(function(cb) { return cb.checked; });
        checks.forEach(function(cb) { cb.checked = !allChecked; });
        var checkAll = document.getElementById('wizi-check-all');
        if (checkAll) checkAll.checked = !allChecked;
        updateWiziSelectedCount();
      });

      wiziImportBtn.addEventListener('click', function() {
        var selected = [];
        document.querySelectorAll('.wizi-check:checked').forEach(function(cb) {
          var idx = parseInt(cb.getAttribute('data-idx'));
          if (wiziIssues[idx]) selected.push(wiziIssues[idx]);
        });

        if (!selected.length) {
          wiziStatusMsg.textContent = 'לא נבחרו ממצאים לייבוא.';
          return;
        }

        var imported = 0;
        selected.forEach(function(issue) {
          var rules = issue.sourceRules || [];
          var rule = rules.length ? rules[0] : {};
          var entity = issue.entitySnapshot || {};
          var sev = mapWiziSeverity(issue.severity);
          var cat = mapWiziCategory(entity);
          var id = generateNextId(cat);

          var technical = [];
          if (entity.cloudPlatform) technical.push('Cloud: ' + entity.cloudPlatform);
          if (entity.subscriptionName) technical.push('Subscription: ' + entity.subscriptionName);
          if (entity.region) technical.push('Region: ' + entity.region);
          if (entity.name) technical.push('Entity: ' + entity.name);
          if (entity.nativeType) technical.push('Type: ' + entity.nativeType);

          var recs = '';
          if (issue.remediationRecommendationV2 && issue.remediationRecommendationV2.recommendation) {
            recs = issue.remediationRecommendationV2.recommendation;
          }

          findings.push({
            id: id,
            category: cat,
            title: rule.name || issue.description || 'Wizi Issue ' + issue.id,
            severity: sev,
            description: splitLines(rule.description || issue.description || ''),
            impact: [],
            technical: splitLines(technical.join('\n')),
            policies: [],
            recs: splitLines(recs),
            priority: '',
            evidence: []
          });
          imported++;
        });

        renderFindingsTable();
        prefillId();
        autoSave();
        switchToTab('tab-findings-list');
        statusMsg.textContent = 'יובאו ' + imported + ' ממצאים מ-Wizi. סה"כ: ' + findings.length;
      });

    })();
