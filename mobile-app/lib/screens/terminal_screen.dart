import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:xterm/xterm.dart';
import '../services/connection_manager.dart';

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

  @override
  void initState() {
    super.initState();
    _terminal = Terminal(
      maxLines: 10000,
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

    // Listen to SSH output
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

    // Handle terminal input
    _terminal.onOutput = (data) {
      sshService.write(data);
    };

    // Handle terminal resize
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
    return Consumer<ConnectionManager>(
      builder: (context, manager, child) {
        final connection = manager.currentConnection;

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
            appBar: AppBar(
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
                // Connection status indicator
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
                  icon: Icon(_showKeyboard
                      ? Icons.keyboard_hide
                      : Icons.keyboard),
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
                // Terminal view
                Expanded(
                  child: TerminalView(
                    _terminal,
                    controller: _terminalController,
                    autofocus: true,
                    backgroundOpacity: 1.0,
                    onSecondaryTapDown: (details, offset) async {
                      // Paste from clipboard on long press
                      final data = await Clipboard.getData('text/plain');
                      if (data?.text != null) {
                        manager.sshService?.write(data!.text!);
                      }
                    },
                    theme: const TerminalTheme(
                      cursor: Color(0xFFFFFFFF),
                      selection: Color(0xFF264F78),
                      foreground: Color(0xFFD4D4D4),
                      background: Color(0xFF1E1E1E),
                      black: Color(0xFF000000),
                      red: Color(0xFFCD3131),
                      green: Color(0xFF0DBC79),
                      yellow: Color(0xFFE5E510),
                      blue: Color(0xFF2472C8),
                      magenta: Color(0xFFBC3FBC),
                      cyan: Color(0xFF11A8CD),
                      white: Color(0xFFE5E5E5),
                      brightBlack: Color(0xFF666666),
                      brightRed: Color(0xFFF14C4C),
                      brightGreen: Color(0xFF23D18B),
                      brightYellow: Color(0xFFF5F543),
                      brightBlue: Color(0xFF3B8EEA),
                      brightMagenta: Color(0xFFD670D6),
                      brightCyan: Color(0xFF29B8DB),
                      brightWhite: Color(0xFFFFFFFF),
                      searchHitBackground: Color(0xFFFFDF00),
                      searchHitBackgroundCurrent: Color(0xFFFF9632),
                      searchHitForeground: Color(0xFF000000),
                    ),
                  ),
                ),

                // Virtual keyboard bar
                if (_showKeyboard) _buildVirtualKeyboard(manager),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildVirtualKeyboard(ConnectionManager manager) {
    return Container(
      color: const Color(0xFF2D2D2D),
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      child: Column(
        children: [
          // Special keys row
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildKeyButton('Esc', () => manager.sshService?.sendKey('\x1b')),
                _buildKeyButton('Tab', () => manager.sshService?.sendKey('\t')),
                _buildKeyButton('Ctrl', () {}, isModifier: true),
                _buildKeyButton('↑', () => manager.sshService?.sendKey('\x1b[A')),
                _buildKeyButton('↓', () => manager.sshService?.sendKey('\x1b[B')),
                _buildKeyButton('←', () => manager.sshService?.sendKey('\x1b[D')),
                _buildKeyButton('→', () => manager.sshService?.sendKey('\x1b[C')),
                _buildKeyButton('⌫', () => manager.sshService?.sendKey('\x7f')),
                _buildKeyButton('Enter', () => manager.sshService?.sendKey('\r')),
              ],
            ),
          ),
          const SizedBox(height: 8),
          // Ctrl+key shortcuts row
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildKeyButton('Ctrl+C', () => manager.sshService?.sendKey('\x03')),
                _buildKeyButton('Ctrl+D', () => manager.sshService?.sendKey('\x04')),
                _buildKeyButton('Ctrl+Z', () => manager.sshService?.sendKey('\x1a')),
                _buildKeyButton('Ctrl+L', () => manager.sshService?.sendKey('\x0c')),
                _buildKeyButton('Ctrl+A', () => manager.sshService?.sendKey('\x01')),
                _buildKeyButton('Ctrl+E', () => manager.sshService?.sendKey('\x05')),
                _buildKeyButton('Ctrl+R', () => manager.sshService?.sendKey('\x12')),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildKeyButton(String label, VoidCallback onPressed,
      {bool isModifier = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Material(
        color: isModifier ? const Color(0xFF3D3D3D) : const Color(0xFF4D4D4D),
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(6),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.white,
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
