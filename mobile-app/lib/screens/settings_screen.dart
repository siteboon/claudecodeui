import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/color_scheme.dart';
import '../models/terminal_settings.dart';
import '../services/settings_service.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Terminal Settings'),
      ),
      body: Consumer<SettingsService>(
        builder: (context, settingsService, child) {
          final settings = settingsService.settings;

          return ListView(
            children: [
              // Appearance Section
              _buildSectionHeader(context, 'Appearance'),

              // Color Scheme
              ListTile(
                leading: const Icon(Icons.palette),
                title: const Text('Color Scheme'),
                subtitle: Text(settings.colorSchemeName),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _showColorSchemePicker(context, settingsService),
              ),

              // Font Size
              ListTile(
                leading: const Icon(Icons.format_size),
                title: const Text('Font Size'),
                subtitle: Text('${settings.fontSize}'),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.remove),
                      onPressed: settings.fontSize > 8
                          ? () => settingsService
                              .updateFontSize(settings.fontSize - 1)
                          : null,
                    ),
                    Text('${settings.fontSize}'),
                    IconButton(
                      icon: const Icon(Icons.add),
                      onPressed: settings.fontSize < 32
                          ? () => settingsService
                              .updateFontSize(settings.fontSize + 1)
                          : null,
                    ),
                  ],
                ),
              ),

              // Cursor Style
              ListTile(
                leading: const Icon(Icons.edit),
                title: const Text('Cursor Style'),
                subtitle: Text(settings.cursorStyle),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _showCursorStylePicker(context, settingsService),
              ),

              const Divider(),

              // Behavior Section
              _buildSectionHeader(context, 'Behavior'),

              // History Size
              ListTile(
                leading: const Icon(Icons.history),
                title: const Text('Scrollback Lines'),
                subtitle: Text('${settings.historySize}'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _showHistorySizePicker(context, settingsService),
              ),

              // Copy on Select
              SwitchListTile(
                secondary: const Icon(Icons.content_copy),
                title: const Text('Copy on Select'),
                subtitle:
                    const Text('Automatically copy selected text to clipboard'),
                value: settings.copyOnSelect,
                onChanged: (value) => settingsService.updateCopyOnSelect(value),
              ),

              // Bell Sound
              SwitchListTile(
                secondary: const Icon(Icons.notifications),
                title: const Text('Bell Sound'),
                subtitle: const Text('Play sound on terminal bell'),
                value: settings.bellEnabled,
                onChanged: (value) => settingsService.updateBellEnabled(value),
              ),

              const Divider(),

              // Reset Section
              _buildSectionHeader(context, 'Reset'),

              ListTile(
                leading: const Icon(Icons.restore, color: Colors.red),
                title: const Text('Reset to Defaults',
                    style: TextStyle(color: Colors.red)),
                onTap: () => _showResetConfirmation(context, settingsService),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildSectionHeader(BuildContext context, String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.bold,
            ),
      ),
    );
  }

  void _showColorSchemePicker(
      BuildContext context, SettingsService settingsService) {
    showModalBottomSheet(
      context: context,
      builder: (context) => Container(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Color Scheme',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            Expanded(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: ColorSchemes.all.length,
                itemBuilder: (context, index) {
                  final scheme = ColorSchemes.all[index];
                  final isSelected =
                      scheme.name == settingsService.settings.colorSchemeName;

                  return ListTile(
                    leading: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: scheme.background,
                        border: Border.all(color: scheme.foreground),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Center(
                        child: Text(
                          'A',
                          style: TextStyle(
                            color: scheme.foreground,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                    title: Text(scheme.name),
                    trailing: isSelected
                        ? const Icon(Icons.check, color: Colors.green)
                        : null,
                    onTap: () {
                      settingsService.updateColorScheme(scheme.name);
                      Navigator.pop(context);
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showCursorStylePicker(
      BuildContext context, SettingsService settingsService) {
    final styles = ['block', 'underline', 'bar'];

    showModalBottomSheet(
      context: context,
      builder: (context) => Container(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Cursor Style',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            ...styles.map((style) {
              final isSelected =
                  style == settingsService.settings.cursorStyle;
              return ListTile(
                leading: Icon(_getCursorIcon(style)),
                title: Text(style[0].toUpperCase() + style.substring(1)),
                trailing: isSelected
                    ? const Icon(Icons.check, color: Colors.green)
                    : null,
                onTap: () {
                  settingsService.updateCursorStyle(style);
                  Navigator.pop(context);
                },
              );
            }),
          ],
        ),
      ),
    );
  }

  IconData _getCursorIcon(String style) {
    switch (style) {
      case 'block':
        return Icons.square;
      case 'underline':
        return Icons.horizontal_rule;
      case 'bar':
        return Icons.vertical_distribute;
      default:
        return Icons.square;
    }
  }

  void _showHistorySizePicker(
      BuildContext context, SettingsService settingsService) {
    final sizes = [1000, 5000, 10000, 20000, 50000];

    showModalBottomSheet(
      context: context,
      builder: (context) => Container(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Scrollback Lines',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            ...sizes.map((size) {
              final isSelected = size == settingsService.settings.historySize;
              return ListTile(
                title: Text('$size lines'),
                trailing: isSelected
                    ? const Icon(Icons.check, color: Colors.green)
                    : null,
                onTap: () {
                  settingsService.updateHistorySize(size);
                  Navigator.pop(context);
                },
              );
            }),
          ],
        ),
      ),
    );
  }

  void _showResetConfirmation(
      BuildContext context, SettingsService settingsService) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Reset Settings?'),
        content: const Text(
            'This will reset all terminal settings to their default values.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              settingsService.resetToDefaults();
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Settings reset to defaults')),
              );
            },
            child: const Text('Reset', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }
}
