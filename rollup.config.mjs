/**
 * rollup.config.mjs — @armvs/dom-inspector build pipeline
 *
 * Outputs (all built directly from src/index.js — no bundle derives from another bundle):
 *   dist/inspector.mjs       — Native ES Module  (Vite, Nuxt, Rollup, tree-shakeable)
 *   dist/inspector.cjs       — CommonJS          (Node.js require())
 *   dist/inspector.umd.js    — UMD               (browser <script>, AMD, CJS fallback)
 *   dist/inspector.min.js    — Minified UMD      (CDN / <script src="">)
 *   dist/inspector.css       — Stylesheet
 *   dist/inspector.mjs.map   — ESM source map
 *   dist/inspector.cjs.map   — CJS source map
 */

import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser            from '@rollup/plugin-terser';
import { readFileSync }  from 'fs';

const pkg  = JSON.parse(readFileSync('./package.json', 'utf8'));
const year = new Date().getFullYear();

const banner = `/*!
 * @armvs/dom-inspector v${pkg.version}
 * (c) ${year} ${pkg.author}
 * Released under the MIT License
 */`;

/** Terser options shared across minified builds */
const terserOptions = {
  compress: {
    passes:       2,
    drop_console: false,
    pure_getters: true,
  },
  mangle:  true,
  format:  { comments: false },
};

/** Common Rollup plugins (non-minified) */
const basePlugins = [nodeResolve()];

export default [
  // ── 1. ES Module (inspector.mjs) ────────────────────────────────────────────
  // Native import/export, tree-shakeable, used by Vite / Nuxt / Rollup
  {
    input:  'src/index.js',
    output: {
      file:      'dist/inspector.mjs',
      format:    'es',
      banner,
      sourcemap: true,
    },
    plugins: basePlugins,
  },

  // ── 2. CommonJS (inspector.cjs) ─────────────────────────────────────────────
  // Used by Node.js require() and older bundlers
  {
    input:  'src/index.js',
    output: {
      file:      'dist/inspector.cjs',
      format:    'cjs',
      exports:   'named',
      banner,
      sourcemap: true,
    },
    plugins: basePlugins,
  },

  // ── 3. UMD — unminified (inspector.umd.js) ──────────────────────────────────
  // Useful for debugging; referenced as fallback by some CDNs
  {
    input:  'src/index.js',
    output: {
      file:       'dist/inspector.umd.js',
      format:     'umd',
      name:       'DOMInspector',
      exports:    'named',
      banner,
      sourcemap:  false,
    },
    plugins: basePlugins,
  },

  // ── 4. UMD — minified (inspector.min.js) ────────────────────────────────────
  // CDN / <script src=""> build, exposes window.DOMInspector
  {
    input:  'src/index.js',
    output: {
      file:      'dist/inspector.min.js',
      format:    'umd',
      name:      'DOMInspector',
      exports:   'named',
      banner,
      sourcemap: false,
    },
    plugins: [
      nodeResolve(),
      terser(terserOptions),
    ],
  },
];
