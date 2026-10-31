Compact card layout and automatic filter-remaining detection.

- Replaces the large purifier artwork and dial with a compact header: device name/status on the left and fan speed on the right.
- Adds plus/minus buttons for supported speed steps. Tap the reading to expand the percentage slider.
- Uses a rounded power/preset strip; missing supported presets are supplied automatically alongside configured shortcuts.
- Keeps all five statistics in a row on wider cards; narrow cards use two columns with the final odd statistic spanning the last row.
- Detects filter life remaining from the same device, preferring percent over remaining time. Existing labels and selected sources are preserved without duplicate filter statistics.
- Retains manual overrides, templates, the typing fix, and the 4 Pro fractional-step fix.
- Removes the artwork from the JavaScript bundle, reducing the uncompressed build from about 2.35MB to about 97KB.

Validation: 29 model tests and 35 Chromium browser tests, including preset controls, speed steps, filter detection, and desktop/phone layouts.

Update through HACS and reload the frontend. The compact layout is applied automatically to existing cards. In the card editor, click **Detect missing sensors** to add filter remaining if it is not already configured. Every detected statistic remains editable.
