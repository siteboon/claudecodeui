import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/ssh_connection.dart';
import '../services/connection_manager.dart';

class AddConnectionDialog extends StatefulWidget {
  final SSHConnection? connection;

  const AddConnectionDialog({super.key, this.connection});

  @override
  State<AddConnectionDialog> createState() => _AddConnectionDialogState();
}

class _AddConnectionDialogState extends State<AddConnectionDialog> {
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _nameController;
  late TextEditingController _hostController;
  late TextEditingController _portController;
  late TextEditingController _usernameController;

  bool get isEditing => widget.connection != null;

  @override
  void initState() {
    super.initState();
    _nameController =
        TextEditingController(text: widget.connection?.name ?? '');
    _hostController =
        TextEditingController(text: widget.connection?.host ?? '');
    _portController =
        TextEditingController(text: (widget.connection?.port ?? 2222).toString());
    _usernameController =
        TextEditingController(text: widget.connection?.username ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    _hostController.dispose();
    _portController.dispose();
    _usernameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(isEditing ? 'Edit Connection' : 'Add New Connection'),
      content: SingleChildScrollView(
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'Connection Name',
                  hintText: 'My Server',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.label),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter a name';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _hostController,
                decoration: const InputDecoration(
                  labelText: 'Host',
                  hintText: '192.168.1.100 or my-server.com',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.dns),
                ),
                keyboardType: TextInputType.url,
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter a host';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _portController,
                decoration: const InputDecoration(
                  labelText: 'Port',
                  hintText: '2222',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.numbers),
                ),
                keyboardType: TextInputType.number,
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter a port';
                  }
                  final port = int.tryParse(value);
                  if (port == null || port < 1 || port > 65535) {
                    return 'Invalid port number';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _usernameController,
                decoration: const InputDecoration(
                  labelText: 'Username',
                  hintText: 'Your Claude Code UI username',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.person),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter a username';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 8),
              Text(
                'Use the same credentials as your Claude Code UI login',
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.grey[500],
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: _saveConnection,
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFDA7756),
          ),
          child: Text(isEditing ? 'Save' : 'Add'),
        ),
      ],
    );
  }

  void _saveConnection() {
    if (_formKey.currentState?.validate() != true) return;

    final manager = context.read<ConnectionManager>();

    final connection = SSHConnection(
      id: widget.connection?.id ?? DateTime.now().millisecondsSinceEpoch.toString(),
      name: _nameController.text.trim(),
      host: _hostController.text.trim(),
      port: int.parse(_portController.text.trim()),
      username: _usernameController.text.trim(),
      lastConnected: widget.connection?.lastConnected,
    );

    if (isEditing) {
      manager.updateConnection(connection);
    } else {
      manager.addConnection(connection);
    }

    Navigator.pop(context);
  }
}
