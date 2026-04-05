import React from 'react';

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

/**
 * Splits plain text into an array of strings and <a> elements,
 * turning bare http(s) URLs into clickable links.
 */
export function LinkifyText({ text }: { text: string }): React.ReactElement {
  const parts: React.ReactNode[] = [];
  let last_index = 0;
  let match: RegExpExecArray | null;

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > last_index) {
      parts.push(text.slice(last_index, match.index));
    }
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline break-all hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
      >
        {url}
      </a>,
    );
    last_index = match.index + url.length;
  }

  if (last_index < text.length) {
    parts.push(text.slice(last_index));
  }

  return <>{parts}</>;
}
