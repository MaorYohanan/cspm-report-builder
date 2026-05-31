/**
 * Filters Module
 * Handles filter UI and state management
 */

/**
 * Status options per query type
 */
export const statusOptions = {
  issues: [
    { value: 'OPEN', text: 'Open', selected: true },
    { value: 'IN_PROGRESS', text: 'In Progress', selected: true },
    { value: 'RESOLVED', text: 'Resolved', selected: false },
    { value: 'REJECTED', text: 'Rejected', selected: false }
  ],
  configurationFindings: [
    { value: 'PASS', text: 'Pass', selected: false },
    { value: 'FAIL', text: 'Fail', selected: true },
    { value: 'ERROR', text: 'Error', selected: false },
    { value: 'NOT_ASSESSED', text: 'Not Assessed', selected: false }
  ],
  vulnerabilityFindings: [
    { value: 'OPEN', text: 'Open', selected: true },
    { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
    { value: 'RESOLVED', text: 'Resolved', selected: false },
    { value: 'REJECTED', text: 'Rejected', selected: false }
  ],
  hostConfigurationRuleAssessments: [
    { value: 'OPEN', text: 'Open', selected: true },
    { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
    { value: 'RESOLVED', text: 'Resolved', selected: false },
    { value: 'REJECTED', text: 'Rejected', selected: false }
  ],
  dataFindingsV2: [
    { value: 'OPEN', text: 'Open', selected: true },
    { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
    { value: 'RESOLVED', text: 'Resolved', selected: false },
    { value: 'REJECTED', text: 'Rejected', selected: false }
  ],
  secretInstances: [
    { value: 'OPEN', text: 'Open', selected: true },
    { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
    { value: 'RESOLVED', text: 'Resolved', selected: false },
    { value: 'REJECTED', text: 'Rejected', selected: false }
  ],
  excessiveAccessFindings: [
    { value: 'OPEN', text: 'Open', selected: true },
    { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
    { value: 'RESOLVED', text: 'Resolved', selected: false },
    { value: 'REJECTED', text: 'Rejected', selected: false }
  ],
  networkExposures: [
    { value: 'OPEN', text: 'Open', selected: true },
    { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
    { value: 'RESOLVED', text: 'Resolved', selected: false },
    { value: 'REJECTED', text: 'Rejected', selected: false }
  ],
  inventoryFindings: [
    { value: 'OPEN', text: 'Open', selected: true },
    { value: 'IN_PROGRESS', text: 'In Progress', selected: false },
    { value: 'RESOLVED', text: 'Resolved', selected: false },
    { value: 'REJECTED', text: 'Rejected', selected: false }
  ]
};

/**
 * Severity options per query type
 */
export const severityOptions = {
  issues: [
    { value: 'CRITICAL', text: 'Critical', selected: true },
    { value: 'HIGH', text: 'High', selected: true },
    { value: 'MEDIUM', text: 'Medium', selected: false },
    { value: 'LOW', text: 'Low', selected: false },
    { value: 'INFORMATIONAL', text: 'Informational', selected: false }
  ],
  configurationFindings: [
    { value: 'CRITICAL', text: 'Critical', selected: true },
    { value: 'HIGH', text: 'High', selected: true },
    { value: 'MEDIUM', text: 'Medium', selected: false },
    { value: 'LOW', text: 'Low', selected: false },
    { value: 'NONE', text: 'None', selected: false }
  ],
  vulnerabilityFindings: [
    { value: 'CRITICAL', text: 'Critical', selected: true },
    { value: 'HIGH', text: 'High', selected: true },
    { value: 'MEDIUM', text: 'Medium', selected: false },
    { value: 'LOW', text: 'Low', selected: false },
    { value: 'NONE', text: 'None', selected: false }
  ],
  hostConfigurationRuleAssessments: [
    { value: 'CRITICAL', text: 'Critical', selected: true },
    { value: 'HIGH', text: 'High', selected: true },
    { value: 'MEDIUM', text: 'Medium', selected: false },
    { value: 'LOW', text: 'Low', selected: false },
    { value: 'INFORMATIONAL', text: 'Informational', selected: false }
  ],
  dataFindingsV2: [
    { value: 'CRITICAL', text: 'Critical', selected: true },
    { value: 'HIGH', text: 'High', selected: true },
    { value: 'MEDIUM', text: 'Medium', selected: false },
    { value: 'LOW', text: 'Low', selected: false },
    { value: 'INFO', text: 'Info', selected: false }
  ],
  secretInstances: [
    { value: 'CRITICAL', text: 'Critical', selected: true },
    { value: 'HIGH', text: 'High', selected: true },
    { value: 'MEDIUM', text: 'Medium', selected: false },
    { value: 'LOW', text: 'Low', selected: false },
    { value: 'INFORMATIONAL', text: 'Informational', selected: false }
  ],
  excessiveAccessFindings: [
    { value: 'CRITICAL', text: 'Critical', selected: true },
    { value: 'HIGH', text: 'High', selected: true },
    { value: 'MEDIUM', text: 'Medium', selected: false },
    { value: 'LOW', text: 'Low', selected: false }
  ],
  networkExposures: [
    { value: 'CRITICAL', text: 'Critical', selected: true },
    { value: 'HIGH', text: 'High', selected: true },
    { value: 'MEDIUM', text: 'Medium', selected: false },
    { value: 'LOW', text: 'Low', selected: false }
  ],
  inventoryFindings: [
    { value: 'CRITICAL', text: 'Critical', selected: true },
    { value: 'HIGH', text: 'High', selected: true },
    { value: 'MEDIUM', text: 'Medium', selected: false },
    { value: 'LOW', text: 'Low', selected: false },
    { value: 'INFORMATIONAL', text: 'Informational', selected: false }
  ]
};

/**
 * Update filter options UI based on query type
 * @param {string} queryType - Selected query type
 * @param {HTMLSelectElement} statusSelect - Status select element
 * @param {HTMLSelectElement} severitySelect - Severity select element
 */
export function updateFilterOptions(queryType, statusSelect, severitySelect) {
  // Update status/result
  const statusOpts = statusOptions[queryType] || statusOptions.issues;
  statusSelect.innerHTML = '';
  if (statusOpts.length) {
    statusSelect.disabled = false;
    statusOpts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.text;
      opt.selected = o.selected;
      statusSelect.appendChild(opt);
    });
  } else {
    statusSelect.disabled = true;
    const opt = document.createElement('option');
    opt.textContent = '— לא רלוונטי —';
    statusSelect.appendChild(opt);
  }

  const statusLabel = statusSelect.previousElementSibling;
  if (statusLabel && statusLabel.tagName === 'LABEL') {
    statusLabel.textContent = queryType === 'configurationFindings' ? 'תוצאה (Result)' : 'סטטוס';
  }

  // Update severity
  const sevOpts = severityOptions[queryType] || severityOptions.issues;
  severitySelect.innerHTML = '';
  if (sevOpts.length) {
    severitySelect.disabled = false;
    sevOpts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.text;
      opt.selected = o.selected;
      severitySelect.appendChild(opt);
    });
  } else {
    severitySelect.disabled = true;
    const opt = document.createElement('option');
    opt.textContent = '— לא רלוונטי —';
    severitySelect.appendChild(opt);
  }
}

/**
 * Get selected values from multi-select element
 * @param {HTMLSelectElement} selectEl - Select element
 * @returns {Array<string>}
 */
export function getSelectedValues(selectEl) {
  const vals = [];
  for (let i = 0; i < selectEl.options.length; i++) {
    if (selectEl.options[i].selected) vals.push(selectEl.options[i].value);
  }
  return vals;
}

/**
 * Query presets management
 */
const PRESETS_KEY = 'cspm_wizi_presets';

/**
 * Get saved presets from localStorage
 * @returns {Array}
 */
export function getPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

/**
 * Save preset to localStorage
 * @param {Object} preset - Preset configuration
 */
export function savePreset(preset) {
  const presets = getPresets();
  presets.push(preset);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

/**
 * Delete preset from localStorage
 * @param {number} index - Preset index
 */
export function deletePreset(index) {
  const presets = getPresets();
  presets.splice(index, 1);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}
