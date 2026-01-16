# i18n Capability Specification (Delta)

## ADDED Requirements

### Requirement: Translation Infrastructure

The system SHALL provide internationalization (i18n) infrastructure using react-i18next library to support multiple languages for user-facing text.

#### Scenario: Initialize i18n on application startup
- **WHEN** the application starts
- **THEN** the system SHALL initialize i18next with configuration
- **AND** load translation resources for English (en) and Chinese (zh-CN)
- **AND** set default language to English
- **AND** detect saved language preference from localStorage

#### Scenario: Load translation namespaces lazily
- **WHEN** a component requires translations
- **THEN** the system SHALL load only the required namespace (e.g., 'common', 'settings')
- **AND** cache loaded namespaces for subsequent access
- **AND** show loading state only during initial load

### Requirement: Language Selection and Persistence

The system SHALL allow users to select their preferred language and persist this preference across sessions.

#### Scenario: User selects language in Settings
- **WHEN** user navigates to Settings > Account > Language selector
- **THEN** the system SHALL display available languages: English and 简体中文
- **AND** show currently selected language as default
- **AND** allow user to change selection

#### Scenario: System saves language preference
- **WHEN** user selects a new language from dropdown
- **THEN** the system SHALL immediately change application language
- **AND** save selection to `localStorage.setItem('userLanguage', '<language>')`
- **AND** refresh all translated components without page reload

#### Scenario: System restores language preference on startup
- **WHEN** user returns to application after closing
- **THEN** the system SHALL read `localStorage.getItem('userLanguage')`
- **AND** initialize i18n with saved language
- **AND** default to English if no preference is saved

### Requirement: Translation Resource Structure

The system SHALL organize translation resources in namespace-based JSON files under `src/i18n/locales/{language}/`.

#### Scenario: Translation file organization
- **WHEN** developers add new translations
- **THEN** translations SHALL be organized by namespace: `common.json`, `settings.json`, `auth.json`, `sidebar.json`
- **AND** each namespace SHALL contain hierarchical keys with dot notation
- **AND** each key SHALL have corresponding translations in all supported languages

**Example structure:**
```json
{
  "buttons": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete"
  },
  "status": {
    "loading": "Loading...",
    "success": "Success",
    "error": "Error"
  }
}
```

#### Scenario: Translation key naming convention
- **WHEN** developers create new translation keys
- **THEN** keys SHALL follow pattern: `{namespace}.{component}.{element}.{state}`
- **AND** use descriptive names to avoid ambiguity
- **AND** avoid abbreviations except for common UI terms (btn, lbl, msg)

**Examples:**
- `common.buttons.save` ✓
- `settings.account.language.label` ✓
- `auth.login.title` ✓
- `btn.save` ✗ (too generic)
- `msg` ✗ (too vague)

### Requirement: Fallback Translation Strategy

The system SHALL provide fallback translations when a translation key is missing in the user's preferred language.

#### Scenario: Missing translation in selected language
- **WHEN** a translation key does not exist in Chinese (zh-CN)
- **THEN** the system SHALL fall back to English (en) translation
- **AND** log warning in development console
- **AND** display English text to user

#### Scenario: Missing translation in all languages
- **WHEN** a translation key does not exist in any language
- **THEN** the system SHALL display the translation key itself (e.g., `common.buttons.save`)
- **AND** log error in development console
- **AND** NOT break the application or crash

### Requirement: Component Translation Integration

The system SHALL provide React components and hooks for translating UI text.

#### Scenario: Functional component uses useTranslation hook
- **WHEN** a functional component needs translations
- **THEN** the component SHALL use `useTranslation()` hook from react-i18next
- **AND** specify namespace: `useTranslation('common')`
- **AND** call `t()` function with translation key
- **AND** automatically re-render when language changes

**Example:**
```javascript
import { useTranslation } from 'react-i18next';

function SaveButton() {
  const { t } = useTranslation('common');
  return <button>{t('buttons.save')}</button>;
}
```

#### Scenario: Component with interpolation
- **WHEN** a translation contains dynamic values (e.g., username, file count)
- **THEN** the translation SHALL use interpolation syntax: `{{variableName}}`
- **AND** the component SHALL pass variables to `t()` function
- **AND** the system SHALL insert values into translated string

**Example:**
```json
{
  "welcome": "Welcome, {{username}}!",
  "fileCount": "You have {{count}} files"
}
```

```javascript
const { t } = useTranslation('common');
t('welcome', { username: 'Alice' });  // "Welcome, Alice!"
t('fileCount', { count: 5 });        // "You have 5 files"
```

### Requirement: Excluded Content from Translation

The system SHALL NOT translate certain types of content to preserve accuracy and developer experience.

#### Scenario: AI-generated content remains untranslated
- **WHEN** AI assistant generates chat messages, code, or responses
- **THEN** the content SHALL remain in original language (usually English)
- **AND** NOT be processed by translation system

#### Scenario: Developer-facing logs remain in English
- **WHEN** the application logs errors, warnings, or debug information
- **THEN** log messages SHALL remain in English
- **AND** NOT be translated to maintain debugging consistency

#### Scenario: Terminal/shell output remains as-is
- **WHEN** the application displays terminal or shell output
- **THEN** the output SHALL remain in original language
- **AND** NOT be modified by translation system

### Requirement: Performance and Bundle Size

The system SHALL minimize the impact of i18n on application bundle size and runtime performance.

#### Scenario: Code-splitting for translation files
- **WHEN** the application is built for production
- **THEN** translation files SHALL be split by language and namespace
- **AND** loaded only when needed (lazy-loading)
- **AND** increase bundle size by less than 50KB (gzip)

#### Scenario: No performance regression on language switch
- **WHEN** user changes language preference
- **THEN** the system SHALL update UI within 100ms
- **AND** NOT require full page reload
- **AND** maintain smooth user experience

### Requirement: Developer Experience

The system SHALL provide tools and guidelines for contributors to add and maintain translations.

#### Scenario: Detecting missing translations in development
- **WHEN** a developer references a non-existent translation key
- **THEN** the system SHALL log warning in browser console
- **AND** display translation key in UI with warning styling
- **AND** NOT break the build process

#### Scenario: Documentation for contributors
- **WHEN** a contributor needs to add new translations
- **THEN** CLAUDE.md SHALL document i18n workflow
- **AND** provide examples of correct translation key usage
- **AND** list translation naming conventions
- **AND** explain how to add new languages

## MODIFIED Requirements

*N/A - This is a new capability, no existing requirements are modified.*

## REMOVED Requirements

*N/A - This is a new capability, no existing requirements are removed.*

## RENAMED Requirements

*N/A - This is a new capability, no existing requirements are renamed.*
