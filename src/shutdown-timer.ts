import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import type { PurifierShutdownTimer } from './types';
import { shutdownState, formatCountdown } from './timer';
import localize from './localize';
import styles from './timer.css';

@customElement('breeze-shutdown-timer')
export class ShutdownTimer extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config!: PurifierShutdownTimer;
  @property() public fan = '';
  @property({ type: Boolean }) public expanded = false;
  @property({ type: Boolean }) public showControls = true;
  @state() private now = Date.now();
  @state() private busy = false;
  @state() private waiting?: 'start' | 'cancel';
  @state() private error = '';
  @state() private minutes = '60';
  private ticker?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private previousFinish?: string;
  private context = '';
  protected override willUpdate() {
    const context = JSON.stringify([this.fan, this.config]);
    if (context !== this.context) {
      this.context = context;
      this.generation++;
      this.busy = false;
      this.waiting = undefined;
      this.error = '';
      clearTimeout(this.timeout);
    }
  }
  public static styles = styles;
  private text(key: string) {
    return localize(`timer.${key}`) ?? key;
  }
  public override disconnectedCallback() {
    this.generation++;
    clearInterval(this.ticker);
    clearTimeout(this.timeout);
    this.ticker = undefined;
    this.busy = false;
    this.waiting = undefined;
    super.disconnectedCallback();
  }
  protected override updated() {
    if (!this.hass || !this.config) return;
    const status = shutdownState(this.hass.states, this.config, this.now);
    const running = status.active || status.armed;
    if (running && !status.paused && !this.ticker) {
      this.now = Date.now();
      this.ticker = setInterval(() => {
        this.now = Date.now();
      }, 1000);
    } else if ((!running || status.paused) && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
    const finish =
      this.hass.states[this.config.entity_id ?? '']?.attributes.finishes_at;
    if (
      (this.waiting === 'start' &&
        status.ready &&
        status.active &&
        status.armed &&
        finish !== this.previousFinish) ||
      (this.waiting === 'cancel' &&
        !status.active &&
        !status.paused &&
        !status.armed)
    ) {
      this.waiting = undefined;
      clearTimeout(this.timeout);
    }
  }
  private async command(minutes?: number) {
    if (this.busy) return;
    const status = shutdownState(this.hass.states, this.config);
    const cancel = minutes === undefined;
    if (
      !cancel &&
      (!status.ready || this.hass.states[this.fan]?.state !== 'on')
    )
      return;
    if (cancel && !status.deadlineAvailable) return;
    const generation = this.generation;
    const config = { ...this.config };
    let current = true;
    const focus = this.shadowRoot?.activeElement as HTMLElement | null;
    this.busy = true;
    this.error = '';
    this.waiting = undefined;
    clearTimeout(this.timeout);
    this.previousFinish =
      this.hass.states[this.config.entity_id ?? '']?.attributes.finishes_at;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          if (cancel) {
            // Clear the persistent deadline even if the automation is disabled.
            await this.hass.callService(
              'input_text',
              'set_value',
              { value: '' },
              { entity_id: config.deadline_entity_id },
            );
            if (!current || generation !== this.generation || !this.isConnected)
              return;
            if (status.available)
              await this.hass.callService(
                'timer',
                'cancel',
                {},
                { entity_id: config.entity_id },
              );
          } else
            await this.hass.callService(
              'timer',
              'start',
              { duration: minutes * 60 },
              { entity_id: config.entity_id },
            );
        })(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(this.text('timeout'))),
            10000,
          );
        }),
      ]);
      if (!current || generation !== this.generation || !this.isConnected)
        return;
      this.waiting = cancel ? 'cancel' : 'start';
      this.timeout = setTimeout(() => {
        this.waiting = undefined;
        this.error = this.text('unconfirmed');
      }, 15000);
    } catch (error) {
      if (generation === this.generation)
        this.error = error instanceof Error ? error.message : String(error);
    } finally {
      current = false;
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.busy = false;
        await this.updateComplete;
        if (focus?.isConnected && document.activeElement === document.body)
          focus.focus({ preventScroll: true });
      }
    }
  }
  protected override render() {
    if (!this.hass || !this.config) return nothing;
    const status = shutdownState(this.hass.states, this.config, this.now);
    const startDisabled =
      this.busy || !status.ready || this.hass.states[this.fan]?.state !== 'on';
    const label = status.paused
      ? this.text('paused')
      : !status.ready || !status.armed
        ? this.text('not_armed')
        : status.waiting
          ? this.text('waiting_shutdown')
          : this.text('off_in');
    return html`${status.visible ? html`<div class="countdown"><ha-icon icon="mdi:timer-outline" aria-hidden="true"></ha-icon><span role="timer" aria-label=${this.text('title')}>${label}${!status.waiting ? ` ${formatCountdown(status.seconds)}` : ''}</span>${this.showControls ? html`<button type="button" ?disabled=${this.busy || !status.deadlineAvailable} @click=${() => void this.command()}>${this.text('cancel')}</button>` : nothing}</div>` : nothing}
    ${
      this.expanded && this.showControls
        ? html`<section aria-label=${this.text('title')}>
            <h3>${this.text('title')}</h3>
            <div class="durations">
              ${[30, 60, 120].map((minutes) => html`<button type="button" ?disabled=${startDisabled} @click=${() => void this.command(minutes)}>${minutes < 60 ? `${minutes} ${this.text('minutes')}` : `${minutes / 60} ${this.text('hours')}`}</button>`)}
            </div>
            <div class="custom">
              <label
                >${this.text('custom')}<input
                  type="number"
                  min="1"
                  max="1440"
                  step="1"
                  .value=${this.minutes}
                  @input=${(event: Event) => {
                    this.minutes = (event.target as HTMLInputElement).value;
                  }} /></label
              ><button
                type="button"
                ?disabled=${startDisabled}
                @click=${(event: Event) => {
                  const input = (
                    event.currentTarget as HTMLElement
                  ).parentElement?.querySelector('input');
                  if (input?.value && input.reportValidity())
                    void this.command(Number(input.value));
                }}
              >
                ${this.text(status.visible ? 'restart' : 'start')}
              </button>
            </div>
            <p>
              ${!status.ready ? this.text('setup_required') : this.hass.states[this.fan]?.state !== 'on' ? this.text('turn_on_first') : this.text('help')}
            </p>
            <button
              class="details"
              type="button"
              ?disabled=${!this.config.automation_entity_id}
              @click=${() => fireEvent(this, 'hass-more-info', { entityId: this.config.automation_entity_id }, { bubbles: true, composed: true })}
            >
              ${this.text('automation')}
            </button>
          </section>`
        : nothing
    }
    ${this.busy || this.waiting ? html`<p class="status" role="status">${this.text(this.busy ? 'sending' : 'confirming')}</p>` : nothing}
    ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}`;
  }
}
