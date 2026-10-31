Fixes editor text being overwritten or cleared while typing.

HA state refreshes were reapplying committed values to text inputs before their edits were complete. The main-reading sensor/unit and statistic sensor/label/unit fields now preserve in-progress text, focus, and cursor position across background refreshes and unchanged configuration echoes.

Changes still commit when a field is completed. Existing slider synchronization and statistic/template handling remain covered by regression tests.

Added six slow-typing regression cases, including a newly added empty statistic, with HA state and configuration refreshes every 20 milliseconds. Full validation covers 12 model tests and 26 Chromium browser tests.

Update through HACS, close the editor, and reload the frontend before editing again.
