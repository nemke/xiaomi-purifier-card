import type { HassEntities } from 'home-assistant-js-websocket';
import type { PurifierAction } from './types';

export interface CommandGoal {
  entity_id: string;
  attribute?: string;
  value: string | number;
}

/** Only track outcomes whose meaning is known; arbitrary scripts remain opaque. */
export function commandGoals(actions: PurifierAction[]): CommandGoal[] {
  const goals = new Map<string, CommandGoal>();
  for (const action of actions) {
    const ids = action.target?.entity_id ?? action.service_data?.entity_id;
    for (const entity_id of Array.isArray(ids) ? ids : [ids]) {
      if (typeof entity_id !== 'string') continue;
      const data = action.service_data ?? {};
      const add = (value: string | number, attribute?: string) =>
        goals.set(`${entity_id}|${attribute ?? ''}`, {
          entity_id,
          attribute,
          value,
        });
      if (
        action.service === 'fan.set_preset_mode' ||
        (action.service === 'fan.turn_on' && data.preset_mode !== undefined)
      )
        add(String(data.preset_mode), 'preset_mode');
      if (['fan.turn_on', 'switch.turn_on'].includes(action.service)) add('on');
      if (['fan.turn_off', 'switch.turn_off'].includes(action.service))
        add('off');
      if (action.service === 'fan.set_percentage')
        add(Number(data.percentage), 'percentage');
      if (action.service === 'number.set_value') add(Number(data.value));
      if (action.service === 'select.select_option') add(String(data.option));
    }
  }
  return [...goals.values()];
}

export function goalConfirmed(goal: CommandGoal, states: HassEntities) {
  const entity = states[goal.entity_id];
  if (!entity || ['unavailable', 'unknown'].includes(entity.state))
    return false;
  const actual = goal.attribute
    ? entity.attributes[goal.attribute]
    : entity.state;
  return typeof goal.value === 'number'
    ? actual !== '' &&
        actual !== null &&
        actual !== undefined &&
        Number(actual) === goal.value
    : String(actual) === goal.value;
}
