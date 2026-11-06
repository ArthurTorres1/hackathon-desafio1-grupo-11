import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.skip(process.env.FORESTTRACE_INPE_LIVE_E2E!=='true','Requer API local com INPE habilitado e smoke sintético concluído.');
test('reabre imagem INPE real pela parcela do lote sintético',async({page})=>{
  test.setTimeout(90000);
  const smoke=JSON.parse(readFileSync('data/private/inpe-live-smoke.json','utf8'));
  await page.goto('/');
  await page.locator('#persona-select').selectOption('20000000-0000-4000-8000-000000000011');
  await expect(page.getByText('Sessão de demonstração iniciada.',{exact:true})).toBeVisible();
  await page.locator('.step-footer .primary-button').click();
  await page.getByLabel('Lote para avaliação').selectOption(smoke.origin_lot_id);
  await page.getByText(/versão 1 · geometria atual/).click();
  await page.getByRole('button',{name:'Reabrir cena vinculada'}).click();
  await expect(page.getByRole('img',{name:/Composição RGB INPE/})).toBeVisible({timeout:35000});
  await expect(page.getByText('CENA SELECIONADA')).toBeVisible();
  await page.getByLabel('Opacidade da imagem INPE:',{exact:false}).fill('0.9');
  await page.getByRole('region',{name:'Imagens privadas INPE'}).scrollIntoViewIfNeeded();
  await page.getByRole('region',{name:'Imagens privadas INPE'}).screenshot({path:'data/private/inpe-live-browser.png'});
  await page.screenshot({path:'data/private/inpe-live-browser-full.png',fullPage:true});
});
