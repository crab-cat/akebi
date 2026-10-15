import { build } from 'esbuild';
await build({ entryPoints: ['src/main.js'], bundle: true, external: ['obsidian'], format: 'cjs', target:'es2020', outfile:'main.js', minify:false, sourcemap:false, legalComments:'inline' });
