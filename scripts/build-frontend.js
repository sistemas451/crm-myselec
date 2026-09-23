/**
 * Compila el frontend una sola vez (en el deploy) en vez de en cada navegador.
 *
 * - Los .jsx de public/ se transforman con @babel/standalone usando EXACTAMENTE
 *   las mismas opciones que usaba <script type="text/babel"> en el navegador
 *   (presets react + env, mismos plugins). Así el código resultante es el mismo
 *   que antes: top-level como `var`, cada archivo sigue siendo un script clásico
 *   que comparte globals con los demás.
 * - Tailwind se genera con tailwind.config.js en vez del CDN que lo armaba en vivo.
 * - React pasa a la versión de producción, copiada de node_modules.
 *
 * Deja todo en public/build/ (no se commitea). index.html apunta ahí.
 *
 * Uso: node scripts/build-frontend.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Babel = require('@babel/standalone');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(PUB, 'build');

const ARCHIVOS = ['crm-api', 'crm-interact', 'crm-data', 'crm-kanban', 'crm-details', 'crm-views', 'crm-app'];

const t0 = Date.now();
fs.mkdirSync(OUT, { recursive: true });

// 1. JSX → JS, mismas opciones que buildBabelOptions() de babel-standalone para text/babel
for (const nombre of ARCHIVOS) {
  const src = fs.readFileSync(path.join(PUB, `${nombre}.jsx`), 'utf8');
  const { code, map } = Babel.transform(src, {
    filename: `${nombre}.jsx`,
    presets: ['react', 'env'],
    plugins: ['transform-class-properties', 'transform-object-rest-spread', 'transform-flow-strip-types'],
    targets: { browsers: undefined },
    sourceMaps: true,
    sourceFileName: `../${nombre}.jsx`,
  });
  fs.writeFileSync(path.join(OUT, `${nombre}.js`), `${code}\n//# sourceMappingURL=${nombre}.js.map\n`);
  fs.writeFileSync(path.join(OUT, `${nombre}.js.map`), JSON.stringify(map));
}

// 2. React de producción
for (const [pkg, archivo] of [['react', 'react.production.min.js'], ['react-dom', 'react-dom.production.min.js']]) {
  fs.copyFileSync(path.join(ROOT, 'node_modules', pkg, 'umd', archivo), path.join(OUT, archivo));
}

// 3. Tailwind
const entrada = path.join(OUT, '_tailwind-in.css');
fs.writeFileSync(entrada, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
execFileSync(process.execPath, [
  require.resolve('tailwindcss/lib/cli.js'),
  '-c', path.join(ROOT, 'tailwind.config.js'),
  '-i', entrada,
  '-o', path.join(OUT, 'tailwind.css'),
  // Sin --minify a propósito: el minificador reescribe colores con opacidad
  // (border-line/60, etc.) a hsla y los redondea 1/255 distinto que el CDN.
  // Railway ya lo sirve con gzip, así que el tamaño que viaja casi no cambia.
], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
fs.unlinkSync(entrada);

const kb = f => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
console.log(`✅ Frontend compilado en ${Date.now() - t0} ms → public/build/ ` +
  `(js ${ARCHIVOS.reduce((s, n) => s + kb(`${n}.js`), 0)} KB · tailwind ${kb('tailwind.css')} KB)`);
