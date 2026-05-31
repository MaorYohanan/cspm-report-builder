/**
 * @jest-environment jsdom
 */

import * as subManager from '../../../../static/js/wizi/subscription-manager.js';

describe('Subscription Manager', () => {
  beforeEach(() => {
    // Reset subscriptions before each test
    subManager.setSubscriptions([]);
  });

  describe('setSubscriptions', () => {
    it('should transform subscription objects correctly', () => {
      const subs = [
        {
          name: 'production',
          cloudProvider: 'AWS',
          externalId: 'aws-123456',
          id: 'internal-id-1'
        },
        {
          name: 'staging',
          cloudProvider: 'Azure',
          externalId: 'azure-789',
          id: 'internal-id-2'
        }
      ];

      subManager.setSubscriptions(subs);
      const result = subManager.getSubscriptions();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'production',
        label: 'production',
        sub: 'AWS · aws-123456',
        externalId: 'aws-123456'
      });
      expect(result[1]).toEqual({
        id: 'staging',
        label: 'staging',
        sub: 'Azure · azure-789',
        externalId: 'azure-789'
      });
    });

    it('should handle missing externalId and use id substring', () => {
      const subs = [
        {
          name: 'test-sub',
          cloudProvider: 'GCP',
          id: 'very-long-internal-id-12345'
        }
      ];

      subManager.setSubscriptions(subs);
      const result = subManager.getSubscriptions();

      expect(result[0].sub).toBe('GCP · very-lon');
      expect(result[0].externalId).toBe('');
    });

    it('should handle missing id and externalId', () => {
      const subs = [
        {
          name: 'minimal-sub',
          cloudProvider: 'AWS'
        }
      ];

      subManager.setSubscriptions(subs);
      const result = subManager.getSubscriptions();

      expect(result[0].sub).toBe('AWS · ');
      expect(result[0].externalId).toBe('');
    });

    it('should handle empty array', () => {
      subManager.setSubscriptions([]);
      const result = subManager.getSubscriptions();

      expect(result).toEqual([]);
    });
  });

  describe('getNodeSubscriptionName', () => {
    describe('issues query type', () => {
      it('should extract subscription name from entitySnapshot', () => {
        const node = {
          entitySnapshot: {
            subscriptionName: 'production-aws'
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'issues');
        expect(result).toBe('production-aws');
      });

      it('should return empty string if entitySnapshot missing', () => {
        const node = {};
        const result = subManager.getNodeSubscriptionName(node, 'issues');
        expect(result).toBe('');
      });
    });

    describe('configurationFindings query type', () => {
      it('should extract from resource.subscription.name', () => {
        const node = {
          resource: {
            subscription: {
              name: 'config-sub'
            }
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'configurationFindings');
        expect(result).toBe('config-sub');
      });

      it('should extract from resource.cloudAccount.name', () => {
        const node = {
          resource: {
            cloudAccount: {
              name: 'cloud-account-sub'
            }
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'configurationFindings');
        expect(result).toBe('cloud-account-sub');
      });
    });

    describe('hostConfigurationRuleAssessments query type', () => {
      it('should extract subscription name from resource', () => {
        const node = {
          resource: {
            subscription: {
              name: 'host-sub'
            }
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'hostConfigurationRuleAssessments');
        expect(result).toBe('host-sub');
      });
    });

    describe('inventoryFindings query type', () => {
      it('should extract subscription name from resource', () => {
        const node = {
          resource: {
            cloudAccount: {
              name: 'inventory-sub'
            }
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'inventoryFindings');
        expect(result).toBe('inventory-sub');
      });
    });

    describe('vulnerabilityFindings query type', () => {
      it('should extract from vulnerableAsset.subscriptionName', () => {
        const node = {
          vulnerableAsset: {
            subscriptionName: 'vuln-sub'
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'vulnerabilityFindings');
        expect(result).toBe('vuln-sub');
      });

      it('should return empty string if vulnerableAsset missing', () => {
        const node = {};
        const result = subManager.getNodeSubscriptionName(node, 'vulnerabilityFindings');
        expect(result).toBe('');
      });
    });

    describe('dataFindingsV2 query type', () => {
      it('should extract from cloudAccount.name', () => {
        const node = {
          cloudAccount: {
            name: 'data-sub'
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'dataFindingsV2');
        expect(result).toBe('data-sub');
      });
    });

    describe('secretInstances query type', () => {
      it('should extract from resource.cloudAccount.name', () => {
        const node = {
          resource: {
            cloudAccount: {
              name: 'secret-sub'
            }
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'secretInstances');
        expect(result).toBe('secret-sub');
      });

      it('should fallback to resource.name', () => {
        const node = {
          resource: {
            name: 'resource-name-sub'
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'secretInstances');
        expect(result).toBe('resource-name-sub');
      });
    });

    describe('excessiveAccessFindings query type', () => {
      it('should extract from principal.cloudAccount.name', () => {
        const node = {
          principal: {
            cloudAccount: {
              name: 'access-sub'
            }
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'excessiveAccessFindings');
        expect(result).toBe('access-sub');
      });

      it('should fallback to principal.cloudAccount.externalId', () => {
        const node = {
          principal: {
            cloudAccount: {
              externalId: 'ext-123'
            }
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'excessiveAccessFindings');
        expect(result).toBe('ext-123');
      });
    });

    describe('networkExposures query type', () => {
      it('should extract from exposedEntity.cloudAccount.name', () => {
        const node = {
          exposedEntity: {
            cloudAccount: {
              name: 'network-sub'
            }
          }
        };

        const result = subManager.getNodeSubscriptionName(node, 'networkExposures');
        expect(result).toBe('network-sub');
      });
    });

    it('should return empty string for unknown query type', () => {
      const node = { some: 'data' };
      const result = subManager.getNodeSubscriptionName(node, 'unknownType');
      expect(result).toBe('');
    });
  });

  describe('extractAutoFillData', () => {
    describe('issues query type', () => {
      it('should extract subscription, cloud, and topics', () => {
        const nodes = [
          {
            entitySnapshot: {
              subscriptionExternalId: 'aws-123',
              cloudPlatform: 'AWS'
            }
          },
          {
            entitySnapshot: {
              subscriptionName: 'azure-sub',
              cloudPlatform: 'Azure'
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'issues');

        expect(result.subscription).toContain('aws-123');
        expect(result.subscription).toContain('azure-sub');
        expect(result.cloud).toContain('AWS');
        expect(result.cloud).toContain('Azure');
      });
    });

    describe('configurationFindings query type', () => {
      it('should extract data and include CSPM topic', () => {
        const nodes = [
          {
            resource: {
              subscription: {
                externalId: 'sub-ext-1',
                cloudProvider: 'AWS'
              }
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'configurationFindings');

        expect(result.subscription).toBe('sub-ext-1');
        expect(result.cloud).toBe('AWS');
        expect(result.keyTopics).toContain('תצורת ענן (CSPM)');
      });

      it('should use cloudAccount when subscription missing', () => {
        const nodes = [
          {
            resource: {
              cloudAccount: {
                name: 'cloud-acc',
                cloudProvider: 'GCP'
              }
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'configurationFindings');

        expect(result.subscription).toBe('cloud-acc');
        expect(result.cloud).toBe('GCP');
      });

      it('should fallback to cloudPlatform', () => {
        const nodes = [
          {
            resource: {
              cloudPlatform: 'Azure'
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'configurationFindings');

        expect(result.cloud).toBe('Azure');
      });
    });

    describe('vulnerabilityFindings query type', () => {
      it('should extract data and include vulnerability topics', () => {
        const nodes = [
          {
            vulnerableAsset: {
              subscriptionName: 'vuln-sub',
              type: 'CONTAINER_IMAGE'
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'vulnerabilityFindings');

        expect(result.subscription).toBe('vuln-sub');
        expect(result.keyTopics).toContain('פגיעויות (Vulnerabilities)');
        expect(result.keyTopics).toContain('פגיעויות ב-CONTAINER IMAGE');
      });
    });

    describe('hostConfigurationRuleAssessments query type', () => {
      it('should include host configuration topic', () => {
        const nodes = [
          {
            resource: {
              subscription: {
                name: 'host-sub',
                cloudProvider: 'AWS'
              }
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'hostConfigurationRuleAssessments');

        expect(result.keyTopics).toContain('תצורת שרתים (Host Configuration)');
      });
    });

    describe('dataFindingsV2 query type', () => {
      it('should include DSPM topic', () => {
        const nodes = [
          {
            cloudAccount: {
              name: 'data-sub',
              cloudProvider: 'AWS'
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'dataFindingsV2');

        expect(result.subscription).toBe('data-sub');
        expect(result.cloud).toBe('AWS');
        expect(result.keyTopics).toContain('אבטחת מידע (DSPM)');
      });
    });

    describe('secretInstances query type', () => {
      it('should include secrets topic', () => {
        const nodes = [
          {
            resource: {
              cloudAccount: {
                name: 'secret-sub'
              },
              cloudPlatform: 'GCP'
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'secretInstances');

        expect(result.subscription).toBe('secret-sub');
        expect(result.cloud).toBe('GCP');
        expect(result.keyTopics).toContain('סודות חשופים (Secrets)');
      });
    });

    describe('excessiveAccessFindings query type', () => {
      it('should include excessive access topic', () => {
        const nodes = [
          {
            cloudPlatform: 'AWS',
            principal: {
              cloudAccount: {
                externalId: 'ext-456'
              }
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'excessiveAccessFindings');

        expect(result.subscription).toBe('ext-456');
        expect(result.cloud).toBe('AWS');
        expect(result.keyTopics).toContain('הרשאות יתר (Excessive Access)');
      });

      it('should fallback to cloudAccount.name', () => {
        const nodes = [
          {
            principal: {
              cloudAccount: {
                name: 'access-name'
              }
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'excessiveAccessFindings');

        expect(result.subscription).toBe('access-name');
      });
    });

    describe('networkExposures query type', () => {
      it('should include network exposure topic', () => {
        const nodes = [
          {
            exposedEntity: {
              cloudAccount: {
                name: 'network-sub'
              }
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'networkExposures');

        expect(result.subscription).toBe('network-sub');
        expect(result.keyTopics).toContain('חשיפה לאינטרנט (Network Exposure)');
      });
    });

    describe('inventoryFindings query type', () => {
      it('should include EOL topic', () => {
        const nodes = [
          {
            resource: {
              cloudAccount: {
                name: 'inventory-sub',
                cloudProvider: 'Azure'
              }
            }
          }
        ];

        const result = subManager.extractAutoFillData(nodes, 'inventoryFindings');

        expect(result.subscription).toBe('inventory-sub');
        expect(result.cloud).toBe('Azure');
        expect(result.keyTopics).toContain('משאבים בסוף חיים (EOL)');
      });
    });

    it('should handle multiple subscriptions and clouds', () => {
      const nodes = [
        {
          entitySnapshot: {
            subscriptionExternalId: 'sub1',
            cloudPlatform: 'AWS'
          }
        },
        {
          entitySnapshot: {
            subscriptionExternalId: 'sub2',
            cloudPlatform: 'Azure'
          }
        },
        {
          entitySnapshot: {
            subscriptionName: 'sub3',
            cloudPlatform: 'GCP'
          }
        }
      ];

      const result = subManager.extractAutoFillData(nodes, 'issues');

      expect(result.subscription.split(', ')).toHaveLength(3);
      expect(result.cloud.split(', ')).toHaveLength(3);
    });

    it('should handle empty nodes array', () => {
      const result = subManager.extractAutoFillData([], 'issues');

      expect(result.subscription).toBe('');
      expect(result.cloud).toBe('');
      expect(result.keyTopics).toBe('');
    });

    it('should deduplicate subscriptions and clouds', () => {
      const nodes = [
        {
          entitySnapshot: {
            subscriptionName: 'duplicate-sub',
            cloudPlatform: 'AWS'
          }
        },
        {
          entitySnapshot: {
            subscriptionName: 'duplicate-sub',
            cloudPlatform: 'AWS'
          }
        }
      ];

      const result = subManager.extractAutoFillData(nodes, 'issues');

      expect(result.subscription).toBe('duplicate-sub');
      expect(result.cloud).toBe('AWS');
    });
  });
});
