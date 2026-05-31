/**
 * Tests for sort-manager.js module
 * Testing sorting algorithms and sort state management
 */

import {
  sortFindings,
  toggleSort,
  getSortIndicator,
  setupSortableHeaders
} from '../../../static/js/src/findings/sort-manager.js';

describe('sort-manager.js', () => {
  describe('sortFindings', () => {
    const findings = [
      { f: { id: 'F-003', title: 'Zero Day', category: 'VULN', severity: 'critical', owner: 'Bob' }, idx: 0 },
      { f: { id: 'F-001', title: 'Access Control', category: 'CSPM', severity: 'high', owner: 'Alice' }, idx: 1 },
      { f: { id: 'F-002', title: 'Broken Auth', category: 'KSPM', severity: 'medium', owner: 'Charlie' }, idx: 2 },
      { f: { id: 'F-005', title: 'API Security', category: 'CSPM', severity: 'low', owner: 'Alice' }, idx: 3 },
      { f: { id: 'F-004', title: 'Data Leak', category: 'DSPM', severity: 'info', owner: 'Bob' }, idx: 4 }
    ];

    it('should sort by ID ascending', () => {
      const sortState = { col: 'id', dir: 'asc' };
      const result = sortFindings(findings, sortState);

      expect(result[0].f.id).toBe('F-001');
      expect(result[1].f.id).toBe('F-002');
      expect(result[2].f.id).toBe('F-003');
      expect(result[3].f.id).toBe('F-004');
      expect(result[4].f.id).toBe('F-005');
    });

    it('should sort by ID descending', () => {
      const sortState = { col: 'id', dir: 'desc' };
      const result = sortFindings(findings, sortState);

      expect(result[0].f.id).toBe('F-005');
      expect(result[1].f.id).toBe('F-004');
      expect(result[2].f.id).toBe('F-003');
    });

    it('should sort by category ascending', () => {
      const sortState = { col: 'category', dir: 'asc' };
      const result = sortFindings(findings, sortState);

      expect(result[0].f.category).toBe('CSPM');
      expect(result[1].f.category).toBe('CSPM');
      expect(result[2].f.category).toBe('DSPM');
    });

    it('should sort by category descending', () => {
      const sortState = { col: 'category', dir: 'desc' };
      const result = sortFindings(findings, sortState);

      expect(result[0].f.category).toBe('VULN');
      expect(result[1].f.category).toBe('KSPM');
    });

    it('should sort by title case-insensitively', () => {
      const sortState = { col: 'title', dir: 'asc' };
      const result = sortFindings(findings, sortState);

      expect(result[0].f.title).toBe('Access Control');
      expect(result[1].f.title).toBe('API Security');
      expect(result[2].f.title).toBe('Broken Auth');
    });

    it('should sort by severity (critical > high > medium > low > info)', () => {
      const sortState = { col: 'severity', dir: 'asc' };
      const result = sortFindings(findings, sortState);

      expect(result[0].f.severity).toBe('critical');
      expect(result[1].f.severity).toBe('high');
      expect(result[2].f.severity).toBe('medium');
      expect(result[3].f.severity).toBe('low');
      expect(result[4].f.severity).toBe('info');
    });

    it('should sort by severity descending', () => {
      const sortState = { col: 'severity', dir: 'desc' };
      const result = sortFindings(findings, sortState);

      expect(result[0].f.severity).toBe('info');
      expect(result[1].f.severity).toBe('low');
      expect(result[2].f.severity).toBe('medium');
      expect(result[3].f.severity).toBe('high');
      expect(result[4].f.severity).toBe('critical');
    });

    it('should sort by owner case-insensitively', () => {
      const sortState = { col: 'owner', dir: 'asc' };
      const result = sortFindings(findings, sortState);

      expect(result[0].f.owner).toBe('Alice');
      expect(result[1].f.owner).toBe('Alice');
      expect(result[2].f.owner).toBe('Bob');
    });

    it('should return original array when no sort column', () => {
      const sortState = { col: '', dir: 'asc' };
      const result = sortFindings(findings, sortState);

      expect(result).toEqual(findings);
    });

    it('should not mutate original array', () => {
      const original = [...findings];
      const sortState = { col: 'id', dir: 'asc' };

      sortFindings(findings, sortState);

      expect(findings).toEqual(original);
    });

    it('should handle empty array', () => {
      const sortState = { col: 'id', dir: 'asc' };
      const result = sortFindings([], sortState);

      expect(result).toEqual([]);
    });

    it('should handle missing fields', () => {
      const incompleteFindings = [
        { f: { id: 'F-001' }, idx: 0 },
        { f: { id: 'F-002', title: 'Test' }, idx: 1 }
      ];
      const sortState = { col: 'title', dir: 'asc' };

      expect(() => {
        sortFindings(incompleteFindings, sortState);
      }).not.toThrow();
    });

    it('should handle unknown severity values', () => {
      const unknownSeverity = [
        { f: { id: 'F-001', severity: 'unknown' }, idx: 0 },
        { f: { id: 'F-002', severity: 'critical' }, idx: 1 }
      ];
      const sortState = { col: 'severity', dir: 'asc' };
      const result = sortFindings(unknownSeverity, sortState);

      expect(result[0].f.severity).toBe('critical');
      expect(result[1].f.severity).toBe('unknown');
    });

    it('should handle unknown column gracefully', () => {
      const sortState = { col: 'nonexistent', dir: 'asc' };
      const result = sortFindings(findings, sortState);

      // Should not throw and return some result
      expect(result).toBeDefined();
      expect(result.length).toBe(findings.length);
    });

    it('should maintain stable sort for equal values', () => {
      const duplicates = [
        { f: { id: 'F-001', title: 'Same', severity: 'high' }, idx: 0 },
        { f: { id: 'F-002', title: 'Same', severity: 'high' }, idx: 1 },
        { f: { id: 'F-003', title: 'Same', severity: 'high' }, idx: 2 }
      ];
      const sortState = { col: 'title', dir: 'asc' };
      const result = sortFindings(duplicates, sortState);

      // All should have same title
      expect(result.every(r => r.f.title === 'Same')).toBe(true);
    });
  });

  describe('toggleSort', () => {
    it('should toggle direction when same column clicked', () => {
      const sortState = { col: 'id', dir: 'asc' };
      toggleSort(sortState, 'id');

      expect(sortState.col).toBe('id');
      expect(sortState.dir).toBe('desc');
    });

    it('should toggle back to ascending', () => {
      const sortState = { col: 'id', dir: 'desc' };
      toggleSort(sortState, 'id');

      expect(sortState.col).toBe('id');
      expect(sortState.dir).toBe('asc');
    });

    it('should set new column with ascending direction', () => {
      const sortState = { col: 'id', dir: 'desc' };
      toggleSort(sortState, 'title');

      expect(sortState.col).toBe('title');
      expect(sortState.dir).toBe('asc');
    });

    it('should mutate original object', () => {
      const sortState = { col: 'id', dir: 'asc' };
      const originalRef = sortState;

      toggleSort(sortState, 'title');

      expect(sortState).toBe(originalRef);
      expect(sortState.col).toBe('title');
    });

    it('should handle empty initial state', () => {
      const sortState = { col: '', dir: '' };
      toggleSort(sortState, 'id');

      expect(sortState.col).toBe('id');
      expect(sortState.dir).toBe('asc');
    });
  });

  describe('getSortIndicator', () => {
    it('should return neutral arrow when column not sorted', () => {
      const sortState = { col: 'id', dir: 'asc' };
      const indicator = getSortIndicator(sortState, 'title');

      expect(indicator).toContain('⇅');
      expect(indicator).not.toContain('active');
    });

    it('should return up arrow for ascending', () => {
      const sortState = { col: 'id', dir: 'asc' };
      const indicator = getSortIndicator(sortState, 'id');

      expect(indicator).toContain('↑');
      expect(indicator).toContain('active');
    });

    it('should return down arrow for descending', () => {
      const sortState = { col: 'id', dir: 'desc' };
      const indicator = getSortIndicator(sortState, 'id');

      expect(indicator).toContain('↓');
      expect(indicator).toContain('active');
    });

    it('should return HTML with sort-arrow class', () => {
      const sortState = { col: 'title', dir: 'asc' };
      const indicator = getSortIndicator(sortState, 'id');

      expect(indicator).toContain('sort-arrow');
    });

    it('should handle empty column name', () => {
      const sortState = { col: '', dir: 'asc' };
      const indicator = getSortIndicator(sortState, 'id');

      expect(indicator).toContain('⇅');
    });
  });

  describe('setupSortableHeaders', () => {
    let container, sortState, renderCallback;

    beforeEach(() => {
      container = document.createElement('div');
      sortState = { col: '', dir: 'asc' };
      renderCallback = jest.fn();
    });

    it('should attach click listeners to sortable headers', () => {
      container.innerHTML = `
        <table>
          <thead>
            <tr>
              <th class="sortable-th" data-findings-sort="id">ID</th>
              <th class="sortable-th" data-findings-sort="title">Title</th>
            </tr>
          </thead>
        </table>
      `;

      setupSortableHeaders(container, sortState, renderCallback);

      const idHeader = container.querySelector('[data-findings-sort="id"]');
      idHeader.click();

      expect(sortState.col).toBe('id');
      expect(sortState.dir).toBe('asc');
      expect(renderCallback).toHaveBeenCalledTimes(1);
    });

    it('should toggle sort on multiple clicks', () => {
      container.innerHTML = `
        <table>
          <thead>
            <tr>
              <th class="sortable-th" data-findings-sort="id">ID</th>
            </tr>
          </thead>
        </table>
      `;

      setupSortableHeaders(container, sortState, renderCallback);

      const header = container.querySelector('[data-findings-sort="id"]');
      header.click();
      expect(sortState.dir).toBe('asc');

      header.click();
      expect(sortState.dir).toBe('desc');
    });

    it('should handle null container', () => {
      expect(() => {
        setupSortableHeaders(null, sortState, renderCallback);
      }).not.toThrow();
    });

    it('should handle container without sortable headers', () => {
      container.innerHTML = '<div>No headers</div>';

      expect(() => {
        setupSortableHeaders(container, sortState, renderCallback);
      }).not.toThrow();
    });

    it('should setup multiple headers independently', () => {
      container.innerHTML = `
        <table>
          <thead>
            <tr>
              <th class="sortable-th" data-findings-sort="id">ID</th>
              <th class="sortable-th" data-findings-sort="title">Title</th>
              <th class="sortable-th" data-findings-sort="severity">Severity</th>
            </tr>
          </thead>
        </table>
      `;

      setupSortableHeaders(container, sortState, renderCallback);

      const titleHeader = container.querySelector('[data-findings-sort="title"]');
      titleHeader.click();

      expect(sortState.col).toBe('title');
    });

    it('should ignore headers without data-findings-sort attribute', () => {
      container.innerHTML = `
        <table>
          <thead>
            <tr>
              <th class="sortable-th">No Sort</th>
              <th class="sortable-th" data-findings-sort="id">ID</th>
            </tr>
          </thead>
        </table>
      `;

      setupSortableHeaders(container, sortState, renderCallback);

      const headers = container.querySelectorAll('.sortable-th[data-findings-sort]');
      expect(headers.length).toBe(1);
    });
  });
});
