Faster sensor feedback after purifier commands.

- Requests a fresh main reading one second after a successful command, with one follow-up ten seconds after the initial refresh completes to capture motor settling.
- Shows Updating… during the command and first refresh; RPM remains the actual reading supplied by HA.
- Coalesces queued refreshes when another command is sent, cancels queued work when the card is removed/reconfigured, and bounds waiting for a refresh to ten seconds.
- Refresh failures do not turn successful device commands into errors. Normal HA sensor updates continue unchanged. No continuous polling is added.

Validation: lint, typecheck, 28 model tests, production build, and 39 Chromium browser tests covering refresh timing, cancellation, sensor updates, and failed/timed-out requests.

Update through HACS and reload the frontend. No configuration changes are required. Actual update timing remains subject to the integration's throttling and device response.
