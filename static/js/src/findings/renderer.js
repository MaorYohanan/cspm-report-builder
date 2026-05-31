/**
 * Finding Card Rendering and HTML Generation Module
 * Handles rendering of finding cards, tables, and UI elements
 */

import { severityMap } from './ui-components.js';

/**
 * Escape HTML special characters
 * @param {*} str - String to escape
 * @returns {string} Escaped HTML string
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert text lines to HTML list
 * @param {string} text - Text with newlines
 * @returns {string} HTML unordered list
 */
export function linesToListHtml(text) {
  const lines = splitLines(text);
  if (!lines.length) return '';
  return '<ul>' + lines.map(l => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>';
}

/**
 * Split text into lines, handling various newline formats
 * @param {string|Array} value - Text or array to split
 * @returns {Array<string>} Array of trimmed non-empty lines
 */
export function splitLines(value) {
  const s = (value || '').toString()
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n');
  return s.split('\n').map(l => l.trim()).filter(Boolean);
}

/**
 * Generate safe HTML anchor ID for finding
 * @param {string} id - Finding ID
 * @returns {string} Safe anchor ID
 */
export function makeFindingAnchorId(id) {
  const safe = (id || '')
    .toString()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '');
  return 'finding-' + (safe || 'no-id');
}

/**
 * Build SVG pie chart for severity distribution
 * @param {Object} counts - Severity counts {critical, high, medium, low, info}
 * @param {Object} labelOverrides - Custom labels for severities
 * @returns {string} HTML with SVG chart and legend
 */
export function buildSeverityChartSvg(counts, labelOverrides) {
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

/**
 * Render category count badges
 * @param {Array} findings - All findings
 * @param {HTMLElement} badgesEl - Container element
 * @param {HTMLElement} filterCat - Category filter dropdown
 * @param {Function} renderCallback - Callback to re-render table
 */
export function renderCategoryBadges(findings, badgesEl, filterCat, renderCallback) {
  if (!badgesEl) return;
  if (!findings.length) { badgesEl.innerHTML = ''; return; }

  var counts = {};
  findings.forEach(function(f) {
    var cat = f.category || 'CSPM';
    counts[cat] = (counts[cat] || 0) + 1;
  });

  var html = '<span class="cat-badge' + (!filterCat.value ? ' active' : '') + '" data-cat="">הכל <span class="cat-count">' + findings.length + '</span></span>';
  Object.keys(counts).sort().forEach(function(cat) {
    var isActive = filterCat.value === cat;
    html += '<span class="cat-badge' + (isActive ? ' active' : '') + '" data-cat="' + cat + '">' + cat + ' <span class="cat-count">' + counts[cat] + '</span></span>';
  });

  badgesEl.innerHTML = html;
  badgesEl.querySelectorAll('.cat-badge').forEach(function(badge) {
    badge.addEventListener('click', function() {
      filterCat.value = badge.getAttribute('data-cat');
      renderCallback();
    });
  });
}

/**
 * Sanitize data URL for security
 * @param {string} dataUrl - Data URL to sanitize
 * @returns {string} Sanitized data URL or empty string
 */
export function sanitizeDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  if (!dataUrl.startsWith('data:image/')) return '';
  return dataUrl;
}

/**
 * Validate data URL
 * @param {string} dataUrl - Data URL to validate
 * @returns {boolean} True if valid image data URL
 */
export function isValidDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  return dataUrl.startsWith('data:image/');
}

/**
 * Resize image to consistent dimensions
 * @param {string} dataUrl - Original image data URL
 * @param {number} maxW - Maximum width
 * @param {number} maxH - Maximum height
 * @returns {Promise<string>} Resized image data URL
 */
export function resizeImage(dataUrl, maxW = 800, maxH = 500) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var w = img.width;
      var h = img.height;
      if (w > maxW || h > maxH) {
        var ratio = Math.min(maxW / w, maxH / h);
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
