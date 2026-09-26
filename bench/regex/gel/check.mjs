import { pathToFileURL } from 'node:url'; import { readFileSync } from 'node:fs';
const src = readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const interdit = /new RegExp|RegExp\s*\(|\.(match|exec|test|replace|replaceAll|search|split|matchAll)\s*\(|=\s*\/[^/\n*]+\/[gimsuyd]*\s*[;,)]/;
if (interdit.test(src)) { console.log('INTERDIT : moteur natif utilisé'); console.log('\nscore 0/1000'); process.exit(0); }
const { executer } = await import(pathToFileURL(process.argv[2]).href);
let seed = 777; const r = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const BS = String.fromCharCode(92);
const pick = a => a[Math.floor(r() * a.length)];
function gen(d, st) {
  if (d > 3 || r() < 0.25) return atom(d, st);
  const k = r();
  if (k < 0.35) return gen(d + 1, st) + gen(d + 1, st);
  if (k < 0.5) return gen(d + 1, st) + '|' + gen(d + 1, st);
  if (k < 0.8) return quant(d, st);
  if (k < 0.9) { const inner = gen(d + 1, st); return '(' + pick(['?=', '?!']) + inner + ')'; }
  return gen(d + 1, st) + gen(d + 1, st);
}
function atom(d, st) {
  const k = r();
  if (k < 0.45) return pick(['a', 'b', 'c']);
  if (k < 0.55) return '.';
  if (k < 0.7) return pick(['[ab]', '[^a]', '[a-b]', '[^bc]', '[c]']);
  if (k < 0.8) return pick(['^', '$']);
  if (k < 0.92 && d < 4) { st.n++; return '(' + gen(d + 1, st) + ')'; }
  if (st.n > 0 || r() < 0.3) return BS + (1 + Math.floor(r() * Math.max(1, st.n + (r() < 0.2 ? 1 : 0))));
  return pick(['a', 'b']);
}
function quant(d, st) {
  let base = r() < 0.5 ? '(' + (r() < 0.5 ? '?:' : (st.n++, '')) + gen(d + 1, st) + ')' : pick(['a', 'b', '.', '[ab]']);
  const q = pick(['*', '+', '?', '{2}', '{1,}', '{0,2}', '{1,3}']);
  return base + q + (r() < 0.35 ? '?' : '');
}
let ok = 0, n = 0; const echecs = [];
const fixes = [['(a|ab)(c|bcd)(d*)', 'abcd'], ['(a*)*b', 'aab'], ['(a*)+', 'b'], ['(?:(a)|b)+', 'ab'], ['(z)((a+)?(b+)?(c))*', 'zaacbbbcac'], ['\\1(a)', 'aa'], ['(?=(a+))a*b\\1', 'baaabac'], ['(?!(a)b)\\1a', 'aab'], ['(a)|\\1b', 'b'], ['(.*?)a(?!(a+)b\\2c)\\2(.*)', 'baaabaac'], ['^(?:a|ab)+?$', 'abab'], ['(a{0,2}?)(a+)', 'aaa'], ['()*', 'x'], ['(a|)*b', 'aab'], ['[^]', 'a'], ['$a^', 'a']];
const cases = [...fixes];
while (cases.length < 1000) { const st = { n: 0 }; const p = gen(0, st); try { new RegExp(p); } catch { continue; } let t = ''; const L = Math.floor(r() * 9); for (let i = 0; i < L; i++) t += pick(['a', 'b', 'c', 'a']); cases.push([p, t]); }
for (const [p, t] of cases) {
  let exp; try { exp = new RegExp(p).exec(t); } catch { continue; }
  const want = exp ? JSON.stringify([exp.index, ...exp].map(x => x === undefined ? '§u' : x)) : 'null';
  let got; try { const g = executer(p, t); got = g ? JSON.stringify(g.map(x => x === undefined ? '§u' : x)) : 'null'; } catch (e) { got = 'EXC ' + e.message; }
  n++; if (got === want) ok++; else if (echecs.length < 12) echecs.push(`${JSON.stringify(p)} sur ${JSON.stringify(t)} : attendu ${want}, obtenu ${got}`);
}
echecs.forEach(e => console.log('ECHEC ' + e));
console.log(`\nscore ${ok}/${n}`);
