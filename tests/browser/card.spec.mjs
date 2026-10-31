import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/tests/fixtures/demo.html');
  await expect(page.locator('xiaomi-purifier-card')).toHaveCount(2);
});

test('awaits the preset before sending the number command and prevents duplicate clicks', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.hass.callService = async (domain, service, data, target) => {
      window.calls.push({ domain, service, data, target });
      if (service === 'set_preset_mode')
        await new Promise((resolve) => {
          window.releaseCommand = resolve;
        });
    };
  });
  const button = page
    .locator('xiaomi-purifier-card')
    .first()
    .getByRole('button', { name: '75%', exact: true });
  await button.click();
  await expect(button).toBeDisabled();
  expect(await page.evaluate(() => window.calls.length)).toBe(1);
  await page.evaluate(() => window.releaseCommand());
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(2);
  await expect(button).toBeEnabled();
});

test('validates the complete shortcut before any command is sent', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.updateEntity('number.zhimi_airp_vb4_fan_level', 1, {
      min: 1,
      max: 1,
      step: 1,
    }),
  );
  const card = page.locator('xiaomi-purifier-card').first();
  await card.getByRole('button', { name: '100%', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('outside the range');
  expect(await page.evaluate(() => window.calls.length)).toBe(0);
});

test('supports percentage controls including zero and compact view', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.cards[0].setConfig({ ...window.configs[0], compact_view: true });
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      percentage: 50,
      percentage_step: 1,
      supported_features: 9,
    });
  });
  const card = page.locator('xiaomi-purifier-card').first();
  await expect(card.locator('.dial')).toHaveCount(0);
  const slider = card.getByRole('slider', { name: 'Fan speed' });
  await slider.fill('0');
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(1);
  expect(await page.evaluate(() => window.calls[0].data.percentage)).toBe(0);
});

test('resynchronizes the speed thumb when a mode change reports an unchanged percentage', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      percentage: 100,
      percentage_step: 1,
      supported_features: 9,
    }),
  );
  const card = page.locator('xiaomi-purifier-card').first();
  const slider = card.getByRole('slider', { name: 'Fan speed' });
  await expect(slider).toHaveValue('100');
  await slider.fill('65');
  await card
    .getByRole('combobox', { name: 'Preset mode' })
    .selectOption('Favorite');
  await page.evaluate(() =>
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      preset_mode: 'Favorite',
      percentage: 100,
    }),
  );
  await expect(card.locator('.speed-control > span')).toHaveText('100%');
  await expect(slider).toHaveValue('100');
});

test('the real 4 Pro fractional step reaches 100 percent and sends integer percentages', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      preset_mode: 'Favorite',
      percentage: 100,
      percentage_step: 33.333333333333336,
      supported_features: 57,
    }),
  );
  const card = page.locator('xiaomi-purifier-card').first();
  const slider = card.getByRole('slider', { name: 'Fan speed' });
  await expect(slider).toHaveAttribute('max', '3');
  await expect(slider).toHaveValue('3');
  await expect(card.locator('.speed-control > span')).toHaveText('100%');
  await slider.fill('2');
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(1);
  expect(await page.evaluate(() => window.calls[0].data.percentage)).toBe(67);
  await page.evaluate(() =>
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      percentage: 66,
    }),
  );
  await expect(slider).toHaveValue('2');
  await expect(card.locator('.speed-control > span')).toHaveText('66%');
});

test('sensor refreshes do not interrupt a speed adjustment', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      percentage: 100,
      percentage_step: 1,
      supported_features: 57,
    }),
  );
  const card = page.locator('xiaomi-purifier-card').first();
  const slider = card.getByRole('slider', { name: 'Fan speed' });
  await slider.evaluate((input) => {
    input.value = '65';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() =>
    window.updateEntity('sensor.zhimi_airp_vb4_motor_speed', 800),
  );
  await expect(slider).toHaveValue('65');
  await expect(card.locator('.speed-control > span')).toHaveText('65%');
  await slider.dispatchEvent('pointercancel');
  await expect(slider).toHaveValue('100');
});

test('exposes HA websocket error messages and clears pending state', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.hass.callService = async () => {
      throw { code: 'failed', message: 'Purifier is offline' };
    };
  });
  const card = page.locator('xiaomi-purifier-card').first();
  await card.getByRole('button', { name: 'Auto', exact: true }).click();
  await expect(card.getByRole('alert')).toHaveText('Purifier is offline');
  await expect(
    card.getByRole('button', { name: 'Auto', exact: true }),
  ).toBeEnabled();
});

test('both user configurations render without layout collapse even with missing images', async ({
  page,
}) => {
  const cards = page.locator('xiaomi-purifier-card');
  await expect(cards.first().locator('.friendly-name')).toHaveText(
    'Xiaomi Air Purifier 4 Pro',
  );
  await expect(cards.nth(1).locator('.stats-block')).toHaveCount(3);
  await page.evaluate(() => {
    for (const card of window.cards)
      card.shadowRoot.querySelector('img').src = '/missing.png';
  });
  for (const card of await cards.all()) {
    const dial = await card.locator('.dial').boundingBox();
    const metadata = await card.locator('.metadata').boundingBox();
    expect(dial.height).toBeGreaterThan(200);
    expect(metadata.y).toBeGreaterThanOrEqual(dial.y + dial.height);
  }
});

test('updates independent AQI and statistic entities including zero and unavailable readings', async ({
  page,
}) => {
  const card = page.locator('xiaomi-purifier-card').first();
  await page.evaluate(() =>
    window.updateEntity('sensor.zhimi_airp_vb4_pm2_5', 0),
  );
  await expect(card.locator('.number-on')).toHaveText('0');
  await expect(card.locator('.stats-value').nth(1)).toHaveText('0');
  await page.evaluate(() =>
    window.updateEntity('sensor.zhimi_airp_vb4_motor_speed', 'unavailable'),
  );
  await expect(card.locator('.stats-value').nth(2)).toHaveText('—');
});

test('executes Xiaomi mode and number commands in order with correct arguments', async ({
  page,
}) => {
  await page
    .locator('xiaomi-purifier-card')
    .first()
    .getByRole('button', { name: '75%', exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(2);
  expect(await page.evaluate(() => window.calls)).toEqual([
    {
      domain: 'fan',
      service: 'set_preset_mode',
      data: { preset_mode: 'Fan' },
      target: { entity_id: 'fan.zhimi_airp_vb4' },
    },
    {
      domain: 'number',
      service: 'set_value',
      data: { entity_id: 'number.zhimi_airp_vb4_fan_level', value: 2 },
    },
  ]);
  await page
    .locator('xiaomi-purifier-card')
    .nth(1)
    .getByRole('button', { name: '100%', exact: true })
    .click();
  expect(await page.evaluate(() => window.calls.at(-1).data.value)).toBe(2200);
});

test('legacy Silent shortcut works and command failure is visible without a stuck spinner', async ({
  page,
}) => {
  const card = page.locator('xiaomi-purifier-card').first();
  await card.getByRole('button', { name: 'Silent', exact: true }).click();
  expect(await page.evaluate(() => window.calls[0].data.preset_mode)).toBe(
    'Silent',
  );
  await page.evaluate(() => {
    window.rejectCommand = true;
  });
  await card.getByRole('button', { name: '50%', exact: true }).click();
  await expect(card.getByRole('alert')).toHaveText('Device rejected command');
  await expect(
    card.getByRole('button', { name: '50%', exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => window.calls.length)).toBe(2);
});

test('number-only state updates select the right shortcut', async ({
  page,
}) => {
  const card = page.locator('xiaomi-purifier-card').first();
  await page.evaluate(() => {
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      preset_mode: 'Fan',
    });
    window.updateEntity('number.zhimi_airp_vb4_fan_level', 2);
  });
  await expect(
    card.getByRole('button', { name: '75%', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    card.getByRole('button', { name: '50%', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() =>
    window.updateEntity('number.zhimi_airp_vb4_fan_level', 3),
  );
  await expect(
    card.getByRole('button', { name: '100%', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('unavailable fan disables commands while missing sensors render safely', async ({
  page,
}) => {
  const card = page.locator('xiaomi-purifier-card').first();
  await page.evaluate(() => {
    window.updateEntity('fan.zhimi_airp_vb4', 'unavailable');
    window.updateEntity('sensor.zhimi_airp_vb4_pm2_5', 'unavailable');
  });
  await expect(
    card.getByRole('button', { name: 'Auto', exact: true }),
  ).toBeDisabled();
  await expect(card.locator('.number-on')).toHaveText('—');
});

test('template statistics receive a real hass object and render their result', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.cards[0].setConfig({
      ...window.configs[0],
      stats: [
        {
          entity_id: 'sensor.zhimi_airp_vb4_pm2_5',
          value_template: '{{ value }}',
        },
      ],
    }),
  );
  await expect(
    page.locator('xiaomi-purifier-card').first().locator('ha-template'),
  ).toHaveText('formatted value');
});

test('basic editor reflects supplied settings and preserves advanced YAML on changes', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const Constructor = customElements.get('xiaomi-purifier-card');
    const editor = await Constructor.getConfigElement();
    editor.hass = window.hass;
    editor.setConfig({
      ...window.configs[0],
      show_name: false,
      show_state: false,
      compact_view: true,
    });
    editor.addEventListener('config-changed', (event) => {
      window.edited = event.detail.config;
    });
    document.body.append(editor);
  });
  const editor = page.locator('xiaomi-purifier-card-editor');
  await editor.locator('summary').filter({ hasText: 'Appearance' }).click();
  await expect(
    editor.getByRole('checkbox', { name: 'Compact View' }),
  ).toBeChecked();
  await expect(
    editor.getByRole('checkbox', { name: 'Show Name' }),
  ).not.toBeChecked();
  await editor.getByRole('checkbox', { name: 'Show Name' }).check();
  expect(await page.evaluate(() => window.edited.shortcuts.length)).toBe(5);
});

test('visual editor can add a main reading and statistics to a bare fan card', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const editor = await customElements
      .get('xiaomi-purifier-card')
      .getConfigElement();
    editor.hass = window.hass;
    const config = {
      type: 'custom:xiaomi-purifier-card',
      entity: 'fan.zhimi_airp_vb4',
    };
    editor.setConfig(config);
    window.cards[0].setConfig(config);
    editor.addEventListener('config-changed', (event) => {
      window.edited = event.detail.config;
      window.cards[0].setConfig(event.detail.config);
    });
    document.body.append(editor);
  });
  const editor = page.locator('xiaomi-purifier-card-editor');
  const main = editor.getByRole('combobox', {
    name: 'Reading sensor',
    exact: true,
  });
  await main.fill('sensor.zhimi_airp_vb4_pm2_5');
  await main.press('Tab');
  await expect(
    page.locator('xiaomi-purifier-card').first().locator('.number-on'),
  ).toHaveText('5');
  await editor
    .getByRole('button', { name: 'Add statistic', exact: true })
    .click();
  const source = editor.getByRole('combobox', {
    name: 'Statistic sensor 1',
    exact: true,
  });
  await source.fill('sensor.zhimi_airp_vb4_motor_speed');
  await source.press('Tab');
  await editor
    .getByRole('textbox', { name: 'Label 1', exact: true })
    .fill('Motor speed');
  await editor
    .getByRole('textbox', { name: 'Unit 1', exact: true })
    .fill('RPM');
  await editor
    .getByRole('textbox', { name: 'Unit 1', exact: true })
    .press('Tab');
  await expect(
    page.locator('xiaomi-purifier-card').first().locator('.stats-block'),
  ).toContainText('Motor speed');
  expect(await page.evaluate(() => window.edited.stats[0])).toMatchObject({
    entity_id: 'sensor.zhimi_airp_vb4_motor_speed',
    subtitle: 'Motor speed',
    unit: 'RPM',
  });
  await editor
    .getByRole('button', { name: 'Remove statistic 1', exact: true })
    .click();
  expect(await page.evaluate(() => window.edited.stats.length)).toBe(0);
});

test('editing and reordering statistics retains templates, attributes, and shortcuts', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const editor = await customElements
      .get('xiaomi-purifier-card')
      .getConfigElement();
    editor.hass = window.hass;
    editor.setConfig({
      ...window.configs[0],
      stats: [
        {
          attribute: 'motor_speed',
          subtitle: 'Motor',
          unit: 'RPM',
          value_template: '{{ value }}',
        },
        { entity_id: 'sensor.zhimi_airp_vb4_pm2_5', subtitle: 'PM 2.5' },
      ],
    });
    editor.addEventListener('config-changed', (event) => {
      window.edited = event.detail.config;
    });
    document.body.append(editor);
  });
  const editor = page.locator('xiaomi-purifier-card-editor');
  await editor
    .getByRole('textbox', { name: 'Label 1', exact: true })
    .fill('Motor speed');
  await editor
    .getByRole('textbox', { name: 'Label 1', exact: true })
    .press('Tab');
  await editor
    .getByRole('button', { name: 'Move statistic down 1', exact: true })
    .click();
  const edited = await page.evaluate(() => window.edited);
  expect(edited.stats[1]).toMatchObject({
    attribute: 'motor_speed',
    subtitle: 'Motor speed',
    value_template: '{{ value }}',
  });
  expect(edited.shortcuts.length).toBe(5);
});

for (const width of [320, 768, 1280])
  test(`fits a ${width}px viewport without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    for (const card of await page.locator('xiaomi-purifier-card').all()) {
      expect(
        await card.evaluate(
          (element) =>
            element.shadowRoot.querySelector('ha-card').scrollWidth <=
            element.clientWidth,
        ),
      ).toBe(true);
    }
    if (width === 1280)
      await page.screenshot({
        path: 'test-results/preview.png',
        fullPage: true,
      });
  });
