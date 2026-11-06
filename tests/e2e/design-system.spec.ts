import { expect, test } from '@playwright/test';

test.use({ colorScheme: 'light' });
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({ status: route.request().url().includes('/auth/personas') ? 200 : 401, contentType: 'application/json', body: route.request().url().includes('/auth/personas') ? '{"personas":[]}' : '{"error":{"code":"AUTH_REQUIRED","message":"Sessão necessária"}}' }));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
});

test('aplica tokens e persiste tema ao recarregar sem buscar fontes externas', async ({ page }, info) => {
  const fonts: string[] = [];
  page.on('request', request => { if (/fonts\.(googleapis|gstatic)/.test(request.url())) fonts.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Georgia/);
  await page.getByRole('button', { name: 'Ativar modo escuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Ativar modo claro' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.ft-app')).toHaveCSS('color', 'rgb(225, 233, 213)');
  expect(fonts).toEqual([]);
  await page.screenshot({ path: info.outputPath('design-system-dark.png'), fullPage: true });
});

test('segue o sistema até escolha explícita e funciona com armazenamento indisponível', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Ativar modo claro' }).click();
  await page.emulateMedia({ colorScheme: 'light' }); await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } }); });
  await page.reload();
  await page.getByRole('button', { name: 'Ativar modo claro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('mantém navegação, foco e controles utilizáveis em 320px', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 800 }); await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
  await page.getByRole('link', { name: 'Passaporte digital', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Passaporte');
  await page.getByRole('button', { name: 'Ativar modo escuro' }).focus();
  await expect(page.getByRole('button', { name: 'Ativar modo escuro' })).toBeFocused();
  const size = await page.getByRole('button', { name: 'Ativar modo escuro' }).boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('design-system-320.png'), fullPage: true });
});
