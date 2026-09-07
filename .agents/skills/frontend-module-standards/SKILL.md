---
name: frontend-module-standards
description: Enforce this repository's React and TypeScript frontend module architecture standards. Use whenever creating, modifying, refactoring, or reviewing frontend code under `src/`, including feature modules, components, hooks, contexts, shared UI, API access, state, utilities, and frontend tests. Do not apply these rules to backend code under `server/` or non-frontend scaffolding.
---

# Frontend Module Standards

Apply these rules only to frontend code under `src/`. Preserve the requested task scope: make touched and newly generated frontend code compliant without performing an unrelated repository-wide migration.

## Inspect before editing

1. Identify the owning feature module and its existing barrel, components, hooks, contexts, utilities, state, API usage, and tests.
2. Search for existing shared types, utilities, constants, UI components, hooks, and contexts before adding a new definition.
3. Search for every consumer before moving a definition or changing a module's public exports.
4. Distinguish application-source imports from package imports before applying the `@` alias rules.

## Use source-root imports

- Treat `@` as the alias for `src`.
- Use `@/...` imports whenever the import target is frontend application code inside `src`, including imports within the same feature module.
- Do not use relative paths such as `../`, `../../`, or `./` for application-source imports.
- Continue using bare package specifiers for external dependencies, such as `react` or `react-router-dom`.
- Use `import type` for every type-only import.

## Organize feature modules

- Place every frontend feature in `src/modules/<feature>/`.
- Use `.ts` for non-JSX files and `.tsx` for files containing JSX. Do not add JavaScript feature-module files.
- Give every feature module an `index.ts` barrel that exposes only its required public API.
- Import another feature module only through that module's `index.ts`. Never deep-import another module's components, hooks, contexts, modals, utilities, or other implementation details.
- Keep module-private implementation details out of the barrel.
- Do not create `view/` directories inside feature modules.
- Keep module-owned UI components within the owning module, either at its root or in clearly named component-specific directories.

A feature module may contain only the directories it needs:

```text
src/modules/<feature>/
|-- index.ts
|-- FeatureComponent.tsx
|-- hooks/
|-- context/
|-- modals/
|-- utils/
`-- tests/
```

## Design exports deliberately

- Export components and other public symbols at their declarations. This does not apply to re-exports from `index.ts` barrels.
- Do not export speculative helpers, unused symbols, or module-private implementation details.
- For every exported component, add a brief comment at its definition naming the consuming module or modules and explaining why they use it.
- Update an exported component's consumer comment whenever its consumers change.
- Use clear, specific names for functions, variables, components, and hooks.
- Add a concise comment wherever intent, ordering, invariants, or edge cases would otherwise be unclear.

Example:

```tsx
/** Used by the chat and plugins modules to display the active provider. */
export function ProviderBadge() {
  // ...
}
```

## Use types, not interfaces

- Do not introduce TypeScript `interface` declarations in frontend code. Use `type` aliases instead, including for component props, context values, state shapes, and API data.
- When the requested work directly touches an existing interface, convert it to a type when doing so remains within scope.
- Use `export type` when exporting a type.
- Use `import type` when importing a type.
- Use type-only barrel exports such as `export type { Session }`.

## Place types by usage

- Define a type directly in its sole owning component or implementation file when only that file uses it.
- When two or more files use the same type, place it in `src/shared/types.ts`.
- Do not create module-local `types.ts` files.
- Do not duplicate a shared type to avoid importing it.
- Add a brief comment to every type in `src/shared/types.ts` explaining what it represents and how it should be used.

## Place utilities by usage

- Define a utility directly in its sole owning component or implementation file when only that file uses it.
- When two or more files use the same utility, place it in `src/shared/utils.ts`.
- Do not create a module-level `utils.ts` file or duplicate a shared utility to avoid importing it.
- Add a brief comment to every utility in `src/shared/utils.ts` explaining what it does and how it should be used.
- A large module-private utility may be placed in `src/modules/<feature>/utils/` when keeping it in its sole consumer would make that file impractical to maintain.
- Give large module-private utility files descriptive names, such as `mobileTerminalSelection.ts`; do not name them `utils.ts`.
- Keep a large utility module-private unless it acquires consumers in other modules. If it becomes shared across multiple modules, move it to `src/shared/utils.ts`.

## Place constants by usage

- Define a constant directly in its sole owning component or implementation file when only that file uses it.
- When two or more files use the same constant, place it in `src/shared/constants.ts`.
- Do not create module-local `constants.ts` files or duplicate shared constants.
- Name true constants using `UPPER_SNAKE_CASE`.
- Treat a value as a constant only when it is fixed independently of runtime evaluation.
- A runtime-derived value such as platform detection is a variable or utility, even if it was previously given an uppercase name. Place it according to the utility rules.
- Add a brief comment to every constant in `src/shared/constants.ts` explaining what it represents and how it should be used.

## Organize shared definitions

Within `src/shared/types.ts`, `src/shared/utils.ts`, and `src/shared/constants.ts`:

- Keep related definitions adjacent.
- Introduce each related group with `//----------------- DESCRIPTION OF GROUP ------------`.
- Separate unrelated groups with `// ---------------------------`.
- Document each definition individually, even when it belongs to a documented group.
- Avoid unrelated catch-all groups.

## Place hooks by ownership

- Put a hook used only by one feature module in `src/modules/<feature>/hooks/`.
- Put a hook used by multiple feature modules in `src/shared/hooks/`.
- Do not move a module-private hook into shared code merely because multiple components within the same module use it.
- Search for an existing equivalent hook before adding a new one.

## Place contexts by ownership

- Put a context primarily owned by one feature in `src/modules/<feature>/context/`. For example, the auth module owns `AuthContext`.
- Put a context without a clear feature owner in `src/shared/context/`. For example, `ThemeContext` affects the application broadly.
- Ownership, not the number of consumers alone, determines context placement.

## Place shared UI by usage

- Keep a UI component inside its owning feature module when it is used only by that module.
- Move a UI component to `src/shared/ui/` only when two or more different feature modules use it.
- Multiple consumers within the same feature module do not make a component globally shared.
- Do not place shared UI under `src/shared/view/ui/` or create `view/` directories as an organizational layer.
- Export only shared UI components that have real consumers.

## Centralize frontend API access

- Place frontend API endpoint definitions and shared request helpers in `src/shared/api.ts`.
- Do not scatter endpoint paths or duplicate API request logic across feature components.
- Feature modules may call the public API helpers but should not redefine their endpoint details.
- Keep API transport concerns out of presentational UI components when practical.

## Document state deliberately

Treat React state, reducer state, context state, and external-store state as frontend state for these rules.

- Add a brief comment immediately above every newly introduced state declaration explaining why the state is essential and how it is used.
- Describe its purpose rather than merely restating its variable name.
- Do not introduce state that can be derived reliably from existing props or state.
- If the task requires temporarily retaining state that appears redundant or questionable, mark it with `// ! Possibly unnecessary - <brief reason>`.
- Do not add known-redundant state merely to annotate it.

## Organize modals

- When a feature module contains multiple modals, place them in `src/modules/<feature>/modals/`.
- When a feature module contains only one modal, keep it directly in the module.
- Keep a modal in `src/shared/ui/` only when it is a genuinely reusable UI primitive used by multiple different modules.

## Test within the owner

- Put feature-module tests in `src/modules/<feature>/tests/`.
- Put tests for shared frontend code in `src/shared/tests/`.
- Add or update focused tests for changed hooks, utilities, API behavior, state transitions, and component behavior when applicable.
- Do not place feature-specific tests in the shared test directory.

## Verify the result

Before finishing:

1. Confirm every application-source import uses `@/...` and external packages still use bare package specifiers.
2. Confirm all cross-module imports go through the owning module's `index.ts`.
3. Confirm module barrels contain only necessary, documented public exports.
4. Confirm frontend code introduces no interfaces and uses `export type` and `import type` correctly.
5. Confirm types, utilities, constants, hooks, contexts, UI components, modals, and tests follow their ownership and usage rules.
6. Confirm shared types, utilities, and constants use the required comments and grouping separators.
7. Confirm every newly introduced state declaration explains why it exists or is marked as possibly unnecessary.
8. Run the narrow relevant frontend tests, followed by `npm run test:client`, `npm run build:client`, `npm run typecheck`, and `npm run lint` when the task scope and environment permit.
