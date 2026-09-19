import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist/extension', { recursive: true });
await build({
  entryPoints: ['extension/worker.js', 'extension/panel.js', 'extension/offscreen.js', 'extension/teams-content.js', 'extension/pcm-worklet.js'],
  outdir: 'dist/extension', bundle: true, format: 'esm', target: 'chrome116',
  sourcemap: true, logLevel: 'info',
});
for (const name of ['manifest.json', 'panel.html', 'panel.css', 'offscreen.html']) {
  await copyFile(`extension/${name}`, `dist/extension/${name}`);
}
