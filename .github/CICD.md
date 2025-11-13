# CI/CD Pipeline Documentation

## Overview

This repository implements a comprehensive CI/CD pipeline using GitHub Actions for automated testing, security scanning, performance monitoring, and deployment.

## Workflow Files

### 1. Main CI Pipeline (`.github/workflows/ci.yml`)
**Triggers**: Push to `main`, Pull Requests to `main`

**Jobs**:
- **lint**: ESLint and Prettier formatting checks
- **security**: npm audit for vulnerabilities
- **test**: Matrix testing across Node.js 18, 20, 22 with build verification

### 2. Performance Monitoring (`.github/workflows/performance.yml`)
**Triggers**: Push to `main`, Pull Requests to `main`

**Features**:
- Build time measurement (max 2 minutes)
- Build size analysis (max 50MB)
- PR comments with performance metrics
- Performance regression detection

### 3. Docker Builds (`.github/workflows/docker.yml`)
**Triggers**: Push to `main`, Tags (v*), PRs to `main`

**Features**:
- Multi-stage Docker builds with Node.js 20 Alpine
- Pushes to GitHub Container Registry (GHCR)
- Semantic version tagging
- GitHub Actions cache optimization

### 4. NPM Publishing (`.github/workflows/publish.yml`)
**Triggers**: GitHub releases

**Features**:
- Automated NPM package publishing
- Build verification before publishing
- Provenance attestation
- Requires `NPM_TOKEN` secret

### 5. Auto-merge (`.github/workflows/automerge.yml`)
**Triggers**: Dependabot PRs

**Features**:
- Automatic merging of dependency updates
- Waits for all status checks to pass
- Only applies to Dependabot PRs with `dependencies` label

## Required Secrets

### Repository Secrets
- `NPM_TOKEN`: NPM registry token for package publishing
- `GITHUB_TOKEN`: Automatic, used for registry authentication

### Environment Requirements
- Repository must be public for GHCR pushing
- NPM token must have publish permissions for `@siteboon/claude-code-ui`

## Branch Protection Rules

See [BRANCH_PROTECTION.md](./BRANCH_PROTECTION.md) for detailed configuration.

## Security Configuration

### Dependabot (`.github/dependabot.yml`)
- Weekly dependency updates on Mondays at 06:00 UTC
- Separate tracking for npm packages and GitHub Actions
- Grouped security and minor updates
- Auto-labeling and commit message prefixes

### Security Scanning
- npm audit with high/critical threshold
- Automatic PR creation for vulnerability fixes
- Dependency review integrated

## Performance Metrics

### Build Performance
- **Build time**: < 2 minutes threshold
- **Build size**: < 50MB threshold
- **File-level analysis**: JS and CSS size tracking
- **PR commenting**: Automated performance summaries

### Alerts
- Performance regressions block merges
- Size increases trigger warnings
- Build time escalations documented

## Development Workflow

### Local Development
```bash
# Install dependencies
npm install

# Run linting
npm run lint

# Fix formatting
npm run lint:fix

# Build project
npm run build

# Start development server
npm run dev
```

### PR Process
1. Create feature branch
2. Make changes with proper formatting
3. Ensure all lint checks pass
4. Verify build succeeds
5. Open PR to `main`
6. Wait for CI checks
7. Address any performance or security issues
8. Merge after approval

### Release Process
1. Update version in `package.json`
2. Create GitHub release
3. Automatic NPM publishing
4. Docker image creation
5. Documentation update

## Troubleshooting

### Common Issues
- **Build failures**: Check Node.js compatibility and dependencies
- **Linting errors**: Run `npm run lint:fix` locally
- **Security vulnerabilities**: Update dependencies manually if needed
- **Performance regressions**: Analyze bundle size changes

### Monitoring
- GitHub Actions tab for workflow status
- Pull request comments for performance metrics
- NPM dashboard for package statistics
- Container registry for Docker image tags