import { LitElement, html, nothing, type CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
import { EditorRows } from './editor-rows';
import { readValue, shortcutActions } from './model';
import { detectControls } from './controls';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import type {
  PurifierCardConfig,
  PurifierCardStat,
  PurifierCardShortcut,
} from './types';
import localize from './localize';
import styles from './editor.css';
import {
  detectReadings,
  mergeReadings,
  statisticIcon,
  type RegistryEntity,
} from './discovery';

@customElement('xiaomi-purifier-card-editor')
export class PurifierCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private config: Partial<PurifierCardConfig> = {};
  @state() private detecting = false;
  @state() private detectionStatus = '';
  @state() private registry: RegistryEntity[] = [];
  private statRows = new EditorRows();
  private openStats = new Set<string>();
  private shortcutRows = new EditorRows();
  private openShortcuts = new Set<string>();
  private autoControls = new Map<string, Set<string>>();
  private registryPromise?: Promise<RegistryEntity[]>;
  private lastDetectedFan?: string;
  private autoFan?: string;
  private autoReading?: string;
  private autoStats = new Set<string>();
  private typingSections = new Set<string>();
  private manualSections = new Set<string>();
  public setConfig(config: Partial<PurifierCardConfig>) {
    this.applyConfig({ ...config });
  }
  private applyConfig(config: Partial<PurifierCardConfig>) {
    if (config.entity !== this.config.entity) this.openStats.clear();
    this.statRows.sync(this.config.stats ?? [], config.stats ?? [], (stat) =>
      stat.entity_id || stat.attribute
        ? `${stat.entity_id ?? ''}|${stat.attribute ?? ''}`
        : '',
    );
    this.shortcutRows.sync(
      this.config.shortcuts ?? [],
      config.shortcuts ?? [],
      (row) => `${row.preset_mode ?? row.speed ?? ''}|${row.service ?? ''}`,
    );
    this.config = config;
  }
  private text(key: string) {
    return localize(`editor.${key}`) ?? key;
  }
  private change(key: keyof PurifierCardConfig, value: unknown) {
    this.typingSections.delete(key);
    this.manualSections.add(key);
    const previous = this.statRows.keys;
    const previousShortcuts = this.config.shortcuts?.length ?? 0;
    this.applyConfig({ ...this.config, [key]: value });
    if (key === 'shortcuts') {
      if ((value as unknown[])?.length > previousShortcuts)
        this.openShortcuts.add(
          this.shortcutRows.keys[this.shortcutRows.keys.length - 1],
        );
    }
    if (key === 'stats')
      for (const id of this.statRows.keys)
        if (!previous.includes(id)) this.openStats.add(id);
    fireEvent(this, 'config-changed', { config: this.config });
  }
  protected updated() {
    if (
      this.hass &&
      this.config.entity &&
      !this.detecting &&
      this.lastDetectedFan !== this.config.entity
    ) {
      void this.detectSensors(false);
    }
  }
  private chooseFan(entity: string) {
    const config = { ...this.config, entity };
    if (this.autoFan === this.config.entity) {
      if (this.autoReading === JSON.stringify(config.aqi)) delete config.aqi;
      if (this.autoStats.size) {
        const kept = config.stats?.filter(
          (stat) => !this.autoStats.has(JSON.stringify(stat)),
        );
        if (kept?.length) config.stats = kept;
        else delete config.stats;
      }
    }
    for (const field of ['speed_controls', 'device_controls'] as const) {
      if (this.autoFan === this.config.entity) {
        const kept = config[field]?.filter(
          (item) => !this.autoControls.get(field)?.has(JSON.stringify(item)),
        );
        if (kept?.length) config[field] = kept;
        else delete config[field];
      }
    }
    this.autoControls.clear();
    this.openShortcuts.clear();
    this.autoReading = undefined;
    this.autoStats.clear();
    this.typingSections.clear();
    this.manualSections.clear();
    this.applyConfig(config);
    fireEvent(this, 'config-changed', { config });
  }
  private loadRegistry(): Promise<RegistryEntity[]> {
    if (!this.registryPromise) {
      this.registryPromise = (async () => {
        if (typeof this.hass?.callWS !== 'function') return [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            this.hass.callWS<RegistryEntity[]>({
              type: 'config/entity_registry/list',
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Registry lookup timed out')),
                10000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      })();
    }
    return this.registryPromise;
  }
  private async detectSensors(append: boolean) {
    if (!this.hass || !this.config.entity || this.detecting) return;
    const fan = this.config.entity;
    this.lastDetectedFan = fan;
    this.detecting = true;
    this.detectionStatus = '';
    if (append) this.registryPromise = undefined;
    let registry: RegistryEntity[] = [];
    let failed = false;
    try {
      try {
        registry = await this.loadRegistry();
      } catch {
        failed = true;
        this.registryPromise = undefined;
      }
      if (!this.isConnected || this.config.entity !== fan) return;
      this.registry = registry;
      const detected = detectReadings(this.hass.states, registry, fan, {
        pm25: 'PM 2.5',
        pm10: 'PM 10',
        temperature: this.text('temperature'),
        humidity: this.text('humidity'),
        filter: this.text('filter_remaining'),
      });
      const protectedSections = new Set(this.typingSections);
      if (!append) {
        for (const section of this.manualSections)
          protectedSections.add(section);
        if (this.config.aqi !== undefined) protectedSections.add('aqi');
      }
      const next = mergeReadings(
        this.config,
        detected,
        this.hass.states,
        registry,
        append,
        protectedSections,
      );
      const controls = detectControls(this.hass.states, registry, fan);
      for (const field of ['speed_controls', 'device_controls'] as const) {
        if (
          protectedSections.has(field) ||
          (!append && this.config[field] !== undefined)
        )
          continue;
        const current = [...(this.config[field] ?? [])];
        const auto = this.autoControls.get(field) ?? new Set<string>();
        for (const suggestion of controls[field])
          if (
            !current.some((item) => item.entity_id === suggestion.entity_id)
          ) {
            current.push(suggestion);
            auto.add(JSON.stringify(suggestion));
          }
        next[field] = current;
        this.autoControls.set(field, auto);
      }
      if (
        next.aqi &&
        JSON.stringify(next.aqi) !== JSON.stringify(this.config.aqi)
      )
        this.autoReading = JSON.stringify(next.aqi);
      const existing = new Set(
        this.config.stats?.map((stat) => JSON.stringify(stat)),
      );
      for (const stat of next.stats ?? []) {
        if (!existing.has(JSON.stringify(stat)))
          this.autoStats.add(JSON.stringify(stat));
      }
      this.autoFan = fan;
      if (JSON.stringify(next) !== JSON.stringify(this.config)) {
        this.applyConfig(next);
        fireEvent(this, 'config-changed', { config: next });
      }
      this.detectionStatus = this.text(
        failed
          ? 'detection_failed'
          : !detected.deviceLinked
            ? 'detection_unlinked'
            : detected.main || detected.stats.length
              ? 'detection_complete'
              : 'detection_none',
      );
    } finally {
      this.detecting = false;
    }
  }
  private sourceInput(event: Event, apply: (id: string) => void) {
    const input = event.target as HTMLInputElement;
    const id = input.value.trim();
    input.setCustomValidity(
      id && !/^[a-z_]+\.[a-z0-9_]+$/.test(id) ? this.text('valid_entity') : '',
    );
    if (!input.reportValidity()) return;
    apply(id);
  }
  private changeReading(id: string) {
    if (!id) {
      this.change('aqi', {});
      return;
    }
    const source = { ...this.config.aqi, entity_id: id };
    const previousUnit =
      this.hass?.states[this.config.aqi?.entity_id ?? '']?.attributes
        .unit_of_measurement;
    if (
      !source.unit ||
      source.unit === previousUnit ||
      this.autoReading === JSON.stringify(this.config.aqi)
    )
      source.unit = this.hass?.states[id]?.attributes.unit_of_measurement;
    delete source.attribute;
    this.change('aqi', source);
  }
  private changeStat(index: number, patch: Partial<PurifierCardStat>) {
    this.change(
      'stats',
      (this.config.stats ?? []).map((stat, i) =>
        i === index ? { ...stat, ...patch } : stat,
      ),
    );
  }
  private changeStatSource(index: number, id: string) {
    const stat = { ...this.config.stats?.[index], entity_id: id || undefined };
    const attributes = this.hass?.states[id]?.attributes;
    const previousAttributes =
      this.hass?.states[this.config.stats?.[index]?.entity_id ?? '']
        ?.attributes;
    if (!stat.subtitle || stat.subtitle === previousAttributes?.friendly_name)
      stat.subtitle = attributes?.friendly_name ?? id;
    if (!stat.unit || stat.unit === previousAttributes?.unit_of_measurement)
      stat.unit = attributes?.unit_of_measurement;
    delete stat.attribute;
    this.change(
      'stats',
      (this.config.stats ?? []).map((item, i) => (i === index ? stat : item)),
    );
  }
  private moveStat(index: number, offset: number) {
    const stats = [...(this.config.stats ?? [])];
    [stats[index], stats[index + offset]] = [
      stats[index + offset],
      stats[index],
    ];
    this.change('stats', stats);
  }
  private renderStat(stat: PurifierCardStat, index: number) {
    // Text fields commit on change. Normal bindings preserve in-progress typing
    // when HA refreshes hass or echoes an unchanged configuration.
    const number = index + 1;
    const key = this.statRows.keys[index];
    const states = this.hass?.states ?? {};
    const icon = statisticIcon(states, stat);
    const label =
      stat.subtitle ||
      states[stat.entity_id ?? '']?.attributes.friendly_name ||
      stat.attribute ||
      this.text('new_stat');
    const raw = readValue(states, stat, this.config.entity ?? '');
    const unit =
      stat.unit ??
      states[stat.entity_id ?? '']?.attributes.unit_of_measurement ??
      '';
    const preview = stat.value_template
      ? this.text('template_preview')
      : raw === undefined || raw === null || raw === ''
        ? '—'
        : `${raw} ${unit}`;
    return html`<details
      class="stat-editor"
      .open=${this.openStats.has(key)}
      @toggle=${(event: Event) => {
        if ((event.currentTarget as HTMLDetailsElement).open)
          this.openStats.add(key);
        else this.openStats.delete(key);
      }}
    >
      <summary aria-label=${`${this.text('edit_stat')} ${number}`}>
        ${icon ? html`<ha-icon .icon=${icon} aria-hidden="true"></ha-icon>` : nothing}
        <span class="summary-label">${label}</span
        ><span class="summary-value">${preview}</span>
      </summary>
      <div class="stat-fields">
        <label class="field"
          ><span>${this.text('stat_entity')}</span
          ><input
            type="text"
            list="reading-entities"
            aria-label=${`${this.text('stat_entity')} ${number}`}
            .value=${stat.entity_id ?? ''}
            @input=${() => this.typingSections.add('stats')}
            placeholder=${stat.attribute ? `${this.text('fan_attribute')}: ${stat.attribute}` : 'sensor.example'}
            @change=${(event: Event) => this.sourceInput(event, (id) => this.changeStatSource(index, id))}
        /></label>
        <div>
          <label class="field"
            ><span>${this.text('stat_label')}</span
            ><input
              type="text"
              aria-label=${`${this.text('stat_label')} ${number}`}
              .value=${stat.subtitle ?? ''}
              @input=${() => this.typingSections.add('stats')}
              @change=${(event: Event) => this.changeStat(index, { subtitle: (event.target as HTMLInputElement).value })}
          /></label>
        </div>
        <details class="stat-options">
          <summary>${this.text('stat_options')}</summary>
          <label class="field"
            ><span>${this.text('stat_unit')}</span
            ><input
              type="text"
              aria-label=${`${this.text('stat_unit')} ${number}`}
              .value=${stat.unit ?? ''}
              @input=${() => this.typingSections.add('stats')}
              placeholder=${this.hass?.states[stat.entity_id ?? '']?.attributes.unit_of_measurement ?? ''}
              @change=${(event: Event) => this.changeStat(index, { unit: (event.target as HTMLInputElement).value })}
          /></label>
          <label class="field"
            ><span>${this.text('stat_icon')}</span
            ><input
              type="text"
              aria-label=${`${this.text('stat_icon')} ${number}`}
              .value=${stat.icon ?? ''}
              ?disabled=${stat.icon === ''}
              placeholder=${this.hass ? (statisticIcon(this.hass.states, { ...stat, icon: undefined }) ?? this.text('automatic_text')) : ''}
              @input=${() => this.typingSections.add('stats')}
              @change=${(event: Event) => this.changeStat(index, { icon: (event.target as HTMLInputElement).value.trim() || undefined })}
          /></label>
          <label class="option"
            ><input
              type="checkbox"
              aria-label=${`${this.text('stat_text')} ${number}`}
              .checked=${stat.icon === ''}
              @change=${(event: Event) => this.changeStat(index, { icon: (event.target as HTMLInputElement).checked ? '' : undefined })}
            />${this.text('stat_text')}</label
          >
        </details>
        ${stat.value_template || stat.attribute ? html`<p class="hint">${this.text('advanced_preserved')}</p>` : nothing}
        <div class="row-actions">
          <button
            type="button"
            ?disabled=${index === 0}
            aria-label=${`${this.text('move_up')} ${number}`}
            @click=${() => this.moveStat(index, -1)}
          >
            ↑</button
          ><button
            type="button"
            ?disabled=${index === (this.config.stats?.length ?? 0) - 1}
            aria-label=${`${this.text('move_down')} ${number}`}
            @click=${() => this.moveStat(index, 1)}
          >
            ↓</button
          ><button
            type="button"
            class="remove"
            aria-label=${`${this.text('remove_stat')} ${number}`}
            @click=${() =>
              this.change(
                'stats',
                this.config.stats?.filter((_, i) => i !== index),
              )}
          >
            ${this.text('remove')}
          </button>
        </div>
      </div>
    </details>`;
  }
  private modes() {
    return (this.hass?.states[this.config.entity ?? '']?.attributes
      .preset_modes ?? []) as string[];
  }
  private visibleModes() {
    return (this.config.preset_modes ?? this.modes())
      .map((mode) =>
        this.modes().find((item) => item.toLowerCase() === mode.toLowerCase()),
      )
      .filter((mode): mode is string => !!mode);
  }
  private changeShortcut(index: number, patch: Partial<PurifierCardShortcut>) {
    this.change(
      'shortcuts',
      (this.config.shortcuts ?? []).map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    );
  }
  private renderShortcut(shortcut: PurifierCardShortcut, index: number) {
    const number = index + 1;
    const key = this.shortcutRows.keys[index];
    const target =
      shortcut.target?.entity_id ?? shortcut.service_data?.entity_id;
    const complexTarget =
      shortcut.target &&
      (typeof shortcut.target.entity_id !== 'string' ||
        Object.keys(shortcut.target).some((key) => key !== 'entity_id'));
    const kind =
      shortcut.actions ||
      (shortcut.service && shortcut.service !== 'number.set_value') ||
      (shortcut.service && shortcut.percentage !== undefined) ||
      Array.isArray(target) ||
      complexTarget
        ? 'custom'
        : shortcut.service === 'number.set_value'
          ? 'number'
          : shortcut.percentage !== undefined
            ? 'percentage'
            : 'preset';
    const numbers = Object.keys(this.hass?.states ?? {}).filter((id) =>
      id.startsWith('number.'),
    );
    const numberEntity =
      this.hass?.states[typeof target === 'string' ? target : ''];
    const field = (
      label: string,
      value: string,
      apply: (value: string) => void,
      placeholder = '',
    ) =>
      html`<label class="field"
        ><span>${this.text(label)}</span
        ><input
          type="text"
          aria-label=${`${this.text(label)} ${number}`}
          .value=${value}
          placeholder=${placeholder}
          @input=${() => this.typingSections.add('shortcuts')}
          @change=${(event: Event) => apply((event.target as HTMLInputElement).value)}
      /></label>`;
    return html`<details
      class="shortcut-editor"
      .open=${this.openShortcuts.has(key)}
      @toggle=${(event: Event) => {
        if ((event.currentTarget as HTMLDetailsElement).open)
          this.openShortcuts.add(key);
        else this.openShortcuts.delete(key);
      }}
    >
      <summary aria-label=${`${this.text('edit_shortcut')} ${number}`}>
        <span class="summary-label"
          >${shortcut.name || shortcut.preset_mode || shortcut.speed || shortcut.service || this.text('new_shortcut')}</span
        >
      </summary>
      <div class="stat-fields">
        <div class="fields">
          ${field('shortcut_name', shortcut.name ?? '', (name) => this.changeShortcut(index, { name }))}${field('shortcut_icon', shortcut.icon ?? '', (icon) => this.changeShortcut(index, { icon }))}
        </div>
        <label class="field"
          ><span>${this.text('shortcut_kind')}</span
          ><select
            aria-label=${`${this.text('shortcut_kind')} ${number}`}
            .value=${live(kind)}
            @change=${(event: Event) => {
              const kind = (event.target as HTMLSelectElement).value;
              const next = { ...shortcut };
              delete next.actions;
              delete next.service;
              delete next.service_data;
              delete next.target;
              delete next.percentage;
              if (kind === 'number') {
                next.service = 'number.set_value';
                next.service_data = {};
              }
              if (kind === 'percentage') next.percentage = 50;
              if (kind === 'custom')
                next.actions = shortcutActions(
                  shortcut,
                  this.config.entity ?? '',
                );
              this.change(
                'shortcuts',
                this.config.shortcuts?.map((item, i) =>
                  i === index ? next : item,
                ),
              );
            }}
          >
            ${['preset', 'number', 'percentage', 'custom'].map((value) => html`<option .value=${value} .selected=${value === kind}>${this.text('action_' + value)}</option>`)}
          </select></label
        >
        ${
          kind !== 'custom'
            ? html`<label class="field"
                ><span>${this.text('shortcut_mode')}</span
                ><select
                  aria-label=${`${this.text('shortcut_mode')} ${number}`}
                  .value=${live(shortcut.preset_mode ?? shortcut.speed ?? '')}
                  @change=${(event: Event) => this.changeShortcut(index, { preset_mode: (event.target as HTMLSelectElement).value || undefined, speed: undefined })}
                >
                  <option value="">${this.text('unchanged_mode')}</option>
                  ${this.modes().map((mode) => html`<option .value=${mode} .selected=${mode === (shortcut.preset_mode ?? shortcut.speed ?? '')}>${mode}</option>`)}
                </select></label
              >`
            : nothing
        }
        ${
          kind === 'number'
            ? html`<label class="field"
                ><span>${this.text('shortcut_target')}</span
                ><select
                  aria-label=${`${this.text('shortcut_target')} ${number}`}
                  .value=${live(typeof target === 'string' ? target : '')}
                  @change=${(event: Event) => {
                    const data = { ...shortcut.service_data };
                    delete data.entity_id;
                    this.changeShortcut(index, {
                      target: {
                        entity_id: (event.target as HTMLSelectElement).value,
                      },
                      service_data: data,
                    });
                  }}
                >
                  <option value="">${this.text('choose_number')}</option>
                  ${numbers.map((id) => html`<option .value=${id} .selected=${id === target}>${this.hass?.states[id].attributes.friendly_name ?? id}</option>`)}
                </select></label
              >`
            : nothing
        }
        ${
          kind === 'number' || kind === 'percentage'
            ? html`<label class="field"
                ><span>${this.text('shortcut_value')}</span
                ><input
                  type="number"
                  aria-label=${`${this.text('shortcut_value')} ${number}`}
                  .value=${String(kind === 'percentage' ? (shortcut.percentage ?? '') : (shortcut.service_data?.value ?? ''))}
                  min=${kind === 'percentage' ? 0 : (numberEntity?.attributes.min ?? '')}
                  max=${kind === 'percentage' ? 100 : (numberEntity?.attributes.max ?? '')}
                  step=${kind === 'percentage' ? 1 : (numberEntity?.attributes.step ?? 'any')}
                  @input=${() => this.typingSections.add('shortcuts')}
                  @change=${(event: Event) => {
                    const input = event.target as HTMLInputElement;
                    if (!input.value || !input.reportValidity()) return;
                    this.changeShortcut(
                      index,
                      kind === 'percentage'
                        ? { percentage: Number(input.value) }
                        : {
                            service_data: {
                              ...shortcut.service_data,
                              value: Number(input.value),
                            },
                          },
                    );
                  }}
              /></label>`
            : nothing
        }
        ${
          kind === 'custom'
            ? html`<label class="field"
                  ><span>${this.text('shortcut_actions')}</span
                  ><textarea
                    aria-label=${`${this.text('shortcut_actions')} ${number}`}
                    .value=${JSON.stringify(shortcutActions(shortcut, this.config.entity ?? ''), null, 2)}
                    @input=${() => this.typingSections.add('shortcuts')}
                    @change=${(event: Event) => {
                      const input = event.target as HTMLTextAreaElement;
                      try {
                        const actions = JSON.parse(input.value);
                        if (
                          !Array.isArray(actions) ||
                          actions.some(
                            (item) => !item || typeof item.service !== 'string',
                          )
                        )
                          throw new Error('invalid');
                        input.setCustomValidity('');
                        this.changeShortcut(index, { actions });
                      } catch {
                        input.setCustomValidity(this.text('invalid_actions'));
                        input.reportValidity();
                      }
                    }}
                  ></textarea>
                </label>
                <p class="hint">${this.text('custom_actions_help')}</p>
                ${field('active_entity', shortcut.state_entity ?? '', (value) => this.changeShortcut(index, { state_entity: value.trim() || undefined }), 'switch.example')}${field('active_state', String(shortcut.state ?? ''), (value) => this.changeShortcut(index, { state: value || undefined }))}`
            : nothing
        }
        <div class="row-actions">
          <button
            type="button"
            aria-label=${`${this.text('move_shortcut_up')} ${number}`}
            ?disabled=${index === 0}
            @click=${() => this.moveShortcut(index, -1)}
          >
            ↑</button
          ><button
            type="button"
            aria-label=${`${this.text('move_shortcut_down')} ${number}`}
            ?disabled=${index === (this.config.shortcuts?.length ?? 0) - 1}
            @click=${() => this.moveShortcut(index, 1)}
          >
            ↓</button
          ><button
            type="button"
            class="remove"
            aria-label=${`${this.text('remove_shortcut')} ${number}`}
            @click=${() =>
              this.change(
                'shortcuts',
                this.config.shortcuts?.filter((_, i) => i !== index),
              )}
          >
            ${this.text('remove')}
          </button>
        </div>
      </div>
    </details>`;
  }
  private moveShortcut(index: number, offset: number) {
    const items = [...(this.config.shortcuts ?? [])];
    [items[index], items[index + offset]] = [
      items[index + offset],
      items[index],
    ];
    this.change('shortcuts', items);
  }
  private renderModes() {
    const visible = this.visibleModes();
    const modes = [
      ...visible,
      ...this.modes().filter((mode) => !visible.includes(mode)),
    ];
    return html`<details class="modes-editor">
      <summary>${this.text('modes_shortcuts')}</summary>
      <label class="field"
        ><span>${this.text('toolbar_style')}</span
        ><select
          aria-label=${this.text('toolbar_style')}
          .value=${live(this.config.toolbar_style ?? 'auto')}
          @change=${(event: Event) => this.change('toolbar_style', (event.target as HTMLSelectElement).value)}
        >
          ${['auto', 'buttons', 'dropdown'].map((value) => html`<option .value=${value} .selected=${value === (this.config.toolbar_style ?? 'auto')}>${this.text('style_' + value)}</option>`)}
        </select></label
      >
      <p class="hint">${this.text('toolbar_style_help')}</p>
      <p>${this.text('visible_modes')}</p>
      ${modes.map((mode) => {
        const index = visible.indexOf(mode);
        return html`<div class="mode-row">
          <label class="option"
            ><input
              type="checkbox"
              aria-label=${`${this.text('show_mode')} ${mode}`}
              .checked=${index >= 0}
              @change=${(event: Event) => this.change('preset_modes', (event.target as HTMLInputElement).checked ? [...visible, mode] : visible.filter((value) => value !== mode))}
            />${mode}</label
          ><button
            type="button"
            aria-label=${`${this.text('move_mode_up')} ${mode}`}
            ?disabled=${index <= 0}
            @click=${() => {
              const next = [...visible];
              [next[index], next[index - 1]] = [next[index - 1], next[index]];
              this.change('preset_modes', next);
            }}
          >
            ↑</button
          ><button
            type="button"
            aria-label=${`${this.text('move_mode_down')} ${mode}`}
            ?disabled=${index < 0 || index === visible.length - 1}
            @click=${() => {
              const next = [...visible];
              [next[index], next[index + 1]] = [next[index + 1], next[index]];
              this.change('preset_modes', next);
            }}
          >
            ↓
          </button>
        </div>`;
      })}
      <button
        type="button"
        @click=${() => this.change('preset_modes', undefined)}
      >
        ${this.text('automatic_modes')}
      </button>
      ${repeat(
        this.config.shortcuts ?? [],
        (_, index) => this.shortcutRows.keys[index],
        (item, index) => this.renderShortcut(item, index),
      )}
      <button
        type="button"
        class="add"
        @click=${() => this.change('shortcuts', [...(this.config.shortcuts ?? []), {}])}
      >
        ${this.text('add_shortcut')}
      </button>
    </details>`;
  }
  private renderControlRows(field: 'speed_controls' | 'device_controls') {
    const items = this.config[field] ?? [];
    return items.map((item, index) => {
      const modeValue = 'preset_mode' in item ? item.preset_mode : undefined;
      const number = index + 1;
      const sourceLabel = this.text(
        field === 'speed_controls' ? 'speed_entity' : 'setting_entity',
      );
      const patch = (value: Record<string, unknown>) =>
        this.change(
          field,
          items.map((old, i) => (i === index ? { ...old, ...value } : old)),
        );
      return html`<fieldset class="control-editor">
        <legend>
          ${this.text(field === 'speed_controls' ? 'speed_control' : 'device_setting')}
          ${number}
        </legend>
        <label class="field"
          ><span>${sourceLabel}</span
          ><input
            type="text"
            list="control-entities"
            aria-label=${`${sourceLabel} ${number}`}
            .value=${item.entity_id ?? ''}
            @input=${() => this.typingSections.add(field)}
            @change=${(event: Event) =>
              this.sourceInput(event, (id) => {
                const valid =
                  !id ||
                  (field === 'speed_controls'
                    ? /^number\./
                    : /^(switch|number|select)\./
                  ).test(id);
                const input = event.target as HTMLInputElement;
                input.setCustomValidity(
                  valid ? '' : this.text('invalid_control'),
                );
                if (input.reportValidity()) patch({ entity_id: id });
              })}
        /></label>
        <label class="field"
          ><span>${this.text('control_name')}</span
          ><input
            type="text"
            aria-label=${`${this.text('control_name')} ${field === 'speed_controls' ? 'speed' : 'setting'} ${number}`}
            .value=${item.name ?? ''}
            placeholder=${this.hass?.states[item.entity_id]?.attributes.friendly_name ?? item.entity_id}
            @input=${() => this.typingSections.add(field)}
            @change=${(event: Event) => patch({ name: (event.target as HTMLInputElement).value || undefined })}
        /></label>
        ${
          field === 'speed_controls'
            ? html`<label class="field"
                ><span>${this.text('control_mode')}</span
                ><select
                  aria-label=${`${this.text('control_mode')} ${number}`}
                  .value=${live(modeValue ?? '')}
                  @change=${(event: Event) => patch({ preset_mode: (event.target as HTMLSelectElement).value || undefined })}
                >
                  <option value="">${this.text('unchanged_mode')}</option>
                  ${this.modes().map((mode) => html`<option .value=${mode} .selected=${mode === modeValue}>${mode}</option>`)}
                </select></label
              >`
            : nothing
        }
        <button
          type="button"
          aria-label=${`${this.text('remove_control')} ${field === 'speed_controls' ? 'speed' : 'setting'} ${number}`}
          @click=${() =>
            this.change(
              field,
              items.filter((_, i) => i !== index),
            )}
        >
          ${this.text('remove')}
        </button>
      </fieldset>`;
    });
  }
  private renderControlEditor() {
    return html`<details class="controls-editor">
      <summary>${this.text('device_controls')}</summary>
      <p class="hint">${this.text('control_help')}</p>
      ${this.renderControlRows('speed_controls')}
      <button
        type="button"
        class="add"
        @click=${() => this.change('speed_controls', [...(this.config.speed_controls ?? []), { entity_id: '' }])}
      >
        ${this.text('add_speed_control')}
      </button>
      ${this.renderControlRows('device_controls')}
      <button
        type="button"
        class="add"
        @click=${() => this.change('device_controls', [...(this.config.device_controls ?? []), { entity_id: '' }])}
      >
        ${this.text('add_device_setting')}
      </button>
    </details>`;
  }
  protected render() {
    const device = this.registry.find(
      (entry) => entry.entity_id === this.config.entity,
    )?.device_id;
    const related = new Set(
      this.registry
        .filter(
          (entry) => device && entry.device_id === device && !entry.disabled_by,
        )
        .map((entry) => entry.entity_id),
    );
    const sources = Object.keys(this.hass?.states ?? {})
      .filter((id) => /^(sensor|number)\./.test(id))
      .sort(
        (a, b) =>
          Number(related.has(b)) - Number(related.has(a)) ||
          (this.hass?.states[a]?.attributes.friendly_name ?? a).localeCompare(
            this.hass?.states[b]?.attributes.friendly_name ?? b,
          ),
      );
    return html`<div class="card-config">
      <label class="field"
        ><span>${this.text('entity')}</span
        ><select
          aria-label="Entity"
          .value=${live(this.config.entity ?? '')}
          @change=${(event: Event) => this.chooseFan((event.target as HTMLSelectElement).value)}
        >
          <option value="" disabled>${this.text('choose_fan')}</option>
          ${Object.keys(this.hass?.states ?? {})
            .filter((id) => id.startsWith('fan.'))
            .map(
              (id) =>
                html`<option
                  .value=${id}
                  ?selected=${this.config.entity === id}
                >
                  ${this.hass?.states[id]?.attributes.friendly_name ?? id}
                </option>`,
            )}
        </select></label
      >
      <label class="field"
        ><span>${this.text('display_name')}</span
        ><input
          type="text"
          aria-label=${this.text('display_name')}
          .value=${this.config.name ?? ''}
          placeholder=${this.hass?.states[this.config.entity ?? '']?.attributes.friendly_name ?? this.config.entity ?? ''}
          @input=${() => this.typingSections.add('name')}
          @change=${(event: Event) => this.change('name', (event.target as HTMLInputElement).value.trim() || undefined)}
      /></label>
      <p class="hint">${this.text('display_name_help')}</p>
      <div class="detection">
        <button
          type="button"
          ?disabled=${this.detecting || !this.config.entity}
          @click=${() => {
            void this.detectSensors(true);
          }}
        >
          ${this.text(this.detecting ? 'detecting_sensors' : 'detect_sensors')}
        </button>
        <p class="hint" role="status">
          ${this.detectionStatus || this.text('detection_help')}
        </p>
      </div>
      <details class="main-reading">
        <summary>${this.text('main_reading')}</summary>
        <label class="field"
          ><span>${this.text('reading_entity')}</span
          ><input
            type="text"
            list="reading-entities"
            aria-label=${this.text('reading_entity')}
            .value=${this.config.aqi?.entity_id ?? ''}
            @input=${() => this.typingSections.add('aqi')}
            placeholder=${this.config.aqi?.attribute ? `${this.text('fan_attribute')}: ${this.config.aqi.attribute}` : this.text('reading_placeholder')}
            @change=${(event: Event) => this.sourceInput(event, (id) => this.changeReading(id))}
        /></label>
        <label class="field"
          ><span>${this.text('reading_unit')}</span
          ><input
            type="text"
            aria-label=${this.text('reading_unit')}
            .value=${this.config.aqi?.unit ?? ''}
            @input=${() => this.typingSections.add('aqi')}
            placeholder=${this.hass?.states[this.config.aqi?.entity_id ?? '']?.attributes.unit_of_measurement ?? ''}
            @change=${(event: Event) => this.change('aqi', { ...this.config.aqi, unit: (event.target as HTMLInputElement).value })}
        /></label>
        <p class="hint">${this.text('reading_help')}</p>
      </details>
      <details open>
        <summary>${this.text('statistics')}</summary>
        ${repeat(
          this.config.stats ?? [],
          (_, index) => this.statRows.keys[index],
          (stat, index) => this.renderStat(stat, index),
        )}
        <p class="hint">${this.text('stat_icon_help')}</p>
        <button
          type="button"
          class="add"
          @click=${() => this.change('stats', [...(this.config.stats ?? []), {}])}
        >
          ${this.text('add_stat')}
        </button>
      </details>
      ${this.renderModes()} ${this.renderControlEditor()}
      <details>
        <summary>${this.text('appearance')}</summary>
        ${(['compact_view', 'show_name', 'show_state', 'show_toolbar', 'show_preset_mode'] as const).map((key) => html`<label class="option"><input type="checkbox" .checked=${this.config[key] ?? key !== 'compact_view'} @change=${(event: Event) => this.change(key, (event.target as HTMLInputElement).checked)} />${this.text(key)}</label>`)}
      </details>
      <p class="hint">${this.text('shortcuts_help')}</p>
      <datalist id="reading-entities">
        ${sources.map((id) => {
          const entity = this.hass?.states[id];
          return html`<option
            .value=${id}
            data-related=${String(related.has(id))}
            label=${`${related.has(id) ? this.text('related_source') + ' · ' : ''}${entity?.attributes.friendly_name ?? id} · ${entity?.state ?? '—'} ${entity?.attributes.unit_of_measurement ?? ''}`}
          ></option>`;
        })}
      </datalist>
      <datalist id="control-entities">
        ${Object.keys(this.hass?.states ?? {})
          .filter((id) => /^(number|switch|select)\./.test(id))
          .sort(
            (a, b) =>
              Number(related.has(b)) - Number(related.has(a)) ||
              a.localeCompare(b),
          )
          .map(
            (id) =>
              html`<option
                .value=${id}
                label=${`${related.has(id) ? this.text('related_source') + ' · ' : ''}${this.hass?.states[id].attributes.friendly_name ?? id}`}
              ></option>`,
          )}
      </datalist>
    </div>`;
  }
  public static get styles(): CSSResultGroup {
    return styles;
  }
}
