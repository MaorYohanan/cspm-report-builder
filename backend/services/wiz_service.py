"""
Wiz API Service

A reusable service for interacting with the Wiz security platform API.
Provides methods for fetching security findings, resolving subscriptions,
and managing OAuth authentication.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

_log = logging.getLogger(__name__)

from backend.graphql.queries import (
    CLOUD_ACCOUNTS_QUERY,
    CLOUD_CONFIG_RULES_QUERY,
    CONFIG_FINDINGS_QUERY,
    EXCESSIVE_ACCESS_QUERY,
    HOST_CONFIG_QUERY,
    ISSUES_QUERY,
    PROJECTS_QUERY,
    QUERY_TYPE_MAP,
    VULN_FINDINGS_QUERY,
)


class WizService:
    """
    Service for interacting with the Wiz API.

    Handles OAuth token management, GraphQL queries, pagination,
    and subscription resolution for the Wiz security platform.

    Attributes:
        client_id: OAuth client ID
        client_secret: OAuth client secret
        api_url: GraphQL API endpoint URL
        auth_url: OAuth token endpoint URL
    """

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        api_url: str = "https://api.il1.app.wiz.io/graphql",
        auth_url: str = "https://auth.app.wiz.io/oauth/token",
    ) -> None:
        """
        Initialize the Wiz service.

        Args:
            client_id: OAuth client ID for authentication
            client_secret: OAuth client secret for authentication
            api_url: GraphQL API endpoint (defaults to IL1 region)
            auth_url: OAuth token endpoint
        """
        self.client_id = client_id
        self.client_secret = client_secret
        self.api_url = api_url
        self.auth_url = auth_url
        self._token: Dict[str, Any] = {"access_token": "", "expires_at": 0}

    def _get_token(self) -> str:
        """
        Get a valid OAuth token, refreshing if expired.

        Returns:
            Valid OAuth access token

        Raises:
            urllib.error.HTTPError: If authentication fails
        """
        now = time.time()
        if self._token["access_token"] and self._token["expires_at"] > now + 60:
            return self._token["access_token"]

        payload = urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "audience": "wiz-api",
        }).encode("utf-8")

        req = urllib.request.Request(
            self.auth_url,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        self._token["access_token"] = result["access_token"]
        self._token["expires_at"] = now + result.get("expires_in", 3600)
        return self._token["access_token"]

    def _graphql(self, query: str, variables: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Execute a GraphQL query against the Wiz API.

        Args:
            query: GraphQL query string
            variables: Query variables

        Returns:
            GraphQL response data

        Raises:
            urllib.error.HTTPError: If the API request fails
        """
        token = self._get_token()
        payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
        req = urllib.request.Request(
            self.api_url,
            data=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def resolve_subscription(self, subscription_name: str) -> Dict[str, List[str]]:
        """
        Resolve a subscription name to cloud account IDs and external IDs.

        Performs intelligent search with fallback to partial matching
        if exact match is not found.

        Args:
            subscription_name: Subscription name or partial name to search for

        Returns:
            Dictionary with keys:
                - ids: List of cloud account UUIDs
                - externalIds: List of external IDs (e.g., AWS account numbers)
                - names: List of resolved subscription names
        """
        resolved_ids: List[str] = []
        resolved_ext_ids: List[str] = []
        resolved_names: List[str] = []

        try:
            # Try exact search first
            result = self._graphql(
                CLOUD_ACCOUNTS_QUERY,
                {"first": 100, "filterBy": {"search": subscription_name}}
            )
            nodes = result.get("data", {}).get("cloudAccounts", {}).get("nodes", [])

            # If no exact match, try partial search with significant parts
            if not nodes:
                # Extract meaningful parts (skip common prefixes/suffixes)
                parts = subscription_name.replace("_", "-").split("-")
                significant_parts = [
                    p for p in parts
                    if len(p) >= 4 and p.lower() not in ("aws", "azure", "gcp", "dev", "prod", "test", "stg")
                ]

                if significant_parts:
                    # Try searching with the most significant part
                    for part in significant_parts:
                        result = self._graphql(
                            CLOUD_ACCOUNTS_QUERY,
                            {"first": 100, "filterBy": {"search": part}}
                        )
                        nodes = result.get("data", {}).get("cloudAccounts", {}).get("nodes", [])
                        if nodes:
                            # Filter nodes to only those that contain the original search term
                            nodes = [
                                n for n in nodes
                                if subscription_name.lower() in n.get("name", "").lower()
                            ]
                            if nodes:
                                break

            resolved_ids = [n["id"] for n in nodes if n.get("id")]
            resolved_ext_ids = [n["externalId"] for n in nodes if n.get("externalId")]
            resolved_names = [n["name"] for n in nodes if n.get("name")]

        except Exception:
            pass  # Return empty results on error

        return {
            "ids": resolved_ids,
            "externalIds": resolved_ext_ids,
            "names": resolved_names,
        }

    def fetch_issues(
        self,
        filters: Optional[Dict[str, Any]] = None,
        first: int = 100,
        after: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Fetch issues (legacy findings) from Wiz.

        Args:
            filters: Issue filters (severity, status, project, etc.)
            first: Number of results per page (max 500)
            after: Pagination cursor

        Returns:
            GraphQL response containing issues data with pagination info
        """
        variables: Dict[str, Any] = {"first": min(first, 500)}
        if after:
            variables["after"] = after
        if filters:
            variables["filterBy"] = filters

        result = self._graphql(ISSUES_QUERY, variables)
        return result.get("data", {}).get("issues", {})

    def fetch_all_findings_paginated(
        self,
        query_type: str,
        filters: Optional[Dict[str, Any]] = None,
        page_size: int = 500,
    ) -> List[Dict[str, Any]]:
        """
        Fetch ALL findings of a given type without 500 limit.

        Automatically handles pagination to retrieve all results.
        This method will continue fetching until all pages are retrieved.

        Args:
            query_type: Type of query (e.g., "issues", "configurationFindings")
            filters: Query-specific filters
            page_size: Number of results per page (max 500)

        Returns:
            List of all finding nodes

        Raises:
            ValueError: If query_type is not recognized
        """
        if query_type not in QUERY_TYPE_MAP:
            raise ValueError(f"Unknown query type: {query_type}")

        query, root_key = QUERY_TYPE_MAP[query_type]
        all_nodes: List[Dict[str, Any]] = []
        after: Optional[str] = None

        _filter_rejected = False
        while True:
            variables: Dict[str, Any] = {"first": min(page_size, 500)}
            if after:
                variables["after"] = after
            if filters and not _filter_rejected:
                variables["filterBy"] = filters

            try:
                result = self._graphql(query, variables)
            except urllib.error.HTTPError as http_err:
                if http_err.code != 400:
                    raise
                try:
                    err_body = http_err.read().decode("utf-8", errors="replace")
                except Exception:
                    err_body = "<unreadable>"
                if filters and not _filter_rejected:
                    # Filter schema rejected — retry without filters from the start.
                    # Discard any pages already fetched under the filtered run to avoid
                    # (a) duplicating page-1 rows and (b) returning a silently mixed
                    # filtered/unfiltered dataset.
                    _log.warning(
                        "Wiz 400 for '%s' with filters; dropping filters and "
                        "restarting pagination from page 1. %d nodes from filtered "
                        "pass discarded. err=%s",
                        query_type, len(all_nodes), err_body[:200],
                    )
                    _filter_rejected = True
                    after = None
                    all_nodes = []
                    try:
                        result = self._graphql(query, {"first": min(page_size, 500)})
                    except urllib.error.HTTPError as bare_err:
                        try:
                            bare_body = bare_err.read().decode("utf-8", errors="replace")
                        except Exception:
                            bare_body = err_body
                        raise RuntimeError(
                            f"Wiz 400 for '{query_type}' (query invalid): {bare_body[:400]}"
                        ) from bare_err
                else:
                    # No filters and still 400 — query type unsupported or field names wrong
                    raise RuntimeError(
                        f"Wiz 400 for '{query_type}' (no filter): {err_body[:400]}"
                    ) from http_err

            if "errors" in result:
                errors = result["errors"] or []
                error_msg = errors[0].get("message", "GraphQL error") if errors else "GraphQL error"
                raise RuntimeError(f"GraphQL error: {error_msg}")

            data = result.get("data", {}).get(root_key, {})
            nodes = data.get("nodes", [])
            all_nodes.extend(nodes)

            page_info = data.get("pageInfo", {})
            if not page_info.get("hasNextPage"):
                break

            after = page_info.get("endCursor")

        return all_nodes

    def fetch_projects(self, first: int = 500) -> List[Dict[str, Any]]:
        """
        Fetch available projects from Wiz.

        Args:
            first: Number of results to fetch

        Returns:
            List of project nodes
        """
        result = self._graphql(PROJECTS_QUERY, {"first": first})
        return result.get("data", {}).get("projects", {}).get("nodes", [])

    def fetch_cloud_accounts(
        self,
        first: int = 500,
        search: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Fetch cloud accounts (subscriptions) from Wiz.

        Args:
            first: Number of results to fetch
            search: Optional search filter

        Returns:
            List of cloud account nodes
        """
        variables: Dict[str, Any] = {"first": first}
        if search:
            variables["filterBy"] = {"search": search}

        # Handle pagination for cloud accounts
        all_nodes: List[Dict[str, Any]] = []
        after: Optional[str] = None

        while True:
            if after:
                variables["after"] = after

            result = self._graphql(CLOUD_ACCOUNTS_QUERY, variables)
            data = result.get("data", {}).get("cloudAccounts", {})
            nodes = data.get("nodes", [])
            all_nodes.extend(nodes)

            page_info = data.get("pageInfo", {})
            if not page_info.get("hasNextPage"):
                break

            after = page_info.get("endCursor")

        return all_nodes

    def find_by_rule_short_id(
        self,
        short_id: str,
        subscription_filter: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Find configuration findings by rule short ID (e.g., EC2-005).

        Two-step process:
        1. Resolve shortId to rule UUID
        2. Fetch configuration findings for that rule

        Args:
            short_id: Rule short ID (e.g., "EC2-005", "Custom-Rule-140")
            subscription_filter: Optional subscription name filter

        Returns:
            List of configuration finding nodes
        """
        # Step 1: Resolve shortId to rule UUID
        rule_lookup = self._graphql(
            CLOUD_CONFIG_RULES_QUERY,
            {"first": 5, "filterBy": {"shortId": {"equals": [short_id]}}}
        )
        rule_nodes = rule_lookup.get("data", {}).get("cloudConfigurationRules", {}).get("nodes", [])

        if not rule_nodes:
            return []

        rule_uuids = [r["id"] for r in rule_nodes]

        # Step 2: Build filter for configuration findings
        filter_by: Dict[str, Any] = {"rule": {"id": rule_uuids}}

        # Add subscription filter if provided
        if subscription_filter:
            resolved = self.resolve_subscription(subscription_filter)
            if resolved["ids"]:
                filter_by["resource"] = {"subscriptionId": resolved["ids"]}

        # Fetch findings
        return self.fetch_all_findings_paginated("configurationFindings", filter_by)

    def bulk_fetch_for_subscriptions(
        self,
        subscription_names: List[str],
        progress_cb=None,
    ) -> List[Dict[str, Any]]:
        """
        Fetch all 9 query types for each subscription, one subscription at a time.

        Stamps each finding dict with '_sourceSubscription' and 'queryType'.
        Deduplicates by finding id across subscriptions.
        progress_cb(done, total) is called after each (subscription × queryType) step.
        """
        QUERY_TYPES = [
            "issues",
            "configurationFindings",
            "vulnerabilityFindings",
            "hostConfigurationRuleAssessments",
            "dataFindingsV2",
            "secretInstances",
            "excessiveAccessFindings",
            "networkExposures",
            "endOfLifeFindings",
        ]
        total = len(subscription_names) * len(QUERY_TYPES)
        done = 0
        seen_ids: set = set()
        findings: List[Dict[str, Any]] = []

        for sub_name in subscription_names:
            resolved = self.resolve_subscription(sub_name)
            combined = {
                "ids": resolved.get("ids", []),
                "externalIds": resolved.get("externalIds", []),
            }
            for qtype in QUERY_TYPES:
                try:
                    filter_by = _build_filter_for_bulk(qtype, combined)
                    nodes = self.fetch_all_findings_paginated(qtype, filter_by)
                    for n in nodes:
                        fid = n.get("id")
                        if fid and fid in seen_ids:
                            continue
                        if fid:
                            seen_ids.add(fid)
                        n["queryType"] = qtype
                        n["_sourceSubscription"] = sub_name
                        findings.append(n)
                except Exception as exc:
                    _log.warning(
                        "bulk_fetch skipped %s/%s: %s", sub_name, qtype, exc
                    )
                done += 1
                if progress_cb:
                    progress_cb(done, total)

        return findings

    def introspect_schema(self) -> List[Dict[str, Any]]:
        """
        Introspect the Wiz GraphQL schema to discover available queries.

        Returns:
            List of available query fields with names, descriptions, and args
        """
        from backend.graphql.queries import SCHEMA_INTROSPECTION_QUERY

        result = self._graphql(SCHEMA_INTROSPECTION_QUERY)
        fields = result.get("data", {}).get("__schema", {}).get("queryType", {}).get("fields", [])

        # Return simplified summary
        return [
            {
                "name": f["name"],
                "description": f.get("description", ""),
                "args": [a["name"] for a in f.get("args", [])]
            }
            for f in fields
        ]


def _build_filter_for_bulk(query_type: str, combined: Dict[str, Any]) -> Dict[str, Any]:
    """Build a filterBy dict for bulk fetch (HIGH/CRITICAL, OPEN, subscription-scoped).

    Mirrors build_bulk_filter from backend/routes/wiz.py so pipeline.py
    has no cross-blueprint import dependency.
    """
    sub_ids: List[str] = combined.get("ids", [])
    sub_ext_ids: List[str] = combined.get("externalIds", [])
    filter_by: Dict[str, Any] = {}

    # Severity
    if query_type in (
        "issues", "configurationFindings", "vulnerabilityFindings",
        "hostConfigurationRuleAssessments", "endOfLifeFindings",
    ):
        filter_by["severity"] = ["CRITICAL", "HIGH"]
    elif query_type in ("networkExposures", "excessiveAccessFindings"):
        pass
    else:
        filter_by["severity"] = {"equals": ["CRITICAL", "HIGH"]}

    # Status
    if query_type == "configurationFindings":
        filter_by["result"] = ["FAIL"]
    elif query_type in ("networkExposures", "excessiveAccessFindings"):
        pass
    elif query_type in (
        "issues", "vulnerabilityFindings",
        "hostConfigurationRuleAssessments", "endOfLifeFindings",
    ):
        filter_by["status"] = ["OPEN", "IN_PROGRESS"]
    else:
        filter_by["status"] = {"equals": ["OPEN", "IN_PROGRESS"]}

    # Subscription scope
    if query_type == "issues" and sub_ids:
        filter_by["cloudAccountOrCloudOrganizationId"] = sub_ids
    elif query_type == "configurationFindings" and sub_ids:
        filter_by["resource"] = {"subscriptionId": sub_ids}
    elif query_type == "vulnerabilityFindings" and sub_ext_ids:
        filter_by["subscriptionExternalId"] = sub_ext_ids
    elif query_type == "hostConfigurationRuleAssessments" and sub_ids:
        filter_by["resource"] = {"subscriptionId": sub_ids}
    elif query_type == "dataFindingsV2" and sub_ext_ids:
        filter_by["graphEntityCloudAccount"] = {"equals": sub_ext_ids}
    elif query_type == "secretInstances" and sub_ext_ids:
        filter_by["cloudAccount"] = {"equals": sub_ext_ids}
    elif query_type == "excessiveAccessFindings" and sub_ids:
        filter_by["scope"] = {"id": {"equals": sub_ids}}
    elif query_type == "networkExposures" and sub_ext_ids:
        filter_by["cloudAccount"] = sub_ext_ids
    elif query_type == "endOfLifeFindings":
        filter_by["isEndOfLife"] = True
        if sub_ext_ids:
            filter_by["subscriptionExternalId"] = sub_ext_ids

    return filter_by
