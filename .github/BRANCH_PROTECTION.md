# Branch Protection Rules Configuration

This document outlines the recommended branch protection rules for the `main` branch.

## Required Settings

### Status Checks
- **Require status checks to pass before merging**: ✅ Enabled
- **Required status checks**:
  - `lint` - ESLint and Prettier checks
  - `security` - npm audit security scanning
  - `performance` - Build performance and size metrics
  - `test (Node.js 18)` - Node.js 18 compatibility
  - `test (Node.js 20)` - Node.js 20 compatibility
  - `test (Node.js 22)` - Node.js 22 compatibility

### Merge Requirements
- **Require pull request reviews before merging**: ✅ Enabled
  - Required approving reviews: 1
- **Dismiss stale PR approvals when new commits are pushed**: ✅ Enabled
- **Require review from CODEOWNERS**: ❌ Disabled (single maintainer project)
- **Restrict who can dismiss pull request reviews**: ✅ Enabled
- **Require conversations to be resolved before merging**: ✅ Enabled

### Additional Rules
- **Limit who can push to matching branches**: ✅ Enabled
  - Only repository maintainers
- **Allow force pushes**: ❌ Disabled
- **Allow deletions**: ❌ Disabled
- **Require linear history**: ✅ Enabled
- **Require branches to be up to date before merging**: ✅ Enabled

## Auto-merge Configuration

### Automated Merging
- **Auto-merge enabled for**: Dependabot PRs
- **Trigger**: PR labeled with `dependencies`
- **Condition**: All required status checks must pass
- **Merge method**: Merge commit (preserves history)

### Security
- Auto-merge only applies to automated dependency updates from Dependabot
- Human-authored PRs require manual review and merge
- All PRs must pass security scanning before consideration

## Implementation Commands

These settings must be configured manually in the GitHub repository settings:

1. Navigate to: **Settings → Branches → Branch protection rules**
2. Add rule for `main` branch
3. Configure settings as documented above
4. Enable auto-merge for dependabot PRs in **Settings → Actions → General → Allow dependabot actions**