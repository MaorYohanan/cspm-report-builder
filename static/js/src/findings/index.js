/**
 * Findings Module - Main Orchestrator
 * Imports and coordinates all findings sub-modules
 */

// Import all modules
import * as Renderer from './renderer.js';
import * as FilterManager from './filter-manager.js';
import * as SortManager from './sort-manager.js';
import * as StateManager from './state-manager.js';
import * as ExportHandler from './export-handler.js';
import * as UIComponents from './ui-components.js';

/**
 * Findings Manager Class
 * Central coordinator for all findings functionality
 */
export class FindingsManager {
  constructor() {
    this.findings = [];
    this.paginationState = new StateManager.PaginationState(25);
    this.selectionState = new StateManager.SelectionState();
    this.editState = new StateManager.EditState();
    this.sortState = { col: null, dir: 'asc' };
    this.pendingEvidence = [];
  }

  /**
   * Initialize the findings manager
   * @param {Object} config - Configuration options
   */
  init(config = {}) {
    this.config = config;
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Filter listeners
    if (this.config.filterElements) {
      FilterManager.setupFilterListeners(
        this.config.filterElements,
        () => this.render()
      );
    }
  }

  /**
   * Add a finding
   * @param {Object} finding - Finding object
   */
  add(finding) {
    this.findings.push(finding);
    this.render();
  }

  /**
   * Update a finding
   * @param {number} idx - Finding index
   * @param {Object} finding - Updated finding object
   */
  update(idx, finding) {
    if (idx >= 0 && idx < this.findings.length) {
      this.findings[idx] = finding;
      this.render();
    }
  }

  /**
   * Delete a finding
   * @param {number} idx - Finding index
   */
  delete(idx) {
    if (idx >= 0 && idx < this.findings.length) {
      this.findings.splice(idx, 1);
      this.render();

      // Check for ID gaps and prompt reorder
      if (StateManager.hasIdGaps(this.findings)) {
        StateManager.reorderFindingIds(this.findings);
        this.render();
      }
    }
  }

  /**
   * Start editing a finding
   * @param {number} idx - Finding index
   */
  startEdit(idx) {
    this.editState.startEdit(idx);
  }

  /**
   * Stop editing
   */
  stopEdit() {
    this.editState.stopEdit();
  }

  /**
   * Get filtered and sorted findings
   * @returns {Array} Processed findings
   */
  getProcessedFindings() {
    // Apply filters
    const filters = this.config.filterElements
      ? FilterManager.getCurrentFilters(this.config.filterElements)
      : {};
    let processed = FilterManager.applyFilters(this.findings, filters);

    // Apply sort
    processed = SortManager.sortFindings(processed, this.sortState);

    return processed;
  }

  /**
   * Render findings table
   */
  render() {
    const processed = this.getProcessedFindings();
    const paginated = this.paginationState.paginate(processed);

    // Render logic here - this would integrate with existing render code
    if (this.config.onRender) {
      this.config.onRender({
        findings: this.findings,
        filtered: processed,
        paginated: paginated.items,
        pagination: {
          start: paginated.start,
          end: paginated.end,
          totalPages: paginated.totalPages,
          currentPage: paginated.currentPage
        }
      });
    }
  }

  /**
   * Export findings as HTML report
   * @param {Object} meta - Report metadata
   * @param {string} coverImageDataUrl - Cover image data URL
   * @returns {string} HTML report
   */
  exportHTML(meta, coverImageDataUrl) {
    return ExportHandler.buildReportHtml({
      findings: this.findings,
      meta: meta,
      coverImageDataUrl: coverImageDataUrl
    });
  }

  /**
   * Build snapshot of current state
   * @param {Object} meta - Report metadata
   * @returns {Object} Complete snapshot
   */
  buildSnapshot(meta) {
    return {
      version: 1,
      meta: meta,
      findings: this.findings,
      formDraft: this.editState.getDraft()
    };
  }

  /**
   * Load snapshot
   * @param {Object} snapshot - Snapshot to load
   */
  loadSnapshot(snapshot) {
    if (!snapshot || !snapshot.findings) return;

    this.findings = snapshot.findings.map(f => ({
      id: f.id || '',
      title: f.title || '',
      severity: f.severity || 'medium',
      category: f.category || 'CSPM',
      description: f.description || '',
      impact: f.impact || '',
      technical: Array.isArray(f.technical) ? f.technical : Renderer.splitLines(f.technical || ''),
      policies: Array.isArray(f.policies) ? f.policies : Renderer.splitLines(f.policies || ''),
      recs: Array.isArray(f.recs) ? f.recs : Renderer.splitLines(f.recs || ''),
      priority: f.priority || '',
      owner: f.owner || '',
      evidence: Array.isArray(f.evidence) ? f.evidence : (f.evidence ? [f.evidence] : [])
    }));

    this.render();
  }
}

/**
 * Export all sub-modules for direct access if needed
 */
export {
  Renderer,
  FilterManager,
  SortManager,
  StateManager,
  ExportHandler,
  UIComponents
};

/**
 * Create a new findings manager instance
 * @param {Object} config - Configuration
 * @returns {FindingsManager} New instance
 */
export function createFindingsManager(config) {
  const manager = new FindingsManager();
  manager.init(config);
  return manager;
}
