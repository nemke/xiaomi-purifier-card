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
import workingImg from './images/purifier-working.gif';
import standbyImg from './images/purifier-standby.png';
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
    return this.config?.compact_view ? 5 : 8;
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
    const entity = this.entity;
    const hasPercentage = !!(Number(entity?.attributes.supported_features) & 1);
    const percentage = entity?.attributes.percentage;
    const displayedPercentage = this.draftPercentage ?? percentage;
    const stops = percentageStops(entity?.attributes.percentage_step);
    return html` <div
      class="controls ${this.config.compact_view ? 'compact' : ''}"
    >
      ${
        this.config.compact_view
          ? this.renderAQI()
          : html` <div class="dial" data-on=${entity?.state === 'on'}>
              <img
                class="image"
                src=${entity?.state === 'on' ? workingImg : standbyImg}
                alt=""
                @error=${(event: Event) => {
                  (event.target as HTMLImageElement).hidden = true;
                }}
              />
              ${this.renderAQI()}
            </div>`
      }
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

  private renderStats() {
    const stats = this.config.stats.filter(
      (stat) => stat.entity_id || stat.attribute,
    );
    if (!stats.length) return nothing;
    return html`<div class="stats">
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
    const modes = entity?.attributes.preset_modes ?? [];
    const currentMode = entity?.attributes.preset_mode;
    return html`<ha-card aria-busy=${String(this.pending)}>
      <div class="header">
        ${
          this.config.show_preset_mode && modes.length
            ? html`<label class="mode-control"
                ><ha-icon icon="mdi:fan"></ha-icon
                ><select
                  aria-label="Preset mode"
                  .value=${live(currentMode ?? '')}
                  ?disabled=${disabled}
                  @change=${(event: Event) => {
                    void this.execute([
                      {
                        service: 'fan.set_preset_mode',
                        service_data: {
                          preset_mode: (event.target as HTMLSelectElement)
                            .value,
                        },
                      },
                    ]);
                  }}
                >
                  ${!currentMode ? html`<option value="" disabled>—</option>` : nothing}${modes.map((mode) => html`<option .value=${mode} ?selected=${mode === currentMode}>${localize(`preset_mode.${mode.toLowerCase()}`) ?? mode}</option>`)}
                </select></label
              >`
            : html`<span></span>`
        }
        <button
          type="button"
          class="icon-button more-info"
          aria-label="More information"
          @click=${() => this.moreInfo()}
        >
          <ha-icon icon="mdi:dots-vertical"></ha-icon>
        </button>
      </div>
      ${this.renderControls()}
      <div class="metadata">
        ${this.config.show_name ? html`<div class="friendly-name">${this.config.name ?? entity?.attributes.friendly_name ?? this.config.entity}</div>` : nothing}
        ${this.config.show_state || !this.available ? html`<div class="state" role="status">${localize(`state.${entity?.state ?? 'unavailable'}`) ?? entity?.state ?? 'Unavailable'}${this.pending ? ' …' : ''}</div>` : nothing}
      </div>
      ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
      ${this.renderStats()}
      ${
        this.config.show_toolbar
          ? html`<div class="toolbar">
              <button
                type="button"
                class="icon-button power ${entity?.state === 'on' ? 'active' : ''}"
                aria-label=${localize('common.toggle_power') ?? 'Toggle power'}
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
                ${this.config.shortcuts.map((shortcut) => {
                  const active = shortcutActive(
                    shortcut,
                    this.hass.states,
                    this.config.entity,
                  );
                  return html`<button
                    type="button"
                    class="icon-button ${active ? 'active' : ''}"
                    aria-label=${shortcut.name ?? shortcut.preset_mode ?? shortcut.service ?? 'Shortcut'}
                    aria-pressed=${String(active)}
                    title=${shortcut.name ?? ''}
                    ?disabled=${disabled}
                    @click=${() => this.runShortcut(shortcut)}
                  >
                    ${shortcut.icon ? html`<ha-icon .icon=${shortcut.icon}></ha-icon>` : html`<span>${shortcut.name ?? shortcut.preset_mode ?? '▶'}</span>`}
                  </button>`;
                })}
              </div>
            </div>`
          : nothing
      }
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
