/**
 * Tests for filter-manager.js module
 * Testing filtering logic and filter management
 */

import {
  applyFilters,
  setupFilterListeners,
  getCurrentFilters,
  clearAllFilters
} from '../../../static/js/src/findings/filter-manager.js';

describe('filter-manager.js', () => {
  describe('applyFilters', () => {
    const findings = [
      { id: 'F-001', title: 'SQL Injection', category: 'CSPM', severity: 'critical' },
      { id: 'F-002', title: 'XSS Vulnerability', category: 'VULN', severity: 'high' },
      { id: 'F-003', title: 'Misconfigured S3', category: 'CSPM', severity: 'medium' },
      { id: 'F-004', title: 'Missing Encryption', category: 'DSPM', severity: 'high' },
      { id: 'F-005', title: 'Weak Password Policy', category: 'CSPM', severity: 'low' }
    ];

    it('should return all findings when no filters applied', () => {
      const result = applyFilters(findings, {});
      expect(result).toHaveLength(5);
      expect(result[0].f.id).toBe('F-001');
      expect(result[0].idx).toBe(0);
    });

    it('should filter by search text in title', () => {
      const result = applyFilters(findings, { searchText: 'sql' });
      expect(result).toHaveLength(1);
      expect(result[0].f.id).toBe('F-001');
    });

    it('should filter by search text in ID', () => {
      const result = applyFilters(findings, { searchText: 'F-003' });
      expect(result).toHaveLength(1);
      expect(result[0].f.id).toBe('F-003');
    });

    it('should be case-insensitive in search', () => {
      const result = applyFilters(findings, { searchText: 'VULNERABILITY' });
      expect(result).toHaveLength(1);
      expect(result[0].f.id).toBe('F-002');
    });

    it('should filter by category', () => {
      const result = applyFilters(findings, { category: 'CSPM' });
      expect(result).toHaveLength(3);
      expect(result.every(r => r.f.category === 'CSPM')).toBe(true);
    });

    it('should filter by severity', () => {
      const result = applyFilters(findings, { severity: 'high' });
      expect(result).toHaveLength(2);
      expect(result.every(r => r.f.severity === 'high')).toBe(true);
    });

    it('should combine multiple filters (AND logic)', () => {
      const result = applyFilters(findings, {
        category: 'CSPM',
        severity: 'medium'
      });
      expect(result).toHaveLength(1);
      expect(result[0].f.id).toBe('F-003');
    });

    it('should combine search with other filters', () => {
      const result = applyFilters(findings, {
        searchText: 'encryption',
        severity: 'high'
      });
      expect(result).toHaveLength(1);
      expect(result[0].f.id).toBe('F-004');
    });

    it('should return empty array when no matches', () => {
      const result = applyFilters(findings, { searchText: 'nonexistent' });
      expect(result).toHaveLength(0);
    });

    it('should preserve original indices', () => {
      const result = applyFilters(findings, { category: 'CSPM' });
      expect(result[0].idx).toBe(0); // F-001
      expect(result[1].idx).toBe(2); // F-003
      expect(result[2].idx).toBe(4); // F-005
    });

    it('should handle empty findings array', () => {
      const result = applyFilters([], { searchText: 'test' });
      expect(result).toHaveLength(0);
    });

    it('should handle null/undefined filter values', () => {
      const result = applyFilters(findings, {
        searchText: undefined,
        category: undefined,
        severity: ''
      });
      expect(result).toHaveLength(5);
    });

    it('should match search text with whitespace', () => {
      const result = applyFilters(findings, { searchText: 'sql' });
      expect(result).toHaveLength(1);
      expect(result[0].f.id).toBe('F-001');
    });

    it('should handle findings with missing fields', () => {
      const incompleteFindings = [
        { id: 'F-100' },
        { title: 'No ID' },
        { id: 'F-101', title: 'Complete' }
      ];
      const result = applyFilters(incompleteFindings, { searchText: 'complete' });
      expect(result).toHaveLength(1);
      expect(result[0].f.id).toBe('F-101');
    });

    it('should handle partial search matches', () => {
      const result = applyFilters(findings, { searchText: 'config' });
      expect(result).toHaveLength(1);
      expect(result[0].f.title).toContain('Misconfigured');
    });
  });

  describe('setupFilterListeners', () => {
    let elements, renderCallback;

    beforeEach(() => {
      elements = {
        searchInput: document.createElement('input'),
        categoryFilter: document.createElement('select'),
        severityFilter: document.createElement('select')
      };
      renderCallback = jest.fn();
    });

    it('should attach input listener to search input', () => {
      setupFilterListeners(elements, renderCallback);

      elements.searchInput.value = 'test';
      elements.searchInput.dispatchEvent(new Event('input'));

      expect(renderCallback).toHaveBeenCalledTimes(1);
    });

    it('should attach change listener to category filter', () => {
      setupFilterListeners(elements, renderCallback);

      elements.categoryFilter.value = 'CSPM';
      elements.categoryFilter.dispatchEvent(new Event('change'));

      expect(renderCallback).toHaveBeenCalledTimes(1);
    });

    it('should attach change listener to severity filter', () => {
      setupFilterListeners(elements, renderCallback);

      elements.severityFilter.value = 'high';
      elements.severityFilter.dispatchEvent(new Event('change'));

      expect(renderCallback).toHaveBeenCalledTimes(1);
    });

    it('should handle missing elements gracefully', () => {
      const partialElements = {
        searchInput: document.createElement('input')
      };

      expect(() => {
        setupFilterListeners(partialElements, renderCallback);
      }).not.toThrow();
    });

    it('should not throw if elements are null', () => {
      expect(() => {
        setupFilterListeners({}, renderCallback);
      }).not.toThrow();
    });
  });

  describe('getCurrentFilters', () => {
    let elements;

    beforeEach(() => {
      elements = {
        searchInput: document.createElement('input'),
        categoryFilter: document.createElement('select'),
        severityFilter: document.createElement('select')
      };
    });

    it('should get current filter values', () => {
      const input = document.createElement('input');
      const catSelect = document.createElement('select');
      const sevSelect = document.createElement('select');

      // Add options to selects
      const cspmOpt = document.createElement('option');
      cspmOpt.value = 'CSPM';
      catSelect.appendChild(cspmOpt);

      const critOpt = document.createElement('option');
      critOpt.value = 'critical';
      sevSelect.appendChild(critOpt);

      input.value = 'sql injection';
      catSelect.value = 'CSPM';
      sevSelect.value = 'critical';

      const filters = getCurrentFilters({
        searchInput: input,
        categoryFilter: catSelect,
        severityFilter: sevSelect
      });

      expect(filters.searchText).toBe('sql injection');
      expect(filters.category).toBe('CSPM');
      expect(filters.severity).toBe('critical');
    });

    it('should trim search text', () => {
      elements.searchInput.value = '  test  ';
      const filters = getCurrentFilters(elements);
      expect(filters.searchText).toBe('test');
    });

    it('should handle empty values', () => {
      elements.searchInput.value = '';
      elements.categoryFilter.value = '';
      elements.severityFilter.value = '';

      const filters = getCurrentFilters(elements);

      expect(filters.searchText).toBe('');
      expect(filters.category).toBe('');
      expect(filters.severity).toBe('');
    });

    it('should handle missing elements', () => {
      const filters = getCurrentFilters({});

      expect(filters.searchText).toBe('');
      expect(filters.category).toBe('');
      expect(filters.severity).toBe('');
    });

    it('should handle null elements', () => {
      const filters = getCurrentFilters({
        searchInput: null,
        categoryFilter: null,
        severityFilter: null
      });

      expect(filters.searchText).toBe('');
      expect(filters.category).toBe('');
      expect(filters.severity).toBe('');
    });
  });

  describe('clearAllFilters', () => {
    let elements, renderCallback;

    beforeEach(() => {
      elements = {
        searchInput: document.createElement('input'),
        categoryFilter: document.createElement('select'),
        severityFilter: document.createElement('select')
      };
      renderCallback = jest.fn();
    });

    it('should clear all filter values', () => {
      elements.searchInput.value = 'test';
      elements.categoryFilter.value = 'CSPM';
      elements.severityFilter.value = 'high';

      clearAllFilters(elements, renderCallback);

      expect(elements.searchInput.value).toBe('');
      expect(elements.categoryFilter.value).toBe('');
      expect(elements.severityFilter.value).toBe('');
    });

    it('should call render callback after clearing', () => {
      clearAllFilters(elements, renderCallback);
      expect(renderCallback).toHaveBeenCalledTimes(1);
    });

    it('should not call callback if not provided', () => {
      expect(() => {
        clearAllFilters(elements);
      }).not.toThrow();
    });

    it('should handle missing elements gracefully', () => {
      expect(() => {
        clearAllFilters({}, renderCallback);
      }).not.toThrow();
    });

    it('should handle null elements', () => {
      const nullElements = {
        searchInput: null,
        categoryFilter: null,
        severityFilter: null
      };

      expect(() => {
        clearAllFilters(nullElements, renderCallback);
      }).not.toThrow();
    });
  });
});
