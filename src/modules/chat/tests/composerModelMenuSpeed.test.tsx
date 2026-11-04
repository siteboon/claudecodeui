import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';
import type { ProviderModelOption } from '@/shared/types';

const MODELS: ProviderModelOption[] = [
  {
    value: 'gpt-6.1-sol',
    label: 'GPT-6.1-Sol',
    description: 'Latest workhorse model for coding and everyday work.',
    effort: { default: 'medium', values: [{ value: 'medium' }, { value: 'ultra' }] },
    speed: {
      values: [
        { value: 'priority', label: 'Fast', description: '2x speed, increased usage' },
        { value: 'ultrafast', label: 'Ultrafast' },
      ],
    },
  },
];

const renderMenu = (speed: string, speedOptions = MODELS[0].speed!.values, onSelectSpeed = vi.fn()) => render(
  <ComposerModelMenu
    effort="default"
    effortOptions={MODELS[0].effort!.values}
    onSelectEffort={vi.fn()}
    speed={speed}
    speedOptions={speedOptions}
    onSelectSpeed={onSelectSpeed}
    model="gpt-6.1-sol"
    modelOptions={MODELS}
    onSelectModel={vi.fn()}
    modelsLoading={false}
  />,
);

test('lists the speed tiers the model offers next to Standard and reports the pick', () => {
  const onSelectSpeed = vi.fn();
  renderMenu('default', MODELS[0].speed!.values, onSelectSpeed);

  fireEvent.click(screen.getByRole('button', { name: 'Select model and reasoning effort' }));
  assert.ok(screen.getByText('Speed'));
  assert.ok(screen.getByText('Standard'));
  assert.ok(screen.getByText('2x speed, increased usage'));

  fireEvent.click(screen.getByText('Ultrafast'));
  assert.deepEqual(onSelectSpeed.mock.calls, [['ultrafast']]);
});

test('shows the chosen tier on the trigger and hides the section for models without tiers', () => {
  const { unmount } = renderMenu('priority');
  assert.ok(screen.getByText('· Fast'));
  unmount();

  renderMenu('default', []);
  fireEvent.click(screen.getByRole('button', { name: 'Select model and reasoning effort' }));
  assert.equal(screen.queryByText('Speed'), null);
});
