const conventionalChangelogPlugin = '@release-it/conventional-changelog';

// Fail immediately with a useful module error and make this runtime-loaded
// release dependency visible to static dependency analysis.
require.resolve(conventionalChangelogPlugin);

module.exports = {
  git: {
    commitMessage: 'chore(release): v${version}',
    tagName: 'v${version}',
    requireBranch: 'main',
    requireCleanWorkingDir: true,
  },
  npm: {
    publish: true,
    publishArgs: ['--access public'],
  },
  github: {
    release: true,
    releaseName: 'CloudCLI UI v${version}',
  },
  hooks: {
    'before:init': ['npm run build'],
  },
  plugins: {
    [conventionalChangelogPlugin]: {
      infile: 'CHANGELOG.md',
      header: '# Changelog\n\nAll notable changes to CloudCLI UI will be documented in this file.\n',
      preset: {
        name: 'conventionalcommits',
        types: [
          { type: 'feat', section: 'New Features' },
          { type: 'feature', section: 'New Features' },
          { type: 'fix', section: 'Bug Fixes' },
          { type: 'perf', section: 'Performance' },
          { type: 'refactor', section: 'Refactoring' },
          { type: 'docs', section: 'Documentation' },
          { type: 'style', section: 'Styling' },
          { type: 'chore', section: 'Maintenance' },
          { type: 'ci', section: 'CI/CD' },
          { type: 'test', section: 'Tests' },
          { type: 'build', section: 'Build' },
        ],
      },
    },
  },
};
