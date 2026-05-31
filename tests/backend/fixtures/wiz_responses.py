"""
Sample GraphQL response data for Wiz API tests.

This module contains mock response data used in unit tests
for the WizService class.
"""

# OAuth Token Response
OAUTH_TOKEN_RESPONSE = {
    "access_token": "mock_access_token_12345",
    "expires_in": 3600,
    "token_type": "Bearer"
}

# Cloud Accounts - Exact Match
CLOUD_ACCOUNTS_EXACT_MATCH = {
    "data": {
        "cloudAccounts": {
            "nodes": [
                {
                    "id": "account-uuid-1",
                    "name": "prod-subscription-1",
                    "externalId": "123456789012",
                    "cloudProvider": "AWS"
                }
            ],
            "pageInfo": {
                "hasNextPage": False,
                "endCursor": None
            }
        }
    }
}

# Cloud Accounts - Partial Match
CLOUD_ACCOUNTS_PARTIAL_MATCH = {
    "data": {
        "cloudAccounts": {
            "nodes": [
                {
                    "id": "account-uuid-2",
                    "name": "aws-prod-subscription-east",
                    "externalId": "234567890123",
                    "cloudProvider": "AWS"
                },
                {
                    "id": "account-uuid-3",
                    "name": "aws-prod-subscription-west",
                    "externalId": "345678901234",
                    "cloudProvider": "AWS"
                }
            ],
            "pageInfo": {
                "hasNextPage": False,
                "endCursor": None
            }
        }
    }
}

# Cloud Accounts - No Match
CLOUD_ACCOUNTS_NO_MATCH = {
    "data": {
        "cloudAccounts": {
            "nodes": [],
            "pageInfo": {
                "hasNextPage": False,
                "endCursor": None
            }
        }
    }
}

# Issues - Single Page
ISSUES_SINGLE_PAGE = {
    "data": {
        "issues": {
            "totalCount": 2,
            "pageInfo": {
                "hasNextPage": False,
                "endCursor": "cursor-end"
            },
            "nodes": [
                {
                    "id": "issue-1",
                    "severity": "CRITICAL",
                    "status": "OPEN",
                    "description": "Security group allows unrestricted access",
                    "control": {
                        "id": "control-1",
                        "name": "Ensure security groups restrict access"
                    },
                    "sourceRules": [
                        {
                            "id": "rule-1",
                            "name": "EC2-001",
                            "description": "Check security group rules"
                        }
                    ],
                    "projects": [
                        {"id": "proj-1", "name": "Production"}
                    ],
                    "cloudAccounts": [
                        {
                            "id": "account-1",
                            "name": "prod-account",
                            "cloudProvider": "AWS",
                            "externalId": "123456789012"
                        }
                    ],
                    "entitySnapshot": {
                        "name": "sg-12345",
                        "type": "SECURITY_GROUP",
                        "cloudPlatform": "AWS",
                        "region": "us-east-1",
                        "subscriptionName": "prod-account",
                        "subscriptionExternalId": "123456789012",
                        "nativeType": "aws_security_group",
                        "tags": {}
                    },
                    "notes": [],
                    "createdAt": "2024-01-01T00:00:00Z",
                    "updatedAt": "2024-01-02T00:00:00Z"
                },
                {
                    "id": "issue-2",
                    "severity": "HIGH",
                    "status": "OPEN",
                    "description": "S3 bucket is publicly accessible",
                    "control": {
                        "id": "control-2",
                        "name": "Ensure S3 buckets are not publicly accessible"
                    },
                    "sourceRules": [
                        {
                            "id": "rule-2",
                            "name": "S3-001",
                            "description": "Check S3 bucket ACLs"
                        }
                    ],
                    "projects": [
                        {"id": "proj-1", "name": "Production"}
                    ],
                    "cloudAccounts": [
                        {
                            "id": "account-1",
                            "name": "prod-account",
                            "cloudProvider": "AWS",
                            "externalId": "123456789012"
                        }
                    ],
                    "entitySnapshot": {
                        "name": "my-public-bucket",
                        "type": "S3_BUCKET",
                        "cloudPlatform": "AWS",
                        "region": "us-west-2",
                        "subscriptionName": "prod-account",
                        "subscriptionExternalId": "123456789012",
                        "nativeType": "aws_s3_bucket",
                        "tags": {}
                    },
                    "notes": [],
                    "createdAt": "2024-01-03T00:00:00Z",
                    "updatedAt": "2024-01-04T00:00:00Z"
                }
            ]
        }
    }
}

# Configuration Findings - Page 1
CONFIG_FINDINGS_PAGE_1 = {
    "data": {
        "configurationFindings": {
            "totalCount": 750,
            "pageInfo": {
                "hasNextPage": True,
                "endCursor": "cursor-page-1"
            },
            "nodes": [
                {
                    "id": f"finding-{i}",
                    "name": f"Finding {i}",
                    "severity": "HIGH",
                    "result": "FAIL",
                    "status": "OPEN",
                    "rule": {
                        "id": "rule-1",
                        "name": "EC2 Instance Security",
                        "shortId": "EC2-005",
                        "description": "EC2 instance security check",
                        "remediationInstructions": "Apply security patches"
                    },
                    "resource": {
                        "name": f"ec2-instance-{i}",
                        "type": "VIRTUAL_MACHINE",
                        "region": "us-east-1",
                        "nativeType": "aws_ec2_instance",
                        "subscription": {
                            "name": "prod-account",
                            "cloudProvider": "AWS",
                            "externalId": "123456789012"
                        }
                    },
                    "securitySubCategories": [
                        {
                            "title": "Compute Security",
                            "category": {"name": "Security"}
                        }
                    ],
                    "analyzedAt": "2024-01-01T00:00:00Z"
                }
                for i in range(1, 501)
            ]
        }
    }
}

# Configuration Findings - Page 2
CONFIG_FINDINGS_PAGE_2 = {
    "data": {
        "configurationFindings": {
            "totalCount": 750,
            "pageInfo": {
                "hasNextPage": False,
                "endCursor": "cursor-page-2"
            },
            "nodes": [
                {
                    "id": f"finding-{i}",
                    "name": f"Finding {i}",
                    "severity": "HIGH",
                    "result": "FAIL",
                    "status": "OPEN",
                    "rule": {
                        "id": "rule-1",
                        "name": "EC2 Instance Security",
                        "shortId": "EC2-005",
                        "description": "EC2 instance security check",
                        "remediationInstructions": "Apply security patches"
                    },
                    "resource": {
                        "name": f"ec2-instance-{i}",
                        "type": "VIRTUAL_MACHINE",
                        "region": "us-east-1",
                        "nativeType": "aws_ec2_instance",
                        "subscription": {
                            "name": "prod-account",
                            "cloudProvider": "AWS",
                            "externalId": "123456789012"
                        }
                    },
                    "securitySubCategories": [
                        {
                            "title": "Compute Security",
                            "category": {"name": "Security"}
                        }
                    ],
                    "analyzedAt": "2024-01-01T00:00:00Z"
                }
                for i in range(501, 751)
            ]
        }
    }
}

# Issues with Filters
ISSUES_WITH_FILTERS = {
    "data": {
        "issues": {
            "totalCount": 1,
            "pageInfo": {
                "hasNextPage": False,
                "endCursor": None
            },
            "nodes": [
                {
                    "id": "issue-critical-1",
                    "severity": "CRITICAL",
                    "status": "OPEN",
                    "description": "Critical security issue",
                    "control": {
                        "id": "control-1",
                        "name": "Critical Control"
                    },
                    "sourceRules": [
                        {
                            "id": "rule-1",
                            "name": "CRITICAL-001",
                            "description": "Critical rule check"
                        }
                    ],
                    "projects": [
                        {"id": "proj-1", "name": "Production"}
                    ],
                    "cloudAccounts": [
                        {
                            "id": "account-1",
                            "name": "prod-account",
                            "cloudProvider": "AWS",
                            "externalId": "123456789012"
                        }
                    ],
                    "entitySnapshot": {
                        "name": "critical-resource",
                        "type": "RESOURCE",
                        "cloudPlatform": "AWS",
                        "region": "us-east-1",
                        "subscriptionName": "prod-account",
                        "subscriptionExternalId": "123456789012",
                        "nativeType": "aws_resource",
                        "tags": {}
                    },
                    "notes": [],
                    "createdAt": "2024-01-01T00:00:00Z",
                    "updatedAt": "2024-01-02T00:00:00Z"
                }
            ]
        }
    }
}

# GraphQL Error Response
GRAPHQL_ERROR_RESPONSE = {
    "errors": [
        {
            "message": "Authentication failed",
            "extensions": {
                "code": "UNAUTHENTICATED"
            }
        }
    ]
}
