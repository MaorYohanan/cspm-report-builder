"""
Test endpoint to try different filter combinations for excessiveAccessFindings.
This is a diagnostic endpoint to help troubleshoot filtering issues.
"""

from flask import Blueprint, jsonify, request
from backend.services.wiz_service import WizService
from backend.graphql.queries import EXCESSIVE_ACCESS_QUERY
import os

introspect_bp = Blueprint('introspect', __name__, url_prefix='/api/introspect')

WIZI_CLIENT_ID = os.environ.get("WIZI_CLIENT_ID", "")
WIZI_CLIENT_SECRET = os.environ.get("WIZI_CLIENT_SECRET", "")
WIZI_AUTH_URL = os.environ.get("WIZI_AUTH_URL", "https://auth.app.wiz.io/oauth/token")
WIZI_API_URL = os.environ.get("WIZI_API_URL", "https://api.il1.app.wiz.io/graphql")


def get_wiz_service() -> WizService:
    """Get or create WizService instance."""
    return WizService(WIZI_CLIENT_ID, WIZI_CLIENT_SECRET, WIZI_AUTH_URL, WIZI_API_URL)


@introspect_bp.route("/test-excessive-access-filter-direct", methods=["POST"])
def test_excessive_access_filter_direct():
    """
    Test filter by directly providing subscription IDs (bypass resolution).

    Request body:
    {
        "subId": "02df96ec-042e-54ee-8359-8283f1fac0a9",  // Internal Wiz ID
        "externalId": "162133619405",  // AWS account number
        "filterType": "resource" | "cloudAccount" | etc.
    }
    """
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wiz integration not configured"}), 501

    data = request.get_json(silent=True) or {}
    sub_id = data.get("subId", "").strip()
    external_id = data.get("externalId", "").strip()
    filter_type = data.get("filterType", "resource")

    if not sub_id and not external_id:
        return jsonify({"error": "subId or externalId required"}), 400

    try:
        wiz = get_wiz_service()

        # Build filter
        filter_by = {
            "severity": {"equals": ["CRITICAL", "HIGH"]},
            "status": {"equals": ["OPEN", "IN_PROGRESS"]}
        }

        if filter_type == "resource" and sub_id:
            filter_by["resource"] = {"subscriptionId": [sub_id]}
        elif filter_type == "cloudAccount" and external_id:
            filter_by["cloudAccount"] = [external_id]
        elif filter_type == "cloudAccountEquals" and external_id:
            filter_by["cloudAccount"] = {"equals": [external_id]}
        elif filter_type == "subscriptionId" and sub_id:
            filter_by["subscriptionId"] = [sub_id]
        elif filter_type == "none":
            pass

        # Try the query
        variables = {"first": 10, "filterBy": filter_by}
        result = wiz._graphql(EXCESSIVE_ACCESS_QUERY, variables)

        if "errors" in result:
            return jsonify({
                "success": False,
                "filterType": filter_type,
                "filterUsed": filter_by,
                "error": result["errors"]
            }), 200  # Return 200 so we can see the error details

        # Success!
        findings = result.get("data", {}).get("excessiveAccessFindings", {})
        nodes = findings.get("nodes", [])

        return jsonify({
            "success": True,
            "filterType": filter_type,
            "filterUsed": filter_by,
            "resultCount": len(nodes),
            "totalCount": findings.get("totalCount", 0),
            "sampleFindings": [
                {
                    "id": n.get("id"),
                    "name": n.get("name"),
                    "severity": n.get("severity"),
                    "cloudPlatform": n.get("cloudPlatform"),
                    "principal": n.get("principal", {}).get("cloudAccount", {}).get("name")
                }
                for n in nodes[:3]
            ]
        })

    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 502


@introspect_bp.route("/test-excessive-access-filter", methods=["POST"])
def test_excessive_access_filter():
    """
    Test different filter combinations for excessiveAccessFindings.

    Request body should include:
    {
        "subscription": "subscription-name-to-test",
        "filterType": "resource" | "cloudAccount" | "subscriptionId" | "subscriptionExternalId"
    }
    """
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wiz integration not configured"}), 501

    data = request.get_json(silent=True) or {}
    subscription = data.get("subscription", "").strip()
    filter_type = data.get("filterType", "resource")

    if not subscription:
        return jsonify({"error": "subscription parameter required"}), 400

    try:
        wiz = get_wiz_service()

        # Resolve subscription to get IDs
        resolved = wiz.resolve_subscription(subscription)
        sub_ids = resolved.get("ids", [])
        sub_ext_ids = resolved.get("externalIds", [])
        sub_names = resolved.get("names", [])

        if not sub_ids and not sub_ext_ids:
            return jsonify({
                "error": "Subscription not found",
                "searched": subscription
            }), 404

        # Build filter based on type
        filter_by = {
            "severity": {"equals": ["CRITICAL", "HIGH"]},
            "status": {"equals": ["OPEN", "IN_PROGRESS"]}
        }

        if filter_type == "resource" and sub_ids:
            filter_by["resource"] = {"subscriptionId": sub_ids}
        elif filter_type == "cloudAccount" and sub_ext_ids:
            filter_by["cloudAccount"] = sub_ext_ids
        elif filter_type == "cloudAccountEquals" and sub_ext_ids:
            filter_by["cloudAccount"] = {"equals": sub_ext_ids}
        elif filter_type == "subscriptionId" and sub_ids:
            filter_by["subscriptionId"] = sub_ids
        elif filter_type == "subscriptionExternalId" and sub_ext_ids:
            filter_by["subscriptionExternalId"] = sub_ext_ids
        elif filter_type == "none":
            pass  # No subscription filter
        else:
            return jsonify({"error": f"Unknown filterType: {filter_type} or missing IDs"}), 400

        # Try the query
        variables = {"first": 10, "filterBy": filter_by}
        result = wiz._graphql(EXCESSIVE_ACCESS_QUERY, variables)

        if "errors" in result:
            return jsonify({
                "success": False,
                "filterType": filter_type,
                "filterUsed": filter_by,
                "resolvedSubscription": {
                    "ids": sub_ids,
                    "externalIds": sub_ext_ids,
                    "names": sub_names
                },
                "error": result["errors"]
            }), 502

        # Success!
        findings = result.get("data", {}).get("excessiveAccessFindings", {})
        nodes = findings.get("nodes", [])

        return jsonify({
            "success": True,
            "filterType": filter_type,
            "filterUsed": filter_by,
            "resolvedSubscription": {
                "ids": sub_ids,
                "externalIds": sub_ext_ids,
                "names": sub_names
            },
            "resultCount": len(nodes),
            "totalCount": findings.get("totalCount", 0),
            "sampleFindings": [
                {
                    "id": n.get("id"),
                    "name": n.get("name"),
                    "severity": n.get("severity"),
                    "cloudPlatform": n.get("cloudPlatform"),
                    "principal": n.get("principal", {}).get("cloudAccount", {}).get("name")
                }
                for n in nodes[:3]
            ]
        })

    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 502


@introspect_bp.route("/list-subscriptions", methods=["GET"])
def list_subscriptions():
    """List available subscriptions/cloud accounts from Wiz."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wiz integration not configured"}), 501

    try:
        wiz = get_wiz_service()

        # Query for cloud accounts - try with and without filterBy
        from backend.graphql.queries import CLOUD_ACCOUNTS_QUERY

        # Try with empty filterBy first
        try:
            result = wiz._graphql(CLOUD_ACCOUNTS_QUERY, {"first": 100, "filterBy": {}})
        except Exception as e1:
            # If that fails, try without filterBy
            try:
                result = wiz._graphql(CLOUD_ACCOUNTS_QUERY, {"first": 100})
            except Exception as e2:
                return jsonify({
                    "error": "Failed to query cloud accounts",
                    "attempt1": str(e1),
                    "attempt2": str(e2)
                }), 502

        if "errors" in result:
            return jsonify({"error": "GraphQL error", "details": result["errors"]}), 502

        nodes = result.get("data", {}).get("cloudAccounts", {}).get("nodes", [])

        subscriptions = [
            {
                "id": n.get("id"),
                "name": n.get("name"),
                "externalId": n.get("externalId"),
                "cloudProvider": n.get("cloudProvider")
            }
            for n in nodes
        ]

        return jsonify({
            "total": len(subscriptions),
            "subscriptions": subscriptions
        })

    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 502
