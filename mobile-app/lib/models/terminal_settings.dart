import 'package:flutter/material.dart';
import 'color_scheme.dart';

/// Terminal settings model
/// Based on Windows Terminal settings
class TerminalSettings {
  /// Font size (default: 14)
  final int fontSize;

  /// Font family (default: monospace)
  final String fontFamily;

  /// Scrollback history size (default: 10000)
  final int historySize;

  /// Color scheme name
  final String colorSchemeName;

  /// Cursor style: 'block', 'underline', 'bar'
  final String cursorStyle;

  /// Enable bell sound
  final bool bellEnabled;

  /// Copy on select
  final bool copyOnSelect;

  const TerminalSettings({
    this.fontSize = 14,
    this.fontFamily = 'monospace',
    this.historySize = 10000,
    this.colorSchemeName = 'One Half Dark',
    this.cursorStyle = 'block',
    this.bellEnabled = false,
    this.copyOnSelect = false,
  });

  /// Get the color scheme object
  TerminalColorScheme get colorScheme {
    return ColorSchemes.getByName(colorSchemeName) ?? ColorSchemes.defaultScheme;
  }

  /// Create a copy with modified values
  TerminalSettings copyWith({
    int? fontSize,
    String? fontFamily,
    int? historySize,
    String? colorSchemeName,
    String? cursorStyle,
    bool? bellEnabled,
    bool? copyOnSelect,
  }) {
    return TerminalSettings(
      fontSize: fontSize ?? this.fontSize,
      fontFamily: fontFamily ?? this.fontFamily,
      historySize: historySize ?? this.historySize,
      colorSchemeName: colorSchemeName ?? this.colorSchemeName,
      cursorStyle: cursorStyle ?? this.cursorStyle,
      bellEnabled: bellEnabled ?? this.bellEnabled,
      copyOnSelect: copyOnSelect ?? this.copyOnSelect,
    );
  }

  /// Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'fontSize': fontSize,
      'fontFamily': fontFamily,
      'historySize': historySize,
      'colorSchemeName': colorSchemeName,
      'cursorStyle': cursorStyle,
      'bellEnabled': bellEnabled,
      'copyOnSelect': copyOnSelect,
    };
  }

  /// Create from JSON
  factory TerminalSettings.fromJson(Map<String, dynamic> json) {
    return TerminalSettings(
      fontSize: json['fontSize'] as int? ?? 14,
      fontFamily: json['fontFamily'] as String? ?? 'monospace',
      historySize: json['historySize'] as int? ?? 10000,
      colorSchemeName: json['colorSchemeName'] as String? ?? 'One Half Dark',
      cursorStyle: json['cursorStyle'] as String? ?? 'block',
      bellEnabled: json['bellEnabled'] as bool? ?? false,
      copyOnSelect: json['copyOnSelect'] as bool? ?? false,
    );
  }
}
