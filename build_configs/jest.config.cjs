const path = require("path");
const projectRoot = path.resolve(__dirname, "..");

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    rootDir: projectRoot,
    setupFiles: [path.resolve(projectRoot, 'build_configs', 'setupTests.cjs')],
    resetMocks: true,
    randomize: true,
    testMatch: [path.resolve(projectRoot, 'tests', '**', '*.test.ts')],
};