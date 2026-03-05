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

      // --- Auto-generate finding ID ---
      function generateNextId() {
        let max = 0;
        findings.forEach(f => {
          const m = (f.id || '').match(/CSPM-(\d+)/);
          if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        return 'CSPM-' + String(max + 1).padStart(3, '0');
      }

      function prefillId() {
        const idField = document.getElementById('f-id');
        if (editingIndex === null) {
          idField.value = generateNextId();
          idField.readOnly = true;
        }
      }

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
          const findingForm = document.getElementById('section-finding-form').parentElement;
          if (findingForm && findingForm.contains(active)) {
            e.preventDefault();
            handleAddOrUpdateFinding();
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
            coverNote:   document.getElementById('report-cover-note').value
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

        // ניקוי רשימת הממצאים והזנתם מחדש
        findings.length = 0;

        snapshot.findings.forEach(f => {
          findings.push({
            id:          f.id          || '',
            title:       f.title       || '',
            severity:    f.severity    || 'medium',
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
            evidence: f.evidence || null   // Data URL אם היה
          });
        });

        resetEditState();
        renderFindingsTable();

        statusMsg.textContent =
          'נטען דו"ח קיים' +
          (m.reportDate ? ' (תאריך דו"ח: ' + m.reportDate + ').' : '.');
      }

      function renderFindingsTable() {
        if (!findings.length) {
          tableWrapper.innerHTML = '<p class="muted">אין עדיין ממצאים.</p>';
          genBtn.disabled = true;
          dlBtn.disabled  = true;
          return;
        }

        let html = '<table><caption class="muted small-text">רשימת ממצאים שנוספו לדו"ח</caption><thead><tr>' +
          '<th>#</th><th>מזהה</th><th>כותרת</th><th>חומרה</th><th>מדיניות / תקנים</th><th>הוכחה</th><th>פעולות</th>' +
          '</tr></thead><tbody>';

        findings.forEach((f, idx) => {
          const sev = severityMap[f.severity] || severityMap.medium;
          const policiesInline = f.policies.length
            ? f.policies.map(p => '<span class="tag-inline">' + p + '</span>').join(' ')
            : '<span class="muted">—</span>';

          const evidenceText = f.evidence ? '✓ יש תמונה' : '<span class="muted">אין</span>';

          html += '<tr>' +
            '<td>' + (idx + 1) + '</td>' +
            '<td>' + (f.id || '') + '</td>' +
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
              dup.id = generateNextId();
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
        if (f.evidence) {
          showEvidencePreview(f.evidence);
        } else {
          clearEvidencePreview();
        }

        addBtn.textContent = 'עדכן ממצא';
        cancelEditBtn.style.display = 'inline-block';
        editState.textContent = 'מצב: עריכת ממצא #' + (idx + 1);

        // Scroll to form and focus title
        var formDetails = document.getElementById('section-finding-form').closest('details');
        if (formDetails && !formDetails.open) formDetails.open = true;
        document.getElementById('section-finding-form').scrollIntoView({ behavior: 'smooth' });
        setTimeout(() => document.getElementById('f-title').focus(), 300);
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

      // --- Evidence: drag-drop, paste, preview ---
      let pendingEvidenceDataUrl = null;
      const dropZone = document.getElementById('evidence-drop-zone');
      const evidencePreview = document.getElementById('evidence-preview');

      function showEvidencePreview(dataUrl) {
        pendingEvidenceDataUrl = dataUrl;
        evidencePreview.innerHTML =
          '<img src="' + dataUrl + '" alt="תצוגה מקדימה">' +
          '<span class="clear-btn" id="clear-evidence">✕ הסר</span>';
        document.getElementById('clear-evidence').addEventListener('click', clearEvidencePreview);
      }

      function clearEvidencePreview() {
        pendingEvidenceDataUrl = null;
        evidencePreview.innerHTML = '';
        evidenceInput.value = '';
      }

      function handleEvidenceFile(file) {
        if (!file || !file.type.startsWith('image/')) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
          resizeImage(ev.target.result).then(showEvidencePreview);
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

        const readerNeeded = pendingEvidenceDataUrl;

        const applyFinding = (evidenceDataUrl) => {
          let evidence = evidenceDataUrl || null;

          if (!evidence && editingIndex !== null) {
            evidence = findings[editingIndex].evidence || null;
          }

          const newFinding = {
            id,
            title,
            severity,
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

        applyFinding(pendingEvidenceDataUrl);
      }

      addBtn.addEventListener('click', handleAddOrUpdateFinding);

      cancelEditBtn.addEventListener('click', function() {
        resetEditState();
      });

      // Sort findings by severity (critical first)
      document.getElementById('btn-sort-severity').addEventListener('click', function() {
        var sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        findings.sort(function(a, b) {
          return (sevOrder[a.severity] || 9) - (sevOrder[b.severity] || 9);
        });
        if (editingIndex !== null) resetEditState();
        renderFindingsTable();
        statusMsg.textContent = 'ממצאים מוינו לפי חומרה.';
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

      function countSeverity(key) {
        return findings.filter(f => f.severity === key).length;
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

      function buildSeverityChartSvg(counts) {
        // counts = { critical: N, high: N, medium: N, low: N, info: N }
        var colors = { critical: '#b91c1c', high: '#ef4444', medium: '#f97316', low: '#22c55e', info: '#6b7280' };
        var labels = { critical: 'קריטי', high: 'גבוה', medium: 'בינוני', low: 'נמוך', info: 'מידע' };
        var total = 0;
        var slices = [];
        ['critical', 'high', 'medium', 'low', 'info'].forEach(function(k) {
          var n = counts[k] || 0;
          if (n > 0) slices.push({ key: k, count: n, color: colors[k], label: labels[k] });
          total += n;
        });
        if (total === 0) return '';

        // Build SVG pie chart
        var cx = 100, cy = 100, r = 80;
        var angle = -Math.PI / 2; // start at top
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

        // Legend
        var legend = '';
        var ly = 10;
        slices.forEach(function(s) {
          legend += '<rect x="210" y="' + ly + '" width="12" height="12" rx="2" fill="' + s.color + '"/>';
          legend += '<text x="226" y="' + (ly + 11) + '" font-size="12" fill="#333" font-family="Arial">' +
            s.label + ' (' + s.count + ')' + '</text>';
          ly += 22;
        });

        return '<div style="text-align:center;margin:10px 0;">' +
          '<svg width="340" height="200" viewBox="0 0 340 200" xmlns="http://www.w3.org/2000/svg">' +
          paths + legend + '</svg></div>';
      }

      function buildReportHtml() {
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
        const coverNote   = document.getElementById('report-cover-note').value.trim() || 'מסמך זה מסכם את ממצאי ה-CSPM כפי שאותרו, כולל ניתוח סיכונים והמלצות לטיפול.';

        const critCount  = countSeverity('critical');
        const highCount  = countSeverity('high');
        const medCount   = countSeverity('medium');
        const lowCount   = countSeverity('low');
        const infoCount  = countSeverity('info');

        const findingsCardsHtml = findings.map(f => {
          const sev = severityMap[f.severity] || severityMap.medium;
          const anchorId = makeFindingAnchorId(f.id);

          const technicalHtml = f.technical.length
            ? `<ul>${f.technical.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
            : `<p class="muted">לא סופקו פרטים טכניים.</p>`;

          const policyHtml = f.policies.length
            ? `<ul class="tag-list">${f.policies.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
            : `<p class="muted">לא סומנו מדיניות / תקנים.</p>`;

          const recHtml = f.recs.length
            ? `<ul>${f.recs.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
            : `<p class="muted">לא סופקו המלצות.</p>`;

          const priorityHtml = f.priority
            ? `<p><strong>${escapeHtml(f.priority)}</strong></p>`
            : `<p class="muted">לא הוגדרה עדיפות טיפול.</p>`;

          const evidenceHtml = f.evidence
            ? `
               <div class="finding-section-title">הוכחת ממצא (תמונה)</div>
               <p class="muted">צילום מסך / הוכחה טכנית כפי שצורפה בבדיקה. לחץ על התמונה להגדלה.</p>
               <div style="width:800px; max-width:100%; margin-top:4px;">
                 <img src="${f.evidence}" alt="הוכחת ממצא" class="evidence-img"
                      style="width:100%; height:auto; border:1px solid #ccc; border-radius:4px; display:block; cursor:pointer;"
                      onclick="document.getElementById('lightbox-overlay').style.display='flex'; document.getElementById('lightbox-img').src=this.src;">
               </div>
              `
            : '';

          return `
          <div class="finding-wrap">
          <div class="finding-card" id="${anchorId}">
            <div class="finding-header">
              <div>
                <div class="finding-title">${escapeHtml(f.title)}</div>
                <div class="finding-id">מזהה ממצא: ${escapeHtml(f.id)}</div>
              </div>
              <div class="severity-badge ${sev.class}">${sev.text}</div>
            </div>

            <div class="finding-section-title">תיאור הממצא</div>
            <p>${escapeHtml(f.description)}</p>

            <div class="finding-section-title">השפעה עסקית / סיכון</div>
            <p>${escapeHtml(f.impact)}</p>

            <div class="two-column">
              <div>
                <div class="finding-section-title">פרטים טכניים</div>
                ${technicalHtml}
              </div>
              <div>
                <div class="finding-section-title">חוקים / מדיניות רלוונטיים</div>
                ${policyHtml}
              </div>
            </div>

            <div class="finding-section-title">המלצות</div>
            ${recHtml}

            <div class="finding-section-title">עדיפות טיפול</div>
            ${priorityHtml}
            ${evidenceHtml}
          </div>
          </div>`;
        }).join('\n');

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
              '<td>' + sev.text + '</td>' +
              '<td>Owner / Team</td>' +
              '<td>' + dueDate + '</td>' +
              '<td>פתוח</td>' +
            '</tr>'
          );
        }).join('\n');

        const appendixHtml = findings.map(f => {
          const firstPolicy = f.policies[0] || '';
          return `
            <tr>
              <td>${escapeHtml(f.id)}</td>
              <td>${firstPolicy ? escapeHtml(firstPolicy) : '—'}</td>
              <td>${firstPolicy ? 'ISO / NIST (לפי הצורך)' : '—'}</td>
              <td></td>
            </tr>`;
        }).join('\n');

        const execSummaryHtml = execSummary
          ? `<p>${escapeHtml(execSummary)}</p>`
          : `<p>הדו"ח מסכם את מצב ה-POSTURE בסביבת הענן שנבדקה, לרבות ממצאים קריטיים, תרחישי סיכון מרכזיים והערכת סיכון כללית.</p>`;

        const keyTopicsHtml = linesToListHtml(keyTopics) ||
          `<p class="muted">ניתן להרחיב נושאי מפתח כגון IAM, חשיפה לאינטרנט, הצפנה, רשתות, Kubernetes ועוד.</p>`;

        const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
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
    padding: 10mm 10mm 12mm 10mm;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.18);
    border-radius: 6px;
    border-top: 5px solid #0b3c5d;  /* פס כחול בראש כל "עמוד" לוגי */
  }

  .page-section:last-child {
    page-break-after: auto;
    margin-bottom: 0;
  }

  h1, h2, h3, h4 {
    margin-top: 18mm;
    margin-bottom: 8px;
    color: #0b3c5d;
  }

  h1 {
    font-size: 26px;
    border-right: 4px solid #15559b;
    padding-right: 6px;
    margin-bottom: 10px;
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
    align-items: flex-start;
    min-height: 220mm;
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
      padding-top: 14mm;
      break-inside: avoid;
      page-break-inside: avoid;
      
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
    <div>תאריך הדו"ח: ${escapeHtml(reportDate || 'DD/MM/YYYY')}</div>
  </div>

  <main class="report-content">

    <section class="page-section cover">
      <div class="cover-page-inner">
        <div class="cover-main-title">${escapeHtml(teamName)}</div>
        <div class="cover-subtitle">בדיקת מצב אבטחה, תצורה ועמידה במדיניות בסביבת הענן הארגונית</div>

        <div class="cover-meta">
          <p><strong>שם הלקוח:</strong> ${escapeHtml(client || '__________')}</p>
          <p><strong>סביבת בדיקה / ענן:</strong> ${escapeHtml(env || '__________')}</p>
          <p><strong>טווח הבדיקה:</strong> ${escapeHtml(range || '__________')}</p>
          <p><strong>יועץ / גורם מבצע:</strong> ${escapeHtml(consultant || '__________')}</p>
          <p><strong>תאריך דו"ח:</strong> ${escapeHtml(reportDate || '__________')}</p>
        </div>

        <div class="cover-badge">
          ${escapeHtml(coverNote)}
        </div>
      </div>
    </section>

    <section class="page-section">
      <h1>תוכן עניינים</h1>
      <p class="muted">הערה: מספרי העמודים להלן הם אינדיקטיביים ויכולים להשתנות לפי אורך הדו"ח.</p>

        <ul class="toc-list">
        <li class="toc-item">
            <span><a href="#exec-summary">1. תקציר מנהלים</a></span><span>עמוד 2</span>
        </li>
        <li class="toc-item">
            <span><a href="#scope-method">2. תחום הבדיקה ומתודולוגיה</a></span><span>עמוד 2</span>
        </li>
        <li class="toc-item">
            <span><a href="#findings-summary">3. סיכום ממצאים לפי רמת חומרה</a></span><span>עמוד 3</span>
        </li>
        <li class="toc-item">
            <span><a href="#detailed-findings">4. ממצאים עיקריים (CSPM)</a></span><span>עמוד 4</span>
        </li>
        <li class="toc-item">
            <span><a href="#recommendations">5. המלצות ותכנית טיפול</a></span><span>עמוד 5</span>
        </li>
        <li class="toc-item">
            <span><a href="#appendix-a">נספח א' – מיפוי ממצאים למדיניות / תקנים</a></span><span>עמוד 6</span>
        </li>
        </ul>

    </section>

    <section class="page-section">
      <h1 id="exec-summary">1. תקציר מנהלים</h1>
      ${execSummaryHtml}
      <p><strong>הערכת סיכון כללית:</strong> ${escapeHtml(reportRisk || 'נמוכה / בינונית / גבוהה')}.</p>

      <div class="section-divider"></div>

      <h2 id="scope-method">2. תחום הבדיקה ומתודולוגיה</h2>
      <h3>2.1 תחום בדיקה</h3>
      <p>
        הבדיקה בוצעה על גבי חשבונות הענן / מנויים / פרויקטים כפי שסוכם עם הלקוח.
        נכללו שירותי IaaS / PaaS רלוונטיים, לרבות סביבת Prod ו/או Non-Prod בהתאם להיקף שסוכם.
      </p>

      <h3>2.2 כלי בדיקה</h3>
      <p>
        הבדיקה התבססה על כלי CSPM / CNAPP של הארגון, בשילוב בדיקות ידניות והצלבת מידע
        עם מסמכי מדיניות ותצורה קיימים.
      </p>

      <h3>2.3 מתודולוגיית עבודה</h3>
      <ul>
        <li>איסוף ממצאים מהמערכת (Alerts / Issues / Misconfigurations).</li>
        <li>קיבוץ ממצאים לפי חומרה, שירות וסביבה.</li>
        <li>וולידציה של ממצאים קריטיים ואיתור False Positive.</li>
        <li>גיבוש המלצות לתיקון, הגדרת עדיפויות ותכנית טיפול.</li>
      </ul>
    </section>

    <section class="page-section">
      <h1 id="findings-summary">3. סיכום ממצאים לפי רמת חומרה</h1>
      <p>הטבלה להלן מסכמת את כמות הממצאים שנמצאו לפי רמת חומרה.</p>

      ${buildSeverityChartSvg({ critical: critCount, high: highCount, medium: medCount, low: lowCount, info: infoCount })}

      <table>
        <thead>
          <tr>
            <th>רמת חומרה</th>
            <th>מספר ממצאים</th>
            <th>הערות</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>קריטי</td>
            <td>${critCount}</td>
            <td>חשיפה ישירה, הרשאות יתר, פגיעה חמורה זמינות/סודיות.</td>
          </tr>
          <tr>
            <td>גבוה</td>
            <td>${highCount}</td>
            <td>תצורות לא מאובטחות משמעותית, סיכון מוגבר לדליפה/השבתה.</td>
          </tr>
          <tr>
            <td>בינוני</td>
            <td>${medCount}</td>
            <td>Best Practices לא מיושמים במלואם, פוטנציאל להחמרת סיכון.</td>
          </tr>
          <tr>
            <td>נמוך</td>
            <td>${lowCount}</td>
            <td>שיפורי הקשחה ותפעול שאינם דחופים.</td>
          </tr>
          <tr>
            <td>מידע</td>
            <td>${infoCount}</td>
            <td>מידע לתכנון עתידי (End of Support, המלצות לשדרוג וכד').</td>
          </tr>
        </tbody>
      </table>

      <h2>3.1 נושאי מפתח</h2>
      ${keyTopicsHtml}
    </section>

    <section class="page-section">
      <h1 id="detailed-findings">4. ממצאים עיקריים (CSPM)</h1>
      <p>
        להלן כרטיסי הממצאים שנכללים בדו"ח זה, כפי שנאספו במערכת ואושרו לאחר בדיקה ידנית.
      </p>
      ${findingsCardsHtml || '<p class="muted">לא נוספו ממצאים.</p>'}
    </section>

    <section class="page-section">
      <h1 id="recommendations">5. המלצות ותכנית טיפול</h1>
      <p>
        סעיף זה מרכז את הממצאים בטבלת עבודה, לצורך מעקב אחר סטטוס סגירה ובעלות.
      </p>

      <table>
        <thead>
          <tr>
            <th>מזהה ממצא</th>
            <th>תיאור קצר</th>
            <th>חומרה</th>
            <th>בעלים</th>
            <th>יעד סגירה</th>
            <th>סטטוס</th>
          </tr>
        </thead>
        <tbody>
          ${treatmentTableHtml || '<tr><td colspan="6">לא נוספו ממצאים.</td></tr>'}
        </tbody>
      </table>
    </section>

    <section class="page-section">
      <h1 id="appendix-a">נספח א' – מיפוי ממצאים למדיניות / תקנים</h1>
      <p>
        הנספח ממפה כל ממצא למרכיבים רלוונטיים במדיניות הארגונית ו/או תקנים חיצוניים.
      </p>

      <table>
        <thead>
          <tr>
            <th>מזהה ממצא</th>
            <th>מדיניות ארגונית / סעיף</th>
            <th>תקן / Framework</th>
            <th>הערות</th>
          </tr>
        </thead>
        <tbody>
          ${appendixHtml || '<tr><td colspan="4">לא נוספו ממצאים.</td></tr>'}
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
        // Simple CSV parser that handles quoted fields
        var lines = text.split(/\r?\n/);
        var result = [];
        for (var i = 0; i < lines.length; i++) {
          var row = [];
          var field = '';
          var inQuotes = false;
          for (var j = 0; j < lines[i].length; j++) {
            var ch = lines[i][j];
            if (inQuotes) {
              if (ch === '"' && lines[i][j + 1] === '"') { field += '"'; j++; }
              else if (ch === '"') { inQuotes = false; }
              else { field += ch; }
            } else {
              if (ch === '"') { inQuotes = true; }
              else if (ch === ',') { row.push(field.trim()); field = ''; }
              else { field += ch; }
            }
          }
          row.push(field.trim());
          if (row.some(function(c) { return c !== ''; })) result.push(row);
        }
        return result;
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

            // Map common column names
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

            var count = 0;
            for (var i = 1; i < rows.length; i++) {
              var r = rows[i];
              var title = r[colTitle] || '';
              if (!title) continue;
              findings.push({
                id: (colId >= 0 && r[colId]) ? r[colId] : generateNextId(),
                title: title,
                severity: colSev >= 0 ? mapSeverity(r[colSev]) : 'medium',
                description: colDesc >= 0 ? (r[colDesc] || '') : '',
                impact: colImpact >= 0 ? (r[colImpact] || '') : '',
                technical: [],
                policies: [],
                recs: colRec >= 0 ? splitLines(r[colRec] || '') : [],
                priority: '',
                evidence: null
              });
              count++;
            }
            renderFindingsTable();
            prefillId();
            statusMsg.textContent = 'יובאו ' + count + ' ממצאים מ-CSV. סה״כ: ' + findings.length;
          } catch (e) {
            console.error(e);
            alert('שגיאה בקריאת CSV.');
          } finally {
            importCsvInput.value = '';
          }
        };
        reader.readAsText(file, 'utf-8');
      });

      // --- Auto-save to localStorage ---
      const AUTOSAVE_KEY = 'cspm_report_autosave';

      function autoSave() {
        try {
          const snapshot = buildSnapshot();
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
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

    })();
