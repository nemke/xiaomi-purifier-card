import {
  HassEntityAttributeBase,
  HassEntityBase,
  HassServiceTarget,
} from 'home-assistant-js-websocket';
import { TemplateResult, nothing } from 'lit';

export * from 'home-assistant-js-websocket';

export type TemplateNothing = typeof nothing;
export type Template = TemplateResult | TemplateNothing;

export type PurifierEntityState = 'on' | 'off' | 'unavailable' | 'unknown';

export interface PurifierEntityAttributes extends HassEntityAttributeBase {
  preset_mode?: string;
  preset_modes?: string[];
  percentage?: number;
  percentage_step?: number;
  supported_features?: number;
  use_time?: number;
}

export interface PurifierEntity extends HassEntityBase {
  attributes: PurifierEntityAttributes;
  state: PurifierEntityState;
}

export interface PurifierAQI {
  entity_id?: string;
  attribute?: string;
  unit?: string;
}

export interface PurifierCardStat {
  entity_id?: string;
  attribute?: string;
  value_template?: string;
  unit?: string;
  subtitle?: string;
  /** Omit for automatic icons; an empty string keeps the text label. */
  icon?: string;
}

export interface PurifierCardShortcut {
  name?: string;
  icon?: string;
  service?: string;
  service_data?: Record<string, unknown>;
  target?: HassServiceTarget;
  percentage?: number;
  preset_mode?: string;
  /** Legacy alias for preset_mode. */
  speed?: string;
  actions?: PurifierAction[];
  state_entity?: string;
  state?: string | number;
}

export interface PurifierSpeedControl {
  entity_id: string;
  preset_mode?: string;
  name?: string;
}

export interface PurifierDeviceControl {
  entity_id: string;
  name?: string;
}

export interface PurifierFilterWarning {
  enabled?: boolean;
  entity_id?: string;
  attribute?: string;
  mode?: 'remaining_percent' | 'remaining_days' | 'replacement';
  warning_threshold?: number;
  critical_threshold?: number;
}

export interface PurifierShutdownTimer {
  entity_id?: string;
  automation_entity_id?: string;
  deadline_entity_id?: string;
}

export interface PurifierAction {
  service: string;
  service_data?: Record<string, unknown>;
  target?: HassServiceTarget;
}

export interface PurifierCardConfig {
  type?: string;
  name?: string;
  entity: string;
  show_name: boolean;
  show_state: boolean;
  show_preset_mode: boolean;
  show_toolbar: boolean;
  show_pm_trends: boolean;
  compact_view: boolean;
  aqi: PurifierAQI;
  stats: PurifierCardStat[];
  shortcuts: PurifierCardShortcut[];
  preset_modes?: string[];
  toolbar_style: 'auto' | 'buttons' | 'dropdown';
  speed_controls: PurifierSpeedControl[];
  device_controls: PurifierDeviceControl[];
  filter_warning?: PurifierFilterWarning;
  shutdown_timer?: PurifierShutdownTimer;
}

export interface SliderValue {
  value: number;
}
