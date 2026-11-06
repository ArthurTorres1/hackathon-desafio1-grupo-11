import { expect, test, type Page } from '@playwright/test';

// Browser interaction tests use intercepted API responses, not a live database/domain audit.
async function openCalculator(page: Page, authenticated = true) {
  await page.route('**/api/v1/auth/personas', route => route.fulfill({ json: { personas: [] } }));
  await page.route('**/api/v1/dashboard', route => route.fulfill({ json: { ...(authenticated ? { user: { id: 'calculator-author', name: 'Operadora', organization: { id: 'org' } } } : {}) } }));
  await page.goto('/');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Próxima etapa' }).click();
  await expect(page.getByRole('heading', { name: 'Cubagem e aproveitamento' })).toBeVisible();
}
function response(alert = false) {
  return { label: 'DADOS SIMULADOS', readiness: 'MISSING_EVIDENCE', assessment_scope: 'DEMONSTRATIVO', data_provenance: 'SIMULADA',
    origin: { result: alert ? 'ALERTA' : 'PASSOU', explanation: 'Comparação com perfil demonstrativo.', intensity_m3_ha: alert ? '37.000000' : '21.000000', utilization_pct: alert ? '123.333333' : '70.000000' },
    mill: { result: alert ? 'ALERTA' : 'PASSOU', explanation: 'Revisão humana permanece necessária.', crv_pct: alert ? '59.459459' : '34.000000', additional_log_equivalent_m3: alert ? '1292.857143' : '0.000000' },
    tree: { result: 'NAO_AVALIADO', volume_m3: null, explanation: 'Cubagem não informada.' },
    parameters: { management: { id: 'DEMO_MECHANIZED_35Y_V1', version: '1', source: 'CONAMA 406/2009 — referência demonstrativa', intensity_m3_ha: '30', initial_cycle_years: 35 }, conversion: { id: 'CRV_DEMO_V1', version: '1', source: 'Referência demonstrativa', coefficient: '0.35' }, tree: { id: 'TREE_DEMO_V1', version: '1', source: 'Aproximação demonstrativa', form_factor: '0.70' } },
    formulas: { crv: 'CRV = serrado / tora × 100' }, gaps: ['Aplicabilidade normativa pendente.'] };
}
test('calcula ambos exemplos sem modificar dashboard e invalida resultado ao editar', async ({ page }, testInfo) => {
  let calls = 0;
  await page.route('**/api/v1/calculations/forest-utilization', route => {
    const input = route.request().postDataJSON(); calls++;
    expect(input.management_profile_id).toBe('DEMO_MECHANIZED_35Y_V1');
    expect(input.area_effective_ha).toBe(calls === 1 ? '100' : '50');
    return route.fulfill({ json: response(calls === 2) });
  });
  await openCalculator(page);
  await page.getByRole('button', { name: 'Calcular aproveitamento' }).click();
  const report = page.getByTestId('forest-calculation-report');
  await expect(report.getByText('34.000000', { exact: true })).toBeVisible();
  await expect(report.getByText('70.000000', { exact: true })).toBeVisible();
  await expect(report.getByText(/CONAMA 406/)).toBeVisible();
  await page.getByRole('button', { name: 'Carregar exemplo 2' }).click();
  await expect(report).toHaveCount(0);
  await page.getByRole('button', { name: 'Calcular aproveitamento' }).click();
  await expect(report.getByText('1292.857143')).toBeVisible();
  await expect(report.getByText('Origem · ALERTA')).toBeVisible();
  await page.locator('.forest-calculator').screenshot({ path: testInfo.outputPath('calculator-example-2.png') });
  await page.getByLabel('Tora extraída (m³)', { exact: true }).fill('100');
  await expect(report).toHaveCount(0);
  expect(calls).toBe(2);
});
test('preserva área efetiva ausente e envia limite exato sem normalizar', async ({ page }) => {
  await page.route('**/api/v1/calculations/forest-utilization', route => {
    const body = route.request().postDataJSON();
    expect(body).not.toHaveProperty('area_effective_ha');
    expect(body.extracted_log_volume_m3).toBe('10');
    expect(body.declared_sawn_volume_m3).toBe('3.5');
    const report = response(); report.origin.result = 'NAO_AVALIADO'; report.origin.explanation = 'Área efetiva não informada.'; report.mill.crv_pct = '35.000000';
    return route.fulfill({ json: report });
  });
  await openCalculator(page);
  await page.getByLabel(/Área efetiva declarada/).fill('');
  await page.getByLabel('Tora extraída (m³)', { exact: true }).fill('10');
  await page.getByLabel('Madeira serrada declarada (m³)').fill('3.5');
  await page.getByRole('button', { name: 'Calcular aproveitamento' }).click();
  await expect(page.getByText('35.000000', { exact: true })).toBeVisible();
  await expect(page.getByText('Origem · NAO_AVALIADO')).toBeVisible();
});
test('mostra erros locais, validação do servidor e indisponibilidade sem resultado substituto', async ({ page }) => {
  let count = 0;
  await page.route('**/api/v1/calculations/forest-utilization', route => { count++; return route.fulfill({ status: count === 1 ? 422 : 503, json: { error: { code: 'CALCULATION_ERROR', message: count === 1 ? 'Área efetiva excede o limite informado.' : 'Serviço de cálculo indisponível.' } } }); });
  await openCalculator(page);
  await page.getByLabel('Tora extraída (m³)', { exact: true }).fill('-1');
  await page.getByRole('button', { name: 'Calcular aproveitamento' }).click();
  await expect(page.getByRole('alert')).toContainText('não negativos');
  expect(count).toBe(0);
  await page.getByLabel('Tora extraída (m³)', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Calcular aproveitamento' }).click();
  await expect(page.getByRole('alert')).toContainText('Área efetiva excede');
  await page.getByRole('button', { name: 'Calcular aproveitamento' }).click();
  await expect(page.getByRole('alert')).toContainText('Serviço de cálculo indisponível');
  await expect(page.getByTestId('forest-calculation-report')).toHaveCount(0);
});
test('exige sessão para calcular', async ({ page }) => {
  await openCalculator(page, false);
  await expect(page.getByRole('button', { name: 'Calcular aproveitamento' })).toBeDisabled();
});

test('cubagem opcional exige medidas juntas e envia unidades declaradas', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/v1/calculations/forest-utilization', route => {
    calls++;
    expect(route.request().postDataJSON().tree).toEqual({ dap_cm: '60', commercial_height_m: '20' });
    const report = response(); report.tree = { result: 'PASSOU', volume_m3: '3.958407', explanation: 'Estimativa com fator demonstrativo 0,70.' };
    return route.fulfill({ json: report });
  });
  await openCalculator(page);
  await page.getByLabel('DAP (cm) — cubagem opcional', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Calcular aproveitamento' }).click();
  await expect(page.getByRole('alert')).toContainText('informe DAP e altura');
  expect(calls).toBe(0);
  await page.getByLabel('Altura comercial (m) — cubagem opcional', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Calcular aproveitamento' }).click();
  await expect(page.getByText('3.958407', { exact: true })).toBeVisible();
});
