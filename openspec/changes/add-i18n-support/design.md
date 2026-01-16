# Design: i18n Implementation Architecture

## Context

Claude Code UI is a React-based web application with ~50 components, currently serving English-speaking users only. The application uses:
- React 18 with functional components and hooks
- Context-based state management (AuthContext, ThemeContext, etc.)
- localStorage for user preferences
- Vite for bundling

**Constraints:**
- Must not impact performance (bundle size, runtime overhead)
- Must support hot-reload during development
- Must allow switching language without page reload
- Must be extensible for additional languages in the future

**Stakeholders:**
- End users: Need intuitive language switching
- Developers: Need easy translation management workflow
- Maintainers: Need to keep translations synchronized

## Goals / Non-Goals

**Goals:**
1. Implement production-ready i18n using `react-i18next`
2. Support English (en) and Simplified Chinese (zh-CN) in Phase 1
3. Provide language selector in Settings > Account
4. Store user language preference in localStorage
5. Extract and translate top 100 most common UI strings in Phase 1
6. Create reusable translation namespace structure

**Non-Goals:**
1. Translate AI-generated content (chat messages, code responses)
2. Translate backend error logs or terminal output
3. Implement server-side translation
4. Create translation management web UI
5. Add RTL (Right-to-Left) language support

## Decisions

### Decision 1: Use react-i18next Library

**Rationale:**
- Industry-standard for React internationalization (2.5M weekly downloads)
- Built-in hooks (`useTranslation`) compatible with React 18
- Supports interpolation, plurals, date/number formatting
- Excellent TypeScript support (even though we use JS)
- Lazy-loading and code-splitting for translations
- Active community and long-term viability

**Alternatives Considered:**
- **Format.js (React Intl)**: More complex setup, larger bundle size
- **Lingui**: Compile-time approach, requires Babel plugin, over-engineering for our needs
- **Custom solution**: Would require building interpolation, plurals, date formatting from scratch

### Decision 2: Namespace-Based Translation Structure

**Structure:**
```
src/i18n/
├── locales/
│   ├── en/
│   │   ├── common.json      # Shared UI strings
│   │   ├── settings.json    # Settings page
│   │   ├── auth.json        # Login/Auth
│   │   └── sidebar.json     # Navigation/Sidebar
│   └── zh-CN/
│       ├── common.json
│       ├── settings.json
│       ├── auth.json
│       └── sidebar.json
├── config.js                # i18next configuration
└── ReactSuspense.js         # Lazy-loading wrapper
```

**Rationale:**
- Namespace-based approach aligns with feature boundaries
- Smaller files = easier to manage translations
- Supports code-splitting (load only needed namespaces)
- Scalable for future languages

### Decision 3: Language Preference Storage in localStorage

**Rationale:**
- Consistent with existing preferences (theme, code editor settings)
- No backend changes required
- Instant sync across tabs
- Works in offline mode

**Storage Key:** `userLanguage`
**Default Value:** `'en'` (English)
**Valid Values:** `'en'`, `'zh-CN'`

### Decision 4: Translation Key Naming Convention

**Pattern:** `{namespace}.{component}.{element}.{state}`

**Examples:**
- `common.buttons.save` → "Save"
- `common.buttons.cancel` → "Cancel"
- `settings.account.language.label` → "Language"
- `auth.login.title` → "Sign In"
- `sidebar.projects.new` → "New Project"

**Rationale:**
- Hierarchical structure mirrors component tree
- Easy to locate translation key in code
- Prevents naming collisions across namespaces
- Self-documenting

### Decision 5: Fallback Strategy

**Fallback Chain:**
1. User's selected language (e.g., `zh-CN`)
2. English (`en`) as default fallback
3. Return translation key if not found in any language

**Configuration:**
```javascript
fallbackLng: 'en',
debug: false, // Set true in development to log missing keys
saveMissing: false, // Don't auto-create missing keys (manual review required)
```

**Rationale:**
- English is source language, guaranteed to have all keys
- Showing translation key in production is better than blank text
- Manual review prevents typo propagation

## Risks / Trade-offs

### Risk 1: Bundle Size Increase

**Impact:** Initial bundle may increase by ~30KB (gzip) for react-i18next + translations

**Mitigation:**
- Use code-splitting to load translations per namespace
- Enable tree-shaking for unused languages
- Target Phase 1: Top 100 strings only

**Monitoring:**
```bash
npm run build
# Check dist/ size before/after
```

### Risk 2: Missing Translations at Runtime

**Impact:** Users may see English text mixed with Chinese

**Mitigation:**
- Use `useTranslation` with `{ fallbackLng: 'en' }`
- Implement `missingKeyHandler` to log missing keys in development
- Create translation coverage report in CI

### Risk 3: Translation Synchronization Debt

**Impact:** New features may forget to add translations

**Mitigation:**
- Add ESLint rule to detect hardcoded strings in JSX
- Include i18n checklist in PR template
- Document translation workflow in CLAUDE.md

### Risk 4: Context-Aware Translations

**Example:** "Save" could mean:
- Save file (保存文件)
- Save money (节省)
- Rescue (救援)

**Mitigation:**
- Use descriptive keys: `common.buttons.saveFile` vs `common.buttons.saveMoney`
- Add context comments for translators: `{{context}} "Save file to disk"`

## Migration Plan

### Phase 1: Infrastructure Setup (Day 1)

1. Install `react-i18next` and `i18next`
2. Create `src/i18n/` directory structure
3. Configure i18next with lazy-loading
4. Add I18nextProvider to App.jsx
5. Create translation resource files (en, zh-CN)

### Phase 2: Core UI Translation (Day 2-3)

**Priority Order:**
1. Common buttons and labels (Save, Cancel, Delete, Create)
2. Navigation elements (Settings, menus)
3. Settings page
4. Auth/Login pages
5. Sidebar labels

**Process per component:**
1. Replace hardcoded strings with `useTranslation()` hook
2. Add translation key to JSON files
3. Verify English still works
4. Add Chinese translation
5. Test language switching

### Phase 3: Language Selector (Day 3)

1. Add language dropdown to `AccountContent.jsx`
2. Implement `changeLanguage()` handler
3. Save preference to localStorage
4. Test reload persistence

### Phase 4: Validation (Day 4)

1. Manual testing of all translated components
2. Check for missing keys (console warnings)
3. Test language switching in both directions
4. Verify localStorage persistence
5. Test mobile responsive layout with longer Chinese text

### Rollback Plan

If critical issues arise:
1. Revert to commit before i18n changes
2. Keep translation files for future retry
3. Document blockers for next attempt

**Rollback Command:**
```bash
git revert <i18n-commit-hash>
npm install
```

## Open Questions

1. **Should we add TypeScript support for translations?**
   - Current: No, project uses JavaScript
   - Future consideration: Migrate to TypeScript for better type safety

2. **Should we integrate with translation management platform (e.g., Crowdin, Lokalise)?**
   - Current decision: No, manual JSON editing is sufficient for 2 languages
   - Future: Consider when adding 3+ languages or external translators

3. **Should we format dates and numbers according to locale?**
   - Current decision: No, keep ISO format for simplicity
   - Future: Use `i18next-intlplural` if users request localized dates

4. **How to handle pluralization in Chinese (which doesn't have plurals)?**
   - Solution: Use same translation for singular/plural forms
   - Example: `"1 file"` → `"1 个文件"`, `"2 files"` → `"2 个文件"`
