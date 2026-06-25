import { showToast } from './core.js';

// ═══════════════════════════════════════════
// Pipeline Dashboard — pipeline.js
// Fetches /api/pipeline and renders:
//   • KPI cards (overdue / due this month / upcoming / never scanned)
//   • Filter bar
//   • Sortable product table
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
            html += '<thead><tr><th>לקוח</th><th>סביבה</th><th>תדירות</th><th>פרסום אחרון</th><th>מועד הבא</th><th>סטטוס</th></tr></thead>';
            html += '<tbody>';
            filtered.forEach(function(p) {
                var cls = _STATUS_CLS[p.status] || '';
                var freq = _FREQ_LABELS[p.scanFrequency] || p.scanFrequency;
                var lastPub = p.lastPublishedAt ? _fmtDate(p.lastPublishedAt) : '—';
                var nextDue = p.nextDueAt ? _fmtDate(p.nextDueAt) : '—';
                var ver = p.lastPublishedVersion ? ' <span class="muted">v' + _esc(p.lastPublishedVersion) + '</span>' : '';
                var statusLabel = _STATUS_LABELS[p.status] || _esc(p.status);
                html += '<tr>'
                    + '<td><strong>' + _esc(p.name) + '</strong>' + ver + '</td>'
                    + '<td>' + _esc(p.env) + '</td>'
                    + '<td>' + _esc(freq) + '</td>'
                    + '<td class="pipeline-date">' + lastPub + '</td>'
                    + '<td class="pipeline-date">' + nextDue + '</td>'
                    + '<td><span class="pipeline-status-badge ' + cls + '">' + statusLabel + '</span></td>'
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
    },
};

// Auto-init when module loads (ESM modules are deferred — DOM is ready)
PipelinePanel.init();
