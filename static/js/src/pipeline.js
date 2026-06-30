import { showToast } from './core.js';

// ═══════════════════════════════════════════
// Pipeline Dashboard — pipeline.js
// Fetches /api/pipeline and renders:
//   • KPI cards (overdue / due this month / upcoming / never scanned)
//   • Filter bar
//   • Sortable product table with "New Scan" action
// ═══════════════════════════════════════════

var _FREQ_LABELS = { monthly: 'חודשי', quarterly: 'רבעוני', annual: 'שנתי' };
var _STATUS_LABELS = { overdue: 'באיחור', due_this_month: 'החודש', upcoming: 'עתידי', no_scans: 'לא נסרק' };
var _STATUS_CLS = {
    overdue: 'pipeline-status-overdue',
    due_this_month: 'pipeline-status-due',
    upcoming: 'pipeline-status-upcoming',
    no_scans: 'pipeline-status-none',
};

function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtDate(iso) {
    try {
        return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) { return iso; }
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
    },

    load: async function() {
        try {
            var resp = await fetch('/api/pipeline');
            if (!resp.ok) {
                var b = await resp.json().catch(function() { return {}; });
                throw new Error(b.error || 'שגיאה');
            }
            this._data = await resp.json();
            this._filter = 'all';
            this.render();
        } catch (e) {
            showToast('שגיאה בטעינת לוח הסריקות', 'error');
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

        var html = '<div class="section-body">';

        // KPI cards
        html += '<div class="pipeline-kpi-row">';
        ['overdue', 'due_this_month', 'upcoming', 'no_scans'].forEach(function(status) {
            var cls = _STATUS_CLS[status] || '';
            var label = _STATUS_LABELS[status];
            html += '<div class="pipeline-kpi-card ' + cls + '" data-kpi-filter="' + status + '" title="סנן: ' + label + '">'
                + '<span class="pipeline-kpi-count">' + counts[status] + '</span>'
                + '<span class="pipeline-kpi-label">' + label + '</span>'
                + '</div>';
        });
        html += '</div>';

        // Filter bar
        html += '<div class="pipeline-filter-row">';
        [['all', 'הכל'], ['overdue', 'באיחור'], ['due_this_month', 'החודש'], ['upcoming', 'עתידי'], ['no_scans', 'לא נסרק']].forEach(function(pair) {
            var active = filter === pair[0] ? ' active' : '';
            html += '<button class="pipeline-filter-btn' + active + '" data-pipeline-filter="' + pair[0] + '">' + pair[1] + '</button>';
        });
        html += '</div>';

        // Table or empty state
        if (filtered.length === 0) {
            html += '<div class="pipeline-empty">אין לקוחות להצגה בסינון הנוכחי</div>';
        } else {
            html += '<div class="pipeline-table-wrap"><table class="pipeline-table">';
            html += '<thead><tr>'
                + '<th>לקוח</th><th>סביבה</th><th>תדירות</th>'
                + '<th>פרסום אחרון</th><th>מועד הבא</th><th>סטטוס</th><th>פעולות</th>'
                + '</tr></thead>';
            html += '<tbody>';
            filtered.forEach(function(p) {
                var cls = _STATUS_CLS[p.status] || '';
                var freq = _FREQ_LABELS[p.scanFrequency] || p.scanFrequency;
                var lastPub = p.lastPublishedAt ? _fmtDate(p.lastPublishedAt) : '—';
                var nextDue = p.nextDueAt ? _fmtDate(p.nextDueAt) : '—';
                var ver = p.lastPublishedVersion ? ' <span class="muted">v' + _esc(p.lastPublishedVersion) + '</span>' : '';
                var statusLabel = _STATUS_LABELS[p.status] || _esc(p.status);
                var actionable = (p.status === 'overdue' || p.status === 'due_this_month' || p.status === 'no_scans');
                var actionBtn = actionable
                    ? '<button class="btn btn-sm btn-primary pipeline-new-scan-btn" data-product-id="' + _esc(p.id) + '">סריקה חדשה</button>'
                    : '';
                html += '<tr>'
                    + '<td><strong>' + _esc(p.name) + '</strong>' + ver + '</td>'
                    + '<td>' + _esc(p.env) + '</td>'
                    + '<td>' + _esc(freq) + '</td>'
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
            subsHtml = '<p style="margin:0 0 16px;color:var(--text-muted)">אין subscription IDs מוגדרים למוצר זה.</p>';
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
            + '<h3>סריקה חדשה — ' + _esc(product.name) + '</h3>'
            + '<div class="pipeline-scan-modal-body">'
            + subsHtml
            + '<div class="pipeline-scan-modal-actions">'
            + (subs.length > 0
                ? '<button class="btn btn-primary btn-sm pipeline-start-fetch-btn">הפעל Fetch</button>'
                : '')
            + '<button class="btn btn-secondary btn-sm pipeline-cancel-btn">ביטול</button>'
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
                + '<button class="btn btn-secondary btn-sm pipeline-modal-close-btn">סגור</button>'
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
                _showError(data.message || data.error || 'שגיאה');
                return;
            }
            // Switch to progress view
            body.innerHTML = '<p style="margin:0 0 10px">גרסה ' + _esc(data.version) + ' — שולפת ממצאים מ-Wiz...</p>'
                + '<div class="pipeline-progress-bar">'
                + '<div class="pipeline-progress-bar-fill" id="pipeline-progress-fill" style="width:0%"></div>'
                + '</div>'
                + '<p id="pipeline-progress-label" style="font-size:0.8rem;color:var(--text-muted);margin:6px 0 16px">מתחיל...</p>'
                + '<div class="pipeline-scan-modal-actions">'
                + '<button class="btn btn-secondary btn-sm pipeline-cancel-poll-btn">סגור ברקע</button>'
                + '</div>';
            var stopPolling = self._pollStatus(productId, data.snapshot_id, overlay);
            body.querySelector('.pipeline-cancel-poll-btn').addEventListener('click', function() {
                stopPolling();
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                showToast('הסריקה ממשיכה ברקע — רענן את הלשונית לאחר מספר דקות', 'info');
            });
        } catch (e) {
            if (startBtn) startBtn.disabled = false;
            _showError('שגיאת רשת. נסה שוב.');
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
                + '<button class="btn btn-secondary btn-sm pipeline-modal-close-btn">סגור</button>'
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
                _stopWithError('הסריקה ארכה זמן רב מדי. בדוק את לוג השרת ונסה שוב.');
                return;
            }

            try {
                var resp = await fetch('/api/pipeline/' + productId + '/scan-status/' + snapshotId);
                if (!resp.ok) {
                    _stopWithError('שגיאת שרת (' + resp.status + '). נסה לרענן את הדף.');
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
                    label.textContent = _lastDone + ' מתוך ' + job.total + ' שאילתות הושלמו';
                }

                if (job.status === 'done') {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    showToast('הסריקה הושלמה — ' + (job.findings_count || 0) + ' ממצאים יובאו', 'success');
                    self.load();
                    return; // no more ticks
                }
                if (job.status === 'error') {
                    _stopWithError('שגיאה בשליפה: ' + (job.error || 'שגיאה לא ידועה'));
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
