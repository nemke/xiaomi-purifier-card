import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/tests/fixtures/demo.html');
  await page.waitForFunction(() => window.cards?.length === 2);
  await page.clock.install({ time: new Date('2026-11-01T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-01T12:00:01Z'));
  await page.evaluate(() => {
    window.timerConfig = {
      entity_id: 'timer.shutdown',
      automation_entity_id: 'automation.shutdown',
      deadline_entity_id: 'input_text.deadline',
    };
    window.updateEntity('timer.shutdown', 'idle', {});
    window.updateEntity('automation.shutdown', 'on', {});
    window.updateEntity('input_text.deadline', '', {});
    const old = window.cards[0];
    const card = document.createElement('breeze-purifier-card');
    card.hass = window.hass;
    card.setConfig({
      type: 'custom:breeze-purifier-card',
      entity: 'fan.zhimi_airp_vb4',
      shutdown_timer: window.timerConfig,
    });
    old.replaceWith(card);
    window.cards[0] = card;
    window.hass.callWS = async () => [];
  });
});
const card = (page) => page.locator('breeze-purifier-card');
const timer = (page) => card(page).locator('breeze-shutdown-timer');
async function reportActive(page, seconds = 1800) {
  await page.evaluate((seconds) => {
    const end = Date.now() + seconds * 1000;
    window.updateEntity('timer.shutdown', 'active', {
      finishes_at: new Date(end).toISOString(),
    });
    window.updateEntity('input_text.deadline', String(Math.floor(end / 1000)));
  }, seconds);
}

test('Breeze and legacy types coexist, use distinct editor aliases and expose one picker entry', async ({
  page,
}) => {
  expect(
    await page.evaluate(() =>
      window.customCards.filter((item) => /purifier-card/.test(item.type)),
    ),
  ).toMatchObject([
    { type: 'breeze-purifier-card', name: 'Breeze Purifier Card' },
  ]);
  const tags = await page.evaluate(async () => {
    const breeze = await customElements
      .get('breeze-purifier-card')
      .getConfigElement();
    const legacy = await customElements
      .get('xiaomi-purifier-card')
      .getConfigElement();
    return [breeze.localName, legacy.localName];
  });
  expect(tags).toEqual([
    'breeze-purifier-card-editor',
    'xiaomi-purifier-card-editor',
  ]);
  await card(page).getByRole('button', { name: 'Silent', exact: true }).click();
  expect(await page.evaluate(() => window.calls[0].service)).toBe(
    'set_preset_mode',
  );
  await expect(page.locator('xiaomi-purifier-card')).toHaveCount(1);
});

test('timer starts in HA and counts down from reported state without sensor polling', async ({
  page,
}) => {
  await card(page)
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  await timer(page)
    .getByRole('button', { name: '30 min', exact: true })
    .click();
  expect(await page.evaluate(() => window.calls)).toEqual([
    {
      domain: 'timer',
      service: 'start',
      data: { duration: 1800 },
      target: { entity_id: 'timer.shutdown' },
    },
  ]);
  await expect(timer(page).getByRole('status')).toContainText('confirmation');
  await reportActive(page);
  await expect(timer(page).getByRole('timer')).toHaveText('Off in 30:00');
  await expect(timer(page).getByRole('status')).toHaveCount(0);
  await page.clock.runFor(5000);
  await expect(timer(page).getByRole('timer')).toHaveText('Off in 29:55');
  expect(await page.evaluate(() => window.calls.length)).toBe(1);
  await card(page)
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  await expect(timer(page).getByRole('timer')).toBeVisible();
});

test('cancel clears a persistent deadline even with automation disabled and never sends fan off', async ({
  page,
}) => {
  await reportActive(page);
  await page.evaluate(() => window.updateEntity('automation.shutdown', 'off'));
  await expect(timer(page).getByRole('timer')).toContainText(
    'Shutdown not armed',
  );
  await timer(page)
    .getByRole('button', { name: 'Cancel timer', exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      window.calls.map((call) => call.domain + '.' + call.service),
    ),
  ).toEqual(['input_text.set_value', 'timer.cancel']);
  expect(await page.evaluate(() => window.calls[0].data)).toEqual({
    value: '',
  });
  await page.evaluate(() => {
    window.updateEntity('input_text.deadline', '');
    window.updateEntity('timer.shutdown', 'idle', {});
  });
  await expect(timer(page).getByRole('timer')).toHaveCount(0);
  await expect(timer(page).getByRole('status')).toHaveCount(0);
});

test('expired schedules wait for backend shutdown instead of making a browser-side fan command', async ({
  page,
}) => {
  await reportActive(page, 2);
  await page.clock.runFor(3000);
  await expect(timer(page).getByRole('timer')).toHaveText(
    'Waiting for shutdown',
  );
  expect(await page.evaluate(() => window.calls)).toEqual([]);
  await page.evaluate(() => {
    window.updateEntity('timer.shutdown', 'idle', {});
    window.updateEntity('input_text.deadline', '');
    window.updateEntity('fan.zhimi_airp_vb4', 'off');
  });
  await expect(timer(page).getByRole('timer')).toHaveCount(0);
});

test('setup gaps and an off fan disable start; custom durations validate and use seconds', async ({
  page,
}) => {
  await card(page)
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  await page.evaluate(() => window.updateEntity('automation.shutdown', 'off'));
  await expect(
    timer(page).getByRole('button', { name: '30 min', exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    window.updateEntity('automation.shutdown', 'on');
    window.updateEntity('fan.zhimi_airp_vb4', 'off');
  });
  await expect(
    timer(page).getByRole('button', { name: 'Start timer', exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.updateEntity('fan.zhimi_airp_vb4', 'on'));
  const input = timer(page).getByRole('spinbutton', {
    name: 'Custom duration (minutes)',
    exact: true,
  });
  await input.fill('0');
  await timer(page)
    .getByRole('button', { name: 'Start timer', exact: true })
    .click();
  expect(await page.evaluate(() => window.calls)).toEqual([]);
  await input.fill('45');
  await timer(page)
    .getByRole('button', { name: 'Start timer', exact: true })
    .click();
  expect(await page.evaluate(() => window.calls.at(-1).data.duration)).toBe(
    2700,
  );
});

test('rejected timer commands recover and do not invent an active countdown', async ({
  page,
}) => {
  await page.evaluate(() => (window.rejectCommand = true));
  await card(page)
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  await timer(page).getByRole('button', { name: '1 h', exact: true }).click();
  await expect(timer(page).getByRole('alert')).toContainText(
    'Device rejected command',
  );
  await expect(timer(page).getByRole('timer')).toHaveCount(0);
  await expect(
    timer(page).getByRole('button', { name: '1 h', exact: true }),
  ).toBeEnabled();
});

test('mode changes keep the countdown, paused timers stay fixed and removing the card stops its local ticker', async ({
  page,
}) => {
  await reportActive(page);
  await card(page).getByRole('button', { name: 'Silent', exact: true }).click();
  await expect(timer(page).getByRole('timer')).toContainText('Off in');
  await page.evaluate(() => {
    window.updateEntity('timer.shutdown', 'paused', { remaining: '00:12:00' });
    window.updateEntity('input_text.deadline', '');
  });
  await page.clock.runFor(5000);
  await expect(timer(page).getByRole('timer')).toHaveText('Paused 12:00');
  const handle = await timer(page).elementHandle();
  await card(page).evaluate((element) => element.remove());
  expect(await handle.evaluate((element) => element.ticker)).toBeUndefined();
});

test('Breeze timer editor preserves drafts during HA updates and legacy config echoes', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const element = await customElements
      .get('breeze-purifier-card')
      .getConfigElement();
    element.hass = window.hass;
    element.setConfig({
      entity: 'fan.zhimi_airp_vb4',
      shutdown_timer: window.timerConfig,
    });
    element.addEventListener('config-changed', (event) => {
      window.editedConfig = event.detail.config;
      element.setConfig(structuredClone(event.detail.config));
    });
    window.timerEditor = element;
    document.body.append(element);
  });
  const form = page.locator('breeze-purifier-card-editor');
  await expect(
    form.getByRole('link', { name: 'Setup guide', includeHidden: true }),
  ).toHaveAttribute('href', /docs\/TIMER\.md$/);
  await form.locator('.timer-editor > summary').click();
  const input = form.getByRole('combobox', {
    name: 'Timer entity',
    exact: true,
  });
  await input.fill('timer.another_purifier');
  await page.evaluate(() => {
    window.timerEditor.hass = { ...window.hass };
    window.timerEditor.setConfig({
      entity: 'fan.zhimi_airp_vb4',
      shutdown_timer: window.timerConfig,
    });
  });
  await expect(input).toHaveValue('timer.another_purifier');
  await input.press('Tab');
  expect(
    await page.evaluate(() => window.editedConfig.shutdown_timer.entity_id),
  ).toBe('timer.another_purifier');
});

test('timer state and controls fit a phone and remain visible without toolbar controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await reportActive(page);
  await card(page)
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  expect(
    await card(page).evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.evaluate(() =>
    window.cards[0].setConfig({
      entity: 'fan.zhimi_airp_vb4',
      shutdown_timer: window.timerConfig,
      show_toolbar: false,
    }),
  );
  await expect(timer(page).getByRole('timer')).toBeVisible();
  await expect(timer(page).getByRole('button')).toHaveCount(0);
});

test('timer-only configuration renders no empty device-settings panel', async ({
  page,
}) => {
  await card(page)
    .getByRole('button', { name: 'Device controls', exact: true })
    .click();
  await expect(
    timer(page).getByRole('button', { name: 'Start timer', exact: true }),
  ).toBeVisible();
  await expect(card(page).locator('.device-controls')).toHaveCount(0);
});

test('a timed-out cancellation cannot continue with a late second command', async ({
  page,
}) => {
  await reportActive(page);
  await page.evaluate(() => {
    window.hass.callService = (domain, service, data, target) => {
      window.calls.push({ domain, service, data, target });
      return new Promise((resolve) => {
        window.finishCancel = resolve;
      });
    };
  });
  await timer(page)
    .getByRole('button', { name: 'Cancel timer', exact: true })
    .click();
  await page.clock.runFor(10001);
  await expect(timer(page).getByRole('alert')).toContainText('timed out');
  await page.evaluate(() => window.finishCancel());
  expect(
    await page.evaluate(() => window.calls.map((call) => call.service)),
  ).toEqual(['set_value']);
});
