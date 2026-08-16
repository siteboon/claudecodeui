// Extracts a short, human-readable summary from a project's README.md for
// display in the New Conversation pane: the first title (heading) and the first
// real paragraph of prose. READMEs commonly open with an HTML block — a
// centered logo, an <h1>, a tagline <p>, then rows of shields.io badges — so the
// parser understands both Markdown (`# Title`, prose paragraphs) and the HTML
// equivalents (`<h1>`, `<p>`), and skips badge/image/link-only decoration so the
// paragraph is actual descriptive text.

export type ReadmeSummary = {
  title: string | null;
  paragraph: string | null;
};

// First ATX heading on its own line: `# Title` … `###### Title`.
const ATX_HEADING_RE = /^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m;
// First HTML heading, possibly spanning lines: <h1 ...>Title</h1>.
const HTML_HEADING_RE = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i;
// HTML paragraph blocks.
const HTML_P_RE = /<p[^>]*>([\s\S]*?)<\/p>/gi;
const HR_RE = /^([-*_])\1{2,}$/;

// Reduce a line/fragment to plain text so it can be judged prose-vs-decoration
// and rendered directly. Tags and images collapse to a space (so adjacent words
// and <br>-separated sentences don't fuse); links keep their visible label.
function stripInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // ![alt](src) images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](href) -> label
    .replace(/<[^>]+>/g, " ") // html tags -> space
    .replace(/[*_~`]+/g, "") // emphasis / inline-code markers
    .replace(/\s+([,.;:!?])/g, "$1") // tidy stray space before punctuation
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

// Enough words to look like a sentence rather than a badge row or a single-word
// caption. Keeps taglines; link-only nav bars are excluded by position instead.
function isProse(text: string): boolean {
  return wordCount(text) >= 3;
}

function findTitle(markdown: string): { text: string | null; end: number } {
  const atx = ATX_HEADING_RE.exec(markdown);
  const html = HTML_HEADING_RE.exec(markdown);
  const atxIdx = atx ? atx.index : Infinity;
  const htmlIdx = html ? html.index : Infinity;

  if (atx && atxIdx <= htmlIdx) {
    return { text: stripInline(atx[1]) || null, end: atxIdx + atx[0].length };
  }
  if (html) {
    return { text: stripInline(html[1]) || null, end: htmlIdx + html[0].length };
  }
  return { text: null, end: 0 };
}

// First qualifying <p>…</p> in the region, with its offset so it can be ranked
// against a Markdown paragraph by document position.
function findHtmlParagraph(region: string): { index: number; text: string } | null {
  HTML_P_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_P_RE.exec(region)) !== null) {
    const text = stripInline(match[1]);
    if (isProse(text)) return { index: match.index, text };
  }
  return null;
}

// First run of plain Markdown prose lines in the region (skips blank lines,
// horizontal rules, headings, and HTML/badge/image-only lines).
function findMarkdownParagraph(region: string): { index: number; text: string } | null {
  const lines = region.split(/\r?\n/);
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    const skip =
      !trimmed ||
      HR_RE.test(trimmed) ||
      /^#{1,6}\s/.test(trimmed) ||
      trimmed.startsWith("<") ||
      !stripInline(trimmed);

    if (skip) {
      offset += lines[i].length + 1;
      continue;
    }

    const collected: string[] = [];
    for (let j = i; j < lines.length; j += 1) {
      const next = lines[j].trim();
      if (!next || HR_RE.test(next) || /^#{1,6}\s/.test(next) || next.startsWith("<")) break;
      const prose = stripInline(next);
      if (prose) collected.push(prose);
    }
    return { index: offset, text: collected.join(" ") };
  }
  return null;
}

/**
 * Parse the first heading and first prose paragraph out of README markdown.
 * Handles both Markdown and HTML-headed READMEs. Returns nulls when nothing
 * suitable is found; callers can fall back to the project name.
 */
export function parseReadmeSummary(markdown: string): ReadmeSummary {
  if (!markdown) return { title: null, paragraph: null };

  // Drop HTML comments (may span lines) before parsing.
  const cleaned = markdown.replace(/<!--[\s\S]*?-->/g, "");

  const { text: title, end } = findTitle(cleaned);
  const region = cleaned.slice(end);

  // Pick whichever paragraph — HTML <p> or Markdown prose — comes first after
  // the title, so the tagline directly under an <h1> wins over later badge rows.
  const candidates = [findHtmlParagraph(region), findMarkdownParagraph(region)]
    .filter((c): c is { index: number; text: string } => c !== null && isProse(c.text))
    .sort((a, b) => a.index - b.index);

  return { title, paragraph: candidates[0]?.text ?? null };
}
