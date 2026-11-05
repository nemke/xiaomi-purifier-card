# Breeze Purifier Card

A compact Home Assistant dashboard card for air purifiers, built with TypeScript and Lit. Formerly Xiaomi Purifier Card. Based on [Purifier Card by Denys Dovhan](https://github.com/denysdovhan/purifier-card), with preserved MIT attribution.

See the [v0.1.12 UX review and previews](docs/ux-review-2026-11-01.md) for the compact editor, configurable modes, and optional device controls.

![Validation](https://github.com/nemke/xiaomi-purifier-card/actions/workflows/main.yml/badge.svg)

## Breeze rename

The picker, editor and HACS display name are now **Breeze Purifier Card**. New configurations use `custom:breeze-purifier-card`; existing `custom:xiaomi-purifier-card` YAML continues to work through a legacy alias. The GitHub repository and `xiaomi-purifier-card.js` resource filename remain stable for existing HACS installations. Load the resource once; no resource migration is required.

Version **0.1.14** makes [one-hour PM trends](docs/PM_TRENDS.md) quieter: a thin neutral line within the existing tile padding, no shaded fill, and no graph for a flat hour. The shutdown timer, filter-maintenance warnings, and non-Xiaomi support introduced in v0.1.13 remain available.

## Features

- Compact header with purifier name, state, and a live read-only fan-speed reading.
- Automatic PM2.5, PM10, temperature, humidity, and filter-remaining discovery from the selected purifier’s HA device.
- A simple power/preset strip and responsive statistics; no purifier image or decorative dial.
- Separate sensor and number entities update without reloading the dashboard.
- Optional one-hour PM2.5/PM10 background graphs preserve the compact statistics layout.
- Shortcuts for native percentages, discrete levels, RPM, or custom action sequences.
- Numeric range/step validation, ordered commands, and visible command errors.
- Optional denser spacing, Jinja statistic templates, translations, and `--pc-*` theme variables.
- Compact visual editor with live statistic summaries, device-related source suggestions, preset visibility/order, and editable shortcuts.
- Optional device settings and separate speed targets, with discovery for known same-device entities.
- Optional shutdown timer with presets, custom duration, cancellation, and a persistent HA deadline.
- Command feedback distinguishes sending, waiting for device confirmation, and unconfirmed settings; reported RPM remains authoritative.

![Preview with simulated HA states](docs/preview.png)

Preview uses simulated states and lightweight stand-ins for HA card/icon elements. [Phone preview](docs/preview-mobile.png).

## Compatibility

Compatibility coverage includes Levoit/VeSync, ESPHome, and IKEA STARKVIND entity layouts. See the [integration matrix and examples](docs/COMPATIBILITY.md) for tested behaviors and manual configuration. These are simulated-state checks; hardware validation remains separate.

Initial target: **Home Assistant 2026.10.4**. The purifier must already be integrated into HA and expose a `fan` entity. The card does not connect directly to Xiaomi devices and needs no additional account, access token, or backend.

The design supports Xiaomi model differences through entity capabilities and explicit configuration, rather than a fixed model whitelist. Controls can use `fan.set_preset_mode`, `fan.set_percentage`, `number.set_value`, and other HA services. Unsupported sensors are optional. A card cannot add a control that the integration does not expose.

The 4 Pro and 3C examples are covered by automated tests with **simulated HA state**. Actual operation on physical devices still needs verification. No claim is made that every Xiaomi model or integration has been hardware tested.

## Install with HACS

Breeze is included in the [HACS default catalog](https://github.com/hacs/default/pull/13032).

1. Open **HACS** and search for **Breeze Purifier Card**.
2. Download the latest release.
3. Reload the frontend. Check that a JavaScript module resource exists at `/hacsfiles/xiaomi-purifier-card/xiaomi-purifier-card.js`. Add it manually if your resources are managed in YAML.
4. Add **Breeze Purifier Card** from the dashboard card picker, or use `type: custom:breeze-purifier-card` in YAML. Existing `custom:xiaomi-purifier-card` configurations remain supported.

```yaml
type: custom:breeze-purifier-card
entity: fan.your_purifier
stats:
  - entity_id: sensor.your_purifier_filter_life_remaining
    unit: '%'
    subtitle: Filter remaining
shortcuts:
  - name: Auto
    icon: mdi:brightness-auto
    preset_mode: Auto
```

HACS installs the compiled JavaScript. It does not require Node.js, npm, or TypeScript on your HA host.

### Custom repository fallback

If Breeze is not available in HACS search, you can add it manually:

1. Open **HACS → ⋮ → Custom repositories**.
2. Add `https://github.com/nemke/xiaomi-purifier-card`, category **Dashboard**.
3. Download **Breeze Purifier Card** and continue with step 3 above.

For manual installation, download `xiaomi-purifier-card.js` from a release, copy it to `<config>/www/`, and register `/local/xiaomi-purifier-card.js` as a JavaScript module.

## Migrate from purifier-card

The separate tag means this card can coexist with the original. Start by duplicating your old card and changing only its type to `custom:breeze-purifier-card`.

- Existing `aqi`, `stats`, visibility flags, themes, and templates are retained.
- Legacy shortcut `speed: Silent` / `speed: Auto` is accepted as a `preset_mode` alias. Prefer `preset_mode` in new configurations.
- Combined shortcut actions now execute **preset → custom service → percentage**, awaiting each command and stopping on failure. The complete sequence is validated before sending commands. HA service completion does not guarantee that device telemetry has caught up; active highlighting follows reported state.
- Custom services receive their own `service_data` and `target`; a fan target is only inferred for fan-domain services.
- Custom service shortcuts are no longer permanently highlighted. Recognized preset/percentage/number combinations must all match; arbitrary actions can specify `state_entity` and `state`.
- The card uses a compact layout for both existing and new configurations. The header reading is read-only: percentage commands can change modes or discrete levels on Xiaomi models, so it has no plus/minus buttons or slider.
- Supported preset buttons are provided automatically. Custom shortcuts are retained, with missing preset modes added to keep every exposed mode accessible.
- `compact_view` now selects denser spacing; the large image and dial have been removed.

Use [the 4 Pro example](examples/4-pro.yaml) or [the 3C example](examples/3c.yaml) for the supplied entity names. The 4 Pro `fan_level` example selects **Fan**, following the `xiaomi_miio` integration's mode semantics; verify your integration's `preset_modes`. The 3C RPM example selects **Favorite**. Percentage shortcut names in these examples are labels for user-selected settings, not measured airflow percentages.

After a successful card command, the card requests `homeassistant.update_entity` for the main reading entity after one second, then once more ten seconds after the first refresh completes. The header shows **Updating…** while the command and first refresh are pending ([preview](docs/refresh.png)). Requests are best effort: integration throttling, device response time, and motor settling still apply. The displayed RPM always comes from HA sensor state. New commands replace queued refreshes; removing or reconfiguring the card cancels them. There is no continuous polling and the integration's normal update interval is unchanged. See [HA's update-entity action](https://www.home-assistant.io/actions/homeassistant.update_entity/).

Measured RPM is feedback, not a speed target. For manual tuning, use a separate `number` entity exposed by your integration: the 3C example uses its Favorite RPM target, while other models expose Favorite levels or Fan levels. Use the entity's actual range and step; a Fan level is not an RPM value. See the [HA Xiaomi integration](https://www.home-assistant.io/integrations/xiaomi_miio/#xiaomi-air-purifier).

`filter_life_remaining` is remaining filter life, so it should be labelled **Filter remaining**. `aqi` is the inherited configuration key; displaying PM2.5 concentration does not calculate an air quality index.

## Configuration

[One-hour PM backgrounds](docs/PM_TRENDS.md) use existing HA history without adding card height or device polling. Disable them with `show_pm_trends: false`.

[Filter-maintenance warnings](docs/FILTER_MAINTENANCE.md) provide configurable remaining-life thresholds and native replacement flags.

The visual editor detects available readings when configuring a purifier. The main reading defaults to measured motor RPM, or the fan’s percentage when RPM is not exposed. PM2.5, PM10, temperature, humidity, and filter remaining are suggested as statistics. Filter life remaining in percent is preferred over remaining days when both are exposed. Detection uses device membership and sensor metadata, so renamed entities are supported. Disabled, missing, or ambiguous sensors are not guessed. Known numeric fan attributes are also supported for older integrations.

For an existing card, click **Detect missing sensors** in the editor. Existing sensor choices, custom labels, units, templates, and shortcuts are preserved. Remove or change any suggestion to override it; state refreshes do not reapply removed defaults. Sensor discovery does not overwrite a field while you are typing.

The visual editor includes an optional **Display name** field, plus **Main reading** and **Statistics** sections. Leave the display name empty to follow the entity’s name; an override applies only to this card ([display-name preview](docs/display-name-editor.png)). Choose a sensor for the header reading, then use **Add statistic** to add further readings. Each statistic starts as a collapsed summary showing its label and live value. Expand it to change its source or label; unit and icon options are nested under display options. Ordering and removal controls remain inside the row. **Use text label** restores the visible label. Sensor inputs put entities from the selected device first and show their current values and units; you can also type an entity ID. See the [editor preview](docs/editor.png).

Existing templates, fan attributes, and shortcuts are retained when editing labels, units, or appearance. Choosing a new sensor replaces that row's attribute source. Templates remain configurable in YAML. The shortcut editor supports presets, number targets, percentages, and an advanced JSON action sequence while preserving custom state conditions.

| Option             | Default              | Meaning                                                    |
| ------------------ | -------------------- | ---------------------------------------------------------- |
| `entity`           | required             | HA `fan.*` entity                                          |
| `name`             | entity friendly name | Optional display name                                      |
| `show_name`        | `true`               | Show the name                                              |
| `show_state`       | `true`               | Show state; unavailability is always shown                 |
| `show_preset_mode` | `true`               | Show the current preset in the status text                 |
| `show_toolbar`     | `true`               | Show power and shortcuts                                   |
| `show_pm_trends`   | `true`               | One-hour history backgrounds for eligible PM statistics    |
| `compact_view`     | `false`              | Use denser spacing                                         |
| `aqi`              | `{}`                 | Main reading source                                        |
| `stats`            | `[]`                 | List of additional readings                                |
| `shortcuts`        | `[]`                 | List of custom actions                                     |
| `preset_modes`     | automatic            | Visible built-in presets in display order; `[]` hides them |
| `toolbar_style`    | `auto`               | `auto`, `buttons`, or `dropdown`                           |
| `speed_controls`   | `[]`                 | Writable number targets, separate from measured speed      |
| `device_controls`  | `[]`                 | Optional switch, select, or number settings                |
| `filter_warning`   | automatic            | Maintenance source, meaning, and thresholds                |
| `shutdown_timer`   | unset                | Optional HA timer, automation, and deadline helper         |

### Reading sources

Leaving the main reading source empty shows fan speed when the fan exposes a measured motor-speed attribute or percentage. An explicit `aqi` source overrides that default.

Both `aqi` and each statistic accept `entity_id`, `attribute`, and `unit`. Without `entity_id`, an attribute is read from the fan. Combining them reads an attribute of the specified entity. Nested attribute paths are supported. Units default to the source sensor's unit where available. Missing, unknown, and unavailable readings show `—`; real zero values remain zero.

Statistics additionally accept `subtitle`, `icon`, and `value_template`. Temperature, humidity, filter remaining, and RPM use automatic icons; PM2.5 and PM10 retain their distinct short labels before the values. Icons and text labels prefix each reading on the same row. Unknown readings keep their text. Labels remain available as tooltips and accessible names, and clicking a statistic still opens its entity details. Set `icon: mdi:thermometer` to override the icon or `icon: ''` to show text. Omit `icon` for automatic selection.

```yaml
stats:
  - entity_id: sensor.purifier_temperature
    subtitle: Temperature
    icon: mdi:thermometer
  - entity_id: sensor.purifier_humidity
    subtitle: Humidity
    icon: mdi:water-percent
```

Templates run through HA's template API and receive `value`:

```yaml
stats:
  - entity_id: sensor.purifier_filter_seconds
    value_template: '{{ (value | float(0) / 3600) | round(1) }}'
    unit: hours
    subtitle: Filter use
```

### Filter maintenance

Filter-remaining statistics automatically provide a compact warning when life is low: **20%** for an early warning and **5%** for replacement, or **7 days** and **0 days** for remaining-duration readings. Healthy filters add no message. Click a warning to open its source entity. Off-state purifiers can still show maintenance warnings.

The editor's **Filter maintenance** section lets you disable warnings, choose a source and its meaning, and change thresholds. A uniquely recognized same-device replacement-needed binary sensor takes priority during discovery. Its `on` state means replacement is due; `off` clears the message. Its unavailable state remains unavailable rather than falling back to a potentially conflicting percentage estimate.

```yaml
filter_warning:
  entity_id: sensor.purifier_filter_life_remaining
  mode: remaining_percent
  warning_threshold: 20
  critical_threshold: 5
```

Other meanings are `remaining_days` and `replacement`. An optional `attribute` reads an entity attribute; omitting `entity_id` then reads from the purifier fan. Meanings apply to raw values without conversion. Usage hours, filter age, template conversions, and unrelated binary sensors never automatically imply remaining life. Missing/invalid readings show **Filter status unavailable**. No reset or replacement action is sent.

Omit `filter_warning` to use recognized statistics automatically, or set `filter_warning: { enabled: false }` to disable it. An explicit source overrides automatic selection. Equal candidates require manual selection. Automatic detection preserves renamed sources by saving their verified meaning. Thresholds must be nonnegative, with replacement at or below the warning threshold; percentage thresholds cannot exceed 100 when `mode: remaining_percent` is explicit. If only one threshold is set, the other default adjusts to preserve that ordering. State updates remain subscription-based and RPM refresh behavior is unchanged.

### Modes and device controls

Use **Modes and shortcuts** to hide or reorder built-in presets and edit custom actions. Automatic layout uses buttons when they fit and a dropdown when space is limited. Choose **Buttons** to keep a horizontally scrollable strip, or **Dropdown** to always use the action menu. `show_preset_mode` controls only the status text; `preset_modes` controls which built-in actions appear. An explicit preset list does not remove custom multi-action shortcuts.

When the fan is off, a shorthand preset action turns it on in that preset. Explicit `actions` sequences execute exactly as configured. During a command, the card shows **Sending**, then **Waiting for device** until HA reports the requested settings. After 15 seconds it shows an unconfirmed notice. Active highlighting follows reported state, and a later device update clears the notice. This feedback does not increase the integration's polling frequency.

The editor suggests known Favorite/Fan number targets and child-lock, buzzer, and display settings from the same device. Detection requires an unambiguous match; numeric controls must expose valid `min`, `max`, and `step`. Existing choices and intentionally empty lists are preserved. Use the detection button to append missing suggestions, or configure entities manually under **Device controls**.

A settings button appears on cards with configured controls. Speed targets show their actual unit, bounds, and reported target separately from the header's measured RPM. **Apply** selects the configured preset before setting its number. Some models expose a level rather than an RPM target; the card uses the entity's actual unit and step.

```yaml
speed_controls:
  - entity_id: number.mi_air_purifier_3c_favorite_motor_speed
    preset_mode: Favorite
    name: Favorite speed
device_controls:
  - entity_id: switch.mi_air_purifier_3c_child_lock
    name: Child lock
```

Omit `preset_mode` for a number target that does not require a mode change. Optional `name` overrides apply only to the card. These controls depend on what the HA integration exposes; no new backend or device capability is added.

### Shortcuts

Each shortcut accepts `name`, `icon`, `preset_mode`, `percentage`, `service`, `service_data`, and `target`. Preset names must match a mode exposed by the target entity; case differences are normalized to the reported spelling. Number values are checked against the entity's `min`, `max`, and `step`. Quoted numeric values are accepted and sent as numbers.

```yaml
shortcuts:
  - name: Favorite
    icon: mdi:star
    preset_mode: Favorite
    service: number.set_value
    target:
      entity_id: number.purifier_favorite_level
    service_data:
      value: 7
```

For integrations with a separate mode selector or additional controls, use an explicit `actions` list. If present, this replaces the shorthand actions and runs in the written order:

```yaml
shortcuts:
  - name: Sleep
    icon: mdi:weather-night
    actions:
      - service: select.select_option
        target:
          entity_id: select.purifier_mode
        service_data:
          option: Sleep
    state_entity: select.purifier_mode
    state: Sleep
```

The card disables controls while the fan is unavailable or a command is pending. A failed command stops the sequence and displays the error; completed earlier commands are not rolled back. A timeout does not prove the device ignored a command: check its state before retrying.

## Theming

The card follows HA theme colors. Existing variables are retained:

| Variable                    | Purpose                      |
| --------------------------- | ---------------------------- |
| `--pc-background`           | Card background              |
| `--pc-primary-text-color`   | Name and readings            |
| `--pc-secondary-text-color` | State, labels, units         |
| `--pc-icon-color`           | Header icons                 |
| `--pc-slider-path-color`    | Legacy track color           |
| `--pc-slider-bar-color`     | Active preset color          |
| `--pc-toolbar-background`   | Toolbar background           |
| `--pc-toolbar-text-color`   | Toolbar text                 |
| `--pc-toolbar-icon-color`   | Toolbar icons                |
| `--pc-divider-color`        | Separators                   |
| `--pc-spacing`              | Base spacing, default `10px` |

Override them through a theme or optional card-mod styling:

```yaml
card_mod:
  style: |
    ha-card {
      --pc-background: #18242b;
      --pc-spacing: 12px;
    }
```

## Languages and development

Retains English, Ukrainian, Turkish, French, Norwegian Bokmål, Polish, Bulgarian, simplified/traditional Chinese, German, Catalan, Russian, Italian, Czech, Dutch, Spanish, Slovak, and Portuguese with English fallback. New translations should receive native-speaker review.

See [CONTRIBUTING.md](CONTRIBUTING.md) for Node 24/npm 11 development, automated checks, local preview, and release instructions.

## Credits and license

MIT, original copyright © 2020 Denys Dovhan. See [LICENSE](LICENSE). Original card inspired by [MacBury Smart House](https://github.com/macbury/SmartHouse). Legacy purifier artwork remains in the source repository but is no longer bundled by the compact card; its documented provenance is [the upstream animation section](https://github.com/denysdovhan/purifier-card#animations).
