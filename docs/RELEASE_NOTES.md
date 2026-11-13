Breeze's Buttons layout now works on phones without scrolling or a dropdown.

- Wraps overflowing buttons into balanced rows, keeping Auto, Silent, Favorite, Fan, Max, power, and settings visible.
- Removes sticky end buttons that could cover neighboring modes and removes the swipe hint.
- Preserves the single-row desktop toolbar when it fits. Long labels wrap within their own button, and custom actions remain available.
- Keeps the existing Automatic and Dropdown styles. Cards already using Buttons need no YAML changes.
- Preserves the default Max speed action introduced in v0.1.15 and all existing device commands.

[Desktop and phone previews](https://github.com/nemke/xiaomi-purifier-card/blob/v0.1.16/docs/MOBILE_BUTTONS.md).

Validation includes source/translation lint, strict TypeScript checking, 71 unit tests, production build, 117 Chromium browser tests, and 15 shutdown-blueprint simulations. Mobile checks verify actual button hit targets and non-overlap at 320px, 375px, and 480px, plus desktop resizing, long labels, and command behavior. Browser tests use simulated HA state.

Update Breeze through HACS and reload the frontend. Keep Toolbar style set to Buttons to use the new phone layout. The resource filename and existing card configurations are unchanged.
