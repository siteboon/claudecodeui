import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { NormalizedMessage } from '@/shared/types';

// `toolUseResult` values recorded by Claude Code 2.1.280 with
// CLAUDE_CODE_BASH_EDIT_DIFF=1, copied from real transcript lines with the
// repository path shortened to /repo.
const TWO_FILES_CHANGED = {
  stdout: '',
  stderr: '',
  interrupted: false,
  isImage: false,
  noOutputExpected: false,
  bashEditDiff: {
    files: [
      {
        filePath: '/repo/f.txt',
        hunks: [{ oldStart: 2, oldLines: 3, newStart: 2, newLines: 5, lines: [' BETA', ' gamma', ' delta', '+epsilon', '+zeta'] }],
      },
      {
        filePath: '/repo/g.txt',
        hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' one', '-two', '+TWO', ' three'] }],
      },
    ],
    moreFiles: 0,
    changedFiles: ['/repo/f.txt', '/repo/g.txt'],
  },
};

const CREATED_AND_DELETED = {
  stdout: '',
  stderr: '',
  interrupted: false,
  isImage: false,
  noOutputExpected: false,
  bashEditDiff: {
    files: [
      { filePath: '/repo/empty.txt', hunks: [], created: true },
      {
        filePath: '/repo/h.txt',
        hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 2, lines: ['+new1', '+new2'] }],
        created: true,
      },
      {
        filePath: '/repo/keep.txt',
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 0, lines: ['-x'] }],
        deleted: true,
      },
    ],
    moreFiles: 0,
    changedFiles: ['/repo/empty.txt', '/repo/h.txt', '/repo/keep.txt'],
  },
};

// `seq 1 3000 > big.txt`: the file is past the CLI's per-file limit, so it is
// only counted.
const ONLY_TOO_LARGE = {
  stdout: 'wrote big',
  stderr: '',
  interrupted: false,
  isImage: false,
  noOutputExpected: false,
  bashEditDiff: { files: [], moreFiles: 1, changedFiles: ['/repo/big.txt'] },
};

const NO_DIFF = { stdout: 'hello', stderr: '', interrupted: false, isImage: false, noOutputExpected: false };

const renderBash = (
  toolUseResult: unknown,
  {
    command = "sed -i 's/two/TWO/' g.txt",
    onFileOpen,
    projectRoot,
  }: { command?: string; onFileOpen?: (path: string) => void; projectRoot?: string } = {},
) =>
  render(
    <ToolRenderer
      toolName="Bash"
      toolInput={JSON.stringify({ command })}
      toolResult={{ content: '(Bash completed with no output)', isError: false, toolUseResult }}
      toolId="toolu_1"
      mode="input"
      onFileOpen={onFileOpen}
      selectedProject={projectRoot ? { projectId: 'p1', displayName: 'repo', fullPath: projectRoot } : null}
    />,
  );

const textOf = (toolUseResult: unknown) => renderBash(toolUseResult).container.textContent ?? '';

// Every note under the file blocks, in order.
const noteTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.border-transparent.text-\\[11px\\]')).map((note) => note.textContent);

// The per-file blocks' collapsible roots.
const fileSections = (container: HTMLElement) => Array.from(container.querySelectorAll('.group\\/section'));

const diffLineTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.font-mono.text-\\[11px\\] > div'))
    .map((row) => row.textContent);

describe('what a Bash command changed', () => {
  it('lists one block per file with its change counts and unified hunks', () => {
    const { container } = renderBash(TWO_FILES_CHANGED);
    const text = container.textContent ?? '';

    expect(text).toContain("sed -i 's/two/TWO/' g.txt");
    expect(container.querySelectorAll('[aria-label="2 lines added, 0 removed"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="1 lines added, 1 removed"]')).toHaveLength(1);
    expect(text).toContain('/repo/f.txt');
    expect(text).toContain('/repo/g.txt');
    expect(text.match(/Updated/g)).toHaveLength(2);

    expect(diffLineTexts(container)).toEqual([
      '@@ -2,3 +2,5 @@',
      'BETA',
      'gamma',
      'delta',
      '+epsilon',
      '+zeta',
      '@@ -1,3 +1,3 @@',
      'one',
      '-two',
      '+TWO',
      'three',
    ]);
  });

  it('colours added lines green and removed lines red, like the Edit diff', () => {
    const { container } = renderBash(TWO_FILES_CHANGED);
    const rows = Array.from(container.querySelectorAll('.font-mono.text-\\[11px\\] > div'));
    const removed = rows.find((row) => row.textContent === '-two');
    const added = rows.find((row) => row.textContent === '+TWO');
    const context = rows.find((row) => row.textContent === 'one');

    expect(removed?.lastElementChild?.className).toContain('text-red-800');
    expect(added?.lastElementChild?.className).toContain('text-green-800');
    expect(context?.lastElementChild?.className).not.toMatch(/red|green/);
  });

  it('says whether each file was created, updated or deleted', () => {
    const { container } = renderBash(CREATED_AND_DELETED);
    const text = container.textContent ?? '';

    expect(text.match(/Created/g)).toHaveLength(2);
    expect(text.match(/Deleted/g)).toHaveLength(1);
    expect(text).not.toContain('Updated');
    // An empty new file has no lines to show, and says so instead of an empty box.
    expect(text).toContain('Empty file');
    expect(container.querySelectorAll('[aria-label="2 lines added, 0 removed"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="0 lines added, 1 removed"]')).toHaveLength(1);
  });

  it('numbers the missing side of a created or deleted file from 0, as git does', () => {
    // 2.1.280 wrote oldStart 1 for the created h.txt and newStart 1 for the deleted keep.txt.
    const rows = diffLineTexts(renderBash(CREATED_AND_DELETED).container);

    expect(rows).toContain('@@ -0,0 +1,2 @@');
    expect(rows).toContain('@@ -1,1 +0,0 @@');
    expect(rows.filter((row) => row?.startsWith('@@'))).toHaveLength(2);
  });

  it('keeps every file block collapsed until it is opened, like an Edit row', () => {
    const { container } = renderBash(CREATED_AND_DELETED);
    const sections = fileSections(container);

    expect(sections).toHaveLength(3);
    expect(sections.map((section) => section.getAttribute('data-state'))).toEqual(['closed', 'closed', 'closed']);
  });

  it('sets every file name in mono, including a deleted one that cannot be opened', () => {
    const { getByText } = renderBash(CREATED_AND_DELETED, { onFileOpen: vi.fn() });

    expect(getByText('h.txt').className).toContain('font-mono');
    expect(getByText('keep.txt').tagName).toBe('SPAN');
    expect(getByText('keep.txt').className).toContain('font-mono');
  });

  it('marks "\\ No newline at end of file" as a note on the line above, not a change', () => {
    const { container } = renderBash({
      bashEditDiff: {
        files: [{
          filePath: '/repo/bin.dat',
          hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+data', '\\ No newline at end of file'] }],
          created: true,
        }],
        moreFiles: 0,
      },
    });
    const rows = Array.from(container.querySelectorAll('.font-mono.text-\\[11px\\] > div'));
    const marker = rows.find((row) => row.textContent === '\\ No newline at end of file');

    expect(marker).toBeDefined();
    // No gutter sign and no red/green: it is one plain, italic row.
    expect(marker?.children).toHaveLength(0);
    expect(marker?.className).toContain('italic');
    expect(marker?.className).not.toMatch(/red|green/);
    expect(container.querySelectorAll('[aria-label="1 lines added, 0 removed"]')).toHaveLength(1);
  });

  it('counts the files the CLI changed but did not diff', () => {
    const tooLarge = renderBash(ONLY_TOO_LARGE).container.textContent ?? '';
    expect(tooLarge).toContain('1 file changed (binary, mode only or too large to show)');

    const withMore = renderBash({
      ...TWO_FILES_CHANGED,
      bashEditDiff: { ...TWO_FILES_CHANGED.bashEditDiff, moreFiles: 3 },
    }).container.textContent ?? '';
    expect(withMore).toContain('… 3 more files changed');

    // One note, not the count plus a second "unavailable" line.
    expect(noteTexts(renderBash({ bashEditDiff: { files: [], moreFiles: 2, unavailable: true } }).container))
      .toEqual(['2 files changed (diff unavailable)']);
  });

  it('names the files it counted but did not diff', () => {
    // The real record for `seq 1 3000 > big.txt`, inside the project and outside it.
    expect(noteTexts(renderBash(ONLY_TOO_LARGE, { projectRoot: '/repo' }).container)).toEqual([
      '1 file changed (binary, mode only or too large to show)big.txt',
    ]);
    const { getByText } = renderBash(ONLY_TOO_LARGE);
    expect(getByText('/repo/big.txt').getAttribute('title')).toBe('/repo/big.txt');

    // Diffed files are not repeated, and a long list stops at ten names.
    const undiffed = Array.from({ length: 13 }, (_, index) => `/repo/assets/img${index + 1}.png`);
    const { container } = renderBash({
      bashEditDiff: {
        ...TWO_FILES_CHANGED.bashEditDiff,
        moreFiles: 13,
        changedFiles: ['/repo/f.txt', '/repo/g.txt', ...undiffed],
      },
    }, { projectRoot: '/repo/' });
    const [note] = noteTexts(container);
    expect(note).toBe(
      `… 13 more files changed${undiffed.slice(0, 10).map((path) => path.slice('/repo/'.length)).join(', ')} +3 more`,
    );

    // A path the CLI lists twice is named once.
    expect(noteTexts(renderBash({
      bashEditDiff: { ...ONLY_TOO_LARGE.bashEditDiff, changedFiles: ['/repo/big.txt', '/repo/big.txt'] },
    }, { projectRoot: '/repo' }).container)).toEqual([
      '1 file changed (binary, mode only or too large to show)big.txt',
    ]);

    // Past 200 changed files the CLI stops listing names but keeps counting,
    // so "+N more" comes from the count, not from the names it got.
    const truncated = Array.from({ length: 198 }, (_, index) => `/repo/src/file${index + 1}.ts`);
    const [formatted] = noteTexts(renderBash({
      bashEditDiff: {
        ...TWO_FILES_CHANGED.bashEditDiff,
        moreFiles: 295,
        changedFiles: ['/repo/f.txt', '/repo/g.txt', ...truncated],
      },
    }, { projectRoot: '/repo' }).container);
    expect(formatted).toMatch(/^… 295 more files changed/);
    expect(formatted).toMatch(/ \+285 more$/);
  });

  it('says when the CLI skipped the command or could not diff it', () => {
    // The CLI does not diff a lone branch-switching or tree-rewriting git command.
    const skipped = renderBash({ bashEditDiff: { files: [], moreFiles: 0, skipped: true } }, { command: 'git stash' });
    expect(noteTexts(skipped.container)).toEqual(['(file diff skipped for this git command)']);
    expect(fileSections(skipped.container)).toHaveLength(0);

    // What the CLI records when its snapshot fails.
    expect(noteTexts(renderBash({ bashEditDiff: { files: [], moreFiles: 0, unavailable: true } }).container))
      .toEqual(['(file diff unavailable for this command)']);

    // Some files diffed, others too large or unreadable to snapshot.
    const partial = renderBash({
      bashEditDiff: {
        ...TWO_FILES_CHANGED.bashEditDiff,
        moreFiles: 1,
        changedFiles: ['/repo/f.txt', '/repo/g.txt', '/repo/huge.log'],
        unavailable: true,
      },
    }, { projectRoot: '/repo' });
    expect(fileSections(partial.container)).toHaveLength(2);
    expect(noteTexts(partial.container)).toEqual(['… 1 more file changed (part of the diff is unavailable)huge.log']);
    expect(noteTexts(renderBash({ bashEditDiff: { ...TWO_FILES_CHANGED.bashEditDiff, unavailable: true } }).container))
      .toEqual(['(part of the diff is unavailable)']);
  });

  it('warns when another command changed the repository at the same time', () => {
    const caveat =
      '(another command ran in this repository at the same time; a change made by either may show under either result)';

    expect(noteTexts(renderBash({ bashEditDiff: { ...TWO_FILES_CHANGED.bashEditDiff, shared: true } }).container))
      .toEqual([caveat]);
    expect(noteTexts(renderBash({ bashEditDiff: { files: [], moreFiles: 0, shared: true } }).container))
      .toEqual([caveat]);

    // Without a diff the CLI cannot say why these files have none, so neither does the note.
    const sharedOnly = textOf({ bashEditDiff: { files: [], moreFiles: 2, changedFiles: ['/repo/a', '/repo/b'], shared: true } });
    expect(sharedOnly).toContain('2 files changed');
    expect(sharedOnly).not.toContain('binary, mode only or too large to show');
    expect(sharedOnly).toContain(caveat);

    // A command the CLI could not diff at all gets only that note, as in the CLI,
    // whether or not it counted files.
    expect(noteTexts(renderBash({ bashEditDiff: { files: [], moreFiles: 0, unavailable: true, shared: true } }).container))
      .toEqual(['(file diff unavailable for this command)']);
    expect(noteTexts(renderBash({
      bashEditDiff: { files: [], moreFiles: 2, changedFiles: ['/repo/a', '/repo/b'], unavailable: true, shared: true },
    }, { projectRoot: '/repo' }).container)).toEqual(['2 files changed (diff unavailable)a, b']);

    // With some files diffed, the caveat still follows the partial-diff note.
    expect(noteTexts(renderBash({
      bashEditDiff: {
        ...TWO_FILES_CHANGED.bashEditDiff,
        moreFiles: 1,
        changedFiles: ['/repo/f.txt', '/repo/g.txt', '/repo/huge.log'],
        unavailable: true,
        shared: true,
      },
    }, { projectRoot: '/repo' }).container)).toEqual([
      '… 1 more file changed (part of the diff is unavailable)huge.log',
      caveat,
    ]);
  });

  it('draws at most 20 file blocks and counts the rest', () => {
    const files = Array.from({ length: 25 }, (_, index) => ({
      filePath: `/repo/file${index + 1}.txt`,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
    }));
    const { container } = renderBash({ bashEditDiff: { files, moreFiles: 0 } });

    expect(fileSections(container)).toHaveLength(20);
    expect(container.textContent).toContain('file20.txt');
    expect(container.textContent).not.toContain('file21.txt');
    expect(noteTexts(container)).toEqual(['… 5 more files changed']);
  });

  it('draws nothing extra when the result has no usable diff', () => {
    const bare = renderBash(undefined).container.innerHTML;

    expect(renderBash(NO_DIFF).container.innerHTML).toBe(bare);
    expect(renderBash({ bashEditDiff: { files: [], moreFiles: 0 } }).container.innerHTML).toBe(bare);
    // Untrusted JSON of the wrong shape is ignored rather than crashing the row.
    expect(renderBash({ bashEditDiff: 'nope' }).container.innerHTML).toBe(bare);
    expect(renderBash({ bashEditDiff: { files: 'nope', moreFiles: 'many' } }).container.innerHTML).toBe(bare);
    expect(renderBash({ bashEditDiff: { files: [{ filePath: 42, hunks: [] }, null], moreFiles: -1 } }).container.innerHTML)
      .toBe(bare);
    // A file whose hunks are missing or unreadable is not passed off as an empty file.
    for (const hunks of [undefined, 'nope', [{ oldStart: 1 }, null]]) {
      expect(renderBash({ bashEditDiff: { files: [{ filePath: '/repo/f.txt', hunks }], moreFiles: 0 } }).container.innerHTML)
        .toBe(bare);
    }
  });

  it('caps a long file and says how many lines it left out, while counting them all', () => {
    const lines = Array.from({ length: 250 }, (_, index) => `+line ${index + 1}`);
    const { container } = renderBash({
      bashEditDiff: {
        files: [{ filePath: '/repo/long.txt', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 250, lines }], created: true }],
        moreFiles: 0,
      },
    });
    const rows = diffLineTexts(container);

    expect(rows).toContain('+line 200');
    expect(rows).not.toContain('+line 201');
    expect(rows[rows.length - 1]).toBe('… 50 more lines');
    expect(container.querySelectorAll('[aria-label="250 lines added, 0 removed"]')).toHaveLength(1);
  });

  it('opens a changed file from its name, but not one the command deleted', () => {
    const onFileOpen = vi.fn();
    const { getByText, container } = renderBash(CREATED_AND_DELETED, { onFileOpen });

    fireEvent.click(getByText('h.txt'));
    expect(onFileOpen).toHaveBeenCalledWith('/repo/h.txt');

    // A deleted file's name only toggles its block open.
    fireEvent.click(getByText('keep.txt'));
    expect(onFileOpen).toHaveBeenCalledTimes(1);
    const fileLinks = Array.from(container.querySelectorAll('button.font-mono')).map((button) => button.textContent);
    expect(fileLinks).toEqual(['empty.txt', 'h.txt']);
  });
});

describe('a live Bash result reaching the transcript', () => {
  // The rows the server streams for one Bash call: the tool_use, then its
  // tool_result carrying the SDK frame's `tool_use_result` as `toolUseResult`.
  const liveRows: NormalizedMessage[] = [
    {
      id: 'row-use',
      sessionId: 'session-1',
      timestamp: '2026-10-02T20:08:04.000Z',
      provider: 'claude',
      kind: 'tool_use',
      toolName: 'Bash',
      toolId: 'toolu_live',
      toolInput: { command: "sed -i 's/two/TWO/' g.txt", description: 'Edit g.txt' },
    },
    {
      id: 'row-result',
      sessionId: 'session-1',
      timestamp: '2026-10-02T20:08:05.000Z',
      provider: 'claude',
      kind: 'tool_result',
      toolId: 'toolu_live',
      content: '(Bash completed with no output)',
      isError: false,
      toolUseResult: TWO_FILES_CHANGED,
    },
  ];

  it('shows the diff under the command row', () => {
    const [message] = normalizedToChatMessages(liveRows);
    const { container } = render(
      <UiPreferencesProvider>
        <MessageComponent message={message} prevMessage={null} createDiff={() => []} provider="claude" />
      </UiPreferencesProvider>,
    );

    expect(container.textContent).toContain("sed -i 's/two/TWO/' g.txt");
    expect(diffLineTexts(container)).toContain('+TWO');
    expect(container.querySelectorAll('[aria-label="1 lines added, 1 removed"]')).toHaveLength(1);
  });
});
