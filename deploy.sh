#!/bin/bash
#
# CloudCLI FCC Server - Production Deployment Script
# Version: 1.37.2
# Usage: ./deploy.sh [build|run|stop|restart|logs]
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="cloudcli-server"
IMAGE_NAME="cloudcli"
IMAGE_TAG="latest"
PORT="3001"
DATABASE_DIR="/var/lib/cloudcli"

# Functions

# Print formatted header with decorative border
# Usage: print_header "Title"
print_header() {
    echo -e "${BLUE}═════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═════════════════════════════════════════${NC}"
}

# Print success message with green checkmark
# Usage: print_success "Operation completed"
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Print error message with red X
# Usage: print_error "Operation failed"
print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Print warning message with yellow exclamation
# Usage: print_warning "Check this before proceeding"
print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Print info message with blue indicator
# Usage: print_info "Additional information"
print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Verify Docker is installed on the system
# Returns 0 if Docker is available, exits with 1 if not found
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    print_success "Docker is installed"
}

# Validate .env.production exists or create from template
# Returns 0 if file exists or is created, returns 1 if template not found
check_env_file() {
    if [ ! -f ".env.production" ]; then
        print_warning ".env.production not found, creating from template..."
        if [ -f ".env.example" ]; then
            cp .env.example .env.production
            print_success "Created .env.production from .env.example"
            print_warning "Please edit .env.production with your configuration before deploying"
            return 1
        else
            print_error ".env.example not found"
            return 1
        fi
    fi
    print_success ".env.production found"
    return 0
}

# Create database directory with proper permissions for SQLite
# Sets up /var/lib/cloudcli directory with 755 permissions via sudo
# Ensures nodejs user (UID 1001) can write database.db file
prepare_database_dir() {
    if [ ! -d "$DATABASE_DIR" ]; then
        print_info "Creating database directory: $DATABASE_DIR"
        sudo mkdir -p "$DATABASE_DIR"
        sudo chmod 755 "$DATABASE_DIR"
        # Set ownership to nodejs user (UID 1001) for container write access
        sudo chown 1001:1001 "$DATABASE_DIR"
    fi
    print_success "Database directory ready: $DATABASE_DIR"
}

# Build Docker image using Dockerfile in current directory
# Uses docker build with configured IMAGE_NAME and IMAGE_TAG
# Returns 0 on success, 1 on failure
build_image() {
    print_header "Building Docker Image"

    if docker build -t $IMAGE_NAME:$IMAGE_TAG .; then
        print_success "Docker image built successfully: $IMAGE_NAME:$IMAGE_TAG"
    else
        print_error "Failed to build Docker image"
        return 1
    fi
}

# Start Docker container with production configuration
# Stops and removes existing container if it exists, then starts new one
# Verifies container is running after startup
# Returns 0 on success, 1 on failure
run_container() {
    print_header "Starting Docker Container"

    # Check if container already exists
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        print_warning "Container $CONTAINER_NAME already exists"
        print_info "Removing old container..."
        docker stop $CONTAINER_NAME 2>/dev/null || true
        docker rm $CONTAINER_NAME 2>/dev/null || true
    fi

    print_info "Starting new container..."

    docker run -d \
        --name $CONTAINER_NAME \
        --restart unless-stopped \
        -p 127.0.0.1:$PORT:$PORT \
        -e NODE_ENV=production \
        -v $DATABASE_DIR:/var/lib/cloudcli \
        --env-file .env.production \
        $IMAGE_NAME:$IMAGE_TAG

    if [ $? -eq 0 ]; then
        print_success "Container started successfully"
        sleep 2

        # Check container is running
        if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
            print_success "Container is running"
        else
            print_error "Container failed to start"
            docker logs $CONTAINER_NAME
            return 1
        fi
    else
        print_error "Failed to start container"
        return 1
    fi
}

# Perform health check on running server with retries
# Polls /health endpoint up to 10 times with 2-second intervals
# Returns 0 on success, 1 on failure after all retries exhausted
check_health() {
    print_header "Health Check"

    print_info "Waiting for server to be ready..."
    sleep 3

    for i in {1..10}; do
        if curl -fsS http://localhost:$PORT/health > /dev/null 2>&1; then
            print_success "Server is healthy"

            # Get health status from /health endpoint
            local status
            status=$(curl -fsS http://localhost:$PORT/health | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
            print_info "Status: $status"

            return 0
        fi

        if [ $i -lt 10 ]; then
            print_warning "Health check attempt $i/10 failed, retrying..."
            sleep 2
        fi
    done

    print_error "Health check failed after 10 attempts"
    print_info "Checking container logs..."
    docker logs $CONTAINER_NAME | tail -20
    return 1
}

# Stop running Docker container gracefully
# Uses docker stop command, no-op if container not running
stop_container() {
    print_header "Stopping Container"

    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker stop $CONTAINER_NAME
        print_success "Container stopped"
    else
        print_warning "Container is not running"
    fi
}

# Display last 50 lines of container logs
# Useful for debugging startup issues or runtime errors
show_logs() {
    print_header "Container Logs (Last 50 lines)"
    docker logs --tail 50 $CONTAINER_NAME || print_error "Container not found"
}

# Restart running container and verify health
# Stops container, starts it, waits, and performs health check
# Returns 0 if health check passes, 1 otherwise
restart_container() {
    print_header "Restarting Container"

    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker restart $CONTAINER_NAME
        print_success "Container restarted"
        sleep 2
        check_health
    else
        print_error "Container not found. Run './deploy.sh build' first."
    fi
}

# Display current container status and port mappings
# Shows running container details or stopped/non-existent status
show_status() {
    print_header "Container Status"

    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        print_success "Container is RUNNING"
        docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
    else
        print_warning "Container is NOT running"
        if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
            print_info "Container exists but is stopped"
            docker ps -a --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
        else
            print_warning "Container does not exist"
        fi
    fi
}

# Perform full end-to-end deployment workflow
# Validates Docker installation, configures environment, builds image, starts container
# Verifies container health before reporting success
# Orchestrates: check_docker -> check_env_file -> prepare_database_dir -> build_image ->
#               run_container -> check_health
# Returns 0 on complete success, 1 if any step fails
full_deployment() {
    print_header "CloudCLI FCC Server - Full Deployment"

    check_docker
    check_env_file || { print_error "Please configure .env.production"; return 1; }
    prepare_database_dir
    build_image || { print_error "Build failed"; return 1; }
    run_container || { print_error "Container startup failed"; return 1; }
    check_health || { print_error "Health check failed"; return 1; }

    print_header "Deployment Complete ✓"
    print_success "CloudCLI Server is running on http://localhost:$PORT"
    print_info "View logs: docker logs -f $CONTAINER_NAME"
    print_info "Stop server: docker stop $CONTAINER_NAME"
}

# ============================================================================
# MAIN SCRIPT - Command routing and execution
# ============================================================================
# Entry point for deployment script. Routes commands to appropriate functions.
# Default command is 'build' if none specified.
# Validates prerequisites and executes requested deployment operation.
# ============================================================================
case "${1:-build}" in
    build)
        # Build Docker image only (no container startup)
        check_docker
        build_image
        ;;
    run)
        # Build Docker image and start container with health verification
        check_docker
        check_env_file || exit 1
        prepare_database_dir
        build_image
        run_container
        check_health
        ;;
    deploy)
        # Full end-to-end deployment: check docker, configure env, build, start, verify
        full_deployment
        ;;
    stop)
        # Gracefully stop the running container (no data loss)
        stop_container
        ;;
    restart)
        # Restart container and verify health
        restart_container
        ;;
    logs)
        # Display last 50 lines of container logs
        show_logs
        ;;
    status)
        # Show current container status and port mappings
        show_status
        ;;
    *)
        # Display help and usage information
        echo "CloudCLI FCC Server - Deployment Script"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  build      - Build Docker image only"
        echo "  run        - Build and run container"
        echo "  deploy     - Full deployment (build + run + health check)"
        echo "  stop       - Stop running container"
        echo "  restart    - Restart container"
        echo "  logs       - Show container logs"
        echo "  status     - Show container status"
        echo ""
        echo "Examples:"
        echo "  ./deploy.sh deploy     # Full deployment"
        echo "  ./deploy.sh logs       # View logs"
        echo "  ./deploy.sh restart    # Restart server"
        echo ""
        exit 1
        ;;
esac

exit $?
