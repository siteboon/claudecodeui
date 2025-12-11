import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../models/terminal_settings.dart';

/// Service for managing terminal settings
class SettingsService extends ChangeNotifier {
  static const String _settingsKey = 'terminal_settings';
  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  TerminalSettings _settings = const TerminalSettings();
  bool _isLoaded = false;

  TerminalSettings get settings => _settings;
  bool get isLoaded => _isLoaded;

  /// Load settings from secure storage
  Future<void> loadSettings() async {
    try {
      final jsonString = await _storage.read(key: _settingsKey);
      if (jsonString != null) {
        final json = jsonDecode(jsonString) as Map<String, dynamic>;
        _settings = TerminalSettings.fromJson(json);
      }
    } catch (e) {
      debugPrint('Error loading settings: $e');
      _settings = const TerminalSettings();
    }
    _isLoaded = true;
    notifyListeners();
  }

  /// Save settings to secure storage
  Future<void> saveSettings(TerminalSettings newSettings) async {
    _settings = newSettings;
    try {
      final jsonString = jsonEncode(_settings.toJson());
      await _storage.write(key: _settingsKey, value: jsonString);
    } catch (e) {
      debugPrint('Error saving settings: $e');
    }
    notifyListeners();
  }

  /// Update a single setting
  Future<void> updateFontSize(int size) async {
    await saveSettings(_settings.copyWith(fontSize: size));
  }

  Future<void> updateColorScheme(String schemeName) async {
    await saveSettings(_settings.copyWith(colorSchemeName: schemeName));
  }

  Future<void> updateHistorySize(int size) async {
    await saveSettings(_settings.copyWith(historySize: size));
  }

  Future<void> updateCursorStyle(String style) async {
    await saveSettings(_settings.copyWith(cursorStyle: style));
  }

  Future<void> updateBellEnabled(bool enabled) async {
    await saveSettings(_settings.copyWith(bellEnabled: enabled));
  }

  Future<void> updateCopyOnSelect(bool enabled) async {
    await saveSettings(_settings.copyWith(copyOnSelect: enabled));
  }

  /// Reset to default settings
  Future<void> resetToDefaults() async {
    await saveSettings(const TerminalSettings());
  }
}
