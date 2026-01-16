# Change: Add i18n Internationalization Support

## Why

The application currently has all UI text hardcoded in English, which limits accessibility for non-English speaking users. Adding internationalization (i18n) support will enable the application to serve a broader user base, particularly Chinese-speaking users who form a significant portion of the AI development community. This will improve user experience and adoption by allowing users to interact with the application in their preferred language.

## What Changes

- **BREAKING**: Add `react-i18next` dependency and configure i18n infrastructure
- Add `I18nextProvider` wrapper in App.jsx
- Create translation resource files for English (en) and Simplified Chinese (zh-CN)
- Extract and translate core UI text (menus, buttons, labels, error messages)
- Add language selector in Settings > Account section
- Store user language preference in localStorage
- Implement language switching without page reload
- Create translation namespace structure for scalable management

**Scope - Phase 1 (Progressive Translation):**
- Navigation elements (Settings, menus, buttons)
- Common UI labels (Save, Cancel, Delete, Create, Loading, Error messages)
- Settings page labels and descriptions
- Login/Auth related text
- Sidebar labels (Projects, Sessions, Files)

**Out of Scope - Phase 1:**
- AI-generated content (chat messages, responses)
- Developer-facing error logs
- Documentation and help text
- Terminal/shell output

## Impact

- **Affected specs:**
  - `i18n` (NEW capability) - Internationalization system
  - `user-interface` (NEW capability) - Language-aware UI components

- **Affected code:**
  - `src/main.jsx` - Add i18n initialization
  - `src/App.jsx` - Wrap with I18nextProvider
  - `src/components/Settings.jsx` - Add language selector
  - `src/components/settings/AccountContent.jsx` - Language preference UI
  - All UI components - Replace hardcoded text with translation keys
  - `src/i18n/` (NEW) - Translation resources and configuration
  - `package.json` - Add react-i18next dependency

- **Affected database:** None (language preference stored in localStorage)

- **Migration:**
  - No data migration required
  - Default language: English (fallback for missing translations)
  - User preference stored in `localStorage.getItem('userLanguage')`
