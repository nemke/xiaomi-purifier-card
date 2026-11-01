# Filter maintenance — v0.1.13

Breeze v0.1.13 adds maintenance warnings to the compact purifier card.

A healthy reading leaves the card unchanged. Remaining life at or below the warning threshold adds **Filter running low**; the replacement threshold adds **Replace filter**. Defaults are 20% / 5%, or 7 days / 0 days. An unavailable reading adds a neutral **Filter status unavailable** notice. Labels communicate severity independently of the icon/border color. Notices have keyboard focus, a minimum 44px target, and open the correct entity details.

[Desktop warning](previews/filter-maintenance/warning.png) · [Phone replacement notice](previews/filter-maintenance/replacement-phone.png) · [Unavailable source](previews/filter-maintenance/unavailable-phone.png) · [Visual editor](previews/filter-maintenance/editor.png)

Previews use simulated HA states and lightweight icon/card stand-ins.

## Source semantics

Warnings use a recognized remaining-life statistic, or an explicit `filter_warning` source. The editor discovers a unique same-device replacement flag first, otherwise a verified remaining percentage or remaining-day source. It preserves user overrides and drafts during registry lookup and ordinary HA updates. Renamed numeric sensors retain their registry-verified meaning in saved configuration.

HA binary sensors store `on`/`off` states ([official documentation](https://www.home-assistant.io/integrations/binary_sensor/#binary-sensor-states)). Replacement mode maps these to due/clear without inventing a percentage. For example, STARKVIND exposes a native replacement flag separately from filter age in minutes ([Zigbee2MQTT documentation](https://www.zigbee2mqtt.io/devices/E2006.html#replace-filter-binary)). This batch supports that distinction but does not claim full STARKVIND hardware validation.

Usage duration, filter age, unrelated binary states, ambiguous matches, and template conversions never become automatic remaining-life estimates. Unknown, unavailable, blank, nonnumeric, negative, and out-of-range percentage values do not become zero. A native replacement flag remains authoritative even if a remaining-life estimate disagrees.

## Configuration

```yaml
filter_warning:
  enabled: true
  entity_id: sensor.purifier_filter_life_remaining
  mode: remaining_percent
  warning_threshold: 20
  critical_threshold: 5
```

`mode` also accepts `remaining_days` or `replacement`. Attribute sources and native flags are editable visually. Choosing a new source resets thresholds; changing meaning resets its thresholds to the relevant defaults. Disabling warnings preserves the source configuration. **Use filter statistics automatically** clears source overrides and thresholds while retaining the enabled setting.

No service is sent by a notice, no filter counter is reset, and no additional polling is introduced.

## Validation

**182 checks pass: 64 unit tests, 103 browser tests, and 15 blueprint simulations.** Source/translation lint, strict TypeScript checking, a production build, and Chromium browser tests cover threshold boundaries, valid zero, unknown/invalid data, disabled warnings, native flags, remaining days versus usage, ambiguity, renamed sources, independent state updates, editor drafts, and phone layout. Physical-device validation remains separate.
