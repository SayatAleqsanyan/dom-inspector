/**
 * @armvs/dom-inspector — Playwright integration tests
 *
 * These tests run against index.html in a real browser.
 * Run: npx playwright test
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const PAGE_URL = `file://${path.resolve(__dirname, '../index.html')}`;

test.describe('DOM Inspector integration', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
  });

  // ── Panel visibility ──────────────────────────────────────────────────────

  test('panel is hidden on load', async ({ page }) => {
    const panel = page.locator('#__insp_panel');
    await expect(panel).toHaveCSS('display', 'none');
  });

  test('Alt+hover shows the panel', async ({ page }) => {
    await page.keyboard.down('Alt');
    await page.hover('body > *', { force: true });
    await page.waitForTimeout(100);
    const panel = page.locator('#__insp_panel');
    await expect(panel).not.toHaveCSS('display', 'none');
    await page.keyboard.up('Alt');
  });

  test('Escape closes the panel', async ({ page }) => {
    await page.keyboard.down('Alt');
    await page.hover('body > *', { force: true });
    await page.waitForTimeout(100);
    await page.keyboard.up('Alt');
    await page.keyboard.press('Escape');
    const panel = page.locator('#__insp_panel');
    await expect(panel).toHaveCSS('display', 'none');
  });

  // ── Selector generation ───────────────────────────────────────────────────

  test('Selectors tab shows a non-empty CSS selector', async ({ page }) => {
    await page.keyboard.down('Alt');
    await page.hover('body > *', { force: true });
    await page.waitForTimeout(100);
    await page.keyboard.up('Alt');

    // Click Selectors tab
    await page.locator('.insp-tab[data-tab="selectors"]').click();

    const selBox = page.locator('#__insp_full_sel');
    const text = await selBox.textContent();
    expect(text).toBeTruthy();
    expect(text).not.toBe('—');
    // Should not contain nth-child
    expect(text).not.toContain(':nth-child(');
  });

  test('Copy selector button copies text to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.keyboard.down('Alt');
    await page.hover('body > *', { force: true });
    await page.waitForTimeout(100);
    await page.keyboard.up('Alt');

    await page.locator('.insp-tab[data-tab="selectors"]').click();
    await page.locator('#__insp_pane_selectors .insp-copy-btn').first().click();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard.length).toBeGreaterThan(0);
  });

  // ── generateStableSelector ────────────────────────────────────────────────

  test('generateStableSelector prefers data-testid', async ({ page }) => {
    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.setAttribute('data-testid', 'pw-test-btn');
      btn.textContent = 'Click me';
      document.body.appendChild(btn);
    });

    const sel = await page.evaluate(() => {
      return window.DOMInspector.generateStableSelector(
        document.querySelector('[data-testid="pw-test-btn"]')
      );
    });

    expect(sel).toContain('data-testid');
    expect(sel).not.toContain('nth-child');
  });

  test('generateStableSelector returns unique selector', async ({ page }) => {
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'unique-div-test';
      document.body.appendChild(div);
    });

    const { sel, count } = await page.evaluate(() => {
      const el = document.getElementById('unique-div-test');
      const sel = window.DOMInspector.generateStableSelector(el);
      const count = document.querySelectorAll(sel).length;
      return { sel, count };
    });

    expect(count).toBe(1);
    expect(sel).toBe('#unique-div-test');
  });

  // ── Shadow DOM ────────────────────────────────────────────────────────────

  test('inspector panel shows shadow host indicator in DOM tree', async ({ page }) => {
    // Create a host with shadow root
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'shadow-host-test';
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const inner = document.createElement('span');
      inner.textContent = 'inner';
      shadow.appendChild(inner);
    });

    // Alt+click the host
    const host = page.locator('#shadow-host-test');
    await page.keyboard.down('Alt');
    await host.click();
    await page.keyboard.up('Alt');

    // Switch to DOM tab
    await page.locator('.insp-tab[data-tab="dom"]').click();

    const treeText = await page.locator('#__insp_dom_tree').textContent();
    expect(treeText).toContain('◎');
  });

  // ── Keyboard navigation ───────────────────────────────────────────────────

  test('ArrowUp navigates to parent element', async ({ page }) => {
    await page.evaluate(() => {
      const parent = document.createElement('section');
      parent.id = 'parent-section';
      const child = document.createElement('p');
      child.id = 'child-para';
      parent.appendChild(child);
      document.body.appendChild(parent);
    });

    // Alt+click the child
    await page.keyboard.down('Alt');
    await page.locator('#child-para').click();
    await page.keyboard.up('Alt');

    const tagBefore = await page.locator('#__insp_tag').textContent();

    await page.keyboard.press('ArrowUp');

    const tagAfter = await page.locator('#__insp_tag').textContent();
    expect(tagAfter).not.toBe(tagBefore);
  });

  // ── Overlay rendering ─────────────────────────────────────────────────────

  test('overlay layers are created when element is inspected', async ({ page }) => {
    await page.keyboard.down('Alt');
    await page.hover('body > *', { force: true });
    await page.waitForTimeout(100);
    await page.keyboard.up('Alt');

    const layers = await page.locator('.__insp_layer').count();
    expect(layers).toBeGreaterThanOrEqual(4); // margin, border, padding, content
  });

  test('overlay layers are removed after Escape', async ({ page }) => {
    await page.keyboard.down('Alt');
    await page.hover('body > *', { force: true });
    await page.waitForTimeout(100);
    await page.keyboard.up('Alt');
    await page.keyboard.press('Escape');

    const layers = await page.locator('.__insp_layer').count();
    expect(layers).toBe(0);
  });

  // ── Export ────────────────────────────────────────────────────────────────

  test('export() returns correct shape after pinning', async ({ page }) => {
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'export-test-el';
      document.body.appendChild(div);
    });

    await page.keyboard.down('Alt');
    await page.locator('#export-test-el').click();
    await page.keyboard.up('Alt');

    const data = await page.evaluate(() => window.DOMInspector.export());

    expect(data).not.toBeNull();
    expect(data.tagName).toBe('div');
    expect(data.selector).toBeTruthy();
    expect(data.xpath).toBeTruthy();
    expect(data.a11y).toBeDefined();
  });

});
