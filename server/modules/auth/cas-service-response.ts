/**
 * Strict, dependency-free reader for CAS `/serviceValidate` and
 * `/p3/serviceValidate` XML responses.
 *
 * The response is security-critical (it names the user to sign in), so this
 * deliberately understands only the small XML subset a CAS server emits and
 * reports anything else as malformed instead of guessing: no DTDs or custom
 * entities, balanced tags, exactly one root `serviceResponse` holding exactly
 * one `authenticationSuccess` / `authenticationFailure`, and exactly one
 * direct `user` child on success. Comments and CDATA are understood so markup
 * hidden inside them can never be mistaken for a real `user` element.
 */

type XmlElement = {
  localName: string;
  attributes: Map<string, string>;
  children: XmlNode[];
};

type XmlNode = XmlElement | string;

class MalformedXmlError extends Error {}

// Longest user name accepted from CAS; the users table has no limit of its own.
const MAX_CAS_USERNAME_LENGTH = 255;

const PREDEFINED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

// A qualified XML name (`cas:user`, `serviceResponse`), captured whole.
const NAME_PATTERN = '[A-Za-z_][\\w.-]*(?::[A-Za-z_][\\w.-]*)?';
const START_TAG = new RegExp(`<(${NAME_PATTERN})((?:\\s+${NAME_PATTERN}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`, 'y');
const END_TAG = new RegExp(`</(${NAME_PATTERN})\\s*>`, 'y');
const ATTRIBUTE = new RegExp(`(${NAME_PATTERN})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'g');

function localNameOf(qualifiedName: string): string {
  const separatorIndex = qualifiedName.indexOf(':');
  return separatorIndex === -1 ? qualifiedName : qualifiedName.slice(separatorIndex + 1);
}

function decodeEntities(text: string): string {
  return text.replace(/&([^;&\s]*);|&/g, (match, entity: string | undefined) => {
    if (entity === undefined) {
      throw new MalformedXmlError('Unescaped "&" in text');
    }
    if (entity in PREDEFINED_ENTITIES) {
      return PREDEFINED_ENTITIES[entity];
    }

    const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(entity);
    if (!numeric) {
      throw new MalformedXmlError(`Unknown entity ${match}`);
    }
    const codePoint = numeric[1] !== undefined ? Number.parseInt(numeric[1], 16) : Number.parseInt(numeric[2], 10);
    const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
    if (codePoint < 1 || codePoint > 0x10ffff || isSurrogate) {
      throw new MalformedXmlError(`Invalid character reference ${match}`);
    }
    return String.fromCodePoint(codePoint);
  });
}

function parseAttributes(rawAttributes: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of rawAttributes.matchAll(ATTRIBUTE)) {
    attributes.set(localNameOf(match[1]), decodeEntities(match[2] ?? match[3] ?? ''));
  }
  return attributes;
}

function skipPast(xml: string, from: number, terminator: string): number {
  const end = xml.indexOf(terminator, from);
  if (end === -1) {
    throw new MalformedXmlError(`Unterminated markup, expected "${terminator}"`);
  }
  return end + terminator.length;
}

function parseXmlDocument(xml: string): XmlElement {
  const document: XmlElement = { localName: '#document', attributes: new Map(), children: [] };
  const openElements: Array<{ element: XmlElement; qualifiedName: string }> = [];
  const currentElement = () => openElements.at(-1)?.element ?? document;
  let position = 0;

  while (position < xml.length) {
    if (xml.startsWith('<?', position)) {
      position = skipPast(xml, position, '?>');
    } else if (xml.startsWith('<!--', position)) {
      position = skipPast(xml, position, '-->');
    } else if (xml.startsWith('<![CDATA[', position)) {
      const end = skipPast(xml, position, ']]>');
      currentElement().children.push(xml.slice(position + '<![CDATA['.length, end - ']]>'.length));
      position = end;
    } else if (xml.startsWith('<!', position)) {
      // DOCTYPE / ENTITY declarations are never part of a CAS response and are
      // the vector for entity-expansion tricks, so they are refused outright.
      throw new MalformedXmlError('Markup declarations are not allowed');
    } else if (xml.startsWith('</', position)) {
      END_TAG.lastIndex = position;
      const match = END_TAG.exec(xml);
      const open = openElements.pop();
      if (!match || !open || open.qualifiedName !== match[1]) {
        throw new MalformedXmlError('Mismatched end tag');
      }
      position = END_TAG.lastIndex;
    } else if (xml[position] === '<') {
      START_TAG.lastIndex = position;
      const match = START_TAG.exec(xml);
      if (!match) {
        throw new MalformedXmlError('Invalid start tag');
      }
      const element: XmlElement = {
        localName: localNameOf(match[1]),
        attributes: parseAttributes(match[2]),
        children: [],
      };
      currentElement().children.push(element);
      if (match[3] !== '/') {
        openElements.push({ element, qualifiedName: match[1] });
      }
      position = START_TAG.lastIndex;
    } else {
      const nextTag = xml.indexOf('<', position);
      const end = nextTag === -1 ? xml.length : nextTag;
      currentElement().children.push(decodeEntities(xml.slice(position, end)));
      position = end;
    }
  }

  if (openElements.length > 0) {
    throw new MalformedXmlError('Unclosed element');
  }
  return document;
}

// Returns the element children of `parent`, refusing stray non-whitespace text
// between them (a CAS container element only ever holds elements).
function childElementsOf(parent: XmlElement): XmlElement[] {
  const elements: XmlElement[] = [];
  for (const child of parent.children) {
    if (typeof child !== 'string') {
      elements.push(child);
    } else if (child.trim()) {
      throw new MalformedXmlError(`Unexpected text inside <${parent.localName}>`);
    }
  }
  return elements;
}

function textContentOf(element: XmlElement): string {
  return element.children
    .map((child) => {
      if (typeof child !== 'string') {
        throw new MalformedXmlError(`Unexpected element inside <${element.localName}>`);
      }
      return child;
    })
    .join('');
}

/**
 * Outcome of one CAS ticket validation response. `failure.code` is the CAS
 * error code (e.g. `INVALID_TICKET`, `INVALID_SERVICE`) for logging only.
 */
type CasServiceResponse =
  | { kind: 'success'; user: string }
  | { kind: 'failure'; code: string }
  | { kind: 'malformed'; reason: string };

/**
 * Used by the auth module's CAS service to read the body returned by the CAS
 * server's ticket validation endpoint. Malformed input is reported as
 * `{ kind: 'malformed' }` rather than thrown.
 */
export function parseCasServiceResponse(xml: string): CasServiceResponse {
  try {
    const roots = childElementsOf(parseXmlDocument(xml));
    if (roots.length !== 1 || roots[0].localName !== 'serviceResponse') {
      throw new MalformedXmlError('Expected a single <serviceResponse> root');
    }

    const outcomes = childElementsOf(roots[0]);
    if (outcomes.length !== 1) {
      throw new MalformedXmlError('Expected exactly one authentication outcome');
    }
    const [outcome] = outcomes;

    if (outcome.localName === 'authenticationFailure') {
      return { kind: 'failure', code: outcome.attributes.get('code') || 'UNKNOWN' };
    }
    if (outcome.localName !== 'authenticationSuccess') {
      throw new MalformedXmlError(`Unexpected <${outcome.localName}> outcome`);
    }

    // Only a direct child counts: released attributes live under
    // <cas:attributes> and must never be able to impersonate the user.
    const userElements = childElementsOf(outcome).filter((element) => element.localName === 'user');
    if (userElements.length !== 1) {
      throw new MalformedXmlError('Expected exactly one <user> in authenticationSuccess');
    }

    const user = textContentOf(userElements[0]).trim();
    if (!user || user.length > MAX_CAS_USERNAME_LENGTH) {
      throw new MalformedXmlError('Empty or oversized <user>');
    }
    return { kind: 'success', user };
  } catch (error) {
    if (error instanceof MalformedXmlError) {
      return { kind: 'malformed', reason: error.message };
    }
    throw error;
  }
}
