/**
 * @jest-environment jsdom
 */

import * as apiClient from '../../../../static/js/wizi/api-client.js';

describe('Wizi API Client', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('checkWiziStatus', () => {
    it('should fetch status and return JSON', async () => {
      const mockResponse = { enabled: true, totalIssues: 42 };
      global.fetch.mockResolvedValueOnce({
        json: async () => mockResponse
      });

      const result = await apiClient.checkWiziStatus();

      expect(global.fetch).toHaveBeenCalledWith('/api/wizi/status');
      expect(result).toEqual(mockResponse);
    });

    it('should handle network errors', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(apiClient.checkWiziStatus()).rejects.toThrow('Network error');
    });

    it('should handle JSON parse errors', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => { throw new Error('Invalid JSON'); }
      });

      await expect(apiClient.checkWiziStatus()).rejects.toThrow('Invalid JSON');
    });
  });

  describe('fetchSubscriptions', () => {
    it('should fetch subscriptions list', async () => {
      const mockSubs = { subscriptions: [
        { name: 'sub1', cloudProvider: 'AWS' },
        { name: 'sub2', cloudProvider: 'Azure' }
      ]};
      global.fetch.mockResolvedValueOnce({
        json: async () => mockSubs
      });

      const result = await apiClient.fetchSubscriptions();

      expect(global.fetch).toHaveBeenCalledWith('/api/wizi/subscriptions');
      expect(result).toEqual(mockSubs);
    });

    it('should handle empty subscriptions', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => ({ subscriptions: [] })
      });

      const result = await apiClient.fetchSubscriptions();

      expect(result.subscriptions).toEqual([]);
    });
  });

  describe('fetchIssues', () => {
    it('should POST query parameters and return issues', async () => {
      const params = {
        queryType: 'issues',
        first: 50,
        severity: ['CRITICAL', 'HIGH'],
        status: ['OPEN', 'IN_PROGRESS']
      };
      const mockResponse = { nodes: [], pageInfo: {} };

      global.fetch.mockResolvedValueOnce({
        json: async () => mockResponse
      });

      const result = await apiClient.fetchIssues(params);

      expect(global.fetch).toHaveBeenCalledWith('/api/wizi/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle pagination parameters', async () => {
      const params = {
        queryType: 'configurationFindings',
        first: 100,
        severity: ['CRITICAL'],
        status: ['FAIL'],
        after: 'cursor123'
      };

      global.fetch.mockResolvedValueOnce({
        json: async () => ({ nodes: [], pageInfo: { hasNextPage: false } })
      });

      await apiClient.fetchIssues(params);

      expect(global.fetch).toHaveBeenCalledWith('/api/wizi/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
    });

    it('should handle subscription filter', async () => {
      const params = {
        queryType: 'issues',
        first: 50,
        severity: ['HIGH'],
        status: ['OPEN'],
        subscription: 'my-subscription'
      };

      global.fetch.mockResolvedValueOnce({
        json: async () => ({ nodes: [] })
      });

      await apiClient.fetchIssues(params);

      const callArgs = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(callArgs.subscription).toBe('my-subscription');
    });

    it('should handle API errors', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => ({ error: 'Invalid query type' })
      });

      const result = await apiClient.fetchIssues({ queryType: 'invalid' });

      expect(result).toEqual({ error: 'Invalid query type' });
    });
  });

  describe('findById', () => {
    it('should POST finding ID and return result', async () => {
      const params = {
        id: 'finding-123',
        page: 1,
        pageSize: 20
      };
      const mockResponse = { finding: { id: 'finding-123' } };

      global.fetch.mockResolvedValueOnce({
        json: async () => mockResponse
      });

      const result = await apiClient.findById(params);

      expect(global.fetch).toHaveBeenCalledWith('/api/wizi/find-by-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      expect(result).toEqual(mockResponse);
    });

    it('should work with minimal parameters', async () => {
      const params = { id: 'finding-456' };

      global.fetch.mockResolvedValueOnce({
        json: async () => ({ finding: null })
      });

      await apiClient.findById(params);

      const callArgs = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(callArgs.id).toBe('finding-456');
      expect(callArgs.page).toBeUndefined();
    });

    it('should handle not found errors', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => ({ error: 'Finding not found' })
      });

      const result = await apiClient.findById({ id: 'nonexistent' });

      expect(result).toEqual({ error: 'Finding not found' });
    });
  });

  describe('bulkFetch', () => {
    it('should POST subscription and return bulk results', async () => {
      const subscription = 'my-subscription';
      const mockResponse = {
        resolvedSubscription: { ids: ['123'] },
        results: {
          issues: { nodes: [] },
          configurationFindings: { nodes: [] }
        }
      };

      global.fetch.mockResolvedValueOnce({
        json: async () => mockResponse
      });

      const result = await apiClient.bulkFetch(subscription);

      expect(global.fetch).toHaveBeenCalledWith('/api/wizi/bulk-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription })
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle empty subscription name', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => ({ resolvedSubscription: {}, results: {} })
      });

      const result = await apiClient.bulkFetch('');

      expect(result.resolvedSubscription).toEqual({});
    });

    it('should handle errors in bulk fetch', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => ({
          errors: {
            issues: 'Rate limit exceeded',
            configurationFindings: 'Timeout'
          }
        })
      });

      const result = await apiClient.bulkFetch('test-sub');

      expect(result.errors).toBeDefined();
      expect(result.errors.issues).toBe('Rate limit exceeded');
    });
  });

  describe('summarizeRemediation', () => {
    it('should POST remediation details and return summary', async () => {
      const params = {
        title: 'Security Issue',
        description: 'Detailed description',
        text: 'Remediation steps'
      };
      const mockResponse = { summary: 'AI-generated summary' };

      global.fetch.mockResolvedValueOnce({
        json: async () => mockResponse
      });

      const result = await apiClient.summarizeRemediation(params);

      expect(global.fetch).toHaveBeenCalledWith('/api/summarize-remediation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle AI service errors', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => ({ error: 'AI service unavailable' })
      });

      const result = await apiClient.summarizeRemediation({
        title: 'Test',
        description: 'Test',
        text: 'Test'
      });

      expect(result).toEqual({ error: 'AI service unavailable' });
    });

    it('should handle empty remediation text', async () => {
      const params = {
        title: 'Issue',
        description: 'Description',
        text: ''
      };

      global.fetch.mockResolvedValueOnce({
        json: async () => ({ summary: '' })
      });

      const result = await apiClient.summarizeRemediation(params);

      expect(result.summary).toBe('');
    });
  });

  describe('Error handling edge cases', () => {
    it('should handle 404 responses', async () => {
      global.fetch.mockResolvedValueOnce({
        status: 404,
        json: async () => ({ error: 'Not found' })
      });

      const result = await apiClient.checkWiziStatus();

      expect(result).toEqual({ error: 'Not found' });
    });

    it('should handle 500 server errors', async () => {
      global.fetch.mockResolvedValueOnce({
        status: 500,
        json: async () => ({ error: 'Internal server error' })
      });

      const result = await apiClient.fetchIssues({ queryType: 'issues', first: 10 });

      expect(result).toEqual({ error: 'Internal server error' });
    });

    it('should handle timeout errors', async () => {
      global.fetch.mockImplementationOnce(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), 100)
        )
      );

      await expect(apiClient.bulkFetch('test')).rejects.toThrow('Request timeout');
    });
  });
});
