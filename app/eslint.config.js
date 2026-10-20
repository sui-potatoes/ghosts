import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist", "public/demo-assets/basis/**"] },
    js.configs.recommended,
    {
        files: ["src/features/squad/appearance/*.js"],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ["**/*.{ts,tsx}"],
        extends: [...tseslint.configs.recommended],
        languageOptions: { globals: globals.browser },
        plugins: { "react-hooks": reactHooks },
        rules: {
            "react-hooks/rules-of-hooks": "error",
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
        },
    },
);
