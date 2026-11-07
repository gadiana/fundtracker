import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // the shared workspace package ships TypeScript source, so bundle it in
  noExternal: ['@sft/shared'],
});
