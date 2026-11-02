import type { Connection, HassEntities } from 'home-assistant-js-websocket';
import get from 'lodash/get.js';
import { readingKind } from './discovery';
import type { PurifierCardStat } from './types';

export const HISTORY_WINDOW = 3600000;
export interface HistoryRow {
  s?: string;
  lu?: number;
  lc?: number;
  a?: Record<string, unknown>;
  state?: string;
  last_updated?: string;
  last_changed?: string;
  attributes?: Record<string, unknown>;
}
export type HistoryRows = Record<string, HistoryRow[]>;
export interface TrendSource {
  entity_id: string;
  attribute?: string;
}
export interface TrendPoint {
  time: number;
  value: number | null;
}
export interface TrendPath {
  line: string;
}

export function trendSource(
  states: HassEntities,
  stat: PurifierCardStat,
  fan: string,
): TrendSource | undefined {
  if (stat.value_template) return undefined;
  const kind = stat.attribute
    ? readingKind({}, { attribute: stat.attribute.split('.').pop() })
    : readingKind(states, stat);
  if (kind !== 'pm25' && kind !== 'pm10') return undefined;
  const entity_id = stat.entity_id ?? fan;
  if (!stat.attribute && !entity_id.startsWith('sensor.')) return undefined;
  return {
    entity_id,
    ...(stat.attribute ? { attribute: stat.attribute } : {}),
  };
}

export function rowTime(row: HistoryRow) {
  const number = row.lu ?? row.lc;
  if (typeof number === 'number' && Number.isFinite(number))
    return number * 1000;
  return Date.parse(row.last_updated ?? row.last_changed ?? '');
}

export function historyPoints(
  rows: HistoryRow[],
  source: TrendSource,
): TrendPoint[] {
  return rows
    .map((row) => {
      const state = row.s ?? row.state;
      const raw = source.attribute
        ? get(row.a ?? row.attributes, source.attribute)
        : state;
      const valid =
        !['unknown', 'unavailable'].includes(String(state)) &&
        ['string', 'number'].includes(typeof raw) &&
        String(raw).trim() !== '' &&
        Number.isFinite(Number(raw)) &&
        Number(raw) >= 0;
      return { time: rowTime(row), value: valid ? Number(raw) : null };
    })
    .filter((point) => Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time);
}

/** A fixed hour, zero baseline, and step paths: never interpolate across missing states. */
export function trendPaths(points: TrendPoint[], now: number): TrendPath[] {
  const start = now - HISTORY_WINDOW;
  const sorted = points
    .filter((point) => point.time <= now)
    .sort((a, b) => a.time - b.time);
  const before = sorted.filter((point) => point.time <= start).slice(-1)[0];
  const window = sorted.filter((point) => point.time > start);
  if (before) window.unshift({ ...before, time: start });
  if (!window.length) return [];
  const values = window.flatMap((point) =>
    point.value === null ? [] : [point.value],
  );
  // A constant hour carries no direction information and looks like a divider.
  if (!values.length || values.every((value) => value === values[0])) return [];
  const max = Math.max(1, ...window.map((point) => point.value ?? 0));
  const x = (time: number) =>
    Math.max(0, Math.min(120, ((time - start) / HISTORY_WINDOW) * 120));
  const y = (value: number) => 34 - (value / max) * 30;
  const coord = (value: number) => Number(value.toFixed(2));
  const paths: TrendPath[] = [];
  let run: TrendPoint[] = [];
  const close = (end: number) => {
    if (!run.length) return;
    if (end > run[run.length - 1].time)
      run.push({ time: end, value: run[run.length - 1].value });
    if (run.length > 1 && run[0].time < run[run.length - 1].time) {
      // Preserve first/last and both extremes per horizontal pixel bucket.
      const buckets = new Map<number, TrendPoint[]>();
      for (const point of run) {
        const key = Math.floor(x(point.time));
        const bucket = buckets.get(key) ?? [];
        bucket.push(point);
        buckets.set(key, bucket);
      }
      const reduced = [...buckets.values()].flatMap((bucket) => {
        const min = bucket.reduce((a, b) => (a.value! < b.value! ? a : b));
        const max = bucket.reduce((a, b) => (a.value! > b.value! ? a : b));
        return [
          ...new Set([bucket[0], min, max, bucket[bucket.length - 1]]),
        ].sort((a, b) => a.time - b.time);
      });
      let line = `M${coord(x(reduced[0].time))},${coord(y(reduced[0].value!))}`;
      for (const point of reduced.slice(1))
        line += `H${coord(x(point.time))}V${coord(y(point.value!))}`;
      paths.push({ line });
    }
    run = [];
  };
  for (const point of window) {
    if (point.value === null) close(point.time);
    else run.push(point);
  }
  close(now);
  return paths;
}

interface HistoryMessage {
  states?: HistoryRows;
}
interface SharedHistory {
  rows: HistoryRows;
  listeners: Set<(rows: HistoryRows) => void>;
  unsubscribe?: Awaited<ReturnType<Connection['subscribeMessage']>>;
  closed: boolean;
  ackTimeout?: ReturnType<typeof setTimeout>;
}
const streams = new WeakMap<Connection, Map<string, SharedHistory>>();
function release(unsubscribe?: SharedHistory['unsubscribe']) {
  try {
    void Promise.resolve(unsubscribe?.()).catch(() => {});
  } catch {
    /* Connection may already be closed. */
  }
}

/** One shared live subscription per connection/source set, released with its last visible card. */
export function watchHistory(
  connection: Connection,
  sources: TrendSource[],
  listener: (rows: HistoryRows) => void,
): () => void {
  const ids = [...new Set(sources.map((source) => source.entity_id))].sort();
  const attributes = sources.some((source) => !!source.attribute);
  const key = JSON.stringify([ids, attributes]);
  let collection = streams.get(connection);
  if (!collection) {
    collection = new Map();
    streams.set(connection, collection);
  }
  let entry = collection.get(key);
  if (!entry) {
    entry = { rows: {}, listeners: new Set(), closed: false };
    collection.set(key, entry);
    const current = entry;
    const onData = (message: HistoryMessage) => {
      if (
        current.closed ||
        !message?.states ||
        typeof message.states !== 'object'
      )
        return;
      const rows = { ...current.rows };
      for (const id of ids) {
        const incoming = message.states[id];
        if (!Array.isArray(incoming)) continue;
        const combined = new Map<number, HistoryRow>();
        for (const row of [...(rows[id] ?? []), ...incoming]) {
          if (!row || typeof row !== 'object') continue;
          const time = rowTime(row);
          if (Number.isFinite(time)) combined.set(time, row);
        }
        const sorted = [...combined].sort((a, b) => a[0] - b[0]);
        const start = Date.now() - HISTORY_WINDOW;
        const anchor = sorted.filter(([time]) => time <= start).slice(-1)[0];
        rows[id] = [
          ...(anchor ? [anchor] : []),
          ...sorted.filter(([time]) => time > start),
        ]
          .slice(-7200)
          .map(([, row]) => row);
      }
      current.rows = rows;
      for (const callback of current.listeners) callback(rows);
    };
    const fail = () => {
      if (current.closed) return;
      current.closed = true;
      release(current.unsubscribe);
      if (collection!.get(key) === current) collection!.delete(key);
      for (const callback of current.listeners) callback({});
    };
    current.ackTimeout = setTimeout(fail, 10000);
    try {
      void connection
        .subscribeMessage<HistoryMessage>(
          onData,
          {
            type: 'history/stream',
            start_time: new Date(Date.now() - HISTORY_WINDOW).toISOString(),
            entity_ids: ids,
            include_start_time_state: true,
            minimal_response: !attributes,
            significant_changes_only: !attributes,
            no_attributes: !attributes,
          },
          { resubscribe: false },
        )
        .then(
          (unsubscribe) => {
            clearTimeout(current.ackTimeout);
            if (current.closed) release(unsubscribe);
            else current.unsubscribe = unsubscribe;
          },
          () => {
            clearTimeout(current.ackTimeout);
            fail();
          },
        );
    } catch {
      clearTimeout(current.ackTimeout);
      fail();
    }
  }
  const shared = entry;
  shared.listeners.add(listener);
  listener(shared.rows);
  return () => {
    shared.listeners.delete(listener);
    if (!shared.listeners.size) {
      shared.closed = true;
      clearTimeout(shared.ackTimeout);
      release(shared.unsubscribe);
      if (collection!.get(key) === shared) collection!.delete(key);
    }
  };
}
