import { PurifierCardConfig } from './types';
import localize from './localize';

export default function buildConfig(
  config?: Partial<PurifierCardConfig>,
): PurifierCardConfig {
  if (!config) {
    throw new Error(localize('error.invalid_config'));
  }

  if (
    typeof config.entity !== 'string' ||
    !/^fan\.[a-z0-9_]+$/.test(config.entity)
  ) {
    throw new Error(localize('error.missing_entity'));
  }

  for (const key of [
    'stats',
    'shortcuts',
    'speed_controls',
    'device_controls',
  ] as const) {
    if (config[key] !== undefined && !Array.isArray(config[key])) {
      throw new Error(`${key} must be a list`);
    }
    if (
      config[key]?.some(
        (item) => !item || typeof item !== 'object' || Array.isArray(item),
      )
    ) {
      throw new Error(`${key} entries must be objects`);
    }
  }
  if (
    config.preset_modes !== undefined &&
    (!Array.isArray(config.preset_modes) ||
      config.preset_modes.some((mode) => typeof mode !== 'string'))
  )
    throw new Error('preset_modes must be a list of mode names');
  if (
    config.toolbar_style !== undefined &&
    !['auto', 'buttons', 'dropdown'].includes(config.toolbar_style)
  )
    throw new Error('Invalid toolbar style');

  if (config.shutdown_timer !== undefined) {
    if (
      !config.shutdown_timer ||
      typeof config.shutdown_timer !== 'object' ||
      Array.isArray(config.shutdown_timer)
    )
      throw new Error('shutdown_timer must be an object');
    for (const [key, domain] of [
      ['entity_id', 'timer'],
      ['automation_entity_id', 'automation'],
      ['deadline_entity_id', 'input_text'],
    ] as const) {
      const id = config.shutdown_timer[key];
      if (
        id !== undefined &&
        (typeof id !== 'string' ||
          (id && !new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(id)))
      )
        throw new Error(`Invalid shutdown_timer.${key}`);
    }
  }

  for (const key of ['show_pm_trends', 'show_max_speed'] as const)
    if (config[key] !== undefined && typeof config[key] !== 'boolean')
      throw new Error(`${key} must be a boolean`);

  const warning = config.filter_warning;
  if (warning !== undefined) {
    if (!warning || typeof warning !== 'object' || Array.isArray(warning))
      throw new Error('filter_warning must be an object');
    if (warning.enabled !== undefined && typeof warning.enabled !== 'boolean')
      throw new Error('filter_warning.enabled must be a boolean');
    if (
      warning.mode !== undefined &&
      !['remaining_percent', 'remaining_days', 'replacement'].includes(
        warning.mode,
      )
    )
      throw new Error('Invalid filter warning mode');
    for (const key of ['entity_id', 'attribute'] as const)
      if (warning[key] !== undefined && typeof warning[key] !== 'string')
        throw new Error(`filter_warning.${key} must be a string`);
    for (const key of ['warning_threshold', 'critical_threshold'] as const)
      if (
        warning[key] !== undefined &&
        (typeof warning[key] !== 'number' ||
          !Number.isFinite(warning[key]) ||
          warning[key] < 0 ||
          (warning.mode === 'remaining_percent' && warning[key] > 100))
      )
        throw new Error(`Invalid filter ${key}`);
    if (
      warning.warning_threshold !== undefined &&
      warning.critical_threshold !== undefined &&
      warning.critical_threshold > warning.warning_threshold
    )
      throw new Error(
        'Critical filter threshold must not exceed warning threshold',
      );
  }

  return {
    ...config, // pass all unlisted properties
    entity: config.entity,
    show_name: config.show_name ?? true,
    show_state: config.show_state ?? true,
    show_preset_mode: config.show_preset_mode ?? true,
    show_toolbar: config.show_toolbar ?? true,
    show_max_speed: config.show_max_speed ?? true,
    show_pm_trends: config.show_pm_trends ?? true,
    compact_view: config.compact_view ?? false,
    aqi: config.aqi ?? {},
    stats: config.stats ?? [],
    toolbar_style: config.toolbar_style ?? 'auto',
    speed_controls: config.speed_controls ?? [],
    device_controls: config.device_controls ?? [],
    shortcuts: (config.shortcuts ?? []).map((shortcut) => ({
      ...shortcut,
      preset_mode: shortcut.preset_mode ?? shortcut.speed,
    })),
  };
}
