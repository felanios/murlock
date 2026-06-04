/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      isolatedModules: true
    }]
  },
  collectCoverageFrom: ['lib/**/*.ts'],
  coverageDirectory: './coverage',
  // Per-file thresholds for code fully exercised by the Redis-free unit suite.
  // These hold without a live Redis and only increase once the integration /
  // e2e suites (which need Redis) run in CI. A global threshold should be added
  // alongside a CI job that provides a Redis service.
  coverageThreshold: {
    './lib/decorators/murlock.decorator.ts': {
      statements: 90,
      branches: 80,
      functions: 95,
      lines: 90,
    },
    './lib/als/als.service.ts': {
      statements: 95,
      branches: 70,
      functions: 95,
      lines: 95,
    },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/lib/$1'
  },
  testPathIgnorePatterns: ['/node_modules/'],
  globals: {
    'ts-jest': {
      isolatedModules: true
    }
  },
  moduleDirectories: ['node_modules', 'src']
};
