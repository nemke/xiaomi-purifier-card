PM trends now keep the statistics row quiet and readable.

- Removes the shaded PM history fill and uses a thin neutral line in the existing bottom padding, limited to 8px high.
- Hides the graph when all known readings in the last hour are identical, including zero. Flat tiles stay plain; changing readings retain their one-hour trend.
- Preserves missing-data gaps, the zero baseline, numeric values, entity-detail clicks, and card height. History subscriptions and device polling behavior are unchanged.
- Keeps the existing filter-maintenance warnings and all other v0.1.13 features.

[Updated desktop and phone previews](https://github.com/nemke/xiaomi-purifier-card/blob/v0.1.14/docs/PM_TRENDS.md).

Validation: source/translation lint, strict TypeScript checking, production build, 65 unit tests and 104 Chromium browser tests pass. The release workflow also runs the existing 15 shutdown-blueprint simulations.

Update through HACS and reload the frontend. No YAML or resource changes are required. PM trends can still be disabled under Appearance or with `show_pm_trends: false`.
