export async function onRequest(context) {
  const { request, env } = context;
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (request.method === 'POST') {
      return handleTranscribe(request, corsHeaders);
    }
    
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Handle transcription
async function handleTranscribe(request, corsHeaders) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');
    const language = formData.get('language') || 'en';
    const model = formData.get('model') || 'whisper-1';
    
    if (!audioFile) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No audio file provided' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Simulate transcription processing
    const transcription = await simulateTranscription(audioFile, language, model);
    
    return new Response(JSON.stringify({
      success: true,
      transcription,
      language,
      model,
      duration: '00:02:30',
      confidence: 0.95,
      segments: [
        {
          start: 0,
          end: 2.5,
          text: 'Hello, this is a demonstration of the transcription service.',
          confidence: 0.98
        },
        {
          start: 2.5,
          end: 5.0,
          text: 'The audio has been successfully processed and converted to text.',
          confidence: 0.95
        },
        {
          start: 5.0,
          end: 7.5,
          text: 'This is a simulated response for demonstration purposes.',
          confidence: 0.92
        }
      ]
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Transcription failed: ' + error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Simulate transcription processing
async function simulateTranscription(audioFile, language, model) {
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Generate different transcriptions based on language
  const transcriptions = {
    'en': 'Hello, this is a demonstration of the transcription service. The audio has been successfully processed and converted to text. This is a simulated response for demonstration purposes.',
    'es': 'Hola, esta es una demostración del servicio de transcripción. El audio ha sido procesado exitosamente y convertido a texto. Esta es una respuesta simulada para propósitos de demostración.',
    'fr': 'Bonjour, ceci est une démonstration du service de transcription. L\'audio a été traité avec succès et converti en texte. Ceci est une réponse simulée à des fins de démonstration.',
    'de': 'Hallo, dies ist eine Demonstration des Transkriptionsdienstes. Die Audio wurde erfolgreich verarbeitet und in Text umgewandelt. Dies ist eine simulierte Antwort zu Demonstrationszwecken.',
    'ar': 'مرحباً، هذه مظاهرة لخدمة النسخ. تمت معالجة الصوت بنجاح وتحويله إلى نص. هذه استجابة محاكاة لأغراض التوضيح.',
    'zh': '你好，这是转录服务的演示。音频已成功处理并转换为文本。这是用于演示目的的模拟响应。',
    'ja': 'こんにちは、これは転写サービスのデモンストレーションです。音声は正常に処理され、テキストに変換されました。これはデモンストレーション目的のシミュレートされた応答です。',
    'ko': '안녕하세요, 이것은 전사 서비스의 데모입니다. 오디오가 성공적으로 처리되어 텍스트로 변환되었습니다. 이것은 데모 목적의 시뮬레이션된 응답입니다.'
  };
  
  return transcriptions[language] || transcriptions['en'];
}