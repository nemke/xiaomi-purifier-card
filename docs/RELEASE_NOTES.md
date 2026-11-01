Read-only fan-speed display.

- Removes the header plus/minus buttons and expandable percentage slider. Xiaomi percentage commands can select modes or discrete levels and do not necessarily set the measured RPM shown beside them.
- Keeps the live RPM reading (or percentage fallback), power/preset controls, and explicitly configured speed shortcuts.
- Manual speed targets remain available through shortcuts that use the integration's separate Favorite RPM/level or Fan level number entities.

Validation: full lint, typecheck, 28 model tests, build, and 32 Chromium browser tests, including read-only RPM updates and percentage fallback without commands.

Update through HACS and reload the frontend. No configuration changes are required.
