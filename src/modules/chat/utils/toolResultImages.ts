/**
 * Pulls image blocks out of a tool result payload.
 *
 * Providers disagree on the shape of an image inside a tool result — the
 * Anthropic content-block form (`{ type: 'image', source: { type: 'base64', … } }`),
 * the bare base64 source (`{ type: 'base64', media_type, data }`), and the MCP
 * form (`{ type: 'image', data, mimeType }`) all show up depending on which
 * provider and which tool produced the result. `useChatMessages` also
 * JSON.stringifies anything non-string before it reaches the renderer, so a
 * stringified array has to be parsed back before scanning.
 */

export type ToolResultImage = {
  mediaType: string;
  data: string;
};

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const isBase64Data = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 64 && BASE64_PATTERN.test(value);

const isImageBlock = (block: any): block is ToolResultImage => {
  if (!block || typeof block !== 'object') {
    return false;
  }

  // Anthropic content block: { type: 'image', source: { type: 'base64', media_type, data } }
  if (block.type === 'image' && block.source?.type === 'base64'
    && typeof block.source.media_type === 'string' && isBase64Data(block.source.data)) {
    return true;
  }

  // Bare base64 source: { type: 'base64', media_type, data }
  if (block.type === 'base64'
    && typeof block.media_type === 'string' && isBase64Data(block.data)) {
    return true;
  }

  // MCP content block: { type: 'image', data, mimeType }
  if (block.type === 'image'
    && typeof block.mimeType === 'string' && isBase64Data(block.data)) {
    return true;
  }

  return false;
};

const toImage = (block: any): ToolResultImage => {
  if (block.source) {
    return { mediaType: block.source.media_type, data: block.source.data };
  }
  return { mediaType: block.media_type || block.mimeType, data: block.data };
};

const parseBlocks = (payload: unknown): unknown => {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload;
};

/**
 * Collect every image block found in a tool result payload (string, array, or
 * an object carrying a `content` array). Returns data URLs plus their media
 * types, ready for an `<img src>`.
 */
export const extractToolResultImages = (payload: unknown): ToolResultImage[] => {
  if (payload == null) {
    return [];
  }

  // A tool result wrapper ({ content, isError }) is as common as the bare array.
  const blocks = parseBlocks(
    payload && typeof payload === 'object' && !Array.isArray(payload) && 'content' in (payload as any)
      ? (payload as any).content
      : payload,
  );

  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks.filter(isImageBlock).map(toImage);
};

/** True when the result carries at least one renderable image. */
export const hasToolResultImages = (toolResult: unknown): boolean =>
  extractToolResultImages(toolResult).length > 0;

/**
 * Drops the image blocks from a tool result payload so the remaining text can
 * be rendered without dragging a wall of base64 characters along with it.
 */
export const withoutImageBlocks = (payload: unknown): unknown => {
  if (typeof payload === 'string') {
    const parsed = parseBlocks(payload);
    return Array.isArray(parsed) ? withoutImageBlocks(parsed) : payload;
  }
  if (Array.isArray(payload)) {
    return payload.filter((block) => !isImageBlock(block));
  }
  return payload;
};
