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

  return {
    ...config, // pass all unlisted properties
    entity: config.entity,
    show_name: config.show_name ?? true,
    show_state: config.show_state ?? true,
    show_preset_mode: config.show_preset_mode ?? true,
    show_toolbar: config.show_toolbar ?? true,
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
