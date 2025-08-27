export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/cursor/', '');
  
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
    // Route Cursor requests
    switch (path) {
      case 'config':
        return handleCursorConfig(request, corsHeaders);
      case 'mcp':
        return handleCursorMCP(request, corsHeaders);
      case 'chat':
        return handleCursorChat(request, corsHeaders);
      case 'completion':
        return handleCursorCompletion(request, corsHeaders);
      case 'edit':
        return handleCursorEdit(request, corsHeaders);
      case 'explain':
        return handleCursorExplain(request, corsHeaders);
      case 'test':
        return handleCursorTest(request, corsHeaders);
      default:
        return new Response(JSON.stringify({ error: 'Cursor endpoint not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Cursor Config
async function handleCursorConfig(request, corsHeaders) {
  const config = {
    apiKey: process.env.CURSOR_API_KEY || 'demo-cursor-key',
    model: 'claude-3-sonnet-20240229',
    temperature: 0.7,
    maxTokens: 4000,
    features: {
      chat: true,
      completion: true,
      edit: true,
      explain: true,
      test: true
    },
    settings: {
      autoSave: true,
      theme: 'dark',
      fontSize: 14,
      tabSize: 2
    }
  };
  
  return new Response(JSON.stringify(config), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Cursor MCP
async function handleCursorMCP(request, corsHeaders) {
  if (request.method === 'POST') {
    const { action, data } = await request.json();
    
    switch (action) {
      case 'get_tools':
        const tools = [
          {
            name: 'file_reader',
            description: 'Read file contents',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path to read' }
              },
              required: ['path']
            }
          },
          {
            name: 'file_writer',
            description: 'Write content to file',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path to write' },
                content: { type: 'string', description: 'Content to write' }
              },
              required: ['path', 'content']
            }
          },
          {
            name: 'code_analyzer',
            description: 'Analyze code structure and quality',
            parameters: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'Code to analyze' },
                language: { type: 'string', description: 'Programming language' }
              },
              required: ['code']
            }
          }
        ];
        
        return new Response(JSON.stringify({ 
          success: true, 
          tools 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        
      case 'execute_tool':
        const { toolName, parameters } = data;
        
        // Simulate tool execution
        let result;
        switch (toolName) {
          case 'file_reader':
            result = `File content for ${parameters.path}:\n\n// Sample file content\nfunction example() {\n  return "Hello World";\n}`;
            break;
          case 'file_writer':
            result = `Successfully wrote content to ${parameters.path}`;
            break;
          case 'code_analyzer':
            result = `Code analysis for ${parameters.language || 'JavaScript'}:\n\n- Lines: ${parameters.code.split('\n').length}\n- Functions: 1\n- Quality: Good\n- Suggestions: Consider adding error handling`;
            break;
          default:
            result = `Tool ${toolName} executed with parameters: ${JSON.stringify(parameters)}`;
        }
        
        return new Response(JSON.stringify({ 
          success: true, 
          result,
          toolName,
          parameters
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        
      default:
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Unknown MCP action' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  }
}

// Cursor Chat
async function handleCursorChat(request, corsHeaders) {
  if (request.method === 'POST') {
    const { message, context, project, session } = await request.json();
    
    // Simulate AI response
    const responses = [
      `I understand you're asking about: "${message}". This is a simulated response from Cursor AI. In a real implementation, this would be processed by Claude AI with full context awareness.`,
      
      `Based on your message: "${message}", here's what I can help you with:\n\n1. Code analysis and improvements\n2. Bug detection and fixes\n3. Code generation and refactoring\n4. Documentation assistance\n\nWhat specific help do you need?`,
      
      `I see you're working on: "${message}". Let me provide some insights:\n\n- Code structure looks good\n- Consider adding error handling\n- Performance could be optimized\n- Documentation is clear\n\nWould you like me to help with any of these areas?`
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    
    const aiResponse = {
      type: 'ai_response',
      content: randomResponse,
      timestamp: new Date().toISOString(),
      project: project || 'default',
      session: session || 'current',
      suggestions: [
        'Try using async/await for better performance',
        'Consider adding TypeScript for type safety',
        'Implement proper error boundaries',
        'Add unit tests for critical functions'
      ]
    };
    
    return new Response(JSON.stringify(aiResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Cursor Completion
async function handleCursorCompletion(request, corsHeaders) {
  if (request.method === 'POST') {
    const { prompt, language, context } = await request.json();
    
    // Simulate code completion
    const completions = {
      'javascript': `function ${prompt}() {\n  // TODO: Implement function logic\n  return null;\n}`,
      'python': `def ${prompt}():\n    # TODO: Implement function logic\n    pass`,
      'typescript': `function ${prompt}(): void {\n  // TODO: Implement function logic\n}`,
      'html': `<div class="${prompt}">\n  <!-- TODO: Add content -->\n</div>`,
      'css': `.${prompt} {\n  /* TODO: Add styles */\n  display: block;\n}`
    };
    
    const completion = completions[language] || completions['javascript'];
    
    return new Response(JSON.stringify({ 
      success: true, 
      completion,
      language,
      prompt,
      suggestions: [
        'Add error handling',
        'Include input validation',
        'Add JSDoc comments',
        'Consider edge cases'
      ]
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Cursor Edit
async function handleCursorEdit(request, corsHeaders) {
  if (request.method === 'POST') {
    const { code, instructions, language } = await request.json();
    
    // Simulate code editing
    let editedCode = code;
    
    if (instructions.includes('add error handling')) {
      editedCode = code.replace(
        /function (\w+)/g,
        'function $1() {\n  try {\n    // Original code\n  } catch (error) {\n    console.error("Error:", error);\n    throw error;\n  }\n}'
      );
    }
    
    if (instructions.includes('add comments')) {
      editedCode = `/**\n * ${instructions}\n */\n${code}`;
    }
    
    if (instructions.includes('optimize')) {
      editedCode = `// Optimized version\n${code.replace(/console\.log/g, '// console.log')}`;
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      originalCode: code,
      editedCode,
      changes: [
        'Added error handling',
        'Improved code structure',
        'Enhanced readability'
      ],
      language
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Cursor Explain
async function handleCursorExplain(request, corsHeaders) {
  if (request.method === 'POST') {
    const { code, language } = await request.json();
    
    // Simulate code explanation
    const explanation = `This ${language} code does the following:\n\n` +
      `1. **Function Definition**: Defines a function that performs specific operations\n` +
      `2. **Logic Flow**: The code follows a sequential execution pattern\n` +
      `3. **Data Processing**: Handles input data and transforms it accordingly\n` +
      `4. **Output Generation**: Produces results based on the input and logic\n\n` +
      `**Key Components:**\n` +
      `- Variables store intermediate values\n` +
      `- Control structures manage program flow\n` +
      `- Functions encapsulate reusable logic\n\n` +
      `**Best Practices Applied:**\n` +
      `- Clear naming conventions\n` +
      `- Proper indentation and formatting\n` +
      `- Logical structure and organization`;
    
    return new Response(JSON.stringify({ 
      success: true, 
      explanation,
      language,
      codeLength: code.length,
      complexity: 'Medium',
      suggestions: [
        'Consider adding input validation',
        'Add error handling for edge cases',
        'Include JSDoc documentation',
        'Add unit tests for reliability'
      ]
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Cursor Test
async function handleCursorTest(request, corsHeaders) {
  if (request.method === 'POST') {
    const { code, language, testType } = await request.json();
    
    // Simulate test generation
    const tests = {
      'javascript': `describe('Generated Tests', () => {\n  test('should handle basic functionality', () => {\n    expect(true).toBe(true);\n  });\n\n  test('should process input correctly', () => {\n    // TODO: Add specific test cases\n    expect(typeof processInput).toBe('function');\n  });\n});`,
      'python': `import unittest\n\nclass TestGenerated(unittest.TestCase):\n    def test_basic_functionality(self):\n        self.assertTrue(True)\n    \n    def test_input_processing(self):\n        # TODO: Add specific test cases\n        pass\n\nif __name__ == '__main__':\n    unittest.main()`,
      'typescript': `describe('Generated Tests', () => {\n  it('should handle basic functionality', () => {\n    expect(true).toBe(true);\n  });\n\n  it('should process input correctly', () => {\n    // TODO: Add specific test cases\n    expect(typeof processInput).toBe('function');\n  });\n});`
    };
    
    const testCode = tests[language] || tests['javascript'];
    
    return new Response(JSON.stringify({ 
      success: true, 
      testCode,
      language,
      testType: testType || 'unit',
      coverage: '85%',
      suggestions: [
        'Add more edge case tests',
        'Include integration tests',
        'Test error conditions',
        'Add performance tests'
      ]
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}