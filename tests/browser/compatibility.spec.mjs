import { test, expect } from '@playwright/test';
import fixtures from '../fixtures/purifiers.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/tests/fixtures/demo.html');
  await page.waitForFunction(() => window.cards?.length === 2);
});

async function install(page, key, manual = false) {
  await page.evaluate(
    ({ fixture, manual }) => {
      const states = Object.fromEntries(
        Object.entries(fixture.states).map(([entity_id, value]) => [
          entity_id,
          {
            ...value,
            entity_id,
            context: { id: 'fixture' },
            last_changed: '2026-11-01T12:00:00Z',
            last_updated: '2026-11-01T12:00:00Z',
          },
        ]),
      );
      window.hass = {
        ...window.hass,
        states,
        callWS: async () => structuredClone(fixture.registry),
      };
      for (const card of window.cards) card.hass = window.hass;
      window.cards[1].remove();
      document.querySelector('main').style.display = 'block';
      window.compatConfig = {
        entity: fixture.fan,
        ...(manual ? fixture.manual_config : {}),
      };
      window.cards[0].setConfig(window.compatConfig);
    },
    { fixture: fixtures[key], manual },
  );
  return page.locator('xiaomi-purifier-card').first();
}
async function editor(page) {
  await page.evaluate(async () => {
    const element = await customElements
      .get('xiaomi-purifier-card')
      .getConfigElement();
    element.hass = window.hass;
    element.setConfig(window.compatConfig);
    element.addEventListener('config-changed', (event) => {
      window.compatConfig = event.detail.config;
      window.cards[0].setConfig(window.compatConfig);
      element.setConfig(structuredClone(window.compatConfig));
    });
    window.compatEditor = element;
    document.body.append(element);
  });
  const form = page.locator('xiaomi-purifier-card-editor');
  await expect(form.locator('.detection [role=status]')).toContainText(
    'detected',
  );
  return form;
}
async function update(page, id, state, patch = {}) {
  await page.evaluate(
    ({ id, state, patch }) => {
      window.updateEntity(id, state, {
        ...window.hass.states[id].attributes,
        ...patch,
      });
      if (window.compatEditor) window.compatEditor.hass = window.hass;
    },
    { id, state, patch },
  );
}

for (const key of Object.keys(fixtures)) {
  test(`${key}: auto configuration preserves real units and supported controls`, async ({
    page,
  }) => {
    const card = await install(page, key);
    await editor(page);
    await expect(card.locator('.aqi-unit')).toHaveText('%');
    await expect(card.locator('.number-on')).toHaveText(
      key === 'esphome' ? '50' : '—',
    );
    await expect(card.locator('.stats-block').first()).toContainText('µg/m³');
    const expected =
      fixtures[key].states[fixtures[key].fan].attributes.preset_modes;
    expect(await page.evaluate(() => window.compatConfig.entity)).toBe(
      fixtures[key].fan,
    );
    for (const mode of expected)
      await expect(
        card.locator(`button[aria-label="${mode === 'auto' ? 'Auto' : mode}"]`),
      ).toBeVisible();
    expect(
      await page.evaluate(() => window.compatConfig.speed_controls),
    ).toEqual([]);
    await expect(card.locator('.aqi-unit')).not.toHaveText(/rpm/i);
  });
}

test('VeSync presets power on with native spelling and confirm only after reported state arrives', async ({
  page,
}) => {
  const card = await install(page, 'vesync');
  await update(page, fixtures.vesync.fan, 'off');
  await card.getByRole('button', { name: 'sleep', exact: true }).click();
  expect(await page.evaluate(() => window.calls)).toEqual([
    {
      domain: 'fan',
      service: 'turn_on',
      data: { preset_mode: 'sleep' },
      target: { entity_id: 'fan.levoit_purifier' },
    },
  ]);
  await expect(card.locator('.command-status')).toContainText(
    'Waiting for device',
  );
  await update(page, fixtures.vesync.fan, 'on', { preset_mode: 'sleep' });
  await expect(card.locator('.command-status')).toHaveCount(0);
  await expect(
    card.getByRole('button', { name: 'sleep', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.number-on')).toHaveText('—');
});

test('VeSync settings discover display, child lock and night light without guessing speed targets', async ({
  page,
}) => {
  const card = await install(page, 'vesync');
  await editor(page);
  await card
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  const light = card.getByRole('combobox', {
    name: 'Night light',
    exact: true,
  });
  await expect(light).toHaveValue('dim');
  await light.selectOption('off');
  expect(await page.evaluate(() => window.calls.at(-1))).toMatchObject({
    domain: 'select',
    service: 'select_option',
    data: { option: 'off' },
    target: { entity_id: 'select.levoit_night_light_level' },
  });
  await update(page, 'select.levoit_night_light_level', 'off');
  await expect(card.locator('.command-status')).toHaveCount(0);
  await expect(
    card.getByRole('switch', { name: 'Display', exact: true }),
  ).toBeChecked();
  await expect(card.locator('input[type=number]')).toHaveCount(0);
  await expect(card.locator('.filter-notice')).toContainText('18% remaining');
});

test('ESPHome airflow, PM and filter readings update independently of the fan entity', async ({
  page,
}) => {
  const card = await install(page, 'esphome', true);
  await expect(card.locator('.stats-block').nth(2)).toContainText('55');
  await update(page, 'sensor.levoit_vital100s_current_cadr', 221);
  await expect(card.locator('.stats-block').nth(2)).toContainText('221');
  await expect(card.locator('.stats-block').nth(2)).toContainText('m³/h');
  await update(page, 'sensor.levoit_vital100s_pm_2_5', 0);
  await expect(card.locator('.stats-value').first()).toHaveText('0');
  await update(page, 'sensor.levoit_vital100s_filter', 0);
  await expect(card.locator('.filter-notice')).toContainText('0% remaining');
  await update(page, 'sensor.levoit_vital100s_current_cadr', 'unavailable');
  await expect(card.locator('.stats-value').nth(2)).toHaveText('—');
  await expect(card.locator('.number-on')).toHaveText('50');
});

test('STARKVIND keeps native replacement flags separate from filter age and allows an explicit level readout', async ({
  page,
}) => {
  const card = await install(page, 'starkvind');
  await editor(page);
  await expect(card.locator('.filter-notice')).toHaveText('Replace filter');
  await expect(card.locator('.stats-block')).toHaveCount(1);
  await update(page, 'binary_sensor.starkvind_replace_filter', 'off');
  await expect(card.locator('.filter-notice')).toHaveCount(0);
  await page.evaluate((config) => {
    window.cards[0].setConfig({ entity: 'fan.starkvind', ...config });
  }, fixtures.starkvind.manual_config);
  await expect(card.locator('.number-on')).toHaveText('9');
  await expect(card.locator('.aqi-unit')).toHaveText('level');
  await expect(card.locator('.stats-block').nth(1)).toContainText('270000');
  await expect(card.locator('.stats-unit').nth(1)).toHaveText('min');
  await update(page, 'sensor.starkvind_filter_age', 0);
  await expect(card.locator('.filter-notice')).toHaveCount(0);
  await update(page, 'sensor.starkvind_fan_speed', 1);
  await expect(card.locator('.number-on')).toHaveText('1');
});

test('native percentage shortcuts confirm zero by Off and preserve unknown versus zero', async ({
  page,
}) => {
  const card = await install(page, 'vesync');
  await page.evaluate(() =>
    window.cards[0].setConfig({
      entity: 'fan.levoit_purifier',
      shortcuts: [
        { name: 'Low', percentage: 33 },
        { name: 'Stop', percentage: 0 },
      ],
    }),
  );
  await card.getByRole('button', { name: 'Low', exact: true }).click();
  expect(await page.evaluate(() => window.calls.at(-1))).toMatchObject({
    domain: 'fan',
    service: 'set_percentage',
    data: { percentage: 33 },
  });
  await update(page, fixtures.vesync.fan, 'on', {
    percentage: 33,
    preset_mode: null,
  });
  await expect(card.locator('.command-status')).toHaveCount(0);
  await expect(
    card.getByRole('button', { name: 'Low', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'Stop', exact: true }).click();
  await update(page, fixtures.vesync.fan, 'off', { percentage: null });
  await expect(card.locator('.command-status')).toHaveCount(0);
  await expect(card.locator('.number-on')).toHaveText('—');
});

test('a fan without a speed source has no empty pill, while custom presets stay usable', async ({
  page,
}) => {
  const card = await install(page, 'esphome');
  await page.evaluate(() => {
    const fan = window.hass.states['fan.levoit_vital100s_fan'];
    const attributes = {
      ...fan.attributes,
      supported_features: 56,
      preset_modes: ['Fresh air'],
      preset_mode: 'Fresh air',
    };
    delete attributes.percentage;
    window.updateEntity(fan.entity_id, 'on', attributes);
  });
  await expect(card.locator('.speed-pill')).toHaveCount(0);
  await card.getByRole('button', { name: 'Fresh air', exact: true }).click();
  expect(await page.evaluate(() => window.calls.at(-1))).toMatchObject({
    service: 'set_preset_mode',
    data: { preset_mode: 'Fresh air' },
  });
});

for (const key of Object.keys(fixtures)) {
  test(`${key}: phone layout fits and unavailable fans disable commands`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    const card = await install(page, key, true);
    await editor(page);
    await update(page, fixtures[key].fan, 'unavailable');
    await expect(card.locator('.power')).toBeDisabled();
    await expect(card.locator('.state')).toContainText('Unavailable');
    expect(
      await card.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
