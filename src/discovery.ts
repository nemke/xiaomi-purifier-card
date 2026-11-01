import type { HassEntities } from 'home-assistant-js-websocket';
import type {
  PurifierAQI,
  PurifierCardConfig,
  PurifierCardStat,
} from './types';

export interface RegistryEntity {
  entity_id: string;
  device_id?: string | null;
  disabled_by?: string | null;
  original_device_class?: string | null;
  device_class?: string | null;
  translation_key?: string;
  original_name?: string;
}
export type ReadingKind =
  'pm25' | 'pm10' | 'temperature' | 'humidity' | 'filter';
export interface DetectedReadings {
  main?: PurifierAQI;
  stats: PurifierCardStat[];
  deviceLinked: boolean;
}
const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');
const statisticIcons: Partial<Record<ReadingKind | 'rpm', string>> = {
  temperature: 'mdi:thermometer',
  humidity: 'mdi:water-percent',
  filter: 'mdi:air-filter',
  rpm: 'mdi:fan',
};
const aliases: Record<ReadingKind | 'rpm', string[]> = {
  pm25: ['pm25', 'pm2p5', 'particulatematter25'],
  pm10: ['pm10', 'particulatematter10'],
  temperature: ['temperature', 'ambienttemperature'],
  humidity: ['humidity', 'relativehumidity'],
  filter: [
    'filterlife',
    'filterliferemaining',
    'filterlifetimeremaining',
    'filterremaining',
    'filterleft',
  ],
  rpm: ['motorspeed', 'fanspeed', 'rpm', 'motorspeedrpm'],
};

export function readingKind(
  states: HassEntities,
  source: PurifierAQI,
  registry: RegistryEntity[] = [],
): ReadingKind | 'rpm' | undefined {
  const entity = states[source.entity_id ?? ''];
  const entry = registry.find((item) => item.entity_id === source.entity_id);
  const deviceClass =
    entity?.attributes.device_class ??
    entry?.device_class ??
    entry?.original_device_class;
  if (
    typeof deviceClass === 'string' &&
    ['pm25', 'pm10', 'temperature', 'humidity'].includes(deviceClass)
  )
    return deviceClass as ReadingKind;
  const clues = [
    source.attribute,
    entry?.translation_key,
    entry?.original_name,
  ];
  for (const [kind, names] of Object.entries(aliases)) {
    if (
      deviceClass === kind ||
      clues.some((clue) => clue && names.includes(normalize(clue)))
    )
      return kind as ReadingKind | 'rpm';
    if (
      source.entity_id &&
      names.some((name) =>
        normalize(source.entity_id!.split('.').pop()!).endsWith(name),
      )
    )
      return kind as ReadingKind | 'rpm';
  }
  if (
    String(entity?.attributes.unit_of_measurement ?? '').toLowerCase() === 'rpm'
  )
    return 'rpm';
  return undefined;
}

export function fanSpeedSource(
  states: HassEntities,
  fan: string,
): PurifierAQI | undefined {
  const attributes = states[fan]?.attributes;
  for (const attribute of ['motor_speed', 'motor_speed_rpm']) {
    if (typeof attributes?.[attribute] === 'number')
      return { attribute, unit: 'RPM' };
  }
  // Integrations such as VeSync/MQTT can expose an unknown percentage in Auto.
  // Keep its unit and show an unavailable reading, rather than an empty pill.
  if (
    typeof attributes?.percentage === 'number' ||
    attributes?.percentage === null
  )
    return { attribute: 'percentage', unit: '%' };
  return undefined;
}

/** PM labels stay distinct; measurements without a known icon keep their text. */
export function statisticIcon(
  states: HassEntities,
  stat: PurifierCardStat,
): string | undefined {
  if (typeof stat.icon === 'string') return stat.icon;
  const kind = readingKind(states, stat);
  return kind ? statisticIcons[kind] : undefined;
}

export function detectReadings(
  states: HassEntities,
  registry: RegistryEntity[],
  fan: string,
  labels: Record<ReadingKind, string>,
): DetectedReadings {
  const device = registry.find((item) => item.entity_id === fan)?.device_id;
  const candidates = registry.filter(
    (item) =>
      device &&
      item.device_id === device &&
      !item.disabled_by &&
      item.entity_id.startsWith('sensor.') &&
      states[item.entity_id],
  );
  const pick = (kind: ReadingKind | 'rpm') => {
    const matching = candidates
      .filter(
        (item) =>
          readingKind(states, { entity_id: item.entity_id }, registry) === kind,
      )
      .filter(
        (item) =>
          !/target|favorite|setpoint/i.test(
            `${item.translation_key ?? ''} ${item.original_name ?? ''} ${item.entity_id}`,
          ),
      );
    // A generic fan_speed sensor may be a level, not RPM. Units are authoritative.
    if (kind === 'rpm')
      for (let i = matching.length - 1; i >= 0; i--)
        if (
          String(
            states[matching[i].entity_id].attributes.unit_of_measurement ?? '',
          ).toLowerCase() !== 'rpm'
        )
          matching.splice(i, 1);
    const ranked = matching
      .map((item) => ({
        item,
        score:
          (kind === 'filter' &&
          states[item.entity_id].attributes.unit_of_measurement === '%'
            ? 20
            : 0) +
          (states[item.entity_id].attributes.device_class === kind ? 100 : 0) +
          (aliases[kind].includes(normalize(item.translation_key ?? ''))
            ? 40
            : 0) -
          (/average|mean|median|max|min(imum)?\b/i.test(
            `${item.translation_key ?? ''} ${item.original_name ?? ''}`,
          )
            ? 50
            : 0),
      }))
      .sort((a, b) => b.score - a.score);
    // Do not silently choose between equally plausible sensors.
    return ranked.length === 1 || ranked[0]?.score > ranked[1]?.score
      ? ranked[0]?.item
      : undefined;
  };
  const rpm = pick('rpm');
  const main = rpm
    ? {
        entity_id: rpm.entity_id,
        unit: states[rpm.entity_id].attributes.unit_of_measurement ?? 'RPM',
      }
    : fanSpeedSource(states, fan);
  const stats: PurifierCardStat[] = [];
  const legacyAttributes: Record<ReadingKind, string[]> = {
    pm25: ['pm2_5', 'pm25', 'pm2_5_density'],
    pm10: ['pm10', 'pm10_density'],
    temperature: ['temperature'],
    humidity: ['humidity'],
    filter: ['filter_life_remaining', 'filter_life', 'filter_left'],
  };
  for (const kind of [
    'pm25',
    'pm10',
    'temperature',
    'humidity',
    'filter',
  ] as const) {
    const sensor = pick(kind);
    if (sensor)
      stats.push({
        entity_id: sensor.entity_id,
        ...(statisticIcons[kind] ? { icon: statisticIcons[kind] } : {}),
        subtitle: labels[kind],
        unit: states[sensor.entity_id].attributes.unit_of_measurement,
      });
    else {
      const attributes = states[fan]?.attributes;
      const attribute = legacyAttributes[kind].find(
        (key) => typeof attributes?.[key] === 'number',
      );
      if (attribute)
        stats.push({
          attribute,
          ...(statisticIcons[kind] ? { icon: statisticIcons[kind] } : {}),
          subtitle: labels[kind],
          unit:
            attributes?.[`${attribute}_unit`] ??
            (kind === 'humidity' ||
            attribute === 'filter_life_remaining' ||
            attribute === 'filter_life'
              ? '%'
              : kind === 'pm25' || kind === 'pm10'
                ? 'μg/m³'
                : undefined),
        });
    }
  }
  return { main, stats, deviceLinked: !!device };
}

/** Fill missing sources without replacing a configured source, label, or unit. */
export function mergeReadings(
  config: Partial<PurifierCardConfig>,
  detected: DetectedReadings,
  states: HassEntities,
  registry: RegistryEntity[],
  append: boolean,
  protectedSections: ReadonlySet<string>,
): Partial<PurifierCardConfig> {
  const next = { ...config };
  if (
    !protectedSections.has('aqi') &&
    !config.aqi?.entity_id &&
    !config.aqi?.attribute &&
    detected.main
  ) {
    const overrides = { ...config.aqi };
    delete overrides.entity_id;
    delete overrides.attribute;
    next.aqi = { ...detected.main, ...overrides };
  }
  const stats = [...(config.stats ?? [])];
  const blank = (stat: PurifierCardStat) =>
    !stat.entity_id &&
    !stat.attribute &&
    !stat.subtitle &&
    !stat.unit &&
    stat.icon === undefined &&
    !stat.value_template;
  if (
    !protectedSections.has('stats') &&
    (append ||
      config.stats === undefined ||
      (stats.length > 0 && stats.every(blank)))
  ) {
    const represented = new Set(
      stats.map((stat) => readingKind(states, stat, registry)),
    );
    for (const suggestion of detected.stats) {
      const kind = readingKind(states, suggestion, registry);
      if (
        stats.some(
          (stat) =>
            (stat.entity_id ?? config.entity) ===
              (suggestion.entity_id ?? config.entity) &&
            stat.attribute === suggestion.attribute,
        ) ||
        (kind && represented.has(kind))
      )
        continue;
      const empty = stats.findIndex(blank);
      if (empty >= 0) stats[empty] = suggestion;
      else stats.push(suggestion);
      represented.add(kind);
    }
    next.stats = stats;
  }
  return next;
}
