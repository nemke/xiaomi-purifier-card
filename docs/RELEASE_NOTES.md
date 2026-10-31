First release of Xiaomi Purifier Card, based on denysdovhan/purifier-card.

- Independent card name: `custom:xiaomi-purifier-card`; can coexist with the original.
- Fixed-size responsive display without the removed HA round-slider dependency.
- Independent sensor and number-entity updates, including zero and unavailable values.
- Ordered, awaited shortcuts with preserved service data and targets, numeric range/step validation, and visible errors.
- Legacy `speed` shortcuts work as preset aliases; active shortcuts match both preset and value.
- Basic editor preserves advanced configuration and reflects existing visibility settings.
- Preserves templates, translations, and `--pc-*` theme variables.

Install as a custom HACS **Dashboard** repository: `nemke/xiaomi-purifier-card`.
Replace the card type with `custom:xiaomi-purifier-card`; see `examples/` for 4 Pro and 3C configurations.

Validated with automated unit tests and Chromium browser tests using simulated Home Assistant states. Actual device operation on HA 2026.10.4 still needs verification. Xiaomi support depends on the entities and capabilities exposed by the device's HA integration; this release does not claim hardware testing of every model.
