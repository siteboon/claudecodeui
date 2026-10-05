import { factorySpace } from 'micromark-factory-space';
import type { Nodes, Root } from 'mdast';
import type {} from 'micromark-extension-math';
import { markdownLineEnding } from 'micromark-util-character';
import type {
  Code,
  Construct,
  Effects,
  Event,
  Extension,
  State,
  Token,
  TokenizeContext,
} from 'micromark-util-types';
import remarkMath from 'remark-math';
import type { Parser } from 'unified';

// The delimiter state machines are adapted from micromark-extension-math-extended.
// Its MIT copyright and permission notice are preserved in the repository NOTICE.

const BACKSLASH = 92;
const LEFT_PARENTHESIS = 40;
const RIGHT_PARENTHESIS = 41;
const LEFT_SQUARE_BRACKET = 91;
const RIGHT_SQUARE_BRACKET = 93;

type RemarkParserData = {
  micromarkExtensions?: Extension[];
};

type RemarkProcessor = {
  data: () => RemarkParserData;
  parser?: Parser<Root>;
};

const nonLazyContinuation: Construct = {
  partial: true,
  tokenize: tokenizeNonLazyContinuation,
};

const inlineLatexMath: Construct = {
  name: 'mathText',
  previous: previousBackslash,
  resolve: resolveMathText,
  tokenize: tokenizeInlineLatexMath,
};

const displayLatexMath: Construct = {
  concrete: true,
  name: 'mathFlow',
  tokenize: tokenizeDisplayLatexMath,
};

const latexMathSyntax: Extension = {
  flow: { [BACKSLASH]: displayLatexMath },
  text: { [BACKSLASH]: inlineLatexMath },
};

/** Adds TeX-style delimiters while leaving `remark-math` responsible for the math AST nodes. */
function remarkLatexDelimiters(this: RemarkProcessor): void {
  const data = this.data();
  const extensions = data.micromarkExtensions || (data.micromarkExtensions = []);
  extensions.push(latexMathSyntax);

  const parser = this.parser;
  if (parser) {
    this.parser = (source, file) => {
      const prepared = protectLatexTableMath(source);
      const tree = parser(prepared.source, file);
      if (prepared.marker) {
        restoreMathPipes(tree, prepared.marker);
      }
      return preserveIncompleteMathTables(tree, source, prepared.incompleteOffsets) as Root;
    };
  }
}

/** Masks pipes before GFM splits cells, without changing source offsets or TeX semantics. */
function protectLatexTableMath(source: string): {
  source: string;
  marker?: string;
  incompleteOffsets: number[];
} {
  const incompleteOffsets: number[] = [];
  const pipeOffsets: number[] = [];
  if (!source.includes('\\(') || !source.includes('|')) {
    return { source, incompleteOffsets };
  }

  for (const match of source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const line = match[0].replace(/[\r\n]+$/, '');
    const lineOffset = match.index!;
    if (!line.includes('\\(')) {
      continue;
    }

    const backticks = [...line.matchAll(/`+/g)];
    for (let index = 0; index < line.length;) {
      if (line[index] === '`') {
        let openingEnd = index + 1;
        while (line[openingEnd] === '`') {
          openingEnd += 1;
        }
        const closing = backticks.find((run) => run.index! >= openingEnd && run[0].length === openingEnd - index);
        index = closing ? closing.index! + closing[0].length : openingEnd;
      } else if (line[index] === '\\' && line[index + 1] === '(') {
        const start = index;
        let end = index + 2;
        while (end < line.length) {
          if (line[end] === '\\') {
            if (line[end + 1] === ')' || line[end + 1] === '(') {
              break;
            }
            end += 2;
          } else {
            end += 1;
          }
        }
        if (line[end] !== '\\' || line[end + 1] !== ')') {
          incompleteOffsets.push(lineOffset + start);
          break;
        }
        for (let offset = start + 2; offset < end; offset += 1) {
          if (line[offset] === '|') {
            pipeOffsets.push(lineOffset + offset);
          }
        }
        index = end + 2;
      } else {
        index += line[index] === '\\' ? 2 : 1;
      }
    }
  }

  if (pipeOffsets.length === 0) {
    return { source, incompleteOffsets };
  }
  const usedCharacters = new Set(source);
  let markerCode = 0xe000;
  while (markerCode <= 0xf8ff && usedCharacters.has(String.fromCharCode(markerCode))) {
    markerCode += 1;
  }
  if (markerCode > 0xf8ff) {
    return { source, incompleteOffsets: [...incompleteOffsets, ...pipeOffsets] };
  }
  const marker = String.fromCharCode(markerCode);
  const parts: string[] = [];
  let start = 0;
  for (const offset of pipeOffsets) {
    parts.push(source.slice(start, offset), marker);
    start = offset + 1;
  }
  parts.push(source.slice(start));
  return { source: parts.join(''), marker, incompleteOffsets };
}

/** Restores parser-only markers in both MDAST values and remark-math's HAST children. */
function restoreMathPipes(value: unknown, marker: string): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === 'string') {
      record[key] = child.split(marker).join('|');
    } else {
      restoreMathPipes(child, marker);
    }
  }
}

/** Keeps ambiguous, unfinished tables literal instead of losing excess cells during streaming. */
function preserveIncompleteMathTables(node: Nodes, source: string, incompleteOffsets: number[]): Nodes {
  if (incompleteOffsets.length === 0) {
    return node;
  }
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if ((node.type === 'table' || node.type === 'paragraph') && start !== undefined && end !== undefined
    && incompleteOffsets.some((offset) => offset >= start && offset < end)) {
    const original = source.slice(start, end);
    const hasTableDelimiter = original.split(/\r\n|\r|\n/).some((line) => {
      const content = line.replace(/^\s*(?:>\s*)*/, '').trim();
      return content.includes('|') && content.replace(/^\||\|$/g, '').split('|')
        .every((cell) => /^:?-+:?$/.test(cell.trim()));
    });
    if (node.type === 'table' || hasTableDelimiter) {
      return { type: 'code', value: original, position: node.position };
    }
  }
  if ('children' in node) {
    node.children = node.children.map((child) => (
      preserveIncompleteMathTables(child, source, incompleteOffsets)
    )) as typeof node.children;
  }
  return node;
}

/**
 * Used by chat and code-editor Markdown renderers to support `$$`, `\(...)`, and
 * `\[...]` without replacing or forking `remark-math`. Complete inline TeX keeps
 * its pipes inside table cells; tables with incomplete TeX stay literal until
 * a later render supplies the closing delimiter. Stored Markdown is unchanged.
 */
export const MARKDOWN_MATH_REMARK_PLUGINS = [
  remarkLatexDelimiters,
  [remarkMath, { singleDollarTextMath: false }],
] as const;

/** Tokenizes inline math delimited by `\(` and `\)`. */
function tokenizeInlineLatexMath(effects: Effects, ok: State, nok: State): State {
  let closingSequence: Token;

  return start;

  function start(code: Code): State | undefined {
    effects.enter('mathText');
    effects.enter('mathTextSequence');
    effects.consume(code);
    return open;
  }

  function open(code: Code): State | undefined {
    if (code !== LEFT_PARENTHESIS) {
      return nok(code);
    }

    effects.consume(code);
    effects.exit('mathTextSequence');
    return between;
  }

  function between(code: Code): State | undefined {
    if (code === null) {
      return nok(code);
    }

    if (code === BACKSLASH) {
      closingSequence = effects.enter('mathTextSequence');
      effects.consume(code);
      return close;
    }

    if (code === 32) {
      effects.enter('space');
      effects.consume(code);
      effects.exit('space');
      return between;
    }

    if (markdownLineEnding(code)) {
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      return between;
    }

    effects.enter('mathTextData');
    return data(code);
  }

  function data(code: Code): State | undefined {
    if (code === null || code === 32 || code === BACKSLASH || markdownLineEnding(code)) {
      effects.exit('mathTextData');
      return between(code);
    }

    effects.consume(code);
    return data;
  }

  function close(code: Code): State | undefined {
    if (code === RIGHT_PARENTHESIS) {
      effects.consume(code);
      effects.exit('mathTextSequence');
      effects.exit('mathText');
      return ok;
    }

    closingSequence.type = 'mathTextData';
    return data(code);
  }
}

/** Normalizes content events to the token layout expected by `mdast-util-math`. */
function resolveMathText(events: Event[]): Event[] {
  let tailExitIndex = events.length - 4;
  let headEnterIndex = 3;
  let index: number;
  let enter: number | undefined;

  if (isWhitespaceEvent(events[headEnterIndex]) && isWhitespaceEvent(events[tailExitIndex])) {
    index = headEnterIndex;
    while (++index < tailExitIndex) {
      if (events[index][1].type === 'mathTextData') {
        events[headEnterIndex][1].type = 'mathTextPadding';
        events[tailExitIndex][1].type = 'mathTextPadding';
        headEnterIndex += 2;
        tailExitIndex -= 2;
        break;
      }
    }
  }

  index = headEnterIndex - 1;
  tailExitIndex += 1;
  while (++index <= tailExitIndex) {
    if (enter === undefined) {
      if (index !== tailExitIndex && events[index][1].type !== 'lineEnding') {
        enter = index;
      }
    } else if (index === tailExitIndex || events[index][1].type === 'lineEnding') {
      events[enter][1].type = 'mathTextData';
      if (index !== enter + 2) {
        events[enter][1].end = events[index - 1][1].end;
        events.splice(enter + 2, index - enter - 2);
        tailExitIndex -= index - enter - 2;
        index = enter + 2;
      }
      enter = undefined;
    }
  }

  return events;
}

function isWhitespaceEvent(event: Event | undefined): boolean {
  const type = event?.[1].type;
  return type === 'lineEnding' || type === 'space';
}

/** Allows the custom construct after ordinary text, but not inside a Markdown escape. */
function previousBackslash(this: TokenizeContext, code: Code): boolean {
  return code !== BACKSLASH || this.events[this.events.length - 1][1].type === 'characterEscape';
}

/** Tokenizes display math delimited by `\[` and `\]` on otherwise standalone lines. */
function tokenizeDisplayLatexMath(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const tail = this.events[this.events.length - 1];
  const initialIndent = tail?.[1].type === 'linePrefix'
    ? tail[2].sliceSerialize(tail[1], true).length
    : 0;

  return start;

  function start(code: Code): State | undefined {
    effects.enter('mathFlow');
    effects.enter('mathFlowFence');
    effects.enter('mathFlowFenceSequence');
    effects.consume(code);
    return open;
  }

  function open(code: Code): State | undefined {
    if (code !== LEFT_SQUARE_BRACKET) {
      return nok(code);
    }

    effects.consume(code);
    effects.exit('mathFlowFenceSequence');
    effects.exit('mathFlowFence');
    return beforeContent;
  }

  function beforeContent(code: Code): State | undefined {
    if (code === null) {
      return nok(code);
    }

    if (markdownLineEnding(code)) {
      return effects.attempt(nonLazyContinuation, contentStart, nok)(code);
    }

    if (code === BACKSLASH) {
      return effects.attempt({ partial: true, tokenize: tokenizeClosingFence }, after, valueStart)(code);
    }

    effects.enter('mathFlowValue');
    return value(code);
  }

  function contentStart(code: Code): State | undefined {
    return initialIndent
      ? factorySpace(effects, beforeContent, 'linePrefix', initialIndent + 1)(code)
      : beforeContent(code);
  }

  function valueStart(code: Code): State | undefined {
    effects.enter('mathFlowValue');
    effects.consume(code);
    return valueAfterBackslash;
  }

  function valueAfterBackslash(code: Code): State | undefined {
    // Preserve TeX line breaks such as `\\[1em]`; their bracket is not a delimiter.
    if (code === BACKSLASH) {
      effects.consume(code);
      return value;
    }

    // A second opener makes the construct malformed and lets Markdown recover as text.
    if (code === LEFT_SQUARE_BRACKET) {
      return nok(code);
    }

    return value(code);
  }

  function value(code: Code): State | undefined {
    if (code === null || code === BACKSLASH || markdownLineEnding(code)) {
      effects.exit('mathFlowValue');
      return beforeContent(code);
    }

    effects.consume(code);
    return value;
  }

  function tokenizeClosingFence(closeEffects: Effects, closeOk: State, closeNok: State): State {
    return closeStart;

    function closeStart(code: Code): State | undefined {
      closeEffects.enter('mathFlowFence');
      closeEffects.enter('mathFlowFenceSequence');
      closeEffects.consume(code);
      return closeBracket;
    }

    function closeBracket(code: Code): State | undefined {
      if (code !== RIGHT_SQUARE_BRACKET) {
        return closeNok(code);
      }

      closeEffects.consume(code);
      closeEffects.exit('mathFlowFenceSequence');
      return factorySpace(closeEffects, closeEnd, 'whitespace');
    }

    function closeEnd(code: Code): State | undefined {
      if (code === null || markdownLineEnding(code)) {
        closeEffects.exit('mathFlowFence');
        return closeOk(code);
      }

      return closeNok(code);
    }
  }

  function after(code: Code): State | undefined {
    effects.exit('mathFlow');
    return ok(code);
  }
}

/** Keeps display math inside its current blockquote/list container. */
function tokenizeNonLazyContinuation(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const context = this;
  return start;

  function start(code: Code): State | undefined {
    if (code === null) {
      return ok(code);
    }

    effects.enter('lineEnding');
    effects.consume(code);
    effects.exit('lineEnding');
    return lineStart;
  }

  function lineStart(code: Code): State | undefined {
    return context.parser.lazy[context.now().line] ? nok(code) : ok(code);
  }
}
