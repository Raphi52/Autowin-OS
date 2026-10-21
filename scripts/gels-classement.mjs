/**
 * CLASSEMENT DES GELS — la première étape de la skill `/gel` (skills/gel/SKILL.md).
 *
 * Pourquoi ce script (conv-1036, 2026-10-21) : 13 fils « /heal j'ai eu un freeze » ont tous refait
 * la même enquête à la main — découvrir `gels.jsonl`, l'agréger avec un `node -e` jetable, puis
 * chercher dans `src/` d'où venait `main/index.js:16278`. Les deux outils existaient déjà sans
 * procédure : le journal (src/main/gel-main.ts) et les cartes `.map` à côté du bundle
 * (electron.vite.config.ts, `sourcemap: true`).
 *
 * TROIS FAMILLES, jamais additionnées entre elles :
 *   - gel de FENÊTRE (processus principal) : le battement a pris du retard, la fenêtre était figée ;
 *   - gel du RENDU (`renderer:*`) : la boucle de l'interface était tenue, autre processus ;
 *   - appel lent UNITAIRE (`io:*`) : un seul appel synchrone au-dessus du seuil. Il est DÉJÀ compté
 *     dans le gel de fenêtre qui le contient (son `accumulation`) : le sommer en plus compterait deux
 *     fois le même temps. Mesuré sur la queue du journal le 2026-10-21 : `io:… git status` 15 025 ms
 *     et le gel de fenêtre de 30 734 ms dont `accumulation` porte ce même `git status`.
 *
 * Le panneau de l'app (`resumerGels`, src/shared/gel-detector.ts) additionne les trois : ses totaux
 * ne sont donc pas ceux-ci. Ce script ne le remplace pas, il ajoute l'appelant et sa source.
 *
 * Usage : node scripts/gels-classement.mjs [--jours 14 | --depuis <ISO>] [--journal <chemin>]
 *                                          [--out <dossier du bundle>] [--top 10] [--json]
 * Sortie 0 = classement rendu ; 2 = journal absent ; 3 = ni gel ni démarrage de l'instrument dans la
 * période (un journal muet ne prouve alors rien).
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SourceMap } from 'node:module'
import { pathToFileURL } from 'node:url'

/** Une frame qui retombe dans l'instrument lui-même ne nomme pas le coupable : on la saute. */
const SOURCES_DE_L_INSTRUMENT = /(^|\/)gel-(main|detector)\.ts$/

/**
 * État de la carte d'une pile entière : il ne fait que MONTER, frame après frame.
 *
 * Une seule frame remontée par une carte postérieure au gel rend toute la pile suspecte, même si une
 * autre frame n'a pas de carte du tout. Avant (2026-10-21, conv-1036), la frame sans carte écrasait
 * ce constat : un gel du 15/10 sortait vers `conversation-file-trace-spool.ts:68`, une ligne sans
 * aucun rapport, affichée comme une source.
 */
const GRAVITE_DE_LA_CARTE = [
  'sans-objet',
  'en-vigueur',
  'absente',
  'posterieure-au-demarrage',
  'posterieure-au-gel'
]
const pire = (a, b) => (GRAVITE_DE_LA_CARTE.indexOf(b) > GRAVITE_DE_LA_CARTE.indexOf(a) ? b : a)

/** Une carte écrite après le chargement du code qui a gelé : ses lignes décrivent un autre bundle. */
const CARTES_SUSPECTES = new Set(['posterieure-au-demarrage', 'posterieure-au-gel'])

/** Le dernier démarrage de l'instrument à `ts` ou avant : l'app a chargé son code à ce moment-là. */
export function demarrageAvant(demarragesMs, ts) {
  const gelMs = Date.parse(ts ?? '')
  let dernier
  for (const ms of demarragesMs ?? []) {
    if (ms <= gelMs && (dernier === undefined || ms > dernier)) dernier = ms
  }
  return dernier
}

/** Lit le journal ligne à ligne. Une ligne illisible est COMPTÉE, jamais jetée en silence. */
export function lireJournal(texte) {
  const gels = []
  let illisibles = 0
  for (const brut of texte.split(/\r?\n/)) {
    const ligne = brut.trim()
    if (!ligne) continue
    try {
      gels.push(JSON.parse(ligne))
    } catch {
      illisibles += 1
    }
  }
  return { gels, illisibles }
}

const familleDe = (gel) => {
  const op = typeof gel.operation === 'string' ? gel.operation : ''
  if (op.startsWith('io:')) return 'unitaire'
  if (op.startsWith('renderer:')) return 'rendu'
  return 'fenetre'
}

const nomDeLOperation = (gel) => {
  const op = typeof gel.operation === 'string' && gel.operation ? gel.operation : 'inconnu'
  return op === 'inconnu' && typeof gel.indice === 'string' && gel.indice
    ? `inconnu (piste: ${gel.indice})`
    : op
}

function cumuler(table, cle, ms, extra = {}) {
  const agg = table.get(cle) ?? { gels: 0, cumulMs: 0, pireMs: 0, ...extra }
  agg.gels += 1
  agg.cumulMs += ms
  if (ms > agg.pireMs) agg.pireMs = ms
  table.set(cle, agg)
  return agg
}

const trier = (table, nomCle) =>
  [...table.entries()]
    .map(([cle, agg]) => ({ [nomCle]: cle, ...agg }))
    .sort((a, b) => b.cumulMs - a.cumulMs)

/**
 * Classe les gels d'une période. `depuisMs` absent = tout le journal.
 * Rend des totaux SÉPARÉS par famille, et l'attribution par appelant des seuls gels de fenêtre.
 */
export function classerGels(gels, { depuisMs } = {}) {
  const fenetre = new Map()
  const rendu = new Map()
  const appelants = new Map()
  const totaux = {
    fenetre: { gels: 0, cumulMs: 0, pireMs: 0 },
    rendu: { gels: 0, cumulMs: 0, pireMs: 0 },
    unitaires: { appels: 0, cumulMs: 0 },
    nonImputables: { gels: 0, cumulMs: 0 },
    sansAppelant: { gels: 0, cumulMs: 0 },
    demarrages: 0,
    horsPeriode: 0,
    sansDuree: 0
  }
  // Tous les démarrages, période ou non : celui qui précède un gel de la période peut être plus ancien.
  const demarragesMs = []
  for (const gel of gels) {
    const instant = Date.parse(gel?.ts ?? '')
    if (gel?.temoin === 'demarrage' && Number.isFinite(instant)) demarragesMs.push(instant)
    if (depuisMs !== undefined && !(instant >= depuisMs)) {
      totaux.horsPeriode += 1
      continue
    }
    if (gel.temoin) {
      if (gel.temoin === 'demarrage') totaux.demarrages += 1
      continue
    }
    const ms =
      typeof gel.blocageMs === 'number' && Number.isFinite(gel.blocageMs) ? gel.blocageMs : 0
    if (ms <= 0) {
      totaux.sansDuree += 1
      continue
    }
    // Réel mais pas de notre fait : l'opération déclarée à cet instant n'est qu'une coïncidence.
    if (gel.cause === 'process-prive-de-cpu') {
      totaux.nonImputables.gels += 1
      totaux.nonImputables.cumulMs += ms
      continue
    }
    const famille = familleDe(gel)
    if (famille === 'unitaire') {
      totaux.unitaires.appels += 1
      totaux.unitaires.cumulMs += ms
      continue
    }
    const total = famille === 'rendu' ? totaux.rendu : totaux.fenetre
    total.gels += 1
    total.cumulMs += ms
    if (ms > total.pireMs) total.pireMs = ms
    const agg = cumuler(famille === 'rendu' ? rendu : fenetre, nomDeLOperation(gel), ms, {
      dernierTs: gel.ts
    })
    if (gel.ts > agg.dernierTs) agg.dernierTs = gel.ts
    if (famille === 'rendu') {
      if (gel.conversationId) {
        agg.conversations = agg.conversations ?? {}
        agg.conversations[gel.conversationId] = (agg.conversations[gel.conversationId] ?? 0) + 1
      }
      continue
    }
    // Attribution : les contributeurs mesurés de la fenêtre, sinon l'appelant porté par le gel.
    const contributeurs = Array.isArray(gel.accumulation)
      ? gel.accumulation.filter((c) => c && typeof c.cumulMs === 'number')
      : []
    if (contributeurs.length) {
      for (const c of contributeurs) {
        const appel = cumuler(appelants, `${c.operation}\u0000${c.appelant ?? ''}`, c.cumulMs, {
          operation: c.operation,
          appelant: c.appelant ?? '',
          appels: 0,
          dernierTs: gel.ts
        })
        appel.appels += typeof c.appels === 'number' ? c.appels : 1
        if (gel.ts > appel.dernierTs) appel.dernierTs = gel.ts
      }
    } else if (gel.appelant) {
      const appel = cumuler(appelants, `${gel.operation}\u0000${gel.appelant}`, ms, {
        operation: gel.operation,
        appelant: gel.appelant,
        appels: 0,
        dernierTs: gel.ts
      })
      appel.appels += 1
      if (gel.ts > appel.dernierTs) appel.dernierTs = gel.ts
    } else {
      totaux.sansAppelant.gels += 1
      totaux.sansAppelant.cumulMs += ms
    }
  }
  return {
    totaux,
    fenetre: trier(fenetre, 'operation'),
    rendu: trier(rendu, 'operation'),
    appelants: [...appelants.values()].sort((a, b) => b.cumulMs - a.cumulMs),
    demarragesMs
  }
}

/**
 * Où vit le bundle d'une frame condensée (`main/index.js:L:C`, `chunks/x.js:L:C`), relatif à `out/`.
 * Undefined pour une frame qui n'est pas du bundle (dépendance, source déjà en `.ts`).
 */
export function fichierDuBundle(frame, racineOut) {
  const m = /^(main|chunks)\/([^/:]+\.js):(\d+):(\d+)$/.exec(frame.trim())
  if (!m) return undefined
  const fichier =
    m[1] === 'main' ? join(racineOut, 'main', m[2]) : join(racineOut, 'main', 'chunks', m[2])
  return { fichier, ligne: Number(m[3]), colonne: Number(m[4]) }
}

/**
 * Remonte un appelant du bundle à ses sources `src/…:ligne`, grâce aux `.map`.
 *
 * `carte` dit si la position est FIABLE : une carte réécrite APRÈS le gel (`posterieure-au-gel`), ou
 * après le démarrage `demarrageMs` qui le précède (`posterieure-au-demarrage`, juge de conv-1043),
 * décrit un autre bundle que celui que l'app avait chargé — la ligne obtenue tombe alors à côté.
 */
export function resoudreAppelant(appelant, { racineOut, gelTs, demarrageMs, cache = new Map() }) {
  const frames = String(appelant ?? '')
    .split(' < ')
    .map((f) => f.trim())
    .filter(Boolean)
  const sources = []
  let carte = 'sans-objet'
  for (const frame of frames) {
    if (/\.(ts|tsx|mts|cts):\d+/.test(frame)) {
      if (!SOURCES_DE_L_INSTRUMENT.test(frame.replace(/:\d+(:\d+)?$/, ''))) sources.push(frame)
      continue
    }
    const cible = fichierDuBundle(frame, racineOut)
    if (!cible) {
      sources.push(frame)
      continue
    }
    const chemin = `${cible.fichier}.map`
    let entree = cache.get(chemin)
    if (entree === undefined) {
      entree = existsSync(chemin)
        ? {
            carte: new SourceMap(JSON.parse(readFileSync(chemin, 'utf8'))),
            ecriteMs: statSync(chemin).mtimeMs
          }
        : null
      cache.set(chemin, entree)
    }
    if (!entree) {
      carte = pire(carte, 'absente')
      sources.push(`${frame} (carte absente)`)
      continue
    }
    const gelMs = Date.parse(gelTs ?? '')
    // Un démarrage POSTÉRIEUR au gel n'a pas chargé le code qui a gelé : il ne compte pas.
    const chargeMs =
      Number.isFinite(demarrageMs) && (!Number.isFinite(gelMs) || demarrageMs <= gelMs)
        ? demarrageMs
        : undefined
    carte = pire(
      carte,
      Number.isFinite(gelMs) && entree.ecriteMs > gelMs
        ? 'posterieure-au-gel'
        : chargeMs !== undefined && entree.ecriteMs > chargeMs
          ? 'posterieure-au-demarrage'
          : 'en-vigueur'
    )
    // findEntry compte lignes et colonnes à partir de 0 ; la pile V8, à partir de 1.
    const pos = entree.carte.findEntry(cible.ligne - 1, cible.colonne - 1)
    if (!pos?.originalSource) {
      sources.push(`${frame} (hors carte)`)
      continue
    }
    const source = pos.originalSource.replace(/\\/g, '/').replace(/^(\.\.\/)+/, '')
    if (SOURCES_DE_L_INSTRUMENT.test(source)) continue
    sources.push(`${source}:${pos.originalLine + 1}`)
  }
  return { sources, carte }
}

const secondes = (ms) => `${(ms / 1000).toFixed(1)} s`
const jour = (ts) => (typeof ts === 'string' ? ts.slice(0, 16).replace('T', ' ') : '')

/** Le classement en Markdown, prêt à coller dans le fil. */
export function rendreClassement(classement, { racineOut, top = 10, periode = '' } = {}) {
  const { totaux } = classement
  const cache = new Map()
  const l = []
  l.push(`## Gels ${periode}`.trim())
  l.push(
    `Fenêtre figée : **${secondes(totaux.fenetre.cumulMs)}** en ${totaux.fenetre.gels} gels (pire ${secondes(totaux.fenetre.pireMs)}) · ` +
      `rendu : **${secondes(totaux.rendu.cumulMs)}** en ${totaux.rendu.gels} gels · ` +
      `démarrages de l'instrument : ${totaux.demarrages}`
  )
  l.push(
    `Non additionnés : ${totaux.unitaires.appels} appels lents unitaires (déjà inclus dans les gels de fenêtre) · ` +
      `${totaux.nonImputables.gels} gels non imputables (processus privé de CPU, ${secondes(totaux.nonImputables.cumulMs)}) · ` +
      `${totaux.sansAppelant.gels} gels de fenêtre sans appelant (${secondes(totaux.sansAppelant.cumulMs)})`
  )
  l.push(
    '',
    '### Fenêtre figée — par opération',
    '',
    '| Opération | Gels | Cumul | Pire | Dernier |',
    '|---|---|---|---|---|'
  )
  for (const o of classement.fenetre.slice(0, top)) {
    l.push(
      `| \`${o.operation}\` | ${o.gels} | ${secondes(o.cumulMs)} | ${secondes(o.pireMs)} | ${jour(o.dernierTs)} |`
    )
  }
  l.push(
    '',
    '### Qui tient la fenêtre — par appelant, remonté aux sources',
    '',
    '| Appel | Appels | Cumul | Source | Carte |',
    '|---|---|---|---|---|'
  )
  for (const a of classement.appelants.slice(0, top)) {
    const { sources, carte } = a.appelant
      ? resoudreAppelant(a.appelant, {
          racineOut,
          gelTs: a.dernierTs,
          demarrageMs: demarrageAvant(classement.demarragesMs, a.dernierTs),
          cache
        })
      : { sources: [], carte: 'sans-objet' }
    /*
     * Une carte réécrite après le gel donne des sources FAUSSES, pas approximatives : mesuré le
     * 2026-10-21, un gel du processus principal y remontait vers `ask-choices.ts`, un fichier de
     * l'interface. On rend alors la frame brute — un emplacement faux enverrait corriger ailleurs.
     * Même règle pour une carte écrite après le démarrage qui précède le gel (juge de conv-1043).
     */
    const source = CARTES_SUSPECTES.has(carte)
      ? `\`${a.appelant}\` (non résolu)`
      : sources.length
        ? sources.map((s) => `\`${s}\``).join(' < ')
        : '—'
    l.push(`| \`${a.operation}\` | ${a.appels} | ${secondes(a.cumulMs)} | ${source} | ${carte} |`)
  }
  l.push(
    '',
    '### Rendu (interface) — par opération',
    '',
    '| Opération | Gels | Cumul | Pire | Fils les plus touchés |',
    '|---|---|---|---|---|'
  )
  for (const o of classement.rendu.slice(0, top)) {
    const fils = Object.entries(o.conversations ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, n]) => `${id}×${n}`)
      .join(', ')
    l.push(
      `| \`${o.operation}\` | ${o.gels} | ${secondes(o.cumulMs)} | ${secondes(o.pireMs)} | ${fils || '—'} |`
    )
  }
  return l.join('\n')
}

function argument(argv, nom) {
  const i = argv.indexOf(nom)
  return i >= 0 ? argv[i + 1] : undefined
}

export function principal(argv = process.argv.slice(2), sortie = console.log) {
  const journal = resolve(argument(argv, '--journal') ?? '.autowin-data/autowin-os/gels.jsonl')
  const racineOut = resolve(argument(argv, '--out') ?? 'out')
  const top = Number(argument(argv, '--top') ?? 10)
  const depuisIso = argument(argv, '--depuis')
  const jours = Number(argument(argv, '--jours') ?? 14)
  const depuisMs = depuisIso ? Date.parse(depuisIso) : Date.now() - jours * 86_400_000
  if (!existsSync(journal)) {
    sortie(`Journal des gels absent : ${journal}`)
    return 2
  }
  const { gels, illisibles } = lireJournal(readFileSync(journal, 'utf8'))
  const classement = classerGels(gels, { depuisMs })
  const periode = `depuis ${new Date(depuisMs).toISOString().slice(0, 16).replace('T', ' ')} (UTC)`
  if (argv.includes('--json')) {
    sortie(JSON.stringify({ journal, periode, illisibles, ...classement }, null, 2))
  } else {
    sortie(rendreClassement(classement, { racineOut, top, periode }))
    if (illisibles) sortie(`\n${illisibles} ligne(s) illisible(s) dans le journal.`)
  }
  const { totaux } = classement
  if (totaux.demarrages === 0 && totaux.fenetre.gels + totaux.rendu.gels === 0) {
    sortie(
      "\nNi gel ni démarrage de l'instrument dans la période : impossible de dire si l'app n'a pas gelé " +
        "ou si l'instrument était éteint (sortie 3). Élargis la période ou vérifie que l'app tourne."
    )
    return 3
  }
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(principal())
}
