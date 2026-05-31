/**
 * @jest-environment jsdom
 */

import * as filters from '../../../../static/js/wizi/filters.js';

describe('Filters Module', () => {
  describe('statusOptions', () => {
    it('should have correct options for issues', () => {
      const options = filters.statusOptions.issues;
      expect(options).toHaveLength(4);
      expect(options[0]).toEqual({ value: 'OPEN', text: 'Open', selected: true });
      expect(options[1]).toEqual({ value: 'IN_PROGRESS', text: 'In Progress', selected: true });
      expect(options[2]).toEqual({ value: 'RESOLVED', text: 'Resolved', selected: false });
      expect(options[3]).toEqual({ value: 'REJECTED', text: 'Rejected', selected: false });
    });

    it('should have PASS/FAIL options for configurationFindings', () => {
      const options = filters.statusOptions.configurationFindings;
      expect(options).toHaveLength(4);
      expect(options.find(o => o.value === 'PASS')).toBeDefined();
      expect(options.find(o => o.value === 'FAIL')).toBeDefined();
      expect(options.find(o => o.value === 'FAIL').selected).toBe(true);
    });

    it('should have status options for all query types', () => {
      const queryTypes = [
        'issues', 'configurationFindings', 'vulnerabilityFindings',
        'hostConfigurationRuleAssessments', 'dataFindingsV2',
        'secretInstances', 'excessiveAccessFindings',
        'networkExposures', 'inventoryFindings'
      ];

      queryTypes.forEach(qt => {
        expect(filters.statusOptions[qt]).toBeDefined();
        expect(Array.isArray(filters.statusOptions[qt])).toBe(true);
      });
    });
  });

  describe('severityOptions', () => {
    it('should have correct severity options for issues', () => {
      const options = filters.severityOptions.issues;
      expect(options).toHaveLength(5);
      expect(options[0].value).toBe('CRITICAL');
      expect(options[1].value).toBe('HIGH');
      expect(options[0].selected).toBe(true);
      expect(options[1].selected).toBe(true);
      expect(options[2].selected).toBe(false);
    });

    it('should have NONE option for configurationFindings', () => {
      const options = filters.severityOptions.configurationFindings;
      const noneOption = options.find(o => o.value === 'NONE');
      expect(noneOption).toBeDefined();
      expect(noneOption.selected).toBe(false);
    });

    it('should have INFO option for dataFindingsV2', () => {
      const options = filters.severityOptions.dataFindingsV2;
      const infoOption = options.find(o => o.value === 'INFO');
      expect(infoOption).toBeDefined();
    });

    it('should have severity options for all query types', () => {
      const queryTypes = [
        'issues', 'configurationFindings', 'vulnerabilityFindings',
        'hostConfigurationRuleAssessments', 'dataFindingsV2',
        'secretInstances', 'excessiveAccessFindings',
        'networkExposures', 'inventoryFindings'
      ];

      queryTypes.forEach(qt => {
        expect(filters.severityOptions[qt]).toBeDefined();
        expect(Array.isArray(filters.severityOptions[qt])).toBe(true);
        expect(filters.severityOptions[qt].length).toBeGreaterThan(0);
      });
    });
  });

  describe('updateFilterOptions', () => {
    let statusSelect, severitySelect, statusLabel;

    beforeEach(() => {
      // Create DOM structure with proper label relationship
      document.body.innerHTML = `
        <div>
          <label id="status-label">סטטוס</label>
          <select id="status-select" multiple></select>
        </div>
        <div>
          <label id="severity-label">חומרה</label>
          <select id="severity-select" multiple></select>
        </div>
      `;

      statusLabel = document.getElementById('status-label');
      statusSelect = document.getElementById('status-select');
      severitySelect = document.getElementById('severity-select');
    });

    it('should populate status select with correct options', () => {
      filters.updateFilterOptions('issues', statusSelect, severitySelect);

      expect(statusSelect.options.length).toBe(4);
      expect(statusSelect.options[0].value).toBe('OPEN');
      expect(statusSelect.options[0].selected).toBe(true);
      expect(statusSelect.disabled).toBe(false);
    });

    it('should populate severity select with correct options', () => {
      filters.updateFilterOptions('issues', statusSelect, severitySelect);

      expect(severitySelect.options.length).toBe(5);
      expect(severitySelect.options[0].value).toBe('CRITICAL');
      expect(severitySelect.options[0].selected).toBe(true);
      expect(severitySelect.disabled).toBe(false);
    });

    it('should update label for configurationFindings', () => {
      filters.updateFilterOptions('configurationFindings', statusSelect, severitySelect);

      expect(statusLabel.textContent).toBe('תוצאה (Result)');
    });

    it('should keep default label for other query types', () => {
      filters.updateFilterOptions('issues', statusSelect, severitySelect);

      expect(statusLabel.textContent).toBe('סטטוס');
    });

    it('should handle different query types correctly', () => {
      filters.updateFilterOptions('vulnerabilityFindings', statusSelect, severitySelect);

      expect(statusSelect.options.length).toBe(4);
      expect(statusSelect.options[0].value).toBe('OPEN');
    });

    it('should use default options for unknown query type', () => {
      filters.updateFilterOptions('unknownType', statusSelect, severitySelect);

      expect(statusSelect.options.length).toBeGreaterThan(0);
      expect(severitySelect.options.length).toBeGreaterThan(0);
    });

    it('should preserve selected state from configuration', () => {
      filters.updateFilterOptions('issues', statusSelect, severitySelect);

      const openOption = Array.from(statusSelect.options).find(o => o.value === 'OPEN');
      const resolvedOption = Array.from(statusSelect.options).find(o => o.value === 'RESOLVED');

      expect(openOption.selected).toBe(true);
      expect(resolvedOption.selected).toBe(false);
    });
  });

  describe('getSelectedValues', () => {
    let selectEl;

    beforeEach(() => {
      selectEl = document.createElement('select');
      selectEl.multiple = true;

      const option1 = document.createElement('option');
      option1.value = 'CRITICAL';
      option1.selected = true;
      selectEl.appendChild(option1);

      const option2 = document.createElement('option');
      option2.value = 'HIGH';
      option2.selected = true;
      selectEl.appendChild(option2);

      const option3 = document.createElement('option');
      option3.value = 'MEDIUM';
      option3.selected = false;
      selectEl.appendChild(option3);
    });

    it('should return array of selected values', () => {
      const result = filters.getSelectedValues(selectEl);

      expect(result).toEqual(['CRITICAL', 'HIGH']);
    });

    it('should return empty array when nothing selected', () => {
      selectEl.options[0].selected = false;
      selectEl.options[1].selected = false;

      const result = filters.getSelectedValues(selectEl);

      expect(result).toEqual([]);
    });

    it('should return all values when all selected', () => {
      selectEl.options[2].selected = true;

      const result = filters.getSelectedValues(selectEl);

      expect(result).toEqual(['CRITICAL', 'HIGH', 'MEDIUM']);
    });

    it('should handle single selected value', () => {
      selectEl.options[1].selected = false;

      const result = filters.getSelectedValues(selectEl);

      expect(result).toEqual(['CRITICAL']);
    });
  });

  describe('Preset management', () => {
    beforeEach(() => {
      // Clear localStorage
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    describe('getPresets', () => {
      it('should return empty array when no presets saved', () => {
        const presets = filters.getPresets();

        expect(presets).toEqual([]);
      });

      it('should return saved presets from localStorage', () => {
        const mockPresets = [
          { name: 'Preset 1', queryType: 'issues' },
          { name: 'Preset 2', queryType: 'configurationFindings' }
        ];
        localStorage.setItem('cspm_wizi_presets', JSON.stringify(mockPresets));

        const presets = filters.getPresets();

        expect(presets).toEqual(mockPresets);
      });

      it('should handle corrupted localStorage data', () => {
        localStorage.setItem('cspm_wizi_presets', 'invalid json');

        const presets = filters.getPresets();

        expect(presets).toEqual([]);
      });

      it('should return empty array on localStorage error', () => {
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new Error('Storage error');
        });

        const presets = filters.getPresets();

        expect(presets).toEqual([]);

        Storage.prototype.getItem.mockRestore();
      });
    });

    describe('savePreset', () => {
      it('should save a new preset to localStorage', () => {
        const preset = {
          name: 'My Preset',
          queryType: 'issues',
          severity: ['CRITICAL', 'HIGH'],
          status: ['OPEN']
        };

        filters.savePreset(preset);

        const saved = JSON.parse(localStorage.getItem('cspm_wizi_presets'));
        expect(saved).toHaveLength(1);
        expect(saved[0]).toEqual(preset);
      });

      it('should append to existing presets', () => {
        const existing = [{ name: 'Preset 1', queryType: 'issues' }];
        localStorage.setItem('cspm_wizi_presets', JSON.stringify(existing));

        const newPreset = { name: 'Preset 2', queryType: 'vulnerabilityFindings' };
        filters.savePreset(newPreset);

        const saved = JSON.parse(localStorage.getItem('cspm_wizi_presets'));
        expect(saved).toHaveLength(2);
        expect(saved[1]).toEqual(newPreset);
      });

      it('should handle complex preset objects', () => {
        const complexPreset = {
          name: 'Complex Preset',
          queryType: 'configurationFindings',
          severity: ['CRITICAL', 'HIGH', 'MEDIUM'],
          status: ['FAIL', 'ERROR'],
          subscription: 'prod-subscription',
          first: 100
        };

        filters.savePreset(complexPreset);

        const saved = filters.getPresets();
        expect(saved[0]).toEqual(complexPreset);
      });
    });

    describe('deletePreset', () => {
      it('should delete preset at specified index', () => {
        const presets = [
          { name: 'Preset 1' },
          { name: 'Preset 2' },
          { name: 'Preset 3' }
        ];
        localStorage.setItem('cspm_wizi_presets', JSON.stringify(presets));

        filters.deletePreset(1);

        const remaining = filters.getPresets();
        expect(remaining).toHaveLength(2);
        expect(remaining[0].name).toBe('Preset 1');
        expect(remaining[1].name).toBe('Preset 3');
      });

      it('should delete first preset', () => {
        const presets = [
          { name: 'Preset 1' },
          { name: 'Preset 2' }
        ];
        localStorage.setItem('cspm_wizi_presets', JSON.stringify(presets));

        filters.deletePreset(0);

        const remaining = filters.getPresets();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].name).toBe('Preset 2');
      });

      it('should delete last preset', () => {
        const presets = [
          { name: 'Preset 1' },
          { name: 'Preset 2' }
        ];
        localStorage.setItem('cspm_wizi_presets', JSON.stringify(presets));

        filters.deletePreset(1);

        const remaining = filters.getPresets();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].name).toBe('Preset 1');
      });

      it('should handle deleting from empty array', () => {
        localStorage.setItem('cspm_wizi_presets', '[]');

        filters.deletePreset(0);

        const remaining = filters.getPresets();
        expect(remaining).toEqual([]);
      });

      it('should handle invalid index gracefully', () => {
        const presets = [{ name: 'Preset 1' }];
        localStorage.setItem('cspm_wizi_presets', JSON.stringify(presets));

        filters.deletePreset(5);

        const remaining = filters.getPresets();
        expect(remaining).toHaveLength(1);
      });
    });

    describe('Preset workflow integration', () => {
      it('should support complete save and delete workflow', () => {
        // Save multiple presets
        filters.savePreset({ name: 'A', queryType: 'issues' });
        filters.savePreset({ name: 'B', queryType: 'configurationFindings' });
        filters.savePreset({ name: 'C', queryType: 'vulnerabilityFindings' });

        expect(filters.getPresets()).toHaveLength(3);

        // Delete middle preset
        filters.deletePreset(1);

        const remaining = filters.getPresets();
        expect(remaining).toHaveLength(2);
        expect(remaining[0].name).toBe('A');
        expect(remaining[1].name).toBe('C');
      });
    });
  });
});
