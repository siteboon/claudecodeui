// Comprehensive UI test with Puppeteer
import puppeteer from 'puppeteer';

const APP_URL = 'http://localhost:2009';
const TEST_USER = 'testuser';
const TEST_PASS = 'testpass123';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkForConsoleErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push(err.toString());
  });
  return errors;
}

async function runComprehensiveTest() {
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: { width: 1280, height: 800 }
  });
  const page = await browser.newPage();
  
  const errors = await checkForConsoleErrors(page);
  
  try {
    console.log('🧪 Starting comprehensive UI test...\n');
    
    // 1. Navigate to app
    console.log('1️⃣ Navigating to application...');
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: 'test-screenshots/01-initial-load.png' });
    
    // 2. Check if in setup mode (new user registration)
    const setupMode = await page.$('text=Create Your Account') !== null;
    
    if (setupMode) {
      console.log('2️⃣ App in setup mode - creating first user...');
      
      // Fill registration form
      await page.type('input[placeholder*="username"]', TEST_USER);
      await page.type('input[placeholder*="password"]', TEST_PASS);
      await page.type('input[placeholder*="Confirm"]', TEST_PASS);
      
      await page.screenshot({ path: 'test-screenshots/02-setup-filled.png' });
      
      // Submit registration
      await page.click('button[type="submit"]');
      await sleep(2000);
    } else {
      console.log('2️⃣ Login screen detected...');
      
      // Try to login
      await page.type('input[placeholder*="username"]', TEST_USER);
      await page.type('input[placeholder*="password"]', TEST_PASS);
      
      await page.screenshot({ path: 'test-screenshots/02-login-filled.png' });
      
      // Submit login
      await page.click('button[type="submit"]');
      await sleep(2000);
    }
    
    // 3. Check main interface loaded
    console.log('3️⃣ Checking main interface...');
    await page.waitForSelector('.sidebar', { timeout: 5000 });
    await page.screenshot({ path: 'test-screenshots/03-main-interface.png' });
    
    // 4. Click on Tools Settings
    console.log('4️⃣ Testing Tools Settings...');
    const toolsButton = await page.$('text=Tools Settings');
    if (toolsButton) {
      await toolsButton.click();
      await sleep(1000);
      await page.screenshot({ path: 'test-screenshots/04-tools-settings.png' });
      
      // Check for executable path field
      const execPathField = await page.$('input[placeholder*="claude"]');
      if (execPathField) {
        console.log('   ✅ Executable path field found');
        
        // Test setting a custom path
        await execPathField.click({ clickCount: 3 }); // Select all
        await execPathField.type('/custom/path/to/claude');
        await page.screenshot({ path: 'test-screenshots/05-executable-path-set.png' });
      } else {
        console.log('   ❌ Executable path field NOT found');
      }
      
      // Close modal
      const closeButton = await page.$('button[aria-label="Close"]');
      if (closeButton) await closeButton.click();
      await sleep(500);
    }
    
    // 5. Click on a project (if any exist)
    console.log('5️⃣ Testing project selection...');
    const projectButtons = await page.$$('[role="button"]');
    
    if (projectButtons.length > 1) { // More than just the Tools Settings button
      await projectButtons[1].click();
      await sleep(1000);
      await page.screenshot({ path: 'test-screenshots/06-project-selected.png' });
      
      // Check chat interface loaded
      const chatInterface = await page.$('.chat-interface');
      if (chatInterface) {
        console.log('   ✅ Chat interface loaded');
        
        // Try sending a test message
        const textarea = await page.$('textarea[placeholder*="Ask Claude"]');
        if (textarea) {
          await textarea.type('Test message from Puppeteer');
          await page.screenshot({ path: 'test-screenshots/07-message-typed.png' });
        }
      }
    } else {
      console.log('   ℹ️  No projects found to test');
    }
    
    // 6. Check for console errors
    console.log('\n6️⃣ Checking for console errors...');
    if (errors.length > 0) {
      console.log('   ❌ Console errors found:');
      errors.forEach(err => console.log(`      - ${err}`));
    } else {
      console.log('   ✅ No console errors detected');
    }
    
    // 7. Performance check
    console.log('\n7️⃣ Checking performance metrics...');
    const metrics = await page.metrics();
    console.log(`   📊 JS Heap: ${(metrics.JSHeapUsedSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   📊 Documents: ${metrics.Documents}`);
    console.log(`   📊 Nodes: ${metrics.Nodes}`);
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    await page.screenshot({ path: 'test-screenshots/error-state.png' });
  } finally {
    // Keep browser open for manual inspection
    console.log('\n📌 Browser will remain open for manual inspection. Press Ctrl+C to exit.');
    // await browser.close();
  }
}

// Create screenshots directory
import { mkdirSync } from 'fs';
try {
  mkdirSync('test-screenshots', { recursive: true });
} catch (e) {}

// Run the test
runComprehensiveTest();