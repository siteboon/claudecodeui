#!/usr/bin/env node

import { getBestClaudeBinary, detectClaudeInstallations, loadClaudeConfig } from './server/utils/claude-detector.js';

console.log('🔍 Testing Claude CLI Detection\n');

// Test 1: Detect all installations
console.log('Test 1: Detecting all Claude installations...');
const installations = await detectClaudeInstallations();
console.log(`Found ${installations.length} Claude installation(s):`);
installations.forEach(inst => {
  console.log(`  - ${inst.path}`);
  console.log(`    Version: ${inst.version}`);
  console.log(`    Valid: ${inst.isValid ? '✅' : '❌'}`);
});

console.log('\n---\n');

// Test 2: Get best binary
console.log('Test 2: Getting best Claude binary...');
const config = await loadClaudeConfig();
const best = await getBestClaudeBinary(config.claudeBinaryPath);

if (best.path) {
  console.log(`✅ Best Claude binary found:`);
  console.log(`   Path: ${best.path}`);
  console.log(`   Version: ${best.version}`);
  if (best.error) {
    console.log(`   ⚠️ Warning: ${best.error}`);
  }
} else {
  console.log(`❌ No suitable Claude binary found`);
  console.log(`   Error: ${best.error}`);
}

if (best.allInstallations && best.allInstallations.length > 1) {
  console.log('\n📋 All installations detected:');
  best.allInstallations.forEach(inst => {
    console.log(`   - ${inst.path} (v${inst.version}) ${inst.isValid ? '✅' : '❌'}`);
  });
}

console.log('\n---\n');

// Test 3: Test with custom path
console.log('Test 3: Testing with invalid custom path...');
const customTest = await getBestClaudeBinary('/fake/path/to/claude');
console.log(`Result: ${customTest.error || 'Success'}`);

console.log('\n✅ Tests complete!');