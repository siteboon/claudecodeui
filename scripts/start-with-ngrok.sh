#!/bin/bash

# Start npm in background
npm run start &

# Wait a moment for the server to start
sleep 3

# Start ngrok tunnel
ngrok http 3002