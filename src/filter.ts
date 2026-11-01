import type { HassEntities } from 'home-assistant-js-websocket';
import type {
  PurifierCardConfig,
  PurifierFilterWarning,
  PurifierCardStat,
} from './types';
import { readingKind, type RegistryEntity } from './discovery';
import { readValue } from './model';

const replacementAliases = [
  'replacefilter',
  'filterreplacement',
  'filterreplacementneeded',
  'filterreplaceneeded',
  'filterchange',
  'filterchangerequired',
];
const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');
const replacementName = (id: string) =>
  replacementAliases.some((name) =>
    normalize(id.split('.').pop() ?? '').endsWith(name),
  );

export type FilterMode = 'remaining_percent' | 'remaining_days' | 'replacement';
export interface FilterSource {
  entity_id?: string;
  attribute?: string;
  mode: FilterMode;
}
export interface FilterStatus {
  source: FilterSource;
  level: 'healthy' | 'warning' | 'critical' | 'unavailable';
  value?: number;
}

export function inferFilterMode(
  states: HassEntities,
  source: { entity_id?: string; attribute?: string; unit?: string },
): FilterMode | undefined {
  if (
    source.entity_id?.startsWith('binary_sensor.') &&
    !source.attribute &&
    replacementName(source.entity_id)
  )
    return 'replacement';
  if (readingKind(states, source) !== 'filter') return undefined;
  const unit = String(
    states[source.entity_id ?? '']?.attributes.unit_of_measurement ??
      source.unit ??
      '',
  ).toLowerCase();
  if (unit === '%') return 'remaining_percent';
  if (['d', 'day', 'days'].includes(unit)) return 'remaining_days';
  return undefined;
}

/** Never infer remaining life from usage/age, a template, or a guessed lifetime. */
export function filterSource(
  states: HassEntities,
  config: Pick<PurifierCardConfig, 'stats' | 'filter_warning'>,
): FilterSource | undefined {
  const warning = config.filter_warning;
  if (warning?.enabled === false) return undefined;
  if (warning?.entity_id || warning?.attribute) {
    const mode =
      warning.mode ??
      (warning.entity_id?.startsWith('binary_sensor.') && !warning.attribute
        ? 'replacement'
        : inferFilterMode(states, warning));
    return mode
      ? { entity_id: warning.entity_id, attribute: warning.attribute, mode }
      : undefined;
  }
  const sources = config.stats
    .filter((stat) => !stat.value_template)
    .map((stat): FilterSource | undefined => {
      const mode = inferFilterMode(states, stat);
      return mode
        ? { entity_id: stat.entity_id, attribute: stat.attribute, mode }
        : undefined;
    })
    .filter(
      (source): source is FilterSource =>
        !!source && (!warning?.mode || source.mode === warning.mode),
    );
  // Prefer one remaining percentage to one remaining duration; ties stay manual.
  for (const mode of [
    'replacement',
    'remaining_percent',
    'remaining_days',
  ] as const) {
    const matching = sources.filter((source) => source.mode === mode);
    const unique = matching.filter(
      (source, index) =>
        matching.findIndex(
          (item) =>
            item.entity_id === source.entity_id &&
            item.attribute === source.attribute,
        ) === index,
    );
    if (unique.length) return unique.length === 1 ? unique[0] : undefined;
  }
  return undefined;
}

export function filterThresholds(
  mode: FilterMode,
  config?: PurifierFilterWarning,
) {
  const critical =
    config?.critical_threshold ?? (mode === 'remaining_days' ? 0 : 5);
  const warning =
    config?.warning_threshold ??
    Math.max(mode === 'remaining_days' ? 7 : 20, critical);
  return {
    warning,
    critical: config?.critical_threshold ?? Math.min(critical, warning),
  };
}

export function filterStatus(
  states: HassEntities,
  config: Pick<PurifierCardConfig, 'entity' | 'stats' | 'filter_warning'>,
): FilterStatus | undefined {
  const source = filterSource(states, config);
  if (!source) return undefined;
  const raw = readValue(states, source, config.entity);
  const unknown: FilterStatus = { source, level: 'unavailable' };
  if (
    raw === undefined ||
    raw === null ||
    raw === '' ||
    (typeof raw === 'string' && !raw.trim())
  )
    return unknown;
  if (source.mode === 'replacement') {
    if (['on', 'true', '1'].includes(String(raw).toLowerCase()))
      return { source, level: 'critical' };
    if (['off', 'false', '0'].includes(String(raw).toLowerCase()))
      return { source, level: 'healthy' };
    return unknown;
  }
  if (!['number', 'string'].includes(typeof raw)) return unknown;
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (source.mode === 'remaining_percent' && value > 100)
  )
    return unknown;
  const thresholds = filterThresholds(source.mode, config.filter_warning);
  return {
    source,
    value,
    level:
      value <= thresholds.critical
        ? 'critical'
        : value <= thresholds.warning
          ? 'warning'
          : 'healthy',
  };
}

/** Native replacement flags are linked through HA's device registry, never name similarity alone. */
export function detectFilterWarning(
  states: HassEntities,
  registry: RegistryEntity[],
  fan: string,
  detectedStats: PurifierCardStat[] = [],
): PurifierFilterWarning | undefined {
  const device = registry.find((entry) => entry.entity_id === fan)?.device_id;
  if (!device) return undefined;
  const candidates = registry.filter(
    (entry) =>
      entry.device_id === device &&
      !entry.disabled_by &&
      states[entry.entity_id] &&
      entry.entity_id.startsWith('binary_sensor.') &&
      ([entry.translation_key, entry.original_name].some(
        (value) => value && replacementAliases.includes(normalize(value)),
      ) ||
        replacementName(entry.entity_id)),
  );
  if (candidates.length)
    return candidates.length === 1
      ? { entity_id: candidates[0].entity_id, mode: 'replacement' }
      : undefined;
  // Persist the verified meaning for renamed remaining-life sensors, whose
  // registry metadata is available in the editor but not needed by the card.
  for (const mode of ['remaining_percent', 'remaining_days'] as const) {
    const matching = detectedStats.filter((stat) => {
      if (
        stat.value_template ||
        readingKind(states, stat, registry) !== 'filter'
      )
        return false;
      const unit = String(
        states[stat.entity_id ?? '']?.attributes.unit_of_measurement ??
          stat.unit ??
          '',
      ).toLowerCase();
      return mode === 'remaining_percent'
        ? unit === '%'
        : ['d', 'day', 'days'].includes(unit);
    });
    if (matching.length) {
      const source = matching[0];
      return matching.length === 1
        ? {
            ...(source.entity_id ? { entity_id: source.entity_id } : {}),
            ...(source.attribute ? { attribute: source.attribute } : {}),
            mode,
          }
        : undefined;
    }
  }
  return undefined;
}
