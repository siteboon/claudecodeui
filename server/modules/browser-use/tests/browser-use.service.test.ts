import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';

test('browser monitor list starts empty without agent sessions', async () => {
  const sessions = await browserUseService.listSessions();

  assert.deepEqual(sessions, []);
});

test('manual control keeps the same Chromium page and blocks agent access until explicit return', {
  skip: process.env.CLOUDCLI_TEST_BROWSER_CONTROL !== '1',
}, async (t) => {
  const { appConfigDb } = await import('@/modules/database/index.js');
  t.mock.method(appConfigDb, 'get', () => JSON.stringify({ enabled: true }));
  const fixture = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<body style="min-height: 150vh">
      <input autofocus><output id="text"></output><output id="events"></output>
      <script>
        document.querySelector('input').oninput = (event) => {
          document.querySelector('#text').textContent = event.target.value;
        };
        const mark = (event) => {
          const output = document.querySelector('#events');
          if (!output.textContent.includes(event)) output.append(' ' + event);
        };
        addEventListener('click', () => mark('clicked'));
        addEventListener('wheel', () => mark('scrolled'));
        addEventListener('mousemove', (event) => { if (event.buttons) mark('dragged'); });
        addEventListener('keydown', (event) => { if (event.key === 'Enter') mark('keyed'); });
      </script>
    </body>`);
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  t.after(() => { fixture.closeAllConnections(); fixture.close(); });
  const address = fixture.address();
  assert.ok(address && typeof address !== 'string');
  const session = await browserUseService.createAgentSession();
  t.after(() => browserUseService.stopSession(session.id).then(() => undefined));
  assert.equal(session.status, 'ready', session.message ?? undefined);
  await browserUseService.agentNavigate(session.id, 'http://127.0.0.1:' + address.port);

  const { controlId } = await browserUseService.takeControl(session.id);
  await assert.rejects(browserUseService.takeControl(session.id), /another viewer/i);
  await assert.rejects(browserUseService.controlFrame(session.id, 'wrong'), /control expired/i);
  await assert.rejects(browserUseService.agentSnapshot(session.id), /taken control/);
  await assert.rejects(browserUseService.agentClick(session.id, { x: 20, y: 20 }), /taken control/);
  await assert.rejects(browserUseService.agentStopSession(session.id), /taken control/);
  await assert.rejects(browserUseService.userInput(session.id, { type: 'key', key: 'Tab' }), /live viewer/);
  const [listed] = await browserUseService.listAgentSessions();
  assert.equal(listed.userControlled, true);
  assert.equal(listed.screenshotDataUrl, null);
  assert.equal(listed.url, null);
  assert.ok(!('control' in listed));
  await browserUseService.controlInput(session.id, controlId, { type: 'text', text: 'manual input' });
  await browserUseService.controlInput(session.id, controlId, { type: 'key', key: 'Enter' });
  await browserUseService.controlInput(session.id, controlId, { type: 'pointer', x: 0.3, y: 0.4 });
  await browserUseService.controlInput(session.id, controlId, { type: 'wheel', x: 0.3, y: 0.4, dx: 0, dy: 200 });
  await browserUseService.controlInput(session.id, controlId, { type: 'pointer', x: 0.3, y: 0.4, to: { x: 0.6, y: 0.4 } });
  assert.match(await browserUseService.controlFrame(session.id, controlId) || '', /^data:image\/jpeg;base64,/);

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 16_000 });
  await assert.rejects(browserUseService.controlFrame(session.id, controlId), /control expired/i);
  await assert.rejects(browserUseService.agentSnapshot(session.id), /taken control/);
  const next = await browserUseService.takeControl(session.id);
  await assert.rejects(browserUseService.releaseControl(session.id, controlId), /control expired/i);
  await browserUseService.releaseControl(session.id, next.controlId);
  t.mock.timers.reset();
  const snapshot = await browserUseService.agentSnapshot(session.id);
  for (const event of ['manual input', 'clicked', 'scrolled', 'dragged', 'keyed']) {
    assert.ok(snapshot.text.includes(event), `Missing ${event} in ${snapshot.text}`);
  }
});
