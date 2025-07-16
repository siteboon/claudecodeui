// Simple test script for audio streaming functionality
import fetch from 'node-fetch';

async function testTTSProviders() {
  try {
    console.log('Testing TTS providers endpoint...');
    const response = await fetch('http://localhost:3000/api/settings/tts/providers');
    
    if (response.ok) {
      const providers = await response.json();
      console.log('✅ TTS Providers loaded successfully:');
      console.log(JSON.stringify(providers, null, 2));
    } else {
      console.error(`❌ Failed to load TTS providers: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('Error response:', errorText);
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }
}

async function testAudioEndpoints() {
  try {
    console.log('\nTesting audio info endpoint...');
    const response = await fetch('http://localhost:3000/api/audio/info');
    
    if (response.ok) {
      const info = await response.json();
      console.log('✅ Audio info loaded successfully:');
      console.log(JSON.stringify(info, null, 2));
    } else {
      console.error(`❌ Failed to load audio info: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }
}

async function runTests() {
  console.log('🎵 Audio Streaming System Test\n');
  
  await testTTSProviders();
  await testAudioEndpoints();
  
  console.log('\n🏁 Test completed');
}

runTests().catch(console.error);