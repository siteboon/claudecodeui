import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { createNodeResolver, importX } from "eslint-plugin-import-x";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import boundaries from "eslint-plugin-boundaries";
import tailwindcss from "eslint-plugin-tailwindcss";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "public/**"],
  },
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      react,
      "react-hooks": reactHooks, // for following React rules such as dependencies in hooks, keys in lists, etc.
      "react-refresh": reactRefresh, // for Vite HMR compatibility
      "import-x": importX, // for import order/sorting. It also detercts circular dependencies and duplicate imports.
      tailwindcss, // for detecting invalid Tailwind classnames and enforcing classname order
      "unused-imports": unusedImports, // for detecting unused imports
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      // --- Unused imports/vars ---
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",

      // --- React ---
      "react/jsx-key": "warn",
      "react/jsx-no-duplicate-props": "error",
      "react/jsx-no-undef": "error",
      "react/no-children-prop": "warn",
      "react/no-danger-with-children": "error",
      "react/no-direct-mutation-state": "error",
      "react/no-unknown-property": "warn",
      "react/react-in-jsx-scope": "off",

      // --- React Hooks ---
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // --- React Refresh (Vite HMR) ---
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // --- Import ordering & hygiene ---
      "import-x/no-duplicates": "warn",
      "import-x/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "always",
        },
      ],

      // --- Tailwind CSS ---
      "tailwindcss/classnames-order": "warn",
      "tailwindcss/no-contradicting-classname": "warn",
      "tailwindcss/no-unnecessary-arbitrary-value": "warn",

      // --- Disabled base rules ---
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-case-declarations": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
    },
  },
  {
    files: ["server/**/*.{js,ts}"], // apply this block only to backend source files
    ignores: ["server/**/*.d.ts"], // skip generated declaration files in backend linting
    plugins: {
      boundaries, // enforce backend architecture boundaries (module-to-module contracts)
      "import-x": importX, // keep import hygiene rules (duplicates, unresolved paths, etc.)
      "unused-imports": unusedImports, // remove dead imports/variables from backend files
    },
    languageOptions: {
      parser: tseslint.parser, // parse both JS and TS syntax in backend files
      parserOptions: {
        ecmaVersion: "latest", // support modern ECMAScript syntax in backend code
        sourceType: "module", // treat backend files as ESM modules
      },
      globals: {
        ...globals.node, // expose Node.js globals such as process, Buffer, and __dirname equivalents
      },
    },
    settings: {
      "boundaries/include": ["server/**/*.{js,ts}"], // only analyze dependency boundaries inside backend files
      "import/resolver": {
        // boundaries resolves imports through eslint-module-utils, which reads the classic
        // import/resolver setting instead of import-x/resolver-next.
        typescript: {
          project: ["server/tsconfig.json"], // resolve backend aliases using the canonical backend tsconfig
          alwaysTryTypes: true, // keep normal TS package/type resolution working alongside aliases
        },
        node: {
          extensions: [".mjs", ".cjs", ".js", ".json", ".node", ".ts", ".tsx"], // preserve Node-style fallback resolution for plain files
        },
      },
      "import-x/resolver-next": [
        // ESLint's import plugin does not read tsconfig path aliases on its own.
        // This resolver teaches import-x how to understand the backend-only "@/*"
        // mapping defined in server/tsconfig.json, which fixes false no-unresolved errors in editors.
        createTypeScriptImportResolver({
          project: ["server/tsconfig.json"], // point the resolver at the canonical backend tsconfig instead of the frontend one
          alwaysTryTypes: true, // keep standard TypeScript package resolution working while backend aliases are enabled
        }),
        // Keep Node-style resolution available for normal package imports and plain relative JS files.
        // The TypeScript resolver handles aliases, while the Node resolver preserves the expected fallback behavior.
        createNodeResolver({
          extensions: [".mjs", ".cjs", ".js", ".json", ".node", ".ts", ".tsx"],
        }),
      ],
      "boundaries/elements": [
        {
          type: "backend-shared-type-contract", // shared backend type/interface contracts that modules may consume without creating runtime coupling
          pattern: [
            "server/shared/types.{js,ts}",
            "server/shared/interfaces.{js,ts}",
          ], // keep backend modules on explicit shared contract files for erased imports only
          mode: "file", // treat each shared contract file itself as the boundary element instead of the whole folder
        },
        {
          type: "backend-shared-utils", // shared backend runtime helpers that modules may import directly
          pattern: ["server/shared/utils.{js,ts}"], // classify the shared utils file so modules can depend on it explicitly
          mode: "file",
        },
        {
          type: "backend-legacy-runtime", // legacy runtime persistence modules used while providers migrate into server/modules
          pattern: [
            "server/projects.js",
            "server/sessionManager.js",
            "server/database/*.{js,ts}",
            "server/utils/runtime-paths.js",
          ], // provider history loading still resolves session data through these legacy runtime/database files
          mode: "file",
        },
        {
          type: "backend-module", // logical element name used by boundaries rules below
          pattern: "server/modules/*", // each direct folder in server/modules is treated as one module boundary
          mode: "folder", // classify dependencies at folder-module level (not per individual file)
          capture: ["moduleName"], // capture the module folder name for messages/debugging/template use
        },
      ],
    },
    rules: {
      // --- Unused imports/vars (backend) ---
      "unused-imports/no-unused-imports": "warn", // warn when imports are not used so they can be cleaned up
      "unused-imports/no-unused-vars": "off", // keep backend signal focused on dead imports instead of local unused variables

      // --- Import hygiene (backend) ---
      "import-x/no-duplicates": "warn", // prevent duplicate import lines from the same module
      "import-x/order": [
        "warn", // keep backend import grouping/order consistent with the frontend config
        {
          groups: [
            "builtin", // Node built-ins such as fs, path, and url come first
            "external", // third-party packages come after built-ins
            "internal", // aliased internal imports such as @/... come next
            "parent", // ../ imports come after aliased internal imports
            "sibling", // ./foo imports come after parent imports
            "index", // bare ./ imports stay last
          ],
          "newlines-between": "always", // require a blank line between import groups in backend files too
        },
      ],
      "import-x/no-unresolved": "error", // fail when an import path cannot be resolved
      "import-x/no-useless-path-segments": "warn", // prefer cleaner paths (remove redundant ./ and ../ segments)
      "import-x/no-absolute-path": "error", // disallow absolute filesystem imports in backend files

      // --- General safety/style (backend) ---
      eqeqeq: ["warn", "always", { null: "ignore" }], // avoid accidental coercion while still allowing x == null checks

      // --- Architecture boundaries (backend modules) ---
      "boundaries/dependencies": [
        "error", // treat architecture violations as lint errors
        {
          default: "allow", // allow normal imports unless a rule below explicitly disallows them
          checkInternals: false, // do not apply these cross-module rules to imports inside the same module
          rules: [
            {
              from: { type: "backend-module" }, // modules may depend on shared type/interface contracts only as erased type-only imports
              to: { type: "backend-shared-type-contract" },
              disallow: {
                dependency: { kind: ["value", "typeof"] },
              }, // block runtime imports so shared contracts stay compile-time only instead of becoming hidden shared modules
              message:
                "Backend modules may only use `import type` when importing from server/shared/types.ts or server/shared/interfaces.ts.",
            },
            {
              to: { type: "backend-module" }, // when importing anything that belongs to another backend module
              disallow: { to: { internalPath: "**" } }, // block all direct/deep imports into module internals by default
              message:
                "Cross-module imports must go through that module's barrel file (server/modules/<module>/index.ts or index.js).", // explicit error message for architecture violations
            },
            {
              to: { type: "backend-module" }, // same target scope as the disallow rule above
              allow: {
                to: {
                  internalPath: [
                    "index", // allow extensionless barrel imports resolved as module root index
                    "index.{js,mjs,cjs,ts,tsx}", // allow explicit index.* barrel file imports
                  ],
                },
              }, // re-allow only public module entry points (barrel files)
            },
          ],
        },
      ],
      "boundaries/no-unknown": "error", // fail fast if boundaries cannot classify a dependency, which prevents silent rule bypasses
    },
  }
);
