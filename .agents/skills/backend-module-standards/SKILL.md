---
name: backend-module-standards
description: Enforce this repository's TypeScript backend module architecture standards. Use whenever creating, modifying, refactoring, or reviewing backend code under `server/`, including routes, services, modules, repositories, shared backend code, and backend tests. Do not apply these rules to frontend code or non-backend scaffolding.
---

# Backend Module Standards

Apply these rules after the repository's basic scaffolding is in place. Limit them to backend code under `server/`. Preserve the requested task scope: make touched and newly generated backend code compliant without performing an unrelated repository-wide migration.

## Inspect before editing

1. Identify the owning feature module and its existing barrel, services, routes, and tests.
2. Search for existing shared types, interfaces, and utilities before adding any definition.
3. Search for every consumer before changing a module's public exports.

## Organize backend modules

- Place each feature in `server/modules/<feature>/`.
- Use TypeScript for every file inside `server/modules/`. Do not add JavaScript backend module files.
- When touched JavaScript utilities belong to the work, migrate them to TypeScript. Place a one-use utility in its sole component; place a utility used in at least two locations in `server/shared/utils.ts`.
- Give every feature module an `index.ts` barrel that exposes only its required public API.
- Import another feature module only through that module's `index.ts`. Never deep-import another module's routes, services, repositories, adapters, or internal files.
- Treat `server/shared/` as the shared module. Keep shared definitions in `server/shared/types.ts`, `server/shared/interfaces.ts`, and `server/shared/utils.ts`, and expose only required cross-module members through its barrel.
- Do not create module-local `types.ts`, `interfaces.ts`, or `utils.ts` files.
- Keep module-private implementation details unexported.

## Place types, interfaces, and utilities

- Use `type` by default. Use `interface` only for a contract that a class is intended to implement.
- Use `export type` for type exports and `import type` for type-only imports.
- Define a type, interface, or utility directly in its component file when it is used in only that location.
- Move a type or interface used in two or more locations to `server/shared/types.ts` or `server/shared/interfaces.ts` as appropriate.
- Move a utility used in two or more locations to `server/shared/utils.ts`.
- Do not duplicate an existing shared definition to avoid importing it.
- Give every shared type, interface, and utility a detailed doc comment explaining its behavior, valid usage, and important constraints.
- Keep related shared definitions adjacent. Introduce each group with `//----------------- DESCRIPTION OF GROUP ------------` and separate unrelated groups with `// ---------------------------`.

## Design exports deliberately

- Export a function or variable at its declaration, such as `export function loadSession()`. Do not collect ordinary exports at the end of an implementation file.
- The preceding rule does not apply to `index.ts` barrel exports.
- For every exported component, add a brief comment at its definition naming the consuming module or modules and explaining why they use it. Update the comment when consumers change.
- Do not export speculative helpers, implementation details, or symbols that have no cross-file consumer.
- Use clear, specific names for functions and variables. Add a concise comment anywhere intent, ordering, invariants, or edge cases could be confusing.

## Keep routes thin

- Parse and validate transport input in the route, convert it to the service's expected typed input, call one or more services, and translate the result to the response.
- Keep business logic, persistence, filesystem work, subprocess execution, and orchestration out of routes.
- Allow a service to call other services. Access another module's services through that module's public barrel contract.

## Test within the module

- Put feature tests in `server/modules/<feature>/tests/`.
- Add or update unit tests for changed service behavior and route parsing.

## Verify the result

Before finishing:

1. Confirm all cross-module imports use `index.ts` barrels and all public exports are necessary and documented.
2. Confirm shared definitions follow the one-use versus multiple-use placement rule and grouping-comment format.
3. Confirm routes only parse, call services, and format responses.
4. Run the narrow relevant tests, then `npm run typecheck` and `npm run lint` when the task scope and environment permit.
