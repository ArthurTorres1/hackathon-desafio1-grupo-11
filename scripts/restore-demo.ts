import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { access, cp, mkdir, readFile } from 'node:fs/promises';

const backup = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Informe a pasta do backup privado.');
const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
if (manifest.scope !== 'BACKUP_LOCAL_DEMO') throw new Error('Manifesto de backup local obrigatório.');
await access(join(backup, 'foresttrace.dump'));
const database = `foresttrace_restore_${Date.now()}`;
const owner = process.env.POSTGRES_USER ?? 'foresttrace_owner';
function docker(args: string[]) {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'db', ...args], { stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error('Falha na restauração; banco separado preservado para inspeção.');
}
docker(['createdb', '-U', owner, database]);
const copy = spawnSync('docker', ['compose', 'cp', join(backup, 'foresttrace.dump'), 'db:/tmp/foresttrace-restore.dump'], { stdio: 'inherit', shell: false });
if (copy.status !== 0) throw new Error('Falha ao copiar dump.');
docker(['pg_restore', '-U', owner, '-d', database, '--exit-on-error', '/tmp/foresttrace-restore.dump']);
const documents = resolve('data/backups', database, 'documents');
await mkdir(documents, { recursive: true });
if (manifest.includes_documents) await cp(join(backup, 'documents'), documents, { recursive: true, errorOnExist: true });
console.log(`Restauração preservada no banco ${database}; documentos: ${documents}`);
