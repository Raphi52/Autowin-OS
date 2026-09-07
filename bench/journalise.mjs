#!/usr/bin/env node
/**
 * journalise.mjs [--remplace] [--sec]
 *
 * Lit les journaux bench/logs/<bras>.log, en tire les CHIFFRES MESURES (cout et duree rendus par
 * le modele lui-meme, code de sortie du critere binaire) et ecrit une ligne par bras dans le
 * journal des duels du depot REEL (`node scripts/arena-duel.mjs noter`, lance depuis
 * C:/Sources/AutoWinOS — le journal s'ecrit dans le dossier courant).
 *
 * Un banc = un defaut (D1, D2, D3), deux bras : `a` = pipeline complet, `x` = build direct +
 * verification ciblee. Le journal n'accepte que les noms de bras a/b/c/x : 3 bancs de 2 bras
 * donnent bien 6 cles uniques (`banc :: bras`).
 *
 * VERDICT — decide par les mesures, jamais par un avis, et DANS CET ORDRE :
 *   1. le critere binaire atteint ou non (bench/check-dX.mjs) ;
 *   2. a critere egal, l'axe HORS-CRITERE (bench/hors-critere.mjs) : un bras qui laisse une
 *      REGRESSION derriere lui (vert devenu rouge : formatage, lint, test voisin, stabilite)
 *      ne peut pas gagner contre un bras propre, meme s'il a ete plus rapide ;
 *   3. a egalite sur les deux, la duree, avec un seuil de bruit de 30 % (en dessous : `nul`).
 *   Aucun bras n'atteint le critere -> `perdant` des deux cotes.
 *
 * Exit 0 = 6 lignes ecrites · 1 = un journal illisible ou une notation refusee.
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BENCH = path.dirname(fileURLToPath(import.meta.url))
const DEPOT_REEL = 'C:/Sources/AutoWinOS'
const SEUIL_BRUIT = 0.3
const remplace = process.argv.includes('--remplace')
const secOnly = process.argv.includes('--sec')
const BRAS = ['d1-a', 'd1-x', 'd2-a', 'd2-x', 'd3-a', 'd3-x']
const DEFAUTS = {
  d1: 'scout-residus : la donnee du test dependait d un dossier existant sur le poste (chemin absolu mort)',
  d2: 'ecran de demarrage : index.html avait perdu les deux couleurs que le lanceur porte encore',
  d3: 'ChatComposer : un ref ecrit pendant le rendu, 3 erreurs react-hooks/refs qui rendent le lint rouge'
}
const WORKFLOWS = {
  a: 'pipeline complet (scout-frame-terrain-build-clean-judge, chaque etape ecrite avant d agir)',
  x: 'build direct + verification ciblee (aucun plan, correctif puis relance du seul critere)'
}

function entrees(fichier) {
  const texte = readFileSync(fichier, 'utf8')
  const blocs = texte.split('=== ENTREE ===').slice(1)
  return blocs.map((b) => {
    const champ = (nom) => {
      const m = b.match(new RegExp(`^# ${nom}=(.*)$`, 'm'))
      return m ? m[1].trim() : ''
    }
    const i = b.indexOf('--- STDOUT ---')
    const j = b.indexOf('--- STDERR ---')
    return {
      role: champ('ROLE'),
      exit: Number(champ('EXIT')),
      dureeS: Number(champ('DUREE_S')),
      stdout: i >= 0 && j > i ? b.slice(i + 14, j) : ''
    }
  })
}

const mesures = []
for (const nom of BRAS) {
  const fichier = path.join(BENCH, 'logs', `${nom}.log`)
  if (!existsSync(fichier)) {
    console.error(`RATE journal absent : logs/${nom}.log`)
    process.exit(1)
  }
  const es = entrees(fichier)
  const rouge = es.find((e) => e.role === 'critere-rouge')
  const bras = es.filter((e) => e.role === 'bras').at(-1)
  const vert = es.filter((e) => e.role === 'critere-vert').at(-1)
  const hors = es.filter((e) => e.role === 'hors-critere').at(-1)
  if (!rouge) {
    console.error(`RATE ${nom} : aucun critere-rouge journalise — un vert ne prouverait rien`)
    process.exit(1)
  }
  if (rouge.exit === 0) {
    console.error(
      `RATE ${nom} : le critere de depart PASSAIT deja (exit 0) — le banc ne mesure rien`
    )
    process.exit(1)
  }
  if (!bras || !vert) {
    console.error(
      `RATE ${nom} : bras=${Boolean(bras)} critere-vert=${Boolean(vert)} — banc incomplet`
    )
    process.exit(1)
  }
  // Cout et duree d'API : rendus par le modele lui-meme dans son JSON de sortie, jamais estimes.
  let coutUsd = null
  let dureeApiMs = null
  const ligne = bras.stdout.split('\n').find((l) => l.includes('total_cost_usd'))
  if (ligne) {
    try {
      const j = JSON.parse(ligne.trim())
      coutUsd = j.total_cost_usd ?? null
      dureeApiMs = j.duration_ms ?? j.duration_api_ms ?? null
    } catch {
      /* JSON illisible : on garde null et on le dit plus bas */
    }
  }
  mesures.push({
    nom,
    defaut: nom.slice(0, 2),
    bras: nom.slice(-1),
    coutUsd,
    dureeApiMs,
    dureeMurMs: bras.dureeS * 1000,
    brasExit: bras.exit,
    atteint: vert.exit === 0,
    critereExit: vert.exit,
    horsMesure: Boolean(hors),
    horsPropre: hors ? hors.exit === 0 : null,
    horsExit: hors ? hors.exit : null
  })
}

// --- Verdicts, banc par banc.
for (const d of ['d1', 'd2', 'd3']) {
  const duo = mesures.filter((m) => m.defaut === d)
  const gagnants = duo.filter((m) => m.atteint)
  if (gagnants.length === 1) {
    for (const m of duo) m.verdict = m.atteint ? 'gagnant' : 'perdant'
    continue
  }
  if (gagnants.length === 0) {
    for (const m of duo) m.verdict = 'perdant'
    continue
  }
  // Critere atteint des deux cotes : l'axe hors-critere departage AVANT la duree. Un bras
  // rapide qui casse un test voisin n'a pas gagne, il a deplace le probleme.
  const propres = duo.filter((m) => m.horsPropre === true)
  if (propres.length === 1) {
    for (const m of duo) m.verdict = m.horsPropre === true ? 'gagnant' : 'perdant'
    continue
  }
  const [p, q] = duo.map((m) => m.dureeMurMs)
  const ecart = Math.abs(p - q) / Math.max(p, q)
  if (ecart > SEUIL_BRUIT) {
    const rapide = duo.reduce((a, b) => (a.dureeMurMs <= b.dureeMurMs ? a : b))
    for (const m of duo) m.verdict = m === rapide ? 'gagnant' : 'perdant'
  } else {
    for (const m of duo) m.verdict = 'nul'
  }
}

// --- Ecriture dans le journal du depot REEL.
let echecs = 0
for (const m of mesures) {
  const banc = `banc-defauts-2026-09-07-${m.defaut}`
  const args = [
    'scripts/arena-duel.mjs',
    'noter',
    '--tache',
    DEFAUTS[m.defaut],
    '--workflow',
    WORKFLOWS[m.bras],
    '--bras',
    m.bras,
    '--banc',
    banc,
    '--duree-ms',
    String(m.dureeMurMs),
    '--cout-usd',
    String(m.coutUsd ?? 0),
    '--verdict',
    m.verdict,
    '--critere',
    `bench/check-${m.defaut}.mjs rend "CRITERE ATTEINT" (exit 0) sur la copie du bras`,
    '--atteint',
    m.atteint ? 'oui' : 'non',
    '--preuve',
    `node bench/check-${m.defaut}.mjs bench/runs/${m.nom}`,
    '--note',
    `copie ${m.nom} ; bras exit ${m.brasExit} ; critere final exit ${m.critereExit} ; ` +
      `hors-critere ${m.horsMesure ? (m.horsPropre ? 'propre' : `regression (exit ${m.horsExit})`) : 'non mesure'} ; ` +
      `duree API ${m.dureeApiMs ?? 'inconnue'} ms ; cout ${m.coutUsd ?? 'non rendu par le modele'}`
  ]
  if (remplace) args.push('--remplace')
  if (secOnly) {
    console.log(
      `SEC ${m.nom} -> ${m.verdict} (critere=${m.atteint ? 'atteint' : 'rate'}, hors-critere=${
        m.horsMesure ? (m.horsPropre ? 'propre' : 'regression') : 'non mesure'
      }, cout=${m.coutUsd}, mur=${m.dureeMurMs} ms)`
    )
    continue
  }
  const r = spawnSync('node', args, { cwd: DEPOT_REEL, encoding: 'utf8' })
  const sortie = `${r.stdout || ''}${r.stderr || ''}`.trim()
  console.log(
    `${r.status === 0 ? 'OK  ' : 'RATE'} ${m.nom} (${m.verdict}) — ${sortie.split('\n')[0]}`
  )
  if (r.status !== 0) {
    console.log(sortie)
    echecs += 1
  }
}
if (echecs) {
  console.log(`${echecs} notation(s) refusee(s)`)
  process.exit(1)
}
console.log(
  secOnly
    ? 'A SEC : rien ecrit'
    : `${mesures.length} bras journalises dans ${DEPOT_REEL}/.autowin-data/autowin-os/arena-duels.jsonl`
)
