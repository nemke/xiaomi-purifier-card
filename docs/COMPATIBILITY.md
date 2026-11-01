# Integration compatibility

The card works through Home Assistant entities and services. This release adds tests for representative non-Xiaomi entity layouts and the fixes they exposed. It does not certify devices on physical hardware. Existing `custom:xiaomi-purifier-card` configuration and resource paths remain unchanged.

| Integration                        | Automatically suggested                                                                             | Explicit configuration                                                            | Validation                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Xiaomi `xiaomi_miio`               | Existing readings, Favorite/Fan targets and supported settings                                      | Existing YAML remains supported                                                   | Existing 3C / 4 Pro regression fixtures                     |
| Levoit through VeSync              | Supported presets, PM readings, remaining filter life; optional child lock, display and night light | Percentage shortcuts should use the device's reported speed steps                 | Source-derived synthetic HA fixture                         |
| Levoit through ESPHome             | Standard fan capabilities, PM device classes and recognized related controls                        | Custom filter names need an explicit meaning; airflow can be added as a statistic | User-reported sensor layout plus synthetic fan capabilities |
| IKEA STARKVIND through Zigbee2MQTT | Auto preset, PM2.5, replacement flag, child lock and LED                                            | Optional level readout and filter-age statistic                                   | Source-derived synthetic HA fixture                         |

Examples: [VeSync](../examples/compatibility/levoit-vesync.yaml), [ESPHome](../examples/compatibility/levoit-esphome.yaml), [STARKVIND](../examples/compatibility/ikea-starkvind.yaml). Entity IDs are illustrative. Keep only controls exposed by your integration. Automatic suggestions are populated by the visual editor; YAML can configure sources directly.

## What changed

- A fan that explicitly reports `percentage: null` shows `— %` when no measured RPM source is available. Auto mode can legitimately expose an unknown speed setting. A fan exposing no speed source has no empty readout pill.
- Related `night_light_level` controls are discovered independently of display controls. Ambiguous matches stay manual.
- Missing/blank percentage commands are rejected rather than being converted to zero. Zero-percent commands are confirmed by reported Off state because HA defines zero as turn-off; the integration may retain its last speed setting or report no percentage.
- Unknown percentage values never activate a zero-percent shortcut. Preset commands keep HA's reported spelling and selecting a shorthand preset while Off powers on in that preset.
- Independent airflow, particle and filter sensors continue to render when only those sensors change. No integration-specific polling loop or cloud connection is added.

## Speed and filter semantics

The header uses measured RPM only when a suitable measurement is available. A fan percentage is the HA-reported speed setting, not a measurement of airflow or RPM. Some integrations expose a discrete speed range; arbitrary percentages may be rounded. Use reported values for shortcut targets and confirmation. The examples do not add a slider or RPM +/- controls.

STARKVIND's read-only `fan_speed` sensor is a level from 0 to 9. Its numeric modes map to HA percentage speed commands through Zigbee2MQTT; `auto` is a preset. The fixture checks that the level is never selected as RPM. Its replacement-needed flag is separate from filter age. Filter age never becomes remaining life. An explicit level readout preserves that meaning.

For custom ESPHome sensors, a name such as `filter` and a percent unit alone do not prove remaining life. Configure `filter_warning.mode` explicitly after checking your firmware. A writable target number is never selected as measured RPM. Unsupported/unknown capabilities remain optional.

## Validation and previews

**182 checks pass: 64 unit tests, 103 Chromium browser tests, and 15 blueprint simulations**, including the existing Xiaomi and filter-maintenance regressions. Source/translation lint, strict type checking and the production build also pass.

[VeSync](previews/compatibility/vesync.png) · [VeSync settings](previews/compatibility/vesync-settings.png) · [ESPHome](previews/compatibility/esphome.png) · [STARKVIND](previews/compatibility/starkvind-phone.png)

These previews use simulated states and lightweight icon/card stand-ins. Phone layouts are also covered at 320px.

## Evidence and limits

The machine-readable [fixtures](../tests/fixtures/purifiers.json) record sources and which values are synthetic. They are examples of HA state shapes, not snapshots from a live installation. Physical-device confirmation remains a separate support level. This batch does not rename the repository or claim support for every device from a brand.

Primary sources:

- [HA VeSync integration](https://www.home-assistant.io/integrations/vesync/#fan--air-quality-sensors) and its HA 2026.10.4 [fan](https://github.com/home-assistant/core/blob/2026.10.4/homeassistant/components/vesync/fan.py), [sensor](https://github.com/home-assistant/core/blob/2026.10.4/homeassistant/components/vesync/sensor.py), [switch](https://github.com/home-assistant/core/blob/2026.10.4/homeassistant/components/vesync/switch.py), and [select](https://github.com/home-assistant/core/blob/2026.10.4/homeassistant/components/vesync/select.py) implementations.
- [ESPHome fan component](https://esphome.io/components/fan/) and the user's [independent airflow/filter/PM sensor report](https://github.com/denysdovhan/purifier-card/issues/716). Presets and optional entities in the test fixture are synthetic because the report does not supply them.
- [STARKVIND data model](https://www.zigbee2mqtt.io/devices/E2006.html) and [Zigbee2MQTT HA discovery mappings](https://github.com/Koenkk/zigbee2mqtt/blob/fc7383b9401cb96faea5f8464bfc6b0926574fac/lib/extension/homeassistant.ts#L1074). The recorded mapping revision was inspected on 2026-11-01; deployment versions can differ.

## Still to validate on real installations

Confirm discovery, state updates, presets from Off, discrete percentages, and available settings against actual HA entities for each integration. Cloud throttling and firmware differences remain controlled by the integration. Recording a model, integration version, and anonymized entity states will allow the support matrix to distinguish simulated coverage from device confirmation.
