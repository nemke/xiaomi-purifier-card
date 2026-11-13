import { shortcutActions } from './model';
import type { HassEntity } from 'home-assistant-js-websocket';
import type { PurifierCardConfig, PurifierCardShortcut } from './types';

/** Request the native maximum, rather than guessing RPM from a model name. */
export function maxSpeedShortcut(
  entity: HassEntity | undefined,
  label = 'Max',
): PurifierCardShortcut | undefined {
  if (
    !entity ||
    ['unknown', 'unavailable'].includes(entity.state) ||
    !(Number(entity.attributes.supported_features) & 1)
  )
    return undefined;
  const modes = (
    Number(entity.attributes.supported_features) & 8
      ? (entity.attributes.preset_modes ?? [])
      : []
  ) as string[];
  const manual = ['fan', 'manual', 'favorite']
    .map((name) => modes.find((mode) => mode.toLowerCase() === name))
    .find(Boolean);
  return {
    name: label,
    icon: 'mdi:fan-plus',
    ...(manual ? { preset_mode: manual } : {}),
    percentage: 100,
  };
}

export function presetShortcut(
  mode: string,
  label = mode,
): PurifierCardShortcut {
  return {
    name: label,
    preset_mode: mode,
    icon:
      mode.toLowerCase() === 'auto'
        ? 'mdi:brightness-auto'
        : /silent|sleep/i.test(mode)
          ? 'mdi:weather-night'
          : /favorite/i.test(mode)
            ? 'mdi:star'
            : 'mdi:fan',
  };
}

export function buildToolbar(
  config: PurifierCardConfig,
  modes: string[],
  label: (mode: string) => string = (mode) => mode,
  maxSpeed?: PurifierCardShortcut,
) {
  const shortcuts = [...config.shortcuts];
  const withMax = (items: PurifierCardShortcut[]) =>
    maxSpeed &&
    config.show_max_speed !== false &&
    !items.some(
      (item) =>
        item.name &&
        ['max', maxSpeed.name?.toLowerCase()].includes(
          item.name.trim().toLowerCase(),
        ),
    )
      ? [...items, maxSpeed]
      : items;
  const represents = (shortcut: PurifierCardShortcut, mode: string) =>
    shortcutActions(shortcut, config.entity).some(
      (action) =>
        action.service === 'fan.set_preset_mode' &&
        String(action.service_data?.preset_mode).toLowerCase() ===
          mode.toLowerCase() &&
        (action.target?.entity_id ??
          action.service_data?.entity_id ??
          config.entity) === config.entity,
    );
  if (config.preset_modes === undefined) {
    for (const mode of modes)
      if (!shortcuts.some((shortcut) => represents(shortcut, mode)))
        shortcuts.push(presetShortcut(mode, label(mode)));
    return withMax(shortcuts);
  }
  const used = new Set<number>();
  const result: PurifierCardShortcut[] = [];
  for (const requested of config.preset_modes) {
    const mode = modes.find(
      (item) => item.toLowerCase() === requested.toLowerCase(),
    );
    if (!mode) continue;
    const index = shortcuts.findIndex(
      (shortcut) =>
        shortcutActions(shortcut, config.entity).length === 1 &&
        represents(shortcut, mode),
    );
    if (index >= 0) used.add(index);
    result.push(
      index >= 0 ? shortcuts[index] : presetShortcut(mode, label(mode)),
    );
  }
  return withMax([
    ...result,
    ...shortcuts.filter(
      (shortcut, i) =>
        !used.has(i) &&
        !(
          shortcutActions(shortcut, config.entity).length === 1 &&
          modes.some((mode) => represents(shortcut, mode))
        ),
    ),
  ]);
}
