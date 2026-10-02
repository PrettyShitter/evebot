import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      ".cache/**",
      "dist/**",
      "release/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        fetch: "readonly",
        window: "readonly",
        document: "readonly",
        AbortSignal: "readonly",
        structuredClone: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        performance: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
