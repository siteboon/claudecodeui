# GitHub Actions Workflows

This directory contains the CI/CD workflows for the Claude Code UI project.

## Current Workflows

### 1. CI Workflow (`ci.yml`)
- **Triggers**: Push to main, pull requests to main
- **Jobs**:
  - **Lint**: ESLint and Prettier formatting checks
  - **Security**: npm audit and security scanning
  - **Build**: Production build verification
  - **Backend Tests**: Jest backend test suite
  - **Frontend Tests**: Jest frontend test suite with React Testing Library
  - **Cross-browser Testing**: Tests across Node.js versions (18, 20, 22)

### 2. Docker Workflow (`docker.yml`)
- **Triggers**: Push to main with release tag
- **Jobs**:
  - **Build and Publish**: Multi-stage Docker builds
  - **Security Scanning**: Container vulnerability scanning

### 3. Performance Workflow (`performance.yml`)
- **Triggers**: Schedule (daily), manual dispatch
- **Jobs**:
  - **Performance Tests**: Load testing and performance benchmarks
  - **Bundle Analysis**: Bundle size monitoring
  - **Lighthouse CI**: Performance and accessibility audits

### 4. Publish Workflow (`publish.yml`)
- **Triggers**: Push to main with version tag
- **Jobs**:
  - **NPM Publish**: Automated package publishing
  - **GitHub Release**: Release creation with changelog

## Setup Instructions

To enable these workflows, create the following files in `.github/workflows/`:

### ci.yml
```yaml
name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  lint:
    name: Lint and Format Check
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Run ESLint
        run: npm run lint
      - name: Check formatting
        run: npm run format -- --check

  security:
    name: Security Audit
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Audit dependencies
        run: npm audit --audit-level high

  build:
    name: Build Application
    runs-on: ubuntu-latest
    needs: [lint, security]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Build application
        run: npm run build
      - name: Upload build artifacts
        uses: actions/upload-artifact@v3
        with:
          name: build-files
          path: dist/

  test-backend:
    name: Backend Tests
    runs-on: ubuntu-latest
    needs: [lint, security]
    strategy:
      matrix:
        node-version: [18.x, 20.x, 22.x]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Run backend tests
        run: npm run test:backend

  test-frontend:
    name: Frontend Tests
    runs-on: ubuntu-latest
    needs: [lint, security]
    strategy:
      matrix:
        node-version: [18.x, 20.x, 22.x]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Run frontend tests
        run: npm run test:frontend
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/lcov.info
```

## Testing Infrastructure

The workflows integrate with our comprehensive testing infrastructure:

- **Frontend Tests**: React Testing Library + Jest with 70% coverage thresholds
- **Backend Tests**: Node.js API testing with Supertest
- **E2E Tests**: Playwright multi-browser testing
- **Accessibility Tests**: ARIA compliance and keyboard navigation
- **Performance Tests**: Bundle analysis and load testing

## Environment Variables

Required secrets for workflows:
- `NPM_TOKEN`: For publishing packages
- `DOCKER_USERNAME`: Docker Hub username
- `DOCKER_PASSWORD`: Docker Hub access token
- `CODECOV_TOKEN`: Code coverage reporting

## Local Development

To test workflows locally:

```bash
# Install act (GitHub Actions runner)
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# Run workflow locally
act -j test
```

## Monitoring

- **Build Status**: GitHub Actions dashboard
- **Coverage Reports**: Codecov integration
- **Performance**: Lighthouse CI reports
- **Security**: Dependabot and npm audit alerts

This setup ensures comprehensive testing, security scanning, and automated deployment for the Claude Code UI project.