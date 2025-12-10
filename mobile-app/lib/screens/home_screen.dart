import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/ssh_connection.dart';
import '../services/connection_manager.dart';
import '../widgets/connection_card.dart';
import '../widgets/add_connection_dialog.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: const Color(0xFFDA7756),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(
                Icons.terminal,
                color: Colors.white,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            const Text('Claude Code Mobile'),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.info_outline),
            onPressed: () => _showAboutDialog(context),
          ),
        ],
      ),
      body: Consumer<ConnectionManager>(
        builder: (context, manager, child) {
          if (manager.savedConnections.isEmpty) {
            return _buildEmptyState(context);
          }

          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: manager.savedConnections.length,
            itemBuilder: (context, index) {
              final connection = manager.savedConnections[index];
              return ConnectionCard(
                connection: connection,
                onTap: () => _connectToServer(context, connection),
                onEdit: () => _editConnection(context, connection),
                onDelete: () => _deleteConnection(context, connection),
              );
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _addNewConnection(context),
        icon: const Icon(Icons.add),
        label: const Text('Add Server'),
        backgroundColor: const Color(0xFFDA7756),
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: const Color(0xFFDA7756).withOpacity(0.2),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(
                Icons.terminal,
                size: 40,
                color: Color(0xFFDA7756),
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'No Servers Added',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Add a Claude Code UI server to connect via SSH and use Claude Code CLI from your mobile device.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 16,
                color: Colors.grey[400],
              ),
            ),
            const SizedBox(height: 32),
            ElevatedButton.icon(
              onPressed: () => _addNewConnection(context),
              icon: const Icon(Icons.add),
              label: const Text('Add Your First Server'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFDA7756),
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _addNewConnection(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => const AddConnectionDialog(),
    );
  }

  void _editConnection(BuildContext context, SSHConnection connection) {
    showDialog(
      context: context,
      builder: (context) => AddConnectionDialog(connection: connection),
    );
  }

  void _deleteConnection(BuildContext context, SSHConnection connection) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Connection'),
        content: Text('Are you sure you want to delete "${connection.name}"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              context.read<ConnectionManager>().deleteConnection(connection.id);
              Navigator.pop(context);
            },
            child: const Text(
              'Delete',
              style: TextStyle(color: Colors.red),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _connectToServer(
      BuildContext context, SSHConnection connection) async {
    final manager = context.read<ConnectionManager>();

    // Check if we have saved password
    String? savedPassword = await manager.getPassword(connection.id);

    if (!context.mounted) return;

    // Show password dialog
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => _PasswordDialog(
        connection: connection,
        savedPassword: savedPassword,
      ),
    );

    if (result == null || !context.mounted) return;

    final password = result['password'] as String;
    final savePassword = result['savePassword'] as bool;

    try {
      await manager.connect(connection, password, savePassword: savePassword);

      if (context.mounted) {
        Navigator.pushNamed(context, '/terminal');
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Connection failed: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  void _showAboutDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('About'),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Claude Code Mobile',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            SizedBox(height: 8),
            Text(
              'SSH client for Claude Code UI. Connect to your Claude Code server and use the CLI from your mobile device.',
            ),
            SizedBox(height: 16),
            Text(
              'Default SSH Port: 2222',
              style: TextStyle(fontFamily: 'monospace'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }
}

class _PasswordDialog extends StatefulWidget {
  final SSHConnection connection;
  final String? savedPassword;

  const _PasswordDialog({
    required this.connection,
    this.savedPassword,
  });

  @override
  State<_PasswordDialog> createState() => _PasswordDialogState();
}

class _PasswordDialogState extends State<_PasswordDialog> {
  late TextEditingController _passwordController;
  bool _savePassword = false;
  bool _obscurePassword = true;

  @override
  void initState() {
    super.initState();
    _passwordController =
        TextEditingController(text: widget.savedPassword ?? '');
    _savePassword = widget.savedPassword != null;
  }

  @override
  void dispose() {
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Connect to ${widget.connection.name}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _passwordController,
            obscureText: _obscurePassword,
            decoration: InputDecoration(
              labelText: 'Password',
              border: const OutlineInputBorder(),
              suffixIcon: IconButton(
                icon: Icon(
                  _obscurePassword ? Icons.visibility_off : Icons.visibility,
                ),
                onPressed: () {
                  setState(() {
                    _obscurePassword = !_obscurePassword;
                  });
                },
              ),
            ),
            autofocus: widget.savedPassword == null,
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Checkbox(
                value: _savePassword,
                onChanged: (value) {
                  setState(() {
                    _savePassword = value ?? false;
                  });
                },
              ),
              const Text('Save password'),
            ],
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: () {
            Navigator.pop(context, {
              'password': _passwordController.text,
              'savePassword': _savePassword,
            });
          },
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFDA7756),
          ),
          child: const Text('Connect'),
        ),
      ],
    );
  }
}
