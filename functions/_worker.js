export default {
  async fetch(request, env, ctx) {
    // Handle SPA routing
    const url = new URL(request.url);
    
    // If it's an API request, return 404 (since we don't have backend)
    if (url.pathname.startsWith('/api/')) {
      return new Response('API not available on Cloudflare Pages', { status: 404 });
    }
    
    // For all other routes, serve index.html
    if (!url.pathname.includes('.')) {
      const indexResponse = await env.ASSETS.fetch('/index.html');
      return new Response(indexResponse.body, {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache'
        }
      });
    }
    
    // For static assets, serve normally
    return env.ASSETS.fetch(request);
  }
};