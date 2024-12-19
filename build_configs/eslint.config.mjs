import typescriptEslint from "@typescript-eslint/eslint-plugin";
import path from "node:path";
import {fileURLToPath} from "node:url";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import {FlatCompat} from "@eslint/eslintrc";
import js from "@eslint/js";
const tsParser = require('@typescript-eslint/parser');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const compat = new FlatCompat(
  {
    baseDirectory: projectRoot,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
  });

export default [
  {
    files: ["**/*.ts"],
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
      parser: tsParser,
      ecmaVersion: 5,
      sourceType: "module",
    },
  },
  ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
  ),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: ["**/node_modules/**/*.js", "**/dist/**/*.js", "**/*.config.cjs", "**/*.config.mjs", "**/setupTests.cjs"]
  }
];