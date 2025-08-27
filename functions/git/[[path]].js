export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/git/', '');
  
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
    // Route Git operations
    switch (path) {
      case 'status':
        return handleGitStatus(request, corsHeaders);
      case 'branches':
        return handleGitBranches(request, corsHeaders);
      case 'remote-status':
        return handleGitRemoteStatus(request, corsHeaders);
      case 'checkout':
        return handleGitCheckout(request, corsHeaders);
      case 'create-branch':
        return handleGitCreateBranch(request, corsHeaders);
      case 'fetch':
        return handleGitFetch(request, corsHeaders);
      case 'pull':
        return handleGitPull(request, corsHeaders);
      case 'push':
        return handleGitPush(request, corsHeaders);
      case 'publish':
        return handleGitPublish(request, corsHeaders);
      case 'discard':
        return handleGitDiscard(request, corsHeaders);
      case 'delete-untracked':
        return handleGitDeleteUntracked(request, corsHeaders);
      case 'diff':
        return handleGitDiff(request, corsHeaders);
      case 'commits':
        return handleGitCommits(request, corsHeaders);
      case 'commit-diff':
        return handleGitCommitDiff(request, corsHeaders);
      case 'generate-commit-message':
        return handleGitGenerateCommitMessage(request, corsHeaders);
      case 'commit':
        return handleGitCommit(request, corsHeaders);
      default:
        return new Response(JSON.stringify({ error: 'Git operation not found' }), {
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

// Git status
async function handleGitStatus(request, corsHeaders) {
  const url = new URL(request.url);
  const project = url.searchParams.get('project');
  
  const status = {
    branch: 'main',
    ahead: 2,
    behind: 0,
    staged: ['file1.js', 'file2.css'],
    unstaged: ['file3.html'],
    untracked: ['new-file.txt'],
    project
  };
  
  return new Response(JSON.stringify(status), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Git branches
async function handleGitBranches(request, corsHeaders) {
  const url = new URL(request.url);
  const project = url.searchParams.get('project');
  
  const branches = [
    { name: 'main', current: true, lastCommit: 'abc123', message: 'Latest changes' },
    { name: 'feature/new-ui', current: false, lastCommit: 'def456', message: 'Add new UI components' },
    { name: 'bugfix/login', current: false, lastCommit: 'ghi789', message: 'Fix login issue' }
  ];
  
  return new Response(JSON.stringify(branches), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Git remote status
async function handleGitRemoteStatus(request, corsHeaders) {
  const url = new URL(request.url);
  const project = url.searchParams.get('project');
  
  const remoteStatus = {
    remote: 'origin',
    url: 'https://github.com/user/repo.git',
    ahead: 2,
    behind: 0,
    project
  };
  
  return new Response(JSON.stringify(remoteStatus), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Git checkout
async function handleGitCheckout(request, corsHeaders) {
  if (request.method === 'POST') {
    const { branch } = await request.json();
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Switched to branch: ${branch}`,
      currentBranch: branch
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Git create branch
async function handleGitCreateBranch(request, corsHeaders) {
  if (request.method === 'POST') {
    const { branch, startPoint } = await request.json();
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Created branch: ${branch}`,
      branch,
      startPoint
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Git fetch
async function handleGitFetch(request, corsHeaders) {
  if (request.method === 'POST') {
    const { remote } = await request.json();
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Fetched from ${remote}`,
      changes: ['new commits', 'updated refs']
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Git pull
async function handleGitPull(request, corsHeaders) {
  if (request.method === 'POST') {
    const { remote, branch } = await request.json();
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Pulled from ${remote}/${branch}`,
      changes: ['merged commits', 'updated files']
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Git push
async function handleGitPush(request, corsHeaders) {
  if (request.method === 'POST') {
    const { remote, branch } = await request.json();
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Pushed to ${remote}/${branch}`,
      pushed: ['commits', 'tags']
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Git publish
async function handleGitPublish(request, corsHeaders) {
  if (request.method === 'POST') {
    const { branch } = await request.json();
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Published branch: ${branch}`,
      published: branch
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Git discard
async function handleGitDiscard(request, corsHeaders) {
  if (request.method === 'POST') {
    const { files } = await request.json();
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Discarded changes in ${files.length} files`,
      discarded: files
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Git delete untracked
async function handleGitDeleteUntracked(request, corsHeaders) {
  if (request.method === 'POST') {
    const { files } = await request.json();
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Deleted ${files.length} untracked files`,
      deleted: files
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Git diff
async function handleGitDiff(request, corsHeaders) {
  const url = new URL(request.url);
  const project = url.searchParams.get('project');
  const file = url.searchParams.get('file');
  
  const diff = `diff --git a/${file} b/${file}
index abc123..def456 100644
--- a/${file}
+++ b/${file}
@@ -1,3 +1,4 @@
 // Original content
+// New content added
 // More content
 // End of file`;
  
  return new Response(JSON.stringify({ 
    diff,
    file,
    project
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Git commits
async function handleGitCommits(request, corsHeaders) {
  const url = new URL(request.url);
  const project = url.searchParams.get('project');
  
  const commits = [
    { hash: 'abc123', author: 'User Name', date: '2024-01-01', message: 'Initial commit' },
    { hash: 'def456', author: 'User Name', date: '2024-01-02', message: 'Add new features' },
    { hash: 'ghi789', author: 'User Name', date: '2024-01-03', message: 'Fix bugs' }
  ];
  
  return new Response(JSON.stringify(commits), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Git commit diff
async function handleGitCommitDiff(request, corsHeaders) {
  const url = new URL(request.url);
  const project = url.searchParams.get('project');
  const commit = url.searchParams.get('commit');
  
  const diff = `commit ${commit}
Author: User Name <user@example.com>
Date: 2024-01-01 12:00:00 +0000

    Commit message

diff --git a/file.js b/file.js
index abc123..def456 100644
--- a/file.js
+++ b/file.js
@@ -1,3 +1,4 @@
 // Original content
+// New content
 // More content`;
  
  return new Response(JSON.stringify({ 
    diff,
    commit,
    project
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Git generate commit message
async function handleGitGenerateCommitMessage(request, corsHeaders) {
  if (request.method === 'POST') {
    const { changes } = await request.json();
    
    const message = `feat: add new features and improvements

- Added new UI components
- Improved performance
- Fixed minor bugs

Changes: ${changes.join(', ')}`;
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Generated commit message',
      commitMessage: message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Git commit
async function handleGitCommit(request, corsHeaders) {
  if (request.method === 'POST') {
    const { message, files } = await request.json();
    
    const commitHash = 'abc123def456';
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Committed successfully',
      commitHash,
      committedFiles: files,
      commitMessage: message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}