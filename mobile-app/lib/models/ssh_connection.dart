class SSHConnection {
  final String id;
  final String name;
  final String host;
  final int port;
  final String username;
  final String? password;
  final DateTime? lastConnected;

  SSHConnection({
    required this.id,
    required this.name,
    required this.host,
    this.port = 2222,
    required this.username,
    this.password,
    this.lastConnected,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'host': host,
        'port': port,
        'username': username,
        'lastConnected': lastConnected?.toIso8601String(),
      };

  factory SSHConnection.fromJson(Map<String, dynamic> json) => SSHConnection(
        id: json['id'],
        name: json['name'],
        host: json['host'],
        port: json['port'] ?? 2222,
        username: json['username'],
        lastConnected: json['lastConnected'] != null
            ? DateTime.parse(json['lastConnected'])
            : null,
      );

  SSHConnection copyWith({
    String? id,
    String? name,
    String? host,
    int? port,
    String? username,
    String? password,
    DateTime? lastConnected,
  }) {
    return SSHConnection(
      id: id ?? this.id,
      name: name ?? this.name,
      host: host ?? this.host,
      port: port ?? this.port,
      username: username ?? this.username,
      password: password ?? this.password,
      lastConnected: lastConnected ?? this.lastConnected,
    );
  }
}
