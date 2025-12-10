#!/usr/bin/env node
/**
 * Environment Check Script for claudecodeui
 * Validates development environment setup on Windows
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function checkCommand(command, description) {
  try {
    execSync(command, { stdio: 'ignore' });
    log(`✅ ${description}`, colors.green);
    return true;
  } catch (error) {
    log(`❌ ${description}`, colors.red);
    return false;
  }
}

function checkFileExists(filePath, description) {
  if (fs.existsSync(filePath)) {
    log(`✅ ${description}`, colors.green);
    return true;
  } else {
    log(`❌ ${description}`, colors.red);
    return false;
  }
}

async function checkEnvironment() {
  log('\n🔍 Environment Check for claudecodeui', colors.bold + colors.blue);
  log('=' .repeat(50), colors.blue);

  const checks = [];

  // Node.js version check
  log('\n📦 Node.js Environment:', colors.yellow);
  try {
    const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion >= 18) {
      log(`✅ Node.js ${nodeVersion} (>= 18.x required)`, colors.green);
      checks.push(true);
    } else {
      log(`❌ Node.js ${nodeVersion} (>= 18.x required)`, colors.red);
      checks.push(false);
    }
  } catch (error) {
    log('❌ Node.js not found', colors.red);
    checks.push(false);
  }

  // npm version
  checks.push(checkCommand('npm --version', 'npm package manager'));

  // Git check
  log('\n📚 Version Control:', colors.yellow);
  checks.push(checkCommand('git --version', 'Git version control'));

  // Python check (for node-gyp)
  log('\n🐍 Python Environment:', colors.yellow);
  checks.push(checkCommand('python --version', 'Python (required for node-gyp)'));

  // Windows-specific checks
  if (os.platform() === 'win32') {
    log('\n🪟 Windows Build Tools:', colors.yellow);

    // Check for Visual Studio Build Tools
    const vsBuildToolsPaths = [
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools',
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools',
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\Community',
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community'
    ];

    let vsFound = false;
    for (const vsPath of vsBuildToolsPaths) {
      if (fs.existsSync(vsPath)) {
        log(`✅ Visual Studio Build Tools found at ${vsPath}`, colors.green);
        vsFound = true;
        break;
      }
    }

    if (!vsFound) {
      log('❌ Visual Studio Build Tools 2022 not found', colors.red);
      log('   Install from: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022', colors.yellow);
    }
    checks.push(vsFound);

    // Check for MSBuild
    checks.push(checkCommand('where msbuild', 'MSBuild (part of VS Build Tools)'));
  }

  // Project files check
  log('\n📁 Project Files:', colors.yellow);
  checks.push(checkFileExists('package.json', 'package.json exists'));
  checks.push(checkFileExists('vite.config.js', 'Vite configuration exists'));
  checks.push(checkFileExists('server/index.js', 'Server entry point exists'));
  checks.push(checkFileExists('WINDOWS_BUILD_GUIDE.md', 'Windows build guide exists'));

  // Environment file check
  log('\n⚙️  Environment Configuration:', colors.yellow);
  checks.push(checkFileExists('.env.example', '.env.example template exists'));

  if (fs.existsSync('.env')) {
    log('✅ .env file exists', colors.green);
    checks.push(true);
  } else {
    log('⚠️  .env file not found (copy from .env.example)', colors.yellow);
    checks.push(true); // Not critical
  }

  // Native modules check
  log('\n🔧 Native Modules:', colors.yellow);
  const nativeModules = ['better-sqlite3', 'sqlite3', 'bcrypt', 'node-pty'];

  for (const module of nativeModules) {
    const modulePath = path.join('node_modules', module);
    if (fs.existsSync(modulePath)) {
      // Check if compiled binary exists
      const buildPath = path.join(modulePath, 'build');
      if (fs.existsSync(buildPath)) {
        log(`✅ ${module} (compiled)`, colors.green);
        checks.push(true);
      } else {
        log(`⚠️  ${module} (needs compilation)`, colors.yellow);
        checks.push(true); // Will be compiled during install
      }
    } else {
      log(`❌ ${module} (not installed)`, colors.red);
      checks.push(false);
    }
  }

  // Port availability check
  log('\n🌐 Port Availability:', colors.yellow);
  try {
    execSync('netstat -ano | findstr ":3001"', { stdio: 'ignore' });
    log('⚠️  Port 3001 is in use (may need to kill existing process)', colors.yellow);
  } catch (error) {
    log('✅ Port 3001 is available', colors.green);
  }

  try {
    execSync('netstat -ano | findstr ":5173"', { stdio: 'ignore' });
    log('⚠️  Port 5173 is in use (may need to kill existing process)', colors.yellow);
  } catch (error) {
    log('✅ Port 5173 is available', colors.green);
  }

  // Summary
  log('\n📊 Summary:', colors.bold + colors.blue);
  log('=' .repeat(50), colors.blue);

  const passed = checks.filter(Boolean).length;
  const total = checks.length;
  const percentage = Math.round((passed / total) * 100);

  if (percentage >= 90) {
    log(`🎉 Environment check passed: ${passed}/${total} (${percentage}%)`, colors.green + colors.bold);
    log('✨ Your environment is ready for development!', colors.green);
  } else if (percentage >= 70) {
    log(`⚠️  Environment check partial: ${passed}/${total} (${percentage}%)`, colors.yellow + colors.bold);
    log('🔧 Some issues need attention before development', colors.yellow);
  } else {
    log(`❌ Environment check failed: ${passed}/${total} (${percentage}%)`, colors.red + colors.bold);
    log('🚨 Please fix the issues above before proceeding', colors.red);
  }

  // Recommendations
  log('\n💡 Next Steps:', colors.blue);
  if (percentage < 100) {
    log('1. Fix the issues marked with ❌ above', colors.yellow);
    log('2. See WINDOWS_BUILD_GUIDE.md for detailed instructions', colors.yellow);
    log('3. Run "npm run check" again after fixes', colors.yellow);
  } else {
    log('1. Run "npm run dev" to start development', colors.green);
    log('2. Visit http://localhost:5173 for frontend', colors.green);
    log('3. Backend API will be at http://localhost:3001', colors.green);
  }

  process.exit(percentage >= 70 ? 0 : 1);
}

// Run the check
checkEnvironment().catch(console.error);
