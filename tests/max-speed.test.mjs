import './helpers/typescript.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { maxSpeedShortcut, buildToolbar } = await import('../src/toolbar.ts');
const { prepareActions, shortcutActions, shortcutActive } =
  await import('../src/model.ts');
const { commandGoals, goalConfirmed } = await import('../src/command.ts');

const fan = 'fan.renamed_purifier';
const entity = (modes, extra = {}) => ({
  state: 'on',
  attributes: { supported_features: 57, preset_modes: modes, ...extra },
});

test('4 Pro Max selects Fan before native 100%, even after a custom Favorite speed', () => {
  const current = entity(['Auto', 'Silent', 'Favorite', 'Fan'], {
    preset_mode: 'Favorite',
    percentage: 33,
  });
  const shortcut = maxSpeedShortcut(current);
  const actions = prepareActions(
    shortcutActions(shortcut, fan),
    { [fan]: current },
    fan,
  );
  assert.deepEqual(
    actions.map((a) => [a.service, a.service_data]),
    [
      ['fan.set_preset_mode', { preset_mode: 'Fan' }],
      ['fan.set_percentage', { percentage: 100 }],
    ],
  );
  assert.ok(actions.every((a) => a.target.entity_id === fan));
  assert.equal(shortcutActive(shortcut, { [fan]: current }, fan), false);
});

test('3C Max selects Favorite then its native maximum without needing number entities or model IDs', () => {
  const current = entity(['Auto', 'Silent', 'Favorite']);
  const shortcut = maxSpeedShortcut(current);
  assert.equal(shortcut.preset_mode, 'Favorite');
  assert.equal(shortcut.percentage, 100);
  assert.equal(
    prepareActions(shortcutActions(shortcut, fan), { [fan]: current }, fan)
      .length,
    2,
  );
  assert.deepEqual(Object.keys(shortcut).sort(), [
    'icon',
    'name',
    'percentage',
    'preset_mode',
  ]);
});

test('generic percentage purifiers use native speed without inventing a preset', () => {
  const current = entity(['auto', 'sleep'], { supported_features: 1 });
  const shortcut = maxSpeedShortcut(current);
  assert.equal(shortcut.preset_mode, undefined);
  assert.deepEqual(
    shortcutActions(shortcut, fan).map((a) => a.service),
    ['fan.set_percentage'],
  );
  assert.equal(
    maxSpeedShortcut(entity(['Favorite'], { supported_features: 1 }))
      .preset_mode,
    undefined,
  );
  assert.equal(
    maxSpeedShortcut(entity(['AUTO', 'MANUAL'])).preset_mode,
    'MANUAL',
  );
});

test('Max is absent without native speed support or available state, but remains available while off', () => {
  assert.equal(maxSpeedShortcut(undefined), undefined);
  for (const state of ['unknown', 'unavailable'])
    assert.equal(maxSpeedShortcut({ ...entity(['Fan']), state }), undefined);
  for (const supported_features of [0, 8, 56, undefined])
    assert.equal(
      maxSpeedShortcut(entity(['Fan'], { supported_features })),
      undefined,
    );
  assert.ok(maxSpeedShortcut({ ...entity(['Fan']), state: 'off' }));
});

test('default Max preserves normal preset choices, respects hide setting, and keeps a custom Max override', () => {
  const modes = ['Auto', 'Silent', 'Favorite', 'Fan'];
  const maximum = maxSpeedShortcut(entity(modes));
  const config = { entity: fan, shortcuts: [] };
  const toolbar = buildToolbar(config, modes, undefined, maximum);
  assert.deepEqual(
    toolbar.map((s) => s.name),
    [...modes, 'Max'],
  );
  assert.equal(
    buildToolbar(
      { ...config, show_max_speed: false },
      modes,
      undefined,
      maximum,
    ).length,
    4,
  );
  const custom = { name: ' max ', service: 'script.my_max' };
  const overridden = buildToolbar(
    { ...config, shortcuts: [custom] },
    modes,
    undefined,
    maximum,
  );
  assert.equal(overridden.length, 5);
  assert.ok(overridden.includes(custom));
  const localized = maxSpeedShortcut(entity(modes), 'Maximum');
  assert.equal(
    buildToolbar(
      { ...config, shortcuts: [{ name: 'Maximum', service: 'script.max' }] },
      modes,
      undefined,
      localized,
    ).length,
    5,
  );
});

test('Max confirmation requires both its manual mode and full speed; an Auto percentage alone is insufficient', () => {
  const current = entity(['Auto', 'Fan'], {
    preset_mode: 'Auto',
    percentage: 100,
  });
  const shortcut = maxSpeedShortcut(current);
  const actions = prepareActions(
    shortcutActions(shortcut, fan),
    { [fan]: current },
    fan,
  );
  const goals = commandGoals(actions);
  assert.equal(
    goals.every((g) => goalConfirmed(g, { [fan]: current })),
    false,
  );
  current.attributes.preset_mode = 'Fan';
  assert.equal(
    goals.every((g) => goalConfirmed(g, { [fan]: current })),
    true,
  );
  assert.equal(shortcutActive(shortcut, { [fan]: current }, fan), true);
  current.attributes.percentage = 33;
  assert.equal(shortcutActive(shortcut, { [fan]: current }, fan), false);
});
