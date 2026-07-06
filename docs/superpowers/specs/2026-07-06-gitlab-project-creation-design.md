# GitLab Project Creation Design

Date: 2026-07-06

## Goal

Create Project supports GitHub and GitLab repositories, including self-hosted GitLab, with the right stored token selected when possible.

## Decision

Keep one clone workflow backed by `git clone`. Separate credentials by type:

- `github_token` for GitHub
- `gitlab_token` for GitLab

GitLab credentials also store a host such as `gitlab.com` or `git.company.com`. Create Project parses the repository URL host and preselects the active GitLab token whose host matches. This is how self-hosted GitLab works even when the hostname does not contain the word `gitlab`.

## UI

Settings gets a GitLab credentials section next to the existing GitHub credentials section.

GitLab credential fields:

- name
- host
- token
- optional description

Create Project keeps one repository URL field. The wizard detects:

- `github.com` HTTPS URLs: show GitHub tokens, using the existing first-token behavior.
- HTTPS URLs whose host matches a stored GitLab credential host: show GitLab tokens and preselect the matching host token.
- HTTPS URLs whose host contains `gitlab`: show GitLab tokens and preselect a matching host token if one exists.
- SSH URLs: hide token selection and use the user's SSH setup.
- Unknown HTTPS URLs: allow a one-off token, but do not show stored provider tokens.

Users can override the preselected token before creating the project.

## Server

The clone service stays provider-neutral internally:

- add a nullable `credential_host` column to `user_credentials`
- accept `repositoryUrl`, `credentialType`, `credentialId`, and `newCredentialToken`
- continue accepting legacy `githubUrl`, `githubTokenId`, and `newGithubToken` query params
- fetch stored credentials from the existing generic credentials table
- inject the selected token into HTTPS clone URLs as it does today

No GitLab API integration is needed for v1.

## Scope

Included:

- GitLab credential storage and listing through existing credentials APIs
- GitLab settings UI
- repository URL provider detection in Create Project
- host-based GitLab token preselection
- manual token override
- compatibility with the current GitHub create-project flow

Excluded:

- GitLab project browser
- repository validation through GitHub or GitLab APIs
- Bitbucket or arbitrary provider credential management
- automatic migration of existing GitHub tokens

## Testing

Add focused tests for:

- GitLab credentials are filtered by `gitlab_token`
- GitLab repository URLs resolve the expected host
- Create Project preselects a matching GitLab host token
- clone service accepts provider-neutral params
- legacy GitHub clone query params still work
