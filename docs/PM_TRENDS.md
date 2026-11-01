# One-hour PM backgrounds — v0.1.13

PM2.5 and PM10 statistics can show a faint line and filled history area behind the existing value. The window is always one hour. Tiles keep their current dimensions, foreground labels and units, keyboard interaction, and entity-detail links. A tooltip identifies **Last hour** when a graph is present.

[Desktop](previews/pm-trends/desktop.png) · [Phone](previews/pm-trends/phone.png) · [Missing-data gap](previews/pm-trends/gap-phone.png) · [Light theme](previews/pm-trends/light.png)

Previews use simulated history and lightweight HA icon/card stand-ins.

## Reading the graph

The oldest state is on the left and the newest on the right. The vertical scale starts at zero and fits the largest value within that tile's hour. Each tile has its own scale, so compare its pattern rather than comparing graph heights between PM2.5 and PM10.

Step paths show recorded HA state changes. A known constant state stays flat until it changes; the graph does not imply additional measurements. Unknown, unavailable, blank, invalid, and negative states break the line and fill. They never become zero. History beginning partway through the hour leaves the earlier area empty. Real zero values remain valid.

The current number continues to come from the configured HA source. Graphs are decorative and hidden from screen readers; labels and numeric readings retain their accessible names. High-contrast forced-color mode hides the backgrounds.

## Sources and configuration

Backgrounds are enabled by default for recognized PM2.5/PM10 sensor statistics, and for known PM attributes on legacy entities. Other statistics, writable number targets, and converted template values are excluded. Template conversions can change the meaning or scale, so their raw history is not drawn behind the converted value.

Disable the feature in **Appearance → Show one-hour PM history backgrounds**, or use:

```yaml
show_pm_trends: false
```

There is no additional time-range control or expandable graph. Missing history, disabled HA History, denied permissions, or unsupported sources leave ordinary statistics visible without an error panel or extra space.

## History and performance

The card uses the existing [HA History/Recorder data](https://www.home-assistant.io/integrations/history/) through HA's [history stream API](https://github.com/home-assistant/core/blob/2026.10.4/homeassistant/components/history/websocket_api.py#L409). It does not poll the purifier or change the integration's refresh interval.

A visible card requests its selected PM entities together. Matching cards on the same HA connection share a subscription and history cache. Changes arrive through the stream; the graph's rolling window advances locally once per minute without another history query. Attribute sources request attribute changes as well as state changes.

Hidden/offscreen cards and removed cards release subscriptions. Reconnection starts a fresh one-hour request rather than replaying an ever-growing interval. Late acknowledgements and stale messages from previous configurations are cleaned up or ignored. Dense data is reduced for drawing while preserving extremes and data gaps; retained rows are bounded.

## Validation

The card regression suite contains 64 unit tests and 103 Chromium browser tests, including window clipping, zero baseline, gaps, dense peaks, attributes, sharing, permissions, hidden views, reconnects, phone layout, identical heights with graphs on/off, and unchanged entity-detail clicks. The existing 15 shutdown-blueprint simulations remain separate. Real HA history availability depends on Recorder inclusion and user permissions.
