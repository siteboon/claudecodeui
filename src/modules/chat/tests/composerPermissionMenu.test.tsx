import assert from 'node:assert/strict';

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import type { PermissionMode } from '@/shared/types';
import { i18n } from '@/modules/i18n';
import frChat from '@/modules/i18n/locales/fr/chat.json';
import ComposerPermissionMenu from '@/modules/chat/composer/ComposerPermissionMenu';
import { PromptInputFooter, PromptInputTools } from '@/modules/chat/composer/PromptInput';

/**
 * The permission control used to be a bare icon, so nothing on screen said
 * which mode the next message would run in — plan mode included, which reads
 * as "nothing will be changed" and is the one users most need to see.
 */

const MODES = ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'] as const;

test('the composer names the mode the next message runs in', () => {
  const { getByRole } = render(
    <ComposerPermissionMenu
      permissionMode="plan"
      permissionModes={[...MODES]}
      onSelectPermissionMode={() => {}}
      providerLabel="Claude"
    />,
  );

  assert.match(getByRole('button').textContent ?? '', /Plan Mode/);
});

test('a screen reader hears the mode the button shows', () => {
  const { getByRole } = render(
    <ComposerPermissionMenu
      permissionMode="plan"
      permissionModes={[...MODES]}
      onSelectPermissionMode={() => {}}
      providerLabel="Claude"
    />,
  );

  assert.ok(getByRole('button', { name: /^Plan Mode/ }));
});

test('the default mode is named too', () => {
  const { getByRole } = render(
    <ComposerPermissionMenu
      permissionMode="default"
      permissionModes={[...MODES]}
      onSelectPermissionMode={() => {}}
      providerLabel="Claude"
    />,
  );

  assert.match(getByRole('button').textContent ?? '', /Default Mode/);
});

const renderMenu = (permissionMode: PermissionMode, permissionModes: PermissionMode[] = [...MODES]) =>
  render(
    <ComposerPermissionMenu
      permissionMode={permissionMode}
      permissionModes={permissionModes}
      onSelectPermissionMode={() => {}}
      providerLabel="Claude"
    />,
  );

test('every mode leads the accessible name, a mode with no translation by its id', () => {
  // A provider may report a mode this menu has no name for; it is named by its id.
  const unknownMode = 'dontAsk' as PermissionMode;
  const expected: Array<[PermissionMode, string]> = [
    ['default', 'Default Mode'],
    ['auto', 'Auto Mode'],
    ['acceptEdits', 'Accept Edits'],
    ['bypassPermissions', 'Bypass Permissions'],
    ['plan', 'Plan Mode'],
    [unknownMode, 'dontAsk'],
  ];

  for (const [mode, name] of expected) {
    const { getByRole, unmount } = renderMenu(mode, [...MODES, unknownMode]);
    const trigger = getByRole('button', { name: new RegExp(`^${name}: `) });
    assert.equal(trigger.textContent, name);
    unmount();
  }
});

// jsdom has no layout, so the footer tests below give the composer the widths
// the real app measures for Claude with text typed: 210px of left-hand tools,
// and 273px of controls (schedule, model menu, this trigger, send) with the
// trigger as a 32px icon. A named trigger is 40px plus 6px per character,
// capped at 192px like the real one.
const layout = { room: 0, tools: 210 };
const CONTROLS_BESIDE_TRIGGER = 241;

const triggerWidth = (trigger: Element | null) => {
  const name = trigger?.querySelector('span')?.textContent;
  return name ? Math.min(192, 40 + 6 * name.length) : 32;
};

const widthOf = (element: Element) => {
  if (element.matches('[data-slot="prompt-input-tools"]')) {
    return layout.tools;
  }
  if (element.matches('[data-testid="composer-controls"]')) {
    return CONTROLS_BESIDE_TRIGGER + triggerWidth(element.querySelector('button'));
  }
  return element.matches('button[aria-haspopup="menu"]') ? triggerWidth(element) : 0;
};

const resizeObservers = new Set<{ callback: () => void }>();

const layOutComposer = (room: number, tools = 210) => {
  layout.room = room;
  layout.tools = tools;
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.matches('[data-slot="prompt-input-footer"]') ? layout.room : 0;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width = widthOf(this);
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 32, width, height: 32, toJSON: () => ({}) };
  });
  vi.stubGlobal('ResizeObserver', class {
    callback: () => void;

    constructor(callback: () => void) {
      this.callback = callback;
    }

    observe() {
      resizeObservers.add(this);
    }

    disconnect() {
      resizeObservers.delete(this);
    }
  });
};

/** Changes the composer's widths the way a resize or a keystroke would, and lets the observers see it. */
const resizeComposer = (changes: Partial<typeof layout>) => {
  act(() => {
    Object.assign(layout, changes);
    for (const observer of [...resizeObservers]) {
      observer.callback();
    }
  });
};

const renderInFooter = (permissionMode: PermissionMode) =>
  render(
    <PromptInputFooter>
      <PromptInputTools />
      <div data-testid="composer-controls">
        <ComposerPermissionMenu
          permissionMode={permissionMode}
          permissionModes={[...MODES]}
          onSelectPermissionMode={() => {}}
          providerLabel="Claude"
        />
      </div>
    </PromptInputFooter>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  resizeObservers.clear();
});

test('the mode is named where the composer has room, and only the icon is left where it does not', () => {
  // 678px is the composer at 1024px with the sidebar open.
  layOutComposer(678);
  const { getByRole } = renderInFooter('default');
  const trigger = getByRole('button', { name: /^Default Mode: / });
  assert.equal(trigger.textContent, 'Default Mode');

  // The code editor docked beside the chat at 1280px leaves 330px. Even on its
  // own row the named trigger would push the send button out of the composer.
  resizeComposer({ room: 330 });
  assert.equal(trigger.textContent, '');
  assert.ok(getByRole('button', { name: /^Default Mode: / }), 'the accessible name still says which mode');

  // Docked at 1440px everything fits on one row, with 7px to spare: the name
  // would move the controls onto a second row, so it stays hidden.
  resizeComposer({ room: 490 });
  assert.equal(trigger.textContent, '');

  resizeComposer({ room: 678 });
  assert.equal(trigger.textContent, 'Default Mode');
});

test('plan mode keeps its name wherever it fits inside the composer', () => {
  // Docked at 1366px (416px): the controls already need a row of their own,
  // and with the name they still fit inside it. Default mode stays an icon.
  layOutComposer(416);
  const plan = renderInFooter('plan');
  assert.equal(plan.getByRole('button').textContent, 'Plan Mode');
  plan.unmount();

  const other = renderInFooter('default');
  assert.equal(other.getByRole('button').textContent, '');
  other.unmount();

  // Docked at 1280px (330px) even Plan Mode's name would push the send button
  // out, so plan mode falls back to the icon too.
  layOutComposer(330);
  const narrow = renderInFooter('plan');
  assert.equal(narrow.getByRole('button').textContent, '');
  assert.ok(narrow.getByRole('button', { name: /^Plan Mode: / }));
});

test('typing the first character neither takes the name away nor brings it in', () => {
  // The clear button joins the left-hand tools (174px -> 210px) once something
  // is typed. A name is only shown with that much room to spare, and once shown
  // it stays as long as it fits.
  layOutComposer(580, 174);
  const roomy = renderInFooter('default');
  assert.equal(roomy.getByRole('button').textContent, 'Default Mode');
  resizeComposer({ tools: 210 });
  assert.equal(roomy.getByRole('button').textContent, 'Default Mode');
  roomy.unmount();

  layOutComposer(540, 174);
  const tight = renderInFooter('default');
  assert.equal(tight.getByRole('button').textContent, '');
  resizeComposer({ tools: 210 });
  assert.equal(tight.getByRole('button').textContent, '');
});

test('the trigger and the menu speak the user\'s language', async () => {
  await act(async () => {
    await i18n.changeLanguage('fr');
  });
  try {
    const { getByRole, getAllByRole } = renderMenu('plan');
    const trigger = getByRole('button');
    const heading = frChat.composer.permissionHeading.replace('{{provider}}', 'Claude');

    assert.equal(trigger.textContent, frChat.codex.modes.plan);
    assert.equal(
      trigger.getAttribute('aria-label'),
      frChat.composer.permissionTriggerLabel.replace('{{mode}}', frChat.codex.modes.plan).replace('{{heading}}', heading),
    );
    assert.match(trigger.getAttribute('aria-label') ?? '', /^Mode planification : /);

    fireEvent.click(trigger);
    const rows = getAllByRole('menuitemradio');
    assert.equal(rows.length, MODES.length);
    MODES.forEach((mode, index) => {
      assert.ok(rows[index].textContent?.startsWith(frChat.codex.modes[mode]), `${mode} row is in French`);
    });
    assert.equal(getByRole('menu').lastElementChild?.textContent, frChat.composer.permissionCycleHint);
  } finally {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  }
});

test('the menu ends by saying Tab in the message box switches modes', () => {
  const { getByRole } = renderMenu('default');
  fireEvent.click(getByRole('button'));

  assert.equal(getByRole('menu').lastElementChild?.textContent, 'Press Tab in the message box to switch modes');
});
