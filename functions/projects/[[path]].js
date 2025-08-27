export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/projects/', '');
  
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
    // Route Projects requests
    if (path === '') {
      return handleProjectsList(request, corsHeaders);
    }
    
    if (path === 'create') {
      return handleProjectCreate(request, corsHeaders);
    }
    
    // Handle project-specific operations
    const parts = path.split('/');
    const projectName = parts[0];
    const operation = parts[1];
    
    if (operation === 'sessions') {
      return handleProjectSessions(projectName, request, corsHeaders);
    }
    
    if (operation === 'files') {
      return handleProjectFiles(projectName, request, corsHeaders);
    }
    
    if (operation === 'file') {
      return handleProjectFile(projectName, request, corsHeaders);
    }
    
    if (operation === 'rename') {
      return handleProjectRename(projectName, request, corsHeaders);
    }
    
    if (operation === 'upload-images') {
      return handleProjectUploadImages(projectName, request, corsHeaders);
    }
    
    return new Response(JSON.stringify({ error: 'Project operation not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Mock projects database
const mockProjects = [
  {
    name: 'demo-project',
    displayName: 'Demo Project',
    path: '/demo',
    description: 'A sample project for demonstration purposes',
    lastModified: '2024-01-01T00:00:00Z',
    size: '2.5 MB',
    fileCount: 15,
    language: 'JavaScript',
    framework: 'React'
  },
  {
    name: 'my-website',
    displayName: 'My Website',
    path: '/website',
    description: 'Personal website built with modern technologies',
    lastModified: '2024-01-02T00:00:00Z',
    size: '1.8 MB',
    fileCount: 12,
    language: 'TypeScript',
    framework: 'Next.js'
  },
  {
    name: 'api-server',
    displayName: 'API Server',
    path: '/api',
    description: 'Backend API server for web applications',
    lastModified: '2024-01-03T00:00:00Z',
    size: '3.2 MB',
    fileCount: 25,
    language: 'Node.js',
    framework: 'Express'
  }
];

// Mock sessions database
const mockSessions = {
  'demo-project': [
    {
      id: 'session-1',
      name: 'Initial Setup',
      lastModified: '2024-01-01T10:00:00Z',
      messageCount: 8,
      status: 'completed'
    },
    {
      id: 'session-2',
      name: 'Feature Development',
      lastModified: '2024-01-01T14:00:00Z',
      messageCount: 15,
      status: 'active'
    }
  ],
  'my-website': [
    {
      id: 'session-3',
      name: 'Design Implementation',
      lastModified: '2024-01-02T09:00:00Z',
      messageCount: 12,
      status: 'completed'
    }
  ],
  'api-server': [
    {
      id: 'session-4',
      name: 'API Design',
      lastModified: '2024-01-03T11:00:00Z',
      messageCount: 20,
      status: 'active'
    }
  ]
};

// Mock files database
const mockFiles = {
  'demo-project': [
    {
      name: 'index.html',
      path: '/index.html',
      type: 'file',
      size: 1024,
      lastModified: '2024-01-01T00:00:00Z',
      language: 'HTML'
    },
    {
      name: 'style.css',
      path: '/style.css',
      type: 'file',
      size: 2048,
      lastModified: '2024-01-01T00:00:00Z',
      language: 'CSS'
    },
    {
      name: 'script.js',
      path: '/script.js',
      type: 'file',
      size: 3072,
      lastModified: '2024-01-01T00:00:00Z',
      language: 'JavaScript'
    },
    {
      name: 'components',
      path: '/components',
      type: 'directory',
      size: 0,
      lastModified: '2024-01-01T00:00:00Z',
      children: [
        {
          name: 'Header.jsx',
          path: '/components/Header.jsx',
          type: 'file',
          size: 1536,
          lastModified: '2024-01-01T00:00:00Z',
          language: 'JSX'
        },
        {
          name: 'Footer.jsx',
          path: '/components/Footer.jsx',
          type: 'file',
          size: 1024,
          lastModified: '2024-01-01T00:00:00Z',
          language: 'JSX'
        }
      ]
    }
  ]
};

// Projects List
async function handleProjectsList(request, corsHeaders) {
  if (request.method === 'GET') {
    return new Response(JSON.stringify(mockProjects), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  if (request.method === 'POST') {
    const { path, displayName, description } = await request.json();
    
    const newProject = {
      name: path.split('/').pop() || 'new-project',
      displayName: displayName || 'New Project',
      path,
      description: description || 'A new project',
      lastModified: new Date().toISOString(),
      size: '0 KB',
      fileCount: 0,
      language: 'Unknown',
      framework: 'None'
    };
    
    mockProjects.push(newProject);
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Project created successfully',
      project: newProject
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Project Create
async function handleProjectCreate(request, corsHeaders) {
  if (request.method === 'POST') {
    const { path, displayName, description } = await request.json();
    
    const newProject = {
      name: path.split('/').pop() || 'new-project',
      displayName: displayName || 'New Project',
      path,
      description: description || 'A new project',
      lastModified: new Date().toISOString(),
      size: '0 KB',
      fileCount: 0,
      language: 'Unknown',
      framework: 'None'
    };
    
    mockProjects.push(newProject);
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Project created successfully',
      project: newProject
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Project Sessions
async function handleProjectSessions(projectName, request, corsHeaders) {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit')) || 10;
    const offset = parseInt(url.searchParams.get('offset')) || 0;
    
    const sessions = mockSessions[projectName] || [];
    const paginatedSessions = sessions.slice(offset, offset + limit);
    
    return new Response(JSON.stringify({
      sessions: paginatedSessions,
      total: sessions.length,
      limit,
      offset
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  if (request.method === 'POST') {
    const { name, description } = await request.json();
    
    const newSession = {
      id: `session-${Date.now()}`,
      name: name || 'New Session',
      lastModified: new Date().toISOString(),
      messageCount: 0,
      status: 'active'
    };
    
    if (!mockSessions[projectName]) {
      mockSessions[projectName] = [];
    }
    
    mockSessions[projectName].push(newSession);
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Session created successfully',
      session: newSession
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Project Files
async function handleProjectFiles(projectName, request, corsHeaders) {
  if (request.method === 'GET') {
    const files = mockFiles[projectName] || [];
    
    return new Response(JSON.stringify({
      files,
      total: files.length,
      project: projectName
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Project File
async function handleProjectFile(projectName, request, corsHeaders) {
  const url = new URL(request.url);
  const filePath = url.searchParams.get('filePath');
  
  if (request.method === 'GET') {
    // Simulate file content
    const fileContent = `// This is the content of ${filePath}
// In a real implementation, this would read the actual file

function example() {
  console.log("Hello from ${filePath}");
  return "File content loaded successfully";
}

export default example;`;
    
    return new Response(JSON.stringify({
      content: fileContent,
      filePath,
      project: projectName,
      size: fileContent.length,
      lastModified: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  if (request.method === 'PUT') {
    const { content } = await request.json();
    
    return new Response(JSON.stringify({
      success: true,
      message: 'File saved successfully',
      filePath,
      project: projectName,
      size: content.length,
      lastModified: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Project Rename
async function handleProjectRename(projectName, request, corsHeaders) {
  if (request.method === 'PUT') {
    const { displayName } = await request.json();
    
    const project = mockProjects.find(p => p.name === projectName);
    if (project) {
      project.displayName = displayName;
      project.lastModified = new Date().toISOString();
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Project renamed successfully',
      project: {
        ...project,
        displayName
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Project Upload Images
async function handleProjectUploadImages(projectName, request, corsHeaders) {
  if (request.method === 'POST') {
    // In real app, this would handle file uploads
    // For demo purposes, we'll simulate success
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Images uploaded successfully',
      project: projectName,
      uploadedFiles: [
        'image1.jpg',
        'image2.png',
        'image3.gif'
      ],
      totalSize: '2.1 MB'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}