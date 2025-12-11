import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:xterm/xterm.dart';
import '../services/connection_manager.dart';
import '../services/settings_service.dart';
import 'settings_screen.dart';

class TerminalScreen extends StatefulWidget {
  const TerminalScreen({super.key});

  @override
  State<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends State<TerminalScreen> {
  late Terminal _terminal;
  late TerminalController _terminalController;
  StreamSubscription<String>? _outputSubscription;
  final FocusNode _focusNode = FocusNode();
  bool _showKeyboard = false;
  bool _ctrlPressed = false;
  bool _altPressed = false;

  @override
  void initState() {
    super.initState();
    final settingsService = context.read<SettingsService>();
    _terminal = Terminal(
      maxLines: settingsService.settings.historySize,
    );
    _terminalController = TerminalController();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _setupTerminal();
    });
  }

  void _setupTerminal() {
    final manager = context.read<ConnectionManager>();
    final sshService = manager.sshService;

    if (sshService == null) {
      Navigator.pop(context);
      return;
    }

    _outputSubscription = sshService.outputStream?.listen(
      (data) {
        _terminal.write(data);
      },
      onError: (error) {
        _terminal.write('\r\n\x1b[31mError: $error\x1b[0m\r\n');
      },
      onDone: () {
        _terminal.write('\r\n\x1b[33mConnection closed.\x1b[0m\r\n');
      },
    );

    _terminal.onOutput = (data) {
      sshService.write(data);
    };

    _terminal.onResize = (width, height, pixelWidth, pixelHeight) {
      sshService.resize(width, height);
    };
  }

  @override
  void dispose() {
    _outputSubscription?.cancel();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer2<ConnectionManager, SettingsService>(
      builder: (context, manager, settingsService, child) {
        final connection = manager.currentConnection;
        final settings = settingsService.settings;
        final theme = settings.colorScheme.toTerminalTheme();

        return PopScope(
          canPop: false,
          onPopInvokedWithResult: (didPop, result) async {
            if (didPop) return;
            final shouldDisconnect = await _showDisconnectDialog();
            if (shouldDisconnect == true && context.mounted) {
              await manager.disconnect();
              if (context.mounted) {
                Navigator.pop(context);
              }
            }
          },
          child: Scaffold(
            backgroundColor: theme.background,
            appBar: AppBar(
              backgroundColor: theme.background,
              foregroundColor: theme.foreground,
              title: Text(connection?.name ?? 'Terminal'),
              leading: IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () async {
                  final shouldDisconnect = await _showDisconnectDialog();
                  if (shouldDisconnect == true && context.mounted) {
                    await manager.disconnect();
                    if (context.mounted) {
                      Navigator.pop(context);
                    }
                  }
                },
              ),
              actions: [
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 8),
                  child: Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: manager.isConnected ? Colors.green : Colors.red,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        manager.isConnected ? 'Connected' : 'Disconnected',
                        style: const TextStyle(fontSize: 12),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.settings),
                  onPressed: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (context) => const SettingsScreen(),
                      ),
                    );
                  },
                ),
                IconButton(
                  icon: Icon(_showKeyboard ? Icons.keyboard_hide : Icons.keyboard),
                  onPressed: () {
                    setState(() {
                      _showKeyboard = !_showKeyboard;
                    });
                  },
                ),
              ],
            ),
            body: Column(
              children: [
                Expanded(
                  child: TerminalView(
                    _terminal,
                    controller: _terminalController,
                    autofocus: true,
                    backgroundOpacity: 1.0,
                    textStyle: TerminalStyle(
                      fontSize: settings.fontSize.toDouble(),
                      fontFamily: settings.fontFamily,
                    ),
                    onSecondaryTapDown: (details, offset) async {
                      final data = await Clipboard.getData('text/plain');
                      if (data?.text != null) {
                        manager.sshService?.write(data!.text!);
                      }
                    },
                    theme: theme,
                  ),
                ),
                if (_showKeyboard) _buildVirtualKeyboard(manager),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildVirtualKeyboard(ConnectionManager manager) {
    final settingsService = context.read<SettingsService>();
    final bgColor = settingsService.settings.colorScheme.background;
    final fgColor = settingsService.settings.colorScheme.foreground;

    return Container(
      color: Color.lerp(bgColor, Colors.white, 0.1),
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      child: Column(
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildModifierButton('Ctrl', _ctrlPressed, () {
                  setState(() => _ctrlPressed = !_ctrlPressed);
                }, fgColor),
                _buildModifierButton('Alt', _altPressed, () {
                  setState(() => _altPressed = !_altPressed);
                }, fgColor),
                _buildKeyButton('Esc', () => _sendKey('\x1b', manager), fgColor),
                _buildKeyButton('Tab', () => _sendKey('\t', manager), fgColor),
                _buildKeyButton('Up', () => _sendKey('\x1b[A', manager), fgColor),
                _buildKeyButton('Dn', () => _sendKey('\x1b[B', manager), fgColor),
                _buildKeyButton('Lt', () => _sendKey('\x1b[D', manager), fgColor),
                _buildKeyButton('Rt', () => _sendKey('\x1b[C', manager), fgColor),
              ],
            ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildKeyButton('C-c', () => _sendKey('\x03', manager), fgColor),
                _buildKeyButton('C-d', () => _sendKey('\x04', manager), fgColor),
                _buildKeyButton('C-z', () => _sendKey('\x1a', manager), fgColor),
                _buildKeyButton('C-l', () => _sendKey('\x0c', manager), fgColor),
                _buildKeyButton('C-a', () => _sendKey('\x01', manager), fgColor),
                _buildKeyButton('C-e', () => _sendKey('\x05', manager), fgColor),
                _buildKeyButton('C-r', () => _sendKey('\x12', manager), fgColor),
                _buildKeyButton('C-w', () => _sendKey('\x17', manager), fgColor),
              ],
            ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildKeyButton('C-u', () => _sendKey('\x15', manager), fgColor),
                _buildKeyButton('C-k', () => _sendKey('\x0b', manager), fgColor),
                _buildKeyButton('C-p', () => _sendKey('\x10', manager), fgColor),
                _buildKeyButton('C-n', () => _sendKey('\x0e', manager), fgColor),
                _buildKeyButton('PgU', () => _sendKey('\x1b[5~', manager), fgColor),
                _buildKeyButton('PgD', () => _sendKey('\x1b[6~', manager), fgColor),
                _buildKeyButton('Hom', () => _sendKey('\x1b[H', manager), fgColor),
                _buildKeyButton('End', () => _sendKey('\x1b[F', manager), fgColor),
              ],
            ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildKeyButton('F1', () => _sendKey('\x1bOP', manager), fgColor),
                _buildKeyButton('F2', () => _sendKey('\x1bOQ', manager), fgColor),
                _buildKeyButton('F3', () => _sendKey('\x1bOR', manager), fgColor),
                _buildKeyButton('F4', () => _sendKey('\x1bOS', manager), fgColor),
                _buildKeyButton('F5', () => _sendKey('\x1b[15~', manager), fgColor),
                _buildKeyButton('F6', () => _sendKey('\x1b[17~', manager), fgColor),
                _buildKeyButton('F7', () => _sendKey('\x1b[18~', manager), fgColor),
                _buildKeyButton('F8', () => _sendKey('\x1b[19~', manager), fgColor),
                _buildKeyButton('F9', () => _sendKey('\x1b[20~', manager), fgColor),
                _buildKeyButton('F10', () => _sendKey('\x1b[21~', manager), fgColor),
                _buildKeyButton('F11', () => _sendKey('\x1b[23~', manager), fgColor),
                _buildKeyButton('F12', () => _sendKey('\x1b[24~', manager), fgColor),
              ],
            ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildKeyButton('|', () => _sendChar('|', manager), fgColor),
                _buildKeyButton('&', () => _sendChar('&', manager), fgColor),
                _buildKeyButton(';', () => _sendChar(';', manager), fgColor),
                _buildKeyButton(r'$', () => _sendChar(r'$', manager), fgColor),
                _buildKeyButton('~', () => _sendChar('~', manager), fgColor),
                _buildKeyButton('`', () => _sendChar('`', manager), fgColor),
                _buildKeyButton('{', () => _sendChar('{', manager), fgColor),
                _buildKeyButton('}', () => _sendChar('}', manager), fgColor),
                _buildKeyButton('[', () => _sendChar('[', manager), fgColor),
                _buildKeyButton(']', () => _sendChar(']', manager), fgColor),
                _buildKeyButton('<', () => _sendChar('<', manager), fgColor),
                _buildKeyButton('>', () => _sendChar('>', manager), fgColor),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _sendKey(String key, ConnectionManager manager) {
    String toSend = key;
    if (_ctrlPressed && key.length == 1) {
      final code = key.toUpperCase().codeUnitAt(0);
      if (code >= 65 && code <= 90) {
        toSend = String.fromCharCode(code - 64);
      }
    }
    manager.sshService?.sendKey(toSend);
    if (_ctrlPressed || _altPressed) {
      setState(() {
        _ctrlPressed = false;
        _altPressed = false;
      });
    }
  }

  void _sendChar(String char, ConnectionManager manager) {
    manager.sshService?.write(char);
  }

  Widget _buildModifierButton(String label, bool isPressed, VoidCallback onPressed, Color fgColor) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Material(
        color: isPressed ? Colors.blue : const Color(0xFF3D3D3D),
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(6),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Text(
              label,
              style: TextStyle(
                color: isPressed ? Colors.white : fgColor,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildKeyButton(String label, VoidCallback onPressed, Color fgColor) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Material(
        color: const Color(0xFF4D4D4D),
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(6),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Text(
              label,
              style: TextStyle(
                color: fgColor,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<bool?> _showDisconnectDialog() {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Disconnect?'),
        content: const Text('Do you want to close this SSH connection?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(
              'Disconnect',
              style: TextStyle(color: Colors.red),
            ),
          ),
        ],
      ),
    );
  }
}
