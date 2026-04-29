/**
 * PROJECT PATH RESOLUTION
 * =======================
 *
 * Routes address projects by DB `projectId` and resolve their absolute
 * workspace path through this module.
 */

import { projectsDb } from './modules/database/index.js';

/**
 * Resolve the absolute project path for a database `projectId`.
 *
 * Returns `null` when the id doesn't match any row so callers can respond
 * with a 404.
 */
async function getProjectPathById(projectId) {
  if (!projectId) {
    return null;
  }

  return projectsDb.getProjectPathById(projectId);
}

export {
  getProjectPathById
};
