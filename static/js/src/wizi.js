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
      var wiziQueryType = 'issues';
      var wiziQueryTypeSelect = document.getElementById('wizi-query-type');
      var wiziStatusSelect = document.getElementById('wizi-status');

      // Status options per query type
      var wiziStatusOptions = {
        issues: [
          { value: 'OPEN', text: 'Open', selected: true },
          { value: 'IN_PROGRESS', text: 'In Progress', selected: true },
          { value: 'RESOLVED', text: 'Resolved', selected: false },
          { value: 'REJECTED', text: 'Rejected', selected: false }
        ],
        configurationFindings: [
          { value: 'PASS', text: 'Pass', selected: false },
          { value: 'FAIL', text: 'Fail', selected: true },
          { value: 'ERROR', text: 'Error', selected: false },
          { value: 'NOT_ASSESSED', text: 'Not Assessed', selected: false }
        ],
        vulnerabilityFindings: [
          { value: 'OPEN', text: 'Open', selected: true },
          { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
          { value: 'RESOLVED', text: 'Resolved', selected: false },
          { value: 'REJECTED', text: 'Rejected', selected: false }
        ],
        hostConfigurationRuleAssessments: [
          { value: 'OPEN', text: 'Open', selected: true },
          { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
          { value: 'RESOLVED', text: 'Resolved', selected: false },
          { value: 'REJECTED', text: 'Rejected', selected: false }
        ],
        dataFindingsV2: [
          { value: 'OPEN', text: 'Open', selected: true },
          { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
          { value: 'RESOLVED', text: 'Resolved', selected: false },
          { value: 'REJECTED', text: 'Rejected', selected: false }
        ],
        secretInstances: [
          { value: 'OPEN', text: 'Open', selected: true },
          { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
          { value: 'RESOLVED', text: 'Resolved', selected: false },
          { value: 'REJECTED', text: 'Rejected', selected: false }
        ],
        excessiveAccessFindings: [
          { value: 'OPEN', text: 'Open', selected: true },
          { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
          { value: 'RESOLVED', text: 'Resolved', selected: false },
          { value: 'REJECTED', text: 'Rejected', selected: false }
        ],
        networkExposures: [
          { value: 'OPEN', text: 'Open', selected: true },
          { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
          { value: 'RESOLVED', text: 'Resolved', selected: false },
          { value: 'REJECTED', text: 'Rejected', selected: false }
        ],
        inventoryFindings: [
          { value: 'OPEN', text: 'Open', selected: true },
          { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
          { value: 'RESOLVED', text: 'Resolved', selected: false },
          { value: 'REJECTED', text: 'Rejected', selected: false }
        ]
      };

      // Severity options per query type
      var wiziSeverityOptions = {
        issues: [
          { value: 'CRITICAL', text: 'Critical', selected: true },
          { value: 'HIGH', text: 'High', selected: true },
          { value: 'MEDIUM', text: 'Medium', selected: false },
          { value: 'LOW', text: 'Low', selected: false },
          { value: 'INFORMATIONAL', text: 'Informational', selected: false }
        ],
        configurationFindings: [
          { value: 'CRITICAL', text: 'Critical', selected: true },
          { value: 'HIGH', text: 'High', selected: true },
          { value: 'MEDIUM', text: 'Medium', selected: false },
          { value: 'LOW', text: 'Low', selected: false },
          { value: 'NONE', text: 'None', selected: false }
        ],
        vulnerabilityFindings: [
          { value: 'CRITICAL', text: 'Critical', selected: true },
          { value: 'HIGH', text: 'High', selected: true },
          { value: 'MEDIUM', text: 'Medium', selected: false },
          { value: 'LOW', text: 'Low', selected: false },
          { value: 'NONE', text: 'None', selected: false }
        ],
        hostConfigurationRuleAssessments: [
          { value: 'CRITICAL', text: 'Critical', selected: true },
          { value: 'HIGH', text: 'High', selected: true },
          { value: 'MEDIUM', text: 'Medium', selected: false },
          { value: 'LOW', text: 'Low', selected: false },
          { value: 'INFORMATIONAL', text: 'Informational', selected: false }
        ],
        dataFindingsV2: [
          { value: 'CRITICAL', text: 'Critical', selected: true },
          { value: 'HIGH', text: 'High', selected: true },
          { value: 'MEDIUM', text: 'Medium', selected: false },
          { value: 'LOW', text: 'Low', selected: false },
          { value: 'INFO', text: 'Info', selected: false }
        ],
        secretInstances: [
          { value: 'CRITICAL', text: 'Critical', selected: true },
          { value: 'HIGH', text: 'High', selected: true },
          { value: 'MEDIUM', text: 'Medium', selected: false },
          { value: 'LOW', text: 'Low', selected: false },
          { value: 'INFORMATIONAL', text: 'Informational', selected: false }
        ],
        excessiveAccessFindings: [
          { value: 'CRITICAL', text: 'Critical', selected: true },
          { value: 'HIGH', text: 'High', selected: true },
          { value: 'MEDIUM', text: 'Medium', selected: false },
          { value: 'LOW', text: 'Low', selected: false }
        ],
        networkExposures: [
          { value: 'CRITICAL', text: 'Critical', selected: true },
          { value: 'HIGH', text: 'High', selected: true },
          { value: 'MEDIUM', text: 'Medium', selected: false },
          { value: 'LOW', text: 'Low', selected: false }
        ],
        inventoryFindings: [
          { value: 'CRITICAL', text: 'Critical', selected: true },
          { value: 'HIGH', text: 'High', selected: true },
          { value: 'MEDIUM', text: 'Medium', selected: false },
          { value: 'LOW', text: 'Low', selected: false },
          { value: 'INFORMATIONAL', text: 'Informational', selected: false }
        ]
      };

      var wiziSeveritySelect = document.getElementById('wizi-severity');

      function updateWiziFilterOptions() {
        var qt = wiziQueryTypeSelect.value;
        // Update status/result
        var statusOpts = wiziStatusOptions[qt] || wiziStatusOptions.issues;
        wiziStatusSelect.innerHTML = '';
        if (statusOpts.length) {
          wiziStatusSelect.disabled = false;
          statusOpts.forEach(function(o) {
            var opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.text;
            opt.selected = o.selected;
            wiziStatusSelect.appendChild(opt);
          });
        } else {
          wiziStatusSelect.disabled = true;
          var opt = document.createElement('option');
          opt.textContent = '— לא רלוונטי —';
          wiziStatusSelect.appendChild(opt);
        }
        var statusLabel = wiziStatusSelect.previousElementSibling;
        if (statusLabel && statusLabel.tagName === 'LABEL') {
          statusLabel.textContent = qt === 'configurationFindings' ? 'תוצאה (Result)' : 'סטטוס';
        }
        // Update severity
        var sevOpts = wiziSeverityOptions[qt] || wiziSeverityOptions.issues;
        wiziSeveritySelect.innerHTML = '';
        if (sevOpts.length) {
          wiziSeveritySelect.disabled = false;
          sevOpts.forEach(function(o) {
            var opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.text;
            opt.selected = o.selected;
            wiziSeveritySelect.appendChild(opt);
          });
        } else {
          wiziSeveritySelect.disabled = true;
          var opt = document.createElement('option');
          opt.textContent = '— לא רלוונטי —';
          wiziSeveritySelect.appendChild(opt);
        }
        
        // Project field is now used for subscription filtering - no warnings needed
      }

      wiziQueryTypeSelect.addEventListener('change', function() {
        wiziQueryType = this.value;
        updateWiziFilterOptions();
      });

      // --- Autocomplete helper ---
      function setupAutocomplete(input, hiddenInput, listEl, getItems) {
        var activeIdx = -1;

        // Move list to body so it's never clipped by parent overflow
        if (listEl.parentNode !== document.body) {
          document.body.appendChild(listEl);
        }

        function positionList() {
          var rect = input.getBoundingClientRect();
          listEl.style.position = 'fixed';
          listEl.style.top = rect.bottom + 'px';
          listEl.style.left = rect.left + 'px';
          listEl.style.width = rect.width + 'px';
        }

        function render(query) {
          var items = getItems();
          var q = (query || '').toLowerCase();
          var filtered = q ? items.filter(function(it) {
            return it.label.toLowerCase().includes(q) || (it.sub || '').toLowerCase().includes(q) || (it.externalId || '').toLowerCase().includes(q);
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
          positionList();
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

        // Close on scroll/resize (fixed position won't follow)
        window.addEventListener('scroll', function() {
          if (listEl.classList.contains('open')) positionList();
        }, true);
        window.addEventListener('resize', function() {
          listEl.classList.remove('open');
        });

        // Clear button behavior — if user clears the field, reset hidden ID
        input.addEventListener('change', function() {
          if (!input.value.trim()) hiddenInput.value = '';
        });
      }

      // Project field is now used for subscription filtering (not Wiz projects)
      // Set up autocomplete with subscription names
      setupAutocomplete(wiziProjectInput, wiziProjectId, wiziProjectList, function() {
        return wiziSubscriptions;
      });

      function loadWiziFilters() {
        // Load subscriptions for autocomplete
        fetch('/api/wizi/subscriptions')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.subscriptions && data.subscriptions.length) {
              wiziSubscriptions = data.subscriptions.map(function(s) {
                return { 
                  id: s.name, 
                  label: s.name, 
                  sub: s.cloudProvider + ' · ' + (s.externalId || (s.id ? s.id.substring(0, 8) : '')),
                  externalId: s.externalId || ''
                };
              });
            }
          })
          .catch(function(e) { 
            // Silently fail - subscriptions autocomplete is optional
          });
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
                wiziStatusMsg.textContent = '✓ Wizi מחובר · ' + data.totalIssues + ' issues';
              }, 1000);
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
        var m = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFORMATIONAL: 'info', INFO: 'info', NONE: 'info' };
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

        // Sort by rule/control ID for consistent ordering
        wiziIssues.sort(function(a, b) {
          var idA = (getWiziRuleId(a, wiziQueryType) || '').toString().toLowerCase();
          var idB = (getWiziRuleId(b, wiziQueryType) || '').toString().toLowerCase();
          if (idA < idB) return -1;
          if (idA > idB) return 1;
          return 0;
        });

        var renderers = {
          configurationFindings: renderWiziConfigTable,
          vulnerabilityFindings: renderWiziVulnTable,
          hostConfigurationRuleAssessments: renderWiziHostConfigTable,
          dataFindingsV2: renderWiziDataTable,
          secretInstances: renderWiziSecretTable,
          excessiveAccessFindings: renderWiziExcessiveAccessTable,
          networkExposures: renderWiziNetworkTable,
          inventoryFindings: renderWiziInventoryTable
        };
        var fn = renderers[wiziQueryType] || renderWiziIssuesTable;
        fn();
      }

      function wireWiziCheckboxes() {
        var checkAll = document.getElementById('wizi-check-all');
        if (checkAll) {
          checkAll.addEventListener('change', function() {
            var checked = this.checked;
            document.querySelectorAll('.wizi-check').forEach(function(cb) { cb.checked = checked; });
            updateWiziSelectedCount();
          });
        }
        wiziResults.addEventListener('change', function(e) {
          if (e.target.classList.contains('wizi-check')) updateWiziSelectedCount();
        });
        updateWiziSelectedCount();
      }

      function renderWiziIssuesTable() {
        var html = '<table><caption>ממצאי Wizi — Issues — סמן לייבוא</caption><thead><tr>' +
          '<th><input type="checkbox" id="wizi-check-all" checked></th>' +
          '<th>Rule</th><th>Control ID</th><th>חומרה</th><th>Entity</th><th>Subscription</th><th>Cloud</th><th>Region</th><th>סטטוס</th>' +
          '</tr></thead><tbody>';

        wiziIssues.forEach(function(issue, idx) {
          var sev = (issue.severity || 'MEDIUM').toUpperCase();
          var sevClass = 'sev-' + mapWiziSeverity(sev);
          var entity = issue.entitySnapshot || {};
          var rules = issue.sourceRules || [];
          var ruleName = rules.length ? rules[0].name : (issue.description || 'N/A');
          var ruleDesc = rules.length ? rules[0].description : '';
          var controlId = (issue.control && issue.control.id) ? issue.control.id : (rules.length ? rules[0].id : '');
          html += '<tr>' +
            '<td><input type="checkbox" class="wizi-check" data-idx="' + idx + '" checked></td>' +
            '<td title="' + (ruleDesc).replace(/"/g, '&quot;') + '">' + ruleName + '</td>' +
            '<td><span class="muted" style="font-family:monospace;font-size:10px;cursor:pointer;user-select:all;" title="לחץ להעתקה">' + controlId + '</span></td>' +
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
        wireWiziCheckboxes();
      }

      function renderWiziConfigTable() {
        var html = '<table><caption>ממצאי Wizi — Configuration Findings — סמן לייבוא</caption><thead><tr>' +
          '<th><input type="checkbox" id="wizi-check-all" checked></th>' +
          '<th>Rule</th><th>ID</th><th>חומרה</th><th>תוצאה</th><th>Resource</th><th>Subscription</th><th>Region</th>' +
          '</tr></thead><tbody>';

        wiziIssues.forEach(function(item, idx) {
          var sev = (item.severity || 'MEDIUM').toUpperCase();
          var sevClass = 'sev-' + mapWiziSeverity(sev);
          var rule = item.rule || {};
          var resource = item.resource || {};
          var sub = resource.subscription || {};
          var resultBadge = (item.result || '').toUpperCase();
          var resultClass = resultBadge === 'FAIL' ? 'sev-high' : resultBadge === 'PASS' ? 'sev-low' : 'sev-medium';
          var shortId = rule.shortId || '';
          html += '<tr>' +
            '<td><input type="checkbox" class="wizi-check" data-idx="' + idx + '" checked></td>' +
            '<td title="' + (rule.description || '').replace(/"/g, '&quot;') + '">' + (rule.name || item.name || 'N/A') + '</td>' +
            '<td><span class="muted" style="font-family:monospace;font-size:10px;">' + shortId + '</span></td>' +
            '<td><span class="severity-chip ' + sevClass + '">' + sev + '</span></td>' +
            '<td><span class="severity-chip ' + resultClass + '">' + resultBadge + '</span></td>' +
            '<td>' + (resource.name || 'N/A') + '</td>' +
            '<td>' + (sub.name || '') + '</td>' +
            '<td>' + (resource.region || '') + '</td>' +
            '</tr>';
        });

        html += '</tbody></table>';
        wiziResults.innerHTML = html;
        wiziActionsDiv.style.display = '';
        wireWiziCheckboxes();
      }

      function renderWiziVulnTable() {
        var html = '<table><caption>ממצאי Wizi — Vulnerability Findings — סמן לייבוא</caption><thead><tr>' +
          '<th><input type="checkbox" id="wizi-check-all" checked></th>' +
          '<th>CVE / Name</th><th>חומרה</th><th>Score</th><th>משאב</th><th>סוג משאב</th><th>Exploit</th><th>Fix</th><th>Fixed Version</th><th>סטטוס</th>' +
          '</tr></thead><tbody>';

        wiziIssues.forEach(function(item, idx) {
          var sev = (item.severity || 'MEDIUM').toUpperCase();
          var sevClass = 'sev-' + mapWiziSeverity(sev);
          var exploitBadge = item.hasExploit ? '<span class="severity-chip sev-critical">כן</span>' : '<span class="muted">לא</span>';
          var fixBadge = item.hasFix ? '<span class="severity-chip sev-low">כן</span>' : '<span class="muted">לא</span>';
          var asset = item.vulnerableAsset || {};
          var assetName = asset.name || '—';
          var assetType = asset.type || '—';
          html += '<tr>' +
            '<td><input type="checkbox" class="wizi-check" data-idx="' + idx + '" checked></td>' +
            '<td title="' + (item.CVEDescription || item.description || '').replace(/"/g, '&quot;') + '">' + (item.name || item.detailedName || 'N/A') + '</td>' +
            '<td><span class="severity-chip ' + sevClass + '">' + sev + '</span></td>' +
            '<td>' + (item.score != null ? item.score.toFixed(1) : '—') + '</td>' +
            '<td>' + escapeHtml(assetName) + '</td>' +
            '<td>' + escapeHtml(assetType) + '</td>' +
            '<td>' + exploitBadge + '</td>' +
            '<td>' + fixBadge + '</td>' +
            '<td>' + (item.fixedVersion || '—') + '</td>' +
            '<td>' + (item.status || '') + '</td>' +
            '</tr>';
        });

        html += '</tbody></table>';
        wiziResults.innerHTML = html;
        wiziActionsDiv.style.display = '';
        wireWiziCheckboxes();
      }

      function renderWiziHostConfigTable() {
        var html = '<table><caption>ממצאי Wizi — Host Configuration — סמן לייבוא</caption><thead><tr>' +
          '<th><input type="checkbox" id="wizi-check-all" checked></th>' +
          '<th>Rule</th><th>חומרה</th><th>תוצאה</th><th>Resource</th><th>Type</th><th>Cloud</th><th>Region</th>' +
          '</tr></thead><tbody>';
        wiziIssues.forEach(function(item, idx) {
          var sev = (item.severity || 'MEDIUM').toUpperCase();
          var sevClass = 'sev-' + mapWiziSeverity(sev);
          var rule = item.rule || {};
          var res = item.resource || {};
          var sub = res.subscription || {};
          var resultBadge = (item.result || '').toUpperCase();
          var resultClass = resultBadge === 'FAIL' ? 'sev-high' : resultBadge === 'PASS' ? 'sev-low' : 'sev-medium';
          html += '<tr>' +
            '<td><input type="checkbox" class="wizi-check" data-idx="' + idx + '" checked></td>' +
            '<td title="' + (rule.description || '').replace(/"/g, '&quot;') + '">' + (rule.name || 'N/A') + '</td>' +
            '<td><span class="severity-chip ' + sevClass + '">' + sev + '</span></td>' +
            '<td><span class="severity-chip ' + resultClass + '">' + resultBadge + '</span></td>' +
            '<td>' + (res.name || 'N/A') + '</td>' +
            '<td><span class="muted">' + (res.nativeType || '') + '</span></td>' +
            '<td>' + (res.cloudPlatform || '') + '</td>' +
            '<td>' + (res.region || '') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        wiziResults.innerHTML = html;
        wiziActionsDiv.style.display = '';
        wireWiziCheckboxes();
      }

      function renderWiziDataTable() {
        var html = '<table><caption>ממצאי Wizi — Data Findings — סמן לייבוא</caption><thead><tr>' +
          '<th><input type="checkbox" id="wizi-check-all" checked></th>' +
          '<th>Classifier</th><th>חומרה</th><th>Entity</th><th>Cloud Account</th><th>סטטוס</th>' +
          '</tr></thead><tbody>';
        wiziIssues.forEach(function(item, idx) {
          var sev = (item.severity || 'MEDIUM').toUpperCase();
          var sevClass = 'sev-' + mapWiziSeverity(sev);
          var classifier = item.dataClassifier || {};
          var entity = item.graphEntity || {};
          var account = item.cloudAccount || {};
          html += '<tr>' +
            '<td><input type="checkbox" class="wizi-check" data-idx="' + idx + '" checked></td>' +
            '<td>' + (item.name || classifier.name || 'N/A') + '<br><span class="muted">' + (classifier.category || '') + '</span></td>' +
            '<td><span class="severity-chip ' + sevClass + '">' + sev + '</span></td>' +
            '<td>' + (entity.name || 'N/A') + '<br><span class="muted">' + (entity.type || '') + '</span></td>' +
            '<td>' + (account.name || '') + '<br><span class="muted">' + (account.cloudProvider || '') + '</span></td>' +
            '<td>' + (item.status || '') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        wiziResults.innerHTML = html;
        wiziActionsDiv.style.display = '';
        wireWiziCheckboxes();
      }

      function renderWiziSecretTable() {
        var html = '<table><caption>ממצאי Wizi — Secrets — סמן לייבוא</caption><thead><tr>' +
          '<th><input type="checkbox" id="wizi-check-all" checked></th>' +
          '<th>Secret</th><th>חומרה</th><th>Type</th><th>Resource</th><th>Path</th><th>סטטוס</th>' +
          '</tr></thead><tbody>';
        wiziIssues.forEach(function(item, idx) {
          var sev = (item.severity || 'MEDIUM').toUpperCase();
          var sevClass = 'sev-' + mapWiziSeverity(sev);
          var res = item.resource || {};
          var rule = item.rule || {};
          html += '<tr>' +
            '<td><input type="checkbox" class="wizi-check" data-idx="' + idx + '" checked></td>' +
            '<td title="' + (rule.name || '').replace(/"/g, '&quot;') + '">' + (item.name || 'N/A') + '</td>' +
            '<td><span class="severity-chip ' + sevClass + '">' + sev + '</span></td>' +
            '<td>' + (item.type || '') + '</td>' +
            '<td>' + (res.name || 'N/A') + '<br><span class="muted">' + (res.nativeType || '') + '</span></td>' +
            '<td class="muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="' + (item.path || '').replace(/"/g, '&quot;') + '">' + (item.path || '') + '</td>' +
            '<td>' + (item.status || '') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        wiziResults.innerHTML = html;
        wiziActionsDiv.style.display = '';
        wireWiziCheckboxes();
      }

      function renderWiziExcessiveAccessTable() {
        var html = '<table><caption>ממצאי Wizi — Excessive Access — סמן לייבוא</caption><thead><tr>' +
          '<th><input type="checkbox" id="wizi-check-all" checked></th>' +
          '<th>Finding</th><th>חומרה</th><th>Principal</th><th>Cloud</th><th>Remediation</th><th>סטטוס</th>' +
          '</tr></thead><tbody>';
        wiziIssues.forEach(function(item, idx) {
          var sev = (item.severity || 'MEDIUM').toUpperCase();
          var sevClass = 'sev-' + mapWiziSeverity(sev);
          var principal = item.principal || {};
          var ge = principal.graphEntity || {};
          var ca = principal.cloudAccount || {};
          html += '<tr>' +
            '<td><input type="checkbox" class="wizi-check" data-idx="' + idx + '" checked></td>' +
            '<td title="' + (item.description || '').replace(/"/g, '&quot;') + '">' + (item.name || 'N/A') + '</td>' +
            '<td><span class="severity-chip ' + sevClass + '">' + sev + '</span></td>' +
            '<td>' + (ge.name || 'N/A') + '<br><span class="muted">' + (ca.name || '') + '</span></td>' +
            '<td>' + (item.cloudPlatform || '') + '</td>' +
            '<td><span class="muted">' + (item.remediationType || '') + '</span></td>' +
            '<td>' + (item.status || '') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        wiziResults.innerHTML = html;
        wiziActionsDiv.style.display = '';
        wireWiziCheckboxes();
      }

      function renderWiziNetworkTable() {
        var html = '<table><caption>ממצאי Wizi — Network Exposure — סמן לייבוא</caption><thead><tr>' +
          '<th><input type="checkbox" id="wizi-check-all" checked></th>' +
          '<th>Exposed Entity</th><th>Type</th><th>Source IP</th><th>Port Range</th><th>Exposure Type</th>' +
          '</tr></thead><tbody>';
        wiziIssues.forEach(function(item, idx) {
          var entity = item.exposedEntity || {};
          html += '<tr>' +
            '<td><input type="checkbox" class="wizi-check" data-idx="' + idx + '" checked></td>' +
            '<td>' + (entity.name || 'N/A') + '</td>' +
            '<td><span class="muted">' + (entity.type || '') + '</span></td>' +
            '<td>' + (item.sourceIpRange || '') + '</td>' +
            '<td>' + (item.portRange || '') + '</td>' +
            '<td>' + (item.type || '') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        wiziResults.innerHTML = html;
        wiziActionsDiv.style.display = '';
        wireWiziCheckboxes();
      }

      function renderWiziInventoryTable() {
        var html = '<table><caption>ממצאי Wizi — Inventory / EOL — סמן לייבוא</caption><thead><tr>' +
          '<th><input type="checkbox" id="wizi-check-all" checked></th>' +
          '<th>Rule</th><th>חומרה</th><th>Resource</th><th>Type</th><th>Cloud</th><th>Region</th><th>סטטוס</th>' +
          '</tr></thead><tbody>';
        wiziIssues.forEach(function(item, idx) {
          var sev = (item.severity || 'MEDIUM').toUpperCase();
          var sevClass = 'sev-' + mapWiziSeverity(sev);
          var rule = item.rule || {};
          var res = item.resource || {};
          var ca = res.cloudAccount || {};
          html += '<tr>' +
            '<td><input type="checkbox" class="wizi-check" data-idx="' + idx + '" checked></td>' +
            '<td title="' + (rule.description || '').replace(/"/g, '&quot;') + '">' + (rule.name || 'N/A') + '</td>' +
            '<td><span class="severity-chip ' + sevClass + '">' + sev + '</span></td>' +
            '<td>' + (res.name || 'N/A') + '</td>' +
            '<td><span class="muted">' + (res.nativeType || '') + '</span></td>' +
            '<td>' + (ca.name || res.cloudPlatform || '') + '</td>' +
            '<td>' + (res.region || '') + '</td>' +
            '<td>' + (item.status || '') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        wiziResults.innerHTML = html;
        wiziActionsDiv.style.display = '';
        wireWiziCheckboxes();
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
        var qt = wiziQueryTypeSelect.value;
        wiziQueryType = qt;
        var sevFilter = getSelectedValues(document.getElementById('wizi-severity'));
        var statusFilter = getSelectedValues(wiziStatusSelect);
        var limit = parseInt(document.getElementById('wizi-limit').value) || 10;
        
        // Subscription priority: use "פרויקט / Subscription" field first, then free text field
        var projectFieldValue = wiziProjectInput.value.trim() || null;
        var freeTextSub = wiziSubInput.value.trim() || null;
        var subscription = projectFieldValue || freeTextSub;

        wiziFetchBtn.disabled = true;
        wiziStatusMsg.textContent = 'שולף ממצאים מ-Wizi...';
        var wiziProg = document.getElementById('wizi-progress');
        var wiziProgFill = document.getElementById('wizi-progress-fill');
        var wiziProgText = document.getElementById('wizi-progress-text');
        if (wiziProg) { wiziProg.classList.add('active'); wiziProgFill.style.width = '30%'; wiziProgText.textContent = 'שולף ממצאים מ-Wizi...'; }

        var body = { queryType: qt, first: limit, severity: sevFilter, status: statusFilter };
        // Send subscription filter (from either subscription field or project field)
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
          
          // Show warning if subscription resolution failed
          if (data.warning) {
            showToast(data.warning, 'warning');
          }
          
          var rootKey = data.queryType || qt;
          var resultSet = data[rootKey] || {};
          var nodes = resultSet.nodes || [];
          var pageInfo = resultSet.pageInfo || {};

          // Client-side subscription name filter
          // Only apply for excessiveAccessFindings which doesn't support backend filtering
          // All other query types use backend filtering (resolved_sub_ids/resolved_sub_ext_ids)
          var needsClientFilter = subscription && qt === 'excessiveAccessFindings';
          if (needsClientFilter) {
            var subFilter = subscription.toLowerCase();
            var beforeFilter = nodes.length;
            nodes = nodes.filter(function(n) {
              var subName = getNodeSubscriptionName(n, qt);
              if (!subName) return false; // No subscription name, exclude
              return subName.toLowerCase().indexOf(subFilter) >= 0;
            });
            if (beforeFilter !== nodes.length) {
              showToast('סונן ' + (beforeFilter - nodes.length) + ' ממצאים לפי subscription', 'info');
            }
          }

          if (append) {
            wiziIssues = wiziIssues.concat(nodes);
          } else {
            wiziIssues = nodes;
          }

          wiziEndCursor = pageInfo.endCursor || null;
          wiziHasNextPage = pageInfo.hasNextPage || false;
          wiziLoadMoreBtn.style.display = wiziHasNextPage ? '' : 'none';

          var typeLabels = {
            issues: 'issues', configurationFindings: 'configuration findings',
            vulnerabilityFindings: 'vulnerability findings',
            hostConfigurationRuleAssessments: 'host config findings',
            dataFindingsV2: 'data findings', secretInstances: 'secrets',
            excessiveAccessFindings: 'excessive access findings',
            networkExposures: 'network exposures', inventoryFindings: 'inventory findings'
          };
          var countText = 'נמצאו ' + wiziIssues.length + ' ' + (typeLabels[qt] || 'ממצאים');
          if (resultSet.totalCount) countText += ' (מתוך ' + resultSet.totalCount + ')';
          if (subFilter) countText += ' [סינון: ' + subscription + ']';
          if (wiziHasNextPage) countText += ' — יש עוד';
          wiziStatusMsg.textContent = countText;

          renderWiziTable();

          // Auto-fill report details from first Wizi fetch
          if (!append && nodes.length && !document.getElementById('report-client').value.trim()) {
            var autoFillData = extractWiziAutoFillData(nodes, qt);
            // Use the subscription input value as client name (it's the cloud provider ID the user searched for)
            var subInput = wiziProjectInput.value.trim() || wiziSubInput.value.trim() || '';
            if (subInput) autoFillData.subscription = subInput;
            if (autoFillData.subscription || autoFillData.cloud) {
              showWiziAutoFillBanner(autoFillData);
            }
          }
        })
        .catch(function(e) {
          wiziStatusMsg.textContent = 'שגיאת רשת: ' + e.message;
        })
        .finally(function() {
          wiziFetchBtn.disabled = false;
          var wiziProg = document.getElementById('wizi-progress');
          if (wiziProg) wiziProg.classList.remove('active');
        });
      }

      // Extract subscription name from a finding node based on query type
      function getNodeSubscriptionName(node, qt) {
        var subName = '';
        if (qt === 'issues') {
          var es = node.entitySnapshot || {};
          subName = es.subscriptionName || '';
        }
        else if (qt === 'configurationFindings' || qt === 'hostConfigurationRuleAssessments' || qt === 'inventoryFindings') {
          var res = node.resource || {};
          var sub = res.subscription || res.cloudAccount || {};
          subName = sub.name || '';
        }
        else if (qt === 'vulnerabilityFindings') {
          var asset = node.vulnerableAsset || {};
          subName = asset.subscriptionName || '';
        }
        else if (qt === 'dataFindingsV2') {
          var ca = node.cloudAccount || {};
          subName = ca.name || '';
        }
        else if (qt === 'secretInstances') {
          var sr = node.resource || {};
          var sca = sr.cloudAccount || {};
          subName = sca.name || sr.name || '';
        }
        else if (qt === 'excessiveAccessFindings') {
          var p = node.principal || {};
          var pca = p.cloudAccount || {};
          subName = pca.name || pca.externalId || '';
        }
        else if (qt === 'networkExposures') {
          var ee = node.exposedEntity || {};
          var eca = ee.cloudAccount || {};
          subName = eca.name || '';
        }
        
        return subName;
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
        var beforeCount = findings.length;
        var selected = [];
        document.querySelectorAll('.wizi-check:checked').forEach(function(cb) {
          var idx = parseInt(cb.getAttribute('data-idx'));
          if (wiziIssues[idx]) selected.push(wiziIssues[idx]);
        });

        if (!selected.length) {
          wiziStatusMsg.textContent = 'לא נבחרו ממצאים לייבוא.';
          return;
        }

        // Special case: aggregate vuln findings into a single finding if more than 5
        if (wiziQueryType === 'vulnerabilityFindings' && selected.length > 5) {
          var cat = 'VULN';
          var id = generateNextId(cat);
          var highestSev = 'high';
          var critCount = 0;
          var highCount = 0;
          var resourceNames = [];
          var subscriptionNames = [];
          var technical = [];

          selected.forEach(function(item) {
            var sev = mapWiziSeverity(item.severity);
            if (sev === 'critical') { critCount++; highestSev = 'critical'; }
            else highCount++;

            var asset = item.vulnerableAsset || {};
            var resName = asset.name || '';
            if (resName && resourceNames.indexOf(resName) === -1) resourceNames.push(resName);
            var subName = asset.subscriptionName || '';
            if (subName && subscriptionNames.indexOf(subName) === -1) subscriptionNames.push(subName);
          });

          technical.push('Total Vulnerabilities: ' + selected.length);
          if (critCount) technical.push('Critical: ' + critCount);
          if (highCount) technical.push('High: ' + highCount);
          if (resourceNames.length) technical.push('Affected Resources: ' + resourceNames.join(', '));
          if (subscriptionNames.length) technical.push('Subscriptions: ' + subscriptionNames.join(', '));

          findings.push({
            id: id, category: cat,
            title: 'Multiple vulnerabilities with high and above severity',
            severity: highestSev,
            description: 'נמצאו ' + selected.length + ' פגיעויות ברמת חומרה גבוהה ומעלה',
            impact: 'פגיעויות מרובות ברמת חומרה גבוהה ומעלה — ' + critCount + ' קריטיות, ' + highCount + ' גבוהות',
            technical: technical,
            policies: [],
            recs: ['לטפל בפגיעויות בהתאם לרמת החומרה ולעדכן את הרכיבים הפגיעים'],
            priority: '',
            owner: subscriptionNames.join(', '),
            evidence: []
          });

          renderFindingsTable();
          prefillId();
          autoSave();
          switchToTab('tab-findings-list');
          showToast('יובאו ' + selected.length + ' פגיעויות כממצא מאוחד', 'success');
          return;
        }

        // Group findings by rule ID only
        // All items with same rule will be consolidated into one finding
        // with all unique subscriptions and resources listed
        var groupedByRule = {};
        selected.forEach(function(item) {
          var ruleId = getWiziRuleId(item, wiziQueryType);
          if (!ruleId) ruleId = 'no-rule-' + Math.random(); // Fallback for items without rule
          
          if (!groupedByRule[ruleId]) {
            groupedByRule[ruleId] = [];
          }
          groupedByRule[ruleId].push(item);
        });

        var imported = 0;
        var skipped = 0;
        var consolidated = 0;
        var updated = 0;
        var existingTitles = {};
        var existingFindingsByTitle = {};
        findings.forEach(function(f) { 
          var lowerTitle = (f.title || '').toLowerCase();
          existingTitles[lowerTitle] = true;
          existingFindingsByTitle[lowerTitle] = f;
        });

        Object.keys(groupedByRule).forEach(function(ruleId) {
          var items = groupedByRule[ruleId];
          var firstItem = items[0];
          
          // Check if finding with same title already exists
          var title = getWiziItemTitle(firstItem, wiziQueryType);
          var lowerTitle = title ? title.toLowerCase() : null;
          
          if (lowerTitle && existingTitles[lowerTitle]) {
            // Finding exists - append new resources and subscriptions
            var existingFinding = existingFindingsByTitle[lowerTitle];
            
            // Extract all unique resource names from new items
            var newResources = [];
            items.forEach(function(item) {
              var resourceName = extractResourceName(item, wiziQueryType);
              if (resourceName && newResources.indexOf(resourceName) === -1) {
                newResources.push(resourceName);
              }
            });
            
            // Extract all unique subscription names from new items
            var newSubscriptions = [];
            items.forEach(function(item) {
              var subName = getNodeSubscriptionName(item, wiziQueryType);
              if (subName && newSubscriptions.indexOf(subName) === -1) {
                newSubscriptions.push(subName);
              }
            });
            
            // Get existing resources from Entity/Resource line
            var existingResources = [];
            var entityLineIndex = -1;
            for (var j = 0; j < existingFinding.technical.length; j++) {
              if (existingFinding.technical[j].startsWith('Entity:') || 
                  existingFinding.technical[j].startsWith('Resource:') ||
                  existingFinding.technical[j].startsWith('Principal:')) {
                entityLineIndex = j;
                var parts = existingFinding.technical[j].split(':');
                if (parts.length > 1) {
                  existingResources = parts[1].split(',').map(function(r) { return r.trim(); });
                }
                break;
              }
            }
            
            // Merge resources (avoid duplicates)
            var allResources = existingResources.slice();
            newResources.forEach(function(r) {
              if (allResources.indexOf(r) === -1) {
                allResources.push(r);
              }
            });
            
            // Get existing subscriptions from owner field
            var existingSubscriptions = existingFinding.owner ? existingFinding.owner.split(',').map(function(s) { return s.trim(); }) : [];
            
            // Merge subscriptions (avoid duplicates)
            var allSubscriptions = existingSubscriptions.slice();
            newSubscriptions.forEach(function(s) {
              if (allSubscriptions.indexOf(s) === -1) {
                allSubscriptions.push(s);
              }
            });
            
            // Update Entity/Resource line if resources changed
            if (allResources.length > existingResources.length) {
              if (entityLineIndex >= 0) {
                var prefix = existingFinding.technical[entityLineIndex].split(':')[0];
                existingFinding.technical[entityLineIndex] = prefix + ': ' + allResources.join(', ');
              } else if (allResources.length > 0) {
                // Entity line doesn't exist, create it at the beginning
                existingFinding.technical.unshift('Affected Resources: ' + allResources.join(', '));
              }
            }
            
            // Update owner field if subscriptions changed
            if (allSubscriptions.length > existingSubscriptions.length) {
              existingFinding.owner = allSubscriptions.join(', ');
              
              // Also update Subscription line in technical details if it exists
              var subLineIndex = -1;
              for (var k = 0; k < existingFinding.technical.length; k++) {
                if (existingFinding.technical[k].startsWith('Subscription:') || 
                    existingFinding.technical[k].startsWith('Account:')) {
                  subLineIndex = k;
                  break;
                }
              }
              
              if (subLineIndex >= 0) {
                var subPrefix = existingFinding.technical[subLineIndex].split(':')[0];
                existingFinding.technical[subLineIndex] = subPrefix + ': ' + allSubscriptions.join(', ');
              }
            }
            
            updated++;
            return;
          }

          var importers = {
            configurationFindings: importConfigFinding,
            vulnerabilityFindings: importVulnFinding,
            hostConfigurationRuleAssessments: importHostConfigFinding,
            dataFindingsV2: importDataFinding,
            secretInstances: importSecretFinding,
            excessiveAccessFindings: importExcessiveAccessFinding,
            networkExposures: importNetworkExposureFinding,
            inventoryFindings: importInventoryFinding
          };
          var fn = importers[wiziQueryType] || importIssueFinding;
          
          // Import first item to create the finding
          fn(firstItem);
          imported++;
          
          // Extract all unique subscription names from all items (for owner field)
          var allSubscriptions = [];
          items.forEach(function(item) {
            var subName = getNodeSubscriptionName(item, wiziQueryType);
            if (subName && allSubscriptions.indexOf(subName) === -1) {
              allSubscriptions.push(subName);
            }
          });
          
          var lastFinding = findings[findings.length - 1];
          
          // Set owner field to subscription(s) - works for single or multiple items
          if (allSubscriptions.length > 0) {
            lastFinding.owner = allSubscriptions.join(', ');
          }
          
          // If multiple items with same rule, consolidate resources
          if (items.length > 1) {
            consolidated += items.length - 1;
            
            // Extract all unique resource names
            var allResources = [];
            items.forEach(function(item) {
              var resourceName = extractResourceName(item, wiziQueryType);
              if (resourceName && allResources.indexOf(resourceName) === -1) {
                allResources.push(resourceName);
              }
            });
            
            // If multiple resources, consolidate in Entity/Resource line
            if (allResources.length > 1) {
              var entityLineIndex = -1;
              for (var j = 0; j < lastFinding.technical.length; j++) {
                if (lastFinding.technical[j].startsWith('Entity:') || 
                    lastFinding.technical[j].startsWith('Resource:') ||
                    lastFinding.technical[j].startsWith('Principal:')) {
                  entityLineIndex = j;
                  break;
                }
              }
              
              if (entityLineIndex >= 0) {
                var prefix = lastFinding.technical[entityLineIndex].split(':')[0];
                lastFinding.technical[entityLineIndex] = prefix + ': ' + allResources.join(', ');
              } else {
                lastFinding.technical.unshift('Affected Resources: ' + allResources.join(', '));
              }
            }
            
            // If multiple subscriptions, also update Subscription line in technical details
            if (allSubscriptions.length > 1) {
              var subLineIndex = -1;
              for (var k = 0; k < lastFinding.technical.length; k++) {
                if (lastFinding.technical[k].startsWith('Subscription:') || 
                    lastFinding.technical[k].startsWith('Account:')) {
                  subLineIndex = k;
                  break;
                }
              }
              
              if (subLineIndex >= 0) {
                var subPrefix = lastFinding.technical[subLineIndex].split(':')[0];
                lastFinding.technical[subLineIndex] = subPrefix + ': ' + allSubscriptions.join(', ');
              }
            }
          }
          
          if (title) existingTitles[title.toLowerCase()] = true;
        });

        renderFindingsTable();
        prefillId();
        autoSave();
        switchToTab('tab-findings-list');
        var msg = 'יובאו ' + imported + ' ממצאים מ-Wizi';
        if (consolidated) msg += ' (' + consolidated + ' משאבים נוספים אוחדו)';
        if (updated) msg += ' (' + updated + ' ממצאים עודכנו)';
        if (skipped) msg += ' (' + skipped + ' כפולים דולגו)';
        showToast(msg, 'success');

        // Enrich newly imported findings with AI remediation summaries
        var newFindings = findings.slice(beforeCount);
        if (newFindings.length) {
          styledConfirm('האם ברצונך להפעיל את כלי שיפור ההמלצות?', {
            icon: '🤖', title: 'שיפור המלצות באמצעות AI', confirmText: 'כן', cancelText: 'לא'
          }).then(function(yes) {
            if (yes) enrichFindingsWithAiSummaries(newFindings);
          });
        }
      });

      // ── Fetch by Wizi finding ID ──
      var wiziFindIdInput = document.getElementById('wizi-find-id');
      var wiziFindIdSubInput = document.getElementById('wizi-find-id-sub');
      var wiziFindIdBtn = document.getElementById('btn-wizi-find-by-id');
      var wiziFindIdStatus = document.getElementById('wizi-find-id-status');
      var wiziFindIdResults = document.getElementById('wizi-find-id-results');
      var findIdLastPayload = null; // remember last search for pagination

      function renderFindIdResults(data) {
        var qt = data.queryType;
        var nodes = data.nodes || [];
        var total = data.total || 0;
        var pg = data.page || 0;
        var hasMore = data.hasMore || false;
        var typeLabels = {
          issues: 'Issue', configurationFindings: 'CSPM',
          vulnerabilityFindings: 'VULN', hostConfigurationRuleAssessments: 'HSPM',
          dataFindingsV2: 'DSPM', secretInstances: 'SECR',
          excessiveAccessFindings: 'EAPM', networkExposures: 'NEXP',
          inventoryFindings: 'EOLM'
        };

        if (!nodes.length) {
          wiziFindIdResults.innerHTML = '';
          return;
        }

        // If only 1 result, auto-import like before
        if (total === 1) {
          var importers = {
            issues: importIssueFinding,
            configurationFindings: importConfigFinding,
            vulnerabilityFindings: importVulnFinding,
            hostConfigurationRuleAssessments: importHostConfigFinding,
            dataFindingsV2: importDataFinding,
            secretInstances: importSecretFinding,
            excessiveAccessFindings: importExcessiveAccessFinding,
            networkExposures: importNetworkExposureFinding,
            inventoryFindings: importInventoryFinding
          };
          var fn = importers[qt] || importIssueFinding;
          fn(nodes[0]);
          renderFindingsTable();
          prefillId();
          autoSave();
          wiziFindIdInput.value = '';
          wiziFindIdResults.innerHTML = '';
          var label = typeLabels[qt] || qt;
          wiziFindIdStatus.textContent = '✓ יובא ממצא ' + label + ' — ' + (nodes[0].name || nodes[0].id || '');
          showToast('ממצא ' + label + ' יובא בהצלחה', 'success');
          return;
        }

        // Multiple results — show selection table
        var startIdx = pg * (data.pageSize || 5);
        var html = '<div style="margin-bottom:6px;color:var(--text-muted);font-size:12px;">נמצאו <strong>' + total + '</strong> תוצאות (' + (typeLabels[qt] || qt) + ') — עמוד ' + (pg + 1) + '</div>';
        html += '<table><thead><tr>';
        html += '<th style="width:40px;"></th>';
        html += '<th>שם / כותרת</th>';
        html += '<th>חומרה</th>';
        html += '<th>Subscription</th>';
        html += '<th>סטטוס</th>';
        html += '</tr></thead><tbody>';

        nodes.forEach(function(node, i) {
          var title = getWiziItemTitle(node, qt);
          var sev = (node.severity || '').toLowerCase();
          if (!sev && qt === 'issues') sev = (node.severity || '').toLowerCase();
          var sevLabel = { critical: 'קריטי', high: 'גבוה', medium: 'בינוני', low: 'נמוך', informational: 'מידע' };
          var sevDisplay = sevLabel[sev] || sev || '-';
          var sevClass = sev === 'informational' ? 'info' : sev;
          var subName = getNodeSubscriptionName(node, qt);
          var status = node.status || (node.result || '') || '-';

          html += '<tr>';
          html += '<td><button class="btn btn-primary btn-sm find-id-import-btn" data-idx="' + i + '" style="margin:0;padding:3px 8px;font-size:11px;">ייבא</button></td>';
          html += '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(title) + '">' + escapeHtml(title || node.id || '-') + '</td>';
          html += '<td><span class="severity-chip sev-' + sevClass + '">' + escapeHtml(sevDisplay) + '</span></td>';
          html += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(subName) + '">' + escapeHtml(subName || '-') + '</td>';
          html += '<td>' + escapeHtml(status) + '</td>';
          html += '</tr>';
        });

        html += '</tbody></table>';

        // Pagination buttons
        html += '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;">';
        if (pg > 0) {
          html += '<button class="btn btn-secondary btn-sm" id="find-id-prev-page" style="margin:0;">← הקודם</button>';
        }
        if (hasMore) {
          html += '<button class="btn btn-secondary btn-sm" id="find-id-next-page" style="margin:0;">הבא →</button>';
        }
        html += '<button class="btn btn-danger btn-sm" id="find-id-clear" style="margin:0;">✕ סגור</button>';
        html += '</div>';

        wiziFindIdResults.innerHTML = html;

        // Wire import buttons
        wiziFindIdResults.querySelectorAll('.find-id-import-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var idx = parseInt(btn.getAttribute('data-idx'));
            var node = nodes[idx];
            if (!node) return;
            var importers = {
              issues: importIssueFinding,
              configurationFindings: importConfigFinding,
              vulnerabilityFindings: importVulnFinding,
              hostConfigurationRuleAssessments: importHostConfigFinding,
              dataFindingsV2: importDataFinding,
              secretInstances: importSecretFinding,
              excessiveAccessFindings: importExcessiveAccessFinding,
              networkExposures: importNetworkExposureFinding,
              inventoryFindings: importInventoryFinding
            };
            var fn = importers[qt] || importIssueFinding;
            fn(node);
            renderFindingsTable();
            prefillId();
            autoSave();
            btn.disabled = true;
            btn.textContent = '✓';
            var label = typeLabels[qt] || qt;
            showToast('ממצא ' + label + ' יובא בהצלחה', 'success');
          });
        });

        // Wire pagination
        var prevBtn = document.getElementById('find-id-prev-page');
        var nextBtn = document.getElementById('find-id-next-page');
        var clearBtn = document.getElementById('find-id-clear');

        if (prevBtn) {
          prevBtn.addEventListener('click', function() {
            fetchFindById(pg - 1);
          });
        }
        if (nextBtn) {
          nextBtn.addEventListener('click', function() {
            fetchFindById(pg + 1);
          });
        }
        if (clearBtn) {
          clearBtn.addEventListener('click', function() {
            wiziFindIdResults.innerHTML = '';
            wiziFindIdStatus.textContent = '';
          });
        }
      }

      function fetchFindById(page) {
        var findingId = (wiziFindIdInput.value || '').trim();
        var subFilter = (wiziFindIdSubInput.value || '').trim();
        if (!findingId) {
          wiziFindIdStatus.textContent = 'הזן מזהה ממצא.';
          return;
        }

        wiziFindIdBtn.disabled = true;
        wiziFindIdStatus.textContent = 'מחפש ממצאים...';
        var wiziProg = document.getElementById('wizi-progress');
        var wiziProgFill = document.getElementById('wizi-progress-fill');
        var wiziProgText = document.getElementById('wizi-progress-text');
        if (wiziProg) { wiziProg.classList.add('active'); wiziProgFill.style.width = '50%'; wiziProgText.textContent = 'מחפש ממצאים...'; }

        var payload = { id: findingId, page: page || 0, pageSize: 5 };
        if (subFilter) payload.subscription = subFilter;
        findIdLastPayload = payload;

        fetch('/api/wizi/find-by-id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.error) {
            wiziFindIdStatus.textContent = 'לא נמצא: ' + data.error;
            wiziFindIdResults.innerHTML = '';
            showToast('ממצא לא נמצא', 'warning');
            return;
          }
          wiziFindIdStatus.textContent = '';
          renderFindIdResults(data);
        })
        .catch(function(e) {
          wiziFindIdStatus.textContent = 'שגיאת רשת: ' + e.message;
          wiziFindIdResults.innerHTML = '';
          showToast('שגיאה בשליפת ממצא', 'error');
        })
        .finally(function() {
          wiziFindIdBtn.disabled = false;
          var wiziProg = document.getElementById('wizi-progress');
          if (wiziProg) wiziProg.classList.remove('active');
        });
      }

      if (wiziFindIdBtn) {
        wiziFindIdBtn.addEventListener('click', function() {
          fetchFindById(0);
        });

        // Enter key in the ID input or subscription input
        wiziFindIdInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); wiziFindIdBtn.click(); }
        });
        if (wiziFindIdSubInput) {
          wiziFindIdSubInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); wiziFindIdBtn.click(); }
          });
        }
      }

      // ── Helper: get title from a Wizi item for dedup ──
      function getWiziItemTitle(item, qt) {
        if (qt === 'issues') {
          var rules = item.sourceRules || [];
          return rules.length ? rules[0].name : (item.description || '');
        }
        if (qt === 'configurationFindings' || qt === 'hostConfigurationRuleAssessments' || qt === 'inventoryFindings') {
          var rule = item.rule || {};
          return rule.name || item.name || '';
        }
        if (qt === 'vulnerabilityFindings') return item.name || item.detailedName || '';
        if (qt === 'dataFindingsV2') return item.name || (item.dataClassifier || {}).name || '';
        if (qt === 'secretInstances') return item.name || (item.rule || {}).name || '';
        if (qt === 'excessiveAccessFindings') return item.name || '';
        if (qt === 'networkExposures') return 'Network Exposure — ' + ((item.exposedEntity || {}).name || item.id);
        return item.name || '';
      }

      // ── Helper: get rule ID from a Wizi item for consolidation ──
      function getWiziRuleId(item, qt) {
        if (qt === 'issues') {
          var rules = item.sourceRules || [];
          return rules.length ? (rules[0].id || rules[0].shortId || rules[0].name) : null;
        }
        if (qt === 'configurationFindings' || qt === 'hostConfigurationRuleAssessments' || qt === 'inventoryFindings') {
          var rule = item.rule || {};
          return rule.id || rule.shortId || rule.shortName || rule.externalId || null;
        }
        if (qt === 'vulnerabilityFindings') {
          // For vulns, use CVE name or vulnerability name as the "rule"
          return item.name || item.detailedName || null;
        }
        if (qt === 'dataFindingsV2') {
          var classifier = item.dataClassifier || {};
          return classifier.id || classifier.name || null;
        }
        if (qt === 'secretInstances') {
          var rule = item.rule || {};
          return rule.id || rule.name || item.type || null;
        }
        if (qt === 'excessiveAccessFindings') {
          // Use finding name as rule ID (same excessive access type)
          return item.name || null;
        }
        if (qt === 'networkExposures') {
          // Network exposures don't have rules, use exposure type + port range
          return item.type + '_' + (item.portRange || 'any');
        }
        return null;
      }

      // ── Helper: extract resource info for consolidation ──
      function extractResourceInfo(item, qt) {
        var lines = [];
        
        if (qt === 'issues') {
          var entity = item.entitySnapshot || {};
          if (entity.name) lines.push('Resource: ' + entity.name);
          if (entity.subscriptionName) lines.push('Subscription: ' + entity.subscriptionName);
          if (entity.region) lines.push('Region: ' + entity.region);
          if (entity.nativeType) lines.push('Type: ' + entity.nativeType);
        }
        
        else if (qt === 'configurationFindings' || qt === 'hostConfigurationRuleAssessments' || qt === 'inventoryFindings') {
          var resource = item.resource || {};
          var sub = resource.subscription || resource.cloudAccount || {};
          if (resource.name) lines.push('Resource: ' + resource.name);
          if (sub.name) lines.push('Subscription: ' + sub.name);
          if (resource.region) lines.push('Region: ' + resource.region);
          if (resource.nativeType || resource.type) lines.push('Type: ' + (resource.nativeType || resource.type));
          if (item.result) lines.push('Result: ' + item.result);
        }
        
        else if (qt === 'vulnerabilityFindings') {
          var projects = (item.projects || []).map(function(p) { return p.name; }).filter(Boolean);
          if (projects.length) lines.push('Projects: ' + projects.join(', '));
          if (item.version) lines.push('Affected Version: ' + item.version);
          if (item.firstDetectedAt) lines.push('First Detected: ' + item.firstDetectedAt.split('T')[0]);
        }
        
        else if (qt === 'dataFindingsV2') {
          var entity = item.graphEntity || {};
          var account = item.cloudAccount || {};
          if (entity.name) lines.push('Entity: ' + entity.name);
          if (entity.type) lines.push('Type: ' + entity.type);
          if (account.name) lines.push('Account: ' + account.name);
        }
        
        else if (qt === 'secretInstances') {
          var res = item.resource || {};
          if (res.name) lines.push('Resource: ' + res.name);
          if (res.nativeType) lines.push('Type: ' + res.nativeType);
          if (res.region) lines.push('Region: ' + res.region);
          if (item.path) lines.push('Path: ' + item.path);
        }
        
        else if (qt === 'excessiveAccessFindings') {
          var principal = item.principal || {};
          var ge = principal.graphEntity || {};
          var ca = principal.cloudAccount || {};
          if (ge.name) lines.push('Principal: ' + ge.name);
          if (ge.type) lines.push('Principal Type: ' + ge.type);
          if (ca.name) lines.push('Account: ' + ca.name);
        }
        
        else if (qt === 'networkExposures') {
          var entity = item.exposedEntity || {};
          if (entity.name) lines.push('Entity: ' + entity.name);
          if (entity.type) lines.push('Type: ' + entity.type);
          if (item.sourceIpRange) lines.push('Source IP: ' + item.sourceIpRange);
        }
        
        return lines;
      }

      // ── Helper: extract just the resource/entity name for consolidation ──
      function extractResourceName(item, qt) {
        if (qt === 'issues') {
          var entity = item.entitySnapshot || {};
          return entity.name || null;
        }
        else if (qt === 'configurationFindings' || qt === 'hostConfigurationRuleAssessments' || qt === 'inventoryFindings') {
          var resource = item.resource || {};
          return resource.name || null;
        }
        else if (qt === 'vulnerabilityFindings') {
          // vulnerableAsset.name is the resource (e.g. "cgov-subnet-frontend-00089-f6v")
          var asset = item.vulnerableAsset || {};
          if (asset.name) return asset.name;
          // Fallback: parse detailedName which often has format "package on resource-name"
          var dn = item.detailedName || '';
          var onIdx = dn.lastIndexOf(' on ');
          if (onIdx > 0) return dn.substring(onIdx + 4);
          // Last fallback: first project name
          var projects = (item.projects || []).map(function(p) { return p.name; }).filter(Boolean);
          return projects.length ? projects[0] : null;
        }
        else if (qt === 'dataFindingsV2') {
          var entity = item.graphEntity || {};
          return entity.name || null;
        }
        else if (qt === 'secretInstances') {
          var res = item.resource || {};
          return res.name || null;
        }
        else if (qt === 'excessiveAccessFindings') {
          var principal = item.principal || {};
          var ge = principal.graphEntity || {};
          return ge.name || null;
        }
        else if (qt === 'networkExposures') {
          var entity = item.exposedEntity || {};
          return entity.name || null;
        }
        return null;
      }

      // ── Helper: extract auto-fill data from Wizi results ──
      function extractWiziAutoFillData(nodes, qt) {
        var subscriptions = {};
        var clouds = {};
        var topics = {};
        nodes.forEach(function(n) {
          if (qt === 'issues') {
            var es = n.entitySnapshot || {};
            if (es.subscriptionExternalId) subscriptions[es.subscriptionExternalId] = true;
            else if (es.subscriptionName) subscriptions[es.subscriptionName] = true;
            if (es.cloudPlatform) clouds[es.cloudPlatform] = true;
          } else if (qt === 'configurationFindings' || qt === 'hostConfigurationRuleAssessments' || qt === 'inventoryFindings') {
            var res = n.resource || {};
            var sub = res.subscription || res.cloudAccount || {};
            if (sub.externalId) subscriptions[sub.externalId] = true;
            else if (sub.name) subscriptions[sub.name] = true;
            if (sub.cloudProvider) clouds[sub.cloudProvider] = true;
            else if (res.cloudPlatform) clouds[res.cloudPlatform] = true;
          } else if (qt === 'vulnerabilityFindings') {
            var asset = n.vulnerableAsset || {};
            if (asset.subscriptionName) subscriptions[asset.subscriptionName] = true;
            if (asset.type) {
              var t = asset.type.replace(/_/g, ' ');
              topics['פגיעויות ב-' + t] = true;
            }
          } else if (qt === 'dataFindingsV2') {
            var ca = n.cloudAccount || {};
            if (ca.name) subscriptions[ca.name] = true;
            if (ca.cloudProvider) clouds[ca.cloudProvider] = true;
          } else if (qt === 'secretInstances') {
            var sr = n.resource || {};
            var sca = sr.cloudAccount || {};
            if (sca.name) subscriptions[sca.name] = true;
            if (sr.cloudPlatform) clouds[sr.cloudPlatform] = true;
          } else if (qt === 'excessiveAccessFindings') {
            if (n.cloudPlatform) clouds[n.cloudPlatform] = true;
            var pca = (n.principal || {}).cloudAccount || {};
            if (pca.externalId) subscriptions[pca.externalId] = true;
            else if (pca.name) subscriptions[pca.name] = true;
          } else if (qt === 'networkExposures') {
            var ee = n.exposedEntity || {};
            var eca = ee.cloudAccount || {};
            if (eca.name) subscriptions[eca.name] = true;
          }
        });

        // Extract key topics from query types
        if (qt === 'configurationFindings') topics['תצורת ענן (CSPM)'] = true;
        if (qt === 'hostConfigurationRuleAssessments') topics['תצורת שרתים (Host Configuration)'] = true;
        if (qt === 'vulnerabilityFindings') topics['פגיעויות (Vulnerabilities)'] = true;
        if (qt === 'dataFindingsV2') topics['אבטחת מידע (DSPM)'] = true;
        if (qt === 'secretInstances') topics['סודות חשופים (Secrets)'] = true;
        if (qt === 'excessiveAccessFindings') topics['הרשאות יתר (Excessive Access)'] = true;
        if (qt === 'networkExposures') topics['חשיפה לאינטרנט (Network Exposure)'] = true;
        if (qt === 'inventoryFindings') topics['משאבים בסוף חיים (EOL)'] = true;

        return {
          subscription: Object.keys(subscriptions).join(', '),
          cloud: Object.keys(clouds).join(', '),
          keyTopics: Object.keys(topics).join('\n')
        };
      }

      // ── Wizi auto-fill banner ──
      var wiziAutoFillBanner = document.getElementById('wizi-autofill-banner');
      var wiziAutoFillText = document.getElementById('wizi-autofill-text');
      var pendingAutoFill = null;

      function showWiziAutoFillBanner(data) {
        pendingAutoFill = data;
        var parts = [];
        if (data.subscription) parts.push('לקוח: ' + data.subscription);
        if (data.cloud) parts.push('ענן: ' + data.cloud);
        if (data.keyTopics) parts.push('נושאים: ' + data.keyTopics.split('\n').length);
        wiziAutoFillText.textContent = '💡 זוהו פרטים — ' + parts.join(' | ');
        wiziAutoFillBanner.style.display = '';
      }

      document.getElementById('btn-wizi-autofill-accept').addEventListener('click', function() {
        if (!pendingAutoFill) return;
        var clientField = document.getElementById('report-client');
        var envField = document.getElementById('report-env');
        var keyTopicsField = document.getElementById('report-key-topics');
        if (!clientField.value.trim() && pendingAutoFill.subscription) {
          clientField.value = pendingAutoFill.subscription;
        }
        if (!envField.value.trim() && pendingAutoFill.cloud) {
          envField.value = pendingAutoFill.cloud;
        }
        if (!keyTopicsField.value.trim() && pendingAutoFill.keyTopics) {
          keyTopicsField.value = pendingAutoFill.keyTopics;
        }
        // Set today's date if empty
        var dateField = document.getElementById('report-date');
        if (!dateField.value) {
          dateField.value = getTodayDDMMYYYY();
        }
        wiziAutoFillBanner.style.display = 'none';
        pendingAutoFill = null;
        showToast('פרטי דו"ח מולאו אוטומטית', 'success');
        updateStepper();
      });

      document.getElementById('btn-wizi-autofill-dismiss').addEventListener('click', function() {
        wiziAutoFillBanner.style.display = 'none';
        pendingAutoFill = null;
      });

      // ── Wizi query presets ──
      var WIZI_PRESETS_KEY = 'cspm_wizi_presets';
      var wiziPresetSelect = document.getElementById('wizi-preset-select');
      var wiziPresetDeleteBtn = document.getElementById('btn-wizi-preset-delete');

      function loadWiziPresets() {
        try {
          var presets = JSON.parse(localStorage.getItem(WIZI_PRESETS_KEY) || '[]');
          wiziPresetSelect.innerHTML = '<option value="">📌 טען פריסט...</option>';
          presets.forEach(function(p, i) {
            var opt = document.createElement('option');
            opt.value = i;
            opt.textContent = p.name;
            wiziPresetSelect.appendChild(opt);
          });
        } catch(e) {}
      }

      function getWiziPresets() {
        try { return JSON.parse(localStorage.getItem(WIZI_PRESETS_KEY) || '[]'); } catch(e) { return []; }
      }

      document.getElementById('btn-wizi-preset-save').addEventListener('click', function() {
        var name = prompt('שם הפריסט:');
        if (!name) return;
        var preset = {
          name: name,
          queryType: wiziQueryTypeSelect.value,
          project: wiziProjectInput.value,
          projectId: wiziProjectId.value,
          subscription: wiziSubInput.value,
          severity: getSelectedValues(document.getElementById('wizi-severity')),
          status: getSelectedValues(wiziStatusSelect),
          limit: document.getElementById('wizi-limit').value
        };
        var presets = getWiziPresets();
        presets.push(preset);
        localStorage.setItem(WIZI_PRESETS_KEY, JSON.stringify(presets));
        loadWiziPresets();
        showToast('פריסט "' + name + '" נשמר', 'success');
      });

      wiziPresetSelect.addEventListener('change', function() {
        var idx = parseInt(this.value);
        if (isNaN(idx)) { wiziPresetDeleteBtn.style.display = 'none'; return; }
        var presets = getWiziPresets();
        var p = presets[idx];
        if (!p) return;

        wiziQueryTypeSelect.value = p.queryType || 'issues';
        wiziQueryTypeSelect.dispatchEvent(new Event('change'));
        wiziProjectInput.value = p.project || '';
        wiziProjectId.value = p.projectId || '';
        wiziSubInput.value = p.subscription || '';
        document.getElementById('wizi-limit').value = p.limit || '10';

        // Set severity selections
        if (p.severity) {
          var sevSelect = document.getElementById('wizi-severity');
          for (var i = 0; i < sevSelect.options.length; i++) {
            sevSelect.options[i].selected = p.severity.indexOf(sevSelect.options[i].value) >= 0;
          }
        }
        // Set status selections
        if (p.status) {
          for (var j = 0; j < wiziStatusSelect.options.length; j++) {
            wiziStatusSelect.options[j].selected = p.status.indexOf(wiziStatusSelect.options[j].value) >= 0;
          }
        }

        wiziPresetDeleteBtn.style.display = '';
        showToast('פריסט "' + p.name + '" נטען', 'info');
      });

      wiziPresetDeleteBtn.addEventListener('click', function() {
        var idx = parseInt(wiziPresetSelect.value);
        if (isNaN(idx)) return;
        var presets = getWiziPresets();
        var name = presets[idx] ? presets[idx].name : '';
        presets.splice(idx, 1);
        localStorage.setItem(WIZI_PRESETS_KEY, JSON.stringify(presets));
        loadWiziPresets();
        wiziPresetDeleteBtn.style.display = 'none';
        showToast('פריסט "' + name + '" נמחק', 'info');
      });

      loadWiziPresets();

      // ── Helper: extract recommendations from rule data ──
      // Prefers remediationInstructions (actual steps), falls back to description parsing
      function extractRecommendations(rule, sevLabel) {
        var recs = [];

        // 1. Use remediationInstructions if available (actual remediation steps)
        var ri = (rule.remediationInstructions || '').trim();
        if (ri) {
          // Extract code block contents and replace blocks with their content
          var cleaned = ri
            .replace(/```(?:\w*\n)?([\s\S]*?)```/g, function(_, code) {
              return code.trim();
            })
            .replace(/\s*\n\s*/g, '\n');     // normalize whitespace
          var lines = cleaned.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
          lines.forEach(function(line) {
            // Skip very short lines, pure formatting, or "Note:" disclaimers
            if (line.length < 15) return;
            if (/^note:/i.test(line)) return;
            recs.push(line);
          });
        }

        // 2. Fallback: extract from description — but ONLY "It is recommended" sentences
        if (!recs.length && rule.description) {
          var sentences = rule.description.split(/(?:\.\s+|\n)/).map(function(s) { return s.trim().replace(/\s+/g, ' '); }).filter(Boolean);
          sentences.forEach(function(s) {
            // Only take explicit recommendation sentences, skip rule-check/fail/skip descriptions
            if (/^this rule (checks|fails|skips|is)/i.test(s)) return;
            if (/^this rule$/i.test(s)) return;
            if (/it is recommended|you should|we recommend|consider /i.test(s) && s.length > 20 && s.length < 400) {
              recs.push(s.replace(/\.$/, ''));
            }
          });
        }

        // 3. Last resort: generic Hebrew recommendation
        if (!recs.length) {
          recs.push('לטפל בממצא בהתאם לרמת החומרה (' + sevLabel + ')');
        }

        return recs;
      }

      // AI remediation summary cache (keyed by remediation text hash)
      var _aiSummaryCache = {};

      function fetchRemediationSummary(finding, retries) {
        var recsText = (finding.recs || []).join('\n');
        if ((!recsText || recsText.length < 30) && !finding.description) return Promise.resolve(null);
        retries = retries || 0;
        var cacheKey = (finding.title || '') + '|' + recsText.substring(0, 200);
        if (_aiSummaryCache[cacheKey]) return Promise.resolve(_aiSummaryCache[cacheKey]);

        return fetch('/api/summarize-remediation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: finding.title || '',
            description: finding.description || '',
            text: recsText
          })
        })
        .then(function(r) {
          if ((r.status === 429 || r.status === 502) && retries < 3) {
            var delay = (retries + 1) * 3000;
            console.warn('AI summary error ' + r.status + ', retrying in ' + delay + 'ms...');
            return new Promise(function(resolve) { setTimeout(resolve, delay); })
              .then(function() { return fetchRemediationSummary(finding, retries + 1); });
          }
          if (!r.ok) {
            return r.json().catch(function() { return {}; }).then(function(d) {
              var errMsg = d.error || ('HTTP ' + r.status);
              throw new Error(errMsg);
            });
          }
          return r.json();
        })
        .then(function(data) {
          if (data && data.summary) {
            _aiSummaryCache[cacheKey] = data.summary;
            return data.summary;
          }
          return null;
        });
      }

      function enrichFindingsWithAiSummaries(findingsToEnrich) {
        var toEnrich = findingsToEnrich.filter(function(f) {
          if (!f.recs || !f.recs.length) return false;
          if (f.recs.length === 1 && f.recs[0].indexOf('לטפל בממצא') === 0) return false;
          return true;
        });

        if (!toEnrich.length) return Promise.resolve();

        // Create progress bar
        var container = document.createElement('div');
        container.className = 'ai-progress-container';
        container.innerHTML =
          '<div class="ai-progress-header"><span class="ai-spinner"></span><span>🤖 מייצר סיכומי AI להמלצות</span></div>' +
          '<div class="ai-progress-track"><div class="ai-progress-fill" id="ai-progress-fill"></div></div>' +
          '<div class="ai-progress-label"><span id="ai-progress-label">0 / ' + toEnrich.length + '</span><button class="ai-progress-abort" id="ai-progress-abort">ביטול</button></div>';
        document.body.appendChild(container);

        var fillEl = container.querySelector('#ai-progress-fill');
        var labelEl = container.querySelector('#ai-progress-label');
        var aborted = false;

        container.querySelector('#ai-progress-abort').addEventListener('click', function() {
          aborted = true;
        });
        var idx = 0;
        var enriched = 0;

        function updateProgress() {
          var pct = Math.round((idx / toEnrich.length) * 100);
          fillEl.style.width = pct + '%';
          labelEl.textContent = idx + ' / ' + toEnrich.length + (enriched ? ' (' + enriched + ' הוספו)' : '');
        }

        function processNext() {
          if (aborted) {
            container.querySelector('.ai-spinner').style.display = 'none';
            container.querySelector('.ai-progress-header span:last-child').textContent = '⏹ בוטל';
            labelEl.textContent = enriched + ' סיכומים נוספו';
            container.querySelector('#ai-progress-abort').style.display = 'none';
            setTimeout(function() {
              if (container.parentNode) container.parentNode.removeChild(container);
            }, 1500);
            autoSave();
            return Promise.resolve();
          }
          if (idx >= toEnrich.length) {
            // Done — show completion briefly then remove
            fillEl.style.width = '100%';
            container.querySelector('.ai-spinner').style.display = 'none';
            container.querySelector('.ai-progress-header span:last-child').textContent = '✅ סיכומי AI הושלמו';
            labelEl.textContent = enriched + ' סיכומים נוספו';
            container.querySelector('#ai-progress-abort').style.display = 'none';
            setTimeout(function() {
              if (container.parentNode) container.parentNode.removeChild(container);
            }, 2000);
            autoSave();
            return Promise.resolve();
          }
          var f = toEnrich[idx++];
          updateProgress();
          return fetchRemediationSummary(f).then(function(summary) {
            if (summary) {
              f.recs.unshift('🤖 ' + summary);
              enriched++;
              renderFindingsTable();
            }
            updateProgress();
          }).then(function() {
            return new Promise(function(resolve) { setTimeout(resolve, 500); });
          }).then(processNext)
          .catch(function(err) {
            // Failed after retries — abort and notify
            fillEl.style.background = 'var(--danger)';
            container.querySelector('.ai-spinner').style.display = 'none';
            container.querySelector('.ai-progress-header span:last-child').textContent = '❌ שיפור ההמלצות נכשל';
            labelEl.textContent = err.message || 'שגיאה בלתי צפויה';
            var abortBtn = container.querySelector('#ai-progress-abort');
            abortBtn.textContent = 'אישור';
            abortBtn.style.background = 'var(--accent)';
            abortBtn.style.color = 'white';
            abortBtn.style.borderColor = 'var(--accent)';
            abortBtn.onclick = function() {
              if (container.parentNode) container.parentNode.removeChild(container);
            };
            autoSave();
          });
        }

        return processNext();
      }

      function importIssueFinding(issue) {
        var rules = issue.sourceRules || [];
        var rule = rules.length ? rules[0] : {};
        var entity = issue.entitySnapshot || {};
        var sev = mapWiziSeverity(issue.severity);
        var cat = mapWiziCategory(entity);
        var id = generateNextId(cat);

        // Title: rule name or issue description
        var title = rule.name || issue.description || 'Wizi Issue ' + issue.id;

        // Description: concise finding summary
        var description = issue.description || rule.name || '';

        // Impact: severity-based context
        var sevLabel = (severityMap[sev] || {}).text || sev;
        var impact = 'חשיפת משאב לסיכון ברמת ' + sevLabel;
        if (entity.name) impact += ' — ' + entity.name;

        // Technical: resource details + rule description excerpt
        var technical = [];
        if (entity.cloudPlatform) technical.push('Cloud: ' + entity.cloudPlatform);
        if (entity.subscriptionName) technical.push('Subscription: ' + entity.subscriptionName);
        if (entity.region) technical.push('Region: ' + entity.region);
        if (entity.name) technical.push('Entity: ' + entity.name);
        if (entity.nativeType) technical.push('Type: ' + entity.nativeType);
        if (rule.description) {
          var ruleLines = rule.description.split(/[.\n]/).map(function(s){return s.trim();}).filter(Boolean);
          if (ruleLines.length) technical.push('Rule: ' + ruleLines[0]);
        }

        // Recommendations: from rule description (not notes — those are user comments)
        var recs = extractRecommendations(rule, sevLabel);

        // Add issue notes to technical details if present
        var notes = (issue.notes || []).map(function(n) { return n.text || ''; }).filter(Boolean);
        if (notes.length) {
          notes.forEach(function(n) { technical.push('Note: ' + n); });
        }

        var owner = '';
        var projects = (issue.projects || []).map(function(p) { return p.name; }).filter(Boolean);
        if (projects.length) owner = projects.join(', ');
        else if (entity.subscriptionName) owner = entity.subscriptionName;

        findings.push({
          id: id,
          category: cat,
          title: title,
          severity: sev,
          description: description,
          impact: impact,
          technical: technical,
          policies: [],
          recs: recs,
          priority: '',
          owner: owner,
          evidence: []
        });
      }

      function importConfigFinding(item) {
        var rule = item.rule || {};
        var resource = item.resource || {};
        var sub = resource.subscription || {};
        var sev = mapWiziSeverity(item.severity);
        var cat = 'CSPM';
        var id = generateNextId(cat);

        // Title: rule name (what the rule checks for)
        var title = rule.name || item.name || 'Config Finding ' + item.id;

        // Description: item.name is the actual finding (e.g. "Launch Template is using IMDSv1")
        var description = item.name || rule.name || '';

        // Impact: severity-based + resource context
        var sevLabel = (severityMap[sev] || {}).text || sev;
        var impact = 'חשיפת משאב לסיכון ברמת ' + sevLabel;
        if (resource.name) impact += ' — ' + resource.name;

        // Technical: resource details + first paragraph of rule description
        var technical = [];
        if (sub.cloudProvider) technical.push('Cloud: ' + sub.cloudProvider);
        if (sub.name) technical.push('Subscription: ' + sub.name);
        if (resource.region) technical.push('Region: ' + resource.region);
        if (resource.name) technical.push('Resource: ' + resource.name);
        if (resource.nativeType || resource.type) technical.push('Type: ' + (resource.nativeType || resource.type));
        if (item.result) technical.push('Result: ' + item.result);
        if (rule.description) {
          var ruleLines = rule.description.split(/[.\n]/).map(function(s){return s.trim();}).filter(Boolean);
          if (ruleLines.length) technical.push('Rule Detail: ' + ruleLines[0]);
        }

        // Policies: map securitySubCategories to known framework names (deduplicated)
        // Priority order: most recognized/relevant frameworks first, cap at 4
        var frameworkPriority = [
          'ISO 27001', 'NIST CSF', 'CIS Controls', 'PCI-DSS', 'SOC 2',
          'NIST 800-53', 'NIST CSF 2.0', 'DORA', 'NIS2', 'CSA CCM',
          'AWS Security Best Practices', 'CIS AWS Benchmark', 'C5', 'IT Security Standards'
        ];
        var frameworkPatterns = [
          { re: /^(?:Organizational|Technological|People) controls/i, name: 'ISO 27001' },
          { re: /^\d+ (?:Inventory and Control|Secure Configuration|Account Management|Access Control Management|Malware Defenses|Network Infrastructure|Network Monitoring|Penetration Testing|Reduce Attack|Prevent Compromise|Restrict Internet)/i, name: 'CIS Controls' },
          { re: /^Data and Infrastructure Security|^Access control of cloud service|^Technical vulnerability management|^Security in development/i, name: 'CSA CCM' },
          { re: /^\d+(?:\.\d+)? Application Software Security/i, name: 'CIS Controls' },
          { re: /^(?:SI|AC|AU|CA|CM|CP|IA|IR|MA|MP|PE|PL|PM|PS|RA|SA|SC|SE) /i, name: 'NIST 800-53' },
          { re: /^Art \d+.*CHAPTER/i, name: 'DORA' },
          { re: /^Article \d+.*Cybersecurity/i, name: 'NIS2' },
          { re: /^\d+\.\d+ Product Safety and Security/i, name: 'C5' },
          { re: /^Protection of data and network functions/i, name: 'C5' },
          { re: /^(?:ID|PR|DE|RS|RC|GV)\.[A-Z]{2}/i, name: 'NIST CSF' },
          { re: /^PROTECT -|^IDENTIFY -|^DETECT -|^RESPOND -|^RECOVER -|^GOVERN -/i, name: 'NIST CSF 2.0' },
          { re: /^Elastic Compute Cloud|^Amazon |^AWS /i, name: 'AWS Security Best Practices' },
          { re: /^A\d+ /i, name: 'CIS AWS Benchmark' },
          { re: /^\d+\.\d+ (?:System components|Malicious software|Restrict physical|Maintain a policy|Build and maintain|Protect stored|Encrypt transmission|Track and monitor|Regularly test)/i, name: 'PCI-DSS' },
          { re: /^CC\d+/i, name: 'SOC 2' },
          { re: /^Patch Management|^Software & Application Management/i, name: 'IT Security Standards' },
        ];
        var policySet = {};
        (item.securitySubCategories || []).forEach(function(sc) {
          var catName = (sc.category && sc.category.name) ? sc.category.name.trim() : '';
          var scTitle = sc.title || '';
          var fullText = catName ? catName + ' ' + scTitle : scTitle;
          for (var i = 0; i < frameworkPatterns.length; i++) {
            if (frameworkPatterns[i].re.test(fullText) || frameworkPatterns[i].re.test(catName)) {
              policySet[frameworkPatterns[i].name] = true;
              break;
            }
          }
        });
        // Sort by priority and take top 4
        var policies = frameworkPriority.filter(function(f) { return policySet[f]; }).slice(0, 4);

        // Recommendations: use remediationInstructions or extract from description
        var recs = extractRecommendations(rule, sevLabel);

        findings.push({
          id: id,
          category: cat,
          title: title,
          severity: sev,
          description: description,
          impact: impact,
          technical: technical,
          policies: policies,
          recs: recs,
          priority: '',
          owner: sub.name || '',
          evidence: []
        });
      }

      function importVulnFinding(item) {
        var sev = mapWiziSeverity(item.severity);
        var cat = 'VULN';
        var id = generateNextId(cat);

        // Title: CVE name or detailed name
        var title = item.name || item.detailedName || 'Vuln Finding ' + item.id;

        // Description: CVE description or general vuln description
        var description = item.CVEDescription || item.description || title;

        // Impact: severity + exploit context
        var sevLabel = (severityMap[sev] || {}).text || sev;
        var impact = 'פגיעות ברמת ' + sevLabel;
        if (item.score != null) impact += ' (CVSS: ' + item.score + ')';
        if (item.hasExploit) impact += ' — קיים Exploit ידוע';

        // Technical details
        var technical = [];
        if (item.score != null) technical.push('CVSS Score: ' + item.score);
        if (item.version) technical.push('Affected Version: ' + item.version);
        if (item.hasExploit) technical.push('Exploit Available: כן');
        if (item.hasFix) technical.push('Fix Available: כן');
        if (item.fixedVersion) technical.push('Fixed Version: ' + item.fixedVersion);
        var projects = (item.projects || []).map(function(p) { return p.name; }).filter(Boolean);
        if (projects.length) technical.push('Projects: ' + projects.join(', '));
        if (item.firstDetectedAt) technical.push('First Detected: ' + item.firstDetectedAt.split('T')[0]);

        // Recommendations
        var recs = [];
        if (item.remediation) recs.push(item.remediation);
        if (item.fixedVersion) recs.push('עדכון לגרסה: ' + item.fixedVersion);
        if (!recs.length) recs.push('לטפל בפגיעות בהתאם לרמת החומרה (' + sevLabel + ')');

        findings.push({
          id: id,
          category: cat,
          title: title,
          severity: sev,
          description: description,
          impact: impact,
          technical: technical,
          policies: [],
          recs: recs,
          priority: '',
          owner: projects.length ? projects.join(', ') : '',
          evidence: []
        });
      }

      function importHostConfigFinding(item) {
        var sev = mapWiziSeverity(item.severity);
        var cat = 'HSPM';
        var id = generateNextId(cat);
        var rule = item.rule || {};
        var res = item.resource || {};
        var sub = res.subscription || {};

        // Title: rule name
        var title = rule.name || 'Host Config Finding ' + item.id;

        // Description: rule description excerpt (node has no name field)
        var description = rule.name || '';

        // Impact
        var sevLabel = (severityMap[sev] || {}).text || sev;
        var impact = 'חשיפת Host לסיכון ברמת ' + sevLabel;
        if (res.name) impact += ' — ' + res.name;

        // Technical
        var technical = [];
        if (res.cloudPlatform) technical.push('Cloud: ' + res.cloudPlatform);
        if (sub.name) technical.push('Subscription: ' + sub.name);
        if (res.region) technical.push('Region: ' + res.region);
        if (res.name) technical.push('Resource: ' + res.name);
        if (res.nativeType) technical.push('Type: ' + res.nativeType);
        if (item.result) technical.push('Result: ' + item.result);
        if (rule.description) {
          var ruleLines = rule.description.split(/[.\n]/).map(function(s){return s.trim();}).filter(Boolean);
          if (ruleLines.length) technical.push('Rule Detail: ' + ruleLines[0]);
        }

        // Recommendations
        var recs = extractRecommendations(rule, sevLabel);

        findings.push({
          id: id, category: cat,
          title: title,
          severity: sev,
          description: description,
          impact: impact,
          technical: technical,
          policies: [], recs: recs, priority: '',
          owner: sub.name || '',
          evidence: []
        });
      }

      function importDataFinding(item) {
        var sev = mapWiziSeverity(item.severity);
        var cat = 'DSPM';
        var id = generateNextId(cat);
        var classifier = item.dataClassifier || {};
        var entity = item.graphEntity || {};
        var account = item.cloudAccount || {};

        // Title
        var title = item.name || classifier.name || 'Data Finding ' + item.id;

        // Description
        var description = 'זוהה מידע רגיש מסוג ' + (classifier.name || item.name || 'לא ידוע');
        if (entity.name) description += ' במשאב ' + entity.name;

        // Impact
        var sevLabel = (severityMap[sev] || {}).text || sev;
        var impact = 'חשיפת נתונים רגישים ברמת ' + sevLabel;
        if (classifier.category) impact += ' (קטגוריה: ' + classifier.category + ')';

        // Technical
        var technical = [];
        if (account.cloudProvider) technical.push('Cloud: ' + account.cloudProvider);
        if (account.name) technical.push('Account: ' + account.name);
        if (entity.name) technical.push('Entity: ' + entity.name);
        if (entity.type) technical.push('Type: ' + entity.type);
        if (classifier.category) technical.push('Category: ' + classifier.category);

        // Recommendations
        var recs = ['לבצע סיווג נתונים ולהגדיר בקרות גישה מתאימות', 'לוודא הצפנת נתונים רגישים'];

        findings.push({
          id: id, category: cat,
          title: title,
          severity: sev,
          description: description,
          impact: impact,
          technical: technical,
          policies: [], recs: recs, priority: '',
          owner: account.name || '',
          evidence: []
        });
      }

      function importSecretFinding(item) {
        var sev = mapWiziSeverity(item.severity);
        var cat = 'SECR';
        var id = generateNextId(cat);
        var res = item.resource || {};
        var rule = item.rule || {};

        // Title
        var title = item.name || rule.name || 'Secret Finding ' + item.id;

        // Description
        var description = 'זוהה סוד חשוף מסוג ' + (item.type || 'לא ידוע');
        if (res.name) description += ' במשאב ' + res.name;
        if (item.path) description += ' (נתיב: ' + item.path + ')';

        // Impact
        var sevLabel = (severityMap[sev] || {}).text || sev;
        var impact = 'חשיפת סוד ברמת ' + sevLabel + ' — עלול לאפשר גישה לא מורשית למשאבים';

        // Technical
        var technical = [];
        if (res.cloudPlatform) technical.push('Cloud: ' + res.cloudPlatform);
        if (res.name) technical.push('Resource: ' + res.name);
        if (res.nativeType) technical.push('Type: ' + res.nativeType);
        if (res.region) technical.push('Region: ' + res.region);
        if (item.type) technical.push('Secret Type: ' + item.type);
        if (item.path) technical.push('Path: ' + item.path);

        // Recommendations
        var recs = ['לבצע רוטציה מיידית של הסוד החשוף', 'להעביר סודות ל-Secrets Manager / Key Vault'];

        findings.push({
          id: id, category: cat,
          title: title,
          severity: sev,
          description: description,
          impact: impact,
          technical: technical,
          policies: [], recs: recs, priority: '',
          owner: res.name || res.cloudPlatform || '',
          evidence: []
        });
      }

      function importExcessiveAccessFinding(item) {
        var sev = mapWiziSeverity(item.severity);
        var cat = 'EAPM';
        var id = generateNextId(cat);
        var principal = item.principal || {};
        var ge = principal.graphEntity || {};
        var ca = principal.cloudAccount || {};

        // Title
        var title = item.name || 'Excessive Access ' + item.id;

        // Description
        var description = item.description || title;

        // Impact
        var sevLabel = (severityMap[sev] || {}).text || sev;
        var impact = 'הרשאות יתר ברמת ' + sevLabel;
        if (ge.name) impact += ' — ' + ge.name;
        if (ge.type) impact += ' (' + ge.type + ')';

        // Technical
        var technical = [];
        if (item.cloudPlatform) technical.push('Cloud: ' + item.cloudPlatform);
        if (ca.name) technical.push('Account: ' + ca.name);
        if (ge.name) technical.push('Principal: ' + ge.name);
        if (ge.type) technical.push('Principal Type: ' + ge.type);
        if (item.remediationType) technical.push('Remediation Type: ' + item.remediationType);

        // Recommendations — remediationInstructions is on the node itself (not rule)
        var recs = extractRecommendations(
          { remediationInstructions: item.remediationInstructions || '', description: item.description || '' },
          sevLabel
        );

        findings.push({
          id: id, category: cat,
          title: title,
          severity: sev,
          description: description,
          impact: impact,
          technical: technical,
          policies: [], recs: recs,
          priority: '',
          owner: ca.name || '',
          evidence: []
        });
      }

      function importNetworkExposureFinding(item) {
        var cat = 'NEXP';
        var id = generateNextId(cat);
        var entity = item.exposedEntity || {};
        var isPublic = (item.sourceIpRange || '').indexOf('0.0.0.0') >= 0;
        var sev = isPublic ? 'high' : 'medium';

        // Title
        var title = 'Network Exposure — ' + (entity.name || item.id);

        // Description
        var description = 'חשיפת רשת של ' + (entity.name || 'משאב') + ' מ-' + (item.sourceIpRange || 'unknown');
        if (item.portRange) description += ' בפורטים ' + item.portRange;

        // Impact
        var sevLabel = (severityMap[sev] || {}).text || sev;
        var impact = 'חשיפת רשת ברמת ' + sevLabel;
        if (isPublic) impact += ' — המשאב נגיש מהאינטרנט (0.0.0.0/0)';

        // Technical
        var technical = [];
        if (entity.name) technical.push('Entity: ' + entity.name);
        if (entity.type) technical.push('Type: ' + entity.type);
        if (item.sourceIpRange) technical.push('Source IP: ' + item.sourceIpRange);
        if (item.portRange) technical.push('Port Range: ' + item.portRange);
        if (item.type) technical.push('Exposure Type: ' + item.type);

        // Recommendations
        var recs = [];
        if (isPublic) recs.push('להגביל גישה מ-0.0.0.0/0 לטווחי IP ספציפיים');
        recs.push('לוודא שרק פורטים נדרשים פתוחים');
        recs.push('להשתמש ב-Private Endpoint / VPN במידת האפשר');

        findings.push({
          id: id, category: cat,
          title: title,
          severity: sev,
          description: description,
          impact: impact,
          technical: technical,
          policies: [], recs: recs, priority: '',
          owner: entity.name || '',
          evidence: []
        });
      }

      function importInventoryFinding(item) {
        var sev = mapWiziSeverity(item.severity);
        var cat = 'EOLM';
        var id = generateNextId(cat);
        var rule = item.rule || {};
        var res = item.resource || {};
        var ca = res.cloudAccount || {};

        // Title
        var title = rule.name || 'Inventory Finding ' + item.id;

        // Description
        var description = item.name || rule.name || '';

        // Impact
        var sevLabel = (severityMap[sev] || {}).text || sev;
        var impact = 'משאב בסוף חיים (EOL) ברמת ' + sevLabel;
        if (res.name) impact += ' — ' + res.name;

        // Technical
        var technical = [];
        if (res.cloudPlatform) technical.push('Cloud: ' + res.cloudPlatform);
        if (ca.name) technical.push('Account: ' + ca.name);
        if (res.region) technical.push('Region: ' + res.region);
        if (res.name) technical.push('Resource: ' + res.name);
        if (res.nativeType) technical.push('Type: ' + res.nativeType);
        if (rule.description) {
          var ruleLines = rule.description.split(/[.\n]/).map(function(s){return s.trim();}).filter(Boolean);
          if (ruleLines.length) technical.push('Rule Detail: ' + ruleLines[0]);
        }

        // Recommendations
        var recs = ['לעדכן או להחליף את המשאב לגרסה נתמכת', 'לתכנן מיגרציה בהתאם ללוח הזמנים של הספק'];

        findings.push({
          id: id, category: cat,
          title: title,
          severity: sev,
          description: description,
          impact: impact,
          technical: technical,
          policies: [], recs: recs, priority: '',
          owner: ca.name || '',
          evidence: []
        });
      }

      // ── Bulk Import ──
      var bulkImportResults = {};
      var bulkImportRunning = false;

      function handleBulkImport() {
        var subInput = document.getElementById('bulk-import-sub');
        var progressDiv = document.getElementById('bulk-import-progress');
        var resultsDiv = document.getElementById('bulk-import-results');
        var actionsDiv = document.getElementById('bulk-import-actions');
        var btn = document.getElementById('btn-bulk-import');

        var sub = (subInput.value || '').trim();
        if (!sub) {
          progressDiv.textContent = 'יש להזין שם Subscription';
          return;
        }

        bulkImportRunning = true;
        btn.disabled = true;
        resultsDiv.innerHTML = '';
        progressDiv.textContent = 'מבצע ייבוא מרוכז...';
        actionsDiv.style.display = 'none';
        var bulkProg = document.getElementById('bulk-progress-bar');
        var bulkProgFill = document.getElementById('bulk-progress-fill');
        var bulkProgText = document.getElementById('bulk-progress-text');
        if (bulkProg) { bulkProg.classList.add('active'); bulkProgFill.style.width = '30%'; bulkProgText.textContent = 'מייבא נתונים מ-Wizi...'; }

        fetch('/api/wizi/bulk-fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub })
        })
        .then(function(resp) {
          if (resp.status === 501) {
            progressDiv.textContent = 'Wizi לא מוגדר';
            return null;
          }
          if (resp.status === 429) {
            progressDiv.textContent = 'חריגה ממגבלת קצב בקשות';
            return null;
          }
          if (!resp.ok) {
            return resp.json().then(function(err) {
              progressDiv.textContent = err.error || 'שגיאה בשליפת נתונים';
              return null;
            });
          }
          return resp.json();
        })
        .then(function(data) {
          if (data) {
            renderBulkResults(data);
            // Auto-fill report details from bulk import results
            if (!document.getElementById('report-client').value.trim()) {
              var resolved = data.resolvedSubscription || {};
              // Use resolved externalIds for client name (cloud provider subscription IDs)
              var clientName = (resolved.externalIds || []).join(', ') || (resolved.names || []).join(', ');

              // Detect cloud platforms and key topics from results
              var clouds = {};
              var topics = {};
              var results = data.results || {};
              Object.keys(results).forEach(function(qt) {
                var nodes = (results[qt] || {}).nodes || [];
                if (!nodes.length) return;
                var d = extractWiziAutoFillData(nodes, qt);
                if (d.cloud) d.cloud.split(', ').forEach(function(c) { clouds[c] = true; });
                if (d.keyTopics) d.keyTopics.split('\n').forEach(function(t) { topics[t] = true; });
              });

              var mergedData = {
                subscription: clientName,
                cloud: Object.keys(clouds).join(', '),
                keyTopics: Object.keys(topics).join('\n')
              };
              if (mergedData.subscription || mergedData.cloud) {
                showWiziAutoFillBanner(mergedData);
              }
            }
          }
        })
        .catch(function() {
          progressDiv.textContent = 'שגיאת רשת';
        })
        .finally(function() {
          btn.disabled = false;
          bulkImportRunning = false;
          var bulkProg = document.getElementById('bulk-progress-bar');
          if (bulkProg) bulkProg.classList.remove('active');
        });
      }

      function renderBulkResults(data) {
        var progressDiv = document.getElementById('bulk-import-progress');
        var resultsDiv = document.getElementById('bulk-import-results');
        var actionsDiv = document.getElementById('bulk-import-actions');

        var queryTypeLabels = {
          'issues': 'Issues (כללי)',
          'configurationFindings': 'CSPM — Cloud Configuration',
          'vulnerabilityFindings': 'VULN — Vulnerabilities',
          'hostConfigurationRuleAssessments': 'HSPM — Host Configuration',
          'dataFindingsV2': 'DSPM — Data Findings',
          'secretInstances': 'SECR — Secrets',
          'excessiveAccessFindings': 'EAPM — Excessive Access',
          'networkExposures': 'NEXP — Network Exposure',
          'inventoryFindings': 'EOLM — Inventory / EOL'
        };

        var resolved = data.resolvedSubscription || {};
        var results = data.results || {};
        var errors = data.errors || {};

        // Warning toast if subscription not resolved
        if ((!resolved.ids || !resolved.ids.length) && (!resolved.externalIds || !resolved.externalIds.length)) {
          showToast('לא נמצא Subscription תואם — התוצאות עשויות להיות חלקיות', 'warning');
        }

        // Show per-query-type errors
        var errorKeys = Object.keys(errors);
        var progressHtml = '';
        if (errorKeys.length) {
          errorKeys.forEach(function(qt) {
            var label = queryTypeLabels[qt] || qt;
            progressHtml += '<div style="color:var(--warning,#f59e0b);">⚠ ' + escapeHtml(label) + ': ' + escapeHtml(errors[qt]) + '</div>';
          });
        }

        // Store results and compute counts
        bulkImportResults = {};
        var totalCount = 0;
        var breakdownParts = [];
        var queryTypes = Object.keys(queryTypeLabels);

        // Get the subscription search term for client-side filtering (EAPM)
        var bulkSubSearch = (document.getElementById('bulk-import-sub').value || '').trim().toLowerCase();

        queryTypes.forEach(function(qt) {
          var r = results[qt] || {};
          var nodes = r.nodes || [];

          // Client-side subscription filter for excessiveAccessFindings (no server-side filter)
          if (qt === 'excessiveAccessFindings' && nodes.length && bulkSubSearch) {
            nodes = nodes.filter(function(n) {
              var p = n.principal || {};
              var pca = p.cloudAccount || {};
              var subName = (pca.name || '').toLowerCase();
              var subExtId = (pca.externalId || '').toLowerCase();
              return subName.indexOf(bulkSubSearch) >= 0 || subExtId.indexOf(bulkSubSearch) >= 0;
            });
          }

          if (nodes.length) {
            bulkImportResults[qt] = nodes;
            totalCount += nodes.length;
            breakdownParts.push((queryTypeLabels[qt]) + ': ' + nodes.length);
          }
        });

        // Empty state
        if (totalCount === 0 && errorKeys.length === 0) {
          progressDiv.innerHTML = 'לא נמצאו ממצאים עבור Subscription זה';
          resultsDiv.innerHTML = '';
          return;
        }

        // Progress summary
        progressHtml += '<div><strong>סה"כ: ' + totalCount + ' ממצאים</strong></div>';
        if (breakdownParts.length) {
          progressHtml += '<div>' + breakdownParts.join(' · ') + '</div>';
        }
        progressDiv.innerHTML = progressHtml;

        // Build results table
        var html = '';
        var bulkPageState = {};
        var defaultPageSize = 20;

        queryTypes.forEach(function(qt) {
          var nodes = bulkImportResults[qt];
          if (!nodes || !nodes.length) return;
          var label = queryTypeLabels[qt];
          bulkPageState[qt] = { page: 0, pageSize: defaultPageSize };

          html += '<details class="bulk-section-card" data-qt="' + qt + '">';
          html += '<summary class="bulk-section-summary"><span class="bulk-section-icon">' + (qt === 'vulnerabilityFindings' ? '🛡️' : qt === 'configurationFindings' ? '⚙️' : qt === 'secretInstances' ? '🔑' : qt === 'excessiveAccessFindings' ? '👤' : qt === 'networkExposures' ? '🌐' : qt === 'hostConfigurationRuleAssessments' ? '🖥️' : qt === 'dataFindingsV2' ? '💾' : qt === 'inventoryFindings' ? '📦' : '📋') + '</span><span class="bulk-section-label">' + escapeHtml(label) + '</span><span class="bulk-section-count">' + nodes.length + '</span></summary>';
          html += '<div class="bulk-section-body" id="bulk-body-' + qt + '"></div>';
          html += '</details>';
        });

        resultsDiv.innerHTML = html;
        actionsDiv.style.display = '';

        function getBulkSortValue(node, qt, col) {
          var sevOrder = { critical: 1, high: 2, medium: 3, low: 4, info: 5 };
          if (col === 'severity') return sevOrder[mapWiziSeverity(node.severity)] || 9;
          if (col === 'title') return (getWiziItemTitle(node, qt) || '').toLowerCase();
          if (col === 'subscription') return (getNodeSubscriptionName(node, qt) || '').toLowerCase();
          if (col === 'resource') {
            if (qt === 'vulnerabilityFindings') return ((node.vulnerableAsset || {}).name || '').toLowerCase();
            if (qt === 'secretInstances') return ((node.resource || {}).name || '').toLowerCase();
            return '';
          }
          if (col === 'resourceType') return ((node.vulnerableAsset || {}).type || '').toLowerCase();
          if (col === 'type') return qt;
          return '';
        }

        function renderBulkPage(qt) {
          var nodes = bulkImportResults[qt];
          if (!nodes) return;
          var state = bulkPageState[qt];
          var start = state.page * state.pageSize;
          var end = Math.min(start + state.pageSize, nodes.length);
          var totalPages = Math.ceil(nodes.length / state.pageSize);
          var label = queryTypeLabels[qt];

          // Sort nodes if sort is active
          if (state.sortCol) {
            var dir = state.sortDir || 'asc';
            nodes = nodes.slice().sort(function(a, b) {
              var va = getBulkSortValue(a, qt, state.sortCol);
              var vb = getBulkSortValue(b, qt, state.sortCol);
              if (va < vb) return dir === 'asc' ? -1 : 1;
              if (va > vb) return dir === 'asc' ? 1 : -1;
              return 0;
            });
            bulkImportResults[qt] = nodes;
          }

          var bodyEl = document.getElementById('bulk-body-' + qt);
          if (!bodyEl) return;

          function sortIndicator(col) {
            if (state.sortCol !== col) return ' <span class="sort-arrow">⇅</span>';
            return state.sortDir === 'asc' ? ' <span class="sort-arrow active">↑</span>' : ' <span class="sort-arrow active">↓</span>';
          }

          var h = '';
          // Pagination controls top - info + page size
          h += '<div class="bulk-pagination-top">';
          h += '<span class="bulk-pagination-info">' + (start + 1) + '–' + end + ' מתוך ' + nodes.length + '</span>';
          h += '<select class="bulk-page-size" data-qt="' + qt + '">';
          [20, 50, 100, 200].forEach(function(s) {
            h += '<option value="' + s + '"' + (s === state.pageSize ? ' selected' : '') + '>' + s + '</option>';
          });
          h += '</select>';
          h += '</div>';

          // Table with sortable headers
          h += '<table class="findings-table" style="width:100%;font-size:12px;"><thead><tr>';
          h += '<th style="width:30px;"><input type="checkbox" class="bulk-section-check" data-query-type="' + qt + '" checked></th>';
          h += '<th class="sortable-th" data-sort-col="type" data-qt="' + qt + '">סוג' + sortIndicator('type') + '</th>';
          h += '<th class="sortable-th" data-sort-col="severity" data-qt="' + qt + '">חומרה' + sortIndicator('severity') + '</th>';
          h += '<th class="sortable-th" data-sort-col="title" data-qt="' + qt + '">כותרת' + sortIndicator('title') + '</th>';
          if (qt === 'vulnerabilityFindings') {
            h += '<th class="sortable-th" data-sort-col="resource" data-qt="' + qt + '">משאב' + sortIndicator('resource') + '</th>';
            h += '<th class="sortable-th" data-sort-col="resourceType" data-qt="' + qt + '">סוג משאב' + sortIndicator('resourceType') + '</th>';
          }
          if (qt === 'secretInstances') {
            h += '<th class="sortable-th" data-sort-col="resource" data-qt="' + qt + '">משאב' + sortIndicator('resource') + '</th>';
          }
          h += '<th class="sortable-th" data-sort-col="subscription" data-qt="' + qt + '">Subscription' + sortIndicator('subscription') + '</th>';
          h += '</tr></thead><tbody>';

          for (var i = start; i < end; i++) {
            var node = nodes[i];
            var sev = mapWiziSeverity(node.severity);
            var sevInfo = severityMap[sev] || severityMap.medium;
            var title = getWiziItemTitle(node, qt);
            var subName = getNodeSubscriptionName(node, qt);

            h += '<tr>';
            h += '<td><input type="checkbox" class="bulk-check" data-query-type="' + qt + '" data-node-index="' + i + '" checked></td>';
            h += '<td><span class="tag-inline">' + escapeHtml(label) + '</span></td>';
            h += '<td><span class="severity-chip ' + sevInfo.class + '">' + sevInfo.text + '</span></td>';
            h += '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</td>';
            if (qt === 'vulnerabilityFindings') {
              var asset = node.vulnerableAsset || {};
              h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(asset.name || '') + '">' + escapeHtml(asset.name || '—') + '</td>';
              h += '<td>' + escapeHtml(asset.type || '—') + '</td>';
            }
            if (qt === 'secretInstances') {
              var res = node.resource || {};
              h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(res.name || '') + '">' + escapeHtml(res.name || '—') + '</td>';
            }
            h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(subName) + '">' + escapeHtml(subName || '—') + '</td>';
            h += '</tr>';
          }

          h += '</tbody></table>';

          // Pagination controls below table
          if (totalPages > 1) {
            h += '<div class="bulk-pagination-bottom">';
            h += '<button class="btn btn-secondary btn-sm bulk-page-btn" data-qt="' + qt + '" data-dir="prev"' + (state.page === 0 ? ' disabled' : '') + '>▶</button>';
            h += '<span class="bulk-pagination-page">' + (state.page + 1) + ' / ' + totalPages + '</span>';
            h += '<button class="btn btn-secondary btn-sm bulk-page-btn" data-qt="' + qt + '" data-dir="next"' + (state.page >= totalPages - 1 ? ' disabled' : '') + '>◀</button>';
            h += '</div>';
          }

          bodyEl.innerHTML = h;

          // Wire pagination events
          bodyEl.querySelectorAll('.bulk-page-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
              var dir = btn.getAttribute('data-dir');
              if (dir === 'next') bulkPageState[qt].page++;
              else bulkPageState[qt].page--;
              renderBulkPage(qt);
              updateBulkSelectedCount();
            });
          });
          var pageSizeSelect = bodyEl.querySelector('.bulk-page-size');
          if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', function() {
              bulkPageState[qt].pageSize = parseInt(this.value);
              bulkPageState[qt].page = 0;
              renderBulkPage(qt);
              updateBulkSelectedCount();
            });
          }
          // Wire section checkbox
          var sectionCheck = bodyEl.querySelector('.bulk-section-check');
          if (sectionCheck) {
            sectionCheck.addEventListener('change', function() {
              var checked = sectionCheck.checked;
              bodyEl.querySelectorAll('.bulk-check').forEach(function(cb) { cb.checked = checked; });
              updateBulkSelectedCount();
            });
          }
          // Wire individual checkboxes
          bodyEl.querySelectorAll('.bulk-check').forEach(function(cb) {
            cb.addEventListener('change', updateBulkSelectedCount);
          });
          // Wire sortable headers
          bodyEl.querySelectorAll('.sortable-th').forEach(function(th) {
            th.addEventListener('click', function() {
              var col = th.getAttribute('data-sort-col');
              var sortQt = th.getAttribute('data-qt');
              var st = bulkPageState[sortQt];
              if (st.sortCol === col) {
                st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
              } else {
                st.sortCol = col;
                st.sortDir = 'asc';
              }
              st.page = 0;
              renderBulkPage(sortQt);
              updateBulkSelectedCount();
            });
          });
        }

        // Render first page for each section
        Object.keys(bulkPageState).forEach(renderBulkPage);

        updateBulkSelectedCount();
      }

      function updateBulkSelectedCount() {
        var total = document.querySelectorAll('.bulk-check').length;
        var checked = document.querySelectorAll('.bulk-check:checked').length;
        var countEl = document.getElementById('bulk-selected-count');
        if (countEl) countEl.textContent = checked + ' / ' + total + ' נבחרו';
      }

      var importFnMap = {
        'issues': importIssueFinding,
        'configurationFindings': importConfigFinding,
        'vulnerabilityFindings': importVulnFinding,
        'hostConfigurationRuleAssessments': importHostConfigFinding,
        'dataFindingsV2': importDataFinding,
        'secretInstances': importSecretFinding,
        'excessiveAccessFindings': importExcessiveAccessFinding,
        'networkExposures': importNetworkExposureFinding,
        'inventoryFindings': importInventoryFinding
      };

      function importSelectedBulkFindings() {
        var checked = document.querySelectorAll('.bulk-check:checked');
        var imported = 0;
        var skipped = 0;
        var consolidated = 0;
        var updated = 0;

        // Collect selected items grouped by query type
        var selectedByType = {};
        checked.forEach(function(cb) {
          var queryType = cb.getAttribute('data-query-type');
          var nodeIndex = parseInt(cb.getAttribute('data-node-index'), 10);
          var nodes = bulkImportResults[queryType];
          if (!nodes || nodeIndex < 0 || nodeIndex >= nodes.length) return;
          if (!selectedByType[queryType]) selectedByType[queryType] = [];
          selectedByType[queryType].push(nodes[nodeIndex]);
        });

        // Build existing title index for consolidation
        var existingTitles = {};
        var existingFindingsByTitle = {};
        findings.forEach(function(f) {
          var lowerTitle = (f.title || '').toLowerCase();
          existingTitles[lowerTitle] = true;
          existingFindingsByTitle[lowerTitle] = f;
        });

        // Process each query type
        Object.keys(selectedByType).forEach(function(queryType) {
          var items = selectedByType[queryType];
          var importFn = importFnMap[queryType];
          if (!importFn) return;

          // Special case: aggregate vuln findings into a single finding if more than 5
          if (queryType === 'vulnerabilityFindings' && items.length > 5) {
            // Check for duplicates first
            var newItems = [];
            items.forEach(function(item) {
              if (item.id && findings.some(function(f) { return f._wizSourceId === item.id; })) {
                skipped++;
              } else {
                newItems.push(item);
              }
            });
            if (!newItems.length) return;

            // Build aggregated finding
            var cat = 'VULN';
            var id = generateNextId(cat);
            var highestSev = 'high';
            var critCount = 0;
            var highCount = 0;
            var cveList = [];
            var resourceNames = [];
            var subscriptionNames = [];
            var technical = [];

            newItems.forEach(function(item) {
              var sev = mapWiziSeverity(item.severity);
              if (sev === 'critical') critCount++;
              else highCount++;
              if (sev === 'critical') highestSev = 'critical';

              var cveName = item.name || item.detailedName || '';
              if (cveName && cveList.indexOf(cveName) === -1) cveList.push(cveName);

              var asset = item.vulnerableAsset || {};
              var resName = asset.name || '';
              if (resName && resourceNames.indexOf(resName) === -1) resourceNames.push(resName);

              var subName = asset.subscriptionName || '';
              if (subName && subscriptionNames.indexOf(subName) === -1) subscriptionNames.push(subName);
            });

            technical.push('Total Vulnerabilities: ' + newItems.length);
            if (critCount) technical.push('Critical: ' + critCount);
            if (highCount) technical.push('High: ' + highCount);
            if (resourceNames.length) technical.push('Affected Resources: ' + resourceNames.join(', '));
            if (subscriptionNames.length) technical.push('Subscriptions: ' + subscriptionNames.join(', '));

            findings.push({
              id: id,
              category: cat,
              title: 'Multiple vulnerabilities with high and above severity',
              severity: highestSev,
              description: 'נמצאו ' + newItems.length + ' פגיעויות ברמת חומרה גבוהה ומעלה',
              impact: 'פגיעויות מרובות ברמת חומרה גבוהה ומעלה — ' + critCount + ' קריטיות, ' + highCount + ' גבוהות',
              technical: technical,
              policies: [],
              recs: ['לטפל בפגיעויות בהתאם לרמת החומרה ולעדכן את הרכיבים הפגיעים'],
              priority: '',
              owner: subscriptionNames.join(', '),
              evidence: []
            });

            // Tag with first item's source ID for duplicate detection
            if (newItems[0].id) {
              findings[findings.length - 1]._wizSourceId = newItems[0].id;
            }

            imported++;
            consolidated += newItems.length - 1;
            return;
          }

          // Special case: aggregate VPC firewall rule CSPM findings by exact resource
          if (queryType === 'configurationFindings') {
            var vpcPattern = /^VPC firewall rule[s]? should restrict .+ access/i;
            var vpcItems = [];
            var nonVpcItems = [];
            items.forEach(function(item) {
              var title = getWiziItemTitle(item, queryType);
              if (vpcPattern.test(title)) {
                vpcItems.push(item);
              } else {
                nonVpcItems.push(item);
              }
            });

            if (vpcItems.length > 0) {
              // Group VPC items by exact resource name
              var vpcByResource = {};
              vpcItems.forEach(function(item) {
                var res = item.resource || {};
                var resKey = res.name || 'unknown-' + Math.random();
                if (!vpcByResource[resKey]) vpcByResource[resKey] = [];
                vpcByResource[resKey].push(item);
              });

              Object.keys(vpcByResource).forEach(function(resName) {
                var resItems = vpcByResource[resName];
                if (resItems.length >= 2) {
                  // Aggregate: 2+ VPC firewall findings on same resource
                  var firstItem = resItems[0];
                  if (firstItem.id && findings.some(function(f) { return f._wizSourceId === firstItem.id; })) {
                    skipped += resItems.length;
                    return;
                  }

                  var resource = firstItem.resource || {};
                  var sub = resource.subscription || {};
                  var highestSev = 'high';
                  var ruleNames = [];
                  var policies = [];

                  resItems.forEach(function(item) {
                    var sev = mapWiziSeverity(item.severity);
                    if (sev === 'critical') highestSev = 'critical';
                    var t = getWiziItemTitle(item, queryType);
                    if (t && ruleNames.indexOf(t) === -1) ruleNames.push(t);
                  });

                  var sevLabel = (severityMap[highestSev] || {}).text || highestSev;
                  var cat = 'CSPM';
                  var id = generateNextId(cat);
                  var technical = [];
                  if (sub.cloudProvider) technical.push('Cloud: ' + sub.cloudProvider);
                  if (sub.name) technical.push('Subscription: ' + sub.name);
                  if (resource.region) technical.push('Region: ' + resource.region);
                  if (resource.name) technical.push('Resource: ' + resource.name);
                  if (resource.nativeType || resource.type) technical.push('Type: ' + (resource.nativeType || resource.type));
                  technical.push('Total Rules: ' + resItems.length);
                  ruleNames.forEach(function(r) { technical.push('• ' + r); });

                  var recs = extractRecommendations(firstItem.rule || {}, sevLabel);

                  findings.push({
                    id: id, category: cat,
                    title: 'VPC firewall rules should restrict MULTIPLE accesses',
                    severity: highestSev,
                    description: 'נמצאו ' + resItems.length + ' כללי VPC firewall על משאב ' + resName,
                    impact: 'חשיפת משאב לסיכון ברמת ' + sevLabel + ' — ' + resName,
                    technical: technical,
                    policies: policies,
                    recs: recs,
                    priority: '',
                    owner: sub.name || '',
                    evidence: []
                  });

                  if (firstItem.id) {
                    findings[findings.length - 1]._wizSourceId = firstItem.id;
                  }

                  imported++;
                  consolidated += resItems.length - 1;
                } else {
                  // Single VPC finding on this resource — pass through to normal flow
                  nonVpcItems.push(resItems[0]);
                }
              });

              // Replace items with non-VPC items (already-aggregated VPC items are handled)
              items = nonVpcItems;
              if (!items.length) return;
            }
          }

          // Group by rule ID within this query type (same as single-query import)
          var groupedByRule = {};
          items.forEach(function(item) {
            var ruleId = getWiziRuleId(item, queryType);
            if (!ruleId) ruleId = 'no-rule-' + Math.random();
            if (!groupedByRule[ruleId]) groupedByRule[ruleId] = [];
            groupedByRule[ruleId].push(item);
          });

          Object.keys(groupedByRule).forEach(function(ruleId) {
            var ruleItems = groupedByRule[ruleId];
            var firstItem = ruleItems[0];

            // Duplicate detection by _wizSourceId
            if (firstItem.id && findings.some(function(f) { return f._wizSourceId === firstItem.id; })) {
              skipped += ruleItems.length;
              return;
            }

            // Check if finding with same title already exists — merge into it
            var title = getWiziItemTitle(firstItem, queryType);
            var lowerTitle = title ? title.toLowerCase() : null;

            if (lowerTitle && existingTitles[lowerTitle]) {
              var existingFinding = existingFindingsByTitle[lowerTitle];

              // Extract all unique resource names from new items
              var newResources = [];
              ruleItems.forEach(function(item) {
                var resourceName = extractResourceName(item, queryType);
                if (resourceName && newResources.indexOf(resourceName) === -1) {
                  newResources.push(resourceName);
                }
              });

              // Extract all unique subscription names from new items
              var newSubscriptions = [];
              ruleItems.forEach(function(item) {
                var subName = getNodeSubscriptionName(item, queryType);
                if (subName && newSubscriptions.indexOf(subName) === -1) {
                  newSubscriptions.push(subName);
                }
              });

              // Get existing resources from Entity/Resource line
              var existingResources = [];
              var entityLineIndex = -1;
              for (var j = 0; j < existingFinding.technical.length; j++) {
                if (existingFinding.technical[j].startsWith('Entity:') ||
                    existingFinding.technical[j].startsWith('Resource:') ||
                    existingFinding.technical[j].startsWith('Principal:')) {
                  entityLineIndex = j;
                  var parts = existingFinding.technical[j].split(':');
                  if (parts.length > 1) {
                    existingResources = parts[1].split(',').map(function(r) { return r.trim(); });
                  }
                  break;
                }
              }

              // Merge resources
              var allResources = existingResources.slice();
              newResources.forEach(function(r) {
                if (allResources.indexOf(r) === -1) allResources.push(r);
              });

              // Get existing subscriptions from owner field
              var existingSubscriptions = existingFinding.owner ? existingFinding.owner.split(',').map(function(s) { return s.trim(); }) : [];

              // Merge subscriptions
              var allSubscriptions = existingSubscriptions.slice();
              newSubscriptions.forEach(function(s) {
                if (allSubscriptions.indexOf(s) === -1) allSubscriptions.push(s);
              });

              // Update Entity/Resource line if resources changed
              if (allResources.length > existingResources.length) {
                if (entityLineIndex >= 0) {
                  var prefix = existingFinding.technical[entityLineIndex].split(':')[0];
                  existingFinding.technical[entityLineIndex] = prefix + ': ' + allResources.join(', ');
                } else if (allResources.length > 0) {
                  existingFinding.technical.unshift('Affected Resources: ' + allResources.join(', '));
                }
              }

              // Update owner field if subscriptions changed
              if (allSubscriptions.length > existingSubscriptions.length) {
                existingFinding.owner = allSubscriptions.join(', ');
                var subLineIndex = -1;
                for (var k = 0; k < existingFinding.technical.length; k++) {
                  if (existingFinding.technical[k].startsWith('Subscription:') ||
                      existingFinding.technical[k].startsWith('Account:')) {
                    subLineIndex = k;
                    break;
                  }
                }
                if (subLineIndex >= 0) {
                  var subPrefix = existingFinding.technical[subLineIndex].split(':')[0];
                  existingFinding.technical[subLineIndex] = subPrefix + ': ' + allSubscriptions.join(', ');
                }
              }

              updated++;
              return;
            }

            // Import first item to create the finding
            importFn(firstItem);
            imported++;

            var lastFinding = findings[findings.length - 1];

            // Tag with Wiz source ID
            if (firstItem.id) {
              lastFinding._wizSourceId = firstItem.id;
            }

            // Extract all unique subscription names from all items
            var allSubscriptions = [];
            ruleItems.forEach(function(item) {
              var subName = getNodeSubscriptionName(item, queryType);
              if (subName && allSubscriptions.indexOf(subName) === -1) {
                allSubscriptions.push(subName);
              }
            });

            if (allSubscriptions.length > 0) {
              lastFinding.owner = allSubscriptions.join(', ');
            }

            // If multiple items with same rule, consolidate resources
            if (ruleItems.length > 1) {
              consolidated += ruleItems.length - 1;

              var allResources = [];
              ruleItems.forEach(function(item) {
                var resourceName = extractResourceName(item, queryType);
                if (resourceName && allResources.indexOf(resourceName) === -1) {
                  allResources.push(resourceName);
                }
              });

              if (allResources.length > 1) {
                var entityLineIndex = -1;
                for (var j = 0; j < lastFinding.technical.length; j++) {
                  if (lastFinding.technical[j].startsWith('Entity:') ||
                      lastFinding.technical[j].startsWith('Resource:') ||
                      lastFinding.technical[j].startsWith('Principal:')) {
                    entityLineIndex = j;
                    break;
                  }
                }
                if (entityLineIndex >= 0) {
                  var prefix = lastFinding.technical[entityLineIndex].split(':')[0];
                  lastFinding.technical[entityLineIndex] = prefix + ': ' + allResources.join(', ');
                } else {
                  lastFinding.technical.unshift('Affected Resources: ' + allResources.join(', '));
                }
              }

              if (allSubscriptions.length > 1) {
                var subLineIndex = -1;
                for (var k = 0; k < lastFinding.technical.length; k++) {
                  if (lastFinding.technical[k].startsWith('Subscription:') ||
                      lastFinding.technical[k].startsWith('Account:')) {
                    subLineIndex = k;
                    break;
                  }
                }
                if (subLineIndex >= 0) {
                  var subPrefix = lastFinding.technical[subLineIndex].split(':')[0];
                  lastFinding.technical[subLineIndex] = subPrefix + ': ' + allSubscriptions.join(', ');
                }
              }
            }

            if (title) existingTitles[title.toLowerCase()] = true;
          });
        });

        return { imported: imported, skipped: skipped, consolidated: consolidated, updated: updated };
      }

      var btnBulkImport = document.getElementById('btn-bulk-import');
      if (btnBulkImport) {
        btnBulkImport.addEventListener('click', handleBulkImport);
      }

      // Autocomplete for bulk import subscription input
      var bulkImportSubInput = document.getElementById('bulk-import-sub');
      var bulkImportSubId = document.getElementById('bulk-import-sub-id');
      var bulkImportSubList = document.getElementById('bulk-import-sub-list');
      if (bulkImportSubInput && bulkImportSubId && bulkImportSubList) {
        setupAutocomplete(bulkImportSubInput, bulkImportSubId, bulkImportSubList, function() {
          return wiziSubscriptions;
        });
      }

      if (bulkImportSubInput) {
        bulkImportSubInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && !document.querySelector('#bulk-import-sub-list.open')) {
            e.preventDefault();
            handleBulkImport();
          }
        });
      }

      var btnBulkSelectAll = document.getElementById('btn-bulk-select-all');
      if (btnBulkSelectAll) {
        btnBulkSelectAll.addEventListener('click', function() {
          var resultsDiv = document.getElementById('bulk-import-results');
          if (!resultsDiv) return;
          var allChecks = resultsDiv.querySelectorAll('.bulk-check');
          var allChecked = true;
          for (var i = 0; i < allChecks.length; i++) {
            if (!allChecks[i].checked) { allChecked = false; break; }
          }
          var newState = !allChecked;
          allChecks.forEach(function(cb) { cb.checked = newState; });
          resultsDiv.querySelectorAll('.bulk-section-check').forEach(function(cb) { cb.checked = newState; });
          updateBulkSelectedCount();
        });
      }

      document.getElementById('btn-bulk-expand-all').addEventListener('click', function() {
        document.querySelectorAll('#bulk-import-results details').forEach(function(d) { d.open = true; });
      });

      document.getElementById('btn-bulk-collapse-all').addEventListener('click', function() {
        document.querySelectorAll('#bulk-import-results details').forEach(function(d) { d.open = false; });
      });

      var btnBulkImportSelected = document.getElementById('btn-bulk-import-selected');
      if (btnBulkImportSelected) {
        btnBulkImportSelected.addEventListener('click', function() {
          var beforeCount = findings.length;
          var result = importSelectedBulkFindings();
          if (result.imported === 0 && result.skipped === 0 && result.updated === 0) {
            showToast('לא נבחרו ממצאים לייבוא', 'warning');
            return;
          }
          var message = 'יובאו ' + result.imported + ' ממצאים';
          if (result.consolidated) message += ' (' + result.consolidated + ' משאבים נוספים אוחדו)';
          if (result.updated) message += ' (' + result.updated + ' ממצאים עודכנו)';
          if (result.skipped) message += ' (' + result.skipped + ' כפולים דולגו)';
          showToast(message, 'success');
          renderFindingsTable();
          updateStepper();
          prefillId();
          autoSave();
          switchToTab('tab-findings-list');

          // Enrich newly imported findings with AI remediation summaries
          var newFindings = findings.slice(beforeCount);
          if (newFindings.length) {
            styledConfirm('האם ברצונך להפעיל את כלי שיפור ההמלצות?', {
              icon: '🤖', title: 'שיפור המלצות באמצעות AI', confirmText: 'כן', cancelText: 'לא'
            }).then(function(yes) {
              if (yes) enrichFindingsWithAiSummaries(newFindings);
            });
          }
        });
      }

