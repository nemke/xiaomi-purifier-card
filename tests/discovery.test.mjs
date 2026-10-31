import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectReadings,
  fanSpeedSource,
  mergeReadings,
  readingKind,
} from '../src/discovery.ts';

const fan = 'fan.purifier';
const labels = {
  pm25: 'PM 2.5',
  pm10: 'PM 10',
  temperature: 'Temperature',
  humidity: 'Humidity',
};
const entry = (entity_id, device_id = 'purifier', extra = {}) => ({
  entity_id,
  device_id,
  ...extra,
});
const sensor = (device_class, unit_of_measurement) => ({
  state: '5',
  attributes: { device_class, unit_of_measurement },
});
const states = {
  [fan]: { state: 'on', attributes: { percentage: 33 } },
  'sensor.renamed_particles': sensor('pm25', 'μg/m³'),
  'sensor.large_particles': sensor('pm10', 'μg/m³'),
  'sensor.inlet': sensor('temperature', '°F'),
  'sensor.moisture': sensor('humidity', '%'),
  'sensor.motor': sensor(undefined, 'RPM'),
  'sensor.other_pm25': sensor('pm25', 'μg/m³'),
};
const registry = [
  entry(fan),
  ...Object.keys(states)
    .filter((id) => id.startsWith('sensor.') && id !== 'sensor.other_pm25')
    .map((id) => entry(id)),
  entry('sensor.other_pm25', 'another-device'),
];

test('detects legacy fan attributes and keeps separate attribute statistics distinct', () => {
  const legacy = {
    [fan]: {
      state: 'on',
      attributes: {
        motor_speed: 750,
        pm2_5: 5,
        pm10: 7,
        temperature: 22,
        humidity: 40,
      },
    },
  };
  const detected = detectReadings(legacy, [], fan, labels);
  assert.deepEqual(detected.main, { attribute: 'motor_speed', unit: 'RPM' });
  assert.deepEqual(
    detected.stats.map((stat) => stat.attribute),
    ['pm2_5', 'pm10', 'temperature', 'humidity'],
  );
  assert.equal(detected.stats[2].unit, undefined);
  const merged = mergeReadings(
    { entity: fan },
    detected,
    legacy,
    [],
    true,
    new Set(),
  );
  assert.equal(merged.stats.length, 4);
});
test('does not relabel an AQI index or an unknown attribute as a PM2.5 concentration', () => {
  const legacy = {
    [fan]: { state: 'on', attributes: { aqi: 42, temperature: 'unknown' } },
  };
  assert.deepEqual(detectReadings(legacy, [], fan, labels).stats, []);
});
test('empty source keys do not override the detected main source', () => {
  const next = mergeReadings(
    { entity: fan, aqi: { entity_id: '', attribute: '', unit: 'Custom' } },
    detectReadings(states, registry, fan, labels),
    states,
    registry,
    true,
    new Set(),
  );
  assert.deepEqual(next.aqi, { entity_id: 'sensor.motor', unit: 'Custom' });
});
test('detects all four readings by device membership and device class, preserving units', () => {
  const result = detectReadings(states, registry, fan, labels);
  assert.deepEqual(result.main, { entity_id: 'sensor.motor', unit: 'RPM' });
  assert.deepEqual(
    result.stats.map((stat) => stat.entity_id),
    [
      'sensor.renamed_particles',
      'sensor.large_particles',
      'sensor.inlet',
      'sensor.moisture',
    ],
  );
  assert.equal(result.stats[2].unit, '°F');
  assert.equal(result.deviceLinked, true);
});
test('does not infer device membership from similar entity names', () => {
  const result = detectReadings(
    states,
    registry.filter(
      (item) => item.entity_id === fan || item.device_id === 'another-device',
    ),
    fan,
    labels,
  );
  assert.deepEqual(result.stats, []);
  assert.deepEqual(result.main, { attribute: 'percentage', unit: '%' });
});
test('falls back to measured fan attributes, including zero, before percentage', () => {
  assert.deepEqual(
    fanSpeedSource(
      {
        [fan]: { state: 'off', attributes: { motor_speed: 0, percentage: 0 } },
      },
      fan,
    ),
    { attribute: 'motor_speed', unit: 'RPM' },
  );
  assert.deepEqual(
    fanSpeedSource(
      { [fan]: { state: 'off', attributes: { percentage: 0 } } },
      fan,
    ),
    { attribute: 'percentage', unit: '%' },
  );
  assert.equal(
    fanSpeedSource(
      { [fan]: { state: 'on', attributes: { speed: 'Silent' } } },
      fan,
    ),
    undefined,
  );
});
test('does not use target number entities as measured speed', () => {
  const result = detectReadings(
    { ...states, 'number.favorite_rpm': sensor(undefined, 'RPM') },
    [entry(fan), entry('number.favorite_rpm')],
    fan,
    labels,
  );
  assert.deepEqual(result.main, { attribute: 'percentage', unit: '%' });
});
test('skips disabled, missing, and ambiguous sensors instead of guessing', () => {
  const result = detectReadings(
    { ...states, 'sensor.second_pm25': sensor('pm25', 'μg/m³') },
    [
      ...registry.filter((item) => item.entity_id !== 'sensor.inlet'),
      entry('sensor.inlet', 'purifier', { disabled_by: 'user' }),
      entry('sensor.missing'),
      entry('sensor.second_pm25'),
    ],
    fan,
    labels,
  );
  assert.equal(
    result.stats.some((stat) => stat.entity_id === 'sensor.renamed_particles'),
    false,
  );
  assert.equal(
    result.stats.some((stat) => stat.entity_id === 'sensor.inlet'),
    false,
  );
});
test('prefers the direct measurement over an average and supports registry hints', () => {
  const result = detectReadings(
    {
      ...states,
      'sensor.average': sensor('pm25', 'μg/m³'),
      'sensor.legacy': sensor(undefined, '%'),
    },
    [
      ...registry,
      entry('sensor.average', 'purifier', { original_name: 'Average PM2.5' }),
      entry('sensor.legacy', 'purifier', { translation_key: 'humidity' }),
    ].filter((item) => item.entity_id !== 'sensor.moisture'),
    fan,
    labels,
  );
  assert.equal(result.stats[0].entity_id, 'sensor.renamed_particles');
  assert.equal(result.stats[3].entity_id, 'sensor.legacy');
});
test('device class takes priority over a misleading entity name', () => {
  assert.equal(
    readingKind(
      { 'sensor.old_pm25': sensor('humidity', '%') },
      { entity_id: 'sensor.old_pm25' },
    ),
    'humidity',
  );
});
test('manual re-detection preserves configured sensors, labels, units, templates, and shortcuts', () => {
  const detected = detectReadings(states, registry, fan, labels);
  const config = {
    entity: fan,
    aqi: { entity_id: 'sensor.other_pm25', unit: 'custom' },
    stats: [
      {
        entity_id: 'sensor.other_pm25',
        subtitle: 'My reading',
        unit: 'custom',
        value_template: '{{ value }}',
      },
    ],
    shortcuts: [{ preset_mode: 'Auto' }],
  };
  const next = mergeReadings(
    config,
    detected,
    states,
    registry,
    true,
    new Set(),
  );
  assert.deepEqual(next.aqi, config.aqi);
  assert.deepEqual(next.stats[0], config.stats[0]);
  assert.equal(next.stats.length, 4);
  assert.equal(
    next.stats.some((stat) => stat.entity_id === 'sensor.renamed_particles'),
    false,
  );
  assert.deepEqual(next.shortcuts, config.shortcuts);
});
test('automatic detection preserves an intentionally empty statistics list', () => {
  const next = mergeReadings(
    { entity: fan, stats: [] },
    detectReadings(states, registry, fan, labels),
    states,
    registry,
    false,
    new Set(),
  );
  assert.deepEqual(next.stats, []);
});
test('fills an empty placeholder row without duplicating it', () => {
  const next = mergeReadings(
    { entity: fan, stats: [{}] },
    detectReadings(states, registry, fan, labels),
    states,
    registry,
    true,
    new Set(),
  );
  assert.equal(next.stats.length, 4);
  assert.ok(next.stats.every((stat) => stat.entity_id));
});
test('protects uncommitted text sections while a registry lookup finishes', () => {
  const config = { entity: fan, stats: [{}] };
  const next = mergeReadings(
    config,
    detectReadings(states, registry, fan, labels),
    states,
    registry,
    true,
    new Set(['aqi', 'stats']),
  );
  assert.equal(next.aqi, undefined);
  assert.deepEqual(next.stats, [{}]);
});
test('unlinked fan keeps percentage available and does not use another device sensors', () => {
  const result = detectReadings(
    states,
    registry.filter((item) => item.entity_id !== fan),
    fan,
    labels,
  );
  assert.equal(result.deviceLinked, false);
  assert.deepEqual(result.stats, []);
  assert.deepEqual(result.main, { attribute: 'percentage', unit: '%' });
});
