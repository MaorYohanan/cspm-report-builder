// ═══════════════════════════════════════════
// Exception List View — exceptions.js
// Fetches /api/exceptions and renders a cross-product
// table of all active exceptions in published snapshots.
// ═══════════════════════════════════════════

var _loaded = false;
var _data = [];

function _esc(str) {
    return String(str != null ? str : '—')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _fmtDate(iso) {
    if (!iso) return '—';
    // publishedAt is formatted as "YYYY-MM-DDTHH:MM:SSZ" — extract YYYY-MM-DD
    return String(iso).slice(0, 10);
}

function renderRows(data) {
    var tbody = document.getElementById('exceptions-tbody');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="exceptions-no-published">אין חריגות להצגה</td></tr>';
        return;
    }

    var html = '';
    data.forEach(function(item) {
        if (item.publishedAt === null) {
            html += '<tr>'
                + '<td colspan="6" class="exceptions-no-published">אין גרסה מפורסמת — '
                + _esc(item.productName)
                + '</td>'
                + '</tr>';
        } else {
            html += '<tr>'
                + '<td>' + _esc(item.productName) + '</td>'
                + '<td>' + _esc(item.findingTitle) + '</td>'
                + '<td>' + _esc(item.severity) + '</td>'
                + '<td>' + _esc(item.category) + '</td>'
                + '<td>' + _esc(item.exceptionReason) + '</td>'
                + '<td>' + _esc(_fmtDate(item.publishedAt)) + '</td>'
                + '</tr>';
        }
    });
    tbody.innerHTML = html;
}

function applyFilters() {
    var searchEl = document.getElementById('exceptions-search');
    var severityEl = document.getElementById('exceptions-filter-severity');
    var searchVal = searchEl ? searchEl.value.toLowerCase() : '';
    var severityVal = severityEl ? severityEl.value.toLowerCase() : '';

    var tbody = document.getElementById('exceptions-tbody');
    if (!tbody) return;

    var rows = tbody.querySelectorAll('tr');
    rows.forEach(function(row) {
        // No-published-version placeholder rows always show
        if (row.querySelector('.exceptions-no-published')) {
            row.style.display = '';
            return;
        }

        var cells = row.querySelectorAll('td');
        if (cells.length < 6) {
            row.style.display = '';
            return;
        }

        var productName = (cells[0].textContent || '').toLowerCase();
        var findingTitle = (cells[1].textContent || '').toLowerCase();
        var severity = (cells[2].textContent || '').toLowerCase();

        var matchesSearch = !searchVal
            || productName.indexOf(searchVal) !== -1
            || findingTitle.indexOf(searchVal) !== -1;

        var matchesSeverity = !severityVal || severity === severityVal;

        row.style.display = (matchesSearch && matchesSeverity) ? '' : 'none';
    });
}

async function load() {
    if (_loaded) return;
    _loaded = true;

    try {
        var resp = await fetch('/api/exceptions');
        if (!resp.ok) {
            var b = await resp.json().catch(function() { return {}; });
            throw new Error(b.error || 'שגיאה');
        }
        _data = await resp.json();
        renderRows(_data);
    } catch (e) {
        var tbody = document.getElementById('exceptions-tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="exceptions-no-published">שגיאה בטעינת הנתונים</td></tr>';
        }
        // Reset so a retry is possible on next tab activation
        _loaded = false;
    }
}

export var ExceptionsPanel = {
    init: function() {
        // Trigger load on first tab-exceptions click
        var tabBtn = document.getElementById('tab-exceptions');
        if (tabBtn) {
            tabBtn.addEventListener('click', function() {
                load();
            });
        }

        // Wire search filter
        var searchEl = document.getElementById('exceptions-search');
        if (searchEl) {
            searchEl.addEventListener('keyup', applyFilters);
        }

        // Wire severity filter
        var severityEl = document.getElementById('exceptions-filter-severity');
        if (severityEl) {
            severityEl.addEventListener('change', applyFilters);
        }
    },
};

// Auto-init when module loads (ESM modules are deferred — DOM is ready)
ExceptionsPanel.init();
