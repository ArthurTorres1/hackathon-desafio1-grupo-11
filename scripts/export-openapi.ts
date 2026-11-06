import { writeFile } from 'node:fs/promises';
import { buildServer } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/db.js';

const app = await buildServer();
try {
  const response = await app.inject({ url: '/openapi.json' });
  if (response.statusCode !== 200) throw new Error('Falha ao exportar o contrato OpenAPI.');
  await writeFile(new URL('../docs/openapi.json', import.meta.url), `${JSON.stringify(response.json(), null, 2)}\n`);
  console.log('Contrato exportado em docs/openapi.json.');
} finally { await app.close(); await prisma.$disconnect(); }
