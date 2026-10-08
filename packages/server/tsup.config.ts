import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  platform: 'node',
  target: 'node20',
  // @medsim/core ships TypeScript sources, so it is bundled; everything else stays external.
  noExternal: ['@medsim/core'],
  external: ['pg-native', 'exceljs', 'zod', 'pg', 'pg-mem', 'pdfkit', 'fastify', 'bcryptjs', 'jsonwebtoken'],
});
