# Coding Standards

## JavaScript/React Style Guide

### Indentation and Formatting
- Use 2 spaces for indentation
- No trailing whitespace
- End files with a newline
- Use semicolons consistently

### Component Guidelines
- Use functional components with hooks (no class components)
- Name components in PascalCase
- Name files same as component name
- Keep components focused and single-responsibility

### State Management
- Prefer local state with useState unless sharing is needed
- Use Context API for cross-component state
- Avoid prop drilling beyond 2 levels
- Keep state as close to where it's used as possible

### Naming Conventions
- Variables and functions: camelCase
- Constants: UPPER_SNAKE_CASE
- React components: PascalCase
- CSS classes: kebab-case or use Tailwind utilities

### Import Order
1. External packages (React, libraries)
2. Internal modules (utils, hooks)
3. Components
4. Styles/assets

### Error Handling
- Always handle async errors with try-catch
- Provide user-friendly error messages
- Log errors to console for debugging
- Never expose sensitive information in errors

### Performance Patterns
- Use React.memo for expensive components
- Implement useCallback for stable callbacks
- Use useMemo for expensive computations
- Lazy load components when appropriate

### WebSocket Communication
- Always validate incoming messages
- Handle connection failures gracefully
- Implement reconnection logic
- Clean up connections on unmount