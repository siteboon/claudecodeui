# ChatInterface Tests

## Overview
This directory contains comprehensive unit tests for the ChatInterface component, focusing on the UI/UX improvements made in the modernize-tool-design branch.

## Test Coverage

### 1. Tool Display Minimization (`ChatInterface.test.jsx`)
Tests for the new minimized display of Grep and Glob tools:
- Minimized UI rendering for Grep/Glob tools
- Full display for other tools (Edit, Write, etc.)
- Pattern and path display from tool input
- Results link functionality
- Error handling for invalid JSON

### 2. Tool Result Display
Tests for conditional hiding of tool results:
- Hide results for Edit, Write, ApplyPatch, Bash when no error
- Always show results when there's an error
- Show results for Read and other excluded tools
- Error styling verification

### 3. Tool Input Parsing
Tests for parsing and displaying tool inputs:
- Edit tool with file path, old_string, new_string
- Write tool with file path and content
- TodoWrite with todos array
- Bash tool with command and description
- Graceful handling of invalid JSON

### 4. Enhanced Styling
Tests for visual improvements:
- Gradient backgrounds on tool displays
- Icon styling with shadow effects
- Chevron SVG classes for animation
- Hover states and transitions

### 5. File Open Integration
Tests for file opening functionality:
- Click handlers on file buttons
- Correct file path passing to onFileOpen
- Integration with diff viewer

### 6. Structured Results
Tests for Grep/Glob result formatting:
- File list display
- File count (singular/plural)
- Clickable file items
- Directory path display

### 7. CSS Animations (`index.css.test.js`)
Tests for CSS animation rules:
- Chevron rotation on details[open]
- Transition timing functions
- Group-open variant support
- CSS syntax validation

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with UI
npm run test:ui

# Run with coverage
npm run test:coverage

# Run specific test file
npm test ChatInterface.test.jsx
```

## Test Structure

All tests follow the Arrange-Act-Assert pattern:
1. **Arrange**: Set up test data and mock props
2. **Act**: Render component or trigger interactions
3. **Assert**: Verify expected behavior

## Mocking Strategy

- External dependencies are mocked at the top of test files
- API calls use vi.fn() for verification
- Child components are mocked to isolate testing
- localStorage and other browser APIs are mocked in setupTests.js

## Coverage Goals

- Aim for >90% coverage of changed code
- All conditional branches tested
- Error paths verified
- Edge cases handled

## Writing New Tests

When adding tests:
1. Use descriptive test names: "should [expected behavior] when [condition]"
2. Test one thing per test case
3. Use screen queries from @testing-library/react
4. Prefer user-centric queries (getByRole, getByText)
5. Mock only what's necessary
6. Clean up after tests (handled by setupTests.js)