Inline statistics and editable display names.

- Moves statistic icons and PM2.5/PM10 labels before their values, keeping each reading compact on desktop and phone layouts.
- Softens the statistics dividers and preserves 44px tap targets, tooltips, accessible labels, and entity detail links.
- Adds Display name to the visual editor. Clearing it restores the entity name; overrides apply only to the card.
- Preserves custom icons, labels, templates, and typing during HA state updates.
- Keeps the existing RPM refresh behavior unchanged.

Validation: lint, typecheck, 28 model tests, production build, and 45 Chromium browser tests, including inline alignment, display-name editing/clearing, and typing during HA refreshes.

Update through HACS and reload the frontend. No configuration changes are required.
