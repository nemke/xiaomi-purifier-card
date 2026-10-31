import {
  LitElement,
  html,
  nothing,
  type PropertyValues,
  type CSSResultGroup,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import registerTemplates from 'ha-template';
import styles from './styles.css';
import localize from './localize';
import buildConfig from './config';
import { fanSpeedSource } from './discovery';
import {
  prepareActions,
  readValue,
  referencedEntities,
  shortcutActions,
  shortcutActive,
  percentageStops,
} from './model';
import type {
  PurifierAction,
  PurifierCardConfig,
  PurifierCardShortcut,
  PurifierEntity,
} from './types';

registerTemplates();
const PKG_VERSION = 'PKG_VERSION_VALUE';
console.info(`XIAOMI-PURIFIER-CARD ${PKG_VERSION}`);

@customElement('xiaomi-purifier-card')
export class PurifierCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private config!: PurifierCardConfig;
  @state() private pending = false;
  @state() private error = '';
  @state() private draftPercentage: number | undefined;
  @state() private speedExpanded = false;
  @state() private narrow = false;
  @state() private tiny = false;
  private sizeObserver?: ResizeObserver;

  public connectedCallback() {
    super.connectedCallback();
    this.sizeObserver = new ResizeObserver(([entry]) => {
      this.narrow = entry.contentRect.width <= 420;
      this.tiny = entry.contentRect.width <= 360;
    });
    this.sizeObserver.observe(this);
  }

  public disconnectedCallback() {
    this.sizeObserver?.disconnect();
    super.disconnectedCallback();
  }

  public static get styles(): CSSResultGroup {
    return styles;
  }
  public static async getConfigElement() {
    await import('./editor');
    return document.createElement('xiaomi-purifier-card-editor');
  }
  public static getStubConfig(_: unknown, entities: string[]) {
    return { entity: entities.find((id) => id.startsWith('fan.')) ?? '' };
  }
  public setConfig(config: Partial<PurifierCardConfig>) {
    this.config = buildConfig(config);
  }
  private get entity(): PurifierEntity | undefined {
    return this.hass?.states[this.config.entity] as PurifierEntity | undefined;
  }
  private get available() {
    return (
      !!this.entity && !['unknown', 'unavailable'].includes(this.entity.state)
    );
  }
  public getCardSize() {
    return this.config?.stats.length ? 5 : 3;
  }
  public getGridOptions() {
    return { columns: 12, rows: 'auto', min_columns: 6 };
  }

  protected shouldUpdate(changed: PropertyValues) {
    if (!this.config || !this.hass) return false;
    if ([...changed.keys()].some((key) => key !== 'hass')) return true;
    const previous = changed.get('hass') as HomeAssistant | undefined;
    return (
      !previous ||
      previous.language !== this.hass.language ||
      previous.themes !== this.hass.themes ||
      referencedEntities(this.config).some(
        (id) => previous.states[id] !== this.hass.states[id],
      )
    );
  }

  protected willUpdate(changed: PropertyValues) {
    const previous = changed.get('hass') as HomeAssistant | undefined;
    const previousFan = previous?.states[this.config.entity];
    if (
      previousFan &&
      (previousFan.attributes.preset_mode !==
        this.entity?.attributes.preset_mode ||
        this.entity?.state !== 'on')
    ) {
      this.draftPercentage = undefined;
    }
  }

  private moreInfo(entityId = this.config.entity) {
    fireEvent(
      this,
      'hass-more-info',
      { entityId },
      { bubbles: true, composed: true },
    );
  }

  private async execute(actions: PurifierAction[]) {
    if (this.pending || !this.available) return;
    this.pending = true;
    this.error = '';
    try {
      const prepared = prepareActions(
        actions,
        this.hass.states,
        this.config.entity,
      );
      for (const action of prepared) {
        const [domain, service] = action.service.split('.');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            this.hass.callService(
              domain,
              service,
              action.service_data,
              action.target,
            ),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      'Command timed out. Check the device state before retrying.',
                    ),
                  ),
                10000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (error) {
      this.error =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error);
    } finally {
      this.pending = false;
    }
  }

  private runShortcut(shortcut: PurifierCardShortcut) {
    void this.execute(shortcutActions(shortcut, this.config.entity));
  }

  private renderAQI() {
    const configured = this.config.aqi;
    const source =
      configured.entity_id || configured.attribute
        ? configured
        : fanSpeedSource(this.hass.states, this.config.entity);
    if (!source) return nothing;
    const raw = readValue(this.hass.states, source, this.config.entity);
    const value =
      raw === undefined || raw === null || raw === '' ? '—' : String(raw);
    return html`<div class="current-aqi">
      <span class="number-on">${value}</span
      ><span class="aqi-unit"
        >${source.unit ?? this.hass.states[source.entity_id ?? '']?.attributes.unit_of_measurement ?? 'AQI'}</span
      >
    </div>`;
  }

  private renderControls() {
    if (!this.speedExpanded) return nothing;
    const entity = this.entity;
    const hasPercentage = !!(Number(entity?.attributes.supported_features) & 1);
    const percentage = entity?.attributes.percentage;
    const displayedPercentage = this.draftPercentage ?? percentage;
    const stops = percentageStops(entity?.attributes.percentage_step);
    return html`<div class="controls" id="speed-adjustment">
      ${
        hasPercentage
          ? html`<label class="speed-control"
              ><span>${displayedPercentage ?? '—'}%</span
              ><input
                type="range"
                aria-label="Fan speed"
                aria-valuetext=${`${displayedPercentage ?? 0}%`}
                min="0"
                max=${stops}
                step="1"
                .value=${live(String(Math.round(((displayedPercentage ?? 0) * stops) / 100)))}
                ?disabled=${!this.available || entity?.state !== 'on' || this.pending}
                @input=${(event: Event) => {
                  this.draftPercentage = Math.round(
                    (Number((event.target as HTMLInputElement).value) * 100) /
                      stops,
                  );
                }}
                @pointercancel=${() => {
                  this.draftPercentage = undefined;
                }}
                @blur=${() => {
                  this.draftPercentage = undefined;
                }}
                @change=${(event: Event) => {
                  const percentage = Math.round(
                    (Number((event.target as HTMLInputElement).value) * 100) /
                      stops,
                  );
                  this.draftPercentage = undefined;
                  void this.execute([
                    {
                      service: 'fan.set_percentage',
                      service_data: {
                        percentage,
                      },
                    },
                  ]);
                }}
            /></label>`
          : nothing
      }
    </div>`;
  }

  private adjustSpeed(direction: number) {
    const steps = percentageStops(this.entity?.attributes.percentage_step);
    const current = Math.round(
      ((this.entity?.attributes.percentage ?? 0) * steps) / 100,
    );
    const next = Math.max(0, Math.min(steps, current + direction));
    void this.execute([
      {
        service: 'fan.set_percentage',
        service_data: { percentage: Math.round((next * 100) / steps) },
      },
    ]);
  }

  private renderSpeed() {
    const entity = this.entity;
    const hasPercentage = !!(Number(entity?.attributes.supported_features) & 1);
    const disabled =
      !this.available ||
      entity?.state !== 'on' ||
      this.pending ||
      typeof entity?.attributes.percentage !== 'number';
    return html`<div class="speed-pill">
      ${hasPercentage ? html`<button type="button" class="step-button" aria-label="Decrease fan speed" ?disabled=${disabled || entity!.attributes.percentage! <= 0} @click=${() => this.adjustSpeed(-1)}>−</button>` : nothing}
      ${
        hasPercentage
          ? html`<button
              type="button"
              class="reading-button"
              aria-label="Adjust fan speed"
              aria-expanded=${String(this.speedExpanded)}
              aria-controls="speed-adjustment"
              ?disabled=${!this.available || this.pending}
              @click=${() => {
                this.speedExpanded = !this.speedExpanded;
              }}
            >
              ${this.renderAQI()}
            </button>`
          : this.renderAQI()
      }
      ${hasPercentage ? html`<button type="button" class="step-button" aria-label="Increase fan speed" ?disabled=${disabled || entity!.attributes.percentage! >= 100} @click=${() => this.adjustSpeed(1)}>+</button>` : nothing}
    </div>`;
  }

  private toolbarShortcuts(): PurifierCardShortcut[] {
    const shortcuts = [...this.config.shortcuts];
    for (const mode of this.entity?.attributes.preset_modes ?? []) {
      const represented = shortcuts.some((shortcut) =>
        shortcutActions(shortcut, this.config.entity).some(
          (action) =>
            action.service === 'fan.set_preset_mode' &&
            String(action.service_data?.preset_mode).toLowerCase() ===
              mode.toLowerCase() &&
            (action.target?.entity_id ??
              action.service_data?.entity_id ??
              this.config.entity) === this.config.entity,
        ),
      );
      if (!represented)
        shortcuts.push({
          name: localize(`preset_mode.${mode.toLowerCase()}`) ?? mode,
          preset_mode: mode,
          icon:
            mode.toLowerCase() === 'auto'
              ? 'mdi:brightness-auto'
              : /silent|sleep/i.test(mode)
                ? 'mdi:weather-night'
                : /favorite/i.test(mode)
                  ? 'mdi:star'
                  : 'mdi:fan',
        });
    }
    return shortcuts;
  }

  private renderStats() {
    const stats = this.config.stats.filter(
      (stat) => stat.entity_id || stat.attribute,
    );
    if (!stats.length) return nothing;
    return html`<div
      class="stats"
      style=${`grid-template-columns:repeat(${this.narrow ? 2 : Math.min(stats.length, 5)},minmax(0,1fr))`}
    >
      ${stats.map((stat) => {
        const raw = readValue(this.hass.states, stat, this.config.entity);
        const valid = raw !== undefined && raw !== null && raw !== '';
        const value = valid ? String(raw) : '—';
        return html`<button
          type="button"
          class="stats-block"
          @click=${() => this.moreInfo(stat.entity_id)}
        >
          <span class="stats-reading"
            ><span class="stats-value"
              >${valid && stat.value_template ? html`<ha-template .hass=${this.hass} .template=${stat.value_template} .value=${value} .variables=${{ value }}></ha-template>` : value}</span
            ><span class="stats-unit"
              >${stat.unit ?? this.hass.states[stat.entity_id ?? '']?.attributes.unit_of_measurement ?? ''}</span
            ></span
          ><span class="stats-subtitle"
            >${stat.subtitle ?? stat.attribute ?? stat.entity_id}</span
          >
        </button>`;
      })}
    </div>`;
  }

  protected render() {
    if (!this.config || !this.hass) return nothing;
    const entity = this.entity;
    const disabled = !this.available || this.pending;
    const name =
      this.config.name ??
      entity?.attributes.friendly_name ??
      this.config.entity;
    const mode = entity?.attributes.preset_mode;
    const status = [
      this.config.show_state || !this.available
        ? (localize(`state.${entity?.state ?? 'unavailable'}`) ??
          entity?.state ??
          'Unavailable')
        : '',
      this.config.show_preset_mode && mode
        ? (localize(`preset_mode.${mode.toLowerCase()}`) ?? mode)
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return html`<ha-card
      class=${`${this.config.compact_view ? 'dense' : ''} ${this.narrow ? 'narrow' : ''} ${this.tiny ? 'tiny' : ''}`}
      aria-busy=${String(this.pending)}
    >
      <div class="header">
        <button
          type="button"
          class="identity"
          aria-label=${`More information: ${name}`}
          @click=${() => this.moreInfo()}
        >
          <span class="device-badge" data-on=${entity?.state === 'on'}
            ><ha-icon icon="mdi:air-purifier"></ha-icon
          ></span>
          <span class="metadata">
            ${this.config.show_name ? html`<span class="friendly-name">${name}</span>` : nothing}
            ${status ? html`<span class="state" role="status">${status}${this.pending ? ' …' : ''}</span>` : nothing}
          </span>
        </button>
        ${this.renderSpeed()}
      </div>
      ${
        this.config.show_toolbar
          ? html`<div class="toolbar">
              <button
                type="button"
                class="control-button power ${entity?.state === 'on' ? 'active' : ''}"
                aria-label=${localize('common.toggle_power') ?? 'Toggle power'}
                aria-pressed=${String(entity?.state === 'on')}
                title=${localize(entity?.state === 'on' ? 'common.turn_off' : 'common.turn_on')}
                ?disabled=${disabled}
                @click=${() => {
                  void this.execute([
                    {
                      service:
                        entity?.state === 'on' ? 'fan.turn_off' : 'fan.turn_on',
                    },
                  ]);
                }}
              >
                <ha-icon icon="mdi:power"></ha-icon>
              </button>
              <div class="shortcuts">
                ${this.toolbarShortcuts().map((shortcut) => {
                  const active = shortcutActive(
                    shortcut,
                    this.hass.states,
                    this.config.entity,
                  );
                  const label =
                    shortcut.name ??
                    shortcut.preset_mode ??
                    shortcut.service ??
                    'Shortcut';
                  return html`<button
                    type="button"
                    class="control-button ${active ? 'active' : ''}"
                    aria-label=${label}
                    aria-pressed=${String(active)}
                    title=${label}
                    ?disabled=${disabled}
                    @click=${() => this.runShortcut(shortcut)}
                  >
                    ${shortcut.icon ? html`<ha-icon .icon=${shortcut.icon}></ha-icon>` : nothing}<span
                      class="control-label"
                      >${label}</span
                    >
                  </button>`;
                })}
              </div>
            </div>`
          : nothing
      }
      ${this.renderControls()}
      ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
      ${this.renderStats()}
    </ha-card>`;
  }
}

declare global {
  interface Window {
    customCards?: unknown[];
  }
}
window.customCards = window.customCards || [];
window.customCards.push({
  preview: true,
  type: 'xiaomi-purifier-card',
  name: 'Xiaomi Purifier Card',
  description:
    'Air purifier controls with configurable sensors, modes, and speed shortcuts.',
});
