import { expect, test } from '@playwright/test';

const dashboard = {
  organizations: [], plots: [], origin_lots: [], product_lots: [], shipments: [],
  transformations: [], audit_cases: [], passports: [], conversion_parameters: [],
  checks: [], documents: [], metrics: {},
};

async function interceptEmptyApi(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/auth/personas', route => route.fulfill({ json: { personas: [] } }));
  await page.route('**/api/v1/dashboard', route => route.fulfill({ json: dashboard }));
}

test('navega as oito etapas em desktop e mantém cadastro sintético identificado', async ({ page }, testInfo) => {
  await interceptEmptyApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Cadastrar parcela' })).toBeVisible();
  await expect(page.getByText('Origem declarada, não certificada.')).toBeVisible();
  await expect(page.getByText('Contorno declarado · mapa-base OpenStreetMap')).toBeVisible();
  const labels = ['Lotes e sinais de origem', 'Registrar corte e remessa', 'Entradas, saídas e proveniência', 'Revisão humana', 'Passaporte digital', 'Pacote de evidências DDS', 'Acesso público & decisão'];
  for (const title of labels) {
    await page.getByRole('button', { name: 'Próxima etapa' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
  await expect(page.getByText('O inventário não equivale a regras normativas integralmente confirmadas.')).toHaveCount(0);
  if (testInfo.project.name === 'desktop-chromium') await expect(page.locator('.workspace-grid')).toHaveCSS('display', 'grid');
});

test('consulta pública direta não revela PII nem coordenadas exatas', async ({ page }) => {
  await interceptEmptyApi(page);
  await page.route('**/p/demo-safe-token', route => route.fulfill({ json: {
    id: 'public-id', code: 'FT-DEMO-01', status: 'MISSING_EVIDENCE', generalized_region: 'Amazonas',
    integrity_status: 'VERIFIED',
  } }));
  await page.goto('/p/demo-safe-token');
  await expect(page.getByRole('heading', { name: 'Acesso público & decisão' })).toBeVisible();
  await page.getByRole('button', { name: 'Consultar passaporte' }).click();
  await expect(page.getByText('FT-DEMO-01')).toBeVisible();
  await expect(page.getByText('Amazonas · sem geometria exata ou PII')).toBeVisible();
  await expect(page.getByText('MISSING_EVIDENCE')).toBeVisible();
  await expect(page.getByText(/-60/)).toHaveCount(0);
});

test('falha de dashboard é exposta sem preencher dados fictícios', async ({ page }) => {
  await page.route('**/api/v1/auth/personas', route => route.fulfill({ json: { personas: [] } }));
  await page.route('**/api/v1/dashboard', route => route.fulfill({ status: 503, json: { error: { message: 'Serviço indisponível', code: 'UNAVAILABLE' } } }));
  await page.goto('/');
  await expect(page.getByText(/Serviço indisponível/)).toBeVisible();
  await expect(page.getByText('Nenhum lote retornado pela API.')).toBeVisible();
  await expect(page.getByText('LT-204')).toHaveCount(0);
});
