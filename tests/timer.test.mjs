import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shutdownState, parseDuration, formatCountdown } from '../src/timer.ts';
import { referencedEntities } from '../src/model.ts';
const config = {
  entity_id: 'timer.shutdown',
  automation_entity_id: 'automation.shutdown',
  deadline_entity_id: 'input_text.deadline',
};
const states = () => ({
  'timer.shutdown': { state: 'idle', attributes: {} },
  'automation.shutdown': { state: 'on', attributes: {} },
  'input_text.deadline': { state: '', attributes: {} },
});

test('shutdown needs live helpers and enabled automation; idle adds no countdown', () => {
  const data = states();
  assert.equal(shutdownState(data, config).ready, true);
  assert.equal(shutdownState(data, config).visible, false);
  data['automation.shutdown'].state = 'off';
  assert.equal(shutdownState(data, config).ready, false);
  data['input_text.deadline'].state = 'unavailable';
  assert.equal(shutdownState(data, config).deadlineAvailable, false);
});
test('a persisted deadline survives an idle restored timer and never fabricates completion', () => {
  const data = states();
  data['input_text.deadline'].state = '1800000060';
  assert.equal(shutdownState(data, config, 1800000000000).seconds, 60);
  assert.equal(shutdownState(data, config, 1800000120000).waiting, true);
  assert.equal(shutdownState(data, config, 1800000120000).seconds, 0);
});
test('paused timers use reported remaining time and invalid durations stay unknown', () => {
  const data = states();
  data['timer.shutdown'] = {
    state: 'paused',
    attributes: { remaining: '01:12:03' },
  };
  assert.equal(shutdownState(data, config).seconds, 4323);
  for (const value of ['', 'unknown', '01:99:00', null])
    assert.equal(parseDuration(value), undefined);
  assert.equal(formatCountdown(60), '1:00');
  assert.equal(formatCountdown(3601), '1:00:01');
  assert.equal(formatCountdown(undefined), '—');
});
test('all shutdown entities participate in independent HA state updates', () => {
  const ids = referencedEntities({
    entity: 'fan.main',
    aqi: {},
    stats: [],
    shortcuts: [],
    shutdown_timer: config,
  });
  assert.ok(Object.values(config).every((id) => ids.includes(id)));
});

test('a new unknown Text helper is writable without inventing an armed deadline', () => {
  const data = states();
  data['input_text.deadline'].state = 'unknown';
  const status = shutdownState(data, config);
  assert.equal(status.ready, true);
  assert.equal(status.armed, false);
  assert.equal(status.visible, false);
});
