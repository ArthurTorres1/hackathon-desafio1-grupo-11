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
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByText('O inventário não equivale a regras normativas integralmente confirmadas.')).toHaveCount(0);
  if (testInfo.project.name === 'desktop-chromium') await expect(page.locator('.workspace-grid')).toHaveCSS('display', 'grid');
});

test('consulta pública direta não revela PII nem coordenadas exatas', async ({ page }) => {
  await interceptEmptyApi(page);
  await page.route('**/api/v1/public/passports/demo-safe-token', route => route.fulfill({ json: {
    id: 'public-id', code: 'FT-DEMO-01', status: 'MISSING_EVIDENCE', generalized_region: 'Amazonas',
    integrity_status: 'VERIFIED',
  } }));
  await page.goto('/p/demo-safe-token');
  await expect(page.getByRole('heading', { name: 'Acesso público & decisão' })).toBeVisible();
  await page.getByRole('button', { name: 'Consultar passaporte' }).click();
  await expect(page.getByText('FT-DEMO-01')).toBeVisible();
  await expect(page.getByText('Amazonas · sem geometria exata ou PII')).toBeVisible();
  await expect(page.getByText('MISSING_EVIDENCE', { exact: true })).toBeVisible();
  await expect(page.getByText(/-60/)).toHaveCount(0);
});

test('falha de dashboard é exposta sem preencher dados fictícios', async ({ page }) => {
  await page.route('**/api/v1/auth/personas', route => route.fulfill({ json: { personas: [] } }));
  await page.route('**/api/v1/dashboard', route => route.fulfill({ status: 503, json: { error: { message: 'Serviço indisponível', code: 'UNAVAILABLE' } } }));
  await page.goto('/');
  await expect(page.getByText(/Serviço indisponível/)).toBeVisible();
  await page.getByRole('button', { name: 'Próxima etapa' }).click();
  await expect(page.getByText('Nenhum lote retornado pela API.')).toBeVisible();
  await expect(page.getByText('LT-204')).toHaveCount(0);
});

test('remetente expede e destinatário confirma volume recebido em sessões distintas', async ({ page }) => {
  const senderOrg = { id: '10000000-0000-4000-8000-000000000001', name: 'Origem Demo' };
  const millOrg = { id: '10000000-0000-4000-8000-000000000002', name: 'Serraria Demo' };
  const author = { id: '20000000-0000-4000-8000-000000000001', name: 'Operadora', organization: senderOrg };
  const receiver = { id: '20000000-0000-4000-8000-000000000002', name: 'Recebedora', organization: millOrg };
  const lotId = '60000000-0000-4000-8000-000000000001';
  const shipmentId = '60000000-0000-4000-8000-000000000002';
  let current = author; let status = 'CREATED';
  let receipt: unknown;
  await page.route('**/api/v1/auth/personas', route => route.fulfill({ json: { personas: [author, receiver] } }));
  await page.route('**/api/v1/auth/session', route => {
    current = route.request().postDataJSON().user_id === receiver.id ? receiver : author;
    return route.fulfill({ json: { user: current, csrf_token: 'synthetic-csrf' } });
  });
  await page.route('**/api/v1/dashboard', route => route.fulfill({ json: {
    ...dashboard, user: current, organizations: [senderOrg, millOrg],
    shipments: [{ id: shipmentId, sender_id: senderOrg.id, recipient_id: millOrg.id, status, items: [{ lot_id: lotId, volume_m3: '10' }] }],
  } }));
  await page.route(`**/api/v1/shipments/${shipmentId}/dispatch`, route => {
    expect(route.request().postDataJSON().occurred_at).toBeTruthy();
    status = 'DISPATCHED'; return route.fulfill({ json: { shipment: { id: shipmentId, status } } });
  });
  await page.route(`**/api/v1/shipments/${shipmentId}/receive`, route => {
    receipt = route.request().postDataJSON(); status = 'RECEIVED_WITH_VARIANCE';
    return route.fulfill({ json: { shipment: { id: shipmentId, status }, checks: [{ status: 'ALERTA', difference_m3: '0.1' }] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Próxima etapa' }).click();
  await page.getByRole('button', { name: 'Próxima etapa' }).click();
  await page.getByRole('button', { name: 'Confirmar expedição', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'DISPATCHED', exact: true })).toBeVisible();
  await page.getByLabel('PERFIL DE DEMONSTRAÇÃO').selectOption(receiver.id);
  await page.getByRole('spinbutton', { name: `Volume recebido ${lotId}` }).fill('9.9');
  await page.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'RECEIVED_WITH_VARIANCE', exact: true })).toBeVisible();
  expect(receipt).toMatchObject({ items: [{ lot_id: lotId, volume_m3: '9.9' }] });
});
