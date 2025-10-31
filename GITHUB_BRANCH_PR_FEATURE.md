# GitHub Branch and PR Creation Feature

## Overview

The `/api/agent` endpoint now supports automatic GitHub branch and pull request creation after the AI agent successfully completes its work. Works with both `githubUrl` (for cloning) and `projectPath` (for existing projects with GitHub remotes).

## Key Features

✅ Works with `githubUrl` OR `projectPath`  
✅ Custom branch names with validation  
✅ Auto-generated branch names  
✅ Handles existing branches gracefully  
✅ Automatic PR creation with generated title/description  
✅ Branch name validation with clear error messages  

## New Parameters

### `branchName` (string, optional)
- **Default:** `null` (auto-generates from message)
- **Description:** Custom branch name to use. If provided, `createBranch` is automatically enabled.
- **Requirements:** Either `githubUrl` OR `projectPath` with a GitHub remote
- **Validation:** Checked against Git naming rules before creation
- **Examples:** `"feature/user-auth"`, `"bugfix/login-error"`, `"refactor/db"`

### `createBranch` (boolean, optional)
- **Default:** `false` (or `true` if `branchName` provided)
- **Description:** Create a new branch after successful agent completion
- **Requirements:** Either `githubUrl` OR `projectPath` with GitHub remote

### `createPR` (boolean, optional)
- **Default:** `false`  
- **Description:** Create a pull request after successful completion
- **Requirements:** Either `githubUrl` OR `projectPath` with GitHub remote

## Usage Examples

### With Existing Project (projectPath)

```bash
curl -X POST "http://localhost:3001/api/agent" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "projectPath": "/home/user/my-project",
    "message": "Refactor auth module",
    "branchName": "refactor/auth",
    "createPR": true
  }'
```

### With GitHub URL

```bash
curl -X POST "http://localhost:3001/api/agent" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "githubUrl": "https://github.com/owner/repo",
    "message": "Add feature",
    "branchName": "feature/new-feature",
    "createPR": true
  }'
```

## Branch Name Validation

Custom branch names are validated **before** creation:

**Invalid Patterns:**
- Cannot start/end with dot (`.`)
- Cannot contain consecutive dots (`..`)
- Cannot contain spaces
- Cannot contain: `~ ^ : ? * [ \`
- Cannot contain `@{`
- Cannot start/end with `/`
- Cannot contain `//`
- Cannot end with `.lock`
- Cannot contain control characters

**Error Response Example:**
```json
{
  "branch": {
    "error": "Invalid branch name: Branch name cannot contain spaces"
  }
}
```

## Existing Branch Handling

**Local Branches:**
- If exists: Checks out existing branch (no error)
- Continues workflow normally

**Remote Branches:**
- If exists: Uses existing branch (no error)  
- Pushes new commits to it

**Pull Requests:**
- If PR exists: GitHub returns error with details
- Error passed to user response

## Troubleshooting

### "Project does not have a GitHub remote configured"
**Cause:** Using `projectPath` without GitHub remote  
**Solution:** Add GitHub remote: `git remote add origin <url>`

### "Invalid branch name: [reason]"
**Cause:** Branch name violates Git naming rules  
**Solution:** Use alphanumeric, hyphens, underscores, forward slashes only

### "Failed to get GitHub remote URL"
**Cause:** Project is not a Git repository  
**Solution:** Initialize git: `git init && git remote add origin <url>`

## Complete Documentation

See `public/api-docs.html` for full API reference with interactive examples.
