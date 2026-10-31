Adds automatic purifier reading discovery with editable defaults.

- Fan speed is the default main reading: measured motor RPM when detected, otherwise the fan percentage when available. An explicitly selected sensor remains an override.
- The editor detects PM2.5, PM10, temperature, and humidity sensors belonging to the selected HA device. Supported legacy fan attributes are also recognized.
- Sensor units come from HA metadata. Disabled, missing, and equally plausible sensors are not guessed.
- **Detect missing sensors** fills missing readings in an existing card while retaining custom sources, labels, units, templates, and shortcuts.
- Switching the selected purifier replaces defaults generated during the current editing session. Explicit manual choices remain preserved.
- Late discovery results cannot overwrite active typing or populate a newly selected fan with the previous fan’s sensors.
- Includes the v0.1.4 typing fix and the earlier 4 Pro fractional-step slider fix.

Validated with 27 model tests and 32 Chromium browser tests. Physical sensor discovery still needs verification against the user’s actual HA device registry.

Update through HACS and reload the frontend. Open the card editor and click **Detect missing sensors** for an existing card. All fields remain editable. If the main reading is already configured as PM2.5, clear that source to return to automatic fan speed, then run detection to prefer a measured RPM sensor.
