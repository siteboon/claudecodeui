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

# Check for curl (needed for nvm installation)
if ! command -v curl &> /dev/null; then
  echo -e "${RED}curl is not installed. Please install curl first.${NC}"
  echo "On Ubuntu/Debian: sudo apt-get install curl"
  echo "On macOS: brew install curl"
  exit 1
fi

# Function to install nvm
install_nvm() {
  echo -e "${YELLOW}Installing nvm...${NC}"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  
  # Load nvm for current session
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
  
  if command -v nvm &> /dev/null; then
    echo -e "${GREEN}✓ nvm installed successfully${NC}"
    return 0
  else
    echo -e "${RED}Failed to install nvm${NC}"
    return 1
  fi
}

# Check for nvm
if ! command -v nvm &> /dev/null 2>&1; then
  # Try to load nvm if it exists but not loaded
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  
  if ! command -v nvm &> /dev/null 2>&1; then
    echo -e "${YELLOW}nvm not found.${NC}"
    read -p "Do you want to install nvm and the latest Node.js? (Y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      if install_nvm; then
        # Install latest Node.js
        echo -e "${YELLOW}Installing latest Node.js...${NC}"
        nvm install node
        nvm use node
        echo -e "${GREEN}✓ Installed Node.js $(node -v)${NC}"
        
        # Update npm
        echo -e "${YELLOW}Updating npm to latest version...${NC}"
        npm install -g npm@latest
        echo -e "${GREEN}✓ Updated npm to $(npm -v)${NC}"
      else
        echo -e "${RED}Failed to install nvm. Please install Node.js manually.${NC}"
        exit 1
      fi
    else
      # Check if Node.js is installed without nvm
      if ! command -v node &> /dev/null; then
        echo -e "${RED}Node.js is not installed. Please install Node.js 18+ first.${NC}"
        echo "Visit: https://nodejs.org/ or install nvm"
        exit 1
      fi
    fi
  else
    echo -e "${GREEN}✓ nvm found${NC}"
  fi
fi

# Check Node.js version
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${YELLOW}Node.js version 18+ is required. Current version: $(node -v)${NC}"
    
    if command -v nvm &> /dev/null 2>&1; then
      read -p "Do you want to install the latest Node.js using nvm? (Y/n) " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        echo -e "${YELLOW}Installing latest Node.js...${NC}"
        nvm install node
        nvm use node
        echo -e "${GREEN}✓ Installed Node.js $(node -v)${NC}"
        
        # Update npm
        echo -e "${YELLOW}Updating npm to latest version...${NC}"
        npm install -g npm@latest
        echo -e "${GREEN}✓ Updated npm to $(npm -v)${NC}"
      else
        exit 1
      fi
    else
      exit 1
    fi
  else
    echo -e "${GREEN}✓ Node.js $(node -v) found${NC}"
    
    # Ask to update npm
    read -p "Do you want to update npm to the latest version? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      echo -e "${YELLOW}Updating npm...${NC}"
      npm install -g npm@latest
      echo -e "${GREEN}✓ Updated npm to $(npm -v)${NC}"
    else
      echo -e "${GREEN}✓ npm $(npm -v) found${NC}"
    fi
  fi
else
  echo -e "${RED}Node.js is not installed after nvm setup. Please check your installation.${NC}"
  exit 1
fi

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