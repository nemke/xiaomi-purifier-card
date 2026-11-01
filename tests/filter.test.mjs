import './helpers/typescript.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { filterStatus, filterSource, filterThresholds, detectFilterWarning } =
  await import('../src/filter.ts');
import { referencedEntities } from '../src/model.ts';

const state = (value, attributes = {}) => ({
  state: String(value),
  attributes,
});
const fan = 'fan.main';
const remaining = 'sensor.main_filter_life_remaining';
const base = () => ({
  entity: fan,
  aqi: {},
  shortcuts: [],
  stats: [{ entity_id: remaining }],
});
const states = (value, unit = '%') => ({
  [fan]: state('on'),
  [remaining]: state(value, { unit_of_measurement: unit }),
});

test('remaining percent warns at inclusive thresholds and preserves real zero', () => {
  for (const [value, level] of [
    [100, 'healthy'],
    [21, 'healthy'],
    [20, 'warning'],
    [5, 'critical'],
    [0, 'critical'],
  ]) {
    const status = filterStatus(states(value), base());
    assert.equal(status.level, level);
    assert.equal(status.value, value);
  }
  const config = {
    ...base(),
    filter_warning: { warning_threshold: 30, critical_threshold: 10 },
  };
  assert.equal(filterStatus(states(25), config).level, 'warning');
  assert.equal(filterStatus(states(10), config).level, 'critical');
});

test('missing, invalid and unavailable readings never turn into zero or healthy', () => {
  for (const value of [
    'unknown',
    'unavailable',
    '',
    ' ',
    'NaN',
    'bad',
    -1,
    101,
    Infinity,
  ]) {
    const status = filterStatus(states(value), base());
    assert.equal(status.level, 'unavailable', String(value));
    assert.equal(status.value, undefined);
  }
  assert.equal(
    filterStatus(
      {},
      {
        ...base(),
        filter_warning: { entity_id: remaining, mode: 'remaining_percent' },
      },
    ).level,
    'unavailable',
  );
});

test('remaining days have separate defaults and usage durations are not remaining life', () => {
  assert.equal(filterStatus(states(8, 'days'), base()).level, 'healthy');
  assert.equal(filterStatus(states(7, 'd'), base()).level, 'warning');
  assert.equal(filterStatus(states(0, 'days'), base()).level, 'critical');
  assert.equal(filterStatus(states(1, 'hours'), base()), undefined);
  for (const id of [
    'sensor.filter_age',
    'sensor.filter_use',
    'sensor.filter_used',
    'sensor.filter_usage',
  ]) {
    assert.equal(
      filterStatus(
        { [id]: state(0, { unit_of_measurement: '%' }) },
        { ...base(), stats: [{ entity_id: id }] },
      ),
      undefined,
    );
  }
  assert.equal(
    filterStatus(states(0), {
      ...base(),
      stats: [{ entity_id: remaining, value_template: '{{ value / 100 }}' }],
    }),
    undefined,
  );
});

test('native replacement state is authoritative and does not fabricate a remaining percentage', () => {
  const id = 'binary_sensor.main_replace_filter';
  const config = {
    ...base(),
    filter_warning: { entity_id: id, mode: 'replacement' },
  };
  for (const value of ['on', 'true', 1]) {
    const status = filterStatus({ ...states(90), [id]: state(value) }, config);
    assert.equal(status.level, 'critical');
    assert.equal(status.value, undefined);
  }
  assert.equal(
    filterStatus({ ...states(0), [id]: state('off') }, config).level,
    'healthy',
  );
  assert.equal(
    filterStatus({ ...states(0), [id]: state('unavailable') }, config).level,
    'unavailable',
  );
  assert.equal(
    filterStatus(
      { 'binary_sensor.door': state('on') },
      { ...base(), stats: [{ entity_id: 'binary_sensor.door' }] },
    ),
    undefined,
  );
});

test('disabled warnings, ambiguous sources and mode mismatches never choose an arbitrary sensor', () => {
  assert.equal(
    filterStatus(states(0), { ...base(), filter_warning: { enabled: false } }),
    undefined,
  );
  assert.equal(
    filterSource(states(0), {
      ...base(),
      filter_warning: { mode: 'remaining_days' },
    }),
    undefined,
  );
  const other = 'sensor.other_filter_life_remaining';
  assert.equal(
    filterSource(
      { ...states(0), [other]: state(10, { unit_of_measurement: '%' }) },
      { ...base(), stats: [{ entity_id: remaining }, { entity_id: other }] },
    ),
    undefined,
  );
  assert.ok(
    filterSource(states(0), {
      ...base(),
      stats: [{ entity_id: remaining }, { entity_id: remaining }],
    }),
  );
});

test('automatic sources use real units and configured legacy fan attributes remain supported', () => {
  assert.equal(
    filterStatus(states(6, 'days'), {
      ...base(),
      stats: [{ entity_id: remaining, unit: '%' }],
    }).source.mode,
    'remaining_days',
  );
  const config = {
    ...base(),
    stats: [{ attribute: 'filter_life_remaining', unit: '%' }],
  };
  assert.equal(
    filterStatus({ [fan]: state('on', { filter_life_remaining: 0 }) }, config)
      .level,
    'critical',
  );
  assert.deepEqual(
    filterThresholds('remaining_percent', { warning_threshold: 2 }),
    { warning: 2, critical: 2 },
  );
  assert.deepEqual(
    filterThresholds('remaining_percent', { critical_threshold: 25 }),
    { warning: 25, critical: 25 },
  );
});

test('replacement discovery requires one enabled related entity and recognizes renamed metadata', () => {
  const id = 'binary_sensor.renamed';
  const entities = {
    [fan]: state('on'),
    [id]: state('on'),
    'binary_sensor.other_replace_filter': state('on'),
  };
  const registry = [
    { entity_id: fan, device_id: 'main' },
    { entity_id: id, device_id: 'main', translation_key: 'replace_filter' },
    { entity_id: 'binary_sensor.other_replace_filter', device_id: 'other' },
  ];
  assert.deepEqual(detectFilterWarning(entities, registry, fan), {
    entity_id: id,
    mode: 'replacement',
  });
  registry[2].device_id = 'main';
  assert.equal(detectFilterWarning(entities, registry, fan), undefined);
  registry[2].disabled_by = 'user';
  assert.equal(detectFilterWarning(entities, registry, fan).entity_id, id);
  registry[1].disabled_by = 'user';
  assert.equal(detectFilterWarning(entities, registry, fan), undefined);
  assert.equal(detectFilterWarning(entities, [], fan), undefined);
});

test('independent replacement sensors are included in HA state subscriptions', () => {
  assert.ok(
    referencedEntities({
      ...base(),
      filter_warning: { entity_id: 'binary_sensor.filter' },
    }).includes('binary_sensor.filter'),
  );
});

test('renamed remaining-life readings retain their registry-verified meaning', () => {
  const id = 'sensor.renamed';
  const entities = {
    [fan]: state('on'),
    [id]: state(18, { unit_of_measurement: '%' }),
  };
  const registry = [
    { entity_id: fan, device_id: 'main' },
    {
      entity_id: id,
      device_id: 'main',
      translation_key: 'filter_life_remaining',
    },
  ];
  const warning = detectFilterWarning(entities, registry, fan, [
    { entity_id: id, unit: '%' },
  ]);
  assert.deepEqual(warning, { entity_id: id, mode: 'remaining_percent' });
  assert.equal(
    filterStatus(entities, { ...base(), stats: [], filter_warning: warning })
      .level,
    'warning',
  );
});
