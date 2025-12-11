import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'screens/home_screen.dart';
import 'screens/terminal_screen.dart';
import 'screens/settings_screen.dart';
import 'services/connection_manager.dart';
import 'services/settings_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize settings service
  final settingsService = SettingsService();
  await settingsService.loadSettings();

  runApp(ClaudeCodeMobileApp(settingsService: settingsService));
}

class ClaudeCodeMobileApp extends StatelessWidget {
  final SettingsService settingsService;

  const ClaudeCodeMobileApp({super.key, required this.settingsService});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => ConnectionManager()),
        ChangeNotifierProvider.value(value: settingsService),
      ],
      child: MaterialApp(
        title: 'Claude Code Mobile',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFFDA7756), // Claude orange
            brightness: Brightness.dark,
          ),
          useMaterial3: true,
          scaffoldBackgroundColor: const Color(0xFF1E1E1E),
          appBarTheme: const AppBarTheme(
            backgroundColor: Color(0xFF2D2D2D),
            foregroundColor: Colors.white,
            elevation: 0,
          ),
        ),
        darkTheme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFFDA7756),
            brightness: Brightness.dark,
          ),
          useMaterial3: true,
          scaffoldBackgroundColor: const Color(0xFF1E1E1E),
        ),
        themeMode: ThemeMode.dark,
        initialRoute: '/',
        routes: {
          '/': (context) => const HomeScreen(),
          '/terminal': (context) => const TerminalScreen(),
          '/settings': (context) => const SettingsScreen(),
        },
      ),
    );
  }
}
