// Contrôle caché de bench/plages. Usage : node check.mjs <chemin/disponibilites.mjs>
import { pathToFileURL } from 'node:url';
const W = 10080;
const mod = await import(pathToFileURL(process.argv[2]).href);
const f = mod.disponibilites;
// Référence brute : un booléen par minute.
function ref({ personnes, debut, fin, dureeMin = 0 }) {
  if (!personnes?.length || !(fin > debut)) return [];
  const n = fin - debut, ok = new Uint8Array(n).fill(1);
  const ok1 = x => Number.isFinite(x.debut) && Number.isFinite(x.fin) && x.fin > x.debut;
  const pose = (arr, x, v) => {
    const shifts = [];
    if (x.hebdo) { for (let k = Math.floor((debut - x.fin) / W) ; k <= Math.ceil((fin - x.debut) / W); k++) shifts.push(k * W); }
    else shifts.push(0);
    for (const s of shifts) { const a = Math.max(x.debut + s, debut), b = Math.min(x.fin + s, fin); for (let t = a; t < b; t++) arr[t - debut] = v; }
  };
  for (const p of personnes) {
    const m = new Uint8Array(n);
    for (const c of p.creneaux || []) if (ok1(c)) pose(m, c, 1);
    for (const o of p.occupations || []) if (ok1(o)) pose(m, o, 0);
    for (let i = 0; i < n; i++) ok[i] &= m[i];
  }
  const out = []; let s = -1;
  for (let i = 0; i <= n; i++) { if (i < n && ok[i]) { if (s < 0) s = i; } else if (s >= 0) { if (i - s >= dureeMin) out.push({ debut: debut + s, fin: debut + i }); s = -1; } }
  return out;
}
const norm = r => JSON.stringify((r || []).map(x => [x.debut, x.fin]));
let pts = 0; const tot = [];
function cas(nom, q) {
  let got, err = '';
  try { got = f(structuredClone(q)); } catch (e) { err = ' (exception ' + e.message + ')'; }
  const ok = !err && norm(got) === norm(ref(q));
  tot.push(nom); if (ok) pts++;
  console.log((ok ? 'OK    ' : 'ECHEC ') + nom + err);
}
const P = (c, o = []) => ({ creneaux: c, occupations: o });
cas('simple', { personnes: [P([{ debut: 60, fin: 120 }])], debut: 0, fin: 200 });
cas('contigus fusionnés', { personnes: [P([{ debut: 60, fin: 90 }, { debut: 90, fin: 120 }])], debut: 0, fin: 200 });
cas('désordre + chevauchement', { personnes: [P([{ debut: 100, fin: 150 }, { debut: 50, fin: 110 }, { debut: 140, fin: 145 }])], debut: 0, fin: 300 });
cas('intersection 2 personnes', { personnes: [P([{ debut: 0, fin: 100 }]), P([{ debut: 50, fin: 200 }])], debut: 0, fin: 300 });
cas('occupation coupe en deux', { personnes: [P([{ debut: 0, fin: 100 }], [{ debut: 40, fin: 60 }])], debut: 0, fin: 100 });
cas('bornage requête', { personnes: [P([{ debut: -50, fin: 500 }])], debut: 10, fin: 20 });
cas('dureeMin filtre après fusion', { personnes: [P([{ debut: 0, fin: 20 }, { debut: 20, fin: 40 }, { debut: 100, fin: 110 }])], debut: 0, fin: 200, dureeMin: 30 });
cas('invalides ignorés', { personnes: [P([{ debut: 50, fin: 50 }, { debut: 80, fin: 60 }, { debut: NaN, fin: 9 }, { debut: 0, fin: Infinity }, { debut: 10, fin: 20 }])], debut: 0, fin: 100 });
cas('aucune personne', { personnes: [], debut: 0, fin: 100 });
cas('requête vide', { personnes: [P([{ debut: 0, fin: 100 }])], debut: 50, fin: 50 });
cas('hebdo simple sur 3 semaines', { personnes: [P([{ debut: 540, fin: 600, hebdo: true }])], debut: 0, fin: 3 * W });
cas('hebdo qui déborde de la semaine', { personnes: [P([{ debut: 10000, fin: 10200, hebdo: true }])], debut: 0, fin: 2 * W + 500 });
cas('hebdo négatif (requête avant 0)', { personnes: [P([{ debut: 100, fin: 200, hebdo: true }])], debut: -2 * W, fin: 300 });
cas('occupation hebdo sur créneau ponctuel', { personnes: [P([{ debut: 0, fin: 3 * W }], [{ debut: 0, fin: 720, hebdo: true }])], debut: 0, fin: 3 * W });
cas('personne sans créneau bloque tout', { personnes: [P([{ debut: 0, fin: 100 }]), P([])], debut: 0, fin: 100 });
// Aléatoire à graine
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const ri = (a, b) => a + Math.floor(rnd() * (b - a));
const iv = () => { const d = ri(-3 * W, 4 * W); const h = rnd() < 0.3; return { debut: d, fin: d + ri(-20, h ? 3000 : 5000), ...(h ? { hebdo: true } : {}) }; };
for (let b = 0; b < 4; b++) {
  const personnes = Array.from({ length: ri(1, 4) }, () => P(Array.from({ length: ri(3, 25) }, iv), Array.from({ length: ri(0, 10) }, iv)));
  cas('aléatoire #' + (b + 1), { personnes, debut: ri(-2 * W, W), fin: ri(2 * W, 5 * W), dureeMin: ri(0, 90) });
}
{ // performance
  const personnes = Array.from({ length: 4 }, () => P(Array.from({ length: 2000 }, () => { const d = ri(0, 525600); return { debut: d, fin: d + ri(1, 600) }; }), Array.from({ length: 500 }, () => { const d = ri(0, 525600); return { debut: d, fin: d + ri(1, 60), ...(rnd() < 0.1 ? { hebdo: true } : {}) }; })));
  const q = { personnes, debut: 0, fin: 525600, dureeMin: 15 };
  const t = performance.now(); let got, err = '';
  try { got = f(structuredClone(q)); } catch (e) { err = e.message; }
  const ms = performance.now() - t, ok = !err && ms < 1000 && norm(got) === norm(ref(q));
  tot.push('perf'); if (ok) pts++;
  console.log((ok ? 'OK    ' : 'ECHEC ') + `performance (${ms.toFixed(0)} ms)` + (err ? ' ' + err : ''));
}
console.log(`\nscore ${pts}/${tot.length}`);
