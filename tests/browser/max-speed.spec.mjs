import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/tests/fixtures/demo.html');
  await page.waitForFunction(() => window.cards?.length === 2);
  await page.evaluate(() => {
    window.cards[1].remove();
    document.querySelector('main').style.cssText =
      'display:block;width:480px;max-width:100%';
    window.maxConfig = {
      entity: 'fan.zhimi_airp_vb4',
      toolbar_style: 'buttons',
      aqi: { entity_id: 'sensor.zhimi_airp_vb4_motor_speed', unit: 'RPM' },
    };
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      preset_mode: 'Favorite',
      percentage: 33,
      supported_features: 57,
    });
    window.cards[0].setConfig(window.maxConfig);
  });
});

test('Max is present with only a fan configured and awaits Fan mode before sending 100%', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.hass.callService = async (domain, service, data, target) => {
      window.calls.push({ domain, service, data, target });
      if (service === 'set_preset_mode')
        await new Promise((resolve) => {
          window.releaseMax = resolve;
        });
    };
  });
  const card = page.locator('xiaomi-purifier-card').first();
  const max = card.getByRole('button', { name: 'Max', exact: true });
  await expect(
    card.getByRole('button', { name: 'Fan', exact: true }),
  ).toBeVisible();
  await max.click();
  await expect(max).toBeDisabled();
  expect(await page.evaluate(() => window.calls)).toMatchObject([
    {
      domain: 'fan',
      service: 'set_preset_mode',
      data: { preset_mode: 'Fan' },
      target: { entity_id: 'fan.zhimi_airp_vb4' },
    },
  ]);
  await page.evaluate(() => window.releaseMax());
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(2);
  expect(await page.evaluate(() => window.calls[1])).toMatchObject({
    service: 'set_percentage',
    data: { percentage: 100 },
  });
  await expect(max).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() =>
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      preset_mode: 'Fan',
      percentage: 100,
    }),
  );
  await expect(max).toHaveAttribute('aria-pressed', 'true');
  // Motor telemetry remains authoritative, rather than displaying a guessed maximum.
  await expect(card.locator('.number-on')).toHaveText('750');
  await max.click();
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(3);
  await page.evaluate(() => window.releaseMax());
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(4);
});

test('3C Max powers on into Favorite and applies the maximum even with a lower saved target', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.updateEntity('fan.mi_air_purifier_3c', 'off', {
      ...window.hass.states['fan.mi_air_purifier_3c'].attributes,
      preset_modes: ['Auto', 'Silent', 'Favorite'],
      preset_mode: null,
      percentage: 0,
      supported_features: 57,
    });
    window.cards[0].setConfig({
      entity: 'fan.mi_air_purifier_3c',
      toolbar_style: 'buttons',
    });
  });
  await page
    .locator('xiaomi-purifier-card')
    .first()
    .getByRole('button', { name: 'Max', exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(2);
  expect(await page.evaluate(() => window.calls)).toMatchObject([
    {
      domain: 'fan',
      service: 'turn_on',
      data: { preset_mode: 'Favorite' },
      target: { entity_id: 'fan.mi_air_purifier_3c' },
    },
    {
      domain: 'fan',
      service: 'set_percentage',
      data: { percentage: 100 },
      target: { entity_id: 'fan.mi_air_purifier_3c' },
    },
  ]);
});

test('generic fans start before Max when no manual preset is exposed', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.updateEntity('fan.zhimi_airp_vb4', 'off', {
      supported_features: 49,
      preset_modes: ['auto', 'sleep'],
      percentage: 0,
    }),
  );
  await page
    .locator('xiaomi-purifier-card')
    .first()
    .getByRole('button', { name: 'Max', exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(2);
  expect(
    await page.evaluate(() => window.calls.map((c) => [c.service, c.data])),
  ).toEqual([
    ['turn_on', {}],
    ['set_percentage', { percentage: 100 }],
  ]);
});

test('a rejected mode command stops Max before a speed command is issued', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.rejectCommand = true;
  });
  const card = page.locator('xiaomi-purifier-card').first();
  await card.getByRole('button', { name: 'Max', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText(
    'Device rejected command',
  );
  expect(await page.evaluate(() => window.calls.length)).toBe(1);
  await expect(
    card.getByRole('button', { name: 'Max', exact: true }),
  ).toBeEnabled();
});

test('the automatic dropdown includes Max on narrow cards', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.evaluate(() =>
    window.cards[0].setConfig({ ...window.maxConfig, toolbar_style: 'auto' }),
  );
  const card = page.locator('xiaomi-purifier-card').first();
  await expect(card.locator('.shortcut-menu')).toBeVisible();
  await card.locator('.shortcut-menu').selectOption({ label: 'Max' });
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(2);
  await expect(card.locator('.shortcut-menu')).toHaveValue('');
});

test('speed capability and the hide setting control Max visibility without removing custom shortcuts', async ({
  page,
}) => {
  const card = page.locator('xiaomi-purifier-card').first();
  await page.evaluate(() =>
    window.cards[0].setConfig({
      ...window.maxConfig,
      show_max_speed: false,
      shortcuts: [{ name: 'Custom Max', percentage: 66 }],
    }),
  );
  await expect(
    card.getByRole('button', { name: 'Max', exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole('button', { name: 'Custom Max', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.cards[0].setConfig(window.maxConfig);
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      supported_features: 56,
    });
  });
  await expect(
    card.getByRole('button', { name: 'Max', exact: true }),
  ).toHaveCount(0);
});

test('the visual editor can hide and restore the default Max action', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const editor = await customElements
      .get('xiaomi-purifier-card')
      .getConfigElement();
    editor.hass = window.hass;
    editor.setConfig(window.maxConfig);
    editor.addEventListener('config-changed', (event) => {
      window.cards[0].setConfig(event.detail.config);
      editor.setConfig(event.detail.config);
    });
    document.body.append(editor);
  });
  const editor = page.locator('xiaomi-purifier-card-editor');
  await editor.locator('.modes-editor > summary').click();
  const toggle = editor.getByRole('checkbox', {
    name: 'Show Max speed action',
    exact: true,
  });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(
    page
      .locator('xiaomi-purifier-card')
      .first()
      .getByRole('button', { name: 'Max', exact: true }),
  ).toHaveCount(0);
  await toggle.check();
  await expect(
    page
      .locator('xiaomi-purifier-card')
      .first()
      .getByRole('button', { name: 'Max', exact: true }),
  ).toBeVisible();
});
