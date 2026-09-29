import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/exports/codec-ids.ts',
    'src/exports/codec-types.ts',
    'src/exports/codecs.ts',
    'src/exports/control.ts',
    'src/exports/data-types.ts',
    'src/exports/default-normalizer.ts',
    'src/exports/native-type-normalizer.ts',
    'src/exports/pack.ts',
    'src/exports/runtime.ts',
  ],
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node24',
});
