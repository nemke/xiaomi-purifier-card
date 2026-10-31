Fixes the 4 Pro slider mismatch and adds visual configuration for readings and statistics.

- Fixed the real 4 Pro `percentage_step: 33.333333333333336` case, where a native fractional range could place a reported 100% value at roughly two-thirds. The slider now uses integer positions and converts them to HA percentages.
- Reconciles the thumb and preset selector with the reported HA state, including when a mode change leaves the percentage unchanged.
- Shows the draft percentage while adjusting and preserves that draft during independent sensor refreshes.
- Adds **Main reading** and **Statistics** sections to the visual editor, with sensor suggestions, labels, units, ordering, and removal.
- Preserves existing shortcuts, templates, and attribute sources when editing other settings.

Validated with 12 model tests and 20 Chromium browser tests, including the device attributes supplied from a real 4 Pro. Physical operation still needs verification after installation.

Update the card through HACS and reload the frontend. Existing YAML remains supported. To add statistics without YAML, edit the card and open **Statistics → Add statistic**.

The broader UI layout proposal is separate from this patch; the card retains its existing appearance.
