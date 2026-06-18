"""
Test script: Round 8 — Final — check securityCategory/securityFramework values for config findings,
and confirm softwareSupplyChainFindings permission issue.
"""
import json, os, urllib.error, urllib.parse, urllib.request

def load_dotenv(path=".env"):
    if not os.path.exists(path): return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

load_dotenv()
CLIENT_ID     = os.environ["WIZI_CLIENT_ID"]
CLIENT_SECRET = os.environ["WIZI_CLIENT_SECRET"]
API_URL       = os.environ.get("WIZI_API_URL", "https://api.il1.app.wiz.io/graphql")
AUTH_URL      = os.environ.get("WIZI_AUTH_URL", "https://auth.app.wiz.io/oauth/token")
SUB_ID      = "02df96ec-042e-54ee-8359-8283f1fac0a9"

def get_token():
    payload = urllib.parse.urlencode({
        "grant_type": "client_credentials", "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET, "audience": "wiz-api",
    }).encode()
    req = urllib.request.Request(AUTH_URL, data=payload,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())["access_token"]

TOKEN = get_token()

def gql(query, variables=None):
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(API_URL, data=payload,
                                 headers={"Authorization": f"Bearer {TOKEN}",
                                          "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"__http_error": e.code, "body": body[:500]}


# ── Step 1: Get all unique securitySubCategories from MEDIUM configFindings ───

print("="*70)
print("Step 1: All unique security categories in MEDIUM configFindings for M-CGov-Eitam-Prod")

CFG_Q_CATS = """
query($first: Int, $after: String, $filterBy: ConfigurationFindingFilters) {
  configurationFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      securitySubCategories {
        id title
        category { id name framework { id name } }
      }
    }
  }
}
"""

all_nodes = []
after = None
while True:
    vars_ = {"first": 500, "filterBy": {
        "resource": {"subscriptionId": [SUB_ID]},
        "severity": ["MEDIUM"],
        "result": ["FAIL"]
    }}
    if after: vars_["after"] = after
    r = gql(CFG_Q_CATS, vars_)
    data = r.get("data", {}).get("configurationFindings", {})
    all_nodes.extend(data.get("nodes", []))
    pi = data.get("pageInfo", {})
    if not pi.get("hasNextPage"): break
    after = pi.get("endCursor")

print(f"  Total MEDIUM configFindings: {len(all_nodes)}")

# Collect unique categories
categories = {}  # cat_name → {framework, id, count}
sub_cats = {}    # subcat title → count

for n in all_nodes:
    for sc in (n.get("securitySubCategories") or []):
        sub_title = sc.get("title", "?")
        sub_cats[sub_title] = sub_cats.get(sub_title, 0) + 1

        cat = sc.get("category", {}) or {}
        cat_name = cat.get("name", "?")
        fw = (cat.get("framework") or {}).get("name", "?")
        fw_id = (cat.get("framework") or {}).get("id", "?")
        cat_id = cat.get("id", "?")
        key = f"{cat_name} [{fw}]"
        if key not in categories:
            categories[key] = {"cat_id": cat_id, "fw_id": fw_id, "fw": fw, "count": 0}
        categories[key]["count"] += 1

# Show categories sorted by count, highlight supply-chain related
print(f"\n  Top 20 security categories:")
for k, v in sorted(categories.items(), key=lambda x: -x[1]["count"])[:20]:
    marker = "🔗" if any(kw in k.lower() for kw in ["supply", "chain", "sca", "code"]) else "  "
    print(f"  {marker} {k}: {v['count']} findings (cat_id={v['cat_id']}, fw_id={v['fw_id']})")

# Find supply-chain related
supply_cats = {k: v for k, v in categories.items() if any(kw in k.lower() for kw in ["supply", "chain", "sca", "dependency"])}
if supply_cats:
    print(f"\n  ✅ Supply-chain related categories found: {list(supply_cats.keys())}")
    # Try filtering by these categories
    for cat_key, cat_data in supply_cats.items():
        cat_id = cat_data["cat_id"]
        fw_id = cat_data["fw_id"]
        # Try with securityCategory filter
        r = gql("""
query($first: Int, $filterBy: ConfigurationFindingFilters) {
  configurationFindings(first: $first, filterBy: $filterBy) { totalCount }
}
""", {"first": 1, "filterBy": {
            "resource": {"subscriptionId": [SUB_ID]},
            "severity": ["MEDIUM"],
            "result": ["FAIL"],
            "securityCategory": [cat_id]
        }})
        if r.get("errors"):
            print(f"    securityCategory filter error: {r['errors'][0].get('message','')[:100]}")
        else:
            total = r.get("data", {}).get("configurationFindings", {}).get("totalCount", 0)
            print(f"    securityCategory=[{cat_id}]: totalCount={total}")


print("\n" + "="*70)
print("Step 2: softwareSupplyChainFindings — final global check with explicit no-filter")
r = gql("query { softwareSupplyChainFindings(first: 1) { totalCount nodes { id } } }")
print(f"  errors: {r.get('errors')}")
print(f"  totalCount: {r.get('data',{}).get('softwareSupplyChainFindings',{}).get('totalCount')}")


print("\n" + "="*70)
print("Step 3: Try cicdScans for this subscription (CI/CD findings related to supply chain)")
# Check if cicdScans exists and what it returns
r = gql("query { cicdScans(first: 1) { totalCount } }")
if r.get("errors"):
    print(f"  cicdScans error: {r['errors'][0].get('message','')[:100]}")
elif "__http_error" in r:
    print(f"  cicdScans HTTP error: {r['__http_error']}")
else:
    print(f"  cicdScans totalCount: {r.get('data',{}).get('cicdScans',{}).get('totalCount')}")


# Check securedPackages
r = gql("query { securedPackages(first: 1) { totalCount } }")
if r.get("errors"):
    print(f"  securedPackages error: {r['errors'][0].get('message','')[:100]}")
else:
    print(f"  securedPackages totalCount: {r.get('data',{}).get('securedPackages',{}).get('totalCount')}")


print("\n" + "="*70)
print("SUMMARY")
print("  softwareSupplyChainFindings: totalCount=0 globally (service account likely lacks SSC module access)")
print("  configurationFindings MEDIUM+FAIL: 403 (not 17)")
print("  vulnerabilityFindings MEDIUM+OPEN: 2571 (not 17)")
print("  issues MEDIUM+OPEN: 55 (not 17)")
print()
print("  To see SSC findings via API, the Wiz service account needs the 'Software Supply Chain'")
print("  module permission granted in Wiz > Settings > Service Accounts.")

print("\nDone.\n")
