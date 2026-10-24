import assert from 'node:assert/strict';
import test from 'node:test';

import { createClaudeCliCommandsService } from '@/modules/providers/services/claude-cli-commands.service.js';
import { createClaudeSideQuestionService } from '@/modules/providers/services/claude-side-question.service.js';

/**
 * The slash menu lists the commands the CLI runs itself, read from a
 * short-lived CLI process; `/btw` is answered from a fork of the session that
 * is never saved. These script the SDK query.
 */

test('the CLI command list is read once per workspace, slash-prefixed, without internal names', async () => {
  let clock = 0;
  const cwds: unknown[] = [];
  const service = createClaudeCliCommandsService({
    now: () => clock,
    isDirectory: (directoryPath) => directoryPath === '/work',
    createQuery: ({ options }) => {
      cwds.push(options.cwd);
      return Object.assign((async function* () { /* no messages */ })(), {
        supportedCommands: async () => [
          { name: 'usage', description: 'Show plan usage', argumentHint: '', aliases: ['cost'], builtin: true },
          { name: '__remote-workflow', description: 'internal' },
          { name: 'compact', description: 'Compact the conversation', argumentHint: '<instructions>' },
        ],
      });
    },
  });

  const commands = await service.listCommands('/work');
  assert.deepEqual(commands.map((command) => command.name), ['/usage', '/compact']);
  assert.deepEqual(commands[0].aliases, ['/cost']);
  assert.equal(commands[1].argumentHint, '<instructions>');

  await service.listCommands('/work');
  assert.equal(cwds.length, 1, 'cached');
  clock += 11 * 60 * 1000;
  await service.listCommands('/work');
  assert.equal(cwds.length, 2, 'read again after ten minutes');
  assert.equal(cwds[0], '/work');
});

const sideQuestionService = (session: Record<string, unknown> | null, messages: Array<Record<string, unknown>>) => {
  const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const service = createClaudeSideQuestionService({
    getSessionById: () => session as never,
    isDirectory: () => true,
    createQuery: (params) => {
      calls.push(params);
      return (async function* () { yield* messages; })();
    },
  });
  return { service, calls };
};

const answer = (text: string) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text }] } });

test('/btw forks the session without saving it, with no tools and one turn', async () => {
  const { service, calls } = sideQuestionService(
    { session_id: 'app-1', provider_session_id: 'native-1', project_path: '/work', model: 'claude-opus-5-5' },
    [answer('It returns 4.'), { type: 'result', subtype: 'success' }],
  );
  const result = await service.ask({ sessionId: 'app-1', question: 'what is 2+2?', model: 'default' });

  assert.equal(result.answer, 'It returns 4.');
  const { prompt, options } = calls[0];
  assert.ok(prompt.endsWith('what is 2+2?'));
  assert.equal(options.resume, 'native-1');
  assert.equal(options.forkSession, true);
  assert.equal(options.persistSession, false);
  assert.deepEqual(options.tools, []);
  assert.equal(options.maxTurns, 1);
  assert.equal(options.model, 'claude-opus-5-5', '"default" falls back to the session model');
  assert.equal(options.cwd, '/work');
});

test('/btw on a chat with no turns yet answers without resuming', async () => {
  const { service, calls } = sideQuestionService(
    { session_id: 'app-2', provider_session_id: null, project_path: '/work', model: null },
    [answer('Hi.'), { type: 'result', subtype: 'success' }],
  );
  await service.ask({ sessionId: 'app-2', question: 'hello', model: 'claude-haiku-5-5' });
  assert.equal(calls[0].options.resume, undefined);
  assert.equal(calls[0].options.model, 'claude-haiku-5-5');
});

test('/btw reports a missing question, an unknown session and an empty answer', async () => {
  const { service } = sideQuestionService(null, [{ type: 'result', subtype: 'error_max_turns', errors: ['ran out of turns'] }]);
  await assert.rejects(service.ask({ sessionId: null, question: '   ' }), { statusCode: 400 });
  await assert.rejects(service.ask({ sessionId: 'nope', question: 'x' }), { statusCode: 404 });
  await assert.rejects(service.ask({ sessionId: null, question: 'x' }), { statusCode: 502, message: 'ran out of turns' });
});
