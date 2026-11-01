Icons for statistics.

- Replaces standard temperature, humidity, filter-remaining, and RPM labels with thermometer, droplet, filter, and fan icons. Existing cards pick up automatic icons without configuration changes; PM2.5 and PM10 keep their distinct short labels.
- Adds a per-statistic icon field and Use text label switch in the visual editor. YAML supports custom `icon: mdi:...` or `icon: ''` for text.
- Preserves numeric readings/units, labels as hover tooltips and accessible names, keyboard interaction, and entity detail links. Unknown statistics keep their text label.
- Sensor discovery includes suitable icons for renamed sensors; manual choices survive re-detection.

Validation: lint, typecheck, 28 model tests, build, and 43 Chromium browser tests, including accessible names, custom/text overrides, editor preservation, typing during HA refreshes, and responsive layouts.

Update through HACS and reload the frontend. All earlier sensor-refresh behavior is retained.
