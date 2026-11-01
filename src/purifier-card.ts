import {
  LitElement,
  html,
  nothing,
  type PropertyValues,
  type CSSResultGroup,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import registerTemplates from 'ha-template';
import styles from './styles.css';
import localize from './localize';
import buildConfig from './config';
import { fanSpeedSource, statisticIcon } from './discovery';
import {
  prepareActions,
  readValue,
  referencedEntities,
  shortcutActions,
  shortcutActive,
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
  @state() private refreshing = false;
  @state() private narrow = false;
  @state() private tiny = false;
  private sizeObserver?: ResizeObserver;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private refreshGeneration = 0;

  public connectedCallback() {
    super.connectedCallback();
    this.sizeObserver = new ResizeObserver(([entry]) => {
      this.narrow = entry.contentRect.width <= 420;
      this.tiny = entry.contentRect.width <= 360;
    });
    this.sizeObserver.observe(this);
  }

  public disconnectedCallback() {
    this.cancelRefresh();
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
    this.cancelRefresh();
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
    this.cancelRefresh();
    const generation = this.refreshGeneration;
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
      if (generation === this.refreshGeneration) this.refreshAfterAction();
    } catch (error) {
      this.error =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error);
    } finally {
      this.pending = false;
    }
  }

  private cancelRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshGeneration++;
    this.refreshing = false;
  }

  private refreshAfterAction() {
    if (!this.isConnected || !this.hass.services?.homeassistant?.update_entity)
      return;
    const generation = this.refreshGeneration;
    // Refresh the reading's entity only. Xiaomi sensors share a coordinator,
    // so requesting every statistic separately would repeat the device poll.
    const entityId = this.config.aqi.entity_id || this.config.entity;
    const current = () =>
      this.isConnected && generation === this.refreshGeneration;
    const request = async (followUp = false) => {
      if (!current()) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let succeeded = false;
      try {
        await Promise.race([
          this.hass.callService('homeassistant', 'update_entity', {
            entity_id: entityId,
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Refresh timed out')),
              10000,
            );
          }),
        ]);
        succeeded = true;
      } catch {
        // A refresh is best effort; a successful device command stays successful.
        // Normal HA state subscriptions continue if refresh is unsupported/denied.
      } finally {
        clearTimeout(timeout);
        if (current()) this.refreshing = false;
      }
      if (current() && succeeded && !followUp)
        // Allow both motor settling and HA's default 10-second refresh cooldown.
        this.refreshTimer = setTimeout(() => void request(true), 10000);
    };
    this.refreshing = true;
    this.refreshTimer = setTimeout(() => void request(), 1000);
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

  private renderSpeed() {
    return html`<div class="speed-pill">
      ${this.renderAQI()}
      ${
        this.pending || this.refreshing
          ? html`<span class="refresh-status" role="status"
              >${localize('common.updating')}</span
            >`
          : nothing
      }
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
        const icon = statisticIcon(this.hass.states, stat);
        const label =
          stat.subtitle ||
          stat.attribute ||
          this.hass.states[stat.entity_id ?? '']?.attributes.friendly_name ||
          stat.entity_id;
        const inlineLabel = label?.replace(/^PM\s*(2\.5|10)$/i, 'PM$1');
        return html`<button
          type="button"
          class="stats-block"
          title=${label ?? ''}
          @click=${() => this.moreInfo(stat.entity_id)}
        >
          <span class="stats-reading"
            >${
              icon
                ? html`<ha-icon
                    class="stats-icon"
                    .icon=${icon}
                    aria-hidden="true"
                  ></ha-icon>`
                : html`<span
                    class="stats-subtitle ${inlineLabel === 'PM2.5' || inlineLabel === 'PM10' ? 'particle-label' : ''}"
                    >${inlineLabel}</span
                  >`
            }<span class="stats-measurement"
              ><span class="stats-value"
                >${valid && stat.value_template ? html`<ha-template .hass=${this.hass} .template=${stat.value_template} .value=${value} .variables=${{ value }}></ha-template>` : value}</span
              ><span class="stats-unit"
                >${stat.unit ?? this.hass.states[stat.entity_id ?? '']?.attributes.unit_of_measurement ?? ''}</span
              ></span
            ></span
          >${icon ? html`<span class="sr-only">${label}</span>` : nothing}
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
