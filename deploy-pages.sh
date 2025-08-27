#!/bin/bash

# Cloudflare Pages Deployment Script - Real Implementation
echo "🚀 Deploying Claude Code UI to Cloudflare Pages with Functions..."

# Build the project with functions
echo "📦 Building project with backend functions..."
npm run build:functions

# Check if build was successful
if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build completed successfully!"

# Verify functions directory exists
if [ ! -d "dist/functions" ]; then
    echo "❌ Functions directory not found in dist!"
    echo "Please ensure npm run build:functions copied functions to dist/"
    exit 1
fi

echo "✅ Functions directory verified in dist/"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "📥 Installing Wrangler CLI..."
    npm install -g wrangler
fi

# Login to Cloudflare if not already logged in
echo "🔐 Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    echo "📝 Please login to Cloudflare..."
    wrangler login
fi

# Deploy to Cloudflare Pages
echo "🌐 Deploying to Cloudflare Pages..."
wrangler pages deploy dist --project-name claude-code-ui

# Check deployment status
if [ $? -eq 0 ]; then
    echo "🎉 Deployment completed successfully!"
    echo ""
    echo "🌐 Your site is now available at: https://claude-code-ui.pages.dev"
    echo ""
    echo "🚀 Features now available:"
    echo "   ✅ Real authentication system (demo/demo, admin/admin)"
    echo "   ✅ Project management and file operations"
    echo "   ✅ Git workflow integration"
    echo "   ✅ MCP protocol support"
    echo "   ✅ Cursor CLI AI features"
    echo "   ✅ WebSocket real-time communication"
    echo "   ✅ Audio transcription service"
    echo ""
    echo "🔧 To test the backend:"
    echo "   1. Visit https://claude-code-ui.pages.dev"
    echo "   2. Login with demo/demo or admin/admin"
    echo "   3. Create a new project"
    echo "   4. Test all features"
    echo ""
    echo "📚 For more information, see DEPLOYMENT.md"
else
    echo "❌ Deployment failed!"
    echo "Please check the error messages above and try again."
    exit 1
fi