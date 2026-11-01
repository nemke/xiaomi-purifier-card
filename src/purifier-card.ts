import {
  LitElement,
  html,
  nothing,
  svg,
  type PropertyValues,
  type CSSResultGroup,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { buildToolbar } from './toolbar';
import { commandGoals, goalConfirmed, type CommandGoal } from './command';
import { numberBounds } from './controls';
import { filterStatus } from './filter';
import './shutdown-timer';
import {
  trendSource,
  historyPoints,
  trendPaths,
  watchHistory,
  type HistoryRows,
} from './pm-history';
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
  PurifierSpeedControl,
  PurifierDeviceControl,
} from './types';

registerTemplates();
const PKG_VERSION = 'PKG_VERSION_VALUE';
console.info(`BREEZE-PURIFIER-CARD ${PKG_VERSION}`);

@customElement('breeze-purifier-card')
export class PurifierCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private config!: PurifierCardConfig;
  @state() private pending = false;
  @state() private error = '';
  @state() private refreshing = false;
  @state() private narrow = false;
  @state() private tiny = false;
  @state() private width = 0;
  @state() private controlsExpanded = false;
  @state() private drafts: Record<string, string> = {};
  @state() private commandLabel = '';
  @state() private request?: {
    goals: CommandGoal[];
    label: string;
    id: string;
    expired: boolean;
  };
  @state() private historyRows: HistoryRows = {};
  @state() private historyNow = Date.now();
  private historyInView = false;
  private historyObserver?: IntersectionObserver;
  private historyTick?: ReturnType<typeof setInterval>;
  private stopHistory?: () => void;
  private historyKey = '';
  private historyConnection?: HomeAssistant['connection'];
  private historyGeneration = 0;
  private historyVisibility = () => this.syncHistory();
  private confirmationTimer?: ReturnType<typeof setTimeout>;
  private sizeObserver?: ResizeObserver;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private refreshGeneration = 0;

  public connectedCallback() {
    super.connectedCallback();
    this.sizeObserver = new ResizeObserver(([entry]) => {
      this.width = entry.contentRect.width;
      this.narrow = entry.contentRect.width <= 420;
      this.tiny = entry.contentRect.width <= 360;
    });
    this.sizeObserver.observe(this);
    this.historyInView = false;
    this.historyObserver = new IntersectionObserver(([entry]) => {
      this.historyInView = entry.isIntersecting;
      this.syncHistory();
    });
    this.historyObserver.observe(this);
    document.addEventListener('visibilitychange', this.historyVisibility);
  }

  public disconnectedCallback() {
    this.cancelRefresh();
    this.cancelRequest();
    this.sizeObserver?.disconnect();
    this.historyObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.historyVisibility);
    this.clearHistory();
    super.disconnectedCallback();
  }

  public static get styles(): CSSResultGroup {
    return styles;
  }
  public static async getConfigElement() {
    await import('./editor');
    return document.createElement('breeze-purifier-card-editor');
  }
  public static getStubConfig(_: unknown, entities: string[]) {
    return { entity: entities.find((id) => id.startsWith('fan.')) ?? '' };
  }
  public setConfig(config: Partial<PurifierCardConfig>) {
    this.cancelRefresh();
    this.cancelRequest();
    if (config.entity !== this.config?.entity) {
      this.controlsExpanded = false;
      this.drafts = {};
    }
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
      previous.config !== this.hass.config ||
      previous.connection !== this.hass.connection ||
      previous.connected !== this.hass.connected ||
      previous.themes !== this.hass.themes ||
      referencedEntities(this.config).some(
        (id) => previous.states[id] !== this.hass.states[id],
      )
    );
  }

  protected willUpdate() {
    if (
      this.request &&
      this.request.goals.every((goal) => goalConfirmed(goal, this.hass.states))
    ) {
      const drafts = { ...this.drafts };
      for (const goal of this.request.goals)
        if (
          goal.entity_id.startsWith('number.') &&
          Number(drafts[goal.entity_id]) === Number(goal.value)
        )
          delete drafts[goal.entity_id];
      this.drafts = drafts;
      this.cancelRequest();
    }
  }
  protected updated() {
    this.syncHistory();
  }
  private clearHistory() {
    this.historyGeneration++;
    this.stopHistory?.();
    this.stopHistory = undefined;
    clearInterval(this.historyTick);
    this.historyTick = undefined;
    this.historyKey = '';
    this.historyConnection = undefined;
    this.historyRows = {};
  }
  private syncHistory() {
    if (!this.config || !this.hass) return;
    const sources = this.config.show_pm_trends
      ? this.config.stats
          .map((stat) =>
            trendSource(this.hass.states, stat, this.config.entity),
          )
          .filter((source): source is NonNullable<typeof source> => !!source)
      : [];
    const enabled =
      this.isConnected &&
      this.historyInView &&
      this.hass.connected !== false &&
      !document.hidden &&
      this.hass.config?.components?.includes('history') &&
      typeof this.hass.connection?.subscribeMessage === 'function';
    const key =
      enabled && sources.length
        ? JSON.stringify([
            [...new Set(sources.map((source) => source.entity_id))].sort(),
            sources.some((source) => !!source.attribute),
          ])
        : '';
    if (
      key === this.historyKey &&
      (!key || this.hass.connection === this.historyConnection)
    )
      return;
    this.clearHistory();
    if (!key) return;
    this.historyKey = key;
    this.historyConnection = this.hass.connection;
    const generation = this.historyGeneration;
    this.historyNow = Date.now();
    this.stopHistory = watchHistory(this.hass.connection, sources, (rows) => {
      if (this.isConnected && generation === this.historyGeneration) {
        this.historyRows = rows;
        this.historyNow = Date.now();
      }
    });
    this.historyTick = setInterval(() => {
      this.historyNow = Date.now();
    }, 60000);
  }
  private statTrend(stat: PurifierCardConfig['stats'][number]) {
    if (!this.config.show_pm_trends) return [];
    const source = trendSource(this.hass.states, stat, this.config.entity);
    return source
      ? trendPaths(
          historyPoints(this.historyRows[source.entity_id] ?? [], source),
          this.historyNow,
        )
      : [];
  }
  private cancelRequest() {
    clearTimeout(this.confirmationTimer);
    this.request = undefined;
  }
  private requestedValue(id: string) {
    return this.request && !this.request.expired
      ? this.request.goals.find(
          (goal) => goal.entity_id === id && !goal.attribute,
        )?.value
      : undefined;
  }
  private moreInfo(entityId = this.config.entity) {
    fireEvent(
      this,
      'hass-more-info',
      { entityId },
      { bubbles: true, composed: true },
    );
  }

  private async execute(actions: PurifierAction[], label = '', id = '') {
    if (this.pending || !this.available) return;
    this.cancelRefresh();
    this.cancelRequest();
    const focus = this.shadowRoot?.activeElement as HTMLElement | null;
    const generation = this.refreshGeneration;
    this.commandLabel = label;
    this.pending = true;
    this.error = '';
    try {
      const prepared = prepareActions(
        actions,
        this.hass.states,
        this.config.entity,
      );
      const goals = commandGoals(prepared);
      if (
        goals.length &&
        !goals.every((goal) => goalConfirmed(goal, this.hass.states))
      )
        this.request = { goals, label, id, expired: false };
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
      if (generation === this.refreshGeneration) {
        this.refreshAfterAction();
        if (this.request)
          this.confirmationTimer = setTimeout(() => {
            if (
              this.isConnected &&
              generation === this.refreshGeneration &&
              this.request
            )
              this.request = { ...this.request, expired: true };
          }, 15000);
      }
    } catch (error) {
      this.cancelRequest();
      this.error =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error);
    } finally {
      this.pending = false;
      this.commandLabel = '';
      await this.updateComplete;
      if (
        this.isConnected &&
        generation === this.refreshGeneration &&
        focus?.isConnected &&
        (document.activeElement === document.body ||
          (document.activeElement === this &&
            !this.shadowRoot?.activeElement)) &&
        !focus.matches(':disabled')
      )
        focus.focus({ preventScroll: true });
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

  private runShortcut(shortcut: PurifierCardShortcut, index: number) {
    const actions = shortcutActions(shortcut, this.config.entity);
    // Shorthand preset actions explicitly start the purifier when it is off.
    if (
      !shortcut.actions &&
      this.entity?.state === 'off' &&
      actions[0]?.service === 'fan.set_preset_mode'
    )
      actions[0] = { ...actions[0], service: 'fan.turn_on' };
    void this.execute(
      actions,
      shortcut.name ?? shortcut.preset_mode ?? shortcut.service ?? 'Shortcut',
      `shortcut-${index}`,
    );
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
        >${source.unit ?? this.hass.states[source.entity_id ?? '']?.attributes.unit_of_measurement ?? ''}</span
      >
    </div>`;
  }

  private renderSpeed() {
    if (
      !this.config.aqi.entity_id &&
      !this.config.aqi.attribute &&
      !fanSpeedSource(this.hass.states, this.config.entity)
    )
      return nothing;
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
    return buildToolbar(
      this.config,
      this.entity?.attributes.preset_modes ?? [],
      (mode) => localize(`preset_mode.${mode.toLowerCase()}`) ?? mode,
    );
  }
  private text(key: string) {
    return localize(`controls.${key}`) ?? key;
  }
  private hasControls() {
    return !!this.config.shutdown_timer?.entity_id || this.hasDeviceControls();
  }
  private hasDeviceControls() {
    return (
      this.config.speed_controls.some((item) => !!item.entity_id) ||
      this.config.device_controls.some((item) => !!item.entity_id)
    );
  }
  private renderToolbar(disabled: boolean) {
    if (!this.config.show_toolbar) return nothing;
    const shortcuts = this.toolbarShortcuts();
    const hasControls = this.hasControls();
    const needed =
      44 +
      shortcuts.length * 48 +
      (hasControls ? 44 : 0) +
      (shortcuts.length + (hasControls ? 1 : 0)) * 4 +
      8;
    const overflow = this.width > 0 && needed > this.width - 24;
    const dropdown =
      this.config.toolbar_style === 'dropdown' ||
      (this.config.toolbar_style === 'auto' && overflow);
    return html`<div class="toolbar">
        <button
          type="button"
          class="control-button power ${this.entity?.state === 'on' ? 'active' : ''} ${this.request?.id === 'power' && !this.request.expired ? 'requested' : ''}"
          aria-label=${localize('common.toggle_power') ?? 'Toggle power'}
          aria-pressed=${String(this.entity?.state === 'on')}
          title=${localize(this.entity?.state === 'on' ? 'common.turn_off' : 'common.turn_on')}
          ?disabled=${disabled}
          @click=${() => void this.execute([{ service: this.entity?.state === 'on' ? 'fan.turn_off' : 'fan.turn_on' }], localize(this.entity?.state === 'on' ? 'common.turn_off' : 'common.turn_on') ?? 'Power', 'power')}
        >
          <ha-icon icon="mdi:power"></ha-icon>
        </button>
        ${
          dropdown
            ? html`<select
                class="shortcut-menu"
                aria-label=${this.text('run_shortcut')}
                .value=${live('')}
                ?disabled=${disabled}
                @change=${(event: Event) => {
                  const select = event.target as HTMLSelectElement;
                  const index = Number(select.value);
                  if (shortcuts[index])
                    this.runShortcut(shortcuts[index], index);
                  select.value = '';
                }}
              >
                <option value="" disabled selected>
                  ${this.text('choose_action')}
                </option>
                ${shortcuts.map((shortcut, index) => html`<option .value=${String(index)}>${shortcut.name ?? shortcut.preset_mode ?? shortcut.service ?? 'Shortcut'}${shortcutActive(shortcut, this.hass.states, this.config.entity) ? ' ✓' : ''}</option>`)}
              </select>`
            : html`<div class="shortcuts">
                ${shortcuts.map((shortcut, index) => {
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
                  const requested =
                    this.request?.id === `shortcut-${index}` &&
                    !this.request.expired;
                  return html`<button
                    type="button"
                    class="control-button ${active ? 'active' : ''} ${requested ? 'requested' : ''}"
                    aria-label=${label}
                    aria-pressed=${String(active)}
                    aria-busy=${String(requested)}
                    title=${label}
                    ?disabled=${disabled}
                    @click=${() => this.runShortcut(shortcut, index)}
                  >
                    ${shortcut.icon ? html`<ha-icon .icon=${shortcut.icon}></ha-icon>` : nothing}<span
                      class="control-label"
                      >${label}</span
                    >
                  </button>`;
                })}
              </div>`
        }
        ${
          hasControls
            ? html`<button
                type="button"
                class="control-button controls-toggle"
                aria-label=${this.text('device_controls')}
                aria-expanded=${String(this.controlsExpanded)}
                @click=${() => {
                  this.controlsExpanded = !this.controlsExpanded;
                }}
              >
                <ha-icon icon="mdi:cog-outline"></ha-icon>
              </button>`
            : nothing
        }
      </div>
      ${!dropdown && overflow ? html`<p class="toolbar-hint">${this.text('swipe_actions')}</p>` : nothing}`;
  }
  private renderNumberControl(
    control: PurifierSpeedControl | PurifierDeviceControl,
    speed = false,
  ) {
    const entity = this.hass.states[control.entity_id];
    const bounds = numberBounds(entity);
    const mode =
      speed && 'preset_mode' in control ? control.preset_mode : undefined;
    const label =
      control.name || entity?.attributes.friendly_name || control.entity_id;
    const unit = entity?.attributes.unit_of_measurement ?? '';
    const disabled =
      !this.available ||
      this.pending ||
      !entity ||
      ['unavailable', 'unknown'].includes(entity.state) ||
      !bounds;
    return html`<div class="number-control">
      <label
        ><span>${label}${unit ? ` (${unit})` : ''}</span
        ><input
          type="number"
          aria-label=${label}
          .value=${this.drafts[control.entity_id] ?? entity?.state ?? ''}
          min=${bounds?.min ?? ''}
          max=${bounds?.max ?? ''}
          step=${bounds?.step ?? 'any'}
          ?disabled=${disabled}
          @input=${(event: Event) => {
            this.drafts = {
              ...this.drafts,
              [control.entity_id]: (event.target as HTMLInputElement).value,
            };
          }}
      /></label>
      <button
        type="button"
        aria-label=${`${this.text('apply')} ${label}`}
        ?disabled=${disabled}
        @click=${(event: Event) => {
          const input = (event.currentTarget as HTMLElement)
            .closest('.number-control')
            ?.querySelector('input');
          if (!input?.value || !input.reportValidity()) return;
          const actions: PurifierAction[] = [];
          if (mode)
            actions.push({
              service:
                this.entity?.state === 'off'
                  ? 'fan.turn_on'
                  : 'fan.set_preset_mode',
              service_data: { preset_mode: mode },
              target: { entity_id: this.config.entity },
            });
          actions.push({
            service: 'number.set_value',
            service_data: { value: Number(input.value) },
            target: { entity_id: control.entity_id },
          });
          void this.execute(
            actions,
            label,
            `${speed ? 'speed' : 'setting'}-${control.entity_id}`,
          );
        }}
      >
        ${this.text('apply')}${mode ? ` · ${mode}` : ''}</button
      ><span class="control-reported"
        >${this.text('reported_target')}: ${entity?.state ?? '—'}
        ${unit}${!bounds ? ` · ${this.text('missing_bounds')}` : ''}</span
      >
    </div>`;
  }
  private renderDeviceControls() {
    if (
      !this.config.show_toolbar ||
      !this.controlsExpanded ||
      !this.hasDeviceControls()
    )
      return nothing;
    return html`<section
      class="device-controls"
      aria-label=${this.text('device_controls')}
    >
      ${this.config.speed_controls.filter((item) => typeof item.entity_id === 'string' && item.entity_id.startsWith('number.')).map((item) => this.renderNumberControl(item, true))}
      ${this.config.speed_controls.length ? html`<p class="control-help">${this.text('speed_help')}</p>` : nothing}
      ${this.config.device_controls
        .filter(
          (item) =>
            typeof item.entity_id === 'string' &&
            /^(switch|select|number)\./.test(item.entity_id),
        )
        .map((item) => {
          if (item.entity_id.startsWith('number.'))
            return this.renderNumberControl(item);
          const entity = this.hass.states[item.entity_id];
          const label =
            item.name || entity?.attributes.friendly_name || item.entity_id;
          const disabled =
            !this.available ||
            this.pending ||
            !entity ||
            ['unavailable', 'unknown'].includes(entity.state);
          const value = String(
            this.requestedValue(item.entity_id) ?? entity?.state ?? '',
          );
          if (item.entity_id.startsWith('select.'))
            return html`<label class="setting-row"
              ><span>${label}</span
              ><select
                aria-label=${label}
                .value=${live(value)}
                ?disabled=${disabled}
                @change=${(event: Event) => void this.execute([{ service: 'select.select_option', service_data: { option: (event.target as HTMLSelectElement).value }, target: { entity_id: item.entity_id } }], label, `setting-${item.entity_id}`)}
              >
                ${((entity?.attributes.options as string[]) ?? []).map((option) => html`<option .value=${option} .selected=${option === value}>${option}</option>`)}
              </select></label
            >`;
          return html`<label class="setting-row"
            ><span>${label}</span
            ><input
              type="checkbox"
              role="switch"
              aria-label=${label}
              .checked=${live(value === 'on')}
              ?disabled=${disabled}
              @change=${(event: Event) => void this.execute([{ service: (event.target as HTMLInputElement).checked ? 'switch.turn_on' : 'switch.turn_off', target: { entity_id: item.entity_id } }], label, `setting-${item.entity_id}`)}
          /></label>`;
        })}
    </section>`;
  }
  private renderCommandStatus() {
    const label = this.pending ? this.commandLabel : this.request?.label;
    if (!label) return nothing;
    const status = this.pending
      ? this.text('sending')
      : this.request?.expired
        ? this.text('unconfirmed')
        : this.text('waiting');
    return html`<div class="command-status" role="status">
      ${status}: ${label}
    </div>`;
  }

  private renderFilterWarning() {
    const status = filterStatus(this.hass.states, this.config);
    if (!status || status.level === 'healthy') return nothing;
    const label = localize(`filter.${status.level}`) ?? status.level;
    const remaining =
      status.value === undefined
        ? ''
        : `${status.value}${status.source.mode === 'remaining_percent' ? '%' : ' ' + (localize('filter.days') ?? 'days')} ${localize('filter.remaining') ?? 'remaining'}`;
    return html`<div
      class="filter-notice"
      data-level=${status.level}
      role="status"
    >
      <button
        type="button"
        @click=${() => this.moreInfo(status.source.entity_id)}
      >
        <ha-icon
          icon=${status.level === 'critical' ? 'mdi:air-filter' : status.level === 'unavailable' ? 'mdi:help-circle-outline' : 'mdi:alert-outline'}
          aria-hidden="true"
        ></ha-icon>
        <span>${label}${remaining ? ` · ${remaining}` : ''}</span>
        <ha-icon
          class="filter-details-icon"
          icon="mdi:chevron-right"
          aria-hidden="true"
        ></ha-icon>
      </button>
    </div>`;
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
        const paths = this.statTrend(stat);
        const inlineLabel = label?.replace(/^PM\s*(2\.5|10)$/i, 'PM$1');
        return html`<button
          type="button"
          class="stats-block"
          title=${`${label ?? ''}${paths.length ? ' · ' + (localize('common.last_hour') ?? 'Last hour') : ''}`}
          @click=${() => this.moreInfo(stat.entity_id)}
        >
          ${paths.length ? svg`<svg class="stat-trend" viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden="true" focusable="false">${paths.map((path) => svg`<path class="trend-area" d=${path.area}></path><path class="trend-line" d=${path.line} vector-effect="non-scaling-stroke"></path>`)}</svg>` : nothing}
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
            ${status ? html`<span class="state" role="status">${status}</span>` : nothing}
          </span>
        </button>
        ${this.renderSpeed()}
      </div>
      ${this.renderToolbar(disabled)} ${this.renderCommandStatus()}
      ${this.config.shutdown_timer?.entity_id ? html`<breeze-shutdown-timer .hass=${this.hass} .config=${this.config.shutdown_timer} .fan=${this.config.entity} .expanded=${this.controlsExpanded} .showControls=${this.config.show_toolbar}></breeze-shutdown-timer>` : nothing}
      ${this.renderDeviceControls()}
      ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
      ${this.renderFilterWarning()} ${this.renderStats()}
    </ha-card>`;
  }
}

// Keep existing dashboards working without registering one constructor twice.
@customElement('xiaomi-purifier-card')
export class LegacyPurifierCard extends PurifierCard {
  public static override async getConfigElement() {
    await import('./editor');
    return document.createElement('xiaomi-purifier-card-editor');
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
  type: 'breeze-purifier-card',
  name: 'Breeze Purifier Card',
  description:
    'Air purifier controls with configurable sensors, modes, and speed shortcuts.',
});
