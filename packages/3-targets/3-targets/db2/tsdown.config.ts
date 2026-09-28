import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/exports/data-types.ts',
    'src/exports/codec-ids.ts',
    'src/exports/codecs.ts',
    'src/exports/runtime.ts',
    'src/exports/control.ts',
  ],
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node24',
});
