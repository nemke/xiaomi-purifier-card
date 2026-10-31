import { LitElement, html, type CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import type { PurifierCardConfig } from './types';
import localize from './localize';
import styles from './editor.css';

@customElement('xiaomi-purifier-card-editor')
export class PurifierCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private config: Partial<PurifierCardConfig> = {};
  public setConfig(config: Partial<PurifierCardConfig>) {
    this.config = { ...config };
  }
  private change(key: keyof PurifierCardConfig, value: string | boolean) {
    this.config = { ...this.config, [key]: value };
    fireEvent(this, 'config-changed', { config: this.config });
  }
  protected render() {
    return html`<div class="card-config">
      <label
        >Entity<select
          aria-label="Entity"
          .value=${this.config.entity ?? ''}
          @change=${(event: Event) => this.change('entity', (event.target as HTMLSelectElement).value)}
        >
          <option value="" disabled>Select a fan</option>
          ${Object.keys(this.hass?.states ?? {})
            .filter((id) => id.startsWith('fan.'))
            .map(
              (id) =>
                html`<option
                  .value=${id}
                  ?selected=${this.config.entity === id}
                >
                  ${id}
                </option>`,
            )}
        </select></label
      >
      ${(['compact_view', 'show_name', 'show_state', 'show_toolbar', 'show_preset_mode'] as const).map((key) => html`<label class="option"><input type="checkbox" .checked=${this.config[key] ?? key !== 'compact_view'} @change=${(event: Event) => this.change(key, (event.target as HTMLInputElement).checked)} />${localize(`editor.${key}`) ?? key}</label>`)}
      <p>
        ${localize('editor.code_only_note') ?? 'Configure sensors and shortcuts in YAML.'}
      </p>
    </div>`;
  }
  public static get styles(): CSSResultGroup {
    return styles;
  }
}
