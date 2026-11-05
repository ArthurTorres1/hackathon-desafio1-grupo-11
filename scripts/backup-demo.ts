import { config } from 'dotenv';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { cp, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
config({ path: join(root, '.env') });
const target = new URL(process.env.DIRECT_URL ?? 'postgresql://localhost/foresttrace');
if (target.pathname !== '/foresttrace' || !['127.0.0.1', 'localhost', 'db'].includes(target.hostname)) {
  throw new Error('Backup de demo exige banco local identificado como foresttrace.');
}
const directory = resolve(root, 'data/backups', new Date().toISOString().replaceAll(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });
const databaseFile = join(directory, 'foresttrace.dump');
const output = createWriteStream(databaseFile, { flags: 'wx' });
const child = spawn('docker', ['compose', 'exec', '-T', 'db', 'pg_dump', '-U', process.env.POSTGRES_USER ?? 'foresttrace_owner', '-d', 'foresttrace', '-Fc'], {
  cwd: root, stdio: ['ignore', 'pipe', 'inherit'], shell: false,
});
const exit = new Promise<void>((done, fail) => {
  child.once('error', fail);
  child.once('close', code => {
    if (code !== 0) fail(new Error(`pg_dump terminou com código ${code}.`));
    else done();
  });
});
await Promise.all([pipeline(child.stdout, output), exit]);
const documents = resolve(root, process.env.PRIVATE_STORAGE_DIR ?? 'data/private');
let includesDocuments = false;
try { await access(documents); includesDocuments = true; } catch { /* Nenhum documento ainda. */ }
if (includesDocuments) await cp(documents, join(directory, 'documents'), { recursive: true, errorOnExist: true });
await writeFile(join(directory, 'manifest.json'), JSON.stringify({
  created_at: new Date().toISOString(), database: 'foresttrace', format: 'pg_dump custom',
  includes_documents: includesDocuments, scope: 'BACKUP_LOCAL_DEMO',
}, null, 2));
console.log(`Backup privado criado: ${directory}`);
