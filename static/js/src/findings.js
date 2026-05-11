      // ── Finding Detail Pane ──
      function showFindingDetail(idx) {
        selectedFindingIndex = idx;
        var emptyEl = document.getElementById('findings-detail-empty');
        var contentEl = document.getElementById('findings-detail-content');
        if (!contentEl || !emptyEl) return;

        if (idx === null || !findings[idx]) {
          emptyEl.style.display = '';
          contentEl.style.display = 'none';
          selectedFindingIndex = null;
          return;
        }

        emptyEl.style.display = 'none';
        contentEl.style.display = '';

        var f = findings[idx];
        var sev = severityMap[f.severity] || severityMap.medium;

        // Header
        var headerEl = document.getElementById('findings-detail-header');
        headerEl.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
            '<span class="severity-chip ' + sev.class + '">' + sev.text + '</span>' +
            '<span class="tag-inline">' + (f.category || 'CSPM') + '</span>' +
            '<span style="font-size:11px;color:var(--text-muted);font-family:monospace;">' + (f.id || '') + '</span>' +
            '<span style="margin-right:auto;position:relative;">' +
              '<button class="btn-icon-sm" id="btn-detail-actions" title="פעולות">⋮</button>' +
              '<div class="actions-dropdown" id="detail-actions-menu" style="display:none;">' +
                '<button class="actions-dropdown-item" id="detail-action-edit">✏️ ערוך</button>' +
                '<button class="actions-dropdown-item" id="detail-action-dup">📋 שכפל</button>' +
                '<button class="actions-dropdown-item" id="detail-action-ai">🤖 שיפור AI</button>' +
                '<button class="actions-dropdown-item actions-dropdown-danger" id="detail-action-delete">🗑️ מחק</button>' +
              '</div>' +
            '</span>' +
          '</div>' +
          '<div style="font-size:17px;font-weight:700;color:var(--text-heading);margin-bottom:4px;">' + escapeHtml(f.title || '') + '</div>' +
          '<div style="font-size:12px;color:var(--text-muted);">' +
            (f.owner ? '👤 ' + escapeHtml(f.owner) : '') +
            (f.priority ? ' · ⏱ ' + escapeHtml(f.priority) : '') +
          '</div>';

        // Wire detail actions dropdown
        var detailActionsBtn = document.getElementById('btn-detail-actions');
        var detailActionsMenu = document.getElementById('detail-actions-menu');
        if (detailActionsBtn && detailActionsMenu) {
          detailActionsBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            detailActionsMenu.style.display = detailActionsMenu.style.display === 'none' ? 'block' : 'none';
          });
          document.getElementById('detail-action-edit').addEventListener('click', function() {
            detailActionsMenu.style.display = 'none';
            startEditFinding(selectedFindingIndex);
          });
          document.getElementById('detail-action-dup').addEventListener('click', function() {
            detailActionsMenu.style.display = 'none';
            if (selectedFindingIndex !== null && findings[selectedFindingIndex]) {
              var orig = findings[selectedFindingIndex];
              var dup = JSON.parse(JSON.stringify(orig));
              dup.id = generateNextId(dup.category || 'CSPM');
              findings.splice(selectedFindingIndex + 1, 0, dup);
              renderFindingsTable();
              showToast('שוכפל ' + orig.id + ' → ' + dup.id, 'success');
            }
          });
          document.getElementById('detail-action-ai').addEventListener('click', function() {
            detailActionsMenu.style.display = 'none';
            if (selectedFindingIndex !== null && findings[selectedFindingIndex]) {
              enrichFindingsWithAiSummaries([findings[selectedFindingIndex]]);
            }
          });
          document.getElementById('detail-action-delete').addEventListener('click', function() {
            detailActionsMenu.style.display = 'none';
            document.getElementById('btn-detail-delete').click();
          });
        }

        // Render active tab content
        renderDetailTab();

        // Highlight active list item
        document.querySelectorAll('.finding-list-item').forEach(function(el) {
          el.classList.toggle('active', parseInt(el.getAttribute('data-idx')) === idx);
        });
        // Also highlight table rows
        if (tableWrapper) {
          tableWrapper.querySelectorAll('tr[data-idx]').forEach(function(row) {
            row.classList.toggle('active-row', parseInt(row.getAttribute('data-idx')) === idx);
          });
        }
      }

      function renderDetailTab() {
        var bodyEl = document.getElementById('findings-detail-body');
        if (!bodyEl || selectedFindingIndex === null) return;
        var f = findings[selectedFindingIndex];
        if (!f) return;

        var content = '';
        if (activeDetailTab === 'description') {
          content = f.description || 'אין תיאור';
        } else if (activeDetailTab === 'impact') {
          content = f.impact || 'אין השפעה מוגדרת';
        } else if (activeDetailTab === 'technical') {
          content = Array.isArray(f.technical) ? f.technical.join('\n') : (f.technical || 'אין פרטים טכניים');
        } else if (activeDetailTab === 'recs') {
          content = Array.isArray(f.recs) ? f.recs.join('\n') : (f.recs || 'אין המלצות');
        } else if (activeDetailTab === 'policies') {
          content = Array.isArray(f.policies) && f.policies.length ? f.policies.join('\n') : 'אין תקנים';
        }

        bodyEl.innerHTML = '<div class="detail-content-block">' + escapeHtml(content) + '</div>';
      }

      // Wire detail tabs
      document.querySelectorAll('.findings-detail-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
          document.querySelectorAll('.findings-detail-tab').forEach(function(t) { t.classList.remove('active'); });
          tab.classList.add('active');
          activeDetailTab = tab.getAttribute('data-detail-tab');
          renderDetailTab();
        });
      });

      // Wire detail footer buttons
      var btnDetailPrev = document.getElementById('btn-detail-prev');
      var btnDetailNext = document.getElementById('btn-detail-next');
      var btnDetailEdit = document.getElementById('btn-detail-edit');
      var btnDetailDelete = document.getElementById('btn-detail-delete');

      // Resizable list pane
      (function() {
        var handle = document.getElementById('findings-resize-handle');
        var listPane = document.querySelector('.findings-list-pane');
        if (!handle || !listPane) return;
        var startX, startWidth;

        handle.addEventListener('mousedown', function(e) {
          e.preventDefault();
          startX = e.clientX;
          startWidth = listPane.offsetWidth;
          handle.classList.add('dragging');
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';

          function onMove(e) {
            // RTL: moving mouse left = wider, moving right = narrower
            var diff = startX - e.clientX;
            var newWidth = Math.max(480, Math.min(800, startWidth + diff));
            listPane.style.width = newWidth + 'px';
          }

          function onUp() {
            handle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          }

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      })();

      if (btnDetailNext) btnDetailNext.addEventListener('click', function() {
        if (selectedFindingIndex !== null && selectedFindingIndex > 0) {
          showFindingDetail(selectedFindingIndex - 1);
        }
      });
      if (btnDetailPrev) btnDetailPrev.addEventListener('click', function() {
        if (selectedFindingIndex !== null && selectedFindingIndex < findings.length - 1) {
          showFindingDetail(selectedFindingIndex + 1);
        }
      });
      if (btnDetailEdit) btnDetailEdit.addEventListener('click', function() {
        if (selectedFindingIndex !== null) startEditFinding(selectedFindingIndex);
      });
      if (btnDetailDelete) btnDetailDelete.addEventListener('click', function() {
        if (selectedFindingIndex !== null) {
          findings.splice(selectedFindingIndex, 1);
          selectedFindingIndex = null;
          showFindingDetail(null);
          renderFindingsTable();
          showToast('ממצא נמחק', 'info');
          promptReorderAfterDelete();
        }
      });

      // ── Tab navigation ──
      function switchToTab(tabId) {
        document.querySelectorAll('.sidebar-item').forEach(function(btn) {
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
        // Update content title
        var titleMap = {
          'tab-dashboard': 'לוח בקרה',
          'tab-report-details': 'פרטי דו"ח',
          'tab-findings-list': 'ממצאים',
          'tab-finding-form': 'הוספת / עריכת ממצא',
          'tab-export': 'ייצוא דו"ח',
          'tab-cloud-manager': 'קבצי שרת',
          'tab-wizi': 'Wiz Import'
        };
        var titleEl = document.getElementById('content-title');
        if (titleEl && titleMap[tabId]) titleEl.textContent = titleMap[tabId];
        if (tabId === 'tab-dashboard') renderDashboard();
        try { localStorage.setItem('cspm_active_tab', tabId); } catch(e) {}
        updateStepper();
      }

      // Restore last active tab
      (function() {
        var saved = localStorage.getItem('cspm_active_tab');
        if (saved && document.getElementById(saved)) {
          switchToTab(saved);
        }
      })();

      document.querySelectorAll('.sidebar-item').forEach(function(btn) {
        btn.addEventListener('click', function() {
          switchToTab(btn.id);
        });
      });

      // Dashboard "show all" link
      var dashShowAll = document.getElementById('dashboard-show-all');
      if (dashShowAll) {
        dashShowAll.addEventListener('click', function(e) {
          e.preventDefault();
          switchToTab('tab-findings-list');
        });
      }

      // Add finding nav button
      var btnAddFindingNav = document.getElementById('btn-add-finding-nav');
      if (btnAddFindingNav) {
        btnAddFindingNav.addEventListener('click', function() {
          switchToTab('tab-finding-form');
        });
      }

      // Sidebar brand click → dashboard
      var sidebarBrand = document.getElementById('sidebar-brand-link');
      if (sidebarBrand) {
        sidebarBrand.addEventListener('click', function() {
          switchToTab('tab-dashboard');
        });
      }

      // Render dashboard on initial load
      renderDashboard();

      // ממיר מחרוזת תאריך בפורמט DD/MM/YYYY לאובייקט Date
      function parseReportDate(str) {
        if (!str || typeof str !== 'string') return null;
        const parts = str.split(/[.\-\/]/).map(Number);
        if (parts.length !== 3) return null;
        const [day, month, year] = parts;
        if (!day || !month || !year || isNaN(day) || isNaN(month) || isNaN(year)) return null;
        if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) return null;
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
        var idx = parseInt(this.value);
        if (isNaN(idx) || idx < 0 || idx >= findingTemplates.length) return;
        var t = findingTemplates[idx];
        if (!t) return;
        
        var categoryEl = document.getElementById('f-category');
        var titleEl = document.getElementById('f-title');
        var severityEl = document.getElementById('f-severity');
        var descEl = document.getElementById('f-description');
        var impactEl = document.getElementById('f-impact');
        var recsEl = document.getElementById('f-recs');
        
        if (categoryEl) categoryEl.value = t.category || 'CSPM';
        prefillId();
        if (titleEl) titleEl.value = t.title || '';
        if (severityEl) severityEl.value = t.severity || 'medium';
        if (descEl) descEl.value = t.description || '';
        if (impactEl) impactEl.value = t.impact || '';
        if (recsEl) recsEl.value = t.recs || '';
        this.value = '';
        if (titleEl) titleEl.focus();
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

      function reorderFindingIds() {
        // Re-number IDs per category sequentially
        var counters = {};
        findings.forEach(function(f) {
          var m = (f.id || '').match(/^([A-Z]+)-\d+/);
          if (!m) return;
          var prefix = m[1];
          if (!counters[prefix]) counters[prefix] = 0;
          counters[prefix]++;
          f.id = prefix + '-' + String(counters[prefix]).padStart(3, '0');
        });
      }

      function promptReorderAfterDelete() {
        if (!findings.length) return;
        var byCategory = {};
        findings.forEach(function(f) {
          var m = (f.id || '').match(/^([A-Z]+)-(\d+)/);
          if (!m) return;
          if (!byCategory[m[1]]) byCategory[m[1]] = [];
          byCategory[m[1]].push(parseInt(m[2], 10));
        });
        var hasGap = false;
        Object.keys(byCategory).forEach(function(cat) {
          var nums = byCategory[cat].sort(function(a, b) { return a - b; });
          for (var i = 0; i < nums.length; i++) {
            if (nums[i] !== i + 1) { hasGap = true; break; }
          }
        });
        if (!hasGap) return;
        reorderFindingIds();
        renderFindingsTable();
        prefillId();
      }

      function prefillId() {
        var idField = document.getElementById('f-id');
        if (!idField) return;
        if (editingIndex === null) {
          var catEl = document.getElementById('f-category');
          var cat = catEl ? catEl.value : 'CSPM';
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

      // --- Date field: DD/MM/YYYY text input (Israel format) ---
      const dateInput = document.getElementById('report-date');

      function getTodayDDMMYYYY() {
        var d = new Date();
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var yyyy = d.getFullYear();
        return dd + '/' + mm + '/' + yyyy;
      }

      function getDateAsDDMMYYYY() {
        if (!dateInput) return '';
        return (dateInput.value || '').trim();
      }

      function setDateFromDDMMYYYY(str) {
        if (!dateInput) return;
        if (!str || typeof str !== 'string') { dateInput.value = ''; return; }
        // Accept DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY and normalize to DD/MM/YYYY
        var parts = str.split(/[.\-\/]/);
        if (parts.length !== 3) { dateInput.value = ''; return; }
        var d = parts[0], m = parts[1], y = parts[2];
        if (!d || !m || !y) { dateInput.value = ''; return; }
        dateInput.value = d.padStart(2, '0') + '/' + m.padStart(2, '0') + '/' + y;
      }

      // Today buttons
      document.getElementById('btn-date-today').addEventListener('click', function() {
        dateInput.value = getTodayDDMMYYYY();
      });

      // ── Range date picker sync (DD/MM/YYYY text inputs) ──
      var rangeFromInput = document.getElementById('report-range-from');
      var rangeToInput = document.getElementById('report-range-to');
      var rangeHidden = document.getElementById('report-range');

      function normalizeDateInput(input) {
        // Auto-format: if user types 8 digits, format as DD/MM/YYYY
        var raw = (input.value || '').replace(/[^\d\/]/g, '');
        var digits = raw.replace(/\D/g, '');
        if (digits.length === 8 && raw.indexOf('/') === -1) {
          input.value = digits.substring(0, 2) + '/' + digits.substring(2, 4) + '/' + digits.substring(4, 8);
        }
      }

      function syncRangeFromPickers() {
        var from = (rangeFromInput.value || '').trim();
        var to = (rangeToInput.value || '').trim();
        if (from && to) {
          rangeHidden.value = from + ' - ' + to;
        } else if (from) {
          rangeHidden.value = from;
        } else if (to) {
          rangeHidden.value = to;
        } else {
          rangeHidden.value = '';
        }
      }

      function syncPickersFromRange(rangeStr) {
        if (!rangeStr) {
          rangeFromInput.value = '';
          rangeToInput.value = '';
          return;
        }
        var dashIdx = rangeStr.indexOf(' - ');
        if (dashIdx >= 0) {
          rangeFromInput.value = rangeStr.substring(0, dashIdx).trim();
          rangeToInput.value = rangeStr.substring(dashIdx + 3).trim();
        } else {
          rangeFromInput.value = rangeStr.trim();
          rangeToInput.value = '';
        }
      }

      rangeFromInput.addEventListener('change', function() {
        normalizeDateInput(rangeFromInput);
        syncRangeFromPickers();
      });

      rangeToInput.addEventListener('change', function() {
        normalizeDateInput(rangeToInput);
        syncRangeFromPickers();
      });

      document.getElementById('btn-range-today').addEventListener('click', function() {
        var today = getTodayDDMMYYYY();
        if (!rangeFromInput.value) {
          rangeFromInput.value = today;
        }
        rangeToInput.value = today;
        syncRangeFromPickers();
      });

      // ── Calendar picker buttons (🗓) ──
      // Map: hidden date input → visible text input
      var pickerTargetMap = {
        'report-range-from-picker': 'report-range-from',
        'report-range-to-picker': 'report-range-to',
        'report-date-picker': 'report-date'
      };

      function isoToDDMMYYYY(iso) {
        if (!iso) return '';
        var p = iso.split('-');
        if (p.length !== 3) return '';
        return p[2] + '/' + p[1] + '/' + p[0];
      }

      function ddmmyyyyToISO(str) {
        if (!str) return '';
        var p = str.split(/[.\-\/]/);
        if (p.length !== 3) return '';
        return p[2] + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0');
      }

      // Wire all 🗓 buttons
      document.querySelectorAll('.date-picker-btn').forEach(function(btn) {
        var pickerId = btn.getAttribute('data-picker');
        var picker = document.getElementById(pickerId);
        if (!picker) return;

        btn.addEventListener('click', function() {
          // Pre-fill picker from current text value
          var targetId = pickerTargetMap[pickerId];
          var textInput = targetId ? document.getElementById(targetId) : null;
          if (textInput && textInput.value) {
            var iso = ddmmyyyyToISO(textInput.value);
            if (iso) picker.value = iso;
          }
          picker.showPicker();
        });

        picker.addEventListener('change', function() {
          var targetId = pickerTargetMap[pickerId];
          var textInput = targetId ? document.getElementById(targetId) : null;
          if (textInput && picker.value) {
            textInput.value = isoToDDMMYYYY(picker.value);
            // Trigger sync for range fields
            if (targetId === 'report-range-from' || targetId === 'report-range-to') {
              syncRangeFromPickers();
            }
          }
        });
      });

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
          styledConfirm('למחוק ממצא ' + (findings[kbSelectedIdx].id || '') + '?', {
            icon: '🗑️', title: 'מחיקת ממצא', confirmText: 'מחק', cancelText: 'ביטול', danger: true
          }).then(function(yes) {
            if (yes) {
              findings.splice(kbSelectedIdx, 1);
              if (kbSelectedIdx >= findings.length) kbSelectedIdx = findings.length - 1;
              renderFindingsTable();
              highlightFindingRow(kbSelectedIdx);
              promptReorderAfterDelete();
            }
          });
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
          findings: findings,  // JSON.stringify יעשה deep copy
          // Save in-progress form draft so refresh doesn't lose work
          formDraft: {
            editingIndex: editingIndex,
            id:          document.getElementById('f-id').value,
            title:       document.getElementById('f-title').value,
            severity:    document.getElementById('f-severity').value,
            category:    document.getElementById('f-category').value,
            description: document.getElementById('f-description').value,
            impact:      document.getElementById('f-impact').value,
            technical:   document.getElementById('f-technical').value,
            policies:    document.getElementById('f-policies').value,
            recs:        document.getElementById('f-recs').value,
            owner:       document.getElementById('f-owner').value,
            prioritySelect: prioritySelect.value,
            priorityCustom: priorityCustom.value,
            evidence:    pendingEvidenceList.slice()
          }
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
        syncPickersFromRange(m.range || '');
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
            owner: f.owner || '',
            evidence: Array.isArray(f.evidence) ? f.evidence : (f.evidence ? [f.evidence] : [])
          });
        });

        resetEditState();
        renderFindingsTable();

        // Restore in-progress form draft if present
        if (snapshot.formDraft) {
          const d = snapshot.formDraft;
          const hasContent = d.title || d.description || d.impact || d.technical || d.policies || d.recs;
          if (hasContent || d.editingIndex !== null) {
            document.getElementById('f-id').value = d.id || '';
            document.getElementById('f-title').value = d.title || '';
            document.getElementById('f-severity').value = d.severity || 'medium';
            document.getElementById('f-category').value = d.category || 'CSPM';
            document.getElementById('f-description').value = d.description || '';
            document.getElementById('f-impact').value = d.impact || '';
            document.getElementById('f-technical').value = d.technical || '';
            document.getElementById('f-policies').value = d.policies || '';
            document.getElementById('f-recs').value = d.recs || '';
            document.getElementById('f-owner').value = d.owner || '';
            prioritySelect.value = d.prioritySelect || '';
            priorityCustom.value = d.priorityCustom || '';
            updatePriorityCustomVisibility();

            if (Array.isArray(d.evidence) && d.evidence.length) {
              pendingEvidenceList = d.evidence.slice();
              renderEvidencePreviews();
            }

            if (d.editingIndex !== null && d.editingIndex >= 0 && d.editingIndex < findings.length) {
              editingIndex = d.editingIndex;
              addBtn.textContent = 'עדכן ממצא';
              cancelEditBtn.style.display = 'inline-block';
              editState.textContent = 'מצב: עריכת ממצא #' + (editingIndex + 1);
            }
          }
        }

        statusMsg.textContent =
          'נטען דו"ח קיים' +
          (m.reportDate ? ' (תאריך דו"ח: ' + m.reportDate + ').' : '.');
      }

      function renderFindingsTable() {
              // Update findings count badge on tab
              var findingsTab = document.getElementById('tab-findings-list');
              if (findingsTab) {
                var tabIcon = '<span class="sidebar-item-icon">◆</span> ';
                findingsTab.innerHTML = tabIcon + 'ממצאים <span class="sidebar-badge" id="step-findings-count">' + (findings.length || '') + '</span>';
              }
              var listCountEl = document.getElementById('findings-list-count');
              if (listCountEl) listCountEl.textContent = findings.length + ' ממצאים';
              updateStepper();

              var batchActions = document.getElementById('batch-actions');

              if (!findings.length) {
                tableWrapper.innerHTML = '<div class="empty-state">' +
                  '<div class="empty-state-icon">📋</div>' +
                  '<div class="empty-state-text">אין עדיין ממצאים בדו"ח</div>' +
                  '<div class="empty-state-actions">' +
                    '<button class="btn btn-primary btn-sm" onclick="document.getElementById(\'tab-finding-form\').click()">➕ הוסף ממצא ידנית</button>' +
                    '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'tab-wizi\').click()">🔍 ייבא מ-Wizi</button>' +
                    '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'btn-import-csv\').click()">📄 ייבא CSV</button>' +
                  '</div>' +
                '</div>';
                genBtn.disabled = true;
                dlBtn.disabled  = true;
                var _pdfBtn = document.getElementById('btn-render-pdf');
                if (_pdfBtn) _pdfBtn.disabled = true;
                if (batchActions) batchActions.style.display = 'none';
                renderCategoryBadges();
                return;
              }

              // Apply filters
              var searchText = (document.getElementById('findings-search').value || '').toLowerCase();
              var filterCat = document.getElementById('findings-filter-category').value;
              var filterSev = document.getElementById('findings-filter-severity').value;

              var filtered = [];
              findings.forEach(function(f, idx) {
                if (searchText && (f.title || '').toLowerCase().indexOf(searchText) < 0 && (f.id || '').toLowerCase().indexOf(searchText) < 0) return;
                if (filterCat && f.category !== filterCat) return;
                if (filterSev && f.severity !== filterSev) return;
                filtered.push({ f: f, idx: idx });
              });

              // Apply sort
              if (findingsSortState.col) {
                var sevOrder = { critical: 1, high: 2, medium: 3, low: 4, info: 5 };
                filtered.sort(function(a, b) {
                  var va, vb;
                  var col = findingsSortState.col;
                  if (col === 'id') { va = a.f.id || ''; vb = b.f.id || ''; }
                  else if (col === 'category') { va = a.f.category || ''; vb = b.f.category || ''; }
                  else if (col === 'title') { va = (a.f.title || '').toLowerCase(); vb = (b.f.title || '').toLowerCase(); }
                  else if (col === 'severity') { va = sevOrder[a.f.severity] || 9; vb = sevOrder[b.f.severity] || 9; }
                  else if (col === 'owner') { va = (a.f.owner || '').toLowerCase(); vb = (b.f.owner || '').toLowerCase(); }
                  else { va = ''; vb = ''; }
                  if (va < vb) return findingsSortState.dir === 'asc' ? -1 : 1;
                  if (va > vb) return findingsSortState.dir === 'asc' ? 1 : -1;
                  return 0;
                });
              }

              var filterNote = filtered.length < findings.length ? ' (מציג ' + filtered.length + ' מתוך ' + findings.length + ')' : '';

              // Pagination
              var totalFiltered = filtered.length;
              var fTotalPages = Math.ceil(totalFiltered / findingsPageState.pageSize);
              if (findingsPageState.page >= fTotalPages && fTotalPages > 0) findingsPageState.page = fTotalPages - 1;
              var fStart = findingsPageState.page * findingsPageState.pageSize;
              var fEnd = Math.min(fStart + findingsPageState.pageSize, totalFiltered);
              var pagedFiltered = filtered.slice(fStart, fEnd);

              function fSortInd(col) {
                if (findingsSortState.col !== col) return ' <span class="sort-arrow">⇅</span>';
                return findingsSortState.dir === 'asc' ? ' <span class="sort-arrow active">↑</span>' : ' <span class="sort-arrow active">↓</span>';
              }

              let html = '';
              html += '<table><caption class="muted small-text">' + (fStart + 1) + '–' + fEnd + ' מתוך ' + totalFiltered + filterNote + '</caption><thead><tr>' +
                '<th><input type="checkbox" id="finding-check-all" class="finding-check"></th>' +
                '<th>#</th>' +
                '<th class="sortable-th" data-findings-sort="id">מזהה' + fSortInd('id') + '</th>' +
                '<th class="sortable-th" data-findings-sort="title">כותרת' + fSortInd('title') + '</th>' +
                '<th class="sortable-th" data-findings-sort="severity">חומרה' + fSortInd('severity') + '</th>' +
                '</tr></thead><tbody>';

              pagedFiltered.forEach(function(item) {
                var f = item.f;
                var idx = item.idx;
                const sev = severityMap[f.severity] || severityMap.medium;

                html += '<tr data-idx="' + idx + '">' +
                  '<td><input type="checkbox" class="finding-check finding-row-check" data-idx="' + idx + '"></td>' +
                  '<td>' + (idx + 1) + '</td>' +
                  '<td style="font-family:monospace;font-size:10px;color:var(--accent);">' + (f.id || '') + '</td>' +
                  '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (f.title || '') + '</td>' +
                  '<td><span class="severity-chip ' + sev.class + '">' + sev.text + '</span></td>' +
                  '</tr>';
              });

              html += '</tbody></table>';

              // Pagination nav below table
              if (fTotalPages > 1) {
                html += '<div class="bulk-pagination-bottom">';
                html += '<button class="btn btn-secondary btn-sm bulk-page-btn" id="findings-page-prev"' + (findingsPageState.page === 0 ? ' disabled' : '') + '>▶</button>';
                html += '<span class="bulk-pagination-page">' + (findingsPageState.page + 1) + ' / ' + fTotalPages + '</span>';
                html += '<button class="btn btn-secondary btn-sm bulk-page-btn" id="findings-page-next"' + (findingsPageState.page >= fTotalPages - 1 ? ' disabled' : '') + '>◀</button>';
                html += '</div>';
              }

              tableWrapper.innerHTML = html;
              genBtn.disabled = false;
              dlBtn.disabled  = false;
              var _pdfBtn = document.getElementById('btn-render-pdf');
              if (_pdfBtn) _pdfBtn.disabled = false;

              // Wire action buttons
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
                    showToast('ממצא נמחק', 'info');
                    promptReorderAfterDelete();
                  } else if (action === 'preview') {
                    showFindingDetail(idx);
                  } else if (action === 'edit') {
                    startEditFinding(idx);
                  } else if (action === 'dup') {
                    const orig = findings[idx];
                    const dup = JSON.parse(JSON.stringify(orig));
                    dup.id = generateNextId(dup.category || 'CSPM');
                    findings.splice(idx + 1, 0, dup);
                    renderFindingsTable();
                    showToast('שוכפל ' + orig.id + ' → ' + dup.id, 'success');
                  }
                });
              });

              // Wire row click to show detail
              tableWrapper.querySelectorAll('tr[data-idx]').forEach(function(row) {
                row.addEventListener('click', function(e) {
                  if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.inline-editable')) return;
                  var idx = parseInt(row.getAttribute('data-idx'));
                  if (!isNaN(idx)) showFindingDetail(idx);
                });
              });

              // Wire inline edit (click severity chip to cycle, click title to edit)
              tableWrapper.querySelectorAll('.inline-editable').forEach(function(cell) {
                cell.addEventListener('click', function(e) {
                  var idx = parseInt(cell.getAttribute('data-idx'), 10);
                  var field = cell.getAttribute('data-field');
                  if (Number.isNaN(idx) || !findings[idx]) return;

                  if (field === 'severity') {
                    e.stopPropagation();
                    var sevOrder = ['critical', 'high', 'medium', 'low', 'info'];
                    var cur = sevOrder.indexOf(findings[idx].severity);
                    findings[idx].severity = sevOrder[(cur + 1) % sevOrder.length];
                    renderFindingsTable();
                    autoSave();
                  } else if (field === 'title' || field === 'owner') {
                    var current = field === 'title' ? (findings[idx].title || '') : (findings[idx].owner || '');
                    var input = document.createElement('input');
                    input.type = 'text';
                    input.value = current;
                    input.className = 'filter-input';
                    input.style.fontSize = '12px';
                    input.style.padding = '4px 8px';
                    input.style.width = '100%';
                    if (field === 'owner') input.placeholder = 'צוות / בעלים...';
                    cell.textContent = '';
                    cell.appendChild(input);
                    input.focus();
                    input.select();
                    function finishEdit() {
                      var val = input.value.trim();
                      if (field === 'title') {
                        if (val) findings[idx].title = val;
                      } else {
                        findings[idx].owner = val;
                      }
                      renderFindingsTable();
                      autoSave();
                    }
                    input.addEventListener('blur', finishEdit);
                    input.addEventListener('keydown', function(ke) {
                      if (ke.key === 'Enter') { ke.preventDefault(); finishEdit(); }
                      if (ke.key === 'Escape') { renderFindingsTable(); }
                    });
                  }
                });
              });

              // Wire checkboxes for batch actions
              var checkAll = document.getElementById('finding-check-all');
              if (checkAll) {
                checkAll.addEventListener('change', function() {
                  var checked = this.checked;
                  tableWrapper.querySelectorAll('.finding-row-check').forEach(function(cb) { cb.checked = checked; });
                  updateBatchActions();
                });
              }
              tableWrapper.querySelectorAll('.finding-row-check').forEach(function(cb) {
                cb.addEventListener('change', updateBatchActions);
              });

              // Category badges and drag-and-drop
              renderCategoryBadges();
              setupDragAndDrop();

              // Wire sortable headers for findings table
              tableWrapper.querySelectorAll('.sortable-th[data-findings-sort]').forEach(function(th) {
                th.addEventListener('click', function() {
                  var col = th.getAttribute('data-findings-sort');
                  if (findingsSortState.col === col) {
                    findingsSortState.dir = findingsSortState.dir === 'asc' ? 'desc' : 'asc';
                  } else {
                    findingsSortState.col = col;
                    findingsSortState.dir = 'asc';
                  }
                  findingsPageState.page = 0;
                  renderFindingsTable();
                });
              });

              // Wire pagination
              var fpPrev = document.getElementById('findings-page-prev');
              var fpNext = document.getElementById('findings-page-next');
              if (fpPrev) fpPrev.addEventListener('click', function() { findingsPageState.page--; renderFindingsTable(); });
              if (fpNext) fpNext.addEventListener('click', function() { findingsPageState.page++; renderFindingsTable(); });
            }

      // ── Batch actions ──
      function getSelectedFindingIndices() {
        var indices = [];
        tableWrapper.querySelectorAll('.finding-row-check:checked').forEach(function(cb) {
          indices.push(parseInt(cb.getAttribute('data-idx'), 10));
        });
        return indices;
      }

      function updateBatchActions() {
        var selected = getSelectedFindingIndices();
        var batchActions = document.getElementById('batch-actions');
        var batchCount = document.getElementById('batch-count');
        var batchCountInline = document.getElementById('batch-count-inline');
        if (selected.length > 0) {
          batchActions.style.display = '';
          batchCount.textContent = selected.length + ' ממצאים נבחרו';
          if (batchCountInline) {
            batchCountInline.textContent = selected.length + ' נבחרו';
            batchCountInline.style.display = 'inline-block';
          }
        } else {
          batchActions.style.display = 'none';
          if (batchCountInline) {
            batchCountInline.textContent = '';
            batchCountInline.style.display = 'none';
          }
        }
      }

      // Batch severity change
      document.getElementById('batch-severity').addEventListener('change', function() {
        var newSev = this.value;
        if (!newSev) return;
        var indices = getSelectedFindingIndices();
        indices.forEach(function(idx) { if (findings[idx]) findings[idx].severity = newSev; });
        this.value = '';
        renderFindingsTable();
        autoSave();
        showToast('חומרה עודכנה ל-' + indices.length + ' ממצאים', 'success');
      });

      // Batch priority change
      var batchPriorityEl = document.getElementById('batch-priority');
      if (batchPriorityEl) {
        batchPriorityEl.addEventListener('change', function() {
          var newPri = this.value;
          if (!newPri) return;
          var indices = getSelectedFindingIndices();
          indices.forEach(function(idx) { if (findings[idx]) findings[idx].priority = newPri; });
          this.value = '';
          renderFindingsTable();
          autoSave();
          showToast('עדיפות עודכנה ל-' + indices.length + ' ממצאים', 'success');
        });
      }

      // Batch owner change
      (function() {
        var batchOwnerInput = document.getElementById('batch-owner');
        if (!batchOwnerInput) return;
        batchOwnerInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            var newOwner = this.value.trim();
            if (!newOwner) return;
            var indices = getSelectedFindingIndices();
            if (!indices.length) return;
            indices.forEach(function(idx) { if (findings[idx]) findings[idx].owner = newOwner; });
            this.value = '';
            renderFindingsTable();
            autoSave();
            showToast('בעלים עודכן ל-' + indices.length + ' ממצאים', 'success');
          }
        });
      })();

      // Batch delete
      document.getElementById('btn-batch-delete').addEventListener('click', function() {
        var indices = getSelectedFindingIndices().sort(function(a, b) { return b - a; });
        if (!indices.length) return;
        styledConfirm('למחוק ' + indices.length + ' ממצאים?', {
          icon: '🗑️', title: 'מחיקת ממצאים', confirmText: 'מחק', cancelText: 'ביטול', danger: true
        }).then(function(yes) {
          if (!yes) return;
          indices.forEach(function(idx) { findings.splice(idx, 1); });
          editingIndex = null;
          renderFindingsTable();
          autoSave();
          showToast(indices.length + ' ממצאים נמחקו', 'info');
          promptReorderAfterDelete();
        });
      });

      // Batch AI enrich selected findings
      document.getElementById('btn-batch-ai-enrich').addEventListener('click', function() {
        var indices = getSelectedFindingIndices();
        if (!indices.length) {
          showToast('לא נבחרו ממצאים', 'warning');
          return;
        }
        var selected = indices.map(function(idx) { return findings[idx]; }).filter(function(f) {
          if (!f.recs || !f.recs.length) return false;
          if (f.recs[0] && f.recs[0].indexOf('🤖') === 0) return false;
          if (f.recs.length === 1 && f.recs[0].indexOf('לטפל בממצא') === 0) return false;
          return true;
        });
        if (!selected.length) {
          showToast('כל הממצאים הנבחרים כבר כוללים סיכום AI', 'info');
          return;
        }
        enrichFindingsWithAiSummaries(selected);
      });

      // Findings filter listeners
      document.getElementById('findings-search').addEventListener('input', renderFindingsTable);
      document.getElementById('findings-filter-category').addEventListener('change', renderFindingsTable);
      document.getElementById('findings-filter-severity').addEventListener('change', renderFindingsTable);

      // ── Category count badges ──
      function renderCategoryBadges() {
        var badgesEl = document.getElementById('category-badges');
        if (!badgesEl) return;
        if (!findings.length) { badgesEl.innerHTML = ''; return; }
        var counts = {};
        findings.forEach(function(f) {
          var cat = f.category || 'CSPM';
          counts[cat] = (counts[cat] || 0) + 1;
        });
        var filterCat = document.getElementById('findings-filter-category');
        var html = '<span class="cat-badge' + (!filterCat.value ? ' active' : '') + '" data-cat="">הכל <span class="cat-count">' + findings.length + '</span></span>';
        Object.keys(counts).sort().forEach(function(cat) {
          var isActive = filterCat.value === cat;
          html += '<span class="cat-badge' + (isActive ? ' active' : '') + '" data-cat="' + cat + '">' + cat + ' <span class="cat-count">' + counts[cat] + '</span></span>';
        });
        badgesEl.innerHTML = html;
        badgesEl.querySelectorAll('.cat-badge').forEach(function(badge) {
          badge.addEventListener('click', function() {
            filterCat.value = badge.getAttribute('data-cat');
            renderFindingsTable();
          });
        });
      }

      // ── Finding preview panel ──
      var previewPanel = document.getElementById('finding-preview-panel');
      var previewPanelBody = document.getElementById('preview-panel-body');
      var previewPanelTitle = document.getElementById('preview-panel-title');
      var previewPanelEditBtn = document.getElementById('preview-panel-edit');
      var previewFindingIdx = null;

      document.getElementById('preview-panel-close').addEventListener('click', function() {
        previewPanel.style.display = 'none';
      });

      previewPanelEditBtn.addEventListener('click', function() {
        previewPanel.style.display = 'none';
        if (previewFindingIdx !== null) startEditFinding(previewFindingIdx);
      });

      function showFindingPreview(idx) {
        var f = findings[idx];
        if (!f) return;
        previewFindingIdx = idx;
        var sev = severityMap[f.severity] || severityMap.medium;
        previewPanelTitle.textContent = f.id + ' — ' + (f.title || '');

        var fields = [
          { label: 'מזהה', value: f.id },
          { label: 'קטגוריה', value: f.category || 'CSPM' },
          { label: 'כותרת', value: f.title },
          { label: 'חומרה', value: sev.text, html: '<span class="severity-chip ' + sev.class + '">' + sev.text + '</span>' },
          { label: 'תיאור', value: Array.isArray(f.description) ? f.description.join('\n') : f.description },
          { label: 'השפעה / סיכון', value: Array.isArray(f.impact) ? f.impact.join('\n') : f.impact },
          { label: 'פרטים טכניים', value: Array.isArray(f.technical) ? f.technical.join('\n') : f.technical },
          { label: 'מדיניות / תקנים', value: Array.isArray(f.policies) ? f.policies.join('\n') : f.policies },
          { label: 'המלצות', value: Array.isArray(f.recs) ? f.recs.join('\n') : f.recs },
          { label: 'בעלים / צוות אחראי', value: f.owner },
          { label: 'עדיפות', value: f.priority }
        ];

        var html = '';
        fields.forEach(function(field) {
          var val = field.html || (field.value || '—');
          if (!field.html && !field.value) val = '<span class="muted">—</span>';
          html += '<div class="preview-field"><div class="preview-label">' + field.label + '</div><div class="preview-value">' + val + '</div></div>';
        });

        // Evidence thumbnails
        var evidenceArr = Array.isArray(f.evidence) ? f.evidence : (f.evidence ? [f.evidence] : []);
        if (evidenceArr.length) {
          html += '<div class="preview-field"><div class="preview-label">הוכחות (' + evidenceArr.length + ')</div><div class="preview-value">';
          evidenceArr.forEach(function(e) {
            var safeUrl = sanitizeDataUrl(e);
            if (safeUrl) {
              html += '<img src="' + safeUrl + '" style="max-width:180px;max-height:120px;border-radius:6px;border:1px solid var(--border);margin:4px 4px 4px 0;">';
            }
          });
          html += '</div></div>';
        }

        previewPanelBody.innerHTML = html;
        previewPanel.style.display = '';
      }

      // Close preview on Escape
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && previewPanel.style.display !== 'none') {
          previewPanel.style.display = 'none';
        }
      });

      // ── Drag and drop reorder ──
      var dragSrcIdx = null;

      function setupDragAndDrop() {
        var rows = tableWrapper.querySelectorAll('tbody tr[data-idx]');
        rows.forEach(function(row) {
          var handle = row.querySelector('.drag-handle');
          if (!handle) return;

          handle.addEventListener('mousedown', function() {
            row.setAttribute('draggable', 'true');
          });

          row.addEventListener('dragstart', function(e) {
            dragSrcIdx = parseInt(row.getAttribute('data-idx'), 10);
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragSrcIdx);
          });

          row.addEventListener('dragend', function() {
            row.classList.remove('dragging');
            row.removeAttribute('draggable');
            rows.forEach(function(r) { r.classList.remove('drag-over-top', 'drag-over-bottom'); });
          });

          row.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            var rect = row.getBoundingClientRect();
            var midY = rect.top + rect.height / 2;
            rows.forEach(function(r) { r.classList.remove('drag-over-top', 'drag-over-bottom'); });
            if (e.clientY < midY) {
              row.classList.add('drag-over-top');
            } else {
              row.classList.add('drag-over-bottom');
            }
          });

          row.addEventListener('dragleave', function() {
            row.classList.remove('drag-over-top', 'drag-over-bottom');
          });

          row.addEventListener('drop', function(e) {
            e.preventDefault();
            var targetIdx = parseInt(row.getAttribute('data-idx'), 10);
            if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;

            var rect = row.getBoundingClientRect();
            var midY = rect.top + rect.height / 2;
            var insertBefore = e.clientY < midY;

            var item = findings.splice(dragSrcIdx, 1)[0];
            var newIdx = targetIdx;
            if (dragSrcIdx < targetIdx) newIdx--;
            if (!insertBefore) newIdx++;
            findings.splice(newIdx, 0, item);

            dragSrcIdx = null;
            renderFindingsTable();
            autoSave();
            showToast('ממצא הוזז', 'info');
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
        document.getElementById('f-owner').value = '';
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
        document.getElementById('f-description').value = Array.isArray(f.description) ? f.description.join('\n') : f.description;
        document.getElementById('f-impact').value = Array.isArray(f.impact) ? f.impact.join('\n') : f.impact;
        document.getElementById('f-technical').value = Array.isArray(f.technical) ? f.technical.join('\n') : f.technical;
        document.getElementById('f-policies').value = Array.isArray(f.policies) ? f.policies.join('\n') : f.policies;
        document.getElementById('f-recs').value = Array.isArray(f.recs) ? f.recs.join('\n') : f.recs;
        document.getElementById('f-owner').value = f.owner || '';

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
        const owner       = document.getElementById('f-owner').value.trim();

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
            owner,
            evidence
          };

          if (editingIndex === null) {
            findings.push(newFinding);
            showToast('נוסף ממצא ' + newFinding.id + '. סה״כ: ' + findings.length, 'success');
          } else {
            findings[editingIndex] = newFinding;
            showToast('עודכן ממצא ' + newFinding.id, 'success');
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

      // Sort findings dropdown
      var sortBtn = document.getElementById('btn-sort-severity');
      var sortMenu = document.getElementById('sort-menu');
      if (sortBtn && sortMenu) {
        sortBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          sortMenu.style.display = sortMenu.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', function() { sortMenu.style.display = 'none'; });
        sortMenu.querySelectorAll('[data-sort-by]').forEach(function(item) {
          item.addEventListener('click', function() {
            var col = item.getAttribute('data-sort-by');
            if (findingsSortState.col === col) {
              findingsSortState.dir = findingsSortState.dir === 'asc' ? 'desc' : 'asc';
            } else {
              findingsSortState.col = col;
              findingsSortState.dir = 'asc';
            }
            findingsPageState.page = 0;
            renderFindingsTable();
            sortMenu.style.display = 'none';
          });
        });
      }

      // Page size selector for findings table
      var findingsPageSizeStatic = document.getElementById('findings-page-size-static');
      if (findingsPageSizeStatic) {
        findingsPageSizeStatic.addEventListener('change', function() {
          findingsPageState.pageSize = parseInt(this.value);
          findingsPageState.page = 0;
          renderFindingsTable();
        });
      }

      // More actions dropdown toggle
      var moreActionsBtn = document.getElementById('btn-more-actions');
      var moreActionsMenu = document.getElementById('findings-more-menu');
      if (moreActionsBtn && moreActionsMenu) {
        moreActionsBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          moreActionsMenu.style.display = moreActionsMenu.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', function() {
          moreActionsMenu.style.display = 'none';
        });
        moreActionsMenu.addEventListener('click', function() {
          moreActionsMenu.style.display = 'none';
        });
      }

      // Menu batch delete (from ⋮ dropdown)
      var menuBatchDelete = document.getElementById('menu-batch-delete');
      if (menuBatchDelete) {
        menuBatchDelete.addEventListener('click', function() {
          var indices = getSelectedFindingIndices().sort(function(a, b) { return b - a; });
          if (!indices.length) {
            showToast('לא נבחרו ממצאים', 'warning');
            return;
          }
          styledConfirm('למחוק ' + indices.length + ' ממצאים?', {
            icon: '🗑️', title: 'מחיקת ממצאים', confirmText: 'מחק', cancelText: 'ביטול', danger: true
          }).then(function(yes) {
            if (!yes) return;
            indices.forEach(function(idx) { findings.splice(idx, 1); });
            editingIndex = null;
            renderFindingsTable();
            autoSave();
            showToast(indices.length + ' ממצאים נמחקו', 'info');
            promptReorderAfterDelete();
          });
        });
      }

      // Clear all findings
      document.getElementById('btn-clear-all-findings').addEventListener('click', function() {
        if (!findings.length) return;
        styledConfirm('למחוק את כל ' + findings.length + ' הממצאים?', {
          icon: '🗑️', title: 'מחיקת כל הממצאים', confirmText: 'מחק הכל', cancelText: 'ביטול', danger: true
        }).then(function(yes) {
          if (!yes) return;
          findings.length = 0;
          resetEditState();
          renderFindingsTable();
          prefillId();
          statusMsg.textContent = 'כל הממצאים נמחקו.';
        });
      });

      // AI enrich all findings
      document.getElementById('btn-ai-enrich-all').addEventListener('click', function() {
        if (!findings.length) {
          showToast('אין ממצאים לשיפור', 'warning');
          return;
        }
        // Filter out findings that already have an AI summary
        var toEnrich = findings.filter(function(f) {
          if (!f.recs || !f.recs.length) return false;
          if (f.recs[0] && f.recs[0].indexOf('🤖') === 0) return false;
          if (f.recs.length === 1 && f.recs[0].indexOf('לטפל בממצא') === 0) return false;
          return true;
        });
        if (!toEnrich.length) {
          showToast('כל הממצאים כבר כוללים סיכום AI', 'info');
          return;
        }
        enrichFindingsWithAiSummaries(toEnrich);
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
        if (str === null || str === undefined) return '';
        if (typeof str !== 'string') str = String(str);
        return str
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
          var catFindings = findingsByCategory[cat];
          var isFirstInCat = true;
          
          catFindings.forEach(function(f) {

          // For the first finding in each category, wrap the category header + card together
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
          // Filter out invalid data URLs for security
          evidenceArr = evidenceArr.filter(function(ev) { return isValidDataUrl(ev); });
          const evidenceHtml = evidenceArr.length
            ? `
               <div class="finding-section-title">${t.findingEvidence} (${evidenceArr.length} ${evidenceArr.length === 1 ? t.image : t.images})</div>
               <p class="muted">${t.evidenceText}</p>
               ${evidenceArr.map(function(ev, ei) { return '<div style="width:800px; max-width:100%; margin-top:8px;"><img src="' + sanitizeDataUrl(ev) + '" alt="Evidence ' + (ei+1) + '" class="evidence-img" style="width:100%; height:auto; border:1px solid #ccc; border-radius:4px; display:block; cursor:pointer;" onclick="document.getElementById(\'lightbox-overlay\').style.display=\'flex\'; document.getElementById(\'lightbox-img\').src=this.src;"></div>'; }).join('')}
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
              '<td>' + (escapeHtml(f.owner) || t.ownerPlaceholder) + '</td>' +
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
    overflow: hidden;
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
    word-break: break-word;
    max-width: 100%;
  }

  .two-column {
    display: flex;
    gap: 10px;
    margin-top: 4px;
  }

  .two-column > div {
    flex: 1;
    min-width: 0;
    background: #ffffff;
    border-radius: 4px;
    border: 1px solid #e5e7eb;
    padding: 6px;
    overflow: hidden;
    word-wrap: break-word;
    overflow-wrap: break-word;
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
        try { localStorage.setItem('cspm_has_exported', '1'); } catch(e) {}
        updateStepper();
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

