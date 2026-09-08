import { factorySpace } from 'micromark-factory-space';
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
}

/**
 * Used by chat and code-editor Markdown renderers to support `$$`, `\(...)`, and
 * `\[...]` without replacing or forking `remark-math`.
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
