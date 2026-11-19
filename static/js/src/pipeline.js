import { showToast } from './core.js';
import { publishUnmatchedMemory } from './memory-match.js';
import { t, tFormat, countPhrase, getLang, LANG_CHANGE_EVENT } from './i18n.js';

// ═══════════════════════════════════════════
// Pipeline Dashboard — pipeline.js
// Fetches /api/pipeline and renders:
//   • KPI cards (overdue / due this month / upcoming / never scanned)
//   • Filter bar
//   • Sortable product table with "New Scan" action
// ═══════════════════════════════════════════

function _freqLabels() {
    return { monthly: t('חודשי'), quarterly: t('רבעוני'), annual: t('שנתי') };
}
function _statusLabels() {
    return { overdue: t('באיחור'), due_this_month: t('החודש'), upcoming: t('עתידי'), no_scans: t('לא נסרק') };
}
var _STATUS_CLS = {
    overdue: 'pipeline-status-overdue',
    due_this_month: 'pipeline-status-due',
    upcoming: 'pipeline-status-upcoming',
    no_scans: 'pipeline-status-none',
};

// ── Overdue monitoring state ──
let _overdueCheckInterval = null;
let _lastKnownOverdueCount = 0;

function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtDate(iso) {
    try {
        return new Date(iso).toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) { return iso; }
}

function _getRiskTierClass(score) {
    if (score === null || score === undefined) return '';
    if (score <= 15) return 'risk-tier-green';
    if (score <= 35) return 'risk-tier-orange';
    if (score <= 60) return 'risk-tier-red';
    return 'risk-tier-crimson';
}

export var PipelinePanel = {
    _data: [],
    _filter: 'all',

    init: function() {
        var self = this;
        var tabBtn = document.getElementById('tab-pipeline');
        if (tabBtn) {
            tabBtn.addEventListener('click', function() {
                self.load();
            });
        }

        // Re-render the dashboard when the UI language changes (only if it has been loaded)
        document.addEventListener(LANG_CHANGE_EVENT, function() {
            if (self._data && self._data.length) self.render();
        });

        // Start overdue monitoring
        self._initOverdueMonitoring();
    },

    // ── Overdue Monitoring Functions ──────────────────────────────────────────

    _initOverdueMonitoring: function() {
        var self = this;

        // Clear any existing interval
        if (_overdueCheckInterval) {
            clearInterval(_overdueCheckInterval);
        }

        // Get initial baseline count (current overdue products)
        self._updateOverdueCount();

        // Poll every 10 minutes (600,000ms)
        _overdueCheckInterval = setInterval(function() {
            self._checkForNewOverdue();
        }, 600000);
    },

    _updateOverdueCount: function() {
        var self = this;
        fetch('/api/pipeline')
            .then(function(resp) { return resp.json(); })
            .then(function(data) {
                var overdueCount = data.filter(function(p) {
                    return p.status === 'overdue';
                }).length;

                _lastKnownOverdueCount = overdueCount;
                self._updateBadge(overdueCount);
            })
            .catch(function(err) {
                console.error('Failed to fetch pipeline status for overdue monitoring:', err);
            });
    },

    _checkForNewOverdue: function() {
        var self = this;
        fetch('/api/pipeline')
            .then(function(resp) { return resp.json(); })
            .then(function(data) {
                var currentOverdueCount = data.filter(function(p) {
                    return p.status === 'overdue';
                }).length;

                // Only show toast if count INCREASED
                if (currentOverdueCount > _lastKnownOverdueCount) {
                    var newCount = currentOverdueCount - _lastKnownOverdueCount;
                    var message = countPhrase(newCount, 'מוצר אחד נכנס לסטטוס איחור בסריקה', '{n} מוצרים נכנסו לסטטוס איחור בסריקה');
                    showToast(message, 'warning');
                }

                // Always update badge and baseline
                _lastKnownOverdueCount = currentOverdueCount;
                self._updateBadge(currentOverdueCount);
            })
            .catch(function(err) {
                console.error('Failed to check for new overdue products:', err);
            });
    },

    _updateBadge: function(count) {
        var badge = document.getElementById('pipeline-overdue-badge');
        if (!badge) return;

        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    },

    // ── End Overdue Monitoring ──────────────────────────────────────────────

    load: async function() {
        try {
            var resp = await fetch('/api/pipeline');
            if (!resp.ok) {
                var b = await resp.json().catch(function() { return {}; });
                throw new Error(b.error || t('שגיאה'));
            }
            this._data = await resp.json();
            this._filter = 'all';
            this.render();
        } catch (e) {
            showToast(t('שגיאה בטעינת לוח הסריקות'), 'error');
        }
    },

    render: function() {
        var container = document.getElementById('pipeline-panel-content');
        if (!container) return;

        var self = this;
        var data = this._data;
        var filter = this._filter;
        var filtered = filter === 'all' ? data : data.filter(function(p) { return p.status === filter; });

        var counts = { overdue: 0, due_this_month: 0, upcoming: 0, no_scans: 0 };
        data.forEach(function(p) { if (p.status in counts) counts[p.status]++; });

        var STATUS_LABELS = _statusLabels();
        var FREQ_LABELS = _freqLabels();
        var html = '<div class="section-body">';

        // KPI cards
        html += '<div class="pipeline-kpi-row">';
        ['overdue', 'due_this_month', 'upcoming', 'no_scans'].forEach(function(status) {
            var cls = _STATUS_CLS[status] || '';
            var label = STATUS_LABELS[status];
            html += '<div class="pipeline-kpi-card ' + cls + '" data-kpi-filter="' + status + '" title="' + _esc(tFormat('סנן: {label}', { label: label })) + '">'
                + '<span class="pipeline-kpi-count">' + counts[status] + '</span>'
                + '<span class="pipeline-kpi-label">' + label + '</span>'
                + '</div>';
        });
        html += '</div>';

        // Filter bar
        html += '<div class="pipeline-filter-row">';
        [['all', t('הכל')], ['overdue', t('באיחור')], ['due_this_month', t('החודש')], ['upcoming', t('עתידי')], ['no_scans', t('לא נסרק')]].forEach(function(pair) {
            var active = filter === pair[0] ? ' active' : '';
            html += '<button class="pipeline-filter-btn' + active + '" data-pipeline-filter="' + pair[0] + '">' + pair[1] + '</button>';
        });
        html += '</div>';

        // Table or empty state
        if (filtered.length === 0) {
            html += '<div class="pipeline-empty">' + t('אין לקוחות להצגה בסינון הנוכחי') + '</div>';
        } else {
            html += '<div class="pipeline-table-wrap"><table class="pipeline-table">';
            html += '<thead><tr>'
                + '<th>' + t('לקוח') + '</th><th>' + t('סביבה') + '</th><th>' + t('תדירות') + '</th><th>' + t('ציון סיכון') + '</th>'
                + '<th>' + t('פרסום אחרון') + '</th><th>' + t('מועד הבא') + '</th><th>' + t('סטטוס') + '</th><th>' + t('פעולות') + '</th>'
                + '</tr></thead>';
            html += '<tbody>';
            filtered.forEach(function(p) {
                var cls = _STATUS_CLS[p.status] || '';
                var freq = FREQ_LABELS[p.scanFrequency] || p.scanFrequency;
                var lastPub = p.lastPublishedAt ? _fmtDate(p.lastPublishedAt) : '—';
                var nextDue = p.nextDueAt ? _fmtDate(p.nextDueAt) : '—';
                var ver = p.lastPublishedVersion ? ' <span class="muted">v' + _esc(p.lastPublishedVersion) + '</span>' : '';
                var statusLabel = STATUS_LABELS[p.status] || _esc(p.status);
                var actionable = (p.status === 'overdue' || p.status === 'due_this_month' || p.status === 'no_scans');
                var actionBtn = actionable
                    ? '<button class="btn btn-sm btn-primary pipeline-new-scan-btn" data-product-id="' + _esc(p.id) + '">' + t('סריקה חדשה') + '</button>'
                    : '';

                var riskScore = p.latestRiskScore;
                var riskDisplay = '';
                if (riskScore !== null && riskScore !== undefined) {
                    var riskTier = _getRiskTierClass(riskScore);
                    riskDisplay = '<span class="pipeline-risk-badge ' + riskTier + '">' + riskScore + '</span>';
                } else {
                    riskDisplay = '—';
                }

                html += '<tr>'
                    + '<td><strong>' + _esc(p.name) + '</strong>' + ver + '</td>'
                    + '<td>' + _esc(p.env) + '</td>'
                    + '<td>' + _esc(freq) + '</td>'
                    + '<td>' + riskDisplay + '</td>'
                    + '<td class="pipeline-date">' + lastPub + '</td>'
                    + '<td class="pipeline-date">' + nextDue + '</td>'
                    + '<td><span class="pipeline-status-badge ' + cls + '">' + statusLabel + '</span></td>'
                    + '<td class="pipeline-actions">' + actionBtn + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table></div>';
        }

        html += '</div>';
        container.innerHTML = html;

        // Wire filter buttons
        container.querySelectorAll('[data-pipeline-filter]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                self._filter = btn.dataset.pipelineFilter;
                self.render();
            });
        });

        // Wire KPI cards as filter shortcuts
        container.querySelectorAll('[data-kpi-filter]').forEach(function(card) {
            card.addEventListener('click', function() {
                self._filter = card.dataset.kpiFilter;
                self.render();
            });
        });

        // Wire "New Scan" buttons
        container.querySelectorAll('.pipeline-new-scan-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var productId = btn.dataset.productId;
                var product = self._data.find(function(p) { return p.id === productId; });
                if (product) self._openNewScanModal(product);
            });
        });
    },

    // ── New Scan modal ──────────────────────────────────────────────────────

    _openNewScanModal: function(product) {
        var self = this;
        var subs = product.subscriptionIds || [];

        var subsHtml = '';
        if (subs.length === 0) {
            subsHtml = '<p style="margin:0 0 16px;color:var(--text-muted)">' + t('אין subscription IDs מוגדרים למוצר זה.') + '</p>';
        } else {
            subsHtml = '<ul class="pipeline-sub-list">';
            subs.forEach(function(sub, i) {
                subsHtml += '<li>'
                    + '<input type="checkbox" id="pipeline-sub-' + i + '" name="sub" value="' + _esc(sub) + '" checked>'
                    + '<label for="pipeline-sub-' + i + '">' + _esc(sub) + '</label>'
                    + '</li>';
            });
            subsHtml += '</ul>';
        }

        var overlay = document.createElement('div');
        overlay.className = 'pipeline-scan-modal-overlay';
        overlay.innerHTML = '<div class="pipeline-scan-modal" role="dialog" aria-modal="true">'
            + '<h3>' + _esc(tFormat('סריקה חדשה — {name}', { name: product.name })) + '</h3>'
            + '<div class="pipeline-scan-modal-body">'
            + subsHtml
            + '<div class="pipeline-scan-modal-actions">'
            + (subs.length > 0
                ? '<button class="btn btn-primary btn-sm pipeline-start-fetch-btn">' + t('הפעל Fetch') + '</button>'
                : '')
            + '<button class="btn btn-secondary btn-sm pipeline-cancel-btn">' + t('ביטול') + '</button>'
            + '</div>'
            + '</div>'
            + '</div>';

        document.body.appendChild(overlay);

        overlay.querySelector('.pipeline-cancel-btn').addEventListener('click', function() {
            document.body.removeChild(overlay);
        });

        var startBtn = overlay.querySelector('.pipeline-start-fetch-btn');
        if (startBtn) {
            var _updateStartBtn = function() {
                var anyChecked = overlay.querySelectorAll('input[name="sub"]:checked').length > 0;
                startBtn.disabled = !anyChecked;
            };
            overlay.querySelectorAll('input[name="sub"]').forEach(function(cb) {
                cb.addEventListener('change', _updateStartBtn);
            });
            startBtn.addEventListener('click', function() {
                var checked = Array.from(overlay.querySelectorAll('input[name="sub"]:checked'))
                    .map(function(cb) { return cb.value; });
                self._startFetch(product.id, checked, overlay);
            });
        }
    },

    _startFetch: async function(productId, selectedSubs, overlay) {
        var self = this;
        var body = overlay.querySelector('.pipeline-scan-modal-body');

        var _showError = function(msg) {
            body.innerHTML = '<p class="pipeline-modal-error">' + _esc(msg) + '</p>'
                + '<div class="pipeline-scan-modal-actions">'
                + '<button class="btn btn-secondary btn-sm pipeline-modal-close-btn">' + t('סגור') + '</button>'
                + '</div>';
            body.querySelector('.pipeline-modal-close-btn').addEventListener('click', function() {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            });
        };

        // Grab the start button through the overlay so we can disable it.
        var startBtn = overlay.querySelector('.pipeline-start-fetch-btn');
        if (startBtn) startBtn.disabled = true;

        try {
            var resp = await fetch('/api/pipeline/' + productId + '/start-scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription_ids: selectedSubs }),
            });
            var data = await resp.json();
            if (!resp.ok) {
                if (startBtn) startBtn.disabled = false;
                _showError(data.message || data.error || t('שגיאה'));
                return;
            }
            // Switch to progress view
            body.innerHTML = '<p style="margin:0 0 10px">' + _esc(tFormat('גרסה {version} — שולפת ממצאים מ-Wiz...', { version: data.version })) + '</p>'
                + '<div class="pipeline-progress-bar">'
                + '<div class="pipeline-progress-bar-fill" id="pipeline-progress-fill" style="width:0%"></div>'
                + '</div>'
                + '<p id="pipeline-progress-label" style="font-size:0.8rem;color:var(--text-muted);margin:6px 0 16px">' + t('מתחיל...') + '</p>'
                + '<div class="pipeline-scan-modal-actions">'
                + '<button class="btn btn-secondary btn-sm pipeline-cancel-poll-btn">' + t('סגור ברקע') + '</button>'
                + '</div>';
            var stopPolling = self._pollStatus(productId, data.snapshot_id, overlay);
            body.querySelector('.pipeline-cancel-poll-btn').addEventListener('click', function() {
                stopPolling();
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                showToast(t('הסריקה ממשיכה ברקע — רענן את הלשונית לאחר מספר דקות'), 'info');
            });
        } catch (e) {
            if (startBtn) startBtn.disabled = false;
            _showError(t('שגיאת רשת. נסה שוב.'));
        }
    },

    // Returns a stop() function. Uses recursive setTimeout so each tick waits
    // for the previous fetch to resolve before scheduling the next one —
    // preventing overlapping requests when the server is slow.
    _pollStatus: function(productId, snapshotId, overlay) {
        var self = this;
        var attempts = 0;
        var POLL_INTERVAL_MS = 3000;
        var MAX_POLL_MS = 10 * 60 * 1000; // 10 minutes
        var MAX_ATTEMPTS = Math.ceil(MAX_POLL_MS / POLL_INTERVAL_MS);
        var cancelled = false;
        var timer = null;
        var _lastDone = 0;

        var _stopWithError = function(msg) {
            var body = overlay.querySelector('.pipeline-scan-modal-body');
            if (!body) return;
            body.innerHTML = '<p class="pipeline-modal-error">' + _esc(msg) + '</p>'
                + '<div class="pipeline-scan-modal-actions">'
                + '<button class="btn btn-secondary btn-sm pipeline-modal-close-btn">' + t('סגור') + '</button>'
                + '</div>';
            body.querySelector('.pipeline-modal-close-btn').addEventListener('click', function() {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            });
        };

        var _tick = async function() {
            if (cancelled) return;

            // Stop if overlay was removed from the page (e.g. user closed it another way)
            if (!document.body.contains(overlay)) return;

            attempts++;
            if (attempts > MAX_ATTEMPTS) {
                _stopWithError(t('הסריקה ארכה זמן רב מדי. בדוק את לוג השרת ונסה שוב.'));
                return;
            }

            try {
                var resp = await fetch('/api/pipeline/' + productId + '/scan-status/' + snapshotId);
                if (!resp.ok) {
                    _stopWithError(tFormat('שגיאת שרת ({status}). נסה לרענן את הדף.', { status: resp.status }));
                    return;
                }
                var job = await resp.json();

                if (job.done > _lastDone) _lastDone = job.done;

                var fill = overlay.querySelector('#pipeline-progress-fill');
                var label = overlay.querySelector('#pipeline-progress-label');
                if (fill && job.total > 0) {
                    fill.style.width = Math.round(_lastDone / job.total * 100) + '%';
                }
                if (label) {
                    label.textContent = tFormat('{done} מתוך {total} שאילתות הושלמו', { done: _lastDone, total: job.total });
                }

                if (job.status === 'done') {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    showToast(tFormat('הסריקה הושלמה — {n} ממצאים יובאו', { n: job.findings_count || 0 }), 'success');
                    // BL-24: remembered exceptions that matched no finding in this scan (always published;
                    // an empty list hides the panel)
                    publishUnmatchedMemory(job.unmatched_memory || [], { type: 'pipeline', productId: productId, snapshotId: snapshotId });
                    // TODO: wire a "View findings" action here that opens the product's
                    // snapshot in the Findings editor (full implementation: Roadmap 2.3).
                    self.load();
                    return; // no more ticks
                }
                if (job.status === 'error') {
                    _stopWithError(tFormat('שגיאה בשליפה: {err}', { err: job.error || t('שגיאה לא ידועה') }));
                    return; // no more ticks
                }
            } catch (e) { /* network hiccup — schedule next tick normally */ }

            // Schedule next tick only after this one fully resolves
            if (!cancelled) timer = setTimeout(_tick, 3000);
        };

        // Kick off the first tick
        timer = setTimeout(_tick, 3000);

        return function stop() {
            cancelled = true;
            if (timer !== null) clearTimeout(timer);
        };
    },
};

// Auto-init when module loads (ESM modules are deferred — DOM is ready)
PipelinePanel.init();
