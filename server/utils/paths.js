import path from 'path';
import os from 'os';

// Check for deprecated PROJECTS_PATH at module load time and warn immediately
const PROJECTS_PATH_DEPRECATED = process.env.PROJECTS_PATH?.trim() || null;
if (PROJECTS_PATH_DEPRECATED && process.env.NODE_ENV === 'development') {
    // Only show detailed warning in development
    console.warn('⚠️  PROJECTS_PATH is deprecated. See: https://github.com/ghrud92/claudecodeui/wiki/Migration-Guide');
}

// Get home directory with proper fallback and error handling
function getHomeDirectory() {
    try {
        const home = os.homedir();
        // Check for invalid home directory
        if (!home || home === '/' || home === '\\') {
            throw new Error('Invalid home directory detected');
        }
        return home;
    } catch (error) {
        throw new Error(`Unable to access home directory: ${error.message}`);
    }
}

// Get projects directory path from environment or default
export function getProjectsPath() {
    const home = getHomeDirectory();
    return path.join(home, '.claude', 'projects');
}

// Get claude directory path from environment or default
export function getClaudeDir() {
    const home = getHomeDirectory();
    return path.join(home, '.claude');
}