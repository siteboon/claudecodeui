#!/bin/bash
# Load environment variables from .env
export $(grep -v '^#' .env | grep '^GITHUB_TOKEN=' | xargs)
exec npx release-it "$@"
