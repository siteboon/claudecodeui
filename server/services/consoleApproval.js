/**
 * Console-based Permission Approval
 *
 * Provides a fallback console-based approval mechanism for testing
 * the permission system when no frontend is connected.
 */

import readline from 'readline';
import { PermissionDecision } from './permissionTypes.js';

/**
 * ConsoleApproval class
 * Handles permission requests via console interface
 */
export class ConsoleApproval {
  constructor(permissionManager) {
    this.permissionManager = permissionManager;
    this.rl = null;
    this.isActive = false;
    this.pendingPrompt = null;
  }

  /**
   * Starts listening for permission requests
   */
  start() {
    if (this.isActive) {
      return;
    }

    this.isActive = true;

    // Create readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Listen for permission requests from the manager
    this.permissionManager.on('permission-request', (request) => {
      this.handleRequest(request);
    });

    console.log('📋 Console-based permission approval started');
    console.log('   Use [a]llow, [d]eny, [s]ession, or [p]ermanent when prompted');
  }

  /**
   * Handles a permission request
   * @param {Object} request - Permission request
   */
  async handleRequest(request) {
    if (!this.isActive) {
      return;
    }

    // Format the prompt
    console.log('\n' + '='.repeat(60));
    console.log('🔐 PERMISSION REQUEST');
    console.log('='.repeat(60));
    console.log(`Tool: ${request.toolName}`);
    console.log(`Risk Level: ${request.riskLevel}`);
    console.log(`Summary: ${request.summary}`);

    if (process.env.DEBUG && process.env.DEBUG.includes('permissions')) {
      console.log(`Input: ${JSON.stringify(request.input, null, 2)}`);
    }

    console.log('-'.repeat(60));

    // Clear any pending prompt
    if (this.pendingPrompt) {
      this.rl.prompt(false);
    }

    // Ask for user decision
    this.pendingPrompt = new Promise((resolve) => {
      const askQuestion = () => {
        this.rl.question('Decision ([a]llow, [d]eny, [s]ession, [p]ermanent): ', (answer) => {
          const decision = this.parseDecision(answer.toLowerCase().trim());

          if (!decision) {
            console.log('❌ Invalid choice. Please use: a, d, s, or p');
            askQuestion(); // Ask again
            return;
          }

          resolve(decision);
          this.pendingPrompt = null;
        });
      };

      askQuestion();
    });

    try {
      const decision = await this.pendingPrompt;

      // Resolve the permission request
      const success = this.permissionManager.resolveRequest(request.id, decision);

      if (success) {
        console.log(`✅ Permission ${decision === PermissionDecision.DENY ? 'denied' : 'granted'}`);
      } else {
        console.log('⚠️ Failed to resolve permission request (may have timed out)');
      }
    } catch (error) {
      console.error('❌ Error handling permission request:', error.message);
    }

    console.log('='.repeat(60) + '\n');
  }

  /**
   * Parses user input to a permission decision
   * @param {string} input - User input
   * @returns {string|null} Permission decision or null if invalid
   */
  parseDecision(input) {
    switch (input) {
      case 'a':
      case 'allow':
      case 'y':
      case 'yes':
        return PermissionDecision.ALLOW;

      case 'd':
      case 'deny':
      case 'n':
      case 'no':
        return PermissionDecision.DENY;

      case 's':
      case 'session':
        return PermissionDecision.ALLOW_SESSION;

      case 'p':
      case 'permanent':
      case 'always':
        return PermissionDecision.ALLOW_ALWAYS;

      default:
        return null;
    }
  }

  /**
   * Stops the console approval system
   */
  stop() {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;

    // Remove event listeners
    this.permissionManager.removeAllListeners('permission-request');

    // Close readline interface
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    console.log('📋 Console-based permission approval stopped');
  }
}

/**
 * Sets up console approval for testing
 * @param {PermissionManager} permissionManager - Permission manager instance
 * @returns {ConsoleApproval} Console approval instance
 */
export function setupConsoleApproval(permissionManager) {
  const consoleApproval = new ConsoleApproval(permissionManager);

  // Start if in debug mode or explicitly enabled
  if (process.env.CONSOLE_PERMISSIONS === 'true' ||
      (process.env.DEBUG && process.env.DEBUG.includes('permissions'))) {
    consoleApproval.start();
  }

  return consoleApproval;
}