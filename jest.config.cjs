/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    setupFiles: ['<rootDir>/setupTests.cjs'],
    resetMocks: true,
    randomize: true,
    testMatch: ['<rootDir>/tests/**/*.test.ts'],
};