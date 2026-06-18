#!/usr/bin/env python3
"""
Fetch all Kubernetes clusters from the 'awsdigitaloffices' project scope
and export to CSV, including sensor states:
  - connector
  - runtime sensor
  - admission controller
  - audit log collector
"""

import csv
import json
import os
import sys
import time
import urllib.error
from pathlib import Path


def _load_dotenv(path: str = ".env") -> None:
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())
    except FileNotFoundError:
        pass


_load_dotenv()

sys.path.insert(0, str(Path(__file__).parent))
from backend.services.wiz_service import WizService

# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

K8S_CLUSTERS_QUERY = """
query KubernetesClusters($first: Int, $after: String, $filterBy: CloudResourceFilters) {
  cloudResources(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      type
      nativeType
      subscriptionName
      subscriptionExternalId
      graphEntity {
        id
        type
        properties
        projects { id name }
      }
    }
  }
}
"""

TARGET_PROJECT = "awsdigitaloffices"
OUTPUT_FILE    = Path(__file__).parent / "kubernetes_clusters.csv"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def fetch_project_id(svc: WizService, project_name: str) -> str | None:
    projects = svc.fetch_projects(first=500)
    for p in projects:
        if p.get("name", "").lower() == project_name.lower():
            return p["id"]
        if p.get("slug", "").lower() == project_name.lower():
            return p["id"]
    return None


def fetch_all_k8s_clusters(svc: WizService, project_id: str) -> list[dict]:
    all_nodes: list[dict] = []
    after = None
    while True:
        variables: dict = {
            "first": 500,
            "filterBy": {"type": ["KUBERNETES_CLUSTER"], "projectId": [project_id]},
        }
        if after:
            variables["after"] = after
        result = _graphql_with_retry(svc, K8S_CLUSTERS_QUERY, variables)
        if "errors" in result:
            raise RuntimeError(result["errors"][0].get("message", "GraphQL error"))
        data = result.get("data", {}).get("cloudResources", {})
        nodes = data.get("nodes", [])
        all_nodes.extend(nodes)
        print(f"  Fetched {len(all_nodes)} / {data.get('totalCount', '?')} clusters ...", end="\r")
        if not data.get("pageInfo", {}).get("hasNextPage"):
            break
        after = data["pageInfo"]["endCursor"]
    print()
    return all_nodes


def _graphql_with_retry(svc: WizService, query: str, variables: dict | None = None, max_retries: int = 6) -> dict:
    """Execute a GraphQL query with exponential backoff on 429 or network errors."""
    delay = 5.0
    for attempt in range(max_retries):
        try:
            return svc._graphql(query, variables)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries - 1:
                print(f"  Rate limited — waiting {delay:.0f}s ...")
                time.sleep(delay)
                delay = min(delay * 2, 60)
            else:
                raise
        except (TimeoutError, OSError) as e:
            if attempt < max_retries - 1:
                print(f"  Network error ({e}) — waiting {delay:.0f}s ...")
                time.sleep(delay)
                delay = min(delay * 2, 60)
            else:
                raise
    return {}


def fetch_sensor_data_batched(svc: WizService, cluster_ids: list[str]) -> dict[str, dict]:
    """
    Fetch connector / admission-controller / audit-log for all clusters.
    One request per cluster with 429 retry and 0.3s inter-request pause.
    """
    out: dict[str, dict] = {}
    for idx, cid in enumerate(cluster_ids):
        query = f"""query {{
  cluster: kubernetesCluster(id: "{cid}") {{
    id
    connectors {{ name status enabled }}
    admissionController {{ healthStatus }}
    kubernetesAuditLogCollector {{ healthStatus }}
  }}
}}"""
        result = _graphql_with_retry(svc, query)
        out[cid] = (result.get("data") or {}).get("cluster") or {}
        print(f"  sensor meta  {idx+1}/{len(cluster_ids)}", end="\r")
        time.sleep(0.3)
    print()
    return out


def fetch_runtime_sensors_batched(svc: WizService, cluster_ids: list[str]) -> dict[str, dict]:
    """
    Fetch runtime sensor status for all clusters via sensorsGroupedByCluster.
    One request per cluster with 429 retry and 0.3s inter-request pause.
    """
    out: dict[str, dict] = {}
    for idx, cid in enumerate(cluster_ids):
        query = f"""query {{
  group: sensorsGroupedByCluster(first: 1, filterBy: {{ cluster: "{cid}" }}) {{
    nodes {{
      sensors(first: 500) {{
        nodes {{ type status sensorVersion lastSeenAt }}
        totalCount
      }}
    }}
  }}
}}"""
        result = _graphql_with_retry(svc, query)
        nodes = ((result.get("data") or {}).get("group") or {}).get("nodes") or []
        out[cid] = nodes[0] if nodes else {}
        print(f"  runtime sensors {idx+1}/{len(cluster_ids)}", end="\r")
        time.sleep(0.3)
    print()
    return out


# ---------------------------------------------------------------------------
# Flattening
# ---------------------------------------------------------------------------

def summarise_connector(connectors: list[dict]) -> tuple[str, str]:
    """Return (connector_name, connector_status)."""
    if not connectors:
        return ("", "NOT_CONNECTED")
    c = connectors[0]
    status = c.get("status", "")
    if not c.get("enabled"):
        status = "DISABLED"
    return (c.get("name", ""), status)


def summarise_runtime_sensors(sensor_group: dict) -> tuple[str, str, str]:
    """Return (runtime_sensor_status, active/total, latest_version)."""
    sensors_conn = sensor_group.get("sensors") or {}
    nodes = sensors_conn.get("nodes") or []
    total = sensors_conn.get("totalCount", len(nodes))
    if not nodes:
        return ("NOT_INSTALLED", "0/0", "")
    active = [s for s in nodes if s.get("status") == "ACTIVE"]
    status = "ACTIVE" if active else "INACTIVE"
    version = nodes[0].get("sensorVersion", "") if nodes else ""
    return (status, f"{len(active)}/{total}", version)


def flatten_cluster(node: dict, sensor_meta: dict, sensor_runtime: dict) -> dict:
    graph = node.get("graphEntity") or {}
    props = graph.get("properties") or {}
    if isinstance(props, str):
        try:
            props = json.loads(props)
        except Exception:
            props = {}

    projects = ", ".join(p.get("name", "") for p in (graph.get("projects") or []))

    # Connector
    connector_name, connector_status = summarise_connector(
        sensor_meta.get("connectors") or []
    )

    # Runtime sensor
    runtime_status, runtime_count, runtime_version = summarise_runtime_sensors(sensor_runtime)

    # Admission controller
    adm = sensor_meta.get("admissionController") or {}
    adm_status = adm.get("healthStatus", "NOT_INSTALLED")

    # Audit log collector
    alc = sensor_meta.get("kubernetesAuditLogCollector") or {}
    alc_status = alc.get("healthStatus", "NOT_INSTALLED")

    return {
        "id":                        node.get("id", ""),
        "name":                      node.get("name", ""),
        "native_type":               node.get("nativeType", ""),
        "projects":                  projects,
        "subscription_name":         node.get("subscriptionName", ""),
        "subscription_external_id":  node.get("subscriptionExternalId", ""),
        "k8s_version":               props.get("version", props.get("kubernetesVersion", "")),
        "cluster_status":            props.get("status", ""),
        "node_count":                props.get("nodeCount", props.get("nodesCount", "")),
        "region":                    props.get("region", props.get("location", "")),
        # Sensors
        "connector_name":            connector_name,
        "connector_status":          connector_status,
        "runtime_sensor_status":     runtime_status,
        "runtime_sensor_active_of_total": runtime_count,
        "runtime_sensor_version":    runtime_version,
        "admission_controller_status": adm_status,
        "audit_log_collector_status":  alc_status,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    client_id     = os.environ.get("WIZI_CLIENT_ID", "")
    client_secret = os.environ.get("WIZI_CLIENT_SECRET", "")
    api_url       = os.environ.get("WIZI_API_URL", "https://api.il1.app.wiz.io/graphql")
    auth_url      = os.environ.get("WIZI_AUTH_URL", "https://auth.app.wiz.io/oauth/token")

    if not client_id or not client_secret:
        sys.exit("ERROR: WIZI_CLIENT_ID and WIZI_CLIENT_SECRET must be set.")

    svc = WizService(client_id, client_secret, api_url, auth_url)

    print(f"Resolving project '{TARGET_PROJECT}' ...")
    project_id = fetch_project_id(svc, TARGET_PROJECT)
    if not project_id:
        sys.exit(f"ERROR: project '{TARGET_PROJECT}' not found in Wiz.")
    print(f"  Project ID: {project_id}")

    print("Fetching Kubernetes clusters ...")
    clusters = fetch_all_k8s_clusters(svc, project_id)
    print(f"  Total: {len(clusters)} clusters")

    if not clusters:
        print("No clusters found — nothing to export.")
        return

    cluster_ids = [c["id"] for c in clusters]

    print("Fetching connector / admission-controller / audit-log status ...")
    sensor_meta = fetch_sensor_data_batched(svc, cluster_ids)

    print("Fetching runtime sensor status ...")
    sensor_runtime = fetch_runtime_sensors_batched(svc, cluster_ids)

    rows = [
        flatten_cluster(c, sensor_meta.get(c["id"], {}), sensor_runtime.get(c["id"], {}))
        for c in clusters
    ]

    fieldnames = list(rows[0].keys())
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Exported {len(rows)} rows -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
