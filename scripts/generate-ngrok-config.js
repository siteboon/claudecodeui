#!/usr/bin/env node
/**
 * Generate ngrok configuration from environment variables
 * Automatically creates ngrok.local.yml with your Pro settings
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#')) {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
          process.env[key] = values.join('=');
        }
      }
    });
  }
}

// Load environment variables
loadEnv();

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

function generateNgrokConfig() {
  log('\n🔧 Generating ngrok configuration...', colors.blue);

  // Read environment variables
  const subdomain = process.env.NGROK_SUBDOMAIN;
  const domain = process.env.NGROK_DOMAIN;
  const authtoken = process.env.NGROK_AUTHTOKEN;
  const region = process.env.NGROK_REGION || 'us';
  const auth = process.env.NGROK_AUTH;

  if (!authtoken) {
    log('❌ NGROK_AUTHTOKEN not set in .env file', colors.red);
    log('   Please add: NGROK_AUTHTOKEN=your-pro-authtoken', colors.yellow);
    process.exit(1);
  }

  if (!subdomain && !domain) {
    log('❌ Either NGROK_SUBDOMAIN or NGROK_DOMAIN must be set', colors.red);
    log('   NGROK_SUBDOMAIN: Creates subdomain.ngrok.io', colors.yellow);
    log('   NGROK_DOMAIN: Uses full custom domain like your-name.ngrok.app', colors.yellow);
    process.exit(1);
  }

  const config = {
    version: "2",
    authtoken: authtoken,
    region: region,
    log_level: "info",
    log_format: "term",
    web_addr: "localhost:4040",
    update_check: true,
    tunnels: {
      "claude-ui": {
        addr: 5173,
        proto: "http",
        inspect: true,
        schemes: ["https", "http"]
      }
    }
  };

  // Use either subdomain or full domain
  if (domain) {
    config.tunnels["claude-ui"].hostname = domain;
  } else if (subdomain) {
    config.tunnels["claude-ui"].subdomain = subdomain;
  }

  // Add auth if specified
  if (auth && auth.includes(':')) {
    config.tunnels["claude-ui"].auth = auth;
  }

  // Write config file
  const configPath = path.join(process.cwd(), 'ngrok.local.yml');
  const yamlContent = generateYAML(config);

  try {
    fs.writeFileSync(configPath, yamlContent);
    log(`✅ Generated: ${configPath}`, colors.green);

    const finalUrl = domain ? `https://${domain}` : `https://${subdomain}.ngrok.io`;
    log(`🌐 Your fixed URL will be: ${finalUrl}`, colors.green);

    if (auth) {
      log(`🔒 Basic auth enabled: ${auth.split(':')[0]}:***`, colors.yellow);
    }

    log('\n🚀 To start ngrok with this config:', colors.blue);
    log(`   ngrok start claude-ui --config ${configPath}`, colors.yellow);

  } catch (error) {
    log(`❌ Failed to write config: ${error.message}`, colors.red);
    process.exit(1);
  }
}

function generateYAML(obj, indent = 0) {
  const spaces = '  '.repeat(indent);
  let yaml = '';

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      yaml += generateYAML(value, indent + 1);
    } else if (Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      value.forEach(item => {
        yaml += `${spaces}  - ${item}\n`;
      });
    } else {
      yaml += `${spaces}${key}: ${value}\n`;
    }
  }

  return yaml;
}

generateNgrokConfig();
