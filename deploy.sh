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
print_header() {
    echo -e "${BLUE}═════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═════════════════════════════════════════${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    print_success "Docker is installed"
}

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

prepare_database_dir() {
    if [ ! -d "$DATABASE_DIR" ]; then
        print_info "Creating database directory: $DATABASE_DIR"
        sudo mkdir -p "$DATABASE_DIR"
        sudo chmod 755 "$DATABASE_DIR"
    fi
    print_success "Database directory ready: $DATABASE_DIR"
}

build_image() {
    print_header "Building Docker Image"

    if docker build -t $IMAGE_NAME:$IMAGE_TAG .; then
        print_success "Docker image built successfully: $IMAGE_NAME:$IMAGE_TAG"
    else
        print_error "Failed to build Docker image"
        return 1
    fi
}

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
        -p $PORT:$PORT \
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

check_health() {
    print_header "Health Check"

    print_info "Waiting for server to be ready..."
    sleep 3

    for i in {1..10}; do
        if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
            print_success "Server is healthy"

            # Get health status
            local status=$(curl -s http://localhost:$PORT/health | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
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

stop_container() {
    print_header "Stopping Container"

    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker stop $CONTAINER_NAME
        print_success "Container stopped"
    else
        print_warning "Container is not running"
    fi
}

show_logs() {
    print_header "Container Logs (Last 50 lines)"
    docker logs --tail 50 $CONTAINER_NAME || print_error "Container not found"
}

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

# Main script
case "${1:-build}" in
    build)
        check_docker
        build_image
        ;;
    run)
        check_docker
        check_env_file || exit 1
        prepare_database_dir
        run_container
        check_health
        ;;
    deploy)
        full_deployment
        ;;
    stop)
        stop_container
        ;;
    restart)
        restart_container
        ;;
    logs)
        show_logs
        ;;
    status)
        show_status
        ;;
    *)
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
