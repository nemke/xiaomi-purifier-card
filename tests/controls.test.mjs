import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectControls, numberBounds } from '../src/controls.ts';
import { commandGoals, goalConfirmed } from '../src/command.ts';
import { detectReadings } from '../src/discovery.ts';

const state = (value, attributes = {}) => ({
  state: String(value),
  attributes,
});

test('control discovery uses device membership, supported presets, numeric bounds and unambiguous metadata', () => {
  const states = {
    'fan.main': state('on', { preset_modes: ['Auto', 'Favorite', 'Fan'] }),
    'number.favorite_level': state(4, { min: 0, max: 14, step: 1 }),
    'number.fan_level': state(1, { min: 1, max: 3, step: 1 }),
    'number.other_favorite_level': state(8, { min: 0, max: 14, step: 1 }),
    'switch.child_lock': state('off'),
    'switch.buzzer': state('on'),
    'select.led_brightness': state('Bright', { options: ['Bright', 'Off'] }),
  };
  const registry = Object.keys(states).map((entity_id) => ({
    entity_id,
    device_id: entity_id.includes('other') ? 'other' : 'main',
  }));
  const found = detectControls(states, registry, 'fan.main');
  assert.deepEqual(found.speed_controls, [
    { entity_id: 'number.favorite_level', preset_mode: 'Favorite' },
    { entity_id: 'number.fan_level', preset_mode: 'Fan' },
  ]);
  assert.deepEqual(
    found.device_controls.map((item) => item.entity_id),
    ['switch.child_lock', 'switch.buzzer', 'select.led_brightness'],
  );
  assert.deepEqual(detectControls(states, [], 'fan.main').speed_controls, []);
  registry.push({
    entity_id: 'number.other_favorite_level',
    device_id: 'main',
  });
  assert.equal(
    detectControls(states, registry, 'fan.main').speed_controls.some(
      (item) => item.preset_mode === 'Favorite',
    ),
    false,
  );
});

test('controls without reliable bounds or disabled registry entries are not suggested', () => {
  assert.equal(numberBounds(state(1, { min: 0, max: 14, step: 0 })), undefined);
  assert.equal(
    numberBounds(state(1, { min: 0, max: Infinity, step: 1 })),
    undefined,
  );
  const states = {
    'fan.main': state('on', { preset_modes: ['Favorite'] }),
    'number.favorite_rpm': state(750, { min: 300, max: 2200, step: 10 }),
  };
  const registry = [
    { entity_id: 'fan.main', device_id: 'main' },
    {
      entity_id: 'number.favorite_rpm',
      device_id: 'main',
      disabled_by: 'user',
    },
  ];
  assert.deepEqual(
    detectControls(states, registry, 'fan.main').speed_controls,
    [],
  );
});

test('unitless fan speed levels never become invented RPM readings', () => {
  const states = {
    'fan.main': state('on', { percentage: 66 }),
    'sensor.fan_speed': state(9),
  };
  const registry = Object.keys(states).map((entity_id) => ({
    entity_id,
    device_id: 'main',
  }));
  assert.deepEqual(detectReadings(states, registry, 'fan.main', {}).main, {
    attribute: 'percentage',
    unit: '%',
  });
});

test('command confirmation tracks final settings and requires actual device states', () => {
  const goals = commandGoals([
    {
      service: 'fan.turn_on',
      target: { entity_id: 'fan.main' },
      service_data: { preset_mode: 'Favorite' },
    },
    {
      service: 'number.set_value',
      target: { entity_id: 'number.target' },
      service_data: { value: 750 },
    },
    {
      service: 'number.set_value',
      target: { entity_id: 'number.target' },
      service_data: { value: 1250 },
    },
  ]);
  assert.equal(goals.length, 3);
  const states = {
    'fan.main': state('on', { preset_mode: 'Favorite' }),
    'number.target': state('750'),
  };
  assert.equal(
    goals.every((goal) => goalConfirmed(goal, states)),
    false,
  );
  states['number.target'] = state('1250');
  assert.equal(
    goals.every((goal) => goalConfirmed(goal, states)),
    true,
  );
  states['number.target'] = state('unavailable');
  assert.equal(
    goals.every((goal) => goalConfirmed(goal, states)),
    false,
  );
  assert.deepEqual(commandGoals([{ service: 'script.bedtime' }]), []);
});
