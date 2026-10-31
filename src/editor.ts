import { LitElement, html, nothing, type CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import type { PurifierCardConfig, PurifierCardStat } from './types';
import localize from './localize';
import styles from './editor.css';

@customElement('xiaomi-purifier-card-editor')
export class PurifierCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private config: Partial<PurifierCardConfig> = {};
  public setConfig(config: Partial<PurifierCardConfig>) {
    this.config = { ...config };
  }
  private text(key: string) {
    return localize(`editor.${key}`) ?? key;
  }
  private change(key: keyof PurifierCardConfig, value: unknown) {
    this.config = { ...this.config, [key]: value };
    fireEvent(this, 'config-changed', { config: this.config });
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
            @change=${(event: Event) => this.changeStat(index, { subtitle: (event.target as HTMLInputElement).value })}
        /></label>
        <label class="field"
          ><span>${this.text('stat_unit')}</span
          ><input
            type="text"
            aria-label=${`${this.text('stat_unit')} ${number}`}
            .value=${stat.unit ?? ''}
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
          @change=${(event: Event) => this.change('entity', (event.target as HTMLSelectElement).value)}
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
      <details open>
        <summary>${this.text('main_reading')}</summary>
        <label class="field"
          ><span>${this.text('reading_entity')}</span
          ><input
            type="text"
            list="reading-entities"
            aria-label=${this.text('reading_entity')}
            .value=${this.config.aqi?.entity_id ?? ''}
            placeholder=${this.config.aqi?.attribute ? `${this.text('fan_attribute')}: ${this.config.aqi.attribute}` : this.text('reading_placeholder')}
            @change=${(event: Event) => this.sourceInput(event, (id) => this.changeReading(id))}
        /></label>
        <label class="field"
          ><span>${this.text('reading_unit')}</span
          ><input
            type="text"
            aria-label=${this.text('reading_unit')}
            .value=${this.config.aqi?.unit ?? ''}
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
