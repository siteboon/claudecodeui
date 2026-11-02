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
// and 241px of controls beside the trigger (schedule, model menu, send and the
// gaps between them). A named trigger is 40px plus 6px per character, capped
// like the real one: 192px, and 160px below `sm`. The footer has the real one's
// 12px padding on each side, which the room does not include.
const FOOTER_PADDING = 12;

type ComposerLayout = { room: number; tools: number; controls: number; cap: number };

const layout: ComposerLayout = { room: 0, tools: 210, controls: 241, cap: 192 };

const triggerWidth = (trigger: Element | null) => {
  const name = trigger?.querySelector('span')?.textContent;
  return name ? Math.min(layout.cap, 40 + 6 * name.length) : 32;
};

const widthOf = (element: Element) => {
  if (element.matches('[data-slot="prompt-input-footer"]')) {
    return layout.room + 2 * FOOTER_PADDING;
  }
  if (element.matches('[data-slot="prompt-input-tools"]')) {
    return layout.tools;
  }
  if (element.matches('[data-testid="composer-controls"]')) {
    return layout.controls + triggerWidth(element.querySelector('button'));
  }
  return element.matches('button[aria-haspopup="menu"]') ? triggerWidth(element) : 0;
};

/**
 * Stands in for the browser's ResizeObserver: an observer hears about the
 * elements it observes, once when it starts and then only when one of them
 * changes width, and nothing at all once it is disconnected.
 */
class FakeResizeObserver {
  callback: () => void;

  reportedWidths = new Map<Element, number>();

  constructor(callback: () => void) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.reportedWidths.set(target, Number.NaN);
    liveObservers.add(this);
  }

  unobserve(target: Element) {
    this.reportedWidths.delete(target);
  }

  disconnect() {
    this.reportedWidths.clear();
    liveObservers.delete(this);
  }

  /** Calls back if an observed element's width changed since it was last reported. */
  deliver() {
    let hasChanged = false;
    for (const [target, reported] of this.reportedWidths) {
      const width = widthOf(target);
      if (width !== reported) {
        this.reportedWidths.set(target, width);
        hasChanged = true;
      }
    }
    if (hasChanged) {
      this.callback();
    }
    return hasChanged;
  }
}

const liveObservers = new Set<FakeResizeObserver>();

/** Lets frames pass, each one rendering and then delivering resizes, until the composer stops changing. */
const settle = () => {
  for (let frame = 0; frame < 10; frame += 1) {
    let hasDelivered = false;
    act(() => {
      for (const observer of [...liveObservers]) {
        hasDelivered = observer.deliver() || hasDelivered;
      }
    });
    if (!hasDelivered) {
      return;
    }
  }
  throw new Error('the composer kept changing width');
};

const layOutComposer = (changes: Partial<ComposerLayout>) => {
  Object.assign(layout, { tools: 210, controls: 241, cap: 192 }, changes);
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.matches('[data-slot="prompt-input-footer"]') ? widthOf(this) : 0;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width = widthOf(this);
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 32, width, height: 32, toJSON: () => ({}) };
  });
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
};

/** Changes the composer's widths the way a resize, a keystroke or a model change would. */
const resizeComposer = (changes: Partial<ComposerLayout>) => {
  Object.assign(layout, changes);
  settle();
};

const composerFooter = (permissionMode: PermissionMode) => (
  <PromptInputFooter style={{ paddingLeft: FOOTER_PADDING, paddingRight: FOOTER_PADDING }}>
    <PromptInputTools />
    <div data-testid="composer-controls">
      <ComposerPermissionMenu
        permissionMode={permissionMode}
        permissionModes={[...MODES]}
        onSelectPermissionMode={() => {}}
        providerLabel="Claude"
      />
    </div>
  </PromptInputFooter>
);

const renderInFooter = (permissionMode: PermissionMode) => {
  const view = render(composerFooter(permissionMode));
  settle();
  return view;
};

afterEach(() => {
  vi.unstubAllGlobals();
  liveObservers.clear();
});

test('the mode is named where the composer has room, and only the icon is left where it does not', () => {
  // 678px is the composer at 1024px with the sidebar open.
  layOutComposer({ room: 678 });
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
  layOutComposer({ room: 416 });
  const plan = renderInFooter('plan');
  assert.equal(plan.getByRole('button').textContent, 'Plan Mode');
  plan.unmount();

  const other = renderInFooter('default');
  assert.equal(other.getByRole('button').textContent, '');
  other.unmount();

  // Docked at 1280px (330px) even Plan Mode's name would push the send button
  // out by 5px, so plan mode falls back to the icon too. The footer's padding
  // is not room: counting it would leave the name on.
  layOutComposer({ room: 330 });
  const narrow = renderInFooter('plan');
  assert.equal(narrow.getByRole('button').textContent, '');
  assert.ok(narrow.getByRole('button', { name: /^Plan Mode: / }));
});

test('typing the first character neither takes the name away nor brings it in', () => {
  // The clear button joins the left-hand tools (174px -> 210px) once something
  // is typed. A name is only shown with that much room to spare, and once shown
  // it stays as long as it fits.
  layOutComposer({ room: 580, tools: 174 });
  const roomy = renderInFooter('default');
  assert.equal(roomy.getByRole('button').textContent, 'Default Mode');
  resizeComposer({ tools: 210 });
  assert.equal(roomy.getByRole('button').textContent, 'Default Mode');
  roomy.unmount();

  layOutComposer({ room: 540, tools: 174 });
  const tight = renderInFooter('default');
  assert.equal(tight.getByRole('button').textContent, '');
  resizeComposer({ tools: 210 });
  assert.equal(tight.getByRole('button').textContent, '');
});

test('a hidden name needs exactly the clear button\'s width to spare', () => {
  // Nothing typed: 174px of tools, so the named toolbar is 174 + 241 + 112
  // (Default Mode) = 527px wide. The clear button is 2.25rem, 36px at the
  // browser's default 16px font size.
  const namedToolbar = 527;
  const nameAt = (spare: number) => {
    layOutComposer({ room: namedToolbar + spare, tools: 174 });
    const view = renderInFooter('default');
    const text = view.getByRole('button').textContent;
    view.unmount();
    return text;
  };

  assert.equal(nameAt(36), 'Default Mode');
  assert.equal(nameAt(35), '');
});

test('a wider toolbar or model menu takes the name away, and it comes back when they narrow', () => {
  // 678px of room leaves the named toolbar (210 + 241 + 112) 115px to spare.
  layOutComposer({ room: 678 });
  const { getByRole } = renderInFooter('default');
  const trigger = getByRole('button');
  assert.equal(trigger.textContent, 'Default Mode');

  // The left-hand tools widen when the token count grows or the voice button appears.
  resizeComposer({ tools: 330 });
  assert.equal(trigger.textContent, '');
  resizeComposer({ tools: 210 });
  assert.equal(trigger.textContent, 'Default Mode');

  // The controls widen when a model with a longer name is picked.
  resizeComposer({ controls: 360 });
  assert.equal(trigger.textContent, '');
  resizeComposer({ controls: 241 });
  assert.equal(trigger.textContent, 'Default Mode');
});

test('the trigger leaves no observer behind', () => {
  layOutComposer({ room: 678 });
  const view = renderInFooter('default');
  // Every decision and every mode starts a new observer; the one before it stops.
  resizeComposer({ room: 330 });
  resizeComposer({ room: 678 });
  view.rerender(composerFooter('plan'));
  settle();
  assert.equal(liveObservers.size, 1);

  view.unmount();
  assert.equal(liveObservers.size, 0);
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
