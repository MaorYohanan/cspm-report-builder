/**
 * Tests for export-handler.js module
 * Testing CSV generation, report building, and export utilities
 */

import {
  i18n,
  categoryMap,
  calcRiskScore,
  countSeverity,
  parseReportDate,
  formatDate,
  getDaysForPriority,
  calcDueDate,
  buildReportHtml,
  buildFilename
} from '../../../static/js/src/findings/export-handler.js';

describe('export-handler.js', () => {
  describe('calcRiskScore', () => {
    it('should calculate risk score based on severity weights', () => {
      const findings = [
        { severity: 'critical' }, // 10
        { severity: 'high' },     // 7
        { severity: 'medium' }    // 4
      ];
      const result = calcRiskScore(findings);

      expect(result.score).toBe(21); // 10 + 7 + 4
      expect(result.percent).toBe(70); // 21/30 * 100
    });

    it('should classify critical risk (75%+)', () => {
      const findings = [
        { severity: 'critical' },
        { severity: 'critical' },
        { severity: 'high' }
      ];
      const result = calcRiskScore(findings);

      expect(result.percent).toBeGreaterThanOrEqual(75);
      expect(result.level).toBe('critical');
      expect(result.label).toBe('קריטית');
    });

    it('should classify high risk (50-74%)', () => {
      const findings = [
        { severity: 'high' },
        { severity: 'high' },
        { severity: 'medium' }
      ];
      const result = calcRiskScore(findings);

      expect(result.percent).toBeGreaterThanOrEqual(50);
      expect(result.percent).toBeLessThan(75);
      expect(result.level).toBe('high');
    });

    it('should classify medium risk (25-49%)', () => {
      const findings = [
        { severity: 'medium' },
        { severity: 'medium' },
        { severity: 'low' }
      ];
      const result = calcRiskScore(findings);

      expect(result.percent).toBeGreaterThanOrEqual(25);
      expect(result.percent).toBeLessThan(50);
      expect(result.level).toBe('medium');
    });

    it('should classify low risk (<25%)', () => {
      const findings = [
        { severity: 'low' },
        { severity: 'info' },
        { severity: 'info' }
      ];
      const result = calcRiskScore(findings);

      expect(result.percent).toBeLessThan(25);
      expect(result.level).toBe('low');
    });

    it('should handle empty findings array', () => {
      const result = calcRiskScore([]);

      expect(result.score).toBe(0);
      expect(result.percent).toBe(0);
      expect(result.label).toBe('—');
      expect(result.level).toBe('');
    });

    it('should ignore unknown severity values', () => {
      const findings = [
        { severity: 'critical' },
        { severity: 'unknown' },
        { severity: null }
      ];
      const result = calcRiskScore(findings);

      expect(result.score).toBe(10); // Only critical counts
    });

    it('should handle all info severity', () => {
      const findings = [
        { severity: 'info' },
        { severity: 'info' }
      ];
      const result = calcRiskScore(findings);

      expect(result.score).toBe(0);
      expect(result.percent).toBe(0);
    });
  });

  describe('countSeverity', () => {
    const findings = [
      { severity: 'critical' },
      { severity: 'high' },
      { severity: 'critical' },
      { severity: 'medium' },
      { severity: 'high' }
    ];

    it('should count critical findings', () => {
      expect(countSeverity(findings, 'critical')).toBe(2);
    });

    it('should count high findings', () => {
      expect(countSeverity(findings, 'high')).toBe(2);
    });

    it('should count medium findings', () => {
      expect(countSeverity(findings, 'medium')).toBe(1);
    });

    it('should return zero for non-existent severity', () => {
      expect(countSeverity(findings, 'low')).toBe(0);
    });

    it('should handle empty array', () => {
      expect(countSeverity([], 'critical')).toBe(0);
    });
  });

  describe('parseReportDate', () => {
    it('should parse DD/MM/YYYY format', () => {
      const date = parseReportDate('25/12/2024');
      expect(date).toBeInstanceOf(Date);
      expect(date.getDate()).toBe(25);
      expect(date.getMonth()).toBe(11); // December (0-indexed)
      expect(date.getFullYear()).toBe(2024);
    });

    it('should parse DD-MM-YYYY format', () => {
      const date = parseReportDate('01-06-2024');
      expect(date.getDate()).toBe(1);
      expect(date.getMonth()).toBe(5);
    });

    it('should parse DD.MM.YYYY format', () => {
      const date = parseReportDate('15.03.2024');
      expect(date.getDate()).toBe(15);
      expect(date.getMonth()).toBe(2);
    });

    it('should return null for invalid format', () => {
      expect(parseReportDate('2024-12-25')).toBeNull();
      expect(parseReportDate('invalid')).toBeNull();
      expect(parseReportDate('12/25')).toBeNull();
    });

    it('should return null for invalid dates', () => {
      expect(parseReportDate('32/12/2024')).toBeNull(); // Invalid day
      expect(parseReportDate('25/13/2024')).toBeNull(); // Invalid month
      expect(parseReportDate('29/02/2023')).toBeNull(); // Invalid leap year
    });

    it('should handle null and undefined', () => {
      expect(parseReportDate(null)).toBeNull();
      expect(parseReportDate(undefined)).toBeNull();
      expect(parseReportDate('')).toBeNull();
    });

    it('should reject out of range years', () => {
      expect(parseReportDate('01/01/1800')).toBeNull();
      expect(parseReportDate('01/01/2200')).toBeNull();
    });

    it('should validate leap years correctly', () => {
      expect(parseReportDate('29/02/2024')).toBeInstanceOf(Date); // Valid leap year
      expect(parseReportDate('29/02/2023')).toBeNull(); // Invalid
    });
  });

  describe('formatDate', () => {
    it('should format date as DD/MM/YYYY', () => {
      const date = new Date(2024, 11, 25); // December 25, 2024
      expect(formatDate(date)).toBe('25/12/2024');
    });

    it('should pad single digits with zeros', () => {
      const date = new Date(2024, 0, 5); // January 5, 2024
      expect(formatDate(date)).toBe('05/01/2024');
    });

    it('should handle end of year', () => {
      const date = new Date(2024, 11, 31);
      expect(formatDate(date)).toBe('31/12/2024');
    });

    it('should handle start of year', () => {
      const date = new Date(2024, 0, 1);
      expect(formatDate(date)).toBe('01/01/2024');
    });
  });

  describe('getDaysForPriority', () => {
    it('should return 7 days for immediate priority', () => {
      expect(getDaysForPriority('מיידי (0–7 ימים)')).toBe(7);
    });

    it('should return 30 days for high priority', () => {
      expect(getDaysForPriority('גבוהה (עד 30 ימים)')).toBe(30);
    });

    it('should return 60 days for medium priority', () => {
      expect(getDaysForPriority('בינונית (30–60 ימים)')).toBe(60);
    });

    it('should return 120 days for low priority', () => {
      expect(getDaysForPriority('נמוכה (60–120 ימים)')).toBe(120);
    });

    it('should return 180 days for tracking', () => {
      expect(getDaysForPriority('למעקב')).toBe(180);
    });

    it('should return null for unknown priority', () => {
      expect(getDaysForPriority('unknown')).toBeNull();
      expect(getDaysForPriority('')).toBeNull();
      expect(getDaysForPriority(null)).toBeNull();
    });
  });

  describe('calcDueDate', () => {
    it('should calculate due date from report date and priority', () => {
      const dueDate = calcDueDate('01/01/2024', 'מיידי (0–7 ימים)');
      expect(dueDate).toBe('08/01/2024');
    });

    it('should handle month boundaries', () => {
      const dueDate = calcDueDate('25/01/2024', 'גבוהה (עד 30 ימים)');
      expect(dueDate).toBe('24/02/2024');
    });

    it('should handle year boundaries', () => {
      const dueDate = calcDueDate('01/12/2024', 'בינונית (30–60 ימים)');
      expect(dueDate).toBe('30/01/2025');
    });

    it('should return empty string for invalid report date', () => {
      expect(calcDueDate('invalid', 'מיידי (0–7 ימים)')).toBe('');
      expect(calcDueDate('', 'מיידי (0–7 ימים)')).toBe('');
    });

    it('should return empty string for invalid priority', () => {
      expect(calcDueDate('01/01/2024', 'unknown')).toBe('');
      expect(calcDueDate('01/01/2024', '')).toBe('');
    });

    it('should handle leap years', () => {
      const dueDate = calcDueDate('01/02/2024', 'גבוהה (עד 30 ימים)');
      expect(dueDate).toBe('02/03/2024'); // 2024 is leap year
    });
  });

  describe('buildReportHtml', () => {
    const mockData = {
      findings: [
        {
          id: 'F-001',
          title: 'Test Finding',
          category: 'CSPM',
          severity: 'high',
          description: 'Test description',
          impact: 'Test impact',
          technical: ['Tech detail 1'],
          policies: ['Policy 1'],
          recs: ['Recommendation 1'],
          priority: 'מיידי (0–7 ימים)',
          owner: 'Test Owner',
          evidence: []
        }
      ],
      meta: {
        teamName: 'Security Team',
        orgName: 'Test Org',
        client: 'Test Client',
        env: 'Production',
        range: 'Q1 2024',
        consultant: 'John Doe',
        reportDate: '01/01/2024',
        reportVersion: '1.0',
        reportLang: 'he',
        execSummary: 'Test summary',
        keyTopics: 'Topic 1\nTopic 2'
      },
      coverImageDataUrl: ''
    };

    it('should generate complete HTML document', () => {
      const html = buildReportHtml(mockData);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
    });

    it('should include metadata in report', () => {
      const html = buildReportHtml(mockData);

      expect(html).toContain('Security Team');
      expect(html).toContain('Test Client');
      expect(html).toContain('Production');
    });

    it('should include findings in report', () => {
      const html = buildReportHtml(mockData);

      expect(html).toContain('F-001');
      expect(html).toContain('Test Finding');
      expect(html).toContain('Test description');
    });

    it('should include severity counts', () => {
      const html = buildReportHtml(mockData);

      expect(html).toContain('גבוה'); // High severity in Hebrew
    });

    it('should include table of contents', () => {
      const html = buildReportHtml(mockData);

      expect(html).toContain('תוכן עניינים'); // TOC in Hebrew
      expect(html).toContain('#finding-F-001');
    });

    it('should handle English language', () => {
      const dataEn = { ...mockData, meta: { ...mockData.meta, reportLang: 'en' } };
      const html = buildReportHtml(dataEn);

      expect(html).toContain('lang="en"');
      expect(html).toContain('dir="ltr"');
      expect(html).toContain('Table of Contents');
    });

    it('should include risk score', () => {
      const html = buildReportHtml(mockData);

      expect(html).toContain('ציון סיכון'); // Risk score in Hebrew
    });

    it('should handle empty findings', () => {
      const emptyData = { ...mockData, findings: [] };
      const html = buildReportHtml(emptyData);

      expect(html).toContain('לא נוספו ממצאים'); // No findings message
    });

    it('should include category matrix when multiple categories', () => {
      const multiCatData = {
        ...mockData,
        findings: [
          { ...mockData.findings[0], category: 'CSPM' },
          { ...mockData.findings[0], category: 'KSPM', id: 'F-002' }
        ]
      };
      const html = buildReportHtml(multiCatData);

      expect(html).toContain('CSPM');
      expect(html).toContain('KSPM');
    });

    it('should escape HTML in findings', () => {
      const xssData = {
        ...mockData,
        findings: [{
          ...mockData.findings[0],
          title: '<script>alert("xss")</script>'
        }]
      };
      const html = buildReportHtml(xssData);

      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    });

    it('should include evidence images when provided', () => {
      const evidenceData = {
        ...mockData,
        findings: [{
          ...mockData.findings[0],
          evidence: ['data:image/png;base64,abc123']
        }]
      };
      const html = buildReportHtml(evidenceData);

      expect(html).toContain('data:image/png;base64,abc123');
      expect(html).toContain('הוכחות ממצא'); // Evidence section
    });

    it('should include cover image when provided', () => {
      const coverData = {
        ...mockData,
        coverImageDataUrl: 'data:image/png;base64,cover123'
      };
      const html = buildReportHtml(coverData);

      expect(html).toContain('data:image/png;base64,cover123');
    });

    it('should calculate due dates in treatment table', () => {
      const html = buildReportHtml(mockData);

      expect(html).toContain('08/01/2024'); // 7 days from 01/01/2024
    });

    it('should include appendix with policy mapping', () => {
      const html = buildReportHtml(mockData);

      expect(html).toContain('נספח א'); // Appendix A
      expect(html).toContain('Policy 1');
    });
  });

  describe('buildFilename', () => {
    it('should build filename from metadata', () => {
      const meta = {
        client: 'Test Client',
        reportDate: '01/01/2024'
      };
      const filename = buildFilename(meta, 'pdf');

      expect(filename).toBe('cspm_report_Test_Client_01-01-2024.pdf');
    });

    it('should handle missing client', () => {
      const meta = {
        reportDate: '01/01/2024'
      };
      const filename = buildFilename(meta, 'html');

      expect(filename).toBe('cspm_report_01-01-2024.html');
    });

    it('should handle missing date', () => {
      const meta = {
        client: 'Test Client'
      };
      const filename = buildFilename(meta, 'pdf');

      expect(filename).toBe('cspm_report_Test_Client.pdf');
    });

    it('should remove special characters from client name', () => {
      const meta = {
        client: 'Test@Client#123!'
      };
      const filename = buildFilename(meta, 'pdf');

      expect(filename).toBe('cspm_report_TestClient123.pdf');
    });

    it('should replace spaces with underscores', () => {
      const meta = {
        client: 'Test Client Name'
      };
      const filename = buildFilename(meta, 'pdf');

      expect(filename).toContain('Test_Client_Name');
    });

    it('should handle Hebrew characters', () => {
      const meta = {
        client: 'לקוח בדיקה'
      };
      const filename = buildFilename(meta, 'pdf');

      expect(filename).toContain('לקוח_בדיקה');
    });

    it('should handle different extensions', () => {
      const meta = { client: 'Test' };

      expect(buildFilename(meta, 'pdf')).toContain('.pdf');
      expect(buildFilename(meta, 'html')).toContain('.html');
      expect(buildFilename(meta, 'csv')).toContain('.csv');
    });

    it('should handle empty metadata', () => {
      const filename = buildFilename({}, 'pdf');

      expect(filename).toBe('cspm_report.pdf');
    });
  });

  describe('i18n translations', () => {
    it('should have Hebrew translations', () => {
      expect(i18n.he).toBeDefined();
      expect(i18n.he.lang).toBe('he');
      expect(i18n.he.dir).toBe('rtl');
      expect(i18n.he.toc).toBe('תוכן עניינים');
    });

    it('should have English translations', () => {
      expect(i18n.en).toBeDefined();
      expect(i18n.en.lang).toBe('en');
      expect(i18n.en.dir).toBe('ltr');
      expect(i18n.en.toc).toBe('Table of Contents');
    });

    it('should have matching keys in both languages', () => {
      const heKeys = Object.keys(i18n.he).sort();
      const enKeys = Object.keys(i18n.en).sort();

      expect(heKeys).toEqual(enKeys);
    });
  });

  describe('categoryMap', () => {
    it('should define all common categories', () => {
      expect(categoryMap.CSPM).toBe('Cloud Configuration');
      expect(categoryMap.KSPM).toBe('Kubernetes');
      expect(categoryMap.DSPM).toBe('Data Security');
      expect(categoryMap.VULN).toBe('Vulnerability');
    });

    it('should have string values', () => {
      Object.values(categoryMap).forEach(value => {
        expect(typeof value).toBe('string');
      });
    });
  });
});
