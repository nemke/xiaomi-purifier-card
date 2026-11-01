# Breeze shutdown timer — v0.1.13

The optional timer offers 30 minutes, 1 hour, 2 hours, or a custom duration of 1–1440 minutes. Its compact countdown stays visible when the settings panel is closed. Cancel leaves the purifier running. The card only starts timers while the purifier is on; changing presets preserves the schedule.

HA runs the shutdown automation. Closing the browser stops only its local countdown display. The card never turns off a purifier from a browser timeout and adds no device/sensor polling.

## Previews

[Timer settings](previews/breeze-timer/settings.png) · [Phone countdown](previews/breeze-timer/countdown-phone.png) · [Disabled automation](previews/breeze-timer/disabled-automation-phone.png) · [Editor](previews/breeze-timer/editor.png)

Previews use simulated HA state and lightweight icon/card stand-ins.

## One-time setup

Use one timer, one deadline helper and one automation **per purifier**.

1. Create a **Timer** helper in Settings → Devices & services → Helpers, and enable **Restore**.
2. Create a **Text** helper for the persistent deadline. Keep its minimum length at 0 and maximum at least 32. Leave its initial value unset so HA restores it across restarts. The card and automation manage its value. A new helper may show unknown until the first timer starts.
3. Copy [the blueprint](../blueprints/breeze-shutdown.yaml) to `<config>/blueprints/automation/breeze/breeze-shutdown.yaml`. Create an automation from it, selecting this purifier, timer, and Text helper. Enable the automation.
4. In the Breeze card editor, expand **Shutdown timer** and select those three entities. The selected automation must be the one linked to this purifier and these helpers. Starts remain disabled when the resources are missing/unavailable or the automation is off.

For YAML-managed setups, [the package example](../examples/timer/package.yaml) defines the two helpers and automation. It assumes HA packages are enabled and the blueprint is installed at the path above. Merge this into your existing HA configuration; it is not a dashboard card.

The corresponding dashboard configuration is [here](../examples/timer/card.yaml):

```yaml
type: custom:breeze-purifier-card
entity: fan.zhimi_airp_vb4
shutdown_timer:
  entity_id: timer.living_room_purifier_shutdown
  automation_entity_id: automation.breeze_living_room_shutdown
  deadline_entity_id: input_text.living_room_purifier_deadline
```

Verify actual entity IDs in HA; an automation's entity ID may differ from its YAML `id`.

## Behavior

- Starting or restarting sends `timer.start` with a duration in seconds. The automation stores the timer's reported finish time as a persistent deadline. The card waits for reported state before showing an armed shutdown.
- Cancelling clears the persistent deadline before cancelling the helper timer, including when the automation is disabled. It sends no fan command. Failed or unconfirmed changes show an error; check the helper before retrying.
- Switching off the purifier cancels its schedule through the automation, including switches from outside the card. Preset changes keep it running.
- A timer paused externally shows its reported remaining time. Pausing disarms the deadline; resuming rearms it through the HA timer event. The card's first version offers start/restart/cancel, rather than additional pause controls.
- If the deadline passes while HA is offline, the automation reconciles it at startup, when the purifier becomes available, and once per minute. It turns off an on purifier and retains an expired deadline while the purifier is unavailable. Normal timer expiry uses the immediate finished event.
- At expiry the card shows **Waiting for shutdown** until HA reports completion. It never treats a locally elapsed countdown as proof of shutdown. A disabled automation or missing deadline shows **Shutdown not armed**.

The Text helper is necessary because [restored timers do not emit a finished event for an expiry during HA downtime](https://www.home-assistant.io/integrations/timer/). The helper [restores its state when no initial value overrides it](https://www.home-assistant.io/integrations/input_text/#restore-state). No helper or automation is created silently by the dashboard card.

## Validation

**182 checks pass: 64 unit tests, 103 browser tests, and 15 blueprint simulations.** Fifteen tests execute the shipped blueprint's YAML/Jinja actions against simulated HA state for start, expiry, restart, cancellation, off state, pause, downtime recovery and availability recovery. Browser tests cover the command arguments, live countdown, manual duration bounds, setup gaps, disabled automation, errors, editor drafts and phone layout. A live HA installation test remains separate.
