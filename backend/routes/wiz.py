"""
Wiz API routes blueprint.
Handles all /api/wizi/* endpoints for Wiz integration.
"""

from __future__ import annotations

import os
import re
import urllib.error
import sys
import json
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request

from backend.graphql.queries import (
    CLOUD_CONFIG_RULES_QUERY,
    CONFIG_FINDINGS_QUERY,
    DATA_FINDINGS_QUERY,
    END_OF_LIFE_QUERY,
    EXCESSIVE_ACCESS_QUERY,
    HOST_CONFIG_QUERY,
    INVENTORY_FINDINGS_QUERY,
    ISSUES_QUERY,
    NETWORK_EXPOSURE_QUERY,
    PROJECTS_QUERY,
    QUERY_TYPE_MAP,
    SECRET_INSTANCES_QUERY,
    SOFTWARE_SUPPLY_CHAIN_QUERY,
    VULN_FINDINGS_QUERY,
)
from backend.services.wiz_service import WizService

wiz_bp = Blueprint('wiz', __name__, url_prefix='/api/wizi')


def _safe_int(value: object, default: int) -> int:
    """Parse an int from user input without raising on bad values."""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default

# Wiz service configuration
WIZI_CLIENT_ID = os.environ.get("WIZI_CLIENT_ID", "")
WIZI_CLIENT_SECRET = os.environ.get("WIZI_CLIENT_SECRET", "")
WIZI_AUTH_URL = os.environ.get("WIZI_AUTH_URL", "https://auth.app.wiz.io/oauth/token")
WIZI_API_URL = os.environ.get("WIZI_API_URL", "https://api.il1.app.wiz.io/graphql")

# Initialize Wiz service (lazy initialization when credentials are available)
_wiz_service: Optional[WizService] = None


_COMMENT_RE = re.compile(r"#[^\n]*")


def get_wiz_service() -> WizService:
    """Get or create the Wiz service instance."""
    global _wiz_service
    if _wiz_service is None:
        if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
            raise RuntimeError("Wiz credentials not configured")
        if not WIZI_AUTH_URL.startswith("https://"):
            raise RuntimeError(f"WIZI_AUTH_URL must use https://, got: {WIZI_AUTH_URL!r}")
        if not WIZI_API_URL.startswith("https://"):
            raise RuntimeError(f"WIZI_API_URL must use https://, got: {WIZI_API_URL!r}")
        _wiz_service = WizService(
            client_id=WIZI_CLIENT_ID,
            client_secret=WIZI_CLIENT_SECRET,
            api_url=WIZI_API_URL,
            auth_url=WIZI_AUTH_URL,
        )
    return _wiz_service


# Backwards compatibility - keep old query names
WIZI_ISSUES_QUERY = ISSUES_QUERY
WIZI_CONFIG_FINDINGS_QUERY = CONFIG_FINDINGS_QUERY
WIZI_VULN_FINDINGS_QUERY = VULN_FINDINGS_QUERY
WIZI_HOST_CONFIG_QUERY = HOST_CONFIG_QUERY
WIZI_DATA_FINDINGS_QUERY = DATA_FINDINGS_QUERY
WIZI_SECRET_INSTANCES_QUERY = SECRET_INSTANCES_QUERY
WIZI_EXCESSIVE_ACCESS_QUERY = EXCESSIVE_ACCESS_QUERY
WIZI_NETWORK_EXPOSURE_QUERY = NETWORK_EXPOSURE_QUERY
WIZI_INVENTORY_FINDINGS_QUERY = INVENTORY_FINDINGS_QUERY
WIZI_END_OF_LIFE_QUERY = END_OF_LIFE_QUERY
WIZI_SOFTWARE_SUPPLY_CHAIN_QUERY = SOFTWARE_SUPPLY_CHAIN_QUERY
WIZI_PROJECTS_QUERY = PROJECTS_QUERY


@wiz_bp.route("/status")
def api_wizi_status():
    """Check if Wiz integration is configured and reachable."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"enabled": False})
    try:
        wiz = get_wiz_service()
        result = wiz._graphql("query { issues(first: 1) { totalCount } }")
        total = result.get("data", {}).get("issues", {}).get("totalCount", 0)
        return jsonify({"enabled": True, "totalIssues": total})
    except Exception as e:
        return jsonify({"enabled": False, "error": str(e)})


@wiz_bp.route("/projects")
def api_wizi_projects():
    """Fetch available projects from Wizi."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501
    try:
        wiz = get_wiz_service()
        nodes = wiz.fetch_projects()
        return jsonify({"projects": nodes})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@wiz_bp.route("/subscriptions")
def api_wizi_subscriptions():
    """Fetch available subscriptions (cloud accounts) from Wizi."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501
    try:
        wiz = get_wiz_service()
        all_nodes = wiz.fetch_cloud_accounts()
        return jsonify({"subscriptions": all_nodes})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@wiz_bp.route("/graphql", methods=["POST"])
def api_wizi_graphql_proxy():
    """Raw GraphQL proxy for debugging — pass {query, variables}."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501

    data = request.get_json(silent=True) or {}
    query = data.get("query", "")
    variables = data.get("variables", {})
    if not query:
        return jsonify({"error": "No query provided"}), 400

    # Block mutations — strip line comments first so "# bypass\nmutation{}" can't sneak past
    query_no_comments = _COMMENT_RE.sub("", query)
    if re.search(r"\bmutation\b", query_no_comments, re.IGNORECASE):
        return jsonify({"error": "Mutations are not allowed"}), 403

    # Limit query size to prevent abuse
    if len(query) > 10000:
        return jsonify({"error": "Query too large (max 10000 chars)"}), 400

    try:
        wiz = get_wiz_service()
        result = wiz._graphql(query, variables)
        return jsonify(result)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return jsonify({"error": f"Wizi API error: {e.code}", "details": body}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@wiz_bp.route("/discover")
def api_wizi_discover():
    """Discover available root query fields via introspection."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501
    try:
        wiz = get_wiz_service()
        summary = wiz.introspect_schema()
        return jsonify({"fields": summary})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@wiz_bp.route("/introspect-type")
def api_wizi_introspect_type():
    """Introspect a specific GraphQL type or check root query fields.

    Query params:
      type=<TypeName>   — returns inputFields for an input type
      query=1           — returns all root query field names (to check if a query exists)
    """
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501

    type_name = request.args.get("type", "").strip()
    check_query = request.args.get("query", "")

    try:
        wiz = get_wiz_service()
        if check_query:
            # List all root query field names so the caller can check which exist
            q = "{ __schema { queryType { fields(includeDeprecated: true) { name } } } }"
            result = wiz._graphql(q)
            fields = result.get("data", {}).get("__schema", {}).get("queryType", {}).get("fields", [])
            return jsonify({"queryFields": [f["name"] for f in fields]})
        if type_name:
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", type_name):
                return jsonify({"error": "Invalid type name"}), 400
            q = """
            query IntrospectType {
              __type(name: "%s") {
                name kind
                inputFields {
                  name
                  type { name kind ofType { name kind ofType { name kind } } }
                }
              }
            }
            """ % type_name
            result = wiz._graphql(q)
            return jsonify(result.get("data", {}))
        return jsonify({"error": "Provide ?type=TypeName or ?query=1"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@wiz_bp.route("/issues", methods=["POST"])
def api_wizi_issues():
    """Fetch findings from Wizi with optional filters and pagination."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501

    data = request.get_json(silent=True) or {}
    query_type = data.get("queryType", "issues")
    first = min(_safe_int(data.get("first"), 100), 500)
    after = data.get("after") or None
    severity = data.get("severity") or None
    status = data.get("status") or None
    project_id = data.get("project") or None
    subscription_id = data.get("subscription") or None

    variables: Dict[str, Any] = {"first": first}
    if after:
        variables["after"] = after

    # Helper: ensure list
    def as_list(v):
        return v if isinstance(v, list) else [v]

    # Helper: wrap in {equals: [...]} for nested filter objects
    def eq_wrap(v):
        return {"equals": as_list(v)}

    # Resolve subscription search text → cloud account IDs
    wiz = get_wiz_service()
    resolved_sub_ids: list = []
    resolved_sub_ext_ids: list = []
    resolved_sub_names: list = []
    subscription_resolution_failed = False
    if subscription_id:
        try:
            resolved = wiz.resolve_subscription(subscription_id)
            resolved_sub_ids = resolved["ids"]
            resolved_sub_ext_ids = resolved["externalIds"]
            resolved_sub_names = resolved["names"]

            # If still no results, mark as failed for user feedback
            if not resolved_sub_ids and not resolved_sub_ext_ids:
                subscription_resolution_failed = True
        except Exception as e:
            subscription_resolution_failed = True
            # Log error but continue - client-side filter will still apply

    filter_by: Dict[str, Any] = {}
    gql_root_key = None  # override for when gql root key differs from the HTTP response key

    if query_type == "configurationFindings":
        if severity:
            filter_by["severity"] = as_list(severity)
        if status:
            filter_by["result"] = as_list(status)
        if resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": resolved_sub_ids}
        if project_id:
            filter_by.setdefault("resource", {})["projectId"] = as_list(project_id)
        # configurationFindings: project filter via resource.projectId
        gql = WIZI_CONFIG_FINDINGS_QUERY
        root_key = "configurationFindings"

    elif query_type == "vulnerabilityFindings":
        if severity:
            filter_by["severity"] = as_list(severity)
        if status:
            filter_by["status"] = as_list(status)
        if resolved_sub_ext_ids:
            filter_by["subscriptionExternalId"] = resolved_sub_ext_ids
        if project_id:
            filter_by["projectIdV2"] = {"equals": as_list(project_id)}
        gql = WIZI_VULN_FINDINGS_QUERY
        root_key = "vulnerabilityFindings"

    elif query_type == "hostConfigurationRuleAssessments":
        if severity:
            filter_by["severity"] = as_list(severity)
        if status:
            filter_by["status"] = as_list(status)
        if resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": resolved_sub_ids}
        if project_id:
            filter_by.setdefault("resource", {})["projectId"] = as_list(project_id)
        # hostConfigurationRuleAssessments: project filter via resource.projectId
        gql = WIZI_HOST_CONFIG_QUERY
        root_key = "hostConfigurationRuleAssessments"

    elif query_type == "dataFindingsV2":
        if severity:
            filter_by["severity"] = eq_wrap(severity)
        if status:
            filter_by["status"] = eq_wrap(status)
        if resolved_sub_ext_ids:
            filter_by["graphEntityCloudAccount"] = {"equals": resolved_sub_ext_ids}
        if project_id:
            filter_by["projectId"] = as_list(project_id)
        gql = WIZI_DATA_FINDINGS_QUERY
        root_key = "dataFindingsV2"

    elif query_type == "secretInstances":
        if severity:
            filter_by["severity"] = eq_wrap(severity)
        if status:
            filter_by["status"] = eq_wrap(status)
        if resolved_sub_ext_ids:
            filter_by["cloudAccount"] = {"equals": resolved_sub_ext_ids}
        if project_id:
            filter_by["projectId"] = as_list(project_id)
        gql = WIZI_SECRET_INSTANCES_QUERY
        root_key = "secretInstances"

    elif query_type == "excessiveAccessFindings":
        # === DEBUG LOGGING START ===
        print("\n" + "="*80, file=sys.stderr)
        print("[DEBUG EXCESSIVE ACCESS] Filtered Query Request", file=sys.stderr)
        print(f"  subscription_id param: {subscription_id!r}", file=sys.stderr)
        print(f"  resolved_sub_ids: {resolved_sub_ids!r}", file=sys.stderr)
        print(f"  resolved_sub_ext_ids: {resolved_sub_ext_ids!r}", file=sys.stderr)
        print(f"  resolved_sub_names: {resolved_sub_names!r}", file=sys.stderr)
        print(f"  severity param: {severity!r}", file=sys.stderr)
        print(f"  status param: {status!r}", file=sys.stderr)
        print(f"  project_id param: {project_id!r}", file=sys.stderr)
        # === DEBUG LOGGING END ===

        if severity:
            filter_by["severity"] = eq_wrap(severity)
        if status:
            filter_by["status"] = eq_wrap(status)

        # Filter by scope.id.equals (discovered from Wiz browser dev tools)
        if resolved_sub_ids:
            filter_by["scope"] = {"id": {"equals": resolved_sub_ids}}
            print(f"[DEBUG] ✅ Added subscription filter: scope.id.equals = {resolved_sub_ids}", file=sys.stderr)
        else:
            print(f"[DEBUG] ❌ NO subscription filter (no resolved_sub_ids)", file=sys.stderr)

        if project_id:
            filter_by["project"] = as_list(project_id)

        print(f"[DEBUG] Final filter_by: {json.dumps(filter_by, indent=2)}", file=sys.stderr)
        print("="*80 + "\n", file=sys.stderr)

        gql = WIZI_EXCESSIVE_ACCESS_QUERY
        root_key = "excessiveAccessFindings"

    elif query_type == "networkExposures":
        if resolved_sub_ext_ids:
            filter_by["cloudAccount"] = resolved_sub_ext_ids
        if project_id:
            # networkExposures.projectId is a scalar String, not a list
            pid = project_id if isinstance(project_id, str) else project_id[0]
            filter_by["projectId"] = pid
        gql = WIZI_NETWORK_EXPOSURE_QUERY
        root_key = "networkExposures"

    elif query_type == "inventoryFindings":
        if severity:
            filter_by["severity"] = eq_wrap(severity)
        if status:
            filter_by["status"] = eq_wrap(status)
        if resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": {"equals": resolved_sub_ids}}
        if project_id:
            filter_by["projects"] = {"equals": as_list(project_id)}
        gql = WIZI_INVENTORY_FINDINGS_QUERY
        root_key = "inventoryFindings"

    elif query_type == "endOfLifeFindings":
        # EOL findings are vulnerabilityFindings with isEndOfLife=True
        filter_by["isEndOfLife"] = True
        if severity:
            filter_by["severity"] = as_list(severity)
        if status:
            filter_by["status"] = as_list(status)
        if resolved_sub_ext_ids:
            filter_by["subscriptionExternalId"] = resolved_sub_ext_ids
        if project_id:
            filter_by["projectIdV2"] = {"equals": as_list(project_id)}
        gql = WIZI_VULN_FINDINGS_QUERY
        root_key = "endOfLifeFindings"
        gql_root_key = "vulnerabilityFindings"

    elif query_type == "softwareSupplyChainFindings":
        if severity:
            filter_by["severity"] = eq_wrap(severity)
        if status:
            filter_by["status"] = eq_wrap(status)
        # SoftwareSupplyChainFindingFilters has no resource.subscriptionId field —
        # subscription filtering is not supported directly for this query type.
        if project_id:
            filter_by["project"] = {"equals": as_list(project_id)}
        gql = WIZI_SOFTWARE_SUPPLY_CHAIN_QUERY
        root_key = "softwareSupplyChainFindings"

    else:
        # Default: issues
        if severity:
            filter_by["severity"] = as_list(severity)
        if status:
            filter_by["status"] = as_list(status)
        else:
            filter_by["status"] = ["OPEN", "IN_PROGRESS"]
        if project_id:
            filter_by["project"] = project_id if isinstance(project_id, list) else [project_id]
        if subscription_id:
            if resolved_sub_ids:
                filter_by["cloudAccountOrCloudOrganizationId"] = resolved_sub_ids
            else:
                filter_by.setdefault("relatedEntity", {})["subscriptionSearch"] = subscription_id
        gql = WIZI_ISSUES_QUERY
        root_key = "issues"

    if filter_by:
        variables["filterBy"] = filter_by

    try:
        # Use paginated fetch if no "after" cursor (i.e., not manual pagination)
        # This ensures we get ALL findings without 500 limit
        if after is None:
            # Fetch all findings with pagination handled automatically
            all_nodes = wiz.fetch_all_findings_paginated(query_type, filter_by if filter_by else None)

            # === DEBUG: Log actual results for excessiveAccessFindings ===
            if query_type == "excessiveAccessFindings":
                print(f"\n[DEBUG] Fetched {len(all_nodes)} total findings", file=sys.stderr)
                if all_nodes:
                    # Sample first 3 findings to see which subscriptions they belong to
                    print(f"[DEBUG] Sample findings (first 3):", file=sys.stderr)
                    for i, node in enumerate(all_nodes[:3]):
                        principal = node.get("principal", {})
                        cloud_account = principal.get("cloudAccount", {})
                        print(f"  [{i+1}] {node.get('name', 'N/A')}", file=sys.stderr)
                        print(f"      Severity: {node.get('severity')}, Platform: {node.get('cloudPlatform')}", file=sys.stderr)
                        print(f"      Account: {cloud_account.get('name')} (ID: {cloud_account.get('externalId')})", file=sys.stderr)
                print("="*80 + "\n", file=sys.stderr)

            response_data = {
                "queryType": query_type,
                root_key: {
                    "nodes": all_nodes,
                    "totalCount": len(all_nodes),
                    "pageInfo": {
                        "hasNextPage": False,
                        "endCursor": None
                    }
                }
            }
        else:
            # Manual pagination requested - use single page fetch
            result = wiz._graphql(gql, variables)
            if "errors" in result:
                errors = result["errors"] or []
                msg = errors[0].get("message", "GraphQL error") if errors else "GraphQL error"
                return jsonify({"error": msg, "details": errors}), 502

            response_data = {"queryType": query_type, root_key: result.get("data", {}).get(gql_root_key or root_key, {})}

            # === DEBUG: Log results for manual pagination too ===
            if query_type == "excessiveAccessFindings":
                nodes = result.get("data", {}).get(root_key, {}).get("nodes", [])
                print(f"\n[DEBUG] Manual pagination: Fetched {len(nodes)} findings", file=sys.stderr)
                print("="*80 + "\n", file=sys.stderr)

        # Add warning if subscription resolution failed
        if subscription_resolution_failed:
            response_data["warning"] = f"Subscription '{subscription_id}' not found in cloud accounts. Results may be unfiltered."

        return jsonify(response_data)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return jsonify({"error": f"Wizi API error: {e.code}", "details": body}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502


def build_bulk_filter(query_type, sub_ids, sub_ext_ids, sub_names=None):
    """Build a filterBy dict for a given query type with HIGH/CRITICAL severity,
    OPEN/IN_PROGRESS status (or FAIL for configurationFindings), and subscription filter."""
    filter_by = {}
    sub_names = sub_names or []

    # --- Severity filter: Only CRITICAL and HIGH (not MEDIUM or below) ---
    if query_type in ("issues", "configurationFindings", "vulnerabilityFindings", "hostConfigurationRuleAssessments"):
        filter_by["severity"] = ["CRITICAL", "HIGH"]
    elif query_type in ("networkExposures", "excessiveAccessFindings", "endOfLifeFindings"):
        pass  # Non-standard schemas or all severities relevant (EOL findings are often MEDIUM)
    else:
        # dataFindingsV2, secretInstances, inventoryFindings, softwareSupplyChainFindings
        filter_by["severity"] = {"equals": ["CRITICAL", "HIGH"]}

    # --- Status filter ---
    if query_type == "configurationFindings":
        filter_by["result"] = ["FAIL"]
    elif query_type in ("networkExposures", "excessiveAccessFindings"):
        pass  # Non-standard filter schemas (no status field)
    elif query_type in ("issues", "vulnerabilityFindings", "hostConfigurationRuleAssessments", "endOfLifeFindings"):
        filter_by["status"] = ["OPEN", "IN_PROGRESS"]
    else:
        # dataFindingsV2, secretInstances, inventoryFindings, softwareSupplyChainFindings
        filter_by["status"] = {"equals": ["OPEN", "IN_PROGRESS"]}

    # --- Subscription filter (only if IDs are available) ---
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
    elif query_type == "excessiveAccessFindings":
        # ExcessiveAccessFindingFilters uses scope.id.equals for subscription;
        # severity/status are not valid fields in this filter type (causes 400)
        if sub_ids:
            filter_by["scope"] = {"id": {"equals": sub_ids}}
    elif query_type == "networkExposures" and sub_ext_ids:
        filter_by["cloudAccount"] = sub_ext_ids
    elif query_type == "inventoryFindings" and sub_ids:
        filter_by["resource"] = {"subscriptionId": {"equals": sub_ids}}
    elif query_type == "endOfLifeFindings":
        # EOL findings are vulnerabilityFindings with isEndOfLife=True
        filter_by["isEndOfLife"] = True
        if sub_ext_ids:
            filter_by["subscriptionExternalId"] = sub_ext_ids
    # softwareSupplyChainFindings has no resource.subscriptionId filter — skip

    return filter_by


@wiz_bp.route("/bulk-fetch", methods=["POST"])
def api_wizi_bulk_fetch():
    """Fetch findings across all 9 query types for a subscription."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501

    data = request.get_json(silent=True) or {}
    subscription = (data.get("subscription") or "").strip()
    if not subscription:
        return jsonify({"error": "יש להזין שם Subscription"}), 400

    # --- Resolve subscription name → cloud account UUIDs + externalIds ---
    wiz = get_wiz_service()
    resolved = wiz.resolve_subscription(subscription)
    resolved_sub_ids = resolved["ids"]
    resolved_sub_ext_ids = resolved["externalIds"]
    resolved_sub_names = resolved["names"]

    # --- Fetch all 9 query types sequentially ---
    results = {}
    errors = {}

    for query_type, (gql, root_key) in QUERY_TYPE_MAP.items():
        try:
            filter_by = build_bulk_filter(query_type, resolved_sub_ids, resolved_sub_ext_ids, resolved_sub_names)

            # === DEBUG for excessiveAccessFindings ===
            if query_type == "excessiveAccessFindings":
                print(f"\n[DEBUG BULK] Processing {query_type}", file=sys.stderr)
                print(f"[DEBUG BULK] Filter: {json.dumps(filter_by, indent=2)}", file=sys.stderr)

            # Use paginated fetch to get ALL findings without 500 limit
            all_nodes = wiz.fetch_all_findings_paginated(query_type, filter_by)

            # === DEBUG results ===
            if query_type == "excessiveAccessFindings":
                print(f"[DEBUG BULK] Got {len(all_nodes)} findings", file=sys.stderr)
                if all_nodes:
                    sample = all_nodes[0]
                    principal = sample.get("principal", {})
                    cloud_account = principal.get("cloudAccount", {})
                    print(f"[DEBUG BULK] Sample: {sample.get('name')}", file=sys.stderr)
                    print(f"[DEBUG BULK]   Account: {cloud_account.get('name')} ({cloud_account.get('externalId')})", file=sys.stderr)
                print("="*80 + "\n", file=sys.stderr)

            results[query_type] = {
                "nodes": all_nodes,
                "totalCount": len(all_nodes),
            }
        except Exception as e:
            errors[query_type] = str(e)
            # === DEBUG errors ===
            if query_type == "excessiveAccessFindings":
                import traceback
                print(f"\n[DEBUG BULK ERROR] {query_type} failed:", file=sys.stderr)
                print(traceback.format_exc(), file=sys.stderr)
                print("="*80 + "\n", file=sys.stderr)

    return jsonify({
        "results": results,
        "resolvedSubscription": resolved,
        "errors": errors,
    })


@wiz_bp.route("/bulk-fetch-single", methods=["POST"])
def api_wizi_bulk_fetch_single():
    """Fetch findings for a single query type (used for progress tracking)."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501

    data = request.get_json(silent=True) or {}
    subscription = (data.get("subscription") or "").strip()
    query_type = (data.get("queryType") or "").strip()

    if not subscription:
        return jsonify({"error": "יש להזין שם Subscription"}), 400

    if not query_type or query_type not in QUERY_TYPE_MAP:
        return jsonify({"error": f"Invalid query type: {query_type}"}), 400

    try:
        # --- Resolve subscription name → cloud account UUIDs + externalIds ---
        wiz = get_wiz_service()
        resolved = wiz.resolve_subscription(subscription)
        resolved_sub_ids = resolved["ids"]
        resolved_sub_ext_ids = resolved["externalIds"]
        resolved_sub_names = resolved["names"]

        # --- Fetch single query type ---
        filter_by = build_bulk_filter(query_type, resolved_sub_ids, resolved_sub_ext_ids, resolved_sub_names)

        # === DEBUG for excessiveAccessFindings ===
        if query_type == "excessiveAccessFindings":
            print(f"\n[DEBUG SINGLE] bulk-fetch-single for {query_type}", file=sys.stderr)
            print(f"[DEBUG SINGLE] Filter: {json.dumps(filter_by, indent=2)}", file=sys.stderr)

        all_nodes = wiz.fetch_all_findings_paginated(query_type, filter_by)

        # === DEBUG results ===
        if query_type == "excessiveAccessFindings":
            print(f"[DEBUG SINGLE] Got {len(all_nodes)} findings", file=sys.stderr)
            if all_nodes:
                sample = all_nodes[0]
                principal = sample.get("principal", {})
                cloud_account = principal.get("cloudAccount", {})
                print(f"[DEBUG SINGLE] Sample: {sample.get('name')}", file=sys.stderr)
                print(f"[DEBUG SINGLE]   Account: {cloud_account.get('name')} ({cloud_account.get('externalId')})", file=sys.stderr)
            print("="*80 + "\n", file=sys.stderr)

        return jsonify({
            "result": {
                "nodes": all_nodes,
                "totalCount": len(all_nodes),
            },
            "resolvedSubscription": resolved,
        })
    except Exception as e:
        # === DEBUG errors ===
        if query_type == "excessiveAccessFindings":
            import traceback
            print(f"\n[DEBUG SINGLE ERROR] {query_type} failed:", file=sys.stderr)
            print(traceback.format_exc(), file=sys.stderr)
            print("="*80 + "\n", file=sys.stderr)
        return jsonify({"error": str(e)}), 500


@wiz_bp.route("/find-by-id", methods=["POST"])
def api_wizi_find_by_id():
    """Fetch findings from Wizi by ID or rule ID. Returns paginated results for user selection."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501

    data = request.get_json(silent=True) or {}
    finding_id = (data.get("id") or "").strip()
    subscription_filter = (data.get("subscription") or "").strip()
    page_size = _safe_int(data.get("pageSize"), 5)
    page = _safe_int(data.get("page"), 0)
    if not finding_id:
        return jsonify({"error": "No finding ID provided"}), 400

    # Resolve subscription text → cloud account IDs (if provided)
    wiz = get_wiz_service()
    resolved_sub_ids: list = []
    resolved_sub_ext_ids: list = []
    resolved_sub_names: list = []

    if subscription_filter:
        resolved = wiz.resolve_subscription(subscription_filter)
        resolved_sub_ids = resolved["ids"]
        resolved_sub_ext_ids = resolved["externalIds"]
        resolved_sub_names = resolved["names"]

    queries = [
        ("issues", "issues", WIZI_ISSUES_QUERY),
        ("configurationFindings", "configurationFindings", WIZI_CONFIG_FINDINGS_QUERY),
        ("vulnerabilityFindings", "vulnerabilityFindings", WIZI_VULN_FINDINGS_QUERY),
        ("hostConfigurationRuleAssessments", "hostConfigurationRuleAssessments", WIZI_HOST_CONFIG_QUERY),
        ("dataFindingsV2", "dataFindingsV2", WIZI_DATA_FINDINGS_QUERY),
        ("secretInstances", "secretInstances", WIZI_SECRET_INSTANCES_QUERY),
        ("excessiveAccessFindings", "excessiveAccessFindings", WIZI_EXCESSIVE_ACCESS_QUERY),
        ("networkExposures", "networkExposures", WIZI_NETWORK_EXPOSURE_QUERY),
        ("inventoryFindings", "inventoryFindings", WIZI_INVENTORY_FINDINGS_QUERY),
        ("endOfLifeFindings", "vulnerabilityFindings", WIZI_VULN_FINDINGS_QUERY),
        ("softwareSupplyChainFindings", "softwareSupplyChainFindings", WIZI_SOFTWARE_SUPPLY_CHAIN_QUERY),
    ]

    def _add_sub_filter(filter_by: dict, qt: str) -> dict:
        if not subscription_filter:
            return filter_by
        if qt == "issues":
            # Prefer resolved cloud account IDs (exact match) over free-text search
            if resolved_sub_ids:
                filter_by["cloudAccountOrCloudOrganizationId"] = resolved_sub_ids
            else:
                filter_by.setdefault("relatedEntity", {})["subscriptionSearch"] = subscription_filter
        elif qt == "configurationFindings" and resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": resolved_sub_ids}
        elif qt == "vulnerabilityFindings" and resolved_sub_ext_ids:
            filter_by["subscriptionExternalId"] = resolved_sub_ext_ids
        elif qt == "hostConfigurationRuleAssessments" and resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": resolved_sub_ids}
        elif qt == "dataFindingsV2" and resolved_sub_ext_ids:
            filter_by["graphEntityCloudAccount"] = {"equals": resolved_sub_ext_ids}
        elif qt == "secretInstances" and resolved_sub_ext_ids:
            filter_by["cloudAccount"] = {"equals": resolved_sub_ext_ids}
        elif qt == "networkExposures" and resolved_sub_ext_ids:
            filter_by["cloudAccount"] = resolved_sub_ext_ids
        elif qt == "inventoryFindings" and resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": {"equals": resolved_sub_ids}}
        elif qt == "endOfLifeFindings" and resolved_sub_ext_ids:
            filter_by["subscriptionExternalId"] = resolved_sub_ext_ids

        return filter_by

    def _client_side_sub_filter(nodes: list) -> list:
        if not subscription_filter or not nodes:
            return nodes

        # If we resolved actual subscription names, use those for exact matching
        if resolved_sub_names:
            resolved_lower = [n.lower() for n in resolved_sub_names]

            def matches(node: dict) -> bool:
                names = []
                names.append((node.get("entitySnapshot") or {}).get("subscriptionName", ""))
                res = node.get("resource") or {}
                res_sub = res.get("subscription") or {}
                names.append(res_sub.get("name", ""))
                ca = node.get("cloudAccount") or res.get("cloudAccount") or {}
                names.append(ca.get("name", ""))
                principal_ca = (node.get("principal") or {}).get("cloudAccount") or {}
                names.append(principal_ca.get("name", ""))
                return any(n.lower() in resolved_lower for n in names if n)

            return [n for n in nodes if matches(n)]

        # Fallback: token-based fuzzy matching from user input
        needle = subscription_filter.lower()
        tokens = [needle]
        parts = [p.lower() for p in subscription_filter.replace("_", "-").split("-") if len(p) >= 4]
        skip = {"aws", "dev", "prod", "stg", "test", "gcp", "azure"}
        tokens.extend([p for p in parts if p not in skip])

        def matches_fuzzy(node: dict) -> bool:
            names = []
            names.append((node.get("entitySnapshot") or {}).get("subscriptionName", ""))
            res = node.get("resource") or {}
            res_sub = res.get("subscription") or {}
            names.append(res_sub.get("name", ""))
            ca = node.get("cloudAccount") or res.get("cloudAccount") or {}
            names.append(ca.get("name", ""))
            principal_ca = (node.get("principal") or {}).get("cloudAccount") or {}
            names.append(principal_ca.get("name", ""))
            combined = " ".join(n.lower() for n in names if n)
            if not combined:
                return False
            return any(t in combined for t in tokens)

        return [n for n in nodes if matches_fuzzy(n)]

    def _paginate(all_nodes: list, qt: str, total: int) -> dict:
        """Return a page of results with metadata."""
        start = page * page_size
        page_nodes = all_nodes[start:start + page_size]
        return {
            "queryType": qt,
            "nodes": page_nodes,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "hasMore": (start + page_size) < total,
        }

    # Strategy 1: Direct ID filter (works for finding UUIDs)
    for qt, root_key, gql in queries:
        try:
            filter_by: Dict[str, Any] = {"id": finding_id}
            if qt == "endOfLifeFindings":
                filter_by["isEndOfLife"] = True
            filter_by = _add_sub_filter(filter_by, qt)
            variables: Dict[str, Any] = {"first": 1, "filterBy": filter_by}
            result = wiz._graphql(gql, variables)
            if "errors" in result:
                continue
            nodes = result.get("data", {}).get(root_key, {}).get("nodes", [])
            if nodes:
                return jsonify({"queryType": qt, "nodes": nodes, "total": 1, "page": 0, "pageSize": page_size, "hasMore": False})
        except Exception:
            continue

    # For rule-based strategies, fetch more results and filter
    fetch_limit = max(50, (page + 1) * page_size + page_size)

    # Strategy 2: Search by rule ID — issues use sourceRule filter
    try:
        filter_by = {"sourceRule": {"id": [finding_id]}}
        filter_by = _add_sub_filter(filter_by, "issues")
        variables = {"first": fetch_limit, "filterBy": filter_by}
        result = wiz._graphql(WIZI_ISSUES_QUERY, variables)
        nodes = result.get("data", {}).get("issues", {}).get("nodes", [])
        if nodes:
            filtered = _client_side_sub_filter(nodes) if subscription_filter else nodes
            if filtered:
                return jsonify(_paginate(filtered, "issues", len(filtered)))
    except Exception:
        pass

    # Strategy 3: Search config findings by rule ID
    try:
        filter_by = {"rule": {"id": [finding_id]}}
        filter_by = _add_sub_filter(filter_by, "configurationFindings")
        variables = {"first": fetch_limit, "filterBy": filter_by}
        result = wiz._graphql(WIZI_CONFIG_FINDINGS_QUERY, variables)
        nodes = result.get("data", {}).get("configurationFindings", {}).get("nodes", [])
        if nodes:
            filtered = _client_side_sub_filter(nodes) if subscription_filter else nodes
            if filtered:
                return jsonify(_paginate(filtered, "configurationFindings", len(filtered)))
    except Exception:
        pass

    # Strategy 4: Search host config by rule ID
    try:
        filter_by = {"ruleV2": {"id": {"equals": [finding_id]}}}
        filter_by = _add_sub_filter(filter_by, "hostConfigurationRuleAssessments")
        variables = {"first": fetch_limit, "filterBy": filter_by}
        result = wiz._graphql(WIZI_HOST_CONFIG_QUERY, variables)
        nodes = result.get("data", {}).get("hostConfigurationRuleAssessments", {}).get("nodes", [])
        if nodes:
            filtered = _client_side_sub_filter(nodes) if subscription_filter else nodes
            if filtered:
                return jsonify(_paginate(filtered, "hostConfigurationRuleAssessments", len(filtered)))
    except Exception:
        pass

    # Strategy 5: Search by rule shortId (e.g. EC2-005, Custom-Rule-140)
    # Two-step: resolve shortId → rule UUID, then search config findings by rule UUID
    try:
        rule_lookup = wiz._graphql(
            CLOUD_CONFIG_RULES_QUERY,
            {"first": 5, "filterBy": {"shortId": {"equals": [finding_id]}}}
        )
        rule_nodes = rule_lookup.get("data", {}).get("cloudConfigurationRules", {}).get("nodes", [])
        if rule_nodes:
            rule_uuids = [r["id"] for r in rule_nodes]
            filter_by = {"rule": {"id": rule_uuids}}
            filter_by = _add_sub_filter(filter_by, "configurationFindings")
            variables = {"first": fetch_limit, "filterBy": filter_by}
            result = wiz._graphql(WIZI_CONFIG_FINDINGS_QUERY, variables)
            nodes = result.get("data", {}).get("configurationFindings", {}).get("nodes", [])
            if nodes:
                filtered = _client_side_sub_filter(nodes) if subscription_filter else nodes
                if filtered:
                    return jsonify(_paginate(filtered, "configurationFindings", len(filtered)))
    except Exception:
        pass

    # Strategy 6: Free-text search via issues (catches partial matches)
    try:
        filter_by = {"search": finding_id}
        filter_by = _add_sub_filter(filter_by, "issues")
        variables = {"first": fetch_limit, "filterBy": filter_by}
        result = wiz._graphql(WIZI_ISSUES_QUERY, variables)
        nodes = result.get("data", {}).get("issues", {}).get("nodes", [])
        if nodes:
            filtered = _client_side_sub_filter(nodes) if subscription_filter else nodes
            if filtered:
                return jsonify(_paginate(filtered, "issues", len(filtered)))
    except Exception:
        pass

    return jsonify({"error": "Finding not found", "id": finding_id}), 404
