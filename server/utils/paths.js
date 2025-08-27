import path from 'path';

// Get projects directory path from environment or default
export function getProjectsPath() {
    return process.env.PROJECTS_PATH || path.join(process.env.HOME, '.claude', 'projects');
}

// Get claude directory path from environment or default
export function getClaudeDir() {
    if (process.env.PROJECTS_PATH) {
        return path.dirname(process.env.PROJECTS_PATH);
    }
    return path.join(process.env.HOME, '.claude');
}