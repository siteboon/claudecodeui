/** @type {import('jest').Config} */
export default {
  preset: null,
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/tests/frontend/setup.js', '<rootDir>/tests/frontend/setup-msw.js'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(gif|ttf|eot|svg|png|jpg|jpeg)$': '<rootDir>/tests/frontend/__mocks__/fileMock.js'
  },
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest'
  },
  extensionsToTreatAsEsm: ['.jsx'],
  moduleFileExtensions: ['js', 'jsx', 'json', 'ts', 'tsx'],
  testMatch: [
    '<rootDir>/tests/frontend/**/__tests__/**/*.{js,jsx}',
    '<rootDir>/tests/frontend/**/*.{test,spec}.{js,jsx}',
    '<rootDir>/src/**/__tests__/**/*.{js,jsx}',
    '<rootDir>/src/**/*.{test,spec}.{js,jsx}'
  ],
  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    '!src/**/*.stories.{js,jsx}',
    '!src/**/index.js',
    '!src/main.jsx',
    '!src/vite.config.js',
    '!src/config/constants.js'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  transformIgnorePatterns: [
    'node_modules/(?!(axios|@codemirror|@emotion|@mui|@lezer|@react|w3c-keyname)/)'
  ],
  globals: {
    'ts-jest': {
      useESM: true
    }
  }
};