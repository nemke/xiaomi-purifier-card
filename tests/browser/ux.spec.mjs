import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/tests/fixtures/demo.html');
  await page.waitForFunction(() => window.cards?.length === 2);
  await page.evaluate(() => {
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      percentage: 33,
      percentage_step: 33.333333333333336,
      supported_features: 57,
    });
    window.updateEntity('fan.mi_air_purifier_3c', 'off', {
      ...window.hass.states['fan.mi_air_purifier_3c'].attributes,
      preset_modes: ['Auto', 'Silent', 'Favorite'],
      percentage: 0,
      supported_features: 57,
    });
    const data = [
      [
        'number.zhimi_airp_vb4_favorite_level',
        4,
        { min: 0, max: 14, step: 1, friendly_name: 'Favorite level' },
      ],
      [
        'number.zhimi_airp_vb4_fan_level',
        1,
        { min: 1, max: 3, step: 1, friendly_name: 'Fan level' },
      ],
      [
        'number.mi_air_purifier_3c_favorite_motor_speed',
        750,
        {
          min: 300,
          max: 2200,
          step: 10,
          unit_of_measurement: 'rpm',
          friendly_name: 'Favorite speed',
        },
      ],
      [
        'switch.zhimi_airp_vb4_child_lock',
        'off',
        { friendly_name: 'Child lock' },
      ],
      ['switch.zhimi_airp_vb4_buzzer', 'on', { friendly_name: 'Buzzer' }],
      [
        'select.zhimi_airp_vb4_led_brightness',
        'Bright',
        { friendly_name: 'Display', options: ['Bright', 'Dim', 'Off'] },
      ],
      [
        'sensor.zhimi_airp_vb4_pm2_5',
        5,
        { device_class: 'pm25', unit_of_measurement: 'μg/m³' },
      ],
      [
        'sensor.zhimi_airp_vb4_pm10',
        1,
        { device_class: 'pm10', unit_of_measurement: 'μg/m³' },
      ],
      [
        'sensor.zhimi_airp_vb4_temperature',
        23.9,
        {
          device_class: 'temperature',
          unit_of_measurement: '°C',
          friendly_name: 'Temperature',
        },
      ],
      [
        'sensor.zhimi_airp_vb4_humidity',
        0,
        {
          device_class: 'humidity',
          unit_of_measurement: '%',
          friendly_name: 'Humidity',
        },
      ],
      [
        'sensor.zhimi_airp_vb4_filter_life_remaining',
        92,
        { unit_of_measurement: '%' },
      ],
      [
        'sensor.zhimi_airp_vb4_motor_speed',
        488,
        { unit_of_measurement: 'rpm' },
      ],
      [
        'sensor.other_temperature',
        30,
        {
          device_class: 'temperature',
          unit_of_measurement: '°C',
          friendly_name: 'AAA Other room',
        },
      ],
    ];
    for (const [id, value, attributes] of data)
      window.updateEntity(id, value, attributes);
    window.uxRegistry = Object.keys(window.hass.states).map((entity_id) => ({
      entity_id,
      device_id: entity_id.includes('vb4') ? 'living' : 'other',
    }));
    window.registryCalls = 0;
    window.hass.callWS = async () => {
      window.registryCalls++;
      return structuredClone(window.uxRegistry);
    };
  });
});

async function editor(page, config = { entity: 'fan.zhimi_airp_vb4' }) {
  await page.evaluate(async (config) => {
    const editor = await customElements
      .get('xiaomi-purifier-card')
      .getConfigElement();
    editor.hass = window.hass;
    editor.setConfig(config);
    editor.addEventListener('config-changed', (event) => {
      window.uxConfig = event.detail.config;
      window.cards[0].setConfig(window.uxConfig);
      editor.setConfig(structuredClone(window.uxConfig));
    });
    window.uxEditor = editor;
    document.body.append(editor);
  }, config);
  const result = page.locator('xiaomi-purifier-card-editor');
  await expect(result.locator('.detection [role=status]')).toContainText(
    'detected',
  );
  return result;
}

async function bare(page) {
  await page.evaluate(() =>
    window.cards[0].setConfig({
      entity: 'fan.zhimi_airp_vb4',
      aqi: { entity_id: 'sensor.zhimi_airp_vb4_motor_speed', unit: 'rpm' },
    }),
  );
  return page.locator('xiaomi-purifier-card').first();
}

test('five statistics use compact live summaries and preserve expanded rows across edits and reordering', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const form = await editor(page);
  await expect(form.locator('.stat-editor')).toHaveCount(5);
  await expect(form.locator('.stat-editor[open]')).toHaveCount(0);
  expect((await form.boundingBox()).height).toBeLessThan(1500);
  await expect(
    form.locator('.stat-editor').nth(3).locator('summary').first(),
  ).toContainText('0 %');
  await page.evaluate(() => {
    window.updateEntity(
      'sensor.zhimi_airp_vb4_humidity',
      60,
      window.hass.states['sensor.zhimi_airp_vb4_humidity'].attributes,
    );
    window.uxEditor.hass = window.hass;
  });
  await expect(
    form.locator('.stat-editor').nth(3).locator('summary').first(),
  ).toContainText('60 %');
  const row = form.locator('.stat-editor').nth(2);
  await row.locator('summary').first().click();
  const handle = await row.elementHandle();
  await row
    .getByRole('textbox', { name: 'Label 3', exact: true })
    .fill('Room temperature');
  await row.getByRole('textbox', { name: 'Label 3', exact: true }).press('Tab');
  await row
    .getByRole('button', { name: 'Move statistic up 3', exact: true })
    .click();
  await expect(
    form.locator('.stat-editor').nth(1).locator('summary').first(),
  ).toContainText('Room temperature');
  expect(
    await handle.evaluate((element) => element.isConnected && element.open),
  ).toBe(true);
  expect(await page.evaluate(() => window.registryCalls)).toBe(1);
});

test('source suggestions put the selected device first while allowing other sensors', async ({
  page,
}) => {
  const form = await editor(page);
  const options = await form
    .locator('#reading-entities option')
    .evaluateAll((items) =>
      items.map((item) => ({ id: item.value, related: item.dataset.related })),
    );
  const firstOther = options.findIndex((item) => item.related === 'false');
  expect(firstOther).toBeGreaterThan(0);
  expect(
    options.slice(firstOther).every((item) => item.related === 'false'),
  ).toBe(true);
  expect(options.some((item) => item.id === 'sensor.other_temperature')).toBe(
    true,
  );
});

test('built-in modes can be hidden and reordered independently of the status label', async ({
  page,
}) => {
  const form = await editor(page);
  await form.locator('.modes-editor > summary').click();
  await form
    .getByRole('checkbox', { name: 'Show mode Fan', exact: true })
    .uncheck();
  await form
    .getByRole('button', { name: 'Move mode up Silent', exact: true })
    .click();
  const card = page.locator('xiaomi-purifier-card').first();
  expect(
    await card
      .locator('.shortcuts button')
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute('aria-label')),
      ),
  ).toEqual(['Silent', 'Auto', 'Favorite', 'Max']);
  await form
    .getByRole('button', { name: 'Use all modes automatically', exact: true })
    .click();
  await expect(
    card.getByRole('button', { name: 'Fan', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.uxConfig.speed_controls.length)).toBe(
    2,
  );
  expect(
    await page.evaluate(() => window.uxConfig.device_controls.length),
  ).toBe(3);
});

test('the visual shortcut editor creates an ordered preset and number action', async ({
  page,
}) => {
  const form = await editor(page);
  await form.locator('.modes-editor > summary').click();
  await form.getByRole('button', { name: 'Add shortcut', exact: true }).click();
  const name = form.getByRole('textbox', {
    name: 'Shortcut name 1',
    exact: true,
  });
  await name.fill('Boost');
  await name.press('Tab');
  await form
    .getByRole('combobox', { name: 'Shortcut action 1', exact: true })
    .selectOption('number');
  await form
    .getByRole('combobox', { name: 'Preset mode 1', exact: true })
    .selectOption('Favorite');
  await form
    .getByRole('combobox', { name: 'Target number 1', exact: true })
    .selectOption('number.zhimi_airp_vb4_favorite_level');
  const value = form.getByRole('spinbutton', { name: 'Value 1', exact: true });
  await value.fill('7');
  await value.press('Tab');
  await page
    .locator('xiaomi-purifier-card')
    .first()
    .getByRole('button', { name: 'Boost', exact: true })
    .click();
  expect(
    await page.evaluate(() => window.calls.map((call) => call.service)),
  ).toEqual(['set_preset_mode', 'set_value']);
  expect(await page.evaluate(() => window.calls[1])).toMatchObject({
    domain: 'number',
    data: { value: 7 },
    target: { entity_id: 'number.zhimi_airp_vb4_favorite_level' },
  });
});

test('automatic toolbars expose every shortcut through a dropdown on phones', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.evaluate(() => window.cards[1].setConfig(window.configs[1]));
  const card = page.locator('xiaomi-purifier-card').nth(1);
  const menu = card.getByRole('combobox', {
    name: 'Run shortcut',
    exact: true,
  });
  await expect(menu).toBeVisible();
  await expect(menu.locator('option')).toHaveCount(8);
  await expect(menu.locator('option').last()).toHaveText('Max');
  await page.evaluate(() =>
    window.updateEntity('fan.mi_air_purifier_3c', 'on', {
      ...window.hass.states['fan.mi_air_purifier_3c'].attributes,
      preset_mode: 'Silent',
    }),
  );
  await menu.selectOption('5');
  expect(await page.evaluate(() => window.calls[0].data.preset_mode)).toBe(
    'Auto',
  );
  await expect(menu).toHaveValue('');
});

test('preset feedback follows reported state and keyboard focus returns after the command', async ({
  page,
}) => {
  const card = await bare(page);
  await page.evaluate(() => {
    window.hass.callService = (...args) =>
      new Promise((resolve) => {
        window.calls.push(args);
        window.finishUxCommand = resolve;
      });
  });
  const silent = card.getByRole('button', { name: 'Silent', exact: true });
  await silent.focus();
  await page.keyboard.press('Enter');
  await expect(card.locator('.command-status')).toContainText(
    'Sending: Silent',
  );
  await expect(silent).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => window.finishUxCommand());
  await expect(silent).toBeFocused();
  await expect(card.locator('.command-status')).toContainText(
    'Waiting for device: Silent',
  );
  await expect(card.locator('.number-on')).toHaveText('488');
  await page.evaluate(() =>
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      preset_mode: 'Silent',
    }),
  );
  await expect(silent).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.command-status')).toHaveCount(0);
});

test('completed commands never steal focus from another editor field', async ({
  page,
}) => {
  const card = await bare(page);
  await page.evaluate(() => {
    window.hass.callService = () =>
      new Promise((resolve) => {
        window.finishUxCommand = resolve;
      });
    const input = document.createElement('input');
    input.id = 'outside-field';
    document.body.append(input);
  });
  await card.getByRole('button', { name: 'Silent', exact: true }).click();
  const outside = page.locator('#outside-field');
  await outside.focus();
  await page.evaluate(() => window.finishUxCommand());
  await expect(
    card.getByRole('button', { name: 'Silent', exact: true }),
  ).toBeEnabled();
  await expect(outside).toBeFocused();
});

test('an unconfirmed setting remains honest and clears when the device eventually reports it', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-01T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-01T12:00:01Z'));
  const card = await bare(page);
  await card.getByRole('button', { name: 'Silent', exact: true }).click();
  await page.clock.runFor(15000);
  await expect(card.locator('.command-status')).toContainText(
    'Device has not confirmed',
  );
  await expect(
    card.getByRole('button', { name: 'Silent', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() =>
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      preset_mode: 'Silent',
    }),
  );
  await expect(card.locator('.command-status')).toHaveCount(0);
});

test('manual targets obey their number entity and preserve measured RPM', async ({
  page,
}) => {
  await editor(page);
  const card = page.locator('xiaomi-purifier-card').first();
  await card
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  const target = card.getByRole('spinbutton', {
    name: 'Favorite level',
    exact: true,
  });
  await expect(target).toHaveAttribute('min', '0');
  await expect(target).toHaveAttribute('max', '14');
  await target.fill('7');
  await card
    .getByRole('button', { name: 'Apply Favorite level', exact: true })
    .click();
  expect(
    await page.evaluate(() => window.calls.map((call) => call.service)),
  ).toEqual(['set_preset_mode', 'set_value']);
  await expect(card.locator('.number-on')).toHaveText('488');
  await expect(card.locator('.control-reported').first()).toContainText('4');
  await page.evaluate(() => {
    window.updateEntity('fan.zhimi_airp_vb4', 'on', {
      ...window.hass.states['fan.zhimi_airp_vb4'].attributes,
      preset_mode: 'Favorite',
    });
    window.updateEntity('number.zhimi_airp_vb4_favorite_level', 7);
  });
  await expect(card.locator('.command-status')).toHaveCount(0);
  await expect(target).toHaveValue('7');
  await target.fill('15');
  await card
    .getByRole('button', { name: 'Apply Favorite level', exact: true })
    .click();
  expect(await page.evaluate(() => window.calls.length)).toBe(2);
});

test('3C Favorite RPM targets turn on in the correct mode and never use fan percentage', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.updateEntity('sensor.mi_air_purifier_3c_motor_speed', 0);
    window.cards[0].setConfig({
      entity: 'fan.mi_air_purifier_3c',
      aqi: { entity_id: 'sensor.mi_air_purifier_3c_motor_speed', unit: 'rpm' },
      speed_controls: [
        {
          entity_id: 'number.mi_air_purifier_3c_favorite_motor_speed',
          preset_mode: 'Favorite',
        },
      ],
    });
  });
  const card = page.locator('xiaomi-purifier-card').first();
  await card
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  const target = card.getByRole('spinbutton', {
    name: 'Favorite speed',
    exact: true,
  });
  await target.fill('1000');
  await card
    .getByRole('button', { name: 'Apply Favorite speed', exact: true })
    .click();
  expect(
    await page.evaluate(() => window.calls.map((call) => call.service)),
  ).toEqual(['turn_on', 'set_value']);
  expect(await page.evaluate(() => window.calls[0].data.preset_mode)).toBe(
    'Favorite',
  );
  expect(await page.evaluate(() => window.calls[1].data.value)).toBe(1000);
  await expect(card.locator('.number-on')).toHaveText('0');
});

test('device settings send proper switch and select actions and observe actual reports', async ({
  page,
}) => {
  await editor(page);
  const card = page.locator('xiaomi-purifier-card').first();
  await card
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  const lock = card.getByRole('switch', { name: 'Child lock', exact: true });
  await lock.check();
  expect(await page.evaluate(() => window.calls[0])).toMatchObject({
    domain: 'switch',
    service: 'turn_on',
    target: { entity_id: 'switch.zhimi_airp_vb4_child_lock' },
  });
  await expect(lock).toBeChecked();
  await page.evaluate(() =>
    window.updateEntity('switch.zhimi_airp_vb4_child_lock', 'on'),
  );
  await expect(card.locator('.command-status')).toHaveCount(0);
  await card
    .getByRole('combobox', { name: 'Display', exact: true })
    .selectOption('Off');
  expect(await page.evaluate(() => window.calls[1])).toMatchObject({
    domain: 'select',
    service: 'select_option',
    data: { option: 'Off' },
    target: { entity_id: 'select.zhimi_airp_vb4_led_brightness' },
  });
});

test('a rejected settings command reverts its pending toggle and leaves controls usable', async ({
  page,
}) => {
  await editor(page);
  const card = page.locator('xiaomi-purifier-card').first();
  await card
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  await page.evaluate(() => {
    window.hass.callService = async () => {
      throw new Error('Setting rejected');
    };
  });
  const lock = card.getByRole('switch', { name: 'Child lock', exact: true });
  await lock.click();
  await expect(card.getByRole('alert')).toHaveText('Setting rejected');
  await expect(lock).not.toBeChecked();
  await expect(lock).toBeEnabled();
});

test('custom shortcut metadata and action order survive renaming and reordering', async ({
  page,
}) => {
  const original = {
    name: 'Night routine',
    icon: 'mdi:weather-night',
    actions: [
      {
        service: 'switch.turn_off',
        target: { entity_id: 'switch.zhimi_airp_vb4_buzzer' },
        service_data: {},
      },
    ],
    state_entity: 'switch.zhimi_airp_vb4_buzzer',
    state: 'off',
  };
  const form = await editor(page, {
    entity: 'fan.zhimi_airp_vb4',
    shortcuts: [original, { name: 'Automatic', preset_mode: 'Auto' }],
  });
  await form.locator('.modes-editor > summary').click();
  await form.locator('.shortcut-editor > summary').first().click();
  const name = form.getByRole('textbox', {
    name: 'Shortcut name 1',
    exact: true,
  });
  await name.fill('Bedtime');
  await name.press('Tab');
  await form
    .getByRole('button', { name: 'Move shortcut down 1', exact: true })
    .click();
  expect(await page.evaluate(() => window.uxConfig.shortcuts[1])).toEqual({
    ...original,
    name: 'Bedtime',
  });
  await expect(form.locator('.shortcut-editor').nth(1)).toHaveAttribute(
    'open',
    '',
  );
  const actions = form.getByRole('textbox', {
    name: 'Action sequence (JSON) 2',
    exact: true,
  });
  await actions.fill('[');
  await actions.press('Tab');
  expect(
    await page.evaluate(() => window.uxConfig.shortcuts[1].actions),
  ).toEqual(original.actions);
  await page.evaluate(() => {
    window.uxEditor.hass = { ...window.hass };
    window.uxEditor.setConfig(structuredClone(window.uxConfig));
  });
  await expect(actions).toHaveValue('[');
  await actions.fill(JSON.stringify(original.actions));
  await actions.press('Tab');
  expect(
    await page.evaluate(() => window.uxConfig.shortcuts[1].state_entity),
  ).toBe(original.state_entity);
});

test('selecting a built-in preset while off explicitly turns on with that preset', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.cards[0].setConfig({ entity: 'fan.mi_air_purifier_3c' }),
  );
  const card = page.locator('xiaomi-purifier-card').first();
  await card.getByRole('button', { name: 'Silent', exact: true }).click();
  expect(await page.evaluate(() => window.calls[0])).toMatchObject({
    domain: 'fan',
    service: 'turn_on',
    data: { preset_mode: 'Silent' },
    target: { entity_id: 'fan.mi_air_purifier_3c' },
  });
  await expect(
    card.getByRole('button', { name: 'Silent', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() =>
    window.updateEntity('fan.mi_air_purifier_3c', 'on', {
      ...window.hass.states['fan.mi_air_purifier_3c'].attributes,
      preset_mode: 'Silent',
    }),
  );
  await expect(
    card.getByRole('button', { name: 'Silent', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('manual control configuration is editable and explicit removal survives re-detection', async ({
  page,
}) => {
  const form = await editor(page);
  await form.locator('.controls-editor > summary').click();
  const label = form.getByRole('textbox', {
    name: 'Control name speed 1',
    exact: true,
  });
  await label.fill('My Favorite target');
  await label.press('Tab');
  await form
    .getByRole('button', { name: 'Detect missing sensors', exact: true })
    .click();
  await expect(label).toHaveValue('My Favorite target');
  expect(await page.evaluate(() => window.uxConfig.speed_controls.length)).toBe(
    2,
  );
  await form
    .getByRole('button', { name: 'Remove control setting 3', exact: true })
    .click();
  expect(
    await page.evaluate(() => window.uxConfig.device_controls.length),
  ).toBe(2);
  await page.evaluate(() => {
    window.uxEditor.hass = { ...window.hass };
    window.uxEditor.setConfig(structuredClone(window.uxConfig));
  });
  expect(
    await page.evaluate(() => window.uxConfig.device_controls.length),
  ).toBe(2);
});

test('newly opened dropdowns show configured values and the action menu starts empty', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.updateEntity(
      'select.zhimi_airp_vb4_led_brightness',
      'Off',
      window.hass.states['select.zhimi_airp_vb4_led_brightness'].attributes,
    ),
  );
  const form = await editor(page, {
    entity: 'fan.mi_air_purifier_3c',
    toolbar_style: 'dropdown',
    shortcuts: [
      {
        name: 'Favorite target',
        preset_mode: 'Favorite',
        service: 'number.set_value',
        target: { entity_id: 'number.mi_air_purifier_3c_favorite_motor_speed' },
        service_data: { value: 1250 },
      },
    ],
    speed_controls: [
      {
        entity_id: 'number.mi_air_purifier_3c_favorite_motor_speed',
        preset_mode: 'Favorite',
      },
    ],
    device_controls: [{ entity_id: 'select.zhimi_airp_vb4_led_brightness' }],
  });
  await expect(
    form.getByRole('combobox', { name: 'Entity', exact: true }),
  ).toHaveValue('fan.mi_air_purifier_3c');
  await form.locator('.modes-editor > summary').click();
  await expect(
    form.getByRole('combobox', { name: 'Toolbar style', exact: true }),
  ).toHaveValue('dropdown');
  await form.locator('.shortcut-editor > summary').click();
  await expect(
    form.getByRole('combobox', { name: 'Shortcut action 1', exact: true }),
  ).toHaveValue('number');
  await expect(
    form.getByRole('combobox', { name: 'Preset mode 1', exact: true }),
  ).toHaveValue('Favorite');
  await expect(
    form.getByRole('combobox', { name: 'Target number 1', exact: true }),
  ).toHaveValue('number.mi_air_purifier_3c_favorite_motor_speed');
  const card = page.locator('xiaomi-purifier-card').first();
  await expect(card.locator('.shortcut-menu')).toHaveValue('');
  await card
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  await expect(
    card.getByRole('combobox', { name: 'Display', exact: true }),
  ).toHaveValue('Off');
});
