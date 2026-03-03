import matter from 'gray-matter';
import { homedir, platform } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs'

/**
 * Configs stolen from https://github.com/vercel-labs/skills/blob/main/src/agents.ts
 */
function findConfigHome() {
  switch (platform()) {
    case "win32":
    case "darwin":
      return join(home, '.config');
  }

  // Use xdg-basedir (not env-paths) to match OpenCode/Amp/Goose behavior on all platforms.
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME

  return join(home, '.config')
}

const home = homedir();
const configHome = findConfigHome();
const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');

/**
 * // from npm:skills/src/types.d.ts@AgentType
 * @typedef {(
 *   'claude-code' |
 *   'codex' |
 *   'cursor'
 * )} AgentType
 */

const agents = {
  // amp: {
  //   name: 'amp',
  //   displayName: 'Amp',
  //   skillsDir: '.agents/skills',
  //   globalSkillsDir: join(configHome, 'agents/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(configHome, 'amp'));
  //   },
  // },
  // antigravity: {
  //   name: 'antigravity',
  //   displayName: 'Antigravity',
  //   skillsDir: '.agent/skills',
  //   globalSkillsDir: join(home, '.gemini/antigravity/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.gemini/antigravity'));
  //   },
  // },
  // augment: {
  //   name: 'augment',
  //   displayName: 'Augment',
  //   skillsDir: '.augment/skills',
  //   globalSkillsDir: join(home, '.augment/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.augment'));
  //   },
  // },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
    globalSkillsDir: join(claudeHome, 'skills'),
    detectInstalled: async () => {
      return existsSync(claudeHome);
    },
  },
  // openclaw: {
  //   name: 'openclaw',
  //   displayName: 'OpenClaw',
  //   skillsDir: 'skills',
  //   globalSkillsDir: getOpenClawGlobalSkillsDir(),
  //   detectInstalled: async () => {
  //     return (
  //       existsSync(join(home, '.openclaw')) ||
  //       existsSync(join(home, '.clawdbot')) ||
  //       existsSync(join(home, '.moltbot'))
  //     );
  //   },
  // },
  // cline: {
  //   name: 'cline',
  //   displayName: 'Cline',
  //   skillsDir: '.agents/skills',
  //   globalSkillsDir: join(home, '.agents', 'skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.cline'));
  //   },
  // },
  // codebuddy: {
  //   name: 'codebuddy',
  //   displayName: 'CodeBuddy',
  //   skillsDir: '.codebuddy/skills',
  //   globalSkillsDir: join(home, '.codebuddy/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(process.cwd(), '.codebuddy')) || existsSync(join(home, '.codebuddy'));
  //   },
  // },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(codexHome, 'skills'),
    detectInstalled: async () => {
      return existsSync(codexHome) || existsSync('/etc/codex');
    },
  },
  // 'command-code': {
  //   name: 'command-code',
  //   displayName: 'Command Code',
  //   skillsDir: '.commandcode/skills',
  //   globalSkillsDir: join(home, '.commandcode/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.commandcode'));
  //   },
  // },
  // continue: {
  //   name: 'continue',
  //   displayName: 'Continue',
  //   skillsDir: '.continue/skills',
  //   globalSkillsDir: join(home, '.continue/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(process.cwd(), '.continue')) || existsSync(join(home, '.continue'));
  //   },
  // },
  // cortex: {
  //   name: 'cortex',
  //   displayName: 'Cortex Code',
  //   skillsDir: '.cortex/skills',
  //   globalSkillsDir: join(home, '.snowflake/cortex/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.snowflake/cortex'));
  //   },
  // },
  // crush: {
  //   name: 'crush',
  //   displayName: 'Crush',
  //   skillsDir: '.crush/skills',
  //   globalSkillsDir: join(home, '.config/crush/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.config/crush'));
  //   },
  // },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.cursor/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.cursor'));
    },
  },
  // droid: {
  //   name: 'droid',
  //   displayName: 'Droid',
  //   skillsDir: '.factory/skills',
  //   globalSkillsDir: join(home, '.factory/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.factory'));
  //   },
  // },
  // 'gemini-cli': {
  //   name: 'gemini-cli',
  //   displayName: 'Gemini CLI',
  //   skillsDir: '.agents/skills',
  //   globalSkillsDir: join(home, '.gemini/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.gemini'));
  //   },
  // },
  // 'github-copilot': {
  //   name: 'github-copilot',
  //   displayName: 'GitHub Copilot',
  //   skillsDir: '.agents/skills',
  //   globalSkillsDir: join(home, '.copilot/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.copilot'));
  //   },
  // },
  // goose: {
  //   name: 'goose',
  //   displayName: 'Goose',
  //   skillsDir: '.goose/skills',
  //   globalSkillsDir: join(configHome, 'goose/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(configHome, 'goose'));
  //   },
  // },
  // junie: {
  //   name: 'junie',
  //   displayName: 'Junie',
  //   skillsDir: '.junie/skills',
  //   globalSkillsDir: join(home, '.junie/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.junie'));
  //   },
  // },
  // 'iflow-cli': {
  //   name: 'iflow-cli',
  //   displayName: 'iFlow CLI',
  //   skillsDir: '.iflow/skills',
  //   globalSkillsDir: join(home, '.iflow/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.iflow'));
  //   },
  // },
  // kilo: {
  //   name: 'kilo',
  //   displayName: 'Kilo Code',
  //   skillsDir: '.kilocode/skills',
  //   globalSkillsDir: join(home, '.kilocode/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.kilocode'));
  //   },
  // },
  // 'kimi-cli': {
  //   name: 'kimi-cli',
  //   displayName: 'Kimi Code CLI',
  //   skillsDir: '.agents/skills',
  //   globalSkillsDir: join(home, '.config/agents/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.kimi'));
  //   },
  // },
  // 'kiro-cli': {
  //   name: 'kiro-cli',
  //   displayName: 'Kiro CLI',
  //   skillsDir: '.kiro/skills',
  //   globalSkillsDir: join(home, '.kiro/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.kiro'));
  //   },
  // },
  // kode: {
  //   name: 'kode',
  //   displayName: 'Kode',
  //   skillsDir: '.kode/skills',
  //   globalSkillsDir: join(home, '.kode/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.kode'));
  //   },
  // },
  // mcpjam: {
  //   name: 'mcpjam',
  //   displayName: 'MCPJam',
  //   skillsDir: '.mcpjam/skills',
  //   globalSkillsDir: join(home, '.mcpjam/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.mcpjam'));
  //   },
  // },
  // 'mistral-vibe': {
  //   name: 'mistral-vibe',
  //   displayName: 'Mistral Vibe',
  //   skillsDir: '.vibe/skills',
  //   globalSkillsDir: join(home, '.vibe/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.vibe'));
  //   },
  // },
  // mux: {
  //   name: 'mux',
  //   displayName: 'Mux',
  //   skillsDir: '.mux/skills',
  //   globalSkillsDir: join(home, '.mux/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.mux'));
  //   },
  // },
  // opencode: {
  //   name: 'opencode',
  //   displayName: 'OpenCode',
  //   skillsDir: '.agents/skills',
  //   globalSkillsDir: join(configHome, 'opencode/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(configHome, 'opencode'));
  //   },
  // },
  // openhands: {
  //   name: 'openhands',
  //   displayName: 'OpenHands',
  //   skillsDir: '.openhands/skills',
  //   globalSkillsDir: join(home, '.openhands/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.openhands'));
  //   },
  // },
  // pi: {
  //   name: 'pi',
  //   displayName: 'Pi',
  //   skillsDir: '.pi/skills',
  //   globalSkillsDir: join(home, '.pi/agent/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.pi/agent'));
  //   },
  // },
  // qoder: {
  //   name: 'qoder',
  //   displayName: 'Qoder',
  //   skillsDir: '.qoder/skills',
  //   globalSkillsDir: join(home, '.qoder/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.qoder'));
  //   },
  // },
  // 'qwen-code': {
  //   name: 'qwen-code',
  //   displayName: 'Qwen Code',
  //   skillsDir: '.qwen/skills',
  //   globalSkillsDir: join(home, '.qwen/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.qwen'));
  //   },
  // },
  // replit: {
  //   name: 'replit',
  //   displayName: 'Replit',
  //   skillsDir: '.agents/skills',
  //   globalSkillsDir: join(configHome, 'agents/skills'),
  //   showInUniversalList: false,
  //   detectInstalled: async () => {
  //     return existsSync(join(process.cwd(), '.replit'));
  //   },
  // },
  // roo: {
  //   name: 'roo',
  //   displayName: 'Roo Code',
  //   skillsDir: '.roo/skills',
  //   globalSkillsDir: join(home, '.roo/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.roo'));
  //   },
  // },
  // trae: {
  //   name: 'trae',
  //   displayName: 'Trae',
  //   skillsDir: '.trae/skills',
  //   globalSkillsDir: join(home, '.trae/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.trae'));
  //   },
  // },
  // 'trae-cn': {
  //   name: 'trae-cn',
  //   displayName: 'Trae CN',
  //   skillsDir: '.trae/skills',
  //   globalSkillsDir: join(home, '.trae-cn/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.trae-cn'));
  //   },
  // },
  // windsurf: {
  //   name: 'windsurf',
  //   displayName: 'Windsurf',
  //   skillsDir: '.windsurf/skills',
  //   globalSkillsDir: join(home, '.codeium/windsurf/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.codeium/windsurf'));
  //   },
  // },
  // zencoder: {
  //   name: 'zencoder',
  //   displayName: 'Zencoder',
  //   skillsDir: '.zencoder/skills',
  //   globalSkillsDir: join(home, '.zencoder/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.zencoder'));
  //   },
  // },
  // neovate: {
  //   name: 'neovate',
  //   displayName: 'Neovate',
  //   skillsDir: '.neovate/skills',
  //   globalSkillsDir: join(home, '.neovate/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.neovate'));
  //   },
  // },
  // pochi: {
  //   name: 'pochi',
  //   displayName: 'Pochi',
  //   skillsDir: '.pochi/skills',
  //   globalSkillsDir: join(home, '.pochi/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.pochi'));
  //   },
  // },
  // adal: {
  //   name: 'adal',
  //   displayName: 'AdaL',
  //   skillsDir: '.adal/skills',
  //   globalSkillsDir: join(home, '.adal/skills'),
  //   detectInstalled: async () => {
  //     return existsSync(join(home, '.adal'));
  //   },
  // },
  // universal: {
  //   name: 'universal',
  //   displayName: 'Universal',
  //   skillsDir: '.agents/skills',
  //   globalSkillsDir: join(configHome, 'agents/skills'),
  //   showInUniversalList: false,
  //   detectInstalled: async () => false,
  // },
};

/** @param {AgentType} agentName */
export function loadSkillsList(agentName) {
  const loadedSkills = [];

  const agentConfig = agents[agentName];
  if (!agentConfig) return loadedSkills;

  const skillsDirs = [];
  if (agentConfig.globalSkillsDir) skillsDirs.push(agentConfig.globalSkillsDir);
  if (agentConfig.skillsDir) skillsDirs.push(agentConfig.skillsDir);

  /**
   * TODO: skipped
   * Stolen from vercel-labs/skills
   * - `skillsDir/`
   * - `skillsDir/.curated/`
   * - `skillsDir/.experimental/`
   * - `skillsDir/.system/`
   */
  const subSkillsDir = [
    '.',
    // '.curated',
    // '.experimental',
    // '.system'
  ];
  for (const skillsDir of skillsDirs) {
    for (const subDir of subSkillsDir) {
      const fullSkillsDir = join(skillsDir, subDir);
      if (!existsSync(fullSkillsDir)) continue;

      for (const f of readdirSync(fullSkillsDir)) {
        const skillDir = join(fullSkillsDir, f)
        // find /SKILL.md files in skillDir
        const skillFileMdPath = join(skillDir, 'SKILL.md');
        if (!existsSync(skillFileMdPath)) continue;

        const fileContents = readFileSync(skillFileMdPath, 'utf-8');
        const { data } = matter(fileContents);
        if (!data.name) continue;

        // TODO: handle `.user-invocable`, `.disable-model-invocation`?
        loadedSkills.push({
          ...data,
          skillDir,
        })
      }
    }
  }

  return loadedSkills;
}
