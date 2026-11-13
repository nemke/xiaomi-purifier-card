import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/tests/fixtures/demo.html');
  await page.waitForFunction(() => window.cards?.length === 2);
  await page.evaluate(() => {
    window.cards[1].remove();
    document.querySelector('main').style.display = 'block';
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      preset_mode: 'Auto',
      supported_features: 57,
      percentage: 33,
    });
    window.buttonConfig = {
      entity: 'fan.zhimi_airp_vb4',
      toolbar_style: 'buttons',
      aqi: { entity_id: 'sensor.zhimi_airp_vb4_motor_speed', unit: 'RPM' },
      stats: window.configs[0].stats,
      speed_controls: [
        { entity_id: 'number.zhimi_airp_vb4_fan_level', preset_mode: 'Fan' },
      ],
    };
    window.cards[0].setConfig(window.buttonConfig);
  });
});

async function geometry(card) {
  return card.evaluate((element) => {
    const root = element.shadowRoot;
    const toolbar = root.querySelector('.toolbar');
    const bounds = toolbar.getBoundingClientRect();
    const buttons = [...toolbar.querySelectorAll('button')];
    const rects = buttons.map((button) => {
      const r = button.getBoundingClientRect();
      const hit = root.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        label: button.getAttribute('aria-label'),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        inside:
          r.left >= bounds.left - 1 &&
          r.right <= bounds.right + 1 &&
          r.top >= bounds.top - 1 &&
          r.bottom <= bounds.bottom + 1,
        hittable: hit === button || button.contains(hit),
      };
    });
    let overlap = false;
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i],
          b = rects[j];
        if (
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
        )
          overlap = true;
      }
    return {
      rects,
      overlap,
      rows: new Set(rects.map((r) => Math.round(r.y))).size,
      overflow: toolbar.scrollWidth > toolbar.clientWidth + 1,
      cardOverflow: element.scrollWidth > element.clientWidth + 1,
    };
  });
}

for (const width of [320, 375, 480, 768]) {
  test(`all buttons are visible and independently tappable at ${width}px without scrolling or a dropdown`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1200 });
    const card = page.locator('xiaomi-purifier-card').first();
    await expect(
      card.getByRole('button', { name: 'Max', exact: true }),
    ).toBeVisible();
    await expect(card.locator('.shortcut-menu, .toolbar-hint')).toHaveCount(0);
    await expect
      .poll(async () => {
        const g = await geometry(card);
        return (
          !g.overlap &&
          !g.overflow &&
          !g.cardOverflow &&
          g.rects.every(
            (r) => r.inside && r.hittable && r.width >= 44 && r.height >= 44,
          )
        );
      })
      .toBe(true);
    const g = await geometry(card);
    expect(g.rects.map((r) => r.label)).toEqual([
      'Turn on/off',
      'Auto',
      'Silent',
      'Favorite',
      'Fan',
      'Max',
      'Device controls',
    ]);
    expect(g.rows).toBe(width < 768 ? 2 : 1);
    await card.getByRole('button', { name: 'Max', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(2);
    expect(
      await page.evaluate(() => window.calls.map((c) => c.service)),
    ).toEqual(['set_preset_mode', 'set_percentage']);
    await card
      .getByRole('button', { name: 'Device controls', exact: true })
      .click();
    await expect(card.locator('.device-controls')).toBeVisible();
  });
}

test('long custom labels and additional actions wrap without covering neighboring controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 1400 });
  await page.evaluate(() =>
    window.cards[0].setConfig({
      ...window.buttonConfig,
      shortcuts: [
        { name: 'Maximum ventilation for the living room', percentage: 100 },
        { name: 'Moderate air cleaning', percentage: 66 },
        { name: 'Quiet favorite setting', percentage: 33 },
      ],
    }),
  );
  const card = page.locator('xiaomi-purifier-card').first();
  await expect
    .poll(async () => {
      const g = await geometry(card);
      return (
        !g.overlap &&
        !g.overflow &&
        g.rects.every((r) => r.inside && r.hittable)
      );
    })
    .toBe(true);
  await card
    .getByRole('button', { name: 'Moderate air cleaning', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(1);
  expect(await page.evaluate(() => window.calls[0].data.percentage)).toBe(66);
});

test('button rows rebalance across resize while the active mode and controls stay intact', async ({
  page,
}) => {
  const card = page.locator('xiaomi-purifier-card').first();
  await page.setViewportSize({ width: 1000, height: 1200 });
  await expect.poll(async () => (await geometry(card)).rows).toBe(1);
  await page.setViewportSize({ width: 375, height: 1200 });
  await expect.poll(async () => (await geometry(card)).rows).toBe(2);
  await expect(
    card.getByRole('button', { name: 'Auto', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 1000, height: 1200 });
  await expect.poll(async () => (await geometry(card)).rows).toBe(1);
  await expect(card.locator('.shortcut-menu')).toHaveCount(0);
});
