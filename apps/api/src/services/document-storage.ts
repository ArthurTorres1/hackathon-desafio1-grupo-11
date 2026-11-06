import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
const storageRoot = () => resolve(workspace, process.env.PRIVATE_STORAGE_DIR ?? 'data/private');

function documentPath(key: string) {
  if (!/^[0-9a-f-]{36}\.bin$/i.test(key)) throw new Error('Chave de armazenamento inválida.');
  return resolve(storageRoot(), key);
}

export async function storeDocument(key: string, bytes: Buffer) {
  await mkdir(storageRoot(), { recursive: true });
  await writeFile(documentPath(key), bytes, { flag: 'wx' });
}

export const readDocument = (key: string) => readFile(documentPath(key));
export const removeDocument = (key: string) => unlink(documentPath(key));
