import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../models/ssh_connection.dart';
import 'ssh_service.dart';

class ConnectionManager extends ChangeNotifier {
  List<SSHConnection> _savedConnections = [];
  SSHConnection? _currentConnection;
  SSHService? _sshService;
  bool _isConnecting = false;
  String? _error;

  List<SSHConnection> get savedConnections => _savedConnections;
  SSHConnection? get currentConnection => _currentConnection;
  SSHService? get sshService => _sshService;
  bool get isConnecting => _isConnecting;
  bool get isConnected => _sshService?.isConnected ?? false;
  String? get error => _error;

  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  ConnectionManager() {
    _loadSavedConnections();
  }

  Future<void> _loadSavedConnections() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final connectionsJson = prefs.getString('saved_connections');
      if (connectionsJson != null) {
        final List<dynamic> decoded = jsonDecode(connectionsJson);
        _savedConnections =
            decoded.map((json) => SSHConnection.fromJson(json)).toList();
        notifyListeners();
      }
    } catch (e) {
      debugPrint('Error loading saved connections: $e');
    }
  }

  Future<void> _saveConnections() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final connectionsJson =
          jsonEncode(_savedConnections.map((c) => c.toJson()).toList());
      await prefs.setString('saved_connections', connectionsJson);
    } catch (e) {
      debugPrint('Error saving connections: $e');
    }
  }

  Future<void> addConnection(SSHConnection connection) async {
    _savedConnections.add(connection);
    await _saveConnections();
    notifyListeners();
  }

  Future<void> updateConnection(SSHConnection connection) async {
    final index = _savedConnections.indexWhere((c) => c.id == connection.id);
    if (index != -1) {
      _savedConnections[index] = connection;
      await _saveConnections();
      notifyListeners();
    }
  }

  Future<void> deleteConnection(String id) async {
    _savedConnections.removeWhere((c) => c.id == id);
    await _secureStorage.delete(key: 'password_$id');
    await _saveConnections();
    notifyListeners();
  }

  Future<void> savePassword(String connectionId, String password) async {
    await _secureStorage.write(key: 'password_$connectionId', value: password);
  }

  Future<String?> getPassword(String connectionId) async {
    return await _secureStorage.read(key: 'password_$connectionId');
  }

  Future<void> connect(SSHConnection connection, String password,
      {bool savePassword = false}) async {
    _isConnecting = true;
    _error = null;
    notifyListeners();

    try {
      _sshService = SSHService();
      await _sshService!.connect(connection, password);

      _currentConnection = connection.copyWith(
        lastConnected: DateTime.now(),
      );

      // Update last connected time
      final index = _savedConnections.indexWhere((c) => c.id == connection.id);
      if (index != -1) {
        _savedConnections[index] = _currentConnection!;
        await _saveConnections();
      }

      // Save password if requested
      if (savePassword) {
        await this.savePassword(connection.id, password);
      }

      _isConnecting = false;
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      _isConnecting = false;
      _sshService = null;
      notifyListeners();
      rethrow;
    }
  }

  Future<void> disconnect() async {
    await _sshService?.disconnect();
    _sshService = null;
    _currentConnection = null;
    notifyListeners();
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }
}
