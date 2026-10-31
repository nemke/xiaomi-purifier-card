import { LitElement, html, nothing, type CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import type { PurifierCardConfig, PurifierCardStat } from './types';
import localize from './localize';
import styles from './editor.css';
import {
  detectReadings,
  mergeReadings,
  type RegistryEntity,
} from './discovery';

@customElement('xiaomi-purifier-card-editor')
export class PurifierCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private config: Partial<PurifierCardConfig> = {};
  @state() private detecting = false;
  @state() private detectionStatus = '';
  private registryPromise?: Promise<RegistryEntity[]>;
  private lastDetectedFan?: string;
  private autoFan?: string;
  private autoReading?: string;
  private autoStats = new Set<string>();
  private typingSections = new Set<string>();
  private manualSections = new Set<string>();
  public setConfig(config: Partial<PurifierCardConfig>) {
    this.config = { ...config };
  }
  private text(key: string) {
    return localize(`editor.${key}`) ?? key;
  }
  private change(key: keyof PurifierCardConfig, value: unknown) {
    this.typingSections.delete(key);
    this.manualSections.add(key);
    this.config = { ...this.config, [key]: value };
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
    this.autoReading = undefined;
    this.autoStats.clear();
    this.typingSections.clear();
    this.manualSections.clear();
    this.config = config;
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
        this.config = next;
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
    return html`<fieldset class="stat-editor">
      <legend>${this.text('statistic')} ${number}</legend>
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
      <div class="fields">
        <label class="field"
          ><span>${this.text('stat_label')}</span
          ><input
            type="text"
            aria-label=${`${this.text('stat_label')} ${number}`}
            .value=${stat.subtitle ?? ''}
            @input=${() => this.typingSections.add('stats')}
            @change=${(event: Event) => this.changeStat(index, { subtitle: (event.target as HTMLInputElement).value })}
        /></label>
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
      </div>
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
    </fieldset>`;
  }
  protected render() {
    const sources = Object.keys(this.hass?.states ?? {})
      .filter((id) => /^(sensor|number)\./.test(id))
      .sort((a, b) =>
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
      <details open>
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
        ${(this.config.stats ?? []).map((stat, index) => this.renderStat(stat, index))}
        <button
          type="button"
          class="add"
          @click=${() => this.change('stats', [...(this.config.stats ?? []), {}])}
        >
          ${this.text('add_stat')}
        </button>
      </details>
      <details>
        <summary>${this.text('appearance')}</summary>
        ${(['compact_view', 'show_name', 'show_state', 'show_toolbar', 'show_preset_mode'] as const).map((key) => html`<label class="option"><input type="checkbox" .checked=${this.config[key] ?? key !== 'compact_view'} @change=${(event: Event) => this.change(key, (event.target as HTMLInputElement).checked)} />${this.text(key)}</label>`)}
      </details>
      <p class="hint">${this.text('shortcuts_yaml')}</p>
      <datalist id="reading-entities">
        ${sources.map((id) => html`<option .value=${id} label=${this.hass?.states[id]?.attributes.friendly_name ?? id}></option>`)}
      </datalist>
    </div>`;
  }
  public static get styles(): CSSResultGroup {
    return styles;
  }
}
