import { config } from 'dotenv';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
const command = process.argv[2];
const env = { ...process.env };
let args: string[];
if (command === 'generate') {
  args = ['generate'];
} else if (command === 'migrate') {
  args = ['migrate', 'deploy'];
} else if (command === 'prepare-test') {
  const target = env.TEST_DATABASE_URL;
  if (!target || new URL(target).pathname !== '/foresttrace_test') {
    throw new Error('TEST_DATABASE_URL deve apontar ao banco isolado foresttrace_test.');
  }
  env.DATABASE_URL = target;
  env.DIRECT_URL = target;
  args = ['migrate', 'deploy'];
} else {
  throw new Error('Use generate, migrate ou prepare-test.');
}
const require = createRequire(import.meta.url);
const prisma = require.resolve('prisma/build/index.js');
const child = spawn(process.execPath, [prisma, ...args, '--schema', 'apps/api/prisma/schema.prisma'], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: false,
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
