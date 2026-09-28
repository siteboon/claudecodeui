export type AutoProvisionDependencies = {
  hasUsers(): boolean;
  register(username: string, password: string): Promise<unknown>;
  generatePassword(): string;
};

export type AutoProvisionOptions = {
  enabled: boolean;
  username: string;
  password?: string;
};

/**
 * Creates the one user a fresh deployment (e.g. a disposable sandbox) will
 * ever have, with a generated password, so nobody has to be watching a
 * browser at boot to complete the manual first-run setup form. A no-op
 * whenever a user already exists, so this never touches an established
 * account.
 */
export async function autoProvisionAdminUser(
  dependencies: AutoProvisionDependencies,
  options: AutoProvisionOptions,
): Promise<{ username: string; password: string } | null> {
  if (!options.enabled || dependencies.hasUsers()) {
    return null;
  }

  const password = options.password || dependencies.generatePassword();
  await dependencies.register(options.username, password);
  return { username: options.username, password };
}
