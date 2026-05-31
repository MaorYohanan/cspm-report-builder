module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests/frontend'],
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  collectCoverageFrom: [
    'ui/static/js/**/*.js',
    '!ui/static/js/**/*.min.js',
    '!**/node_modules/**',
    '!**/vendor/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/frontend/setup.js'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/tests/frontend/__mocks__/styleMock.js'
  },
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(module-that-needs-transform)/)'
  ],
  testTimeout: 10000,
  verbose: true
};
