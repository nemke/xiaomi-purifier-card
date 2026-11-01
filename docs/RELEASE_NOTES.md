Breeze Purifier Card: the new name, with existing installations preserved.

- Adds `custom:breeze-purifier-card` and the Breeze name in HACS and the card picker. Existing `custom:xiaomi-purifier-card` YAML, repository URL, and `xiaomi-purifier-card.js` resource path keep working. Load the resource only once.
- Adds subtle, fixed one-hour PM2.5/PM10 history backgrounds inside statistics. Card height, numeric values, and entity-detail clicks stay unchanged. Missing readings remain gaps; graphs use a zero baseline. Disable them under Appearance or with `show_pm_trends: false`.
- Uses shared history subscriptions for matching visible cards, cleans them up when hidden/removed, and restarts a fresh one-hour window after reconnecting. No additional device polling is introduced.
- Adds configurable filter-maintenance warnings for remaining percentage/days and native replacement flags. Unknown values never become zero; filter usage is never treated as remaining life. Sources and thresholds are editable.
- Adds an optional HA-backed shutdown timer with 30-minute/1-hour/2-hour presets, custom duration, restart and cancellation. Includes a setup guide, package example, and blueprint with persistent deadlines for restart/downtime recovery. **The timer requires one-time HA helper and automation setup; HACS does not install those automatically.** See [the timer guide](https://github.com/nemke/xiaomi-purifier-card/blob/main/docs/TIMER.md).
- Adds representative Levoit/VeSync, ESPHome and IKEA STARKVIND fixtures and examples. Preserves speed/filter semantics, supports VeSync night-light discovery, handles unknown percentages, and confirms zero-percent commands from reported Off state. Physical-device validation remains separate from this simulated coverage.
- Keeps existing Xiaomi controls, templates, themes, typing protections, and best-effort RPM refresh behavior.

Validation: source/translation lint, strict TypeScript checking, production build, 64 unit tests, 103 Chromium browser tests, and 15 shutdown-blueprint simulations — 182 checks total.

Update through HACS and reload the frontend. No YAML or resource migration is required. PM backgrounds need HA History/Recorder data; unavailable history leaves ordinary statistics visible. To configure filter warnings or the optional timer, open the card editor.
