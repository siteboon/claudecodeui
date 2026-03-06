export const PRD_TEMPLATE = `# Product Requirements Document

## 1. Overview
- Product Name:
- Owner:
- Last Updated:
- Version:

Describe what problem this product solves and who it serves.

## 2. Objectives
- Primary objective:
- Secondary objective:
- Out-of-scope:

## 3. User Stories
- As a <role>, I want <capability>, so that <benefit>.
- As a <role>, I want <capability>, so that <benefit>.

## 4. Functional Requirements
### Core Requirements
- Requirement 1
- Requirement 2

### Edge Cases
- Edge case 1
- Edge case 2

## 5. Non-Functional Requirements
- Performance:
- Security:
- Reliability:
- Accessibility:

## 6. Success Metrics
- Metric 1:
- Metric 2:

## 7. Technical Notes
- Architecture constraints:
- Dependencies:
- Integration points:

## 8. Release Plan
### Milestone 1
- Scope:
- Exit criteria:

### Milestone 2
- Scope:
- Exit criteria:

## 9. Risks and Mitigations
- Risk:
  - Impact:
  - Mitigation:

## 10. Open Questions
- Question 1
- Question 2
`;

export const PRD_DOCS_URL =
  'https://github.com/eyaltoledano/claude-task-master/blob/main/docs/examples.md';

export const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*]/g;
export const PRD_EXTENSION_PATTERN = /\.(txt|md)$/i;
