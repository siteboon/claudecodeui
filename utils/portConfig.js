import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT_CONFIG_FILE = path.join(__dirname, '../.port-config.json');

/**
 * Save the actual ports being used to a config file
 * @param {Object} ports - Object with port information
 * @param {number} ports.backend - Backend server port
 * @param {number} ports.frontend - Frontend dev server port
 */
export function savePortConfig(ports) {
  try {
    fs.writeFileSync(PORT_CONFIG_FILE, JSON.stringify(ports, null, 2));
  } catch (error) {
    console.error('Failed to save port configuration:', error);
  }
}

/**
 * Read the saved port configuration
 * @returns {Object|null} - Port configuration or null if not found
 */
export function readPortConfig() {
  try {
    if (fs.existsSync(PORT_CONFIG_FILE)) {
      const content = fs.readFileSync(PORT_CONFIG_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Failed to read port configuration:', error);
  }
  return null;
}

/**
 * Delete the port configuration file
 */
export function deletePortConfig() {
  try {
    if (fs.existsSync(PORT_CONFIG_FILE)) {
      fs.unlinkSync(PORT_CONFIG_FILE);
    }
  } catch (error) {
    console.error('Failed to delete port configuration:', error);
  }
}