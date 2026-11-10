"""Seed ExcludeRule rows (field=title, operator=startsWith). Idempotent.

Dry-run by default; pass --apply to write. Uses DATABASE_URL, else instance/app.db.
BACK UP the database (app.db + -wal/-shm) before --apply.

Matching is case-insensitive startsWith, so a trailing '-' / prefix acts as the
wildcard for autorender suffixes (numbers, timestamps, hashes).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ROLE = "AWS excessive access for role "
PATTERNS = [
    "VPC NACL should not allow unrestricted SSH access",
    "VPC NACL should not allow unrestricted RDP access",
    "Kubelet config file should disable unauthorized access",
    "IAM policy should not allow assume role permission across all services <> Resource: "
    "M-Exec-CPCrossAccountRolePolicy, M-Exec-CFDeployerPolicy, CyberArkPolicyAccountForSCA",
] + [ROLE + r for r in [
    "Dynatrace_monitoring_role",
    "DynatraceApiClientRole",
    "DynatraceLogSubscription",
    "DynatraceDelivery",
    "veeam-worker-role",
    "opswat-scan",
    "CGovSSMExecutionRole",
    "CGOV-SSM-Manage-Role",
    "aws_ebs_csi_driver-mygov-prod-eks-",
    "karpenter-node-mygov-prod-eks-",
    "splunk_ec2_iam-prod-role-",
    "WizAccess-Role-Digital",
    "WivAccessRole",
    "terraform-apps-pipeline-role",
    "mygov-prod-eks-1-cluster-",
    "datagov-prod-eks-1-cluster-",
    "KarpenterController-",
    "eks-managed-node-group-eks-node-group-",
    "ecr-secret-updater-mygov-prod-eks-",
    "ecr-secret-updater-datagov-prod-eks-",
    "M-Exec-MiniDeploy-CGov",
    "stacksets-exec-",
    "CGov-Exec-DevOps-prod-role-",
    "lzssrv-SNOW-Prod-DiscoveryMemberAcount-Role",
    "rds-monitoring-role-datagov-prod-aurora-",
]]


def main():
    apply = "--apply" in sys.argv
    from app import app
    from backend.models import db, ExcludeRule

    with app.app_context():
        existing = {(r.field, r.operator, r.pattern.lower()) for r in ExcludeRule.query.all()}
        added = 0
        for p in dict.fromkeys(PATTERNS):
            if ("title", "startsWith", p.lower()) in existing:
                print("exists:", p)
                continue
            print(("add:   " if apply else "would add: ") + p)
            if apply:
                db.session.add(ExcludeRule(field="title", operator="startsWith", pattern=p, active=True))
            added += 1
        if apply:
            db.session.commit()
        print(f"{added} rule(s) {'added' if apply else 'would be added'}")


if __name__ == "__main__":
    main()
