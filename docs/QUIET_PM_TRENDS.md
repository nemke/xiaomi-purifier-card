# Quieter PM trends — v0.1.14

The v0.1.13 area fill makes a constant low reading look like a highlighted tile. This update removes that visual weight while retaining the fixed one-hour history.

- Removes the shaded area entirely.
- Shows a thin neutral line within the existing bottom padding, limited to 8px high.
- Hides the graph when all known values in the visible hour are identical, including zero.
- Keeps gaps, the zero baseline, foreground values, tile height, and entity-detail clicks.

[Flat 3C reading](previews/quiet-pm-trends/flat-3c.png) · [Changing 4 Pro reading](previews/quiet-pm-trends/varying-4-pro.png) · [Phone](previews/quiet-pm-trends/phone.png) · [Light theme](previews/quiet-pm-trends/light.png)

Previews use simulated HA state and lightweight icon stand-ins. The existing filter-replacement warning remains unchanged.

Validation: lint, translations, strict type checking, production build, 65 unit tests and 104 Chromium browser tests pass. The new cases check flat hours, spikes leaving the window, no fill, the 8px line, and unchanged tile height. No history subscription or device polling behavior changed. Prepared for release v0.1.14.
