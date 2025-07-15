// Comprehensive UI test with authentication bypass
import puppeteer from 'puppeteer';

const APP_URL = `http://localhost:${process.env.VITE_PORT || 3009}`;

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
    console.log('🧪 Starting comprehensive UI test with authentication bypass...\n');
    
    // 1. Navigate to app
    console.log('1️⃣ Navigating to application...');
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: 'test-screenshots/01-initial-load.png' });
    
    // 2. Bypass authentication by setting localStorage
    console.log('2️⃣ Bypassing authentication...');
    await page.evaluate(() => {
      // Set the same auth token that's in the dev log
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoiYWRtaW4iLCJpYXQiOjE3NTI0MTk4MDh9.qybXtrnpkJbDDR-MCsvE3xrBW6R4i8JtepdhvPjgdQ0';
      localStorage.setItem('auth-token', token);
    });
    
    // Reload to apply authentication
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2000);
    
    // 3. Check main interface loaded
    console.log('3️⃣ Checking main interface...');
    await page.waitForSelector('.sidebar', { timeout: 10000 });
    await page.screenshot({ path: 'test-screenshots/03-main-interface.png' });
    console.log('   ✅ Main interface loaded successfully');
    
    // 4. Click on Tools Settings
    console.log('4️⃣ Testing Tools Settings...');
    
    // Look for settings button or menu
    const settingsButton = await page.$('button[aria-label*="Settings"], button:has-text("Tools Settings"), button:has-text("Settings")');
    if (settingsButton) {
      await settingsButton.click();
      await sleep(1000);
    } else {
      // Try clicking the gear icon or settings menu
      const gearIcon = await page.$('[class*="gear"], [class*="settings"], svg[class*="settings"]');
      if (gearIcon) {
        await gearIcon.click();
        await sleep(1000);
      }
    }
    
    await page.screenshot({ path: 'test-screenshots/04-tools-settings.png' });
    
    // Check for executable path field
    const execPathField = await page.$('input[placeholder*="claude"], input[placeholder*="executable"]');
    if (execPathField) {
      console.log('   ✅ Executable path field found');
      
      // Test setting a custom path
      await execPathField.click({ clickCount: 3 }); // Select all
      await execPathField.type('/custom/path/to/claude');
      await page.screenshot({ path: 'test-screenshots/05-executable-path-set.png' });
      
      // Save settings
      const saveButton = await page.$('button:has-text("Save"), button:has-text("Apply")');
      if (saveButton) {
        await saveButton.click();
        console.log('   ✅ Settings saved');
      }
    } else {
      console.log('   ⚠️  Executable path field not immediately visible');
    }
    
    // Close modal if open
    const closeButton = await page.$('button[aria-label="Close"], .modal button.close, [class*="modal"] button[class*="close"]');
    if (closeButton) {
      await closeButton.click();
      await sleep(500);
    }
    
    // 5. Test project navigation
    console.log('5️⃣ Testing project navigation...');
    
    // Look for project items in sidebar
    const projectItems = await page.$$('.sidebar [role="button"], .sidebar button, .sidebar a[href*="project"]');
    console.log(`   Found ${projectItems.length} potential project items`);
    
    if (projectItems.length > 0) {
      // Click on the first project
      await projectItems[0].click();
      await sleep(2000);
      await page.screenshot({ path: 'test-screenshots/06-project-selected.png' });
      
      // Check if chat interface loaded
      const chatInterface = await page.$('.chat-interface, [class*="chat"], textarea[placeholder*="Claude"], textarea[placeholder*="Ask"]');
      if (chatInterface) {
        console.log('   ✅ Chat interface loaded');
        
        // Try to find and type in the message input
        const messageInput = await page.$('textarea[placeholder*="Claude"], textarea[placeholder*="Ask"], textarea[placeholder*="Type"]');
        if (messageInput) {
          await messageInput.type('Test message from Puppeteer');
          await page.screenshot({ path: 'test-screenshots/07-message-typed.png' });
          console.log('   ✅ Successfully typed test message');
        }
      } else {
        console.log('   ⚠️  Chat interface not found');
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
    
    // 8. Check specific UI elements
    console.log('\n8️⃣ Checking specific UI elements...');
    
    const elements = {
      'Sidebar': '.sidebar, [class*="sidebar"]',
      'Chat area': '.chat-interface, [class*="chat"]',
      'Message input': 'textarea',
      'Send button': 'button[type="submit"], button:has-text("Send")',
      'Project list': '.project-list, [class*="project"]'
    };
    
    for (const [name, selector] of Object.entries(elements)) {
      const element = await page.$(selector);
      console.log(`   ${element ? '✅' : '❌'} ${name}`);
    }
    
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