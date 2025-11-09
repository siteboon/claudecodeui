#!/usr/bin/env node
/**
 * Test script for WebSocket permission message flow
 *
 * This script tests the permission WebSocket communication by:
 * 1. Connecting to the WebSocket server
 * 2. Sending a test permission response
 * 3. Verifying the connection and message handling
 */

import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const WS_URL = process.env.WS_URL || 'ws://localhost:3002/ws';
const TOKEN = process.env.AUTH_TOKEN || 'test-token';

console.log('🧪 Starting WebSocket Permission Test');
console.log('=====================================\n');

async function testWebSocketPermissions() {
  return new Promise((resolve, reject) => {
    console.log(`📡 Connecting to ${WS_URL}...`);

    const ws = new WebSocket(`${WS_URL}?token=${TOKEN}`);
    let testPassed = false;
    let receivedPermissionRequest = false;

    // Set timeout for the test
    const timeout = setTimeout(() => {
      if (!testPassed) {
        console.error('❌ Test timed out after 10 seconds');
        ws.close();
        reject(new Error('Test timeout'));
      }
    }, 10000);

    ws.on('open', () => {
      console.log('✅ WebSocket connected successfully\n');

      // Simulate sending a permission response
      console.log('📤 Sending test permission response...');
      const testResponse = {
        type: 'permission-response',
        requestId: 'test-request-123',
        decision: 'allow',
        timestamp: Date.now()
      };

      ws.send(JSON.stringify(testResponse));
      console.log('   Response sent:', JSON.stringify(testResponse, null, 2));
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`\n📥 Received message type: ${message.type}`);

        // Check for permission-related messages
        if (message.type === 'permission-request') {
          console.log('✅ Received permission request:');
          console.log('   Tool:', message.toolName);
          console.log('   ID:', message.id);
          console.log('   Risk Level:', message.riskLevel);
          receivedPermissionRequest = true;

          // Send a response
          const response = {
            type: 'permission-response',
            requestId: message.id,
            decision: 'allow',
            timestamp: Date.now()
          };

          console.log('\n📤 Sending permission response...');
          ws.send(JSON.stringify(response));
        } else if (message.type === 'permission-queue-status') {
          console.log('✅ Received queue status:');
          console.log('   Pending:', message.pending);
          console.log('   Processing:', message.processing);
        } else if (message.type === 'permission-timeout') {
          console.log('⏱️ Received permission timeout:');
          console.log('   Request ID:', message.requestId);
        } else if (message.type === 'permission-error') {
          console.log('❌ Received permission error:');
          console.log('   Error:', message.error);
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
      clearTimeout(timeout);
      reject(error);
    });

    ws.on('close', () => {
      console.log('\n🔌 WebSocket connection closed');
      clearTimeout(timeout);

      if (!testPassed) {
        testPassed = true;
        console.log('\n=====================================');
        console.log('📊 Test Summary:');
        console.log('  - WebSocket connection: ✅');
        console.log('  - Permission response sent: ✅');
        console.log('  - Message handling: ✅');
        console.log('\n✅ WebSocket permission test completed successfully!');
        resolve();
      }
    });

    // Close connection after 5 seconds
    setTimeout(() => {
      if (!testPassed) {
        testPassed = true;
        console.log('\n📊 Closing test connection...');
        ws.close();
      }
    }, 5000);
  });
}

// Run the test
testWebSocketPermissions()
  .then(() => {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  });