#!/usr/bin/env node
/**
 * CE QUE LE BRIEFING `think` APPORTE, MESURE SANS AUCUN APPEL DE MODELE.
 *
 * `think` coute de l'argent a chaque run (lignes `phase: "think"` de `activity/*.jsonl`) sans
 * qu'aucun gain n'ait ete mesure. Le banc `/arena` a ete ecarte pour son cout (conv-892,
 * 2026-10-01). Ce script compare, sur les donnees DEJA ecrites par l'app :
 *   - les fichiers cites dans la section `## Localisation` du briefing (`run-state/<run>.json`) ;
 *   - les fichiers REELLEMENT modifies ensuite par les commits `agent <runId>:` du depot ;
 *   - les fichiers deja nommes par la TACHE, pour separer ce que `think` a trouve de ce qu'on lui
 *     avait donne.
 * Et il rend la mediane du cout de `think` avant et apres le 2026-09-27 (fin des extraits de notes).
 *
 * LES « TROUS », par deux signaux sans modele (`mesurerTrous`) : un trou qui citait un fichier
 * modifie ensuite, et un repere du trou repris par une etape suivante du meme run. CE QU'IL NE MESURE
 * PAS : si le trou a reellement gene le travail. Le juger demande de lire le sens, donc un modele.
 *
 * Usage : node scripts/mesure-valeur-think.mjs [--data <racine>] [--exclure <runId>]... [--json]
 *   --data     defaut : `$AUTOWIN_DATA_ROOT`, sinon `<depot>/.autowin-data/autowin-os`.
 *   --exclure  retire un run de l'echantillon (ex. le run qui a ecrit ce script, qui se mesurerait).
 * Sortie 0 = mesure rendue ; 2 = racine de donnees introuvable.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Date ou le run a cesse de fournir des extraits de notes a `think` (choix utilisateur). */
export const BASCULE = Date.parse('2026-09-27T00:00:00Z')

/**
 * Regle de decision de la piste « sauter think quand la tache nomme son fichier », FIXEE AVANT la
 * mesure (cadrage du 2026-10-01) : on construit le saut seulement si, sur au moins
 * `DECISION_MIN_CAS` taches qui nomment un fichier, la Localisation n'apporte AUCUN fichier modifie
 * absent de la tache dans au moins `DECISION_SEUIL` des cas.
 */
export const DECISION_MIN_CAS = 5
export const DECISION_SEUIL = 0.8

/** Extensions reconnues comme fichiers de code ou de doc du depot. */
const EXT = 'tsx?|mts|cts|mjs|cjs|jsx?|json|md|ps1|psm1|ya?ml|css|html|cs|xaml|lua|luau|py|toml'

/** Un chemin avec au moins un dossier : `src/main/x.ts`, `skills/think/SKILL.md`. */
const CHEMIN = new RegExp(`(?:[\\w.@-]+/)+[\\w.@-]+\\.(?:${EXT})\\b`, 'giu')
/** Un nom de fichier nu : `orchestrator.ts:3643`, `SKILL.md`. */
const NOM_NU = new RegExp(`(?<![\\w./@-])[\\w.@-]+\\.(?:${EXT})\\b`, 'giu')

function normaliserChemin(chemin) {
  return chemin.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function nomDeBase(chemin) {
  const parts = normaliserChemin(chemin).split('/')
  return parts[parts.length - 1].toLowerCase()
}

/**
 * Les fichiers qu'un texte cite : chemins complets d'un cote, noms nus de l'autre.
 * Un chemin complet donne aussi son nom de base, pour l'appariement par nom.
 */
export function fichiersCites(texte) {
  const source = (texte ?? '').replace(/\\/g, '/')
  const chemins = new Set()
  const noms = new Set()
  for (const m of source.matchAll(CHEMIN)) {
    const chemin = normaliserChemin(m[0])
    chemins.add(chemin)
    noms.add(nomDeBase(chemin))
  }
  for (const m of source.matchAll(NOM_NU)) noms.add(nomDeBase(m[0]))
  return { chemins, noms }
}

/** Le corps de la section `## <titre>` (insensible aux accents et a la casse), ou ''. */
export function section(texte, titre) {
  const voulu = titre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const lignes = (texte ?? '').split('\n')
  const debut = lignes.findIndex((ligne) => {
    const m = /^\s{0,3}#{1,3}\s+(.+)$/u.exec(ligne)
    if (!m) return false
    const t = m[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    return t.split(/[^a-z0-9]+/)[0] === voulu
  })
  if (debut < 0) return ''
  const fin = lignes.findIndex((ligne, i) => i > debut && /^\s{0,3}#{1,2}\s+/u.test(ligne))
  return lignes.slice(debut + 1, fin < 0 ? undefined : fin).join('\n')
}

/** Un fichier modifie est-il cite ? Par chemin complet, ou a defaut par son nom de base. */
export function estCite(fichier, cites) {
  const chemin = normaliserChemin(fichier)
  if (cites.chemins.has(chemin)) return true
  // Un chemin cite plus court que le vrai (`main/x.ts` pour `src/main/x.ts`) designe le meme fichier.
  for (const c of cites.chemins) if (chemin.endsWith(`/${c}`)) return true
  return cites.noms.has(nomDeBase(chemin))
}

/**
 * La mesure d'UN run : ce que la Localisation citait, ce qui a ete modifie, et ce que la
 * Localisation a apporte au-dela de la tache.
 */
export function mesurerRun({ tache, briefing, modifies }) {
  const localisation = fichiersCites(section(briefing, 'localisation'))
  const dansTache = fichiersCites(tache)
  const modif = [...new Set(modifies.map(normaliserChemin))]
  const touches = modif.filter((f) => estCite(f, localisation))
  const apportes = touches.filter((f) => !estCite(f, dansTache))
  return {
    tacheNommeUnFichier: dansTache.noms.size > 0,
    citesLocalisation: localisation.noms.size,
    modifies: modif.length,
    modifiesCites: touches.length,
    apportes,
    rappel: modif.length ? touches.length / modif.length : null
  }
}

/**
 * Les « Trous » d'un briefing, mesures SANS modele — deux signaux, nommes pour ce qu'ils sont :
 *  - `fichiersTrouModifies` : les fichiers modifies ensuite que la section `## Trous` citait ; le
 *    trou portait donc sur le chemin reel du travail ;
 *  - `reprisPlusTard` : les reperes `entre accents graves` du trou qu'une etape suivante du MEME run
 *    repete. Une mention n'est pas la preuve que le trou a gene.
 * fix-ok: objection du juge (reparation 2, run-85d8e7f57af2-1) — la mesure ne disait rien des Trous
 * et comptait le run qui l'a ecrite ; mesure-valeur-think.test.mjs rouge (4 cas) avant.
 */
export function mesurerTrous({ briefing, modifies, suite }) {
  const trous = section(briefing, 'trous')
  const reperes = [...new Set([...trous.matchAll(/`([^`\n]{3,})`/gu)].map((m) => m[1].trim()))]
  const cites = fichiersCites(trous)
  const fichiersTrouModifies = [...new Set((modifies ?? []).map(normaliserChemin))].filter((f) =>
    estCite(f, cites)
  )
  const texteSuite = suite ?? ''
  return {
    reperes: reperes.length,
    reprisPlusTard: reperes.filter((repere) => texteSuite.includes(repere)),
    fichiersTrouModifies
  }
}

/** Les runs a retirer de l'echantillon : chaque `--exclure <runId>`. */
export function runsExclus(argv) {
  const exclus = new Set()
  argv.forEach((arg, i) => {
    if (arg === '--exclure' && argv[i + 1]) exclus.add(argv[i + 1])
  })
  return exclus
}

export function mediane(valeurs) {
  const v = [...valeurs].sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/**
 * Decision de la piste « sauter think », appliquee telle que fixee AVANT la mesure.
 * `cas` = les mesures des runs dont la tache nomme un fichier.
 */
export function decisionSaut(cas) {
  const sansApport = cas.filter((c) => c.apportes.length === 0).length
  if (cas.length < DECISION_MIN_CAS) {
    return {
      construire: false,
      raison: `${cas.length} cas seulement (minimum ${DECISION_MIN_CAS}) : la mesure ne permet pas de conclure.`
    }
  }
  const part = sansApport / cas.length
  const construire = part >= DECISION_SEUIL
  return {
    construire,
    raison:
      `${sansApport}/${cas.length} taches nommant un fichier sans aucun fichier modifie apporte par la ` +
      `Localisation (${Math.round(part * 100)} %, seuil ${Math.round(DECISION_SEUIL * 100)} %).`
  }
}

/** Les identifiants de run nommes par un message de commit. */
export function runsDuMessage(sujet) {
  return [...new Set((sujet ?? '').match(/\brun-[0-9a-f]{12}-\d+\b/giu) ?? [])]
}

/**
 * Fichiers modifies par run, lus dans tous les commits (toutes branches) dont le message NOMME le
 * run : `agent run-<id>`, `agent run-<id>: …`, `salvage(run-<id>)`, « travail préservé de la copie
 * run-<id> » — les quatre formes relevees le 2026-10-01.
 * fix-ok: run-85d8e7f57af2-1 — la 1re version exigeait `agent run-<id>:` avec deux-points et ne
 * rattachait qu'UN run a un commit (contre 16 annonces) : les vrais messages n'ont souvent pas ce
 * deux-points. Autre reprise : `URL.pathname` rendait `/D:/...` sous Windows, remplace par fileURLToPath.
 */
function fichiersParRun(depot) {
  const sortie = execFileSync(
    'git',
    ['log', '--all', '--no-merges', '--name-only', '--format=@@%s', '--grep=run-'],
    { cwd: depot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  )
  const parRun = new Map()
  let courants = []
  for (const ligne of sortie.split('\n')) {
    if (ligne.startsWith('@@')) {
      courants = runsDuMessage(ligne.slice(2))
      continue
    }
    const fichier = ligne.trim()
    if (!fichier) continue
    for (const run of courants) {
      if (!parRun.has(run)) parRun.set(run, new Set())
      parRun.get(run).add(fichier)
    }
  }
  return parRun
}

/** Les lignes de cout `think` de `activity/*.jsonl`, et le total des couts rattaches a un run. */
function coutsThink(racine, exclus = new Set()) {
  const dossier = join(racine, 'activity')
  const think = []
  let totalRuns = 0
  for (const nom of readdirSync(dossier).filter((n) => n.endsWith('.jsonl'))) {
    for (const ligne of readFileSync(join(dossier, nom), 'utf8').split('\n')) {
      if (!ligne.includes('"costUsd"')) continue
      let l
      try {
        l = JSON.parse(ligne)
      } catch {
        continue
      }
      if (typeof l.costUsd !== 'number' || !l.runId || exclus.has(l.runId)) continue
      totalRuns += l.costUsd
      if (l.phase === 'think') think.push({ ts: Date.parse(l.ts), cout: l.costUsd, runId: l.runId })
    }
  }
  return { think, totalRuns }
}

function briefings(racine) {
  const dossier = join(racine, 'run-state')
  const sortie = []
  for (const nom of readdirSync(dossier).filter((n) => n.endsWith('.json'))) {
    let etat
    try {
      etat = JSON.parse(readFileSync(join(dossier, nom), 'utf8'))
    } catch {
      continue
    }
    const sorties = etat.phaseOutputs ?? []
    const rang = sorties.findIndex((o) => o.phase === 'think')
    const think = sorties[rang]
    if (!think || typeof think.text !== 'string' || !think.text.trim()) continue
    // Ce que les etapes SUIVANTES du meme run ont ecrit : la ou un trou peut etre repris.
    const suite = sorties
      .slice(rang + 1)
      .map((o) => (typeof o.text === 'string' ? o.text : ''))
      .join('\n')
    sortie.push({ runId: etat.runId, tache: String(etat.task ?? ''), briefing: think.text, suite })
  }
  return sortie
}

const dollars = (v) => (v == null ? '—' : `${v.toFixed(2)} $`)

function principal(argv) {
  const depot = fileURLToPath(new URL('..', import.meta.url))
  const iData = argv.indexOf('--data')
  const racine =
    iData >= 0
      ? resolve(argv[iData + 1])
      : process.env.AUTOWIN_DATA_ROOT || join(depot, '.autowin-data', 'autowin-os')
  if (!existsSync(join(racine, 'run-state')) || !existsSync(join(racine, 'activity'))) {
    console.error(`Racine de donnees introuvable (run-state/ et activity/ attendus) : ${racine}`)
    return 2
  }

  const parRun = fichiersParRun(depot)
  const exclus = runsExclus(argv)
  const lus = briefings(racine).filter((b) => !exclus.has(b.runId))
  const runs = lus
    .filter((b) => parRun.has(b.runId))
    .map((b) => ({ runId: b.runId, ...mesurerRun({ ...b, modifies: [...parRun.get(b.runId)] }) }))
  const trous = lus.map((b) => ({
    runId: b.runId,
    avecCommit: parRun.has(b.runId),
    ...mesurerTrous({ ...b, modifies: [...(parRun.get(b.runId) ?? [])] })
  }))
  const avecReperes = trous.filter((t) => t.reperes > 0)
  const trousResume = {
    briefingsAvecReperes: avecReperes.length,
    reperes: avecReperes.reduce((s, t) => s + t.reperes, 0),
    reprisPlusTard: avecReperes.reduce((s, t) => s + t.reprisPlusTard.length, 0),
    briefingsDontUnTrouEstRepris: avecReperes.filter((t) => t.reprisPlusTard.length > 0).length,
    runsAvecCommit: trous.filter((t) => t.avecCommit).length,
    runsDontUnTrouCiteUnFichierModifie: trous.filter((t) => t.fichiersTrouModifies.length > 0)
      .length
  }

  const couts = coutsThink(racine, exclus)
  const { think, totalRuns } = couts
  const coutThink = think.reduce((s, l) => s + l.cout, 0)
  const avant = mediane(think.filter((l) => l.ts < BASCULE).map((l) => l.cout))
  const apres = think.filter((l) => l.ts >= BASCULE).map((l) => l.cout)

  const nommant = runs.filter((r) => r.tacheNommeUnFichier)
  const decision = decisionSaut(nommant)
  const rappels = runs.map((r) => r.rappel).filter((v) => v != null)

  const resultat = {
    briefingsComplets: lus.length,
    runsAvecCommit: runs.length,
    rappelMedian: mediane(rappels),
    runsOuLocalisationApporte: runs.filter((r) => r.apportes.length > 0).length,
    coutThink: {
      passages: think.length,
      total: coutThink,
      partDesRuns: totalRuns ? coutThink / totalRuns : null
    },
    medianeAvant: avant,
    apres,
    decisionSaut: decision,
    exclus: [...exclus],
    trous: trousResume,
    runs
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(resultat, null, 2))
    return 0
  }

  console.log(
    `Briefings think complets : ${lus.length} ; dont rattaches a un commit : ${runs.length}` +
      (exclus.size ? ` (exclus : ${[...exclus].join(', ')})` : '')
  )
  console.log('')
  console.log(
    'run | tache nomme un fichier | cites Localisation | modifies | modifies cites | apportes par think'
  )
  for (const r of runs) {
    console.log(
      `${r.runId} | ${r.tacheNommeUnFichier ? 'oui' : 'non'} | ${r.citesLocalisation} | ${r.modifies} | ` +
        `${r.modifiesCites} | ${r.apportes.length ? r.apportes.join(', ') : '—'}`
    )
  }
  console.log('')
  const rm = resultat.rappelMedian
  console.log(
    `Part mediane des fichiers modifies que la Localisation citait : ${rm == null ? '—' : `${Math.round(rm * 100)} %`}`
  )
  console.log(
    `Runs ou la Localisation cite un fichier modifie que la tache ne nommait pas : ${resultat.runsOuLocalisationApporte}/${runs.length}`
  )
  console.log('')
  const t = trousResume
  console.log(
    `Trous : ${t.briefingsAvecReperes}/${lus.length} briefings y nomment des reperes ; ` +
      `${t.reprisPlusTard}/${t.reperes} reperes repris par une etape suivante ` +
      `(${t.briefingsDontUnTrouEstRepris} briefings) ; ` +
      `${t.runsDontUnTrouCiteUnFichierModifie}/${t.runsAvecCommit} runs a commit dont un trou citait un fichier modifie ensuite`
  )
  console.log(
    '  (mention ou fichier touche — pas la preuve que le trou a gene : cela demanderait un modele)'
  )
  console.log('')
  console.log(
    `Cout think : ${think.length} passages, ${dollars(coutThink)} au total, ` +
      `${resultat.coutThink.partDesRuns == null ? '—' : `${(resultat.coutThink.partDesRuns * 100).toFixed(1)} %`} des couts rattaches a un run`
  )
  console.log(
    `Mediane avant le 2026-09-27 : ${dollars(avant)} ; apres : ${apres.map(dollars).join(' / ') || '—'}`
  )
  console.log('')
  console.log(
    `Sauter think quand la tache nomme son fichier : ${decision.construire ? 'OUI' : 'NON'} — ${decision.raison}`
  )
  return 0
}

const lanceDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (lanceDirectement) process.exit(principal(process.argv.slice(2)))
