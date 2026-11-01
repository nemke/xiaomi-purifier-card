import { test, expect } from '@playwright/test';
const pm25 = 'sensor.zhimi_airp_vb4_pm2_5';
const pm10 = 'sensor.zhimi_airp_vb4_pm10';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/tests/fixtures/demo.html');
  await page.waitForFunction(() => window.cards?.length === 2);
  await page.evaluate(
    ({ pm25, pm10 }) => {
      window.historyCalls = [];
      window.historyStops = 0;
      window.historyCallbacks = [];
      window.hass = {
        ...window.hass,
        connected: true,
        config: { components: ['history', 'recorder'] },
        connection: {
          subscribeMessage: async (callback, message, options) => {
            if (message.type !== 'history/stream') {
              callback({ result: 'formatted value' });
              return () => {};
            }
            window.historyCalls.push({ message, options });
            window.historyCallbacks.push(callback);
            const now = Date.now() / 1000;
            const states = Object.fromEntries(
              message.entity_ids.map((id, index) => [
                id,
                [
                  { s: '4', lu: now - 3600 },
                  { s: '16', lu: now - 2400 },
                  { s: '6', lu: now - 600 },
                  { s: String(index + 1), lu: now - 60 },
                ],
              ]),
            );
            callback({ states });
            return () => {
              window.historyStops++;
            };
          },
        },
      };
      window.updateEntity(pm25, 5, {
        device_class: 'pm25',
        unit_of_measurement: 'μg/m³',
      });
      window.updateEntity(pm10, 1, {
        device_class: 'pm10',
        unit_of_measurement: 'μg/m³',
      });
      window.updateEntity('sensor.zhimi_airp_vb4_temperature', 24, {
        device_class: 'temperature',
        unit_of_measurement: '°C',
      });
      window.cards[1].remove();
      window.trendConfig = {
        entity: 'fan.zhimi_airp_vb4',
        stats: [
          { entity_id: pm25, subtitle: 'PM 2.5' },
          { entity_id: pm10, subtitle: 'PM 10' },
          {
            entity_id: 'sensor.zhimi_airp_vb4_temperature',
            subtitle: 'Temperature',
          },
        ],
      };
      window.cards[0].hass = window.hass;
      window.cards[0].setConfig(window.trendConfig);
    },
    { pm25, pm10 },
  );
});
const card = (page) => page.locator('xiaomi-purifier-card').first();

test('one-hour backgrounds use a single shared history stream, keep dimensions and foreground contrast', async ({
  page,
}) => {
  const current = card(page);
  await expect(current.locator('.stat-trend')).toHaveCount(2);
  const withHistory = await current.boundingBox();
  const calls = await page.evaluate(() => window.historyCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].message).toMatchObject({
    type: 'history/stream',
    entity_ids: [pm10, pm25].sort(),
    no_attributes: true,
    minimal_response: true,
  });
  expect(
    Math.abs(Date.now() - Date.parse(calls[0].message.start_time) - 3600000),
  ).toBeLessThan(10000);
  expect(calls[0].options.resubscribe).toBe(false);
  await expect(current.locator('.stats-block').first()).toHaveAttribute(
    'title',
    'PM 2.5 · Last hour',
  );
  await expect(current.locator('.stat-trend').first()).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  expect(
    await current
      .locator('.stat-trend')
      .first()
      .evaluate((el) => getComputedStyle(el).pointerEvents),
  ).toBe('none');
  expect(
    await current
      .locator('.stats-reading')
      .first()
      .evaluate((el) => getComputedStyle(el).zIndex),
  ).toBe('1');
  await page.evaluate(() =>
    window.cards[0].setConfig({ ...window.trendConfig, show_pm_trends: false }),
  );
  await expect(current.locator('.stat-trend')).toHaveCount(0);
  expect((await current.boundingBox()).height).toBe(withHistory.height);
  expect(await page.evaluate(() => window.historyStops)).toBe(1);
});

test('stream updates redraw histories, preserve gaps and leave entity-details clicks intact', async ({
  page,
}) => {
  const current = card(page);
  await expect(current.locator('.stat-trend')).toHaveCount(2);
  await page.evaluate((pm25) => {
    window.moreInfo = [];
    document.addEventListener('hass-more-info', (event) =>
      window.moreInfo.push(event.detail.entityId),
    );
    const now = Date.now() / 1000;
    window.historyCallbacks[0]({
      states: {
        [pm25]: [
          { s: 'unknown', lu: now - 900 },
          { s: '0', lu: now - 300 },
        ],
      },
    });
  }, pm25);
  await expect(
    current.locator('.stat-trend').first().locator('.trend-area'),
  ).toHaveCount(2);
  await current.locator('.stats-block').first().click();
  expect(await page.evaluate(() => window.moreInfo)).toEqual([pm25]);
  expect(await page.evaluate(() => window.calls)).toEqual([]);
});

test('missing history and access failures leave plain readable statistics', async ({
  page,
}) => {
  await expect(card(page).locator('.stat-trend')).toHaveCount(2);
  await page.evaluate(() => {
    window.cards[0].setConfig({ ...window.trendConfig, show_pm_trends: false });
  });
  await expect(card(page).locator('.stat-trend')).toHaveCount(0);
  await page.evaluate(() => {
    window.hass.connection = {
      subscribeMessage: async () => {
        throw new Error('not authorized');
      },
    };
    window.cards[0].hass = window.hass;
    window.cards[0].setConfig(window.trendConfig);
  });
  await expect(card(page).locator('.stat-trend')).toHaveCount(0);
  await expect(card(page).locator('.stats-value').first()).toHaveText('5');
  await expect(card(page).getByRole('alert')).toHaveCount(0);
});

test('unknown owners create gaps in attribute histories and request full attribute changes', async ({
  page,
}) => {
  await expect(card(page).locator('.stat-trend')).toHaveCount(2);
  await page.evaluate(() => {
    window.hass.connection = {
      subscribeMessage: async (callback, message) => {
        window.attributeRequest = message;
        const t = Date.now() / 1000;
        callback({
          states: {
            'fan.zhimi_airp_vb4': [
              { s: 'on', lu: t - 3600, a: { pm2_5: 5 } },
              { s: 'unavailable', lu: t - 1800, a: { pm2_5: 0 } },
              { s: 'on', lu: t - 600, a: { pm2_5: 1 } },
            ],
          },
        });
        return () => {};
      },
    };
    window.cards[0].hass = { ...window.hass };
    window.cards[0].setConfig({
      entity: 'fan.zhimi_airp_vb4',
      stats: [{ attribute: 'pm2_5', unit: 'μg/m³', subtitle: 'PM 2.5' }],
    });
  });
  await expect(card(page).locator('.stat-trend')).toHaveCount(1);
  await expect(card(page).locator('.trend-area')).toHaveCount(2);
  expect(await page.evaluate(() => window.attributeRequest)).toMatchObject({
    entity_ids: ['fan.zhimi_airp_vb4'],
    no_attributes: false,
    minimal_response: false,
    significant_changes_only: false,
  });
});

test('templates and non-PM statistics do not request a misleading raw-value graph', async ({
  page,
}) => {
  await expect(card(page).locator('.stat-trend')).toHaveCount(2);
  await page.evaluate(
    ({ pm25 }) =>
      window.cards[0].setConfig({
        entity: 'fan.zhimi_airp_vb4',
        stats: [
          { entity_id: pm25, value_template: '{{ value * 2 }}' },
          { entity_id: 'sensor.zhimi_airp_vb4_temperature' },
        ],
      }),
    { pm25 },
  );
  await expect(card(page).locator('.stat-trend')).toHaveCount(0);
  expect(await page.evaluate(() => window.historyCalls.length)).toBe(1);
  expect(await page.evaluate(() => window.historyStops)).toBe(1);
});

test('duplicate visible cards share data and release it only when both are removed', async ({
  page,
}) => {
  await expect(card(page).locator('.stat-trend')).toHaveCount(2);
  await page.evaluate(() => {
    const copy = document.createElement('breeze-purifier-card');
    copy.hass = window.hass;
    copy.setConfig(window.trendConfig);
    document.querySelector('main').append(copy);
    window.copy = copy;
  });
  await expect(page.locator('breeze-purifier-card .stat-trend')).toHaveCount(2);
  expect(await page.evaluate(() => window.historyCalls.length)).toBe(1);
  await card(page).evaluate((el) => el.remove());
  expect(await page.evaluate(() => window.historyStops)).toBe(0);
  await page.evaluate(() => window.copy.remove());
  expect(await page.evaluate(() => window.historyStops)).toBe(1);
});

test('offscreen and hidden cards stop history and reconnect with a fresh one-hour request', async ({
  page,
}) => {
  await expect(card(page).locator('.stat-trend')).toHaveCount(2);
  await card(page).evaluate((el) => (el.style.display = 'none'));
  await expect.poll(() => page.evaluate(() => window.historyStops)).toBe(1);
  await card(page).evaluate((el) => (el.style.display = 'block'));
  await expect(card(page).locator('.stat-trend')).toHaveCount(2);
  expect(await page.evaluate(() => window.historyCalls.length)).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(card(page).locator('.stat-trend')).toHaveCount(0);
  expect(await page.evaluate(() => window.historyStops)).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(card(page).locator('.stat-trend')).toHaveCount(2);
});

test('network reconnect restarts the window instead of replaying a growing history interval', async ({
  page,
}) => {
  await expect(card(page).locator('.stat-trend')).toHaveCount(2);
  await page.evaluate(() => {
    window.hass = { ...window.hass, connected: false };
    window.cards[0].hass = window.hass;
  });
  await expect(card(page).locator('.stat-trend')).toHaveCount(0);
  await page.evaluate(() => {
    window.hass = { ...window.hass, connected: true };
    window.cards[0].hass = window.hass;
  });
  await expect(card(page).locator('.stat-trend')).toHaveCount(2);
  expect(await page.evaluate(() => window.historyCalls.length)).toBe(2);
});

test('without HA history support there are no requests and no layout placeholder', async ({
  page,
}) => {
  await expect(card(page).locator('.stat-trend')).toHaveCount(2);
  await page.evaluate(() => {
    window.hass = { ...window.hass, config: { components: [] } };
    window.cards[0].hass = window.hass;
  });
  await expect(card(page).locator('.stat-trend')).toHaveCount(0);
  expect(await page.evaluate(() => window.historyCalls.length)).toBe(1);
  await expect(card(page).locator('.stats-value').first()).toHaveText('5');
});

test('phone-sized tiles keep their size, tab targets and readings with a zero-based graph', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const current = card(page);
  await expect(current.locator('.stat-trend')).toHaveCount(2);
  expect(await current.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  const height = (await current.locator('.stats-block').first().boundingBox())
    .height;
  expect(height).toBeGreaterThanOrEqual(44);
  await current.locator('.stats-block').first().focus();
  await expect(current.locator('.stats-block').first()).toBeFocused();
  await page.evaluate(() =>
    window.cards[0].setConfig({ ...window.trendConfig, show_pm_trends: false }),
  );
  expect(
    (await current.locator('.stats-block').first().boundingBox()).height,
  ).toBe(height);
});
