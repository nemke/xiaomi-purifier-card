Breeze now includes a default Max speed action.

- Appears automatically when the purifier supports native percentage speed control. Existing cards need no new YAML or helpers.
- Selects Fan/Manual/Favorite when exposed, then awaits that command before requesting 100% speed. With Home Assistant's Xiaomi integration this selects Fan level 3 on the 4 Pro and 2200 RPM in Favorite on the 3C.
- Starts an off purifier first and reapplies the maximum on every press, rather than relying on the last saved manual setting.
- Preserves normal Auto/Silent controls, measured RPM feedback, command error handling, and responsive toolbar behavior.
- Can be hidden under Modes and shortcuts → Show Max speed action, or with `show_max_speed: false`. Custom Max shortcuts take precedence.

[Behavior and desktop/phone previews](https://github.com/nemke/xiaomi-purifier-card/blob/v0.1.15/docs/MAX_SPEED.md).

Validation: source/translation lint, strict TypeScript checking, 71 unit tests, production build, 111 Chromium browser tests, and 15 shutdown-blueprint simulations. Browser tests use simulated Home Assistant state; no physical purifier commands were sent during development.

Update Breeze through HACS and reload the frontend. The resource filename and existing card configurations are unchanged. Max is available in the action dropdown when the toolbar is narrow.
