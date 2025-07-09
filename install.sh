#!/bin/bash

# Claude Code UI Installation Script
# This script automates the installation process from git clone to running the application

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
REPO_URL="https://github.com/yourusername/claudecodeui.git"
INSTALL_DIR="claudecodeui"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --repo URL     Git repository URL (default: $REPO_URL)"
      echo "  --dir PATH     Installation directory (default: $INSTALL_DIR)"
      echo "  --help         Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

echo -e "${GREEN}Claude Code UI Installation Script${NC}"
echo "======================================"

# Check prerequisites
echo -e "\n${YELLOW}Checking prerequisites...${NC}"

# Check for Node.js
if ! command -v node &> /dev/null; then
  echo -e "${RED}Node.js is not installed. Please install Node.js 18+ first.${NC}"
  echo "Visit: https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}Node.js version 18+ is required. Current version: $(node -v)${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Node.js $(node -v) found${NC}"

# Check for npm
if ! command -v npm &> /dev/null; then
  echo -e "${RED}npm is not installed.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ npm $(npm -v) found${NC}"

# Check for git
if ! command -v git &> /dev/null; then
  echo -e "${RED}git is not installed. Please install git first.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ git found${NC}"

# Clone repository
echo -e "\n${YELLOW}Cloning repository...${NC}"
if [ -d "$INSTALL_DIR" ]; then
  echo -e "${YELLOW}Directory '$INSTALL_DIR' already exists.${NC}"
  read -p "Do you want to remove it and continue? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$INSTALL_DIR"
  else
    echo -e "${RED}Installation cancelled.${NC}"
    exit 1
  fi
fi

git clone "$REPO_URL" "$INSTALL_DIR"
cd "$INSTALL_DIR"
echo -e "${GREEN}✓ Repository cloned${NC}"

# Create .env file if it doesn't exist
echo -e "\n${YELLOW}Setting up environment...${NC}"
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo -e "${GREEN}✓ Created .env from .env.example${NC}"
  else
    # Create basic .env file
    cat > .env << EOF
PORT=3008
VITE_PORT=3009
EOF
    echo -e "${GREEN}✓ Created default .env file${NC}"
  fi
else
  echo -e "${YELLOW}! .env file already exists, skipping${NC}"
fi

# Node.js installation
echo -e "\n${YELLOW}Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Build the application
echo -e "\n${YELLOW}Building application...${NC}"
npm run build
echo -e "${GREEN}✓ Application built${NC}"

echo -e "\n${GREEN}Installation complete!${NC}"
echo "======================================"
echo "To start the application:"
echo ""
echo "  Development mode:"
echo "    npm run dev"
echo ""
echo "  Production mode:"
echo "    npm start"
echo ""
echo "The application will be available at:"
echo "  Frontend: http://localhost:3009"
echo "  Backend:  http://localhost:3008"

# Ask if user wants to start now
echo ""
read -p "Do you want to start the application now in development mode? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo -e "\n${YELLOW}Starting application...${NC}"
  npm run dev
fi