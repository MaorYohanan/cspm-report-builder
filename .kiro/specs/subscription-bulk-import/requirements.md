# Requirements Document

## Introduction

This feature adds a bulk import capability to the CSPM Report Builder. The user provides a subscription (cloud account) name, and the system automatically collects all issues and findings with severity HIGH and above across all 9 Wiz query types. The collected findings are presented in a unified results view where the user can review, select, and import them into the report's "ממצאים שנוספו" (added findings) list in a single action.

Currently, the app supports fetching findings one query type at a time via the Wizi tab, requiring the user to manually switch query types, fetch, and import. This feature streamlines the workflow by aggregating all high-severity findings for a subscription in one operation.

## Glossary

- **Bulk_Import_Engine**: The client-side JavaScript module responsible for orchestrating the multi-query-type fetch, aggregating results, and presenting them for selection
- **Backend_Proxy**: The Flask backend (`app.py`) that proxies GraphQL requests to the Wiz API with OAuth2 authentication
- **Subscription_Resolver**: The backend logic that resolves a subscription name string into cloud account UUIDs and externalIds used for filtering across different query types
- **Findings_Store**: The client-side JavaScript `findings[]` array that holds all report findings
- **Import_Mapper**: The set of existing `import*Finding()` functions in `builder.js` that map Wiz API response objects to the internal finding object shape
- **Results_Panel**: The UI area within the Wizi tab that displays the aggregated bulk import results for user review and selection
- **Query_Type**: One of the 9 Wiz GraphQL query categories (issues, configurationFindings, vulnerabilityFindings, hostConfigurationRuleAssessments, dataFindingsV2, secretInstances, excessiveAccessFindings, networkExposures, inventoryFindings)

## Requirements

### Requirement 1: Subscription Input and Validation

**User Story:** As a security consultant, I want to enter a subscription name to initiate a bulk import, so that I can quickly gather all high-severity findings for a specific cloud account.

#### Acceptance Criteria

1. THE Bulk_Import_Engine SHALL provide a text input field for the user to enter a subscription name
2. WHEN the user submits an empty subscription name, THE Bulk_Import_Engine SHALL display a validation error message in Hebrew indicating that a subscription name is required
3. WHEN the user submits a subscription name, THE Subscription_Resolver SHALL resolve the name to cloud account UUIDs and externalIds using the existing `cloudAccounts` GraphQL query
4. IF the Subscription_Resolver fails to resolve the subscription name to any cloud account, THEN THE Bulk_Import_Engine SHALL display a warning message indicating the subscription was not found

### Requirement 2: Multi-Query-Type Fetching

**User Story:** As a security consultant, I want the system to automatically query all relevant Wiz query types for a given subscription, so that I get a comprehensive view of all high-severity findings without manually switching between query types.

#### Acceptance Criteria

1. WHEN the user initiates a bulk import, THE Backend_Proxy SHALL query all 9 Query_Types (issues, configurationFindings, vulnerabilityFindings, hostConfigurationRuleAssessments, dataFindingsV2, secretInstances, excessiveAccessFindings, networkExposures, inventoryFindings) filtered by the resolved subscription
2. THE Backend_Proxy SHALL filter results to severity HIGH and CRITICAL for each Query_Type
3. THE Backend_Proxy SHALL filter results to OPEN and IN_PROGRESS status (or FAIL for configurationFindings) for each Query_Type
4. WHILE the bulk import fetch is in progress, THE Bulk_Import_Engine SHALL display a progress indicator showing which Query_Type is currently being fetched and how many results have been collected so far
5. IF a single Query_Type fetch fails, THEN THE Bulk_Import_Engine SHALL continue fetching the remaining Query_Types and display a warning for the failed type
6. THE Backend_Proxy SHALL apply the correct subscription filter field mapping for each Query_Type as defined in the existing filter logic (UUID-based for issues, configurationFindings, hostConfigurationRuleAssessments, inventoryFindings; externalId-based for vulnerabilityFindings, dataFindingsV2, secretInstances, networkExposures; client-side filtering for excessiveAccessFindings)

### Requirement 3: Aggregated Results Display

**User Story:** As a security consultant, I want to see all collected findings in a single unified view grouped by query type, so that I can review and decide which findings to import.

#### Acceptance Criteria

1. WHEN the bulk import fetch completes, THE Results_Panel SHALL display all collected findings in a table with columns for: selection checkbox, query type, severity, title/name, and resource/subscription info
2. THE Results_Panel SHALL display the total count of collected findings and a breakdown count per Query_Type
3. THE Results_Panel SHALL display severity using the existing severity chip styling (sev-critical, sev-high CSS classes)
4. THE Results_Panel SHALL provide a "select all" checkbox to toggle selection of all displayed findings
5. THE Results_Panel SHALL provide per-Query_Type section headers that allow collapsing/expanding findings within each type
6. WHEN no findings are collected across all Query_Types, THE Results_Panel SHALL display an empty state message in Hebrew

### Requirement 4: Finding Selection and Import

**User Story:** As a security consultant, I want to select specific findings from the bulk import results and add them to my report, so that I have control over which findings are included.

#### Acceptance Criteria

1. WHEN the user clicks the import button, THE Import_Mapper SHALL convert each selected finding to the internal finding object shape using the existing `import*Finding()` function corresponding to the finding's Query_Type
2. THE Import_Mapper SHALL assign auto-generated IDs (category-prefixed, e.g., CSPM-001) to each imported finding using the existing `generateNextId()` function
3. WHEN the import completes, THE Bulk_Import_Engine SHALL display a success toast message indicating the number of findings imported
4. WHEN the import completes, THE Bulk_Import_Engine SHALL switch the active tab to the "ממצאים שנוספו" (findings list) tab
5. IF a finding with the same Wiz source ID already exists in the Findings_Store, THEN THE Import_Mapper SHALL skip the duplicate and include it in a count of skipped findings reported to the user

### Requirement 5: Bulk Import UI Integration

**User Story:** As a security consultant, I want the bulk import feature to be accessible from the existing Wizi tab, so that I can use it alongside the existing single-query import workflow.

#### Acceptance Criteria

1. THE Bulk_Import_Engine SHALL add a dedicated "ייבוא מרוכז" (Bulk Import) section at the top of the Wizi tab panel, visually separated from the existing single-query controls
2. THE Bulk_Import_Engine SHALL include a clearly labeled button to initiate the bulk import operation
3. WHILE the bulk import fetch is in progress, THE Bulk_Import_Engine SHALL disable the bulk import button to prevent concurrent operations
4. THE Results_Panel SHALL be styled consistently with the existing Wizi results table (dark theme, RTL layout, same font sizes and spacing)
