/**
 * Build script for the RTL Engine.
 * Bundles src/engine/ into a single IIFE JS file using esbuild.
 * This file is then read by extension.ts and injected into workbench.html.
 */
const esbuild = require('esbuild');
const path = require('path');

esbuild.buildSync({
    entryPoints: [path.join(__dirname, 'src', 'engine', 'index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'CopilotRtlEngine',
    outfile: path.join(__dirname, 'out', 'copilot-rtl-patch.js'),
    platform: 'browser',
    target: 'es2020',
    minify: false,       // Keep readable for debugging
    sourcemap: false,
    tsconfig: path.join(__dirname, 'tsconfig.engine.json'),
});

console.log('[build-engine] ✓ Bundled engine → out/copilot-rtl-patch.js');
