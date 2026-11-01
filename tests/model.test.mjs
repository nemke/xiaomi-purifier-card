import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareActions,
  readValue,
  referencedEntities,
  shortcutActions,
  shortcutActive,
} from '../src/model.ts';

const fan = 'fan.purifier';
const entity = (state, attributes = {}) => ({ state, attributes });
const states = {
  [fan]: entity('on', {
    preset_modes: ['Auto', 'Silent', 'Favorite', 'Fan'],
    preset_mode: 'Fan',
    percentage: 0,
    supported_features: 9,
  }),
  'number.level': entity('2', { min: 1, max: 3, step: 1 }),
  'number.rpm': entity('750', { min: 300, max: 2200, step: 10 }),
  'sensor.pm': entity('0', { nested: { value: 0 } }),
};
const shortcut = {
  preset_mode: 'Fan',
  service: 'number.set_value',
  service_data: { entity_id: 'number.level', value: '2' },
};

test('sequences preset before the custom number command and preserves targets', () => {
  const actions = prepareActions(shortcutActions(shortcut, fan), states, fan);
  assert.deepEqual(actions, [
    {
      service: 'fan.set_preset_mode',
      service_data: { preset_mode: 'Fan' },
      target: { entity_id: fan },
    },
    {
      service: 'number.set_value',
      service_data: { entity_id: 'number.level', value: 2 },
      target: undefined,
    },
  ]);
});
test('supports legacy speed aliases and exact preset capitalization', () => {
  assert.equal(
    prepareActions(shortcutActions({ speed: 'silent' }, fan), states, fan)[0]
      .service_data.preset_mode,
    'Silent',
  );
});
test('does not inject a fan target into scripts or number services', () => {
  const result = prepareActions([{ service: 'script.clean_air' }], states, fan);
  assert.equal(result[0].target, undefined);
});
test('preserves an explicit custom target separately from service data', () => {
  const action = {
    service: 'number.set_value',
    target: { entity_id: 'number.level' },
    service_data: { value: '3' },
  };
  assert.deepEqual(prepareActions([action], states, fan)[0], {
    ...action,
    service_data: { value: 3 },
  });
  assert.equal(action.service_data.value, '3');
});
test('validates RPM range and steps before executing any sequence', () => {
  for (const value of [299, 2201, 751, '', null, 'no']) {
    assert.throws(() =>
      prepareActions(
        [
          {
            service: 'number.set_value',
            service_data: { entity_id: 'number.rpm', value },
          },
        ],
        states,
        fan,
      ),
    );
  }
  assert.equal(
    prepareActions(
      [
        {
          service: 'number.set_value',
          service_data: { entity_id: 'number.rpm', value: '2200' },
        },
      ],
      states,
      fan,
    )[0].service_data.value,
    2200,
  );
});
test('rejects unsupported presets and unavailable action targets', () => {
  assert.throws(() =>
    prepareActions(shortcutActions({ preset_mode: 'Turbo' }, fan), states, fan),
  );
  assert.throws(() =>
    prepareActions(
      shortcutActions(shortcut, fan),
      { ...states, 'number.level': entity('unavailable') },
      fan,
    ),
  );
});
test('supports zero percentage and rejects unsupported or out of range percentages', () => {
  assert.equal(
    prepareActions(shortcutActions({ percentage: 0 }, fan), states, fan)[0]
      .service_data.percentage,
    0,
  );
  assert.throws(() =>
    prepareActions(shortcutActions({ percentage: 101 }, fan), states, fan),
  );
  assert.throws(() =>
    prepareActions(
      shortcutActions({ percentage: 50 }, fan),
      { [fan]: entity('on', { supported_features: 8 }) },
      fan,
    ),
  );
});
test('retains zero measurements and nested attributes without inventing missing readings', () => {
  assert.equal(readValue(states, { entity_id: 'sensor.pm' }, fan), '0');
  assert.equal(
    readValue(
      states,
      { entity_id: 'sensor.pm', attribute: 'nested.value' },
      fan,
    ),
    0,
  );
  assert.equal(
    readValue(states, { entity_id: 'sensor.missing' }, fan),
    undefined,
  );
  assert.equal(
    readValue(
      { [fan]: entity('unavailable', { pm: 0 }) },
      { attribute: 'pm' },
      fan,
    ),
    undefined,
  );
});
test('requires both the preset and the number value for active shortcuts', () => {
  assert.equal(shortcutActive(shortcut, states, fan), true);
  assert.equal(
    shortcutActive(
      { ...shortcut, service_data: { entity_id: 'number.level', value: 3 } },
      states,
      fan,
    ),
    false,
  );
  assert.equal(
    shortcutActive({ ...shortcut, preset_mode: 'Favorite' }, states, fan),
    false,
  );
  assert.equal(
    shortcutActive(shortcut, { ...states, [fan]: entity('off') }, fan),
    false,
  );
  assert.equal(
    shortcutActive({ service: 'script.clean_air' }, states, fan),
    false,
  );
});
test('tracks all entities affecting readings and shortcut highlighting', () => {
  const config = {
    entity: fan,
    aqi: { entity_id: 'sensor.pm' },
    stats: [{ entity_id: 'sensor.motor' }],
    shortcuts: [shortcut, { state_entity: 'select.mode', state: 'Sleep' }],
  };
  assert.deepEqual(
    referencedEntities(config).sort(),
    [fan, 'sensor.pm', 'sensor.motor', 'number.level', 'select.mode'].sort(),
  );
});
test('supports explicit action sequences and state matching for other integrations', () => {
  const actions = [
    {
      service: 'select.select_option',
      target: { entity_id: 'select.mode' },
      service_data: { option: 'Sleep' },
    },
  ];
  const config = { actions, state_entity: 'select.mode', state: 'Sleep' };
  assert.deepEqual(shortcutActions(config, fan), actions);
  assert.equal(
    shortcutActive(config, { ...states, 'select.mode': entity('Sleep') }, fan),
    true,
  );
});
