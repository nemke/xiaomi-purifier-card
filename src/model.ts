import get from 'lodash/get.js';
import type { HassEntities } from 'home-assistant-js-websocket';
import type {
  PurifierAction,
  PurifierAQI,
  PurifierCardConfig,
  PurifierCardShortcut,
} from './types';

/** Use integer range positions to avoid a fractional last stop exceeding 100. */
export function percentageStops(step: number | undefined): number {
  return typeof step === 'number' && Number.isFinite(step) && step > 0
    ? Math.max(1, Math.round(100 / step))
    : 100;
}

export function readValue(
  states: HassEntities,
  source: PurifierAQI,
  fan: string,
): unknown {
  const entity = states[source.entity_id ?? fan];
  if (!entity || ['unknown', 'unavailable'].includes(entity.state))
    return undefined;
  return source.attribute
    ? get(entity.attributes, source.attribute)
    : entity.state;
}

export function referencedEntities(config: PurifierCardConfig): string[] {
  const ids = new Set([config.entity]);
  for (const source of [config.aqi, ...config.stats]) {
    if (source.entity_id) ids.add(source.entity_id);
  }
  for (const shortcut of config.shortcuts) {
    if (shortcut.state_entity) ids.add(shortcut.state_entity);
    for (const action of [...(shortcut.actions ?? []), shortcut]) {
      const target = action.target?.entity_id ?? action.service_data?.entity_id;
      for (const id of Array.isArray(target) ? target : [target]) {
        if (typeof id === 'string') ids.add(id);
      }
    }
  }
  return [...ids];
}

export function shortcutActions(
  shortcut: PurifierCardShortcut,
  fan: string,
): PurifierAction[] {
  if (shortcut.actions) return shortcut.actions;
  const actions: PurifierAction[] = [];
  const preset = shortcut.preset_mode ?? shortcut.speed;
  if (preset)
    actions.push({
      service: 'fan.set_preset_mode',
      service_data: { preset_mode: preset },
      target: { entity_id: fan },
    });
  if (shortcut.service)
    actions.push({
      service: shortcut.service,
      service_data: shortcut.service_data,
      target: shortcut.target,
    });
  if (shortcut.percentage !== undefined)
    actions.push({
      service: 'fan.set_percentage',
      service_data: { percentage: shortcut.percentage },
      target: { entity_id: fan },
    });
  return actions;
}

/** Validate the entire sequence before issuing any command. */
export function prepareActions(
  actions: PurifierAction[],
  states: HassEntities,
  fan: string,
): PurifierAction[] {
  if (!actions.length) throw new Error('This shortcut has no action');
  return actions.map((action) => {
    if (!/^[a-z_]+\.[a-z_]+$/.test(action.service))
      throw new Error('Invalid service name');
    const data = { ...action.service_data };
    const domain = action.service.split('.')[0];
    const target =
      action.target ??
      (data.entity_id
        ? undefined
        : domain === 'fan'
          ? { entity_id: fan }
          : undefined);
    const ids = target?.entity_id ?? data.entity_id;
    const entities = (Array.isArray(ids) ? ids : [ids]).filter(
      (id): id is string => typeof id === 'string',
    );
    for (const id of entities) {
      const entity = states[id];
      if (!entity || ['unavailable', 'unknown'].includes(entity.state))
        throw new Error(`${id} is unavailable`);
      if (action.service === 'fan.set_preset_mode') {
        const modes = entity.attributes.preset_modes as string[] | undefined;
        const mode = modes?.find(
          (value) =>
            value.toLowerCase() === String(data.preset_mode).toLowerCase(),
        );
        if (!mode)
          throw new Error(`${id} does not support preset ${data.preset_mode}`);
        data.preset_mode = mode;
      }
      if (action.service === 'fan.set_percentage') {
        const value = Number(data.percentage);
        if (
          !(Number(entity.attributes.supported_features) & 1) ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 100
        )
          throw new Error(`${id} does not support this percentage`);
        data.percentage = value;
      }
      if (action.service === 'number.set_value') {
        const value = Number(data.value);
        const { min, max, step } = entity.attributes;
        if (
          data.value === '' ||
          data.value == null ||
          !Number.isFinite(value) ||
          (typeof min === 'number' && value < min) ||
          (typeof max === 'number' && value > max)
        )
          throw new Error(`Value is outside the range for ${id}`);
        if (typeof step === 'number' && step > 0) {
          const steps = (value - (typeof min === 'number' ? min : 0)) / step;
          if (Math.abs(steps - Math.round(steps)) > 0.000001)
            throw new Error(`Value does not match the step for ${id}`);
        }
        data.value = value;
      }
    }
    // A non-fan custom service must never inherit the card's fan entity.
    return { service: action.service, service_data: data, target };
  });
}

export function shortcutActive(
  shortcut: PurifierCardShortcut,
  states: HassEntities,
  fan: string,
): boolean {
  if (states[fan]?.state !== 'on') return false;
  if (shortcut.state_entity)
    return (
      shortcut.state !== undefined &&
      String(states[shortcut.state_entity]?.state) === String(shortcut.state)
    );
  const actions = shortcutActions(shortcut, fan);
  let matched = false;
  for (const action of actions) {
    const id =
      action.target?.entity_id ??
      action.service_data?.entity_id ??
      (action.service.startsWith('fan.') ? fan : undefined);
    if (
      typeof id !== 'string' ||
      !states[id] ||
      ['unknown', 'unavailable'].includes(states[id].state)
    )
      return false;
    const entity = states[id];
    if (action.service === 'fan.set_preset_mode') {
      if (
        String(entity.attributes.preset_mode).toLowerCase() !==
        String(action.service_data?.preset_mode).toLowerCase()
      )
        return false;
    } else if (action.service === 'fan.set_percentage') {
      if (
        Number(entity.attributes.percentage) !==
        Number(action.service_data?.percentage)
      )
        return false;
    } else if (action.service === 'number.set_value') {
      if (Number(entity.state) !== Number(action.service_data?.value))
        return false;
    } else {
      return false;
    }
    matched = true;
  }
  return matched;
}
