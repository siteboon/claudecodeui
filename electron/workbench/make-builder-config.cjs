/**
 * Writes electron-builder.workbench.generated.json: the base config plus an explicit
 * list of production dependency folders. electron-builder's own dependency collector
 * returns nothing in this repo (npm 11 + a path with spaces), which would leave the
 * packaged app without node_modules.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const base = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder.workbench.json'), 'utf8'));
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const collected = new Set();

function resolveDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir || dir.length <= root.length - 1) return null;
    dir = parent;
  }
}

function walk(name, fromDir) {
  const dir = resolveDir(name, fromDir);
  if (!dir || collected.has(dir)) return;
  collected.add(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    walk(dep, dir);
  }
}

for (const dep of Object.keys({ ...rootPkg.dependencies, ...rootPkg.optionalDependencies })) {
  walk(dep, root);
}

// Native packages and prebuilds for platforms we are not packaging for (e.g. Codex binaries).
// Usage: node make-builder-config.cjs [win|mac]
const target = process.argv[2] === 'mac' ? 'darwin' : 'win32';
const otherPlatforms = target === 'darwin' ? ['win32', 'win', 'linux'] : ['darwin', 'linux', 'android'];
const otherPlatformExcludes = otherPlatforms.flatMap((name) => [
  `!**/*-${name}-*/**`,
  `!**/prebuilds/${name}-*/**`,
]);

// Copied verbatim as extra resources (resources/app/node_modules), bypassing the collector.
const nodeModulesRoot = path.join(root, 'node_modules');
const patterns = [...collected].map((dir) => `${path.relative(nodeModulesRoot, dir).split(path.sep).join('/')}/**/*`);
base.extraResources = [
  {
    from: 'node_modules',
    to: 'app/node_modules',
    filter: [
      ...patterns,
      '!**/*.{md,markdown}',
      '!**/{test,tests,__tests__,docs,example,examples}/**',
      ...otherPlatformExcludes,
    ],
  },
];
fs.writeFileSync(path.join(root, 'electron-builder.workbench.generated.json'), `${JSON.stringify(base, null, 2)}\n`);
console.log(`Workbench builder config: ${collected.size} production packages included.`);
