// Simple Puppeteer test for Claude Code UI
import puppeteer from 'puppeteer';

const APP_URL = `http://localhost:${process.env.VITE_PORT || 3009}`;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testUI() {
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: { width: 1280, height: 800 }
  });
  
  const page = await browser.newPage();
  
  // Track console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.log('❌ Console Error:', msg.text());
    }
  });
  
  page.on('pageerror', err => {
    consoleErrors.push(err.toString());
    console.log('❌ Page Error:', err.toString());
  });
  
  try {
    console.log('🚀 Starting Puppeteer test...\n');
    
    // Navigate to the app
    console.log('📍 Navigating to', APP_URL);
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: 'screenshots/01-initial.png' });
    
    // Check current page state
    const pageTitle = await page.title();
    console.log('📄 Page title:', pageTitle);
    
    // Check if we're on login page
    const loginForm = await page.$('input[type="password"]');
    if (loginForm) {
      console.log('🔐 Login page detected');
      
      // Since we don't know the password, let's just document the login page
      await page.screenshot({ path: 'screenshots/02-login-page.png' });
      
      // Check for any visible errors on the page
      const errorElements = await page.$$('[class*="error"], [class*="Error"]');
      console.log(`🔍 Found ${errorElements.length} potential error elements`);
    }
    
    // Check page structure
    console.log('\n📋 Checking page elements:');
    
    const elements = {
      'Username input': 'input[placeholder*="username" i]',
      'Password input': 'input[type="password"]',
      'Submit button': 'button[type="submit"]',
      'Sign in button': 'button:has-text("Sign In")',
      'Welcome text': ':has-text("Welcome")',
      'Form container': 'form, [class*="form"]',
      'Dark mode': '.dark',
    };
    
    for (const [name, selector] of Object.entries(elements)) {
      try {
        const element = await page.$(selector);
        console.log(`  ${element ? '✅' : '⭕'} ${name}`);
      } catch (e) {
        console.log(`  ⭕ ${name} (selector error)`);
      }
    }
    
    // Check console errors summary
    console.log(`\n📊 Console errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.log('Console errors found:');
      consoleErrors.forEach((err, i) => {
        console.log(`  ${i + 1}. ${err}`);
      });
    }
    
    // Performance metrics
    const metrics = await page.metrics();
    console.log('\n⚡ Performance metrics:');
    console.log(`  Heap size: ${(metrics.JSHeapUsedSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  DOM nodes: ${metrics.Nodes}`);
    console.log(`  JS event listeners: ${metrics.JSEventListeners}`);
    
    console.log('\n✅ Test completed! Browser remains open for inspection.');
    
  } catch (error) {
    console.error('\n❌ Test error:', error.message);
    await page.screenshot({ path: 'screenshots/error.png' });
  }
}

// Create screenshots directory
import { mkdirSync } from 'fs';
mkdirSync('screenshots', { recursive: true });

// Run test
testUI();