/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/integrationTests/**',
    '!src/adapters/expo-sqlite/**',
    '!src/adapters/loki/worker/loki.worker.ts',
    '!src/encryption/nodeCrypto.native.ts',
    '!src/expo.ts',
    '!src/**/index.ts',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        strict: false,
        noImplicitAny: false,
      },
    }],
  },
};
