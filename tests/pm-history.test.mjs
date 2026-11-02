import './helpers/typescript.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { trendSource, historyPoints, trendPaths, watchHistory, HISTORY_WINDOW } =
  await import('../src/pm-history.ts');
const now = 1800000000000;

test('only PM measurements and known PM attributes qualify; converted templates and targets do not', () => {
  const states = {
    'sensor.particles': { state: '5', attributes: { device_class: 'pm25' } },
    'sensor.temperature': {
      state: '22',
      attributes: { device_class: 'temperature' },
    },
  };
  assert.deepEqual(
    trendSource(states, { entity_id: 'sensor.particles' }, 'fan.main'),
    { entity_id: 'sensor.particles' },
  );
  assert.deepEqual(
    trendSource(states, { attribute: 'readings.pm10' }, 'fan.main'),
    { entity_id: 'fan.main', attribute: 'readings.pm10' },
  );
  assert.equal(
    trendSource(
      states,
      { entity_id: 'sensor.particles', value_template: '{{ value * 2 }}' },
      'fan.main',
    ),
    undefined,
  );
  assert.equal(
    trendSource(states, { entity_id: 'sensor.temperature' }, 'fan.main'),
    undefined,
  );
  assert.equal(
    trendSource({}, { entity_id: 'number.target_pm25' }, 'fan.main'),
    undefined,
  );
});

test('compressed/full history keeps zero and turns unknown, negative and blank values into gaps', () => {
  const points = historyPoints(
    [
      { s: '0', lu: now / 1000 },
      { s: 'unknown', lu: now / 1000 + 1 },
      { state: '4', last_updated: new Date(now + 2000).toISOString() },
      { s: '-1', lu: now / 1000 + 3 },
      { s: '', lu: now / 1000 + 4 },
      { s: 'NaN', lu: now / 1000 + 5 },
      { s: ' ', lu: now / 1000 + 6 },
      { s: 'on', lu: NaN },
    ],
    { entity_id: 'sensor.pm25' },
  );
  assert.deepEqual(
    points.map((point) => point.value),
    [0, null, 4, null, null, null, null],
  );
});

test('attribute history reads nested data but respects an unavailable owner entity', () => {
  const points = historyPoints(
    [
      { s: 'on', lu: 1, a: { readings: { pm25: 5 } } },
      { s: 'unavailable', lu: 2, a: { readings: { pm25: 0 } } },
    ],
    { entity_id: 'fan.main', attribute: 'readings.pm25' },
  );
  assert.deepEqual(
    points.map((point) => point.value),
    [5, null],
  );
});

test('graph domain is exactly one hour, zero-based, and clips earlier data without filling an unknown past', () => {
  const start = now - HISTORY_WINDOW;
  const paths = trendPaths(
    [
      { time: start - 10000, value: 10 },
      { time: now - 1800000, value: 5 },
    ],
    now,
  );
  assert.equal(paths.length, 1);
  assert.match(paths[0].line, /^M0,4H60V19/);
  const partial = trendPaths(
    [
      { time: now - 1800000, value: 5 },
      { time: now - 900000, value: 10 },
    ],
    now,
  );
  assert.match(partial[0].line, /^M60,/);
  assert.deepEqual(trendPaths([], now), []);
  assert.deepEqual(trendPaths([{ time: now + 1000, value: 10 }], now), []);
});

test('unavailability splits filled paths and zero draws a real baseline', () => {
  const paths = trendPaths(
    [
      { time: now - HISTORY_WINDOW, value: 5 },
      { time: now - 2700000, value: null },
      { time: now - 900000, value: 0 },
    ],
    now,
  );
  assert.equal(paths.length, 2);
  assert.match(paths[0].line, /H30V4$/);
  assert.match(paths[1].line, /^M90,34/);
  assert.equal(
    trendPaths([{ time: now - HISTORY_WINDOW, value: null }], now).length,
    0,
  );
});

test('dense sampling preserves peaks while bounding the rendered path length', () => {
  const points = Array.from({ length: 7200 }, (_, i) => ({
    time: now - HISTORY_WINDOW + i * 500,
    value: i === 3651 ? 100 : 1,
  }));
  const paths = trendPaths(points, now);
  assert.match(paths[0].line, /V4/);
  assert.ok(paths[0].line.length < 15000);
});

test('duplicate cards share one subscription and closing the last one releases it', async () => {
  const calls = [];
  let receive;
  let stops = 0;
  const connection = {
    subscribeMessage: async (callback, message) => {
      receive = callback;
      calls.push(message);
      return () => stops++;
    },
  };
  const a = [],
    b = [];
  const source = [{ entity_id: 'sensor.pm25' }, { entity_id: 'sensor.pm10' }];
  const stopA = watchHistory(connection, source, (rows) => a.push(rows));
  const stopB = watchHistory(connection, [...source].reverse(), (rows) =>
    b.push(rows),
  );
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'history/stream');
  assert.equal(calls[0].no_attributes, true);
  receive({ states: { 'sensor.pm25': [{ s: '4', lu: Date.now() / 1000 }] } });
  assert.equal(a.at(-1)['sensor.pm25'][0].s, '4');
  assert.equal(b.at(-1)['sensor.pm25'][0].s, '4');
  stopA();
  assert.equal(stops, 0);
  stopB();
  assert.equal(stops, 1);
});

test('attribute requests retain attributes and an unsubscribe before acknowledgement is cleaned up later', async () => {
  let resolve;
  let stops = 0;
  let message;
  const connection = {
    subscribeMessage: (_, request) => {
      message = request;
      return new Promise((done) => (resolve = done));
    },
  };
  const stop = watchHistory(
    connection,
    [{ entity_id: 'fan.main', attribute: 'pm25' }],
    () => {},
  );
  assert.equal(message.no_attributes, false);
  assert.equal(message.minimal_response, false);
  assert.equal(message.significant_changes_only, false);
  stop();
  resolve(() => stops++);
  await Promise.resolve();
  assert.equal(stops, 1);
});

test('overlapping messages deduplicate timestamps, preserve gaps and ignore other entities', async () => {
  let receive;
  const connection = {
    subscribeMessage: async (callback) => {
      receive = callback;
      return () => {};
    },
  };
  let result;
  const stop = watchHistory(
    connection,
    [{ entity_id: 'sensor.pm25' }],
    (rows) => (result = rows),
  );
  const t = Date.now() / 1000;
  receive({
    states: {
      'sensor.pm25': [
        { s: '5', lu: t - 30 },
        { s: 'unknown', lu: t - 20 },
      ],
      'sensor.other': [{ s: '100', lu: t }],
    },
  });
  receive({
    states: {
      'sensor.pm25': [
        { s: '5', lu: t - 30 },
        { s: '0', lu: t },
      ],
    },
  });
  assert.deepEqual(
    result['sensor.pm25'].map((row) => row.s),
    ['5', 'unknown', '0'],
  );
  assert.equal(result['sensor.other'], undefined);
  stop();
  await Promise.resolve();
});

test('permission failures quietly return no history and never start a retry loop', async () => {
  let calls = 0;
  let result;
  const connection = {
    subscribeMessage: async () => {
      calls++;
      throw new Error('not authorized');
    },
  };
  const stop = watchHistory(
    connection,
    [{ entity_id: 'sensor.pm25' }],
    (rows) => (result = rows),
  );
  await Promise.resolve();
  assert.deepEqual(result, {});
  assert.equal(calls, 1);
  stop();
});

test('flat hours stay plain, including zero and when an old spike leaves the window', () => {
  for (const value of [0, 1, 100]) {
    assert.deepEqual(
      trendPaths(
        [
          { time: now - HISTORY_WINDOW, value },
          { time: now - 1000, value },
        ],
        now,
      ),
      [],
    );
  }
  const points = [
    { time: now - HISTORY_WINDOW - 1000, value: 20 },
    { time: now - HISTORY_WINDOW + 1000, value: 1 },
  ];
  assert.ok(trendPaths(points, now).length);
  assert.deepEqual(trendPaths(points, now + 2000), []);
});
