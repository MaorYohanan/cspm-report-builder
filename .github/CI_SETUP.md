# CI/CD Setup Documentation

This document explains the Continuous Integration and Continuous Deployment (CI/CD) pipeline for the CSPM Report Builder project.

## Overview

The CI/CD pipeline automatically validates code quality, runs tests, and builds Docker images on every push and pull request to ensure the application remains stable and deployable.

---

## What the CI/CD Does

### 1. Automated Testing (45+ tests)
- **Backend Tests** — Runs Python unit tests for Flask services, Wiz integration, and report generation
- **Frontend Tests** — Runs JavaScript/Node.js tests with Jest
- **Test Coverage** — Generates coverage reports for both backend and frontend code

### 2. Docker Image Build
- **Build Validation** — Ensures the Docker image builds successfully after all tests pass
- **Build Caching** — Uses GitHub Actions cache to speed up builds
- **Multi-stage Build** — Validates the production-ready Docker image

### 3. Dependency Management
- **Dependabot** — Automatically keeps dependencies up-to-date
  - Python packages checked weekly
  - NPM packages checked weekly
  - GitHub Actions checked monthly
- **Security Updates** — Automatically opens PRs for security vulnerabilities

### 4. Quality Gates
- **Tests must pass** before Docker build runs
- **All jobs must succeed** before a PR can be merged
- **Mock credentials** prevent accidental API calls during testing

---

## Workflow Structure

### CI/CD Pipeline (`ci.yml`)

```yaml
Trigger: Push to main OR Pull Request to main

Jobs:
  1. test-backend (Python 3.12)
     - Install dependencies
     - Run pytest with coverage
     - Upload coverage report

  2. test-frontend (Node.js 20)
     - Install dependencies
     - Run npm test with coverage
     - Upload coverage report

  3. docker-build (depends on test jobs)
     - Build Docker image
     - Validate multi-stage build
     - Use GitHub Actions cache
```

---

## Status Badges

Add these badges to your `README.md` to display CI/CD status:

### CI Pipeline Badge

```markdown
![CI/CD Pipeline](https://github.com/Metoraf007/cspm-report-builder/actions/workflows/ci.yml/badge.svg)
```

### Code Coverage Badge (Codecov Integration)

If you set up Codecov in the future:

```markdown
[![codecov](https://codecov.io/gh/Metoraf007/cspm-report-builder/branch/main/graph/badge.svg)](https://codecov.io/gh/Metoraf007/cspm-report-builder)
```

### Docker Build Badge

```markdown
![Docker](https://img.shields.io/badge/docker-ready-blue)
```

### Combined Example

```markdown
![CI/CD Pipeline](https://github.com/Metoraf007/cspm-report-builder/actions/workflows/ci.yml/badge.svg)
![Python](https://img.shields.io/badge/python-3.12-blue)
![Flask](https://img.shields.io/badge/flask-3.1-green)
![Docker](https://img.shields.io/badge/docker-ready-blue)
```

---

## How to View CI/CD Results

### On GitHub Web Interface

1. **Navigate to Actions Tab**
   ```
   https://github.com/Metoraf007/cspm-report-builder/actions
   ```

2. **View Workflow Runs**
   - See all recent CI/CD runs
   - Green checkmark = success
   - Red X = failure
   - Yellow dot = in progress

3. **View Specific Run Details**
   - Click on any workflow run
   - See individual job results
   - Expand job steps to see detailed logs
   - Download coverage artifacts (available for 7 days)

4. **PR Status Checks**
   - On pull requests, scroll to the bottom
   - See required status checks
   - Click "Details" to view specific job logs

### Re-Running Failed Jobs

**Option 1: Re-run All Jobs**
1. Go to the failed workflow run
2. Click "Re-run all jobs" button (top right)

**Option 2: Re-run Failed Jobs Only**
1. Go to the failed workflow run
2. Click "Re-run failed jobs" button

**Option 3: Re-run from PR**
1. On the pull request page
2. Click "Details" next to the failed check
3. Click "Re-run jobs"

### Debugging Failures

**Step 1: Identify the Failing Job**
- Check which job failed: `test-backend`, `test-frontend`, or `docker-build`

**Step 2: Review Logs**
- Expand the failed step in the job
- Read error messages and stack traces

**Step 3: Reproduce Locally**

For backend test failures:
```bash
# Set up environment
export WIZ_CLIENT_ID=mock
export WIZ_CLIENT_SECRET=mock
export WIZ_TOKEN_URL=https://mock.wiz.io/oauth/token
export WIZ_API_ENDPOINT=https://mock.wiz.io/graphql

# Run tests
pip install -r requirements.txt
pip install pytest-cov
pytest tests/backend/unit/ -v --cov
```

For frontend test failures:
```bash
npm install
npm test
```

For Docker build failures:
```bash
docker build -t cspm-report-builder:test .
```

**Step 4: Check Coverage Artifacts**
- Download coverage reports from the "Artifacts" section
- Review detailed coverage HTML reports locally

---

## Adding Secrets (Future Setup)

When you need real API integration tests (not just mocked tests), you'll need to add secrets to GitHub.

### When Secrets Are Needed

- **Integration Tests** — Testing actual Wiz API connections
- **Deployment** — Pushing Docker images to registries
- **External Services** — Codecov tokens, notification webhooks

### How to Add Secrets

1. **Navigate to Repository Settings**
   ```
   Settings → Secrets and variables → Actions → New repository secret
   ```

2. **Add Required Secrets**

   Example secrets for Wiz API integration:
   - `WIZ_CLIENT_ID` — Your Wiz service account client ID
   - `WIZ_CLIENT_SECRET` — Your Wiz service account secret
   - `WIZ_TOKEN_URL` — Wiz OAuth token endpoint
   - `WIZ_API_ENDPOINT` — Wiz GraphQL API endpoint

3. **Use Secrets in Workflows**

   ```yaml
   env:
     WIZ_CLIENT_ID: ${{ secrets.WIZ_CLIENT_ID }}
     WIZ_CLIENT_SECRET: ${{ secrets.WIZ_CLIENT_SECRET }}
   ```

### Security Best Practices

- **Never commit secrets** to the repository
- **Use separate service accounts** for CI/CD (not personal accounts)
- **Limit secret scope** to only what the CI/CD needs
- **Rotate secrets regularly** (every 90 days minimum)
- **Use environment protection rules** for production deployments
- **Audit secret usage** through GitHub Actions logs
- **Delete secrets** when no longer needed

### Secret Alternatives

For public repositories or open-source contributions:

- **Repository Variables** — For non-sensitive configuration (API endpoints, URLs)
- **Environment Files** — For local development (`.env.example` as template)
- **Mock Services** — For testing without real credentials (current approach)

---

## Maintenance

### Dependabot Pull Requests

Dependabot automatically opens PRs for dependency updates. Here's how to handle them:

**Weekly PRs (Python & NPM)**
- Review the changelog
- Check for breaking changes
- Merge if tests pass
- Test locally if uncertain

**Monthly PRs (GitHub Actions)**
- Review action changelog
- Check for deprecated features
- Update workflow syntax if needed

**Merge Strategy**
```bash
# Option 1: Merge via GitHub UI
# Click "Squash and merge" on the PR

# Option 2: Merge locally
git checkout main
git pull
gh pr checkout <PR-number>
git checkout main
git merge --squash dependabot/<branch-name>
git commit -m "chore(deps): update dependencies"
git push
```

**Batch Merging**
- If multiple Dependabot PRs are open
- Merge minor/patch updates together
- Test major version updates separately

### Updating Workflow Versions

GitHub Actions should be kept up-to-date. Current versions:

| Action | Current Version | Latest Check |
|--------|----------------|--------------|
| `actions/checkout` | v4 | Monthly (Dependabot) |
| `actions/setup-python` | v5 | Monthly (Dependabot) |
| `actions/setup-node` | v4 | Monthly (Dependabot) |
| `actions/upload-artifact` | v4 | Monthly (Dependabot) |
| `docker/setup-buildx-action` | v3 | Monthly (Dependabot) |
| `docker/build-push-action` | v5 | Monthly (Dependabot) |

**When to Update Manually**
- Security advisories for GitHub Actions
- New features that improve build speed
- Deprecation warnings in workflow logs

**How to Update**
1. Check the action's repository for changes
2. Update version in `.github/workflows/ci.yml`
3. Test the workflow on a branch
4. Merge if successful

### Monitoring CI/CD Health

**Weekly Checks**
- Review failed workflow runs
- Check average build times (should be under 5 minutes)
- Monitor artifact storage usage

**Monthly Checks**
- Review Dependabot PR backlog
- Update pinned action versions
- Clean up old workflow runs if needed

**When to Optimize**
- Build times consistently over 10 minutes
- Test failures becoming common
- Cache hit rate is low

---

## Common Issues and Solutions

### Issue: Tests Pass Locally but Fail in CI

**Cause:** Environment differences (Python/Node versions, missing dependencies)

**Solution:**
```bash
# Match CI environment
pyenv install 3.12
pyenv local 3.12
nvm install 20
nvm use 20

# Clean install
rm -rf venv node_modules
pip install -r requirements.txt
npm ci  # Use ci instead of install for exact versions
```

### Issue: Docker Build Fails but Tests Pass

**Cause:** Missing files, incorrect COPY paths, dependency issues

**Solution:**
```bash
# Test Docker build locally
docker build -t cspm-report-builder:test .

# Check .dockerignore
cat .dockerignore

# Verify required files are included
docker run --rm cspm-report-builder:test ls -la
```

### Issue: Coverage Reports Not Uploading

**Cause:** Artifact upload path incorrect or coverage not generated

**Solution:**
```bash
# Generate coverage locally
pytest --cov --cov-report=xml
ls -la coverage.xml  # Verify file exists

# Check artifact path in workflow
```

### Issue: Dependabot PRs Failing Tests

**Cause:** Breaking changes in dependency updates

**Solution:**
1. Review the dependency changelog
2. Check for deprecated APIs
3. Update code to match new API
4. Pin problematic dependencies if needed

---

## Future Enhancements

### Potential Additions

1. **Code Coverage Enforcement**
   - Add coverage threshold checks
   - Fail builds if coverage drops below X%
   - Integrate Codecov or Coveralls

2. **Linting and Formatting**
   - Add `ruff` or `flake8` for Python
   - Add `eslint` for JavaScript
   - Add `prettier` for code formatting

3. **Security Scanning**
   - Snyk integration for dependency vulnerabilities
   - Trivy for Docker image scanning
   - CodeQL for security analysis

4. **Performance Testing**
   - Add benchmarking tests
   - Track performance metrics over time
   - Alert on performance regressions

5. **Deployment Automation**
   - Auto-deploy to staging on merge to main
   - Manual approval for production
   - Helm chart validation for Kubernetes

6. **Notification Integration**
   - Slack notifications for build failures
   - Email alerts for security issues
   - Discord webhooks for team updates

---

## Resources

- **GitHub Actions Documentation:** https://docs.github.com/en/actions
- **Dependabot Documentation:** https://docs.github.com/en/code-security/dependabot
- **pytest Documentation:** https://docs.pytest.org/
- **Jest Documentation:** https://jestjs.io/
- **Docker Build Best Practices:** https://docs.docker.com/build/building/best-practices/

---

## Getting Help

If you encounter issues with the CI/CD pipeline:

1. **Check workflow logs** for detailed error messages
2. **Reproduce locally** using the same environment (Python 3.12, Node 20)
3. **Review recent commits** that may have broken tests
4. **Open an issue** with workflow run link and error details
5. **Ask in discussions** for community support

---

**Last Updated:** 2026-06-01  
**Maintained By:** Development Team
