/**
 * UI Helpers Module
 * DOM manipulation and UI utilities
 */

/**
 * Escape HTML special characters
 * @param {string} str - String to escape
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Setup autocomplete for input fields
 * @param {HTMLInputElement} input - Input element
 * @param {HTMLInputElement} hiddenInput - Hidden input for selected ID
 * @param {HTMLElement} listEl - List element for suggestions
 * @param {Function} getItems - Function that returns items array
 */
export function setupAutocomplete(input, hiddenInput, listEl, getItems) {
  let activeIdx = -1;

  // Move list to body so it's never clipped by parent overflow
  if (listEl.parentNode !== document.body) {
    document.body.appendChild(listEl);
  }

  function positionList() {
    const rect = input.getBoundingClientRect();
    listEl.style.position = 'fixed';
    listEl.style.top = rect.bottom + 'px';
    listEl.style.left = rect.left + 'px';
    listEl.style.width = rect.width + 'px';
  }

  function render(query) {
    const items = getItems();
    const q = (query || '').toLowerCase();
    let filtered = q ? items.filter(it =>
      it.label.toLowerCase().includes(q) ||
      (it.sub || '').toLowerCase().includes(q) ||
      (it.externalId || '').toLowerCase().includes(q)
    ) : items;
    filtered = filtered.slice(0, 50); // cap results

    if (!filtered.length) {
      listEl.classList.remove('open');
      return;
    }

    listEl.innerHTML = filtered.map((it, i) =>
      '<div class="autocomplete-item" data-id="' + it.id + '" data-label="' + it.label.replace(/"/g, '&quot;') + '">' +
      it.label + (it.sub ? ' <span class="ac-sub">' + it.sub + '</span>' : '') +
      '</div>'
    ).join('');
    positionList();
    listEl.classList.add('open');
    activeIdx = -1;
  }

  input.addEventListener('input', function() {
    hiddenInput.value = '';
    render(input.value);
  });

  input.addEventListener('focus', function() {
    if (!input.value) render('');
  });

  listEl.addEventListener('click', function(e) {
    const item = e.target.closest('.autocomplete-item');
    if (item) {
      input.value = item.getAttribute('data-label');
      hiddenInput.value = item.getAttribute('data-id');
      listEl.classList.remove('open');
    }
  });

  input.addEventListener('keydown', function(e) {
    const items = listEl.querySelectorAll('.autocomplete-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      items[activeIdx].click();
      return;
    } else if (e.key === 'Escape') {
      listEl.classList.remove('open');
      return;
    } else {
      return;
    }

    items.forEach((el, i) => {
      el.classList.toggle('active', i === activeIdx);
    });
    if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
  });

  // Close on outside click
  document.addEventListener('click', function(e) {
    if (!input.contains(e.target) && !listEl.contains(e.target)) {
      listEl.classList.remove('open');
    }
  });

  // Close on scroll/resize
  window.addEventListener('scroll', function() {
    if (listEl.classList.contains('open')) positionList();
  }, true);
  window.addEventListener('resize', function() {
    listEl.classList.remove('open');
  });

  // Clear button behavior
  input.addEventListener('change', function() {
    if (!input.value.trim()) hiddenInput.value = '';
  });
}

/**
 * Map Wizi severity to internal severity
 * @param {string} sev - Wizi severity
 * @returns {string}
 */
export function mapWiziSeverity(sev) {
  const m = {
    CRITICAL: 'critical',
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
    INFORMATIONAL: 'info',
    INFO: 'info',
    NONE: 'info'
  };
  return m[(sev || '').toUpperCase()] || 'medium';
}

/**
 * Map Wizi entity to category
 * @param {Object} entity - Entity snapshot
 * @returns {string}
 */
export function mapWiziCategory(entity) {
  if (!entity) return 'CSPM';
  const t = (entity.type || '').toLowerCase();
  const nt = (entity.nativeType || '').toLowerCase();
  if (t.includes('kubernetes') || nt.includes('k8s') || nt.includes('kube')) return 'KSPM';
  if (t.includes('database') || t.includes('storage') || nt.includes('rds') || nt.includes('s3')) return 'DSPM';
  if (t.includes('network') || t.includes('firewall') || t.includes('security_group') || nt.includes('securitygroup')) return 'NEXP';
  if (t.includes('iam') || t.includes('role') || t.includes('policy') || nt.includes('iam')) return 'EAPM';
  if (t.includes('virtual_machine') || t.includes('host') || nt.includes('ec2') || nt.includes('vm')) return 'HSPM';
  if (t.includes('secret') || nt.includes('secret')) return 'SECR';
  return 'CSPM';
}

/**
 * Get title from a Wizi item
 * @param {Object} item - Finding item
 * @param {string} queryType - Query type
 * @returns {string}
 */
export function getWiziItemTitle(item, queryType) {
  if (queryType === 'issues') {
    const rules = item.sourceRules || [];
    return rules.length ? rules[0].name : (item.description || '');
  }
  if (queryType === 'configurationFindings' || queryType === 'hostConfigurationRuleAssessments' || queryType === 'inventoryFindings') {
    const rule = item.rule || {};
    return rule.name || item.name || '';
  }
  if (queryType === 'vulnerabilityFindings') return item.name || item.detailedName || '';
  if (queryType === 'dataFindingsV2') return item.name || (item.dataClassifier || {}).name || '';
  if (queryType === 'secretInstances') return item.name || (item.rule || {}).name || '';
  if (queryType === 'excessiveAccessFindings') return item.name || '';
  if (queryType === 'networkExposures') return 'Network Exposure — ' + ((item.exposedEntity || {}).name || item.id);
  return item.name || '';
}

/**
 * Get rule ID from a Wizi item for consolidation
 * @param {Object} item - Finding item
 * @param {string} queryType - Query type
 * @returns {string|null}
 */
export function getWiziRuleId(item, queryType) {
  if (queryType === 'issues') {
    const rules = item.sourceRules || [];
    return rules.length ? (rules[0].id || rules[0].shortId || rules[0].name) : null;
  }
  if (queryType === 'configurationFindings' || queryType === 'hostConfigurationRuleAssessments' || queryType === 'inventoryFindings') {
    const rule = item.rule || {};
    return rule.id || rule.shortId || rule.shortName || rule.externalId || null;
  }
  if (queryType === 'vulnerabilityFindings') {
    return item.name || item.detailedName || null;
  }
  if (queryType === 'dataFindingsV2') {
    const classifier = item.dataClassifier || {};
    return classifier.id || classifier.name || null;
  }
  if (queryType === 'secretInstances') {
    const rule = item.rule || {};
    return rule.id || rule.name || item.type || null;
  }
  if (queryType === 'excessiveAccessFindings') {
    return item.name || null;
  }
  if (queryType === 'networkExposures') {
    return item.type + '_' + (item.portRange || 'any');
  }
  return null;
}

/**
 * Extract resource name from a Wizi item
 * @param {Object} item - Finding item
 * @param {string} queryType - Query type
 * @returns {string|null}
 */
export function extractResourceName(item, queryType) {
  if (queryType === 'issues') {
    const entity = item.entitySnapshot || {};
    return entity.name || null;
  }
  else if (queryType === 'configurationFindings' || queryType === 'hostConfigurationRuleAssessments' || queryType === 'inventoryFindings') {
    const resource = item.resource || {};
    return resource.name || null;
  }
  else if (queryType === 'vulnerabilityFindings') {
    const asset = item.vulnerableAsset || {};
    if (asset.name) return asset.name;
    // Fallback: parse detailedName
    const dn = item.detailedName || '';
    const onIdx = dn.lastIndexOf(' on ');
    if (onIdx > 0) return dn.substring(onIdx + 4);
    const projects = (item.projects || []).map(p => p.name).filter(Boolean);
    return projects.length ? projects[0] : null;
  }
  else if (queryType === 'dataFindingsV2') {
    const entity = item.graphEntity || {};
    return entity.name || null;
  }
  else if (queryType === 'secretInstances') {
    const res = item.resource || {};
    return res.name || null;
  }
  else if (queryType === 'excessiveAccessFindings') {
    const principal = item.principal || {};
    const ge = principal.graphEntity || {};
    return ge.name || null;
  }
  else if (queryType === 'networkExposures') {
    const entity = item.exposedEntity || {};
    return entity.name || null;
  }
  return null;
}

/**
 * Extract recommendations from rule data
 * @param {Object} rule - Rule object
 * @param {string} sevLabel - Severity label
 * @returns {Array<string>}
 */
export function extractRecommendations(rule, sevLabel) {
  const recs = [];

  // 1. Use remediationInstructions if available
  const ri = (rule.remediationInstructions || '').trim();
  if (ri) {
    const cleaned = ri
      .replace(/```(?:\w*\n)?([\s\S]*?)```/g, (_, code) => code.trim())
      .replace(/\s*\n\s*/g, '\n');
    const lines = cleaned.split('\n').map(s => s.trim()).filter(Boolean);
    lines.forEach(line => {
      if (line.length < 15) return;
      if (/^note:/i.test(line)) return;
      recs.push(line);
    });
  }

  // 2. Fallback: extract from description
  if (!recs.length && rule.description) {
    const sentences = rule.description.split(/(?:\.\s+|\n)/).map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    sentences.forEach(s => {
      if (/^this rule (checks|fails|skips|is)/i.test(s)) return;
      if (/^this rule$/i.test(s)) return;
      if (/it is recommended|you should|we recommend|consider /i.test(s) && s.length > 20 && s.length < 400) {
        recs.push(s.replace(/\.$/, ''));
      }
    });
  }

  // 3. Last resort: generic Hebrew recommendation
  if (!recs.length) {
    recs.push('לטפל בממצא בהתאם לרמת החומרה (' + sevLabel + ')');
  }

  return recs;
}
