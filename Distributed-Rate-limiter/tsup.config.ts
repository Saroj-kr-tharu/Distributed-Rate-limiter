import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  bundle: true,
  splitting: false,
  external: ['@prisma/client', '.prisma/client'], // Prisma's generated client shouldn't be bundled — see note below
});
