Compact configuration, responsive actions, and optional device controls.

- Collapses statistics into live summaries and puts related-device sources first. The five-stat editor is about 69% shorter on a phone; typed values and expanded rows survive HA updates and reordering.
- Adds visual preset visibility/order and shortcut editing, including number targets, percentages, and advanced action sequences.
- Uses a dropdown automatically when shortcut buttons would overflow. Power remains directly accessible.
- Distinguishes sending from waiting for reported device confirmation, preserves keyboard focus, and shows an unconfirmed notice after 15 seconds. Preset highlighting and measured RPM follow actual HA state.
- Starts an off purifier in the selected shorthand preset. Explicit advanced sequences retain their configured behavior.
- Adds optional settings for real speed targets, child lock, buzzer, and display controls. Known same-device entities are suggested; manual overrides remain available. Number targets use their actual units, bounds, and step.
- Prevents unitless fan-speed levels from being mislabeled as RPM. Broader non-Xiaomi compatibility still needs integration-specific validation.
- Fixes initial dropdown selections. Keeps the existing best-effort RPM refresh cadence unchanged.

Validation: source/translation lint, strict TypeScript checking, 32 unit tests, production build, and 61 Chromium browser tests with simulated HA state. Physical-device validation remains separate.

Update through HACS and reload the frontend. Existing YAML continues to work. Open the card editor and use Detect missing sensors to append supported control suggestions to an existing card; review or remove any suggestion before saving.
