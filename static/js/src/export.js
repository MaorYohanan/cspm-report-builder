      // ── ייצוא ממצאים כ-CSV ──
      document.getElementById('btn-export-csv').addEventListener('click', function() {
        if (!findings.length) {
          showToast('אין ממצאים לייצוא', 'warning');
          return;
        }

        var csvHeaders = ['id', 'title', 'severity', 'category', 'description', 'impact', 'technical', 'policies', 'recommendation', 'priority', 'owner'];

        function csvEscape(val) {
          var s = (val === null || val === undefined) ? '' : String(val);
          if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
            return '"' + s.replace(/"/g, '""') + '"';
          }
          return s;
        }

        var lines = [];
        lines.push(csvHeaders.map(csvEscape).join(','));

        findings.forEach(function(f) {
          var row = [
            f.id || '',
            f.title || '',
            f.severity || '',
            f.category || '',
            f.description || '',
            f.impact || '',
            Array.isArray(f.technical) ? f.technical.join('\n') : (f.technical || ''),
            Array.isArray(f.policies) ? f.policies.join('\n') : (f.policies || ''),
            Array.isArray(f.recs) ? f.recs.join('\n') : (f.recs || ''),
            f.priority || '',
            f.owner || ''
          ];
          lines.push(row.map(csvEscape).join(','));
        });

        var bom = '\uFEFF';
        var csvContent = bom + lines.join('\r\n');
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = buildFilename('csv');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('יוצאו ' + findings.length + ' ממצאים ל-CSV', 'success');
        statusMsg.textContent = 'יוצאו ' + findings.length + ' ממצאים לקובץ CSV.';
      });

      // ── דו"ח חדש — ניקוי הכל ──
      document.getElementById('btn-new-report').addEventListener('click', function() {
        var hasData = findings.length > 0 || 
          (document.getElementById('report-client').value || '').trim() ||
          (document.getElementById('report-env').value || '').trim();
        
        if (!hasData) { doNewReport(); return; }
        styledConfirm('האם לנקות את כל הדו"ח ולהתחיל מחדש?<br>כל הנתונים שלא נשמרו יאבדו.', {
          icon: '🗑️', title: 'דו"ח חדש', confirmText: 'נקה והתחל מחדש', cancelText: 'ביטול', danger: true
        }).then(function(yes) {
          if (yes) doNewReport();
        });
      });

      function doNewReport() {        // Clear findings
        findings.length = 0;
        resetEditState();

        // Clear all meta fields
        var metaFields = [
          'report-client', 'report-env', 'report-range', 'report-consultant',
          'report-risk', 'report-exec-summary', 'report-key-topics',
          'report-team-name', 'report-org-name', 'report-footer-text',
          'report-cover-note', 'report-version', 'report-lang'
        ];
        metaFields.forEach(function(id) {
          var el = document.getElementById(id);
          if (el) el.value = el.id === 'report-version' ? '1.0' : (el.id === 'report-lang' ? 'he' : '');
        });

        // Clear date
        var dateEl = document.getElementById('report-date');
        if (dateEl) dateEl.value = '';

        // Clear range pickers
        var rangeFrom = document.getElementById('report-range-from');
        var rangeTo = document.getElementById('report-range-to');
        if (rangeFrom) rangeFrom.value = '';
        if (rangeTo) rangeTo.value = '';

        // Reset cover image
        if (typeof defaultCoverImageDataUrl !== 'undefined') {
          coverImageDataUrl = defaultCoverImageDataUrl;
        }
        var coverPreview = document.getElementById('cover-image-preview');
        if (coverPreview) coverPreview.innerHTML = '';
        var coverInput = document.getElementById('report-cover-image');
        if (coverInput) coverInput.value = '';

        // Clear localStorage auto-save
        try { localStorage.removeItem('cspm_report_autosave'); } catch(e) {}

        renderFindingsTable();
        prefillId();
        updateStepper();

        // Clear bulk import state
        var bulkSubInput = document.getElementById('bulk-import-sub');
        if (bulkSubInput) bulkSubInput.value = '';
        var bulkSubId = document.getElementById('bulk-import-sub-id');
        if (bulkSubId) bulkSubId.value = '';
        var bulkProgress = document.getElementById('bulk-import-progress');
        if (bulkProgress) bulkProgress.innerHTML = '';
        var bulkResults = document.getElementById('bulk-import-results');
        if (bulkResults) bulkResults.innerHTML = '';
        var bulkActions = document.getElementById('bulk-import-actions');
        if (bulkActions) bulkActions.style.display = 'none';
        bulkImportResults = {};
        bulkImportRunning = false;

        switchToTab('tab-report-details');
        showToast('הדו"ח נוקה — מוכן להתחלה חדשה', 'success');
        statusMsg.textContent = 'דו"ח חדש — מוכן להתחלה.';
      }

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
                  owner: '',
                  evidence: []
                });
                count++;
              }
            } else {
              // --- Generic CSV format ---
              var colId = headers.findIndex(function(h) { return h === 'id' || h === 'finding id' || h === 'מזהה'; });
              var colTitle = headers.findIndex(function(h) { return h === 'title' || h === 'name' || h === 'כותרת' || h === 'issue'; });
              var colSev = headers.findIndex(function(h) { return h === 'severity' || h === 'חומרה' || h === 'risk'; });
              var colCat = headers.findIndex(function(h) { return h === 'category' || h === 'קטגוריה'; });
              var colDesc = headers.findIndex(function(h) { return h === 'description' || h === 'תיאור' || h === 'details'; });
              var colImpact = headers.findIndex(function(h) { return h === 'impact' || h === 'השפעה'; });
              var colTech = headers.findIndex(function(h) { return h === 'technical' || h === 'פרטים טכניים'; });
              var colPolicies = headers.findIndex(function(h) { return h === 'policies' || h === 'מדיניות'; });
              var colRec = headers.findIndex(function(h) { return h === 'recommendation' || h === 'remediation' || h === 'המלצה' || h === 'fix'; });
              var colPriority = headers.findIndex(function(h) { return h === 'priority' || h === 'עדיפות'; });
              var colOwner = headers.findIndex(function(h) { return h === 'owner' || h === 'בעלים' || h === 'team' || h === 'צוות'; });

              if (colTitle === -1) {
                alert('לא נמצאה עמודת כותרת (title/name/issue) ב-CSV.');
                return;
              }

              for (var i = 1; i < rows.length; i++) {
                var r = rows[i];
                var title = r[colTitle] || '';
                if (!title) continue;
                var cat = (colCat >= 0 && r[colCat]) ? r[colCat].trim().toUpperCase() : 'CSPM';
                if (!categoryMap[cat]) cat = 'CSPM';
                findings.push({
                  id: (colId >= 0 && r[colId]) ? r[colId] : generateNextId(cat),
                  title: title,
                  severity: colSev >= 0 ? mapSeverity(r[colSev]) : 'medium',
                  category: cat,
                  description: colDesc >= 0 ? (r[colDesc] || '') : '',
                  impact: colImpact >= 0 ? (r[colImpact] || '') : '',
                  technical: colTech >= 0 ? splitLines(r[colTech] || '') : [],
                  policies: colPolicies >= 0 ? splitLines(r[colPolicies] || '') : [],
                  recs: colRec >= 0 ? splitLines(r[colRec] || '') : [],
                  priority: colPriority >= 0 ? (r[colPriority] || '') : '',
                  owner: colOwner >= 0 ? (r[colOwner] || '') : '',
                  evidence: []
                });
                count++;
              }
            }

            renderFindingsTable();
            prefillId();
            switchToTab('tab-findings-list');
            statusMsg.textContent = 'יובאו ' + count + ' ממצאים מ-CSV' + (isWiz ? ' (Wiz format)' : '') + '. סה״כ: ' + findings.length;
            showToast('יובאו ' + count + ' ממצאים מ-CSV', 'success');
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
      let autoSaveTimeout = null;
      let autoSaveInProgress = false;

      function showAutosaveStatus(text, saving) {
        autosaveIndicator.textContent = text;
        autosaveIndicator.classList.toggle('saving', !!saving);
        autosaveIndicator.classList.add('visible');
      }

      autosaveIndicator.style.cursor = 'pointer';
      autosaveIndicator.title = 'לחץ לשמירה ידנית';
      autosaveIndicator.addEventListener('click', function() {
        autoSaveImmediate();
      });

      function autoSaveImmediate() {
        if (autoSaveInProgress) return; // Prevent overlapping saves
        
        autoSaveInProgress = true;
        showAutosaveStatus('💾 שומר...', true);
        
        try {
          const snapshot = buildSnapshot();
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
          var now = new Date();
          var hh = String(now.getHours()).padStart(2, '0');
          var mm = String(now.getMinutes()).padStart(2, '0');
          var ss = String(now.getSeconds()).padStart(2, '0');
          showAutosaveStatus('💾 נשמר ' + hh + ':' + mm + ':' + ss, false);
        } catch (e) {
          if (e.name === 'QuotaExceededError') {
            showAutosaveStatus('⚠️ אחסון מלא - ייצא JSON', false);
            showToast('שגיאה: אחסון מלא. ייצא את הדו"ח כ-JSON.', 'error');
          }
          // Ignore other errors (private mode, etc.)
        } finally {
          autoSaveInProgress = false;
        }
      }

      function autoSave() {
        // Debounce: cancel pending save and schedule new one
        if (autoSaveTimeout) {
          clearTimeout(autoSaveTimeout);
        }
        autoSaveTimeout = setTimeout(autoSaveImmediate, 500);
      }

      function autoRestore() {
        try {
          const raw = localStorage.getItem(AUTOSAVE_KEY);
          if (!raw) return false;
          const snapshot = JSON.parse(raw);
          const hasDraft = snapshot && snapshot.formDraft &&
            (snapshot.formDraft.title || snapshot.formDraft.description || snapshot.formDraft.editingIndex !== null);
          if (snapshot && snapshot.meta && (
            (Array.isArray(snapshot.findings) && snapshot.findings.length > 0) || hasDraft
          )) {
            applySnapshot(snapshot);
            statusMsg.textContent = 'שוחזר אוטומטית מהשמירה האחרונה.';
            return true;
          }
        } catch (e) { /* corrupt data — ignore */ }
        return false;
      }

      // Save every 10 seconds and on page unload
      setInterval(autoSaveImmediate, 10000);
      window.addEventListener('beforeunload', function() {
        // Clear debounce timeout and save immediately on page close
        if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
        autoSaveImmediate();
      });

      // Restore on load
      autoRestore();
      updateStepper();

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
        dateInput.value = getTodayDDMMYYYY();
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
      if (tableWrapper) {
        const origObserver = new MutationObserver(updateCloudButtons);
        origObserver.observe(tableWrapper, { childList: true });
      }

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
            showToast('PDF נוצר והורד בהצלחה', 'success');
            try { localStorage.setItem('cspm_has_exported', '1'); } catch(e) {}
            updateStepper();
            refreshOutputsList();
          } catch (e) {
            statusMsg.textContent = 'שגיאה ביצירת PDF: ' + e.message;
            showToast('שגיאה ביצירת PDF', 'error');
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
        var yes = await styledConfirm('למחוק תצורה זו?', {
          icon: '🗑️', title: 'מחיקת תצורה', confirmText: 'מחק', cancelText: 'ביטול', danger: true
        });
        if (!yes) return;
        try {
          await fetch('/api/delete-state/' + id, { method: 'DELETE' });
          refreshStatesList();
        } catch (e) {
          statusMsg.textContent = 'שגיאה במחיקה.';
        }
      };

      window.cloudDeleteOutput = async function(filename) {
        var yes = await styledConfirm('למחוק קובץ זה?', {
          icon: '🗑️', title: 'מחיקת קובץ', confirmText: 'מחק', cancelText: 'ביטול', danger: true
        });
        if (!yes) return;
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

      // Wizi sub-tab switching
      document.querySelectorAll('.wizi-sub-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
          document.querySelectorAll('.wizi-sub-tab').forEach(function(t) { t.classList.remove('active'); });
          document.querySelectorAll('.wizi-sub-panel').forEach(function(p) { p.classList.remove('active'); });
          tab.classList.add('active');
          var panelId = tab.getAttribute('data-wizi-panel');
          var panel = document.getElementById(panelId);
          if (panel) panel.classList.add('active');
        });
      });

