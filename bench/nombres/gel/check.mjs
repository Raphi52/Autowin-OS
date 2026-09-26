import { pathToFileURL } from 'node:url'; import { readFileSync } from 'node:fs';
const src = readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
if (/""\s*\+|\+\s*""|''\s*\+|\+\s*''|String\s*\(|toString|toFixed|toPrecision|toExponential|Intl|JSON|\$\{|toLocale/.test(src)) { console.log('INTERDIT'); console.log('\nscore 0/1000'); process.exit(0); }
const { formater } = await import(pathToFileURL(process.argv[2]).href);
let seed = 4242; const r = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const dv = new DataView(new ArrayBuffer(8));
const xs = [0, -0, NaN, Infinity, -Infinity, 1, -1, 0.1, 0.2 + 0.1, 1e21, 1e21 - 65536, 999999999999999900000, 1e-7, 1.5e-7, 0.000001, 123456789012345680000, 5e-324, 1.7976931348623157e308, 2 ** 53, 2 ** 53 + 2, 2 ** 53 + 1, 1 / 3, 100, 1e300 * 10, 4.35, 0.5e-6, 2.2250738585072014e-308, 1e23, 8.41e21, 5e-7];
while (xs.length < 1000) {
  const k = r();
  if (k < 0.4) { dv.setUint32(0, Math.floor(r() * 2 ** 32)); dv.setUint32(4, Math.floor(r() * 2 ** 32)); xs.push(dv.getFloat64(0)); }
  else if (k < 0.7) xs.push(Math.round(r() * 1e6) / 10 ** Math.floor(r() * 12));
  else xs.push((r() - 0.5) * 10 ** Math.floor(r() * 50 - 25));
}
let ok = 0; const e = [];
for (const x of xs) { let g; try { g = formater(x); } catch (err) { g = 'EXC ' + err.message; } if (g === String(x)) ok++; else if (e.length < 12) e.push(`${String(x)} → ${g}`); }
e.forEach(l => console.log('ECHEC ' + l)); console.log(`\nscore ${ok}/${xs.length}`);
