import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/tests/fixtures/demo.html');
  await expect(page.locator('xiaomi-purifier-card')).toHaveCount(2);
});

async function mountEditor(page, options = {}) {
  await page.evaluate(async ({ defer, fail, config }) => {
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      percentage: 33,
      percentage_step: 33.333333333333336,
      supported_features: 57,
    });
    window.updateEntity('fan.mi_air_purifier_3c', 'off', {
      ...window.hass.states['fan.mi_air_purifier_3c'].attributes,
      percentage: 0,
      percentage_step: 1,
      supported_features: 57,
    });
    const sources = [
      ['sensor.zhimi_airp_vb4_pm2_5', 'pm25', 'μg/m³', 'PM2.5'],
      ['sensor.zhimi_airp_vb4_pm10', 'pm10', 'μg/m³', 'PM10'],
      [
        'sensor.renamed_inlet_temperature',
        'temperature',
        '°C',
        'Inlet temperature',
      ],
      ['sensor.renamed_humidity', 'humidity', '%', 'Humidity'],
      ['sensor.zhimi_airp_vb4_motor_speed', undefined, 'RPM', 'Motor speed'],
      ['sensor.mi_air_purifier_3c_pm2_5', 'pm25', 'μg/m³', 'Bedroom PM2.5'],
    ];
    for (const [
      id,
      device_class,
      unit_of_measurement,
      friendly_name,
    ] of sources)
      window.updateEntity(id, id.includes('motor') ? 750 : 5, {
        device_class,
        unit_of_measurement,
        friendly_name,
      });
    window.registry = [
      { entity_id: 'fan.zhimi_airp_vb4', device_id: 'living-room' },
      { entity_id: 'fan.mi_air_purifier_3c', device_id: 'bedroom' },
      ...sources.map(([id]) => ({
        entity_id: id,
        device_id: id.includes('3c') ? 'bedroom' : 'living-room',
      })),
    ];
    window.registryCalls = 0;
    window.hass.callWS = async () => {
      window.registryCalls++;
      if (fail) throw new Error('Registry unavailable');
      if (defer)
        return new Promise((resolve) => {
          window.resolveRegistry = () =>
            resolve(structuredClone(window.registry));
        });
      return structuredClone(window.registry);
    };
    const editor = await customElements
      .get('xiaomi-purifier-card')
      .getConfigElement();
    editor.hass = window.hass;
    editor.setConfig(
      config ?? {
        type: 'custom:xiaomi-purifier-card',
        entity: 'fan.zhimi_airp_vb4',
      },
    );
    editor.addEventListener('config-changed', (event) => {
      window.detectedConfig = event.detail.config;
      editor.setConfig(structuredClone(event.detail.config));
      window.cards[0].setConfig(event.detail.config);
    });
    window.discoveryEditor = editor;
    document.body.append(editor);
  }, options);
  return page.locator('xiaomi-purifier-card-editor');
}

test('automatically fills measured RPM and the four same-device statistics', async ({
  page,
}) => {
  const editor = await mountEditor(page);
  await expect(
    editor.getByRole('combobox', { name: 'Reading sensor', exact: true }),
  ).toHaveValue('sensor.zhimi_airp_vb4_motor_speed');
  await expect(
    editor.getByRole('textbox', { name: 'Reading unit or label', exact: true }),
  ).toHaveValue('RPM');
  await expect(editor.locator('.stat-editor')).toHaveCount(4);
  expect(
    await page.evaluate(() =>
      window.detectedConfig.stats.map((stat) => stat.entity_id),
    ),
  ).toEqual([
    'sensor.zhimi_airp_vb4_pm2_5',
    'sensor.zhimi_airp_vb4_pm10',
    'sensor.renamed_inlet_temperature',
    'sensor.renamed_humidity',
  ]);
  await expect(
    page.locator('xiaomi-purifier-card').first().locator('.number-on'),
  ).toHaveText('750');
  expect(await page.evaluate(() => window.registryCalls)).toBe(1);
});

test('manual changes survive refreshes and re-detection adds only missing readings', async ({
  page,
}) => {
  const editor = await mountEditor(page);
  await expect(editor.locator('.stat-editor')).toHaveCount(4);
  await editor
    .getByRole('textbox', { name: 'Label 1', exact: true })
    .fill('My particulate reading');
  await editor
    .getByRole('textbox', { name: 'Label 1', exact: true })
    .press('Tab');
  await editor
    .getByRole('combobox', { name: 'Reading sensor', exact: true })
    .fill('sensor.zhimi_airp_vb4_pm2_5');
  await editor
    .getByRole('combobox', { name: 'Reading sensor', exact: true })
    .press('Tab');
  await expect(
    editor.getByRole('textbox', { name: 'Reading unit or label', exact: true }),
  ).toHaveValue('μg/m³');
  await editor
    .getByRole('button', { name: 'Remove statistic 4', exact: true })
    .click();
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      window.discoveryEditor.hass = { ...window.hass };
      window.discoveryEditor.setConfig(structuredClone(window.detectedConfig));
    }
  });
  await expect(editor.locator('.stat-editor')).toHaveCount(3);
  expect(await page.evaluate(() => window.registryCalls)).toBe(1);
  await editor
    .getByRole('button', { name: 'Detect missing sensors', exact: true })
    .click();
  await expect(editor.locator('.stat-editor')).toHaveCount(4);
  await expect(
    editor.getByRole('textbox', { name: 'Label 1', exact: true }),
  ).toHaveValue('My particulate reading');
  await expect(
    editor.getByRole('combobox', { name: 'Reading sensor', exact: true }),
  ).toHaveValue('sensor.zhimi_airp_vb4_pm2_5');
  expect(await page.evaluate(() => window.registryCalls)).toBe(2);
});

test('switching fan replaces generated defaults and omits unsupported statistics', async ({
  page,
}) => {
  const editor = await mountEditor(page);
  await expect(editor.locator('.stat-editor')).toHaveCount(4);
  await editor
    .getByRole('combobox', { name: 'Entity', exact: true })
    .selectOption('fan.mi_air_purifier_3c');
  await expect(editor.locator('.stat-editor')).toHaveCount(1);
  expect(await page.evaluate(() => window.detectedConfig.aqi)).toEqual({
    attribute: 'percentage',
    unit: '%',
  });
  expect(
    await page.evaluate(() => window.detectedConfig.stats[0].entity_id),
  ).toBe('sensor.mi_air_purifier_3c_pm2_5');
  await expect(
    page.locator('xiaomi-purifier-card').first().locator('.number-on'),
  ).toHaveText('0');
});

test('a lookup finishing for a previous fan cannot populate the new fan with old sensors', async ({
  page,
}) => {
  const editor = await mountEditor(page, { defer: true });
  await expect(
    editor.getByRole('button', { name: 'Detecting sensors…', exact: true }),
  ).toBeDisabled();
  await editor
    .getByRole('combobox', { name: 'Entity', exact: true })
    .selectOption('fan.mi_air_purifier_3c');
  await page.evaluate(() => window.resolveRegistry());
  await expect(editor.locator('.stat-editor')).toHaveCount(1);
  expect(await page.evaluate(() => window.detectedConfig.entity)).toBe(
    'fan.mi_air_purifier_3c',
  );
  expect(
    await page.evaluate(() => window.detectedConfig.stats[0].entity_id),
  ).toBe('sensor.mi_air_purifier_3c_pm2_5');
});

test('late detection preserves a sensor draft while filling other sections', async ({
  page,
}) => {
  const editor = await mountEditor(page, { defer: true });
  const input = editor.getByRole('combobox', {
    name: 'Reading sensor',
    exact: true,
  });
  await input.pressSequentially('sensor.zhimi_airp_vb4_pm2', { delay: 10 });
  await page.evaluate(() => window.resolveRegistry());
  await expect(editor.locator('.stat-editor')).toHaveCount(4);
  await expect(input).toHaveValue('sensor.zhimi_airp_vb4_pm2');
  await expect(input).toBeFocused();
  await input.pressSequentially('_5');
  await input.press('Tab');
  expect(await page.evaluate(() => window.detectedConfig.aqi.entity_id)).toBe(
    'sensor.zhimi_airp_vb4_pm2_5',
  );
});

test('registry failure leaves a percentage fallback and usable manual fields', async ({
  page,
}) => {
  const editor = await mountEditor(page, { fail: true });
  await expect(
    editor.getByRole('button', { name: 'Detect missing sensors', exact: true }),
  ).toBeEnabled();
  await expect(editor.locator('.detection [role=status]')).toContainText(
    'could not be loaded',
  );
  expect(await page.evaluate(() => window.detectedConfig.aqi)).toEqual({
    attribute: 'percentage',
    unit: '%',
  });
  const input = editor.getByRole('combobox', {
    name: 'Reading sensor',
    exact: true,
  });
  await input.fill('sensor.zhimi_airp_vb4_pm2_5');
  await input.press('Tab');
  expect(await page.evaluate(() => window.detectedConfig.aqi.entity_id)).toBe(
    'sensor.zhimi_airp_vb4_pm2_5',
  );
});
