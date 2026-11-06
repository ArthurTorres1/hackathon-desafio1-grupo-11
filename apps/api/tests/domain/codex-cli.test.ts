import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@sinclair/typebox';
import { runCodex } from '../../src/services/codex-cli.js';

let directory: string;
const request = { instruction: 'Explique sem alterar o resultado.', context: { text: '$(echo injection); `command` " & |' },
  schema: Type.Object({ explanation: Type.String() }, { additionalProperties: false }) };
async function launcher(source: string) {
  // Use .js with CommonJS in a directory outside the module workspace.
  const js = join(directory, 'fake-cli.js');
  await writeFile(js, source);
  vi.stubEnv('CODEX_CLI_PATH', js);
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'foresttrace-cli-test-'));
  vi.stubEnv('CODEX_MODEL', '');
  vi.stubEnv('CODEX_TIMEOUT_MS', '5000');
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe('local Codex CLI boundary', () => {
  it('passes context literally through stdin and validates the isolated structured response', async () => {
    await launcher(`const fs = require('node:fs');
      const args = process.argv.slice(2);
      if (!args.includes('read-only') || !args.includes('--ephemeral') || args.at(-1) !== '-') process.exit(2);
      let text = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', x => text += x);
      process.stdin.on('end', () => {
        if (!text.includes('$(echo injection);')) process.exit(3);
        const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
        if (schema.additionalProperties !== false) process.exit(4);
        console.log('progress logs are not the response');
        fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({explanation:'Sugestão revisável'}));
      });`);
    await expect(runCodex(request)).resolves.toEqual({ provider: 'codex-cli', data: { explanation: 'Sugestão revisável' } });
  });
  it.each(['not-json', '{"explanation":42}', '{"explanation":"ok","status":"PASSOU"}'])('rejects malformed or out-of-schema output: %s', async output => {
    await launcher(`const fs = require('node:fs'); const args = process.argv;
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], ${JSON.stringify(output)});`);
    await expect(runCodex(request)).rejects.toMatchObject({ code: 'CODEX_INVALID_OUTPUT' });
  });
  it('does not expose stderr or silently substitute another AI provider', async () => {
    await launcher('console.error("private-context-and-credentials"); process.exit(1);');
    await expect(runCodex(request)).rejects.toMatchObject({ code: 'CODEX_FAILED', message: 'Falha no Codex CLI. Verifique codex login e a conexão.' });
  });
  it('terminates a stalled CLI', async () => {
    await launcher('setInterval(() => {}, 1000);');
    vi.stubEnv('CODEX_TIMEOUT_MS', '100');
    await expect(runCodex(request)).rejects.toMatchObject({ code: 'CODEX_TIMEOUT' });
  });
  it('reports a missing executable', async () => {
    vi.stubEnv('CODEX_CLI_PATH', join(directory, 'missing.exe'));
    await expect(runCodex(request)).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' });
  });
});
