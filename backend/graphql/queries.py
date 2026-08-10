"""
GraphQL query strings for Wiz API integration.

This module contains all GraphQL queries used to fetch security findings,
projects, subscriptions, and other data from the Wiz platform.
"""

# ---------------------------------------------------------------------------
# Core Findings Queries
# ---------------------------------------------------------------------------

ISSUES_QUERY = """
query IssuesTable($first: Int, $after: String, $filterBy: IssueFilters) {
  issues(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      control { id name }
      sourceRules { id name description }
      severity
      status
      description
      projects { id name }
      cloudAccounts { id name cloudProvider externalId }
      entitySnapshot {
        name type cloudPlatform region
        subscriptionName subscriptionExternalId nativeType tags
      }
      notes { text }
      createdAt updatedAt
    }
  }
}
"""

CONFIG_FINDINGS_QUERY = """
query ConfigFindings($first: Int, $after: String, $filterBy: ConfigurationFindingFilters) {
  configurationFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id name severity result status
      rule { id name shortId description remediationInstructions }
      resource {
        name type region nativeType
        subscription { name cloudProvider externalId }
      }
      securitySubCategories { title category { name } }
      analyzedAt
    }
  }
}
"""

VULN_FINDINGS_QUERY = """
query VulnFindings($first: Int, $after: String, $filterBy: VulnerabilityFindingFilters) {
  vulnerabilityFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id name severity score
      CVEDescription
      hasExploit hasFix fixedVersion version
      remediation description detailedName
      status
      projects { name }
      vulnerableAsset {
        ... on VulnerableAssetVirtualMachine { name type subscriptionName }
        ... on VulnerableAssetServerless { name type subscriptionName }
        ... on VulnerableAssetContainerImage { name type subscriptionName }
        ... on VulnerableAssetContainer { name type subscriptionName }
        ... on VulnerableAssetRepositoryBranch { name type subscriptionName }
        ... on VulnerableAssetIde { name type subscriptionName }
        ... on VulnerableAssetEndpoint { name type subscriptionName }
        ... on VulnerableAssetPaaSResource { name type subscriptionName }
        ... on VulnerableAssetVirtualMachineImage { name type subscriptionName }
        ... on VulnerableAssetCommon { name type subscriptionName }
        ... on VulnerableAssetNetworkAddress { name type subscriptionName }
      }
      firstDetectedAt lastDetectedAt
    }
  }
}
"""

HOST_CONFIG_QUERY = """
query HostConfigFindings($first: Int, $after: String, $filterBy: HostConfigurationRuleAssessmentFilters) {
  hostConfigurationRuleAssessments(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id severity result status
      rule { id name description remediationInstructions }
      resource {
        name nativeType region cloudPlatform
        subscription { name cloudProvider externalId }
      }
    }
  }
}
"""

DATA_FINDINGS_QUERY = """
query DataFindings($first: Int, $after: String, $filterBy: DataFindingFiltersV2) {
  dataFindingsV2(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id name severity status
      dataClassifier { name category }
      graphEntity { name type }
      cloudAccount { name cloudProvider externalId }
    }
  }
}
"""

SECRET_INSTANCES_QUERY = """
query SecretInstances($first: Int, $after: String, $filterBy: SecretInstanceFilters) {
  secretInstances(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id name severity status type path
      rule { name }
      resource { name nativeType region cloudPlatform cloudAccount { name } }
    }
  }
}
"""

EXCESSIVE_ACCESS_QUERY = """
query ExcessiveAccessFindings($first: Int, $after: String, $filterBy: ExcessiveAccessFindingFilters) {
  excessiveAccessFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id name severity status cloudPlatform description
      remediationType remediationInstructions
      projects { name }
      principal { graphEntity { name type } cloudAccount { name externalId } }
    }
  }
}
"""

NETWORK_EXPOSURE_QUERY = """
query NetworkExposures($first: Int, $after: String, $filterBy: NetworkExposureFilters) {
  networkExposures(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id sourceIpRange portRange type
      exposedEntity { name type }
    }
  }
}
"""

INVENTORY_FINDINGS_QUERY = """
query InventoryFindings($first: Int, $after: String, $filterBy: InventoryFindingFilters) {
  inventoryFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id severity status
      rule { id name description }
      resource {
        name nativeType region cloudPlatform
        cloudAccount { name externalId cloudProvider }
      }
    }
  }
}
"""

END_OF_LIFE_QUERY = """
query EndOfLifeFindings($first: Int, $after: String, $filterBy: EndOfLifeFindingFilters) {
  endOfLifeFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id severity status
      technology { name version endOfLifeDate vendorSupportStatus }
      resource {
        name nativeType region cloudPlatform
        cloudAccount { name externalId cloudProvider }
      }
    }
  }
}
"""

MALWARE_FINDINGS_QUERY = """
query MalwareFindings($first: Int, $after: String, $filterBy: MalwareFindingFilters) {
  malwareFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id name severity status
      classification { familyName type platform }
      confidenceLevel
      detectionType
      description
      fileDetails { path fileSizeBytes }
      md5 sha256
      resource {
        name type nativeType cloudPlatform
        cloudAccount { name externalId cloudProvider }
      }
      projects { name }
      createdAt
    }
  }
}
"""

SOFTWARE_SUPPLY_CHAIN_QUERY = """
query SoftwareSupplyChainFindings($first: Int, $after: String, $filterBy: SoftwareSupplyChainFindingFilters) {
  softwareSupplyChainFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id severity status
      name
      # SoftwareSupplyChainFinding uses component{Name,Version}; alias to
      # package{Name,Version} so the existing frontend reads (item.packageName /
      # item.packageVersion in wizi.js / builder.js) keep working unchanged.
      packageName: componentName
      packageVersion: componentVersion
      # SoftwareSupplyChainFindingResource is a slim shape — only id/type/name/
      # subscription, no nativeType/region/cloudPlatform/cloudAccount. The
      # frontend already falls back from resource.cloudAccount → resource.subscription
      # and uses `|| ''` for the missing fields, so this renders cleanly.
      resource {
        id type name
        subscription { name externalId cloudProvider }
      }
    }
  }
}
"""

# ---------------------------------------------------------------------------
# Metadata Queries
# ---------------------------------------------------------------------------

PROJECTS_QUERY = """
query ProjectsTable($first: Int, $after: String) {
  projects(first: $first, after: $after) {
    nodes {
      id
      name
      slug
      riskProfile {
        businessImpact
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

CLOUD_ACCOUNTS_QUERY = """
query CloudAccounts($first: Int, $after: String, $filterBy: CloudAccountFilters) {
  cloudAccounts(first: $first, after: $after, filterBy: $filterBy) {
    nodes { id name externalId cloudProvider }
    pageInfo { hasNextPage endCursor }
  }
}
"""

CLOUD_CONFIG_RULES_QUERY = """
query CloudConfigRules($first: Int, $filterBy: CloudConfigurationRuleFilters) {
  cloudConfigurationRules(first: $first, filterBy: $filterBy) {
    nodes { id name shortId }
  }
}
"""

# ---------------------------------------------------------------------------
# Introspection
# ---------------------------------------------------------------------------

SCHEMA_INTROSPECTION_QUERY = """
query {
  __schema {
    queryType {
      fields {
        name
        description
        args { name type { name kind ofType { name kind } } }
      }
    }
  }
}
"""

# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

REJECT_ISSUE_MUTATION = """
mutation UpdateIssues($input: UpdateIssuesInput!) {
  updateIssues(input: $input) {
    issues {
      id
      status
    }
  }
}
"""

# Patch pattern — input: { id, patch: { status, resolutionReason, note } }
IGNORE_CONFIG_FINDING_MUTATION = """
mutation IgnoreConfigFinding($input: UpdateFindingInput!) {
  updateCloudConfigurationFinding(input: $input) {
    configurationFinding { id status }
  }
}
"""

IGNORE_VULN_FINDING_MUTATION = """
mutation IgnoreVulnFinding($input: UpdateFindingInput!) {
  updateVulnerabilityFinding(input: $input) {
    vulnerabilityFinding { id status }
  }
}
"""

IGNORE_HOST_CONFIG_MUTATION = """
mutation IgnoreHostConfig($input: UpdateFindingInput!) {
  updateHostConfigurationRuleAssessment(input: $input) {
    hostConfigurationRuleAssessment { id status }
  }
}
"""

IGNORE_INVENTORY_FINDING_MUTATION = """
mutation IgnoreInventoryFinding($input: UpdateFindingInput!) {
  updateInventoryFinding(input: $input) {
    inventoryFinding { id status }
  }
}
"""

IGNORE_SSC_FINDING_MUTATION = """
mutation IgnoreSscFinding($input: UpdateFindingInput!) {
  updateSoftwareSupplyChainFinding(input: $input) {
    softwareSupplyChainFinding { id status }
  }
}
"""

IGNORE_EXCESSIVE_ACCESS_MUTATION = """
mutation IgnoreExcessiveAccess($input: UpdateExcessiveAccessFindingInput!) {
  updateExcessiveAccessFinding(input: $input) {
    excessiveAccessFinding { id status }
  }
}
"""

# Flat pattern — input: { id, status, resolutionReason, note? }
IGNORE_DATA_FINDING_MUTATION = """
mutation IgnoreDataFinding($input: UpdateDataFindingInput!) {
  updateDataFinding(input: $input) {
    dataFinding { id status }
  }
}
"""

IGNORE_SECRET_INSTANCE_MUTATION = """
mutation IgnoreSecretInstance($input: UpdateSecretInstanceInput!) {
  updateSecretInstance(input: $input) {
    secretInstance { id status }
  }
}
"""

# ---------------------------------------------------------------------------
# Query Type Mapping
# ---------------------------------------------------------------------------

QUERY_TYPE_MAP = {
    "issues": (ISSUES_QUERY, "issues"),
    "configurationFindings": (CONFIG_FINDINGS_QUERY, "configurationFindings"),
    "vulnerabilityFindings": (VULN_FINDINGS_QUERY, "vulnerabilityFindings"),
    "hostConfigurationRuleAssessments": (HOST_CONFIG_QUERY, "hostConfigurationRuleAssessments"),
    "dataFindingsV2": (DATA_FINDINGS_QUERY, "dataFindingsV2"),
    "secretInstances": (SECRET_INSTANCES_QUERY, "secretInstances"),
    "excessiveAccessFindings": (EXCESSIVE_ACCESS_QUERY, "excessiveAccessFindings"),
    "networkExposures": (NETWORK_EXPOSURE_QUERY, "networkExposures"),
    "inventoryFindings": (INVENTORY_FINDINGS_QUERY, "inventoryFindings"),
    "endOfLifeFindings": (VULN_FINDINGS_QUERY, "vulnerabilityFindings"),
    "softwareSupplyChainFindings": (SOFTWARE_SUPPLY_CHAIN_QUERY, "softwareSupplyChainFindings"),
    "malwareFindings": (MALWARE_FINDINGS_QUERY, "malwareFindings"),
}
