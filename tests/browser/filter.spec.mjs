import { test, expect } from '@playwright/test';

const fan = 'fan.zhimi_airp_vb4';
const remaining = 'sensor.zhimi_airp_vb4_filter_life_remaining';
const replacement = 'binary_sensor.purifier_replace_filter';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/tests/fixtures/demo.html');
  await page.waitForFunction(() => window.cards?.length === 2);
  await page.evaluate(
    ({ fan, remaining, replacement }) => {
      window.updateEntity(remaining, 90, {
        unit_of_measurement: '%',
        friendly_name: 'Filter remaining',
      });
      window.updateEntity(replacement, 'off', {
        device_class: 'problem',
        friendly_name: 'Replace filter',
      });
      window.hass.callWS = async () =>
        Object.keys(window.hass.states).map((entity_id) => ({
          entity_id,
          device_id:
            entity_id === fan ||
            entity_id === remaining ||
            entity_id === replacement
              ? 'purifier'
              : 'other',
        }));
      window.cards[0].setConfig({
        entity: fan,
        stats: [{ entity_id: remaining, subtitle: 'Filter remaining' }],
      });
      window.moreInfo = [];
      document.addEventListener('hass-more-info', (event) =>
        window.moreInfo.push(event.detail.entityId),
      );
    },
    { fan, remaining, replacement },
  );
});

async function update(page, id, value, attributes) {
  await page.evaluate(
    ({ id, value, attributes }) => {
      window.updateEntity(id, value, attributes);
      if (window.filterEditor) window.filterEditor.hass = window.hass;
    },
    { id, value, attributes },
  );
}
async function editor(page, config) {
  await page.evaluate(async (config) => {
    const editor = await customElements
      .get('xiaomi-purifier-card')
      .getConfigElement();
    editor.hass = window.hass;
    editor.setConfig(config);
    editor.addEventListener('config-changed', (event) => {
      window.filterConfig = event.detail.config;
      window.cards[0].setConfig(window.filterConfig);
      editor.setConfig(structuredClone(window.filterConfig));
    });
    window.filterEditor = editor;
    document.body.append(editor);
  }, config);
  const form = page.locator('xiaomi-purifier-card-editor');
  await expect(form.locator('.detection [role=status]')).toContainText(
    'detected',
  );
  await form.locator('.filter-editor > summary').click();
  return form;
}

test('filter warnings follow live remaining life, retain zero and open the correct entity', async ({
  page,
}) => {
  const card = page.locator('xiaomi-purifier-card').first();
  await expect(card.locator('.filter-notice')).toHaveCount(0);
  await update(page, remaining, 20);
  await expect(card.locator('.filter-notice')).toContainText(
    'Filter running low · 20% remaining',
  );
  await expect(card.locator('.filter-notice')).toHaveAttribute(
    'data-level',
    'warning',
  );
  await update(page, remaining, 0);
  await expect(card.locator('.filter-notice')).toContainText(
    'Replace filter · 0% remaining',
  );
  await card.locator('.filter-notice button').click();
  expect(await page.evaluate(() => window.moreInfo)).toEqual([remaining]);
  expect(await page.evaluate(() => window.calls)).toEqual([]);
  await update(page, remaining, 'unavailable');
  await expect(card.locator('.filter-notice')).toHaveText(
    'Filter status unavailable',
  );
  await expect(card.locator('.filter-notice')).not.toContainText('0%');
  await update(page, remaining, 80);
  await expect(card.locator('.filter-notice')).toHaveCount(0);
});

test('a native replacement flag updates independently and overrides the remaining estimate', async ({
  page,
}) => {
  await page.evaluate(
    ({ fan, replacement }) =>
      window.cards[0].setConfig({
        entity: fan,
        stats: [],
        filter_warning: { entity_id: replacement, mode: 'replacement' },
      }),
    { fan, replacement },
  );
  const card = page.locator('xiaomi-purifier-card').first();
  await update(page, replacement, 'on');
  await expect(card.locator('.filter-notice')).toHaveText('Replace filter');
  await expect(card.locator('.filter-notice')).not.toContainText('%');
  await update(page, replacement, 'unknown');
  await expect(card.locator('.filter-notice')).toHaveText(
    'Filter status unavailable',
  );
  await update(page, replacement, 'off');
  await expect(card.locator('.filter-notice')).toHaveCount(0);
});

test('the editor detects a same-device replacement flag and preserves manual overrides and disabling', async ({
  page,
}) => {
  const form = await editor(page, { entity: fan });
  const source = form.getByRole('combobox', {
    name: 'Filter warning sensor',
    exact: true,
  });
  await expect(source).toHaveValue(replacement);
  await expect(
    form.getByRole('combobox', { name: 'Filter sensor meaning', exact: true }),
  ).toHaveValue('replacement');
  await expect(form.getByRole('spinbutton')).toHaveCount(0);
  await source.fill(remaining);
  await source.press('Tab');
  const warning = form.getByRole('spinbutton', {
    name: 'Warn at or below',
    exact: true,
  });
  await warning.fill('30');
  await update(page, remaining, 25);
  await page.evaluate(() =>
    window.filterEditor.setConfig(structuredClone(window.filterConfig)),
  );
  await expect(warning).toHaveValue('30');
  await warning.press('Tab');
  await expect(
    page.locator('xiaomi-purifier-card').first().locator('.filter-notice'),
  ).toContainText('25% remaining');
  await form
    .getByRole('button', { name: 'Detect missing sensors', exact: true })
    .click();
  await expect(source).toHaveValue(remaining);
  await form
    .getByRole('checkbox', { name: 'Show filter warnings', exact: true })
    .uncheck();
  await expect(
    page.locator('xiaomi-purifier-card').first().locator('.filter-notice'),
  ).toHaveCount(0);
  await update(page, remaining, 0);
  await expect(
    page.locator('xiaomi-purifier-card').first().locator('.filter-notice'),
  ).toHaveCount(0);
});

test('remaining days and custom thresholds are distinct from percentages', async ({
  page,
}) => {
  await update(page, remaining, 6, { unit_of_measurement: 'days' });
  const form = await editor(page, {
    entity: fan,
    stats: [{ entity_id: remaining }],
    filter_warning: {},
  });
  await expect(
    form.getByRole('spinbutton', { name: 'Warn at or below', exact: true }),
  ).toHaveValue('7');
  await expect(
    form.getByRole('spinbutton', { name: 'Replace at or below', exact: true }),
  ).toHaveValue('0');
  const card = page.locator('xiaomi-purifier-card').first();
  await expect(card.locator('.filter-notice')).toContainText(
    '6 days remaining',
  );
  const critical = form.getByRole('spinbutton', {
    name: 'Replace at or below',
    exact: true,
  });
  await critical.fill('2');
  await critical.press('Tab');
  await update(page, remaining, 2);
  await expect(card.locator('.filter-notice')).toHaveAttribute(
    'data-level',
    'critical',
  );
  await critical.fill('10');
  await critical.press('Tab');
  expect(await critical.evaluate((el) => el.validity.valid)).toBe(false);
  expect(
    await page.evaluate(
      () => window.filterConfig.filter_warning.critical_threshold,
    ),
  ).toBe(2);
});

test('usage and templated statistics do not become warnings; explicit attributes remain configurable', async ({
  page,
}) => {
  await page.evaluate(
    ({ fan }) => {
      window.updateEntity('sensor.filter_age', 0, { unit_of_measurement: '%' });
      window.cards[0].setConfig({
        entity: fan,
        stats: [{ entity_id: 'sensor.filter_age' }],
      });
    },
    { fan },
  );
  const card = page.locator('xiaomi-purifier-card').first();
  await expect(card.locator('.filter-notice')).toHaveCount(0);
  await page.evaluate(
    ({ fan }) => {
      window.updateEntity(fan, 'on', {
        ...window.hass.states[fan].attributes,
        filter: { days: 0 },
      });
      window.cards[0].setConfig({
        entity: fan,
        stats: [],
        filter_warning: { attribute: 'filter.days', mode: 'remaining_days' },
      });
    },
    { fan },
  );
  await expect(card.locator('.filter-notice')).toContainText(
    '0 days remaining',
  );
  await card.locator('.filter-notice button').click();
  expect(await page.evaluate(() => window.moreInfo)).toEqual([fan]);
});

test('malformed warning settings are rejected before rendering', async ({
  page,
}) => {
  const errors = await page.evaluate(
    ({ fan }) =>
      [
        false,
        [],
        { enabled: 'yes' },
        { mode: 'usage' },
        { warning_threshold: -1 },
        { mode: 'remaining_percent', warning_threshold: 101 },
        { critical_threshold: 30, warning_threshold: 20 },
        { entity_id: 4 },
      ].map((filter_warning) => {
        try {
          window.cards[0].setConfig({ entity: fan, filter_warning });
          return null;
        } catch (error) {
          return error.message;
        }
      }),
    { fan },
  );
  expect(
    errors.every((error) => typeof error === 'string' && error.length),
  ).toBe(true);
});

test('maintenance notices fit phones, remain keyboard accessible, and appear while the fan is off', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await update(page, fan, 'off');
  await update(page, remaining, 0);
  const card = page.locator('xiaomi-purifier-card').first();
  const notice = card.locator('.filter-notice');
  await expect(notice).toHaveText('Replace filter · 0% remaining');
  await notice.getByRole('button').focus();
  await expect(notice.getByRole('button')).toBeFocused();
  expect(
    (await notice.getByRole('button').boundingBox()).height,
  ).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('renamed numeric filters receive an explicit verified meaning during discovery', async ({
  page,
}) => {
  await page.evaluate(
    ({ fan }) => {
      window.updateEntity('sensor.renamed_filter', 18, {
        unit_of_measurement: '%',
      });
      window.hass.callWS = async () => [
        { entity_id: fan, device_id: 'purifier' },
        {
          entity_id: 'sensor.renamed_filter',
          device_id: 'purifier',
          translation_key: 'filter_life_remaining',
        },
      ];
    },
    { fan },
  );
  const form = await editor(page, { entity: fan });
  await expect(
    form.getByRole('combobox', { name: 'Filter warning sensor', exact: true }),
  ).toHaveValue('sensor.renamed_filter');
  await expect(
    page.locator('xiaomi-purifier-card').first().locator('.filter-notice'),
  ).toHaveText('Filter running low · 18% remaining');
});

test('a delayed registry response preserves a filter sensor draft', async ({
  page,
}) => {
  await page.evaluate(
    async ({ fan }) => {
      window.hass.callWS = () =>
        new Promise((resolve) => {
          window.resolveFilters = resolve;
        });
      const element = await customElements
        .get('xiaomi-purifier-card')
        .getConfigElement();
      element.hass = window.hass;
      element.setConfig({ entity: fan });
      element.addEventListener('config-changed', (event) => {
        window.filterConfig = event.detail.config;
        element.setConfig(structuredClone(window.filterConfig));
      });
      window.filterEditor = element;
      document.body.append(element);
    },
    { fan },
  );
  const form = page.locator('xiaomi-purifier-card-editor');
  await expect(form.locator('.detection button')).toContainText('Detecting');
  await form.locator('.filter-editor > summary').click();
  const source = form.getByRole('combobox', {
    name: 'Filter warning sensor',
    exact: true,
  });
  await source.fill('sensor.my_filter_draft');
  await page.evaluate(
    ({ fan, replacement, remaining }) =>
      window.resolveFilters([
        { entity_id: fan, device_id: 'main' },
        { entity_id: replacement, device_id: 'main' },
        { entity_id: remaining, device_id: 'main' },
      ]),
    { fan, replacement, remaining },
  );
  await expect(form.locator('.detection [role=status]')).toContainText(
    'detected',
  );
  await expect(source).toHaveValue('sensor.my_filter_draft');
  expect(
    await page.evaluate(() => window.filterConfig?.filter_warning),
  ).toBeUndefined();
  await source.press('Tab');
  expect(
    await page.evaluate(() => window.filterConfig.filter_warning.entity_id),
  ).toBe('sensor.my_filter_draft');
});
