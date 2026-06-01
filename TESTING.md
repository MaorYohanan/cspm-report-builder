# Testing Guide

This document describes the testing setup, structure, and workflows for the CSPM Report Builder project.

## Overview

The project uses:
- **Backend**: pytest for Python unit tests
- **Frontend**: Jest for JavaScript/ES6 module tests
- **Coverage**: HTML and text reports for both backend and frontend

## Table of Contents

1. [Backend Testing (pytest)](#backend-testing-pytest)
2. [Frontend Testing (Jest)](#frontend-testing-jest)
3. [Running Tests](#running-tests)
4. [Writing New Tests](#writing-new-tests)
5. [Coverage Requirements](#coverage-requirements)
6. [CI/CD Integration](#cicd-integration)

---

## Backend Testing (pytest)

### Test Structure

Backend tests are organized in `tests/backend/`:

```
tests/
├── backend/
│   ├── fixtures/
│   │   ├── __init__.py
│   │   └── wiz_responses.py         # Mock API responses for Wiz integration
│   └── unit/
│       ├── __init__.py
│       ├── test_ai_service.py        # Tests for GeminiService
│       ├── test_pdf_service.py       # Tests for PDFService
│       └── test_wiz_service.py       # Tests for WizService
└── test_bulk_filter_property.py     # Legacy test (to be moved)
```

### Key Testing Patterns

#### 1. Using pytest Fixtures

Fixtures provide reusable test instances:

```python
import pytest
from backend.services.ai_service import GeminiService

@pytest.fixture
def gemini_service():
    """Create a GeminiService instance for testing."""
    return GeminiService(
        api_key="test-api-key-12345",
        models=["gemini-2.0-flash", "gemini-2.5-flash"],
        timeout=30,
        max_retries=3
    )

def test_improve_text_success(gemini_service):
    # Use the fixture in your test
    result, model = gemini_service.improve_text("test text")
    assert result is not None
```

#### 2. Mocking External Dependencies

Mock HTTP calls, file I/O, and external services:

```python
from unittest.mock import Mock, patch, MagicMock
import urllib.error
import urllib.request

def test_api_call_with_mock():
    mock_response = {"candidates": [{"content": {"parts": [{"text": "result"}]}}]}
    
    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.return_value.__enter__.return_value.read.return_value = \
            json.dumps(mock_response).encode("utf-8")
        
        # Your test code here
        result = service.call_api()
        assert result == "result"
```

#### 3. Testing Error Scenarios

Always test both success and failure paths:

```python
def test_api_error_handling(gemini_service):
    error_body = json.dumps({
        "error": {"code": 400, "message": "Invalid request"}
    })
    
    mock_http_error = urllib.error.HTTPError(
        url="https://api.example.com",
        code=400,
        msg="Bad Request",
        hdrs={},
        fp=BytesIO(error_body.encode("utf-8"))
    )
    
    with patch("urllib.request.urlopen", side_effect=mock_http_error):
        with pytest.raises(RuntimeError, match="API error 400"):
            gemini_service.improve_text(text="test")
```

#### 4. Mocking Playwright for PDF Tests

```python
@patch('backend.services.pdf_service.sync_playwright')
@patch('backend.services.pdf_service.tempfile.TemporaryDirectory')
def test_render_pdf(mock_temp_dir, mock_playwright):
    # Mock temporary directory
    mock_temp_dir.return_value.__enter__.return_value = "/tmp/test"
    
    # Mock browser and page
    mock_browser = MagicMock()
    mock_page = MagicMock()
    mock_browser.new_page.return_value = mock_page
    
    mock_playwright_instance = MagicMock()
    mock_playwright_instance.chromium.launch.return_value = mock_browser
    mock_playwright.return_value.__enter__.return_value = mock_playwright_instance
    
    # Test PDF generation
    result = service.render_pdf(html_content, meta)
    
    assert result is not None
    mock_page.pdf.assert_called_once()
```

### Running Backend Tests

```bash
# Run all backend tests
pytest

# Run specific test file
pytest tests/backend/unit/test_ai_service.py

# Run specific test class
pytest tests/backend/unit/test_ai_service.py::TestImproveText

# Run specific test function
pytest tests/backend/unit/test_ai_service.py::TestImproveText::test_improve_text_success

# Run with verbose output
pytest -v

# Run with coverage
pytest --cov=backend --cov-report=html --cov-report=term

# Run and stop on first failure
pytest -x

# Run only failed tests from last run
pytest --lf

# Show print statements
pytest -s
```

### Backend Coverage

Coverage reports are generated in `htmlcov/` directory:

```bash
# Generate coverage report
pytest --cov=backend --cov-report=html

# View in browser
open htmlcov/index.html  # macOS/Linux
start htmlcov/index.html  # Windows
```

**Coverage targets:**
- **Critical paths**: 90%+ (services, core business logic)
- **Overall project**: 80%+
- **Utility functions**: 70%+

---

## Frontend Testing (Jest)

### Test Structure

Frontend tests are organized in `tests/frontend/`:

```
tests/frontend/
├── setup.js                          # Global test setup
├── __mocks__/
│   └── styleMock.js                  # CSS import mocks
├── __tests__/
│   ├── example.test.js
│   └── wizi/
│       ├── api-client.test.js        # Wiz API client tests
│       ├── bulk-actions.test.js      # Bulk operations tests
│       ├── filters.test.js           # Filter logic tests
│       └── subscription-manager.test.js
└── findings/
    ├── export-handler.test.js        # Export functionality tests
    ├── filter-manager.test.js        # Filter management tests
    ├── renderer.test.js              # DOM rendering tests
    └── sort-manager.test.js          # Sorting logic tests
```

### Configuration

Jest is configured via `jest.config.js`:

```javascript
module.exports = {
  testEnvironment: 'jsdom',              // Browser-like environment
  roots: ['<rootDir>/tests/frontend'],   // Test location
  collectCoverageFrom: [
    'ui/static/js/**/*.js',              // Coverage targets
    '!ui/static/js/**/*.min.js',
    '!**/node_modules/**'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/frontend/setup.js'],
  testTimeout: 10000
};
```

### Key Testing Patterns

#### 1. Mocking Fetch API

All API calls are mocked using global fetch:

```javascript
describe('API Client Tests', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should fetch data successfully', async () => {
    const mockData = { results: [] };
    global.fetch.mockResolvedValueOnce({
      json: async () => mockData
    });

    const result = await apiClient.fetchData();
    
    expect(global.fetch).toHaveBeenCalledWith('/api/endpoint');
    expect(result).toEqual(mockData);
  });
});
```

#### 2. Testing Error Handling

```javascript
it('should handle network errors', async () => {
  global.fetch.mockRejectedValueOnce(new Error('Network error'));

  await expect(apiClient.fetchData()).rejects.toThrow('Network error');
});

it('should handle HTTP errors', async () => {
  global.fetch.mockResolvedValueOnce({
    status: 500,
    json: async () => ({ error: 'Server error' })
  });

  const result = await apiClient.fetchData();
  
  expect(result).toEqual({ error: 'Server error' });
});
```

#### 3. Testing DOM Manipulation

Use @testing-library/dom for DOM testing:

```javascript
import { screen, fireEvent } from '@testing-library/dom';

it('should filter findings on button click', () => {
  document.body.innerHTML = `
    <input id="search" type="text" />
    <button id="filter-btn">Filter</button>
    <div id="results"></div>
  `;

  setupFilterListeners();
  
  const searchInput = document.getElementById('search');
  const filterBtn = document.getElementById('filter-btn');
  
  searchInput.value = 'test';
  fireEvent.click(filterBtn);
  
  expect(document.getElementById('results').textContent).toContain('test');
});
```

#### 4. Testing ES6 Modules

Import functions directly from modules:

```javascript
import { applyFilters, getCurrentFilters } from '../../../static/js/src/findings/filter-manager.js';

describe('filter-manager.js', () => {
  it('should filter by severity', () => {
    const findings = [
      { id: '1', severity: 'critical' },
      { id: '2', severity: 'high' }
    ];
    
    const result = applyFilters(findings, { severity: 'critical' });
    
    expect(result).toHaveLength(1);
    expect(result[0].f.severity).toBe('critical');
  });
});
```

#### 5. Mocking localStorage and sessionStorage

Setup file (`tests/frontend/setup.js`) provides mocks:

```javascript
// Already available in all tests via setup.js
it('should store data in localStorage', () => {
  localStorage.setItem('key', 'value');
  
  expect(localStorage.setItem).toHaveBeenCalledWith('key', 'value');
});

// Reset mocks between tests
beforeEach(() => {
  localStorage.clear.mockClear();
  localStorage.getItem.mockClear();
  localStorage.setItem.mockClear();
});
```

### Running Frontend Tests

```bash
# Run all frontend tests
npm test

# Run in watch mode (reruns on file changes)
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific test pattern
npm test -- --testPathPattern=wizi

# Run specific test file
npm test -- tests/frontend/__tests__/wizi/api-client.test.js

# Update snapshots
npm test -- -u

# Run in verbose mode
npm test -- --verbose

# Run only tests matching a name pattern
npm test -- -t "should filter by severity"
```

### Frontend Coverage

Coverage reports are generated in `coverage/` directory:

```bash
# Generate coverage report
npm run test:coverage

# View in browser
open coverage/lcov-report/index.html  # macOS/Linux
start coverage/lcov-report/index.html  # Windows
```

**Coverage targets:**
- **Core modules**: 85%+ (filters, sorting, rendering)
- **API clients**: 80%+
- **UI components**: 75%+

---

## Writing New Tests

### Adding Backend Tests

1. **Create test file** in `tests/backend/unit/`:
   ```bash
   touch tests/backend/unit/test_new_service.py
   ```

2. **Follow naming convention**: `test_<module_name>.py`

3. **Structure your tests**:
   ```python
   """
   Unit tests for NewService.
   
   Tests cover:
   - Success scenarios
   - Error handling
   - Edge cases
   """
   
   import pytest
   from unittest.mock import Mock, patch
   from backend.services.new_service import NewService
   
   
   @pytest.fixture
   def service():
       return NewService()
   
   
   class TestNewServiceMethod:
       """Tests for specific method."""
       
       def test_success_case(self, service):
           result = service.method()
           assert result is not None
       
       def test_error_case(self, service):
           with pytest.raises(ValueError):
               service.method(invalid_input)
   ```

4. **Run your new tests**:
   ```bash
   pytest tests/backend/unit/test_new_service.py -v
   ```

### Adding Frontend Tests

1. **Create test file** in appropriate directory:
   ```bash
   touch tests/frontend/findings/new-feature.test.js
   ```

2. **Follow naming convention**: `<module-name>.test.js`

3. **Structure your tests**:
   ```javascript
   /**
    * Tests for new-feature.js module
    */
   
   import { featureFunction } from '../../../static/js/src/findings/new-feature.js';
   
   describe('new-feature.js', () => {
     beforeEach(() => {
       // Setup before each test
     });
   
     afterEach(() => {
       // Cleanup after each test
     });
   
     describe('featureFunction', () => {
       it('should handle normal case', () => {
         const result = featureFunction(input);
         expect(result).toBe(expected);
       });
   
       it('should handle edge case', () => {
         const result = featureFunction(edgeInput);
         expect(result).toBe(edgeExpected);
       });
   
       it('should handle errors', () => {
         expect(() => featureFunction(invalid)).toThrow();
       });
     });
   });
   ```

4. **Run your new tests**:
   ```bash
   npm test -- new-feature.test.js
   ```

### Test Best Practices

1. **Descriptive test names**: Use clear, descriptive names that explain what is being tested
2. **Arrange-Act-Assert**: Structure tests with clear setup, execution, and verification phases
3. **One assertion per test**: Focus each test on a single behavior (when practical)
4. **Mock external dependencies**: Always mock APIs, file systems, and external services
5. **Test error paths**: Don't just test the happy path - test error scenarios
6. **Clean up**: Reset mocks and state between tests
7. **Use fixtures**: Reuse common setup code via fixtures (pytest) or beforeEach (Jest)
8. **Document complex tests**: Add comments explaining non-obvious test logic

---

## Coverage Requirements

### Backend Coverage Goals

| Component | Target | Current |
|-----------|--------|---------|
| Services (ai_service.py, pdf_service.py, wiz_service.py) | 90% | TBD |
| API Routes (blueprints) | 80% | TBD |
| Utilities | 70% | TBD |
| Overall Project | 80% | TBD |

### Frontend Coverage Goals

| Component | Target | Current |
|-----------|--------|---------|
| Core modules (filter-manager, sort-manager, renderer) | 85% | TBD |
| API clients (api-client.js) | 80% | TBD |
| UI components | 75% | TBD |
| Overall Project | 75% | TBD |

### Viewing Coverage Reports

**Backend:**
```bash
pytest --cov=backend --cov-report=html --cov-report=term-missing
# View: htmlcov/index.html
```

**Frontend:**
```bash
npm run test:coverage
# View: coverage/lcov-report/index.html
```

### Coverage Configuration

**Backend** - pytest automatically uses inline configuration. For custom config, create `pytest.ini`:

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = 
    --strict-markers
    --cov=backend
    --cov-report=html
    --cov-report=term-missing
    --cov-fail-under=80
```

**Frontend** - Coverage configured in `jest.config.js`:

```javascript
collectCoverageFrom: [
  'ui/static/js/**/*.js',
  '!ui/static/js/**/*.min.js',
  '!**/node_modules/**',
  '!**/vendor/**'
],
coverageThresholds: {
  global: {
    branches: 75,
    functions: 75,
    lines: 75,
    statements: 75
  }
}
```

---

## CI/CD Integration

### Planned CI/CD Pipeline

The following CI/CD integration is planned for future implementation:

#### GitHub Actions Workflow (Planned)

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
      - name: Run pytest
        run: |
          pytest --cov=backend --cov-report=xml --cov-report=term
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm ci
      - name: Run Jest
        run: npm run test:coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

#### Pre-commit Hooks (Planned)

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: pytest
        name: pytest
        entry: pytest
        language: system
        pass_filenames: false
        always_run: true
      
      - id: jest
        name: jest
        entry: npm test --
        language: system
        pass_filenames: false
        always_run: true
```

### Test Automation Checklist

- [ ] Set up GitHub Actions workflow
- [ ] Configure Codecov for coverage reporting
- [ ] Add pre-commit hooks
- [ ] Set up branch protection requiring passing tests
- [ ] Configure automatic test runs on PRs
- [ ] Add coverage badges to README
- [ ] Set up scheduled test runs (nightly)

---

## Quick Reference

### Common Commands

```bash
# Backend
pytest                                    # Run all backend tests
pytest -v                                 # Verbose output
pytest --cov=backend                      # With coverage
pytest tests/backend/unit/test_ai_service.py  # Specific file
pytest -k "test_improve"                  # By name pattern
pytest -x                                 # Stop on first failure
pytest --lf                               # Run last failed

# Frontend
npm test                                  # Run all frontend tests
npm run test:watch                        # Watch mode
npm run test:coverage                     # With coverage
npm test -- api-client.test.js            # Specific file
npm test -- -t "should filter"            # By name pattern
npm test -- --verbose                     # Verbose output

# Both
pytest && npm test                        # Run all tests
```

### Debugging Tests

**Backend:**
```bash
# Use pdb for debugging
pytest --pdb                              # Drop into debugger on failure
pytest -s                                 # Show print statements

# In test code:
import pdb; pdb.set_trace()
```

**Frontend:**
```bash
# Use node debugger
node --inspect-brk node_modules/.bin/jest --runInBand

# In test code:
debugger;  // Add breakpoint
```

### Getting Help

- **pytest documentation**: https://docs.pytest.org/
- **Jest documentation**: https://jestjs.io/docs/getting-started
- **Testing Library**: https://testing-library.com/docs/
- **Project issues**: File issues on GitHub with `test` label

---

## Contributing

When adding new features:

1. Write tests FIRST (TDD approach recommended)
2. Ensure tests pass locally before pushing
3. Maintain or improve coverage percentages
4. Document complex test scenarios
5. Update this guide if adding new testing patterns

**Test coverage is not optional** - all PRs must include tests for new functionality.
