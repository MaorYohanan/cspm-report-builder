/**
 * Tests for renderer.js module
 * Testing HTML generation, escaping, and rendering functions
 */

import {
  escapeHtml,
  linesToListHtml,
  splitLines,
  makeFindingAnchorId,
  buildSeverityChartSvg,
  renderCategoryBadges,
  sanitizeDataUrl,
  isValidDataUrl,
  resizeImage
} from '../../../static/js/src/findings/renderer.js';

describe('renderer.js', () => {
  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
      expect(escapeHtml('A & B')).toBe('A &amp; B');
      expect(escapeHtml('5 > 3 < 10')).toBe('5 &gt; 3 &lt; 10');
    });

    it('should handle null and undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('should convert non-strings to strings', () => {
      expect(escapeHtml(123)).toBe('123');
      expect(escapeHtml(true)).toBe('true');
      expect(escapeHtml({ toString: () => 'obj' })).toBe('obj');
    });

    it('should handle empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('should escape multiple special characters in sequence', () => {
      expect(escapeHtml('&<>&')).toBe('&amp;&lt;&gt;&amp;');
    });
  });

  describe('splitLines', () => {
    it('should split on newlines', () => {
      expect(splitLines('line1\nline2\nline3')).toEqual(['line1', 'line2', 'line3']);
    });

    it('should handle \\n escape sequences', () => {
      expect(splitLines('line1\\nline2')).toEqual(['line1', 'line2']);
    });

    it('should handle Windows line endings', () => {
      expect(splitLines('line1\r\nline2\r\nline3')).toEqual(['line1', 'line2', 'line3']);
    });

    it('should trim whitespace from lines', () => {
      expect(splitLines('  line1  \n  line2  ')).toEqual(['line1', 'line2']);
    });

    it('should filter empty lines', () => {
      expect(splitLines('line1\n\nline2\n  \nline3')).toEqual(['line1', 'line2', 'line3']);
    });

    it('should handle null and undefined', () => {
      expect(splitLines(null)).toEqual([]);
      expect(splitLines(undefined)).toEqual([]);
      expect(splitLines('')).toEqual([]);
    });

    it('should handle arrays by converting to string', () => {
      expect(splitLines(['item1', 'item2'])).toEqual(['item1,item2']);
    });
  });

  describe('linesToListHtml', () => {
    it('should convert text to HTML list', () => {
      const result = linesToListHtml('line1\nline2\nline3');
      expect(result).toBe('<ul><li>line1</li><li>line2</li><li>line3</li></ul>');
    });

    it('should escape HTML in lines', () => {
      const result = linesToListHtml('<script>\nalert()');
      expect(result).toBe('<ul><li>&lt;script&gt;</li><li>alert()</li></ul>');
    });

    it('should return empty string for empty input', () => {
      expect(linesToListHtml('')).toBe('');
      expect(linesToListHtml(null)).toBe('');
    });

    it('should filter empty lines', () => {
      const result = linesToListHtml('line1\n\nline2');
      expect(result).toBe('<ul><li>line1</li><li>line2</li></ul>');
    });
  });

  describe('makeFindingAnchorId', () => {
    it('should create safe anchor IDs', () => {
      expect(makeFindingAnchorId('FINDING-001')).toBe('finding-FINDING-001');
      expect(makeFindingAnchorId('test 123')).toBe('finding-test-123');
    });

    it('should remove unsafe characters', () => {
      expect(makeFindingAnchorId('test@#$%^&*()')).toBe('finding-test');
      expect(makeFindingAnchorId('a/b\\c')).toBe('finding-abc');
    });

    it('should handle empty and null IDs', () => {
      expect(makeFindingAnchorId('')).toBe('finding-no-id');
      expect(makeFindingAnchorId(null)).toBe('finding-no-id');
      expect(makeFindingAnchorId(undefined)).toBe('finding-no-id');
    });

    it('should replace spaces with hyphens', () => {
      expect(makeFindingAnchorId('my finding id')).toBe('finding-my-finding-id');
      expect(makeFindingAnchorId('multiple   spaces')).toBe('finding-multiple-spaces');
    });

    it('should preserve underscores and remove dots', () => {
      expect(makeFindingAnchorId('test.id_123')).toBe('finding-testid_123');
      expect(makeFindingAnchorId('test_id')).toBe('finding-test_id');
    });
  });

  describe('buildSeverityChartSvg', () => {
    it('should build SVG pie chart with legend', () => {
      const counts = { critical: 5, high: 10, medium: 15, low: 8, info: 2 };
      const labels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
      const result = buildSeverityChartSvg(counts, labels);

      expect(result).toContain('<svg');
      expect(result).toContain('width="200"');
      expect(result).toContain('height="200"');
      expect(result).toContain('Critical (5)');
      expect(result).toContain('High (10)');
      expect(result).toContain('Medium (15)');
    });

    it('should handle zero counts', () => {
      const counts = { critical: 0, high: 5, medium: 0, low: 0, info: 0 };
      const labels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
      const result = buildSeverityChartSvg(counts, labels);

      expect(result).toContain('High (5)');
      expect(result).not.toContain('Critical (0)');
    });

    it('should return empty string when all counts are zero', () => {
      const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      const labels = {};
      const result = buildSeverityChartSvg(counts, labels);

      expect(result).toBe('');
    });

    it('should include severity colors', () => {
      const counts = { critical: 1, high: 0, medium: 0, low: 0, info: 0 };
      const labels = { critical: 'Critical' };
      const result = buildSeverityChartSvg(counts, labels);

      expect(result).toContain('#b91c1c'); // critical color
    });

    it('should handle missing label overrides', () => {
      const counts = { critical: 5, high: 10, medium: 0, low: 0, info: 0 };
      const result = buildSeverityChartSvg(counts, null);

      expect(result).toContain('קריטי'); // Hebrew default
      expect(result).toContain('גבוה');
    });
  });

  describe('renderCategoryBadges', () => {
    let container, filterCat, renderCallback;

    beforeEach(() => {
      // Setup DOM
      container = document.createElement('div');
      filterCat = document.createElement('select');

      // Add options to select for testing
      const optAll = document.createElement('option');
      optAll.value = '';
      filterCat.appendChild(optAll);

      const optCSPM = document.createElement('option');
      optCSPM.value = 'CSPM';
      filterCat.appendChild(optCSPM);

      const optKSPM = document.createElement('option');
      optKSPM.value = 'KSPM';
      filterCat.appendChild(optKSPM);

      filterCat.value = '';
      renderCallback = jest.fn();
    });

    it('should render category badges with counts', () => {
      const findings = [
        { category: 'CSPM' },
        { category: 'CSPM' },
        { category: 'KSPM' },
        { category: 'VULN' }
      ];

      renderCategoryBadges(findings, container, filterCat, renderCallback);

      expect(container.innerHTML).toContain('הכל');
      expect(container.innerHTML).toContain('CSPM');
      expect(container.innerHTML).toContain('KSPM');
      expect(container.innerHTML).toContain('VULN');
      expect(container.innerHTML).toContain('cat-count">2<'); // CSPM count
      expect(container.innerHTML).toContain('cat-count">1<'); // KSPM count
    });

    it('should mark "All" badge as active when no filter', () => {
      const findings = [{ category: 'CSPM' }];
      filterCat.value = '';

      renderCategoryBadges(findings, container, filterCat, renderCallback);

      const allBadge = container.querySelector('[data-cat=""]');
      expect(allBadge.classList.contains('active')).toBe(true);
    });

    it('should mark category badge as active when filtered', () => {
      const findings = [{ category: 'CSPM' }, { category: 'KSPM' }];

      // Pre-set the filter value
      filterCat.value = 'CSPM';

      renderCategoryBadges(findings, container, filterCat, renderCallback);

      const cspmBadge = container.querySelector('[data-cat="CSPM"]');
      expect(cspmBadge.classList.contains('active')).toBe(true);

      const kspmBadge = container.querySelector('[data-cat="KSPM"]');
      expect(kspmBadge.classList.contains('active')).toBe(false);
    });

    it('should handle click events on badges', () => {
      const findings = [{ category: 'CSPM' }];

      renderCategoryBadges(findings, container, filterCat, renderCallback);

      const badge = container.querySelector('[data-cat="CSPM"]');
      expect(badge).toBeTruthy();

      // Verify initial filter value is empty
      expect(filterCat.value).toBe('');

      // Click should update filter and call callback
      badge.click();

      expect(filterCat.value).toBe('CSPM');
      expect(renderCallback).toHaveBeenCalled();
    });

    it('should handle empty findings array', () => {
      renderCategoryBadges([], container, filterCat, renderCallback);

      expect(container.innerHTML).toBe('');
    });

    it('should handle null container', () => {
      expect(() => {
        renderCategoryBadges([{ category: 'CSPM' }], null, filterCat, renderCallback);
      }).not.toThrow();
    });

    it('should use CSPM as default category', () => {
      const findings = [{ category: null }, { category: undefined }, {}];

      renderCategoryBadges(findings, container, filterCat, renderCallback);

      expect(container.innerHTML).toContain('CSPM');
      expect(container.innerHTML).toContain('cat-count">3<');
    });
  });

  describe('sanitizeDataUrl', () => {
    it('should allow valid image data URLs', () => {
      const url = 'data:image/png;base64,iVBORw0KGgo=';
      expect(sanitizeDataUrl(url)).toBe(url);
    });

    it('should allow different image types', () => {
      expect(sanitizeDataUrl('data:image/jpeg;base64,abc')).toBe('data:image/jpeg;base64,abc');
      expect(sanitizeDataUrl('data:image/gif;base64,abc')).toBe('data:image/gif;base64,abc');
      expect(sanitizeDataUrl('data:image/webp;base64,abc')).toBe('data:image/webp;base64,abc');
    });

    it('should reject non-image data URLs', () => {
      expect(sanitizeDataUrl('data:text/html;base64,abc')).toBe('');
      expect(sanitizeDataUrl('data:application/javascript;base64,abc')).toBe('');
    });

    it('should reject non-data URLs', () => {
      expect(sanitizeDataUrl('http://example.com/image.png')).toBe('');
      expect(sanitizeDataUrl('javascript:alert(1)')).toBe('');
      expect(sanitizeDataUrl('file:///etc/passwd')).toBe('');
    });

    it('should handle null and undefined', () => {
      expect(sanitizeDataUrl(null)).toBe('');
      expect(sanitizeDataUrl(undefined)).toBe('');
    });

    it('should handle non-string inputs', () => {
      expect(sanitizeDataUrl(123)).toBe('');
      expect(sanitizeDataUrl({})).toBe('');
    });
  });

  describe('isValidDataUrl', () => {
    it('should validate image data URLs', () => {
      expect(isValidDataUrl('data:image/png;base64,abc')).toBe(true);
      expect(isValidDataUrl('data:image/jpeg;base64,abc')).toBe(true);
    });

    it('should reject non-image data URLs', () => {
      expect(isValidDataUrl('data:text/html;base64,abc')).toBe(false);
    });

    it('should reject regular URLs', () => {
      expect(isValidDataUrl('http://example.com')).toBe(false);
    });

    it('should handle null and undefined', () => {
      expect(isValidDataUrl(null)).toBe(false);
      expect(isValidDataUrl(undefined)).toBe(false);
    });

    it('should handle non-string inputs', () => {
      expect(isValidDataUrl(123)).toBe(false);
      expect(isValidDataUrl({})).toBe(false);
    });
  });

  describe('resizeImage', () => {
    beforeEach(() => {
      // Mock Image constructor
      global.Image = class {
        constructor() {
          this.width = 1000;
          this.height = 800;
          setTimeout(() => {
            if (this.onload) this.onload();
          }, 0);
        }
        set src(value) {
          this._src = value;
        }
        get src() {
          return this._src;
        }
      };

      // Mock canvas
      global.HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
        drawImage: jest.fn()
      }));
      global.HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/png;base64,resized');
    });

    it('should resize image larger than max dimensions', async () => {
      const result = await resizeImage('data:image/png;base64,abc', 800, 500);
      expect(result).toBe('data:image/png;base64,resized');
    });

    it('should handle custom max dimensions', async () => {
      const result = await resizeImage('data:image/png;base64,abc', 400, 300);
      expect(result).toBe('data:image/png;base64,resized');
    });

    it('should use default dimensions when not specified', async () => {
      const result = await resizeImage('data:image/png;base64,abc');
      expect(result).toBe('data:image/png;base64,resized');
    });
  });
});
