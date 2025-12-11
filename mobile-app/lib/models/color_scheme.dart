import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart';

/// Terminal color scheme model
/// Based on Windows Terminal color schemes
class TerminalColorScheme {
  final String name;
  final Color foreground;
  final Color background;
  final Color cursor;
  final Color selection;
  final Color black;
  final Color red;
  final Color green;
  final Color yellow;
  final Color blue;
  final Color magenta;
  final Color cyan;
  final Color white;
  final Color brightBlack;
  final Color brightRed;
  final Color brightGreen;
  final Color brightYellow;
  final Color brightBlue;
  final Color brightMagenta;
  final Color brightCyan;
  final Color brightWhite;

  const TerminalColorScheme({
    required this.name,
    required this.foreground,
    required this.background,
    required this.cursor,
    required this.selection,
    required this.black,
    required this.red,
    required this.green,
    required this.yellow,
    required this.blue,
    required this.magenta,
    required this.cyan,
    required this.white,
    required this.brightBlack,
    required this.brightRed,
    required this.brightGreen,
    required this.brightYellow,
    required this.brightBlue,
    required this.brightMagenta,
    required this.brightCyan,
    required this.brightWhite,
  });

  /// Convert to xterm.dart TerminalTheme
  TerminalTheme toTerminalTheme() {
    return TerminalTheme(
      cursor: cursor,
      selection: selection,
      foreground: foreground,
      background: background,
      black: black,
      red: red,
      green: green,
      yellow: yellow,
      blue: blue,
      magenta: magenta,
      cyan: cyan,
      white: white,
      brightBlack: brightBlack,
      brightRed: brightRed,
      brightGreen: brightGreen,
      brightYellow: brightYellow,
      brightBlue: brightBlue,
      brightMagenta: brightMagenta,
      brightCyan: brightCyan,
      brightWhite: brightWhite,
      searchHitBackground: const Color(0xFFFFDF00),
      searchHitBackgroundCurrent: const Color(0xFFFF9632),
      searchHitForeground: const Color(0xFF000000),
    );
  }
}

/// Predefined color schemes based on Windows Terminal defaults
class ColorSchemes {
  static const TerminalColorScheme campbell = TerminalColorScheme(
    name: 'Campbell',
    foreground: Color(0xFFCCCCCC),
    background: Color(0xFF0C0C0C),
    cursor: Color(0xFFFFFFFF),
    selection: Color(0xFF264F78),
    black: Color(0xFF0C0C0C),
    red: Color(0xFFC50F1F),
    green: Color(0xFF13A10E),
    yellow: Color(0xFFC19C00),
    blue: Color(0xFF0037DA),
    magenta: Color(0xFF881798),
    cyan: Color(0xFF3A96DD),
    white: Color(0xFFCCCCCC),
    brightBlack: Color(0xFF767676),
    brightRed: Color(0xFFE74856),
    brightGreen: Color(0xFF16C60C),
    brightYellow: Color(0xFFF9F1A5),
    brightBlue: Color(0xFF3B78FF),
    brightMagenta: Color(0xFFB4009E),
    brightCyan: Color(0xFF61D6D6),
    brightWhite: Color(0xFFF2F2F2),
  );

  static const TerminalColorScheme campbellPowershell = TerminalColorScheme(
    name: 'Campbell Powershell',
    foreground: Color(0xFFCCCCCC),
    background: Color(0xFF012456),
    cursor: Color(0xFFFFFFFF),
    selection: Color(0xFF264F78),
    black: Color(0xFF0C0C0C),
    red: Color(0xFFC50F1F),
    green: Color(0xFF13A10E),
    yellow: Color(0xFFC19C00),
    blue: Color(0xFF0037DA),
    magenta: Color(0xFF881798),
    cyan: Color(0xFF3A96DD),
    white: Color(0xFFCCCCCC),
    brightBlack: Color(0xFF767676),
    brightRed: Color(0xFFE74856),
    brightGreen: Color(0xFF16C60C),
    brightYellow: Color(0xFFF9F1A5),
    brightBlue: Color(0xFF3B78FF),
    brightMagenta: Color(0xFFB4009E),
    brightCyan: Color(0xFF61D6D6),
    brightWhite: Color(0xFFF2F2F2),
  );

  static const TerminalColorScheme oneHalfDark = TerminalColorScheme(
    name: 'One Half Dark',
    foreground: Color(0xFFDCDFE4),
    background: Color(0xFF282C34),
    cursor: Color(0xFFFFFFFF),
    selection: Color(0xFF264F78),
    black: Color(0xFF282C34),
    red: Color(0xFFE06C75),
    green: Color(0xFF98C379),
    yellow: Color(0xFFE5C07B),
    blue: Color(0xFF61AFEF),
    magenta: Color(0xFFC678DD),
    cyan: Color(0xFF56B6C2),
    white: Color(0xFFDCDFE4),
    brightBlack: Color(0xFF5A6374),
    brightRed: Color(0xFFE06C75),
    brightGreen: Color(0xFF98C379),
    brightYellow: Color(0xFFE5C07B),
    brightBlue: Color(0xFF61AFEF),
    brightMagenta: Color(0xFFC678DD),
    brightCyan: Color(0xFF56B6C2),
    brightWhite: Color(0xFFDCDFE4),
  );

  static const TerminalColorScheme oneHalfLight = TerminalColorScheme(
    name: 'One Half Light',
    foreground: Color(0xFF383A42),
    background: Color(0xFFFAFAFA),
    cursor: Color(0xFF4F525D),
    selection: Color(0xFFBFCEFF),
    black: Color(0xFF383A42),
    red: Color(0xFFE45649),
    green: Color(0xFF50A14F),
    yellow: Color(0xFFC18401),
    blue: Color(0xFF0184BC),
    magenta: Color(0xFFA626A4),
    cyan: Color(0xFF0997B3),
    white: Color(0xFFFAFAFA),
    brightBlack: Color(0xFF4F525D),
    brightRed: Color(0xFFE06C75),
    brightGreen: Color(0xFF98C379),
    brightYellow: Color(0xFFE5C07B),
    brightBlue: Color(0xFF61AFEF),
    brightMagenta: Color(0xFFC678DD),
    brightCyan: Color(0xFF56B6C2),
    brightWhite: Color(0xFFFFFFFF),
  );

  static const TerminalColorScheme vintage = TerminalColorScheme(
    name: 'Vintage',
    foreground: Color(0xFFC0C0C0),
    background: Color(0xFF000000),
    cursor: Color(0xFFFFFFFF),
    selection: Color(0xFF264F78),
    black: Color(0xFF000000),
    red: Color(0xFF800000),
    green: Color(0xFF008000),
    yellow: Color(0xFF808000),
    blue: Color(0xFF000080),
    magenta: Color(0xFF800080),
    cyan: Color(0xFF008080),
    white: Color(0xFFC0C0C0),
    brightBlack: Color(0xFF808080),
    brightRed: Color(0xFFFF0000),
    brightGreen: Color(0xFF00FF00),
    brightYellow: Color(0xFFFFFF00),
    brightBlue: Color(0xFF0000FF),
    brightMagenta: Color(0xFFFF00FF),
    brightCyan: Color(0xFF00FFFF),
    brightWhite: Color(0xFFFFFFFF),
  );

  static const TerminalColorScheme solarizedDark = TerminalColorScheme(
    name: 'Solarized Dark',
    foreground: Color(0xFF839496),
    background: Color(0xFF002B36),
    cursor: Color(0xFF93A1A1),
    selection: Color(0xFF073642),
    black: Color(0xFF002B36),
    red: Color(0xFFDC322F),
    green: Color(0xFF859900),
    yellow: Color(0xFFB58900),
    blue: Color(0xFF268BD2),
    magenta: Color(0xFFD33682),
    cyan: Color(0xFF2AA198),
    white: Color(0xFFEEE8D5),
    brightBlack: Color(0xFF073642),
    brightRed: Color(0xFFCB4B16),
    brightGreen: Color(0xFF586E75),
    brightYellow: Color(0xFF657B83),
    brightBlue: Color(0xFF839496),
    brightMagenta: Color(0xFF6C71C4),
    brightCyan: Color(0xFF93A1A1),
    brightWhite: Color(0xFFFDF6E3),
  );

  static const TerminalColorScheme solarizedLight = TerminalColorScheme(
    name: 'Solarized Light',
    foreground: Color(0xFF657B83),
    background: Color(0xFFFDF6E3),
    cursor: Color(0xFF586E75),
    selection: Color(0xFFEEE8D5),
    black: Color(0xFF002B36),
    red: Color(0xFFDC322F),
    green: Color(0xFF859900),
    yellow: Color(0xFFB58900),
    blue: Color(0xFF268BD2),
    magenta: Color(0xFFD33682),
    cyan: Color(0xFF2AA198),
    white: Color(0xFFEEE8D5),
    brightBlack: Color(0xFF073642),
    brightRed: Color(0xFFCB4B16),
    brightGreen: Color(0xFF586E75),
    brightYellow: Color(0xFF657B83),
    brightBlue: Color(0xFF839496),
    brightMagenta: Color(0xFF6C71C4),
    brightCyan: Color(0xFF93A1A1),
    brightWhite: Color(0xFFFDF6E3),
  );

  static const TerminalColorScheme tangoLight = TerminalColorScheme(
    name: 'Tango Light',
    foreground: Color(0xFF000000),
    background: Color(0xFFFFFFFF),
    cursor: Color(0xFF000000),
    selection: Color(0xFF264F78),
    black: Color(0xFF000000),
    red: Color(0xFFCC0000),
    green: Color(0xFF4E9A06),
    yellow: Color(0xFFC4A000),
    blue: Color(0xFF3465A4),
    magenta: Color(0xFF75507B),
    cyan: Color(0xFF06989A),
    white: Color(0xFFD3D7CF),
    brightBlack: Color(0xFF555753),
    brightRed: Color(0xFFEF2929),
    brightGreen: Color(0xFF8AE234),
    brightYellow: Color(0xFFFCE94F),
    brightBlue: Color(0xFF729FCF),
    brightMagenta: Color(0xFFAD7FA8),
    brightCyan: Color(0xFF34E2E2),
    brightWhite: Color(0xFFEEEEEC),
  );

  static const TerminalColorScheme tangoDark = TerminalColorScheme(
    name: 'Tango Dark',
    foreground: Color(0xFFD3D7CF),
    background: Color(0xFF000000),
    cursor: Color(0xFFFFFFFF),
    selection: Color(0xFF264F78),
    black: Color(0xFF000000),
    red: Color(0xFFCC0000),
    green: Color(0xFF4E9A06),
    yellow: Color(0xFFC4A000),
    blue: Color(0xFF3465A4),
    magenta: Color(0xFF75507B),
    cyan: Color(0xFF06989A),
    white: Color(0xFFD3D7CF),
    brightBlack: Color(0xFF555753),
    brightRed: Color(0xFFEF2929),
    brightGreen: Color(0xFF8AE234),
    brightYellow: Color(0xFFFCE94F),
    brightBlue: Color(0xFF729FCF),
    brightMagenta: Color(0xFFAD7FA8),
    brightCyan: Color(0xFF34E2E2),
    brightWhite: Color(0xFFEEEEEC),
  );

  static const TerminalColorScheme dimidium = TerminalColorScheme(
    name: 'Dimidium',
    foreground: Color(0xFFBAB7B6),
    background: Color(0xFF141414),
    cursor: Color(0xFF37E57B),
    selection: Color(0xFF8DB8E5),
    black: Color(0xFF000000),
    red: Color(0xFFCF494C),
    green: Color(0xFF60B442),
    yellow: Color(0xFFDB9C11),
    blue: Color(0xFF0575D8),
    magenta: Color(0xFFAF5ED2),
    cyan: Color(0xFF1DB6BB),
    white: Color(0xFFBAB7B6),
    brightBlack: Color(0xFF817E7E),
    brightRed: Color(0xFFFF643B),
    brightGreen: Color(0xFF37E57B),
    brightYellow: Color(0xFFFCCD1A),
    brightBlue: Color(0xFF688DFD),
    brightMagenta: Color(0xFFED6FE9),
    brightCyan: Color(0xFF32E0FB),
    brightWhite: Color(0xFFDEE3E4),
  );

  /// All available color schemes
  static const List<TerminalColorScheme> all = [
    campbell,
    campbellPowershell,
    oneHalfDark,
    oneHalfLight,
    vintage,
    solarizedDark,
    solarizedLight,
    tangoDark,
    tangoLight,
    dimidium,
  ];

  /// Get scheme by name
  static TerminalColorScheme? getByName(String name) {
    try {
      return all.firstWhere((s) => s.name == name);
    } catch (_) {
      return null;
    }
  }

  /// Default scheme
  static const TerminalColorScheme defaultScheme = oneHalfDark;
}
