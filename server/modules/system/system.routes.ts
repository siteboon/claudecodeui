import express from 'express';

import type { createSystemUpdateService } from './system.service.js';
import { generateOpenAPISpec, formatEndpointsForHTML, API_ENDPOINTS } from './system.api-docs.js';

/** Creates thin system routes that delegate update execution to the service. */
export function createSystemRouter(
  systemUpdateService: ReturnType<typeof createSystemUpdateService>,
): express.Router {
  const router = express.Router();

  router.post('/update', async (_request, response, next) => {
    try {
      const result = await systemUpdateService.updateSystem();
      response.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      next(error);
    }
  });

  // API Documentation Routes
  /**
   * GET /api/docs/openapi.json
   * Returns OpenAPI 3.0 specification for API documentation tools
   */
  router.get('/docs/openapi.json', (_request, response) => {
    const spec = generateOpenAPISpec();
    response.json(spec);
  });

  /**
   * GET /api/docs/swagger
   * Serves Swagger UI for interactive API documentation
   */
  router.get('/docs/swagger', (_request, response) => {
    const swaggerHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>CloudCLI API - Swagger UI</title>
          <link rel="stylesheet" type="text/css" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.1.0/swagger-ui.min.css">
          <style>
            html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
            *, *:before, *:after { box-sizing: inherit; }
            body { margin: 0; background: #fafafa; }
          </style>
        </head>
        <body>
          <div id="swagger-ui"></div>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.1.0/swagger-ui.min.js"></script>
          <script>
            window.onload = function() {
              SwaggerUIBundle({
                url: '/api/docs/openapi.json',
                dom_id: '#swagger-ui',
                presets: [
                  SwaggerUIBundle.presets.apis,
                  SwaggerUIBundle.SwaggerUIStandalonePreset
                ],
                layout: "StandaloneLayout"
              });
            }
          </script>
        </body>
      </html>
    `;
    response.type('text/html').send(swaggerHtml);
  });

  /**
   * GET /api/docs/endpoints
   * Returns JSON list of all available API endpoints
   */
  router.get('/docs/endpoints', (_request, response) => {
    response.json(API_ENDPOINTS);
  });

  /**
   * GET /api/docs/html
   * Returns formatted HTML documentation
   */
  router.get('/docs/html', (_request, response) => {
    const html = formatEndpointsForHTML();
    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>CloudCLI API Documentation</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
            h1 { color: #333; margin-bottom: 10px; }
            .subtitle { color: #666; margin-bottom: 30px; }
            .category { background: white; margin: 20px 0; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .category h2 { color: #2563eb; margin-top: 0; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }
            .endpoint { margin: 15px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #2563eb; border-radius: 4px; }
            .header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
            .method { font-weight: bold; padding: 4px 8px; border-radius: 4px; font-size: 12px; text-transform: uppercase; }
            .method.get { background: #61affe; color: white; }
            .method.post { background: #49cc90; color: white; }
            .method.put { background: #fca130; color: white; }
            .method.delete { background: #f93e3e; color: white; }
            .path { font-family: 'Courier New', monospace; font-size: 14px; font-weight: bold; color: #333; }
            .auth-badge { font-size: 11px; background: #ffebee; color: #c62828; padding: 2px 6px; border-radius: 3px; }
            .description { margin: 8px 0 0 0; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <h1>🚀 CloudCLI API Documentation</h1>
          <p class="subtitle">RESTful API for CloudCLI - Web-based UI for Claude Code CLI</p>
          <p>For interactive API testing, visit: <a href="/api/docs/swagger">/api/docs/swagger</a></p>
          <p>For OpenAPI 3.0 spec, visit: <a href="/api/docs/openapi.json">/api/docs/openapi.json</a></p>
          ${html}
        </body>
      </html>
    `;
    response.type('text/html').send(fullHtml);
  });

  /**
   * GET /api/docs
   * Redirect to HTML documentation
   */
  router.get('/docs', (_request, response) => {
    response.redirect('/api/docs/html');
  });

  return router;
}
