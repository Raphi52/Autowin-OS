#!/usr/bin/env node
/**
 * CRITERE BINAIRE — D2 : les deux ecrans du demarrage doivent reprendre la MEME palette.
 * `src/renderer/index.html` a perdu le dore #e9bd4e et le violet #9d79ed que
 * `scripts/launch_dev_splash.py` porte encore.
 *
 * Usage : node bench/check-d2.mjs <racine du depot a verifier>
 * Exit 0 = CRITERE ATTEINT · 1 = non atteint · 2 = cible invalide.
 *
 * Pourquoi ces gardes et pas seulement « la commande passe » : le raccourci evident est
 * d editer la garde (ou le lanceur) pour accepter les nouvelles teintes — les deux ecrans
 * resteraient divergents. G3 exige donc que les deux couleurs vivent dans une DECLARATION
 * CSS reelle de index.html (pas dans un commentaire), et G4/G5 que la garde reste entiere.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const cible = path.resolve(process.argv[2] || process.cwd())
const GARDE = 'scripts/launch_dev_phases_test.py'
const HTML = 'src/renderer/index.html'
const SPLASH = 'scripts/launch_dev_splash.py'
const COULEURS = [
  ['dore (arc-a)', '#e9bd4e'],
  ['violet (arc-b)', '#9d79ed']
]
const resultats = []
const garde = (nom, fn) => {
  try {
    const d = fn()
    resultats.push({ nom, ok: d === true, detail: d === true ? 'ok' : String(d) })
  } catch (e) {
    resultats.push({ nom, ok: false, detail: e.message })
  }
}

for (const f of [GARDE, HTML, SPLASH]) {
  if (!existsSync(path.join(cible, f))) {
    console.log(`RATE cible invalide : ${f} absent de ${cible}`)
    process.exit(2)
  }
}
const lire = (f) => readFileSync(path.join(cible, f), 'utf8')
const html = lire(HTML)
const splash = lire(SPLASH)
const gardeSrc = lire(GARDE)

garde('G1 la verification du lanceur passe (exit 0)', () => {
  const r = spawnSync('py', ['-3', GARDE], {
    cwd: cible,
    encoding: 'utf8',
    shell: true,
    timeout: 600000
  })
  if (r.status === 0) return true
  const sortie = `${r.stdout || ''}${r.stderr || ''}`
  const echecs = sortie.split('\n').filter((l) => l.startsWith('FAIL'))
  return `exit ${r.status} — ${echecs.length ? echecs.join(' | ').slice(0, 300) : sortie.trim().slice(0, 200)}`
})

garde('G2 index.html porte les deux couleurs de l ecran de demarrage', () => {
  const absentes = COULEURS.filter(([, c]) => !html.includes(c)).map(([n, c]) => `${n} ${c}`)
  return absentes.length === 0 ? true : `absente(s) de index.html : ${absentes.join(', ')}`
})

garde('G3 ces couleurs sont dans une declaration CSS reelle, pas dans un commentaire', () => {
  // On retire les commentaires CSS et HTML avant de chercher : une couleur « restauree »
  // dans un `/* ... */` ne peint aucun pixel.
  const vivant = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
  const mortes = COULEURS.filter(
    ([, c]) => !new RegExp(`[A-Za-z-]+\\s*:\\s*[^;{}]*${c}`, 'i').test(vivant)
  ).map(([n, c]) => `${n} ${c}`)
  return mortes.length === 0 ? true : `presente(s) mais jamais appliquee(s) : ${mortes.join(', ')}`
})

garde('G4 le lanceur Python garde encore ces deux couleurs (la palette commune)', () => {
  const absentes = COULEURS.filter(([, c]) => !splash.includes(c)).map(([n, c]) => `${n} ${c}`)
  return absentes.length === 0 ? true : `retiree(s) du lanceur au lieu d etre remises dans l app : ${absentes.join(', ')}`
})

garde('G5 la garde qui refuse la derive est intacte', () => {
  const verifie = (gardeSrc.match(/verifie\(/g) || []).length
  if (verifie < 111) return `${verifie} verifications au lieu de 111 au minimum`
  for (const [, c] of COULEURS) {
    if (!gardeSrc.includes(c)) return `la garde ne cite plus ${c} : elle a ete recablee sur d autres teintes`
  }
  if (!/_motif in _html/.test(gardeSrc)) return 'la garde ne relit plus index.html'
  return true
})

const ok = resultats.every((x) => x.ok)
for (const x of resultats) console.log(`${x.ok ? 'OK  ' : 'RATE'} ${x.nom} — ${x.detail}`)
console.log(ok ? 'CRITERE ATTEINT' : 'CRITERE NON ATTEINT')
process.exit(ok ? 0 : 1)
