// Shared mutable state — imported by all modules.
// Use state.* to read or write; never reassign the `state` reference itself.
export const state = {
  findings: [],
  editingIndex: null,
  selectedFindingIndex: null,
  activeDetailTab: 'description',
  findingsSortState: { col: null, dir: 'asc' },
  findingsPageState: { page: 0, pageSize: 20 },
  severityMap: {
    critical: { text: 'קריטי', class: 'sev-critical' },
    high:     { text: 'גבוה',  class: 'sev-high' },
    medium:   { text: 'בינוני',class: 'sev-medium' },
    low:      { text: 'נמוך',  class: 'sev-low' },
    info:     { text: 'מידע',  class: 'sev-info' }
  },
  bulkImportResults: {},
  bulkImportRunning: false
};
