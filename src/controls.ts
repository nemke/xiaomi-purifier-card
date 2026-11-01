import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import type { RegistryEntity } from './discovery';
import type { PurifierDeviceControl, PurifierSpeedControl } from './types';

export function numberBounds(entity?: HassEntity) {
  const { min, max, step } = entity?.attributes ?? {};
  return [min, max, step].every(
    (value) => typeof value === 'number' && Number.isFinite(value),
  ) &&
    min <= max &&
    step > 0
    ? { min: min as number, max: max as number, step: step as number }
    : undefined;
}

/** Suggest known controls from the same device; ambiguous matches stay manual. */
export function detectControls(
  states: HassEntities,
  registry: RegistryEntity[],
  fan: string,
) {
  const speed_controls: PurifierSpeedControl[] = [];
  const device_controls: PurifierDeviceControl[] = [];
  const device = registry.find((entry) => entry.entity_id === fan)?.device_id;
  if (!device) return { speed_controls, device_controls };
  const related = registry.filter(
    (entry) =>
      entry.device_id === device &&
      !entry.disabled_by &&
      states[entry.entity_id],
  );
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matches = (entry: RegistryEntity, names: string[]) =>
    [entry.translation_key, entry.original_name].some(
      (value) => value && names.includes(normalize(value)),
    ) ||
    names.some((name) =>
      normalize(entry.entity_id.split('.')[1]).endsWith(name),
    );
  for (const [mode, names] of [
    ['Favorite', ['favoritelevel', 'favoriterpm', 'favoritemotorspeed']],
    ['Fan', ['fanlevel']],
  ] as const) {
    const preset = (
      states[fan]?.attributes.preset_modes as string[] | undefined
    )?.find((item) => item.toLowerCase() === mode.toLowerCase());
    const candidates = related.filter(
      (entry) =>
        entry.entity_id.startsWith('number.') &&
        numberBounds(states[entry.entity_id]) &&
        matches(entry, [...names]),
    );
    if (preset && candidates.length === 1)
      speed_controls.push({
        entity_id: candidates[0].entity_id,
        preset_mode: preset,
      });
  }
  for (const names of [
    ['childlock'],
    ['buzzer'],
    ['ledbrightness', 'displaybrightness', 'display', 'ledenable', 'led'],
    ['nightlightlevel'],
  ]) {
    const candidates = related.filter(
      (entry) =>
        /^(switch|select|number)\./.test(entry.entity_id) &&
        matches(entry, names) &&
        (!entry.entity_id.startsWith('number.') ||
          numberBounds(states[entry.entity_id])),
    );
    if (candidates.length === 1)
      device_controls.push({ entity_id: candidates[0].entity_id });
  }
  return { speed_controls, device_controls };
}
