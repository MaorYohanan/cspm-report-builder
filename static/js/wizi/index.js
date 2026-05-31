/**
 * Wizi Integration Main Module
 * Orchestrates all Wizi functionality
 *
 * This module initializes and coordinates:
 * - API client for Wizi backend calls
 * - Subscription management and filtering
 * - Filter UI and state
 * - Bulk import and export
 * - UI helpers and utilities
 */

import * as ApiClient from './api-client.js';
import * as SubscriptionManager from './subscription-manager.js';
import * as Filters from './filters.js';
import * as BulkActions from './bulk-actions.js';
import * as UIHelpers from './ui-helpers.js';

// Export all modules for external use if needed
export {
  ApiClient,
  SubscriptionManager,
  Filters,
  BulkActions,
  UIHelpers
};

/**
 * Initialize Wizi integration
 * @param {Object} context - Application context (findings, severityMap, etc.)
 * @param {boolean} isCloud - Whether running in cloud mode
 */
export function initWizi(context, isCloud) {
  // DOM elements
  const elements = {
    results: document.getElementById('wizi-results'),
    statusMsg: document.getElementById('wizi-status-msg'),
    fetchBtn: document.getElementById('btn-wizi-fetch'),
    loadMoreBtn: document.getElementById('btn-wizi-load-more'),
    importBtn: document.getElementById('btn-wizi-import-selected'),
    selectAllBtn: document.getElementById('btn-wizi-select-all'),
    actionsDiv: document.getElementById('wizi-actions'),
    selectedCount: document.getElementById('wizi-selected-count'),
    projectInput: document.getElementById('wizi-project'),
    projectId: document.getElementById('wizi-project-id'),
    projectList: document.getElementById('wizi-project-list'),
    subInput: document.getElementById('wizi-subscription'),
    queryTypeSelect: document.getElementById('wizi-query-type'),
    statusSelect: document.getElementById('wizi-status'),
    severitySelect: document.getElementById('wizi-severity')
  };

  // State
  const state = {
    issues: [],
    endCursor: null,
    hasNextPage: false,
    queryType: 'issues',
    enabled: false
  };

  // Initialize filters
  Filters.updateFilterOptions(
    state.queryType,
    elements.statusSelect,
    elements.severitySelect
  );

  // Setup autocomplete for subscription selection
  UIHelpers.setupAutocomplete(
    elements.projectInput,
    elements.projectId,
    elements.projectList,
    () => SubscriptionManager.getSubscriptions()
  );

  // Load subscriptions
  function loadFilters() {
    ApiClient.fetchSubscriptions()
      .then(data => {
        if (data.subscriptions && data.subscriptions.length) {
          SubscriptionManager.setSubscriptions(data.subscriptions);
        }
      })
      .catch(() => {
        // Silently fail - subscriptions autocomplete is optional
      });
  }

  // Check Wizi status
  if (isCloud) {
    ApiClient.checkWiziStatus()
      .then(data => {
        if (data.enabled) {
          state.enabled = true;
          elements.statusMsg.textContent = '✓ Wizi מחובר — ' + (data.totalIssues || 0) + ' issues בסה"כ';
          loadFilters();
          setTimeout(() => {
            elements.statusMsg.textContent = '✓ Wizi מחובר · ' + data.totalIssues + ' issues';
          }, 1000);
        } else {
          elements.statusMsg.textContent = 'Wizi לא מוגדר — הגדר WIZI_CLIENT_ID ו-WIZI_CLIENT_SECRET ב-.env';
        }
      })
      .catch(() => {
        elements.statusMsg.textContent = 'לא ניתן להתחבר לשרת.';
      });
  } else {
    elements.statusMsg.textContent = 'Wizi זמין רק בהרצה דרך Docker.';
  }

  // Query type change handler
  elements.queryTypeSelect.addEventListener('change', function() {
    state.queryType = this.value;
    Filters.updateFilterOptions(
      state.queryType,
      elements.statusSelect,
      elements.severitySelect
    );
  });

  return {
    elements,
    state,
    loadFilters
  };
}

/**
 * Re-export commonly used functions for backward compatibility
 */
export const escapeHtml = UIHelpers.escapeHtml;
export const setupAutocomplete = UIHelpers.setupAutocomplete;
export const mapWiziSeverity = UIHelpers.mapWiziSeverity;
export const mapWiziCategory = UIHelpers.mapWiziCategory;
export const getWiziItemTitle = UIHelpers.getWiziItemTitle;
export const getWiziRuleId = UIHelpers.getWiziRuleId;
export const extractResourceName = UIHelpers.extractResourceName;
export const extractRecommendations = UIHelpers.extractRecommendations;
export const getNodeSubscriptionName = SubscriptionManager.getNodeSubscriptionName;
export const extractAutoFillData = SubscriptionManager.extractAutoFillData;
export const updateFilterOptions = Filters.updateFilterOptions;
export const getSelectedValues = Filters.getSelectedValues;
export const statusOptions = Filters.statusOptions;
export const severityOptions = Filters.severityOptions;
export const renderBulkResults = BulkActions.renderBulkResults;
export const renderBulkPage = BulkActions.renderBulkPage;
export const updateBulkSelectedCount = BulkActions.updateBulkSelectedCount;
export const queryTypeLabels = BulkActions.queryTypeLabels;
