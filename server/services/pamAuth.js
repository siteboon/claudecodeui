import { spawn } from 'child_process';
import { promisify } from 'util';

class PAMAuthService {
  constructor() {
    this.serviceName = 'login'; // Default PAM service
  }

  /**
   * Authenticate a user using PAM via system commands
   * @param {string} username - The username to authenticate
   * @param {string} password - The password to verify
   * @returns {Promise<boolean>} True if authentication succeeds
   */
  async authenticate(username, password) {
    try {
      // Only use su command for PAM authentication
      const result = await this.authenticateWithSu(username, password);
      return result;
    } catch (error) {
      console.error('PAM authentication error:', error);
      return false;
    }
  }

  /**
   * Authenticate using su command
   */
  async authenticateWithSu(username, password) {
    return new Promise((resolve) => {
      const child = spawn('su', [username, '-c', 'exit'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let error = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        error += data.toString();
      });

      child.on('close', (code) => {
        resolve(code === 0);
      });

      child.on('error', () => {
        resolve(false);
      });

      // Send password to stdin
      child.stdin.write(password + '\n');
      child.stdin.end();

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!child.killed) {
          child.kill();
          resolve(false);
        }
      }, 5000);
    });
  }



  /**
   * Check if PAM authentication is available on this system
   */
  async isAvailable() {
    try {
      // Check if 'su' command is available (only command we need)
      const child = spawn('which', ['su']);
      await new Promise((resolve) => {
        child.on('close', resolve);
      });

      return child.exitCode === 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get user information from system
   */
  async getUserInfo(username) {
    return new Promise((resolve) => {
      const child = spawn('getent', ['passwd', username], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0 && output) {
          const parts = output.trim().split(':');
          resolve({
            username: parts[0],
            uid: parts[2],
            gid: parts[3],
            name: parts[4],
            home: parts[5],
            shell: parts[6]
          });
        } else {
          resolve(null);
        }
      });

      child.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Set the PAM service name
   */
  setServiceName(serviceName) {
    this.serviceName = serviceName;
  }
}

export default new PAMAuthService();