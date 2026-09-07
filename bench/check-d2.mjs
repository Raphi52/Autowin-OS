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

// G4 — REECRITE le 2026-09-07 pour la meme raison que G5, et PLUS STRICTE.
// L'ancienne version cherchait l'hexadecimal dans le TEXTE du lanceur : elle passait sur un simple
// commentaire (defaut constate) et interdisait la source unique. On EXECUTE desormais le lanceur et
// on lit les couleurs qu'il peint VRAIMENT, puis on les compare a celles de index.html.
garde('G4 le lanceur peint REELLEMENT la palette de index.html (valeurs executees, pas texte)', () => {
  const py = spawnSync(
    'py',
    ['-3', '-c', 'import sys;sys.path.insert(0,"scripts");import launch_dev_splash as m;print(m._DORE,m._VIOLET)'],
    { cwd: cible, encoding: 'utf8' }
  )
  if (py.status !== 0) return 'le lanceur ne se charge pas : ' + (py.stderr || '').trim().slice(-160)
  const peintes = (py.stdout || '').trim().toLowerCase().split(/\s+/)
  const ecarts = COULEURS.filter(([, c], i) => peintes[i] !== c.toLowerCase()).map(
    ([n, c], i) => `${n} attendu ${c}, peint ${peintes[i] ?? 'rien'}`
  )
  return ecarts.length === 0 ? true : `les deux ecrans divergent : ${ecarts.join(' ; ')}`
})

// G5 — REECRITE le 2026-09-07, et volontairement PLUS STRICTE que la version d'origine.
//
// L'ancienne version exigeait que le fichier de garde CONTIENNE la chaine `#e9bd4e`. C'etait une
// assertion sur du TEXTE, et elle recompensait la mauvaise conception : une garde qui epingle un
// hexadecimal en dur ne peut pas suivre un changement de palette, et elle passe aussi bien sur un
// COMMENTAIRE que sur une couleur reellement peinte (les deux defauts ont ete constates ici meme).
// Elle PUNISSAIT donc la seule vraie reunion des palettes : faire DERIVER le lanceur de index.html.
//
// La version ci-dessous n'exige plus aucun litteral. Elle exige la PROPRIETE : une source unique,
// lue, et une comparaison sur la valeur reellement utilisee par le lanceur.
garde('G5 la palette a une SOURCE UNIQUE : le lanceur la derive de index.html, il ne la recopie pas', () => {
  const verifie = (gardeSrc.match(/verifie\(/g) || []).length
  if (verifie < 111) return `${verifie} verifications au lieu de 111 au minimum`
  // 1. Le lanceur ne doit plus porter AUCUN des hexadecimaux de la palette en dur.
  const enDur = COULEURS.filter(([, c]) => splash.toLowerCase().includes(c.toLowerCase()))
  if (enDur.length > 0)
    return `le lanceur recopie encore ${enDur.map(([n, c]) => `${n} ${c}`).join(', ')} a la main : deux copies peuvent rediverger`
  // 2. Il doit les DERIVER du degrade de index.html.
  if (!/_DORE = _ARCS\.group\(1\)/.test(splash) || !/_VIOLET = _ARCS\.group\(2\)/.test(splash))
    return 'le lanceur ne derive plus sa palette du degrade de index.html'
  // 3. La garde doit relire index.html ET comparer la valeur REELLE du lanceur, pas son texte source.
  if (!/linear-gradient/.test(gardeSrc)) return 'la garde ne relit plus le degrade de index.html'
  if (!/_mod\._DORE/.test(gardeSrc) || !/_mod\._VIOLET/.test(gardeSrc))
    return 'la garde ne compare plus la couleur REELLEMENT peinte par le lanceur (une sous-chaine passe sur un commentaire)'
  return true
})

const ok = resultats.every((x) => x.ok)
for (const x of resultats) console.log(`${x.ok ? 'OK  ' : 'RATE'} ${x.nom} — ${x.detail}`)
console.log(ok ? 'CRITERE ATTEINT' : 'CRITERE NON ATTEINT')
process.exit(ok ? 0 : 1)
