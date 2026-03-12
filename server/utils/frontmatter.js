import matter from 'gray-matter';

const disabledFrontmatterEngine = () => ({});

const frontmatterOptions = {
  language: 'yaml',
  // Disable JS/JSON frontmatter parsing to avoid executable project content.
  // Mirrors Gatsby's mitigation for gray-matter.
  engines: {
    js: disabledFrontmatterEngine,
    javascript: disabledFrontmatterEngine,
    json: disabledFrontmatterEngine
  }
};

export function parseFrontmatter(content) {
  return matter(content, frontmatterOptions);
}
