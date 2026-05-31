/**
 * Subscription Manager Module
 * Handles subscription selection and filtering logic
 */

/**
 * Global subscriptions list
 * @type {Array<{id: string, label: string, sub: string, externalId: string}>}
 */
export let subscriptions = [];

/**
 * Update subscriptions list
 * @param {Array} subs - Array of subscription objects from API
 */
export function setSubscriptions(subs) {
  subscriptions = subs.map(s => ({
    id: s.name,
    label: s.name,
    sub: s.cloudProvider + ' · ' + (s.externalId || (s.id ? s.id.substring(0, 8) : '')),
    externalId: s.externalId || ''
  }));
}

/**
 * Get subscriptions for autocomplete
 * @returns {Array}
 */
export function getSubscriptions() {
  return subscriptions;
}

/**
 * Extract subscription name from a finding node based on query type
 * @param {Object} node - Finding node
 * @param {string} queryType - Query type
 * @returns {string}
 */
export function getNodeSubscriptionName(node, queryType) {
  let subName = '';

  if (queryType === 'issues') {
    const es = node.entitySnapshot || {};
    subName = es.subscriptionName || '';
  }
  else if (queryType === 'configurationFindings' || queryType === 'hostConfigurationRuleAssessments' || queryType === 'inventoryFindings') {
    const res = node.resource || {};
    const sub = res.subscription || res.cloudAccount || {};
    subName = sub.name || '';
  }
  else if (queryType === 'vulnerabilityFindings') {
    const asset = node.vulnerableAsset || {};
    subName = asset.subscriptionName || '';
  }
  else if (queryType === 'dataFindingsV2') {
    const ca = node.cloudAccount || {};
    subName = ca.name || '';
  }
  else if (queryType === 'secretInstances') {
    const sr = node.resource || {};
    const sca = sr.cloudAccount || {};
    subName = sca.name || sr.name || '';
  }
  else if (queryType === 'excessiveAccessFindings') {
    const p = node.principal || {};
    const pca = p.cloudAccount || {};
    subName = pca.name || pca.externalId || '';
  }
  else if (queryType === 'networkExposures') {
    const ee = node.exposedEntity || {};
    const eca = ee.cloudAccount || {};
    subName = eca.name || '';
  }

  return subName;
}

/**
 * Extract auto-fill data from Wizi results
 * @param {Array} nodes - Finding nodes
 * @param {string} queryType - Query type
 * @returns {Object} Auto-fill data (subscription, cloud, keyTopics)
 */
export function extractAutoFillData(nodes, queryType) {
  const subscriptions = {};
  const clouds = {};
  const topics = {};

  nodes.forEach(n => {
    if (queryType === 'issues') {
      const es = n.entitySnapshot || {};
      if (es.subscriptionExternalId) subscriptions[es.subscriptionExternalId] = true;
      else if (es.subscriptionName) subscriptions[es.subscriptionName] = true;
      if (es.cloudPlatform) clouds[es.cloudPlatform] = true;
    } else if (queryType === 'configurationFindings' || queryType === 'hostConfigurationRuleAssessments' || queryType === 'inventoryFindings') {
      const res = n.resource || {};
      const sub = res.subscription || res.cloudAccount || {};
      if (sub.externalId) subscriptions[sub.externalId] = true;
      else if (sub.name) subscriptions[sub.name] = true;
      if (sub.cloudProvider) clouds[sub.cloudProvider] = true;
      else if (res.cloudPlatform) clouds[res.cloudPlatform] = true;
    } else if (queryType === 'vulnerabilityFindings') {
      const asset = n.vulnerableAsset || {};
      if (asset.subscriptionName) subscriptions[asset.subscriptionName] = true;
      if (asset.type) {
        const t = asset.type.replace(/_/g, ' ');
        topics['פגיעויות ב-' + t] = true;
      }
    } else if (queryType === 'dataFindingsV2') {
      const ca = n.cloudAccount || {};
      if (ca.name) subscriptions[ca.name] = true;
      if (ca.cloudProvider) clouds[ca.cloudProvider] = true;
    } else if (queryType === 'secretInstances') {
      const sr = n.resource || {};
      const sca = sr.cloudAccount || {};
      if (sca.name) subscriptions[sca.name] = true;
      if (sr.cloudPlatform) clouds[sr.cloudPlatform] = true;
    } else if (queryType === 'excessiveAccessFindings') {
      if (n.cloudPlatform) clouds[n.cloudPlatform] = true;
      const pca = (n.principal || {}).cloudAccount || {};
      if (pca.externalId) subscriptions[pca.externalId] = true;
      else if (pca.name) subscriptions[pca.name] = true;
    } else if (queryType === 'networkExposures') {
      const ee = n.exposedEntity || {};
      const eca = ee.cloudAccount || {};
      if (eca.name) subscriptions[eca.name] = true;
    }
  });

  // Extract key topics from query types
  if (queryType === 'configurationFindings') topics['תצורת ענן (CSPM)'] = true;
  if (queryType === 'hostConfigurationRuleAssessments') topics['תצורת שרתים (Host Configuration)'] = true;
  if (queryType === 'vulnerabilityFindings') topics['פגיעויות (Vulnerabilities)'] = true;
  if (queryType === 'dataFindingsV2') topics['אבטחת מידע (DSPM)'] = true;
  if (queryType === 'secretInstances') topics['סודות חשופים (Secrets)'] = true;
  if (queryType === 'excessiveAccessFindings') topics['הרשאות יתר (Excessive Access)'] = true;
  if (queryType === 'networkExposures') topics['חשיפה לאינטרנט (Network Exposure)'] = true;
  if (queryType === 'inventoryFindings') topics['משאבים בסוף חיים (EOL)'] = true;

  return {
    subscription: Object.keys(subscriptions).join(', '),
    cloud: Object.keys(clouds).join(', '),
    keyTopics: Object.keys(topics).join('\n')
  };
}
