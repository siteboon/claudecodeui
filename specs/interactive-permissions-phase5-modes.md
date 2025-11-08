# Feature: Interactive Permissions - Phase 5 Enhanced Permission Modes

## Feature Description
Enhance and integrate the existing permission modes (default, acceptEdits, plan, bypassPermissions) with the new interactive permission system. This phase adds intelligent mode-specific behaviors, creates a new "smart" mode that uses AI-suggested permissions, and provides comprehensive settings UI for mode configuration. The implementation will seamlessly blend the current mode system with the new interactive permissions, providing users with flexible control over their security preferences.

## User Story
As a developer with varying security needs
I want different permission modes that adapt to my workflow
So that I can balance security and productivity based on context

## Problem Statement
Current permission modes are limited and don't integrate with interactive permissions:
- Modes are all-or-nothing without granular control
- No intelligent adaptation based on context
- Plan mode doesn't preview required permissions
- No mode-specific permission rules
- Settings UI lacks mode configuration options
- No smart suggestions based on task type
- Mode switching isn't context-aware

## Solution Statement
Enhance permission modes to:
- Integrate with the interactive permission system
- Add mode-specific permission rules and behaviors
- Create a new "smart" mode with AI-driven suggestions
- Provide comprehensive settings UI for mode configuration
- Enable context-aware mode switching
- Add permission preview for plan mode
- Support custom mode definitions
- Implement mode inheritance and composition

## Relevant Files
Use these files to implement the feature:

- `server/claude-sdk.js` - Current mode implementation
- `src/components/ChatInterface.jsx` - Mode toggle UI
- `src/components/Settings.jsx` - Settings page
- `server/services/permissionManager.js` - Permission manager from Phase 1
- `server/services/permissionMemory.js` - Memory service from Phase 4
- `src/components/PermissionDialog.jsx` - Dialog from Phase 3

### New Files
- `server/services/permissionModes.js` - Enhanced mode management
- `src/components/PermissionModeSettings.jsx` - Mode configuration UI
- `src/components/PermissionModeSelector.jsx` - Enhanced mode selector
- `server/services/smartModeEngine.js` - AI-driven permission logic
- `src/utils/permissionModeUtils.js` - Frontend mode utilities

## Implementation Plan
### Phase 1: Foundation
Enhance existing mode infrastructure

### Phase 2: Core Implementation
Build smart mode and mode-specific behaviors

### Phase 3: Integration
Create comprehensive UI and settings

## Step by Step Tasks

### Enhance Permission Mode Service
- Create `server/services/permissionModes.js`
- Define PermissionModeManager class
- Implement mode registry with built-in modes
- Add mode-specific rule sets
- Create mode inheritance system
- Implement mode composition
- Add custom mode support
- Create mode validation logic

### Update Existing Mode Behaviors
- Modify `server/claude-sdk.js` mode handling
- Integrate with interactive permission system
- **Default Mode**: Show all permission dialogs
- **AcceptEdits Mode**: Auto-approve file edits, ask for others
- **Plan Mode**: Read-only with permission preview on exit
- **BypassPermissions Mode**: Skip all dialogs (legacy)
- Add mode-specific timeout values
- Implement mode-specific patterns

### Create Smart Mode Engine
- Create `server/services/smartModeEngine.js`
- Implement SmartModeEngine class
- Add context analysis for current task
- Create risk assessment algorithm
- Implement auto-approval for low-risk operations
- Add learning from user decisions
- Create suggestion confidence scoring
- Implement fallback to default mode

### Build Mode Configuration Structure
- Define mode configuration schema
- Add allowed/denied tool lists per mode
- Create pattern rules per mode
- Implement risk thresholds
- Add notification preferences
- Create mode scheduling options
- Add mode-specific keyboard shortcuts
- Implement mode presets

### Enhance Plan Mode with Preview
- Modify plan mode exit behavior
- Collect all required permissions during planning
- Create permission summary on exit_plan_mode
- Show bulk approval interface
- Add option to modify permissions before execution
- Implement permission explanation
- Add risk assessment for plan
- Create plan validation

### Create Permission Mode Selector
- Create `src/components/PermissionModeSelector.jsx`
- Enhance current mode toggle UI
- Add mode descriptions and tooltips
- Show active mode rules
- Add quick mode switch menu
- Implement mode transition animations
- Add mode status indicators
- Create keyboard shortcuts (Tab + 1-5)

### Build Mode Settings Component
- Create `src/components/PermissionModeSettings.jsx`
- Design mode configuration interface
- Add mode rule editor
- Create pattern management per mode
- Implement risk threshold sliders
- Add test mode functionality
- Create mode comparison view
- Add mode statistics display

### Implement Context-Aware Mode Switching
- Add automatic mode suggestions
- Detect high-risk operations
- Suggest strict mode for production
- Suggest permissive mode for development
- Create mode switching notifications
- Add confirmation for mode changes
- Implement temporary mode changes
- Add mode history tracking

### Add Mode-Specific UI Indicators
- Update ChatInterface mode display
- Add color coding for each mode
- Create mode badges and icons
- Add mode warnings for risky modes
- Implement mode transition effects
- Add mode-specific backgrounds
- Create mode status bar
- Add floating mode indicator

### Create Custom Mode Builder
- Add custom mode creation UI
- Implement mode template system
- Create mode validation
- Add mode testing interface
- Implement mode sharing
- Create mode import/export
- Add mode versioning
- Build mode marketplace concept

### Integrate with Permission Memory
- Connect modes with permission patterns
- Add mode-specific memory
- Create mode learning system
- Implement mode-based suggestions
- Add mode performance tracking
- Create mode effectiveness metrics
- Implement A/B testing for modes

### Build Mode Automation
- Add scheduled mode changes
- Create location-based modes
- Implement project-based modes
- Add time-based mode switching
- Create event-triggered modes
- Implement mode workflows
- Add mode chaining
- Create mode conditions

### Add Mode Analytics
- Track mode usage statistics
- Create mode effectiveness reports
- Add security audit per mode
- Implement mode recommendation engine
- Create mode optimization suggestions
- Add mode comparison analytics
- Build mode dashboards

### Implement Mode Profiles
- Create user-specific mode preferences
- Add team mode standards
- Implement organization policies
- Create role-based modes
- Add compliance mode templates
- Implement mode inheritance
- Create mode hierarchies

### Create Comprehensive Tests
- Test each mode behavior
- Test mode switching
- Test smart mode decisions
- Test custom mode creation
- Test mode persistence
- Test mode analytics
- Test mode UI components
- Test mode integration

## Testing Strategy
### Unit Tests
- Mode manager functionality
- Smart mode decision logic
- Mode configuration validation
- Mode switching behavior
- Custom mode creation
- Mode-specific rules

### Integration Tests
- Full permission flow per mode
- Mode switching during operations
- Smart mode learning
- Mode persistence across sessions
- Mode UI interactions
- Mode analytics tracking

### Edge Cases
- Rapid mode switching
- Invalid mode configurations
- Mode conflicts
- Smart mode failures
- Mode corruption
- Concurrent mode changes
- Mode migration issues
- Performance with many custom modes

## Acceptance Criteria
- [ ] All existing modes work with interactive permissions
- [ ] Smart mode makes intelligent decisions
- [ ] Plan mode shows permission preview
- [ ] Mode settings UI is comprehensive
- [ ] Custom modes can be created and saved
- [ ] Mode switching is smooth and reliable
- [ ] Mode-specific rules are applied correctly
- [ ] Mode indicators are clear and visible
- [ ] Mode analytics provide useful insights
- [ ] All tests pass with full coverage

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

```bash
# Run all tests
npm test

# Test mode functionality
npm run test:modes

# Start server with mode debugging
DEBUG=permissions:modes npm run server

# Test each mode
# Default mode - should show all dialogs
curl -X POST http://localhost:3000/api/settings -d '{"permissionMode":"default"}'

# AcceptEdits mode - auto-approve edits
curl -X POST http://localhost:3000/api/settings -d '{"permissionMode":"acceptEdits"}'

# Plan mode - read-only planning
curl -X POST http://localhost:3000/api/settings -d '{"permissionMode":"plan"}'

# BypassPermissions mode - no dialogs
curl -X POST http://localhost:3000/api/settings -d '{"permissionMode":"bypassPermissions"}'

# Smart mode - intelligent decisions
curl -X POST http://localhost:3000/api/settings -d '{"permissionMode":"smart"}'

# Test mode switching
# Use Tab key to cycle through modes
# Verify UI updates correctly

# Test custom mode creation
curl -X POST http://localhost:3000/api/modes/custom -d '{
  "name": "development",
  "rules": {"allowedTools": ["Bash", "Read"]},
  "riskThreshold": "medium"
}'

# Test plan mode preview
# 1. Enter plan mode
# 2. Run some planning commands
# 3. Exit plan mode
# 4. Verify permission preview appears

# Test smart mode learning
# 1. Enable smart mode
# 2. Make several permission decisions
# 3. Verify smart mode learns patterns

# Performance test with custom modes
npm run test:performance-modes

# Test mode persistence
# 1. Set a mode
# 2. Restart server
# 3. Verify mode is retained

# Test mode analytics
curl http://localhost:3000/api/modes/analytics

# Verify UI components
# 1. Open settings
# 2. Navigate to permission modes
# 3. Test all configuration options

# Integration test
npm run test:integration-modes
```

## Notes
- Smart mode should be conservative by default
- Mode switching should be instant with no lag
- Consider adding mode recommendation based on project type
- Custom modes should be shareable between users
- Mode analytics should respect privacy
- Consider adding mode templates for common workflows
- Future enhancement: AI-powered mode optimization
- Mode documentation should be comprehensive
- Consider adding mode tutorials for new users