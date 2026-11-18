// Собирает интерфейс в web/dist: один app.js (IIFE, без внешних зависимостей) + статика.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await build({
  entryPoints: [`${root}src/main.ts`],
  outfile: `${dist}/app.js`,
  bundle: true,
  format: 'iife',
  target: ['safari16'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});
await cp(`${root}static`, dist, { recursive: true });
console.log('web/dist готов');
