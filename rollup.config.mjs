/**
 * rollup.config.mjs — @armvs/dom-inspector build pipeline
 *
 * CSS strategy:
 *   - ESM / CJS builds: CSS is inlined as a data-URI so import '@armvs/dom-inspector'
 *     works out-of-the-box in Vite/Nuxt without needing cssUrl or a separate <link>.
 *     Users can still override via init({ cssUrl: '...' }).
 *   - UMD / CDN builds: same inline approach — no external file dependency.
 *   - dist/inspector.css + dist/inspector.min.css are still shipped for users who
 *     prefer to import the stylesheet manually.
 */

import { nodeResolve } from '@rollup/plugin-node-resolve';
import replace          from '@rollup/plugin-replace';
import terser           from '@rollup/plugin-terser';
import { readFileSync } from 'fs';

const pkg  = JSON.parse(readFileSync('./package.json', 'utf8'));
const year = new Date().getFullYear();

const banner = `/*!
 * @armvs/dom-inspector v${pkg.version}
 * (c) ${year} ${pkg.author}
 * Released under the MIT License
 */`;

// Inline the minified CSS as a data-URI so the bundle is self-contained.
// injectCSS() in the source already checks __INSP_CSS_URL__ before falling
// back to the relative-path heuristic — we just fill that slot at build time.
function cssDataUri() {
  let css = readFileSync('./dist/inspector.css', 'utf8');
  // Minify
  css = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,>~+])\s*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/;}/g, '}')
    .trim();
  const b64 = Buffer.from(css).toString('base64');
  return `"data:text/css;base64,${b64}"`;
}

const inlineCSSPlugin = () =>
  replace({
    preventAssignment: true,
    values: {
      // Replace the runtime __INSP_CSS_URL__ check with the actual data-URI
      '__INSP_CSS_URL__': cssDataUri(),
    },
  });

const terserOptions = {
  compress: { passes: 2, pure_getters: true },
  mangle:   true,
  format:   { comments: false },
};

const basePlugins = [nodeResolve(), inlineCSSPlugin()];

export default [
  // 1. ES Module — Vite / Nuxt / Rollup / tree-shakeable
  {
    input:  'src/index.js',
    output: { file: 'dist/inspector.mjs', format: 'es', banner, sourcemap: true },
    plugins: basePlugins,
  },

  // 2. CommonJS — Node.js require()
  {
    input:  'src/index.js',
    output: { file: 'dist/inspector.cjs', format: 'cjs', exports: 'named', banner, sourcemap: true },
    plugins: basePlugins,
  },

  // 3. UMD unminified — debug / fallback
  {
    input:  'src/index.js',
    output: { file: 'dist/inspector.umd.js', format: 'umd', name: 'DOMInspector', exports: 'named', banner },
    plugins: basePlugins,
  },

  // 4. UMD minified — CDN / <script src="">
  {
    input:  'src/index.js',
    output: { file: 'dist/inspector.min.js', format: 'umd', name: 'DOMInspector', exports: 'named', banner },
    plugins: [nodeResolve(), inlineCSSPlugin(), terser(terserOptions)],
  },
];
