/**
 * @jest-environment jsdom
 */

import * as bulkActions from '../../../../static/js/wizi/bulk-actions.js';

describe('Bulk Actions Module', () => {
  describe('queryTypeLabels', () => {
    it('should have labels for all query types', () => {
      expect(bulkActions.queryTypeLabels.issues).toBe('Issues (כללי)');
      expect(bulkActions.queryTypeLabels.configurationFindings).toBe('CSPM — Cloud Configuration');
      expect(bulkActions.queryTypeLabels.vulnerabilityFindings).toBe('VULN — Vulnerabilities');
      expect(bulkActions.queryTypeLabels.hostConfigurationRuleAssessments).toBe('HSPM — Host Configuration');
      expect(bulkActions.queryTypeLabels.dataFindingsV2).toBe('DSPM — Data Findings');
      expect(bulkActions.queryTypeLabels.secretInstances).toBe('SECR — Secrets');
      expect(bulkActions.queryTypeLabels.excessiveAccessFindings).toBe('EAPM — Excessive Access');
      expect(bulkActions.queryTypeLabels.networkExposures).toBe('NEXP — Network Exposure');
      expect(bulkActions.queryTypeLabels.inventoryFindings).toBe('EOLM — Inventory / EOL');
    });

    it('should have exactly 9 query types', () => {
      expect(Object.keys(bulkActions.queryTypeLabels)).toHaveLength(9);
    });
  });

  describe('renderBulkResults', () => {
    let progressDiv, resultsDiv, actionsDiv, mockOptions;

    beforeEach(() => {
      // Setup DOM elements
      document.body.innerHTML = `
        <div id="bulk-import-sub"></div>
      `;
      progressDiv = document.createElement('div');
      resultsDiv = document.createElement('div');
      actionsDiv = document.createElement('div');

      // Mock severity map
      const severityMap = {
        critical: { class: 'critical', text: 'Critical' },
        high: { class: 'high', text: 'High' },
        medium: { class: 'medium', text: 'Medium' },
        low: { class: 'low', text: 'Low' },
        info: { class: 'info', text: 'Info' }
      };

      // Mock functions
      mockOptions = {
        progressDiv,
        resultsDiv,
        actionsDiv,
        updateSelectedCount: jest.fn(),
        severityMap,
        getWiziItemTitle: jest.fn((node, qt) => node.title || 'Default Title'),
        showToast: jest.fn()
      };
    });

    it('should show warning when subscription not resolved', () => {
      const data = {
        resolvedSubscription: {},
        results: {},
        errors: {}
      };

      bulkActions.renderBulkResults(data, mockOptions);

      expect(mockOptions.showToast).toHaveBeenCalledWith(
        expect.stringContaining('לא נמצא Subscription'),
        'warning'
      );
    });

    it('should display error messages for failed query types', () => {
      const data = {
        resolvedSubscription: { ids: ['123'] },
        results: {},
        errors: {
          issues: 'Rate limit exceeded',
          configurationFindings: 'Timeout error'
        }
      };

      bulkActions.renderBulkResults(data, mockOptions);

      expect(progressDiv.innerHTML).toContain('Rate limit exceeded');
      expect(progressDiv.innerHTML).toContain('Timeout error');
    });

    it('should show empty state when no findings', () => {
      const data = {
        resolvedSubscription: { ids: ['123'] },
        results: {},
        errors: {}
      };

      const result = bulkActions.renderBulkResults(data, mockOptions);

      expect(progressDiv.innerHTML).toContain('לא נמצאו ממצאים');
      expect(resultsDiv.innerHTML).toBe('');
      expect(result.bulkImportResults).toBeNull();
    });

    it('should render results with correct counts', () => {
      const data = {
        resolvedSubscription: { ids: ['123'] },
        results: {
          issues: {
            nodes: [
              { id: '1', title: 'Issue 1', severity: 'CRITICAL' },
              { id: '2', title: 'Issue 2', severity: 'HIGH' }
            ]
          },
          configurationFindings: {
            nodes: [
              { id: '3', title: 'Config 1', severity: 'HIGH' }
            ]
          }
        },
        errors: {}
      };

      const result = bulkActions.renderBulkResults(data, mockOptions);

      expect(progressDiv.innerHTML).toContain('סה"כ: 3 ממצאים');
      expect(progressDiv.innerHTML).toContain('Issues (כללי): 2');
      expect(progressDiv.innerHTML).toContain('CSPM — Cloud Configuration: 1');
      expect(result.bulkImportResults.issues).toHaveLength(2);
      expect(result.bulkImportResults.configurationFindings).toHaveLength(1);
    });

    it('should filter excessiveAccessFindings by subscription on client-side', () => {
      document.getElementById('bulk-import-sub').value = 'prod-account';

      const data = {
        resolvedSubscription: { ids: ['123'] },
        results: {
          excessiveAccessFindings: {
            nodes: [
              {
                id: '1',
                principal: {
                  cloudAccount: {
                    name: 'prod-account-1'
                  }
                }
              },
              {
                id: '2',
                principal: {
                  cloudAccount: {
                    name: 'dev-account-1'
                  }
                }
              },
              {
                id: '3',
                principal: {
                  cloudAccount: {
                    externalId: 'prod-account-external'
                  }
                }
              }
            ]
          }
        },
        errors: {}
      };

      const result = bulkActions.renderBulkResults(data, mockOptions);

      // Should only include nodes matching "prod-account"
      expect(result.bulkImportResults.excessiveAccessFindings).toHaveLength(2);
    });

    it('should create details sections for each query type with findings', () => {
      const data = {
        resolvedSubscription: { ids: ['123'] },
        results: {
          issues: { nodes: [{ id: '1', severity: 'HIGH' }] },
          vulnerabilityFindings: { nodes: [{ id: '2', severity: 'CRITICAL' }] }
        },
        errors: {}
      };

      bulkActions.renderBulkResults(data, mockOptions);

      expect(resultsDiv.innerHTML).toContain('data-qt="issues"');
      expect(resultsDiv.innerHTML).toContain('data-qt="vulnerabilityFindings"');
      expect(resultsDiv.innerHTML).toContain('bulk-section-card');
    });

    it('should initialize page state for each section', () => {
      const data = {
        resolvedSubscription: { ids: ['123'] },
        results: {
          issues: { nodes: Array(30).fill({ id: '1', severity: 'HIGH' }) }
        },
        errors: {}
      };

      const result = bulkActions.renderBulkResults(data, mockOptions);

      expect(result.bulkPageState.issues).toBeDefined();
      expect(result.bulkPageState.issues.page).toBe(0);
      expect(result.bulkPageState.issues.pageSize).toBe(20);
    });

    it('should call updateSelectedCount after rendering', () => {
      const data = {
        resolvedSubscription: { ids: ['123'] },
        results: {
          issues: { nodes: [{ id: '1', severity: 'HIGH' }] }
        },
        errors: {}
      };

      bulkActions.renderBulkResults(data, mockOptions);

      expect(mockOptions.updateSelectedCount).toHaveBeenCalled();
    });

    it('should make actions div visible when results exist', () => {
      const data = {
        resolvedSubscription: { ids: ['123'] },
        results: {
          issues: { nodes: [{ id: '1', severity: 'HIGH' }] }
        },
        errors: {}
      };

      actionsDiv.style.display = 'none';
      bulkActions.renderBulkResults(data, mockOptions);

      expect(actionsDiv.style.display).toBe('');
    });
  });

  describe('renderBulkPage', () => {
    let mockOptions, bulkImportResults, bulkPageState;

    beforeEach(() => {
      // Create DOM container
      document.body.innerHTML = '<div id="bulk-body-issues"></div>';

      const severityMap = {
        critical: { class: 'critical', text: 'Critical' },
        high: { class: 'high', text: 'High' },
        medium: { class: 'medium', text: 'Medium' }
      };

      mockOptions = {
        updateSelectedCount: jest.fn(),
        severityMap,
        getWiziItemTitle: jest.fn((node) => node.title || 'Test Title')
      };

      bulkImportResults = {
        issues: [
          { id: '1', title: 'Issue 1', severity: 'CRITICAL', entitySnapshot: { subscriptionName: 'sub1' } },
          { id: '2', title: 'Issue 2', severity: 'HIGH', entitySnapshot: { subscriptionName: 'sub2' } },
          { id: '3', title: 'Issue 3', severity: 'MEDIUM', entitySnapshot: { subscriptionName: 'sub1' } }
        ]
      };

      bulkPageState = {
        issues: { page: 0, pageSize: 20 }
      };
    });

    it('should render table with findings', () => {
      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-issues');
      expect(bodyEl.innerHTML).toContain('findings-table');
      expect(bodyEl.innerHTML).toContain('Issue 1');
      expect(bodyEl.innerHTML).toContain('Issue 2');
      expect(bodyEl.innerHTML).toContain('Issue 3');
    });

    it('should show pagination info', () => {
      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-issues');
      expect(bodyEl.innerHTML).toContain('1–3 מתוך 3');
    });

    it('should paginate large result sets', () => {
      bulkImportResults.issues = Array(50).fill(null).map((_, i) => ({
        id: String(i),
        title: `Issue ${i}`,
        severity: 'HIGH',
        entitySnapshot: { subscriptionName: 'sub1' }
      }));
      bulkPageState.issues.pageSize = 20;

      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-issues');
      expect(bodyEl.innerHTML).toContain('1–20 מתוך 50');
      expect(bodyEl.innerHTML).toContain('bulk-page-btn');
    });

    it('should include sort indicators in headers', () => {
      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-issues');
      expect(bodyEl.innerHTML).toContain('sortable-th');
      expect(bodyEl.innerHTML).toContain('sort-arrow');
    });

    it('should show active sort direction', () => {
      bulkPageState.issues.sortCol = 'severity';
      bulkPageState.issues.sortDir = 'asc';

      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-issues');
      expect(bodyEl.innerHTML).toContain('sort-arrow active');
    });

    it('should sort by severity correctly', () => {
      bulkPageState.issues.sortCol = 'severity';
      bulkPageState.issues.sortDir = 'asc';

      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      // Check that nodes are sorted (CRITICAL < HIGH < MEDIUM)
      const sorted = bulkImportResults.issues;
      expect(sorted[0].severity).toBe('CRITICAL');
      expect(sorted[1].severity).toBe('HIGH');
      expect(sorted[2].severity).toBe('MEDIUM');
    });

    it('should include page size selector', () => {
      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-issues');
      expect(bodyEl.innerHTML).toContain('bulk-page-size');
      expect(bodyEl.innerHTML).toContain('option value="20"');
      expect(bodyEl.innerHTML).toContain('option value="50"');
      expect(bodyEl.innerHTML).toContain('option value="100"');
    });

    it('should show section checkbox', () => {
      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-issues');
      expect(bodyEl.innerHTML).toContain('bulk-section-check');
    });

    it('should show individual checkboxes for each row', () => {
      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-issues');
      const checkboxes = bodyEl.querySelectorAll('.bulk-check');
      expect(checkboxes.length).toBe(3);
    });

    it('should include vulnerability-specific columns', () => {
      document.body.innerHTML = '<div id="bulk-body-vulnerabilityFindings"></div>';

      bulkImportResults.vulnerabilityFindings = [
        {
          id: '1',
          severity: 'CRITICAL',
          vulnerableAsset: {
            name: 'my-asset',
            type: 'CONTAINER_IMAGE'
          }
        }
      ];
      bulkPageState.vulnerabilityFindings = { page: 0, pageSize: 20 };

      bulkActions.renderBulkPage('vulnerabilityFindings', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-vulnerabilityFindings');
      expect(bodyEl.innerHTML).toContain('משאב');
      expect(bodyEl.innerHTML).toContain('סוג משאב');
      expect(bodyEl.innerHTML).toContain('my-asset');
      expect(bodyEl.innerHTML).toContain('CONTAINER_IMAGE');
    });

    it('should include secret-specific columns', () => {
      document.body.innerHTML = '<div id="bulk-body-secretInstances"></div>';

      bulkImportResults.secretInstances = [
        {
          id: '1',
          severity: 'HIGH',
          resource: {
            name: 'secret-resource'
          }
        }
      ];
      bulkPageState.secretInstances = { page: 0, pageSize: 20 };

      bulkActions.renderBulkPage('secretInstances', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-secretInstances');
      expect(bodyEl.innerHTML).toContain('משאב');
      expect(bodyEl.innerHTML).toContain('secret-resource');
    });

    it('should disable prev button on first page', () => {
      bulkImportResults.issues = Array(50).fill(null).map((_, i) => ({
        id: String(i),
        severity: 'HIGH',
        entitySnapshot: { subscriptionName: 'sub' }
      }));
      bulkPageState.issues.page = 0;
      bulkPageState.issues.pageSize = 20;

      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-issues');
      const prevButton = bodyEl.querySelector('[data-dir="prev"]');
      expect(prevButton.disabled).toBe(true);
    });

    it('should disable next button on last page', () => {
      bulkImportResults.issues = Array(50).fill(null).map((_, i) => ({
        id: String(i),
        severity: 'HIGH',
        entitySnapshot: { subscriptionName: 'sub' }
      }));
      bulkPageState.issues.page = 2; // Last page (0-indexed)
      bulkPageState.issues.pageSize = 20;

      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-issues');
      const nextButton = bodyEl.querySelector('[data-dir="next"]');
      expect(nextButton.disabled).toBe(true);
    });

    it('should render empty state gracefully', () => {
      bulkImportResults.issues = [];

      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, mockOptions);

      const bodyEl = document.getElementById('bulk-body-issues');
      // Should not crash, should render empty table
      expect(bodyEl).toBeTruthy();
    });
  });

  describe('updateBulkSelectedCount', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <input type="checkbox" class="bulk-check" checked>
        <input type="checkbox" class="bulk-check" checked>
        <input type="checkbox" class="bulk-check">
        <div id="bulk-selected-count"></div>
      `;
    });

    it('should update count display correctly', () => {
      bulkActions.updateBulkSelectedCount();

      const countEl = document.getElementById('bulk-selected-count');
      expect(countEl.textContent).toBe('2 / 3 נבחרו');
    });

    it('should handle all unchecked', () => {
      document.querySelectorAll('.bulk-check').forEach(cb => cb.checked = false);

      bulkActions.updateBulkSelectedCount();

      const countEl = document.getElementById('bulk-selected-count');
      expect(countEl.textContent).toBe('0 / 3 נבחרו');
    });

    it('should handle all checked', () => {
      document.querySelectorAll('.bulk-check').forEach(cb => cb.checked = true);

      bulkActions.updateBulkSelectedCount();

      const countEl = document.getElementById('bulk-selected-count');
      expect(countEl.textContent).toBe('3 / 3 נבחרו');
    });

    it('should handle no checkboxes', () => {
      document.body.innerHTML = '<div id="bulk-selected-count"></div>';

      bulkActions.updateBulkSelectedCount();

      const countEl = document.getElementById('bulk-selected-count');
      expect(countEl.textContent).toBe('0 / 0 נבחרו');
    });

    it('should handle missing count element', () => {
      document.body.innerHTML = `
        <input type="checkbox" class="bulk-check" checked>
      `;

      // Should not throw
      expect(() => bulkActions.updateBulkSelectedCount()).not.toThrow();
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete bulk workflow', () => {
      document.body.innerHTML = `
        <div id="bulk-import-sub"></div>
        <div id="bulk-body-issues"></div>
        <div id="bulk-selected-count"></div>
      `;

      const data = {
        resolvedSubscription: { ids: ['123'] },
        results: {
          issues: {
            nodes: Array(25).fill(null).map((_, i) => ({
              id: String(i),
              title: `Issue ${i}`,
              severity: i % 3 === 0 ? 'CRITICAL' : i % 3 === 1 ? 'HIGH' : 'MEDIUM',
              entitySnapshot: { subscriptionName: 'test-sub' }
            }))
          }
        },
        errors: {}
      };

      const severityMap = {
        critical: { class: 'critical', text: 'Critical' },
        high: { class: 'high', text: 'High' },
        medium: { class: 'medium', text: 'Medium' }
      };

      const progressDiv = document.createElement('div');
      const resultsDiv = document.createElement('div');
      const actionsDiv = document.createElement('div');

      const options = {
        progressDiv,
        resultsDiv,
        actionsDiv,
        updateSelectedCount: bulkActions.updateBulkSelectedCount,
        severityMap,
        getWiziItemTitle: (node) => node.title,
        showToast: jest.fn()
      };

      const { bulkImportResults, bulkPageState } = bulkActions.renderBulkResults(data, options);

      expect(bulkImportResults.issues).toHaveLength(25);
      expect(bulkPageState.issues.page).toBe(0);

      // Render first page
      bulkActions.renderBulkPage('issues', bulkImportResults, bulkPageState, options);

      const bodyEl = document.getElementById('bulk-body-issues');
      expect(bodyEl.innerHTML).toContain('findings-table');
      expect(bodyEl.querySelector('.bulk-check')).toBeTruthy();
    });
  });
});
