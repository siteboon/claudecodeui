type ProjectLike = { name: string };

/**
 * Check if a project is a remote project by its name prefix.
 * Remote projects follow the naming convention: remote:<hostId>:<base64Path>
 */
export const isRemoteProject = (project: ProjectLike | null | undefined): boolean =>
  project?.name?.startsWith('remote:') ?? false;

/**
 * Extract the host UUID from a remote project name.
 * Returns null if the project name is not a remote project.
 */
export const extractHostId = (project: ProjectLike): string | null => {
  if (!project.name.startsWith('remote:')) return null;
  const hostId = project.name.split(':')[1];
  return hostId || null;
};

/**
 * Extract the remote filesystem path from a remote project name.
 * The path is base64-encoded in the name. Returns null if not a remote project.
 */
export const extractRemotePath = (project: ProjectLike): string | null => {
  if (!project.name.startsWith('remote:')) return null;
  return atob(project.name.split(':').slice(2).join(':'));
};
