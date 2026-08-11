import { state } from './state.js';
import { escapeHtml } from './core.js';

// ── Theme toggle ──
(function() {
  var saved = localStorage.getItem('cspm_theme') || 'dark';
  if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  var btn = document.getElementById('btn-theme-toggle');
  function updateIcon() {
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    btn.textContent = isLight ? '☀️' : '🌙';
  }
  updateIcon();
  btn.addEventListener('click', function() {
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('cspm_theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('cspm_theme', 'light');
    }
    updateIcon();
  });
})();

// ── Sidebar collapse toggle ──
(function() {
  var sidebar = document.getElementById('app-sidebar');
  var collapseBtn = document.getElementById('btn-sidebar-collapse');
  if (!sidebar || !collapseBtn) return;
  var saved = localStorage.getItem('cspm_sidebar_collapsed');
  if (saved === 'true') sidebar.classList.add('collapsed');

  collapseBtn.addEventListener('click', function() {
    sidebar.classList.toggle('collapsed');
    var isCollapsed = sidebar.classList.contains('collapsed');
    collapseBtn.textContent = isCollapsed ? '»' : '«';
    localStorage.setItem('cspm_sidebar_collapsed', isCollapsed);
  });

  // Set initial icon
  if (sidebar.classList.contains('collapsed')) collapseBtn.textContent = '»';
})();

// ── Animated mesh background ──
(function() {
  var main = document.getElementById('main-content');
  if (!main) return;
  var canvas = document.createElement('canvas');
  canvas.id = 'mesh-bg';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.5;';
  main.insertBefore(canvas, main.firstChild);

  var ctx = canvas.getContext('2d');
  var dots = [];
  var numDots = 90;
  var maxDist = 130;
  var animId;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function initDots() {
    dots = [];
    for (var i = 0; i < numDots; i++) {
      dots.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var isDark = !document.documentElement.getAttribute('data-theme') || document.documentElement.getAttribute('data-theme') === 'dark';
    var dotColor = isDark ? 'rgba(130,150,230,' : 'rgba(70,90,170,';
    var lineColor = isDark ? 'rgba(110,140,220,' : 'rgba(70,90,170,';

    // Move dots
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      d.x += d.vx;
      d.y += d.vy;
      if (d.x < 0 || d.x > canvas.width) d.vx *= -1;
      if (d.y < 0 || d.y > canvas.height) d.vy *= -1;
    }

    // Draw lines
    for (var i = 0; i < dots.length; i++) {
      for (var j = i + 1; j < dots.length; j++) {
        var dx = dots[i].x - dots[j].x;
        var dy = dots[i].y - dots[j].y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < maxDist) {
          var alpha = (1 - dist / maxDist) * 0.4;
          ctx.beginPath();
          ctx.strokeStyle = lineColor + alpha + ')';
          ctx.lineWidth = 0.8;
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(dots[j].x, dots[j].y);
          ctx.stroke();
        }
      }
    }

    // Draw dots
    for (var i = 0; i < dots.length; i++) {
      ctx.beginPath();
      ctx.arc(dots[i].x, dots[i].y, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = dotColor + '0.7)';
      ctx.fill();
    }

    animId = requestAnimationFrame(draw);
  }

  resize();
  initDots();
  draw();

  window.addEventListener('resize', function() {
    resize();
    initDots();
  });
})();

// ── Sidebar section collapse ──
(function() {
  var labels = document.querySelectorAll('.sidebar-section-label[data-collapse]');
  labels.forEach(function(label) {
    var targetId = label.getAttribute('data-collapse');
    var nav = document.getElementById(targetId);
    if (!nav) return;

    // Restore saved state
    var key = 'cspm_nav_' + targetId;
    var saved = localStorage.getItem(key);
    if (saved === 'collapsed') {
      label.classList.add('collapsed');
      nav.classList.add('collapsed');
    }

    label.addEventListener('click', function() {
      var isCollapsed = nav.classList.toggle('collapsed');
      label.classList.toggle('collapsed', isCollapsed);
      localStorage.setItem(key, isCollapsed ? 'collapsed' : 'open');
    });
  });
})();

// ── Keyboard shortcuts overlay ──
(function() {
  var kbdOverlay = document.getElementById('kbd-overlay');
  var btnKbdHelp = document.getElementById('btn-kbd-help');
  var kbdClose   = document.getElementById('kbd-overlay-close');
  if (kbdOverlay && btnKbdHelp && kbdClose) {
    btnKbdHelp.addEventListener('click', function() {
      kbdOverlay.classList.toggle('hidden');
    });
    kbdClose.addEventListener('click', function() {
      kbdOverlay.classList.add('hidden');
    });
    kbdOverlay.addEventListener('click', function(e) {
      if (e.target === kbdOverlay) kbdOverlay.classList.add('hidden');
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === '?' && !['INPUT','TEXTAREA','SELECT'].includes((document.activeElement||{}).tagName)) {
        e.preventDefault();
        kbdOverlay.classList.toggle('hidden');
      }
      if (e.key === 'Escape' && !kbdOverlay.classList.contains('hidden')) {
        kbdOverlay.classList.add('hidden');
      }
    });
  }
})();

// ── Progress / sidebar state ──
export function updateStepper() {
  // Update sidebar findings badge
  var badge = document.getElementById('step-findings-count');
  if (badge) {
    badge.textContent = state.findings.length > 0 ? state.findings.length : '';
  }
  // Update sidebar env label
  var envLabel = document.getElementById('sidebar-env-label');
  var cloudEl = document.getElementById('report-cloud');
  var envStageChecked = [...document.querySelectorAll('input[name="report-env-stage"]:checked')];
  var cloudVal = (cloudEl && cloudEl.value.trim()) || '';
  var envVal = envStageChecked.map(function(cb) { return cb.value; }).join(', ');
  var combinedLabel = [cloudVal, envVal].filter(Boolean).join(' · ') || 'לא הוגדרה סביבה';
  if (envLabel) envLabel.textContent = combinedLabel;
  // Update progress — 4 steps
  var clientEl = document.getElementById('report-client');
  var hasClient = !!(clientEl && clientEl.value.trim());
  var hasEnv = !!(cloudVal || envStageChecked.length);
  var hasFindings = state.findings.length > 0;
  var hasExported = !!(localStorage.getItem('cspm_has_exported'));

  var steps = 0;
  if (hasClient) steps++;
  if (hasEnv) steps++;
  if (hasFindings) steps++;
  if (hasExported) steps++;
  var pct = Math.round((steps / 4) * 100);

  var progressText = document.getElementById('sidebar-progress-text');
  var progressFill = document.getElementById('sidebar-progress-fill');
  var progressLabel = document.getElementById('sidebar-progress-label');
  if (progressText) progressText.textContent = pct + '%';
  if (progressFill) progressFill.style.width = pct + '%';
  if (progressLabel) progressLabel.textContent = steps + ' מתוך 4 שלבים';

  // Update tooltip checklist
  var tooltip = document.getElementById('progress-tooltip');
  if (tooltip) {
    tooltip.innerHTML =
      '<div class="progress-tooltip-item ' + (hasClient ? 'done' : '') + '"><span class="progress-tooltip-icon">' + (hasClient ? '✓' : '✗') + '</span> שם לקוח</div>' +
      '<div class="progress-tooltip-item ' + (hasEnv ? 'done' : '') + '"><span class="progress-tooltip-icon">' + (hasEnv ? '✓' : '✗') + '</span> סביבת ענן</div>' +
      '<div class="progress-tooltip-item ' + (hasFindings ? 'done' : '') + '"><span class="progress-tooltip-icon">' + (hasFindings ? '✓' : '✗') + '</span> ממצאים</div>' +
      '<div class="progress-tooltip-item ' + (hasExported ? 'done' : '') + '"><span class="progress-tooltip-icon">' + (hasExported ? '✓' : '✗') + '</span> ייצוא דו"ח</div>';
  }
}

// ── oklch color helper ──
// SVG presentation attributes and JS-injected CSS values are not processed by
// the CSS engine's color-function parser in all browsers. This helper returns
// the oklch literal when supported, and a pre-computed hex fallback otherwise.
// (DES-I-02: role="img" + aria-label are added to the donut SVG string below,
// so no separate <title> element is needed.)
function safeColor(oklchVal, hexFallback) {
  return CSS.supports('color', oklchVal) ? oklchVal : hexFallback;
}

// ── Dashboard ──
export function renderDashboard() {
  var total = state.findings.length;
  var crit = 0, high = 0, med = 0, low = 0;
  var cats = {};
  state.findings.forEach(function(f) {
    if (f.severity === 'critical') crit++;
    else if (f.severity === 'high') high++;
    else if (f.severity === 'medium') med++;
    else if (f.severity === 'low') low++;
    var c = f.category || 'CSPM';
    cats[c] = (cats[c] || 0) + 1;
  });

  var kpiTotal = document.getElementById('kpi-total');
  var kpiCrit = document.getElementById('kpi-critical');
  var kpiHigh = document.getElementById('kpi-high');
  var kpiMed = document.getElementById('kpi-medium');
  var kpiLow = document.getElementById('kpi-low');
  if (kpiTotal) kpiTotal.textContent = total;
  if (kpiCrit) kpiCrit.textContent = crit;
  if (kpiHigh) kpiHigh.textContent = high;
  if (kpiMed) kpiMed.textContent = med;
  if (kpiLow) kpiLow.textContent = low;

  // Donut chart
  var donutEl = document.getElementById('dashboard-donut');
  if (donutEl) {
    if (total === 0) {
      donutEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">אין ממצאים</div>';
    } else {
      var segments = [
        { count: crit, color: safeColor('oklch(0.58 0.22 15)', '#d94f3a'), label: 'קריטי' },
        { count: high, color: safeColor('oklch(0.68 0.18 40)', '#d4813a'), label: 'גבוה' },
        { count: med,  color: safeColor('oklch(0.72 0.16 80)', '#c8b23a'), label: 'בינוני' },
        { count: low,  color: safeColor('oklch(0.62 0.17 155)', '#3aad72'), label: 'נמוך' }
      ].filter(function(s) { return s.count > 0; });
      // DES-I-02: role="img" + aria-label make this SVG accessible without a <title> element.
      var svg = '<svg viewBox="0 0 120 120" width="100" height="100" role="img" aria-label="תרשים עוגה לפי חומרה" style="display:block;margin:0 auto;">';
      var offset = 0;
      var circumference = 2 * Math.PI * 38;
      segments.forEach(function(seg) {
        var pct = seg.count / total;
        var dash = pct * circumference;
        var gap = circumference - dash;
        svg += '<circle cx="60" cy="60" r="38" fill="none" stroke="' + seg.color + '" stroke-width="14" stroke-dasharray="' + dash + ' ' + gap + '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 60 60)"/>';
        offset += dash;
      });
      svg += '<text x="60" y="56" text-anchor="middle" fill="var(--text-heading)" font-size="18" font-weight="800">' + total + '</text>';
      svg += '<text x="60" y="72" text-anchor="middle" fill="var(--text-muted)" font-size="9">ממצאים</text>';
      svg += '</svg>';
      var legend = '<div style="margin-top:10px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">';
      segments.forEach(function(seg) {
        legend += '<span style="font-size:11px;display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:' + seg.color + ';"></span>' + seg.label + ' ' + seg.count + '</span>';
      });
      legend += '</div>';
      donutEl.innerHTML = svg + legend;
    }
  }

  // Category bars
  var catsEl = document.getElementById('dashboard-categories');
  if (catsEl) {
    if (total === 0) {
      catsEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">אין נתונים</div>';
    } else {
      var catColors = {
        CSPM: safeColor('oklch(0.58 0.2 220)',  '#3a7fd4'),
        KSPM: safeColor('oklch(0.58 0.18 280)', '#7a5fd4'),
        DSPM: safeColor('oklch(0.58 0.2 180)',  '#3ab5b5'),
        VULN: safeColor('oklch(0.58 0.22 15)',  '#d94f3a'),
        NEXP: safeColor('oklch(0.68 0.18 40)',  '#d4813a'),
        EAPM: safeColor('oklch(0.72 0.16 80)',  '#c8b23a'),
        HSPM: safeColor('oklch(0.62 0.17 155)', '#3aad72'),
        SECR: safeColor('oklch(0.62 0.18 300)', '#b55fd4'),
        EOLM: safeColor('oklch(0.6 0.02 220)',  '#6b7a8d')
      };
      var maxCat = Math.max.apply(null, Object.values(cats));
      var barsHtml = '';
      Object.keys(cats).sort(function(a,b) { return cats[b] - cats[a]; }).forEach(function(cat) {
        var pct = Math.round((cats[cat] / maxCat) * 100);
        var color = catColors[cat] || 'var(--accent)';
        barsHtml += '<div class="dashboard-bar-row"><span class="dashboard-bar-label">' + cat + '</span><div class="dashboard-bar-track"><div class="dashboard-bar-fill" style="width:' + pct + '%;background:' + color + ';"></div></div><span class="dashboard-bar-count">' + cats[cat] + '</span></div>';
      });
      catsEl.innerHTML = barsHtml;
    }
  }

  // Risk summary
  var riskEl = document.getElementById('dashboard-risk-summary');
  if (riskEl) {
    var riskField = document.getElementById('report-risk');
    var riskVal = riskField ? riskField.value : '';
    var riskColor = riskVal === 'קריטית' ? safeColor('oklch(0.58 0.22 15)', '#d94f3a') :
                   riskVal === 'גבוהה'   ? safeColor('oklch(0.68 0.18 40)', '#d4813a') :
                   riskVal === 'בינונית' ? safeColor('oklch(0.72 0.16 80)', '#c8b23a') :
                                           safeColor('oklch(0.62 0.17 155)', '#3aad72');
    riskEl.innerHTML = '<div style="font-size:28px;font-weight:800;color:' + riskColor + ';">' + (riskVal || 'לא הוגדר') + '</div>' +
      '<div style="margin-top:8px;font-size:12px;color:var(--text-muted);">' + total + ' ממצאים | ' + crit + ' קריטיים | ' + high + ' גבוהים</div>';
  }

  // Recent findings
  var recentEl = document.getElementById('dashboard-recent-findings');
  if (recentEl) {
    if (total === 0) {
      recentEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">אין ממצאים עדיין</div>';
    } else {
      var recent = state.findings.slice(0, 5);
      var h = '<table style="width:100%;font-size:12px;"><thead><tr><th>מזהה</th><th>קטגוריה</th><th>כותרת</th><th>חומרה</th><th>בעלים</th></tr></thead><tbody>';
      recent.forEach(function(f) {
        var sev = state.severityMap[f.severity] || state.severityMap.medium;
        h += '<tr><td style="color:var(--accent);font-family:monospace;">' + escapeHtml(f.id || '') + '</td><td><span class="tag-inline">' + escapeHtml(f.category || '') + '</span></td><td>' + escapeHtml((f.title || '').substring(0, 50)) + '</td><td><span class="severity-chip ' + sev.class + '">' + sev.text + '</span></td><td>' + escapeHtml(f.owner || '—') + '</td></tr>';
      });
      h += '</tbody></table>';
      recentEl.innerHTML = h;
    }
  }
}
