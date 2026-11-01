import { shortcutActions } from './model';
import type { PurifierCardConfig, PurifierCardShortcut } from './types';

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
) {
  const shortcuts = [...config.shortcuts];
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
    return shortcuts;
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
  return [
    ...result,
    ...shortcuts.filter(
      (shortcut, i) =>
        !used.has(i) &&
        !(
          shortcutActions(shortcut, config.entity).length === 1 &&
          modes.some((mode) => represents(shortcut, mode))
        ),
    ),
  ];
}
