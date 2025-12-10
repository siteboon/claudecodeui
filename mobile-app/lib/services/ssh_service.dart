import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dartssh2/dartssh2.dart';
import '../models/ssh_connection.dart';

class SSHService {
  SSHClient? _client;
  SSHSession? _session;
  StreamController<String>? _outputController;
  bool _isConnected = false;

  bool get isConnected => _isConnected;

  Stream<String>? get outputStream => _outputController?.stream;

  Future<void> connect(SSHConnection connection, String password) async {
    try {
      _outputController = StreamController<String>.broadcast();

      // Create SSH socket
      final socket = await SSHSocket.connect(
        connection.host,
        connection.port,
        timeout: const Duration(seconds: 30),
      );

      // Create SSH client
      _client = SSHClient(
        socket,
        username: connection.username,
        onPasswordRequest: () => password,
      );

      // Wait for authentication
      await _client!.authenticated;

      // Start shell session
      _session = await _client!.shell(
        pty: SSHPtyConfig(
          type: 'xterm-256color',
          width: 80,
          height: 24,
        ),
      );

      _isConnected = true;

      // Listen to stdout
      _session!.stdout.listen(
        (data) {
          final text = utf8.decode(data, allowMalformed: true);
          _outputController?.add(text);
        },
        onError: (error) {
          _outputController?.addError(error);
        },
        onDone: () {
          disconnect();
        },
      );

      // Listen to stderr
      _session!.stderr.listen(
        (data) {
          final text = utf8.decode(data, allowMalformed: true);
          _outputController?.add(text);
        },
      );
    } catch (e) {
      _isConnected = false;
      rethrow;
    }
  }

  void write(String data) {
    if (_session != null && _isConnected) {
      _session!.stdin.add(utf8.encode(data));
    }
  }

  void sendKey(String key) {
    write(key);
  }

  void resize(int width, int height) {
    if (_session != null && _isConnected) {
      _session!.resizeTerminal(width, height);
    }
  }

  Future<void> disconnect() async {
    _isConnected = false;

    try {
      _session?.close();
      _client?.close();
    } catch (e) {
      // Ignore close errors
    }

    _session = null;
    _client = null;

    await _outputController?.close();
    _outputController = null;
  }
}
