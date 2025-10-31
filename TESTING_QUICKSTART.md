# Testing Quick Start Guide

## 1. Install Dependencies

```bash
npm install --save-dev vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

## 2. Run Tests

```bash
# Run all tests once
npm test

# Watch mode (recommended during development)
npm test -- --watch

# Interactive UI (great for debugging)
npm run test:ui

# Generate coverage report
npm run test:coverage
```

## 3. View Results

### Terminal Output
Tests will display in the terminal with pass/fail status: