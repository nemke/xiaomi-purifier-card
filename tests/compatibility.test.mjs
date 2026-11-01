import './helpers/typescript.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixtures from './fixtures/purifiers.json' with { type: 'json' };
const { detectReadings, fanSpeedSource } = await import('../src/discovery.ts');
const { detectControls } = await import('../src/controls.ts');
const { detectFilterWarning, filterStatus } = await import('../src/filter.ts');
const { shortcutActive, prepareActions } = await import('../src/model.ts');
const { commandGoals, goalConfirmed } = await import('../src/command.ts');
const { buildToolbar } = await import('../src/toolbar.ts');
const labels = {
  pm25: 'PM 2.5',
  pm10: 'PM 10',
  temperature: 'Temperature',
  humidity: 'Humidity',
  filter: 'Filter remaining',
};

for (const [key, fixture] of Object.entries(fixtures)) {
  test(`${key}: discovers only related supported readings and uses reported preset names`, () => {
    const { states, registry, fan } = structuredClone(fixture);
    const detected = detectReadings(states, registry, fan, labels);
    assert.deepEqual(detected.main, { attribute: 'percentage', unit: '%' });
    assert.equal(
      detected.stats.filter((stat) => stat.subtitle === 'PM 2.5').length,
      1,
    );
    assert.ok(
      detected.stats.every((stat) => !stat.entity_id?.includes('other_room')),
    );
    assert.ok(
      !detected.stats.some((stat) =>
        /target|filter_age|current_cadr/.test(stat.entity_id),
      ),
    );
    const config = { entity: fan, shortcuts: [] };
    assert.deepEqual(
      buildToolbar(config, states[fan].attributes.preset_modes).map(
        (item) => item.preset_mode,
      ),
      states[fan].attributes.preset_modes,
    );
    assert.deepEqual(detectControls(states, registry, fan).speed_controls, []);
  });
}

test('VeSync renamed filter and optional night light are discovered separately from display', () => {
  const { states, registry, fan } = structuredClone(fixtures.vesync);
  const detected = detectReadings(states, registry, fan, labels);
  const warning = detectFilterWarning(states, registry, fan, detected.stats);
  assert.equal(warning.entity_id, 'sensor.levoit_renamed_filter');
  assert.equal(
    filterStatus(states, {
      entity: fan,
      stats: detected.stats,
      filter_warning: warning,
    }).level,
    'warning',
  );
  const controls = detectControls(states, registry, fan);
  assert.deepEqual(
    controls.device_controls.map((item) => item.entity_id),
    [
      'switch.levoit_child_lock',
      'switch.levoit_display',
      'select.levoit_night_light_level',
    ],
  );
  const duplicate = 'select.renamed_night_light';
  states[duplicate] = {
    state: 'off',
    attributes: { options: ['off', 'dim', 'on'] },
  };
  registry.push({
    entity_id: duplicate,
    device_id: 'vesync',
    translation_key: 'night_light_level',
  });
  assert.ok(
    !detectControls(states, registry, fan).device_controls.some((item) =>
      item.entity_id.includes('night_light'),
    ),
  );
});

test('STARKVIND speed levels and filter age do not become RPM or remaining life', () => {
  const { states, registry, fan } = fixtures.starkvind;
  const detected = detectReadings(states, registry, fan, labels);
  assert.ok(!detected.main.entity_id);
  assert.equal(detected.stats.length, 1);
  const warning = detectFilterWarning(states, registry, fan, detected.stats);
  assert.deepEqual(warning, {
    entity_id: 'binary_sensor.starkvind_replace_filter',
    mode: 'replacement',
  });
  const status = filterStatus(states, {
    entity: fan,
    stats: detected.stats,
    filter_warning: warning,
  });
  assert.equal(status.level, 'critical');
  assert.equal(status.value, undefined);
});

test('ESPHome custom filter meaning remains explicit and a writable RPM target is never measured speed', () => {
  const { states, registry, fan, manual_config } = fixtures.esphome;
  const detected = detectReadings(states, registry, fan, labels);
  assert.ok(
    !detected.stats.some(
      (stat) => stat.entity_id === 'sensor.levoit_vital100s_filter',
    ),
  );
  assert.equal(
    detectFilterWarning(states, registry, fan, detected.stats),
    undefined,
  );
  assert.equal(
    filterStatus(states, { entity: fan, ...manual_config }).level,
    'healthy',
  );
  assert.deepEqual(detected.main, { attribute: 'percentage', unit: '%' });
});

test('unknown percentages remain unavailable and never activate a zero-percent shortcut', () => {
  const fixture = structuredClone(fixtures.vesync);
  const { states, fan } = fixture;
  assert.deepEqual(fanSpeedSource(states, fan), {
    attribute: 'percentage',
    unit: '%',
  });
  assert.equal(shortcutActive({ percentage: 0 }, states, fan), false);
  delete states[fan].attributes.percentage;
  assert.equal(fanSpeedSource(states, fan), undefined);
});

test('blank percentages cannot send accidental turn-off commands and zero is confirmed by power state', () => {
  const { states, fan } = structuredClone(fixtures.vesync);
  for (const percentage of ['', null, undefined, ' ', false, true, [], {}]) {
    assert.throws(
      () =>
        prepareActions(
          [{ service: 'fan.set_percentage', service_data: { percentage } }],
          states,
          fan,
        ),
      /percentage/,
    );
  }
  const action = prepareActions(
    [{ service: 'fan.set_percentage', service_data: { percentage: 0 } }],
    states,
    fan,
  );
  const goals = commandGoals(action);
  assert.deepEqual(goals, [
    { entity_id: fan, attribute: undefined, value: 'off' },
  ]);
  assert.equal(goalConfirmed(goals[0], states), false);
  states[fan].state = 'off';
  assert.equal(goalConfirmed(goals[0], states), true);
});
