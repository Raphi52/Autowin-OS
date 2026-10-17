/**
 * Mesure du VRAI taux de faux vert du juge, à partir d'un petit échantillon étiqueté par l'humain.
 *
 * Pourquoi (conv-996, 2026-10-16) : `trust.jsonl` portait 798 verdicts du juge et AUCUNE confirmation
 * humaine. `calibration()` de src/main/trust/ledger.ts rendait donc `accuracy: null`, et les paris des
 * agents (src/main/activity/pari-step.ts) se calibraient contre ce même juge jamais vérifié : la
 * « limite honnête » de la constitution n'était pas mesurée. Étiqueter les 171 runs coûterait des heures ;
 * un échantillon STRATIFIÉ de ~40 runs, tiré au hasard avec une graine, suffit pour une estimation
 * sans biais avec son intervalle de confiance.
 *
 * Trois choix, et leur motif :
 * 1. L'unité est le RUN, jugé sur son DERNIER verdict. Un run a souvent plusieurs passages du juge
 *    (rouge, réparation, vert) et une confirmation humaine s'applique à TOUS ses verdicts
 *    (`TrustLedger.appliquer`). Seul le dernier porte sur le résultat que l'humain voit.
 * 2. Les strates viennent de ce qui est connu pour TOUS les runs : verdict final et nombre de passages
 *    (validé du premier coup / validé après réparation / rouge final).
 * 3. L'estimateur « PPI » prend ici sa forme population finie : l'estimateur par différence (régression)
 *    des sondages. La note du juge (SCORE: NN), connue pour tous les runs, sert de prédicteur ;
 *    les étiquettes humaines corrigent son biais. Avec une pente λ = 0, on retrouve exactement
 *    l'estimateur stratifié classique, que le rapport affiche aussi pour que le gain se voie.
 *    Références : Angelopoulos et al., « Prediction-powered inference », Science 2023 ;
 *    Fisch et al., « Stratified Prediction-Powered Inference », NeurIPS 2024 ;
 *    Särndal, Swensson & Wretman, « Model Assisted Survey Sampling », 1992 (estimateur par régression).
 *
 * Usage :
 *   node scripts/juge-faux-vert.mjs inventaire
 *   node scripts/juge-faux-vert.mjs tirer [--n 40] [--rouges 8] [--graine 20261016] [--remplacer]
 *   node scripts/juge-faux-vert.mjs fiche      (réécrit fiche.md sans refaire le tirage)
 *   node scripts/juge-faux-vert.mjs estimer
 * Le tirage est écrit sous `.autowin-data/<profil>/etiquetage-juge/` (echantillon.json + fiche.md).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const STRATES = Object.freeze({
  VERT_1ER: 'vert-1er-passage',
  VERT_REPARE: 'vert-apres-reparation',
  ROUGE: 'rouge-final'
})
/** Les strates qui portent la cible : « quand le juge dit vert, a-t-il tort ? ». */
export const STRATES_CIBLE = Object.freeze([STRATES.VERT_1ER, STRATES.VERT_REPARE])

const Z95 = 1.959964

export function cheminsDonnees(racine = process.cwd(), profil = 'autowin-os') {
  const base = path.join(racine, '.autowin-data', profil)
  return {
    base,
    trust: path.join(base, 'trust.jsonl'),
    activite: path.join(base, 'activity'),
    runs: path.join(base, 'runs'),
    runState: path.join(base, 'run-state'),
    sortie: path.join(base, 'etiquetage-juge')
  }
}

/**
 * Lit trust.jsonl. Rend les verdicts groupés par run (dans l'ordre chronologique), la DERNIÈRE
 * confirmation humaine de chaque run (une ligne suivante corrige la précédente, comme dans le ledger),
 * et le nombre de verdicts sans runId (anciens : non ré-étiquetables, donc hors population).
 */
export function lireVerdicts(texte) {
  const parRun = new Map()
  const confirmations = new Map()
  let sansRun = 0
  let rang = 0
  for (const ligne of texte.split(/\r?\n/)) {
    if (!ligne.trim()) continue
    let o
    try {
      o = JSON.parse(ligne)
    } catch {
      continue
    }
    if (o.kind === 'confirmation') {
      if (o.runId && (o.humanTruth === 'green' || o.humanTruth === 'red')) {
        confirmations.set(o.runId, o.humanTruth)
      }
      continue
    }
    if (o.verdict !== 'green' && o.verdict !== 'red') continue
    if (!o.runId) {
      sansRun += 1
      continue
    }
    const liste = parRun.get(o.runId) ?? []
    liste.push({
      verdict: o.verdict,
      ts: o.ts ?? '',
      conversationId: o.conversationId ?? '',
      rang: rang++
    })
    parRun.set(o.runId, liste)
  }
  for (const liste of parRun.values()) {
    liste.sort((a, b) => (a.ts === b.ts ? a.rang - b.rang : a.ts < b.ts ? -1 : 1))
  }
  return { parRun, confirmations, sansRun }
}

/** Dernière note « SCORE: NN » d'un texte de juge, ou null. */
export function noteDuTexte(texte) {
  const toutes = [...String(texte ?? '').matchAll(/SCORE:\s*(\d{1,3})\b/g)]
  if (toutes.length === 0) return null
  const n = Number(toutes[toutes.length - 1][1])
  return n >= 0 && n <= 100 ? n : null
}

/** Notes du juge par run, dans l'ordre chronologique, depuis des lignes d'activité déjà parsées. */
export function notesDuJuge(lignes) {
  const parRun = new Map()
  for (const o of lignes) {
    if (o?.kind !== 'judge' || !o.runId) continue
    const note = noteDuTexte(o.text)
    if (note === null) continue
    const liste = parRun.get(o.runId) ?? []
    liste.push({ ts: o.ts ?? '', note })
    parRun.set(o.runId, liste)
  }
  const rendu = new Map()
  for (const [runId, liste] of parRun) {
    liste.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
    rendu.set(
      runId,
      liste.map((x) => x.note)
    )
  }
  return rendu
}

export function strateDe(verdictFinal, passages) {
  if (verdictFinal === 'red') return STRATES.ROUGE
  return passages > 1 ? STRATES.VERT_REPARE : STRATES.VERT_1ER
}

/**
 * Prédicteur f d'un run : plus la note finale est basse, plus le run est suspect. Toute fonction
 * affine de la note donne le même estimateur (la constante s'annule, l'échelle passe dans λ), donc
 * aucun réglage arbitraire ici. Une note manquante prend la moyenne de sa strate (`populationDesRuns`).
 */
export function predicteurDeNote(note) {
  return note === null || note === undefined ? null : (100 - note) / 100
}

/** Une ligne par run de trust.jsonl portant un runId : la population à échantillonner. */
export function populationDesRuns(parRun, notes) {
  const unites = []
  for (const [runId, verdicts] of parRun) {
    const dernier = verdicts[verdicts.length - 1]
    const notesRun = notes.get(runId) ?? []
    const noteFinale = notesRun.length ? notesRun[notesRun.length - 1] : null
    unites.push({
      runId,
      conversationId: dernier.conversationId,
      ts: dernier.ts,
      verdictFinal: dernier.verdict,
      passages: verdicts.length,
      noteFinale,
      strate: strateDe(dernier.verdict, verdicts.length),
      f: predicteurDeNote(noteFinale)
    })
  }
  // Note absente : moyenne de la strate, pour que f existe pour TOUTE la population.
  const moyennes = new Map()
  for (const s of Object.values(STRATES)) {
    const connus = unites.filter((u) => u.strate === s && u.f !== null).map((u) => u.f)
    moyennes.set(s, connus.length ? connus.reduce((a, b) => a + b, 0) / connus.length : 0)
  }
  for (const u of unites) {
    u.fImpute = u.f === null
    if (u.f === null) u.f = moyennes.get(u.strate)
  }
  unites.sort((a, b) => (a.runId < b.runId ? -1 : 1))
  return unites
}

/**
 * Répartit n étiquettes : `rouges` sur la strate rouge (pour le taux de faux rouge), le reste sur
 * les verts AU PRORATA de leur taille (plus fort reste), puis chaque strate verte non vide est
 * remontée à `minimum` en prenant sur la plus grosse : une strate à 1 étiquette n'a pas de variance.
 * Jamais plus que la taille d'une strate.
 */
export function allouer(effectifs, n, rouges, minimum = 3) {
  const alloc = {}
  for (const s of Object.values(STRATES)) alloc[s] = 0
  const nRouge = Math.min(rouges, effectifs[STRATES.ROUGE] ?? 0)
  alloc[STRATES.ROUGE] = nRouge
  const verts = STRATES_CIBLE.filter((s) => (effectifs[s] ?? 0) > 0)
  const totalVerts = verts.reduce((a, s) => a + effectifs[s], 0)
  const budget = Math.min(n - nRouge, totalVerts)
  if (budget <= 0) return alloc
  const restes = verts.map((s) => {
    const ideal = (budget * effectifs[s]) / totalVerts
    alloc[s] = Math.floor(ideal)
    return { s, frac: ideal - Math.floor(ideal) }
  })
  let manque = budget - verts.reduce((a, s) => a + alloc[s], 0)
  for (const r of [...restes].sort((a, b) => b.frac - a.frac)) {
    if (manque <= 0) break
    if (alloc[r.s] < effectifs[r.s]) {
      alloc[r.s] += 1
      manque -= 1
    }
  }
  for (const s of verts) {
    const plancher = Math.min(minimum, effectifs[s])
    while (alloc[s] < plancher) {
      const donneuse = verts
        .filter((d) => d !== s && alloc[d] > Math.min(minimum, effectifs[d]))
        .sort((a, b) => alloc[b] - alloc[a])[0]
      if (!donneuse) break
      alloc[donneuse] -= 1
      alloc[s] += 1
    }
  }
  return alloc
}

/** Générateur pseudo-aléatoire à graine (mulberry32) : le tirage doit se rejouer à l'identique. */
export function generateur(graine) {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Tire l'échantillon : chaque strate est MÉLANGÉE en entier (Fisher-Yates), les `alloc[s]` premiers
 * sont à étiqueter, la suite forme la RÉSERVE, dans l'ordre du mélange. Un run impossible à juger se
 * remplace par le suivant de la réserve : tout préfixe d'un mélange aléatoire reste un tirage aléatoire.
 */
export function tirer(population, alloc, graine) {
  const alea = generateur(graine)
  const parStrate = {}
  for (const s of Object.values(STRATES)) {
    const membres = population.filter((u) => u.strate === s).map((u) => u.runId)
    for (let i = membres.length - 1; i > 0; i -= 1) {
      const j = Math.floor(alea() * (i + 1))
      ;[membres[i], membres[j]] = [membres[j], membres[i]]
    }
    parStrate[s] = { aEtiqueter: membres.slice(0, alloc[s]), reserve: membres.slice(alloc[s]) }
  }
  return parStrate
}

const moyenne = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
function varianceEchantillon(xs) {
  if (xs.length < 2) return null
  const m = moyenne(xs)
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)
}

/** Intervalle de Wilson sur une taille effective (Korn & Graubard) : reste dans [0,1] près de 0. */
export function wilson(p, nEff, z = Z95) {
  if (!(nEff > 0)) return { bas: 0, haut: 1 }
  const q = Math.min(1, Math.max(0, p))
  const z2 = z * z
  const centre = (q + z2 / (2 * nEff)) / (1 + z2 / nEff)
  const demi = (z * Math.sqrt((q * (1 - q)) / nEff + z2 / (4 * nEff * nEff))) / (1 + z2 / nEff)
  return { bas: Math.max(0, centre - demi), haut: Math.min(1, centre + demi) }
}

/**
 * Estime une proportion sur un ensemble de strates.
 * `strates` : [{ nom, N, fPop (moyenne de f sur les N), etiquettes: [{ y: 0|1, f }] }].
 * `ppi` = false : estimateur stratifié classique. `ppi` = true : estimateur par différence avec une
 * pente λ commune, estimée DANS les strates (pente intra-strate poolée) ; λ = 0 si elle n'est pas
 * estimable (moins de 6 étiquettes, ou f constant), ce qui retombe exactement sur le classique.
 * Variance avec correction de population finie (1 − n/N) : la cible est le taux sur CES runs.
 */
export function estimer(strates, { ppi = false } = {}) {
  const avecEtiquettes = strates.filter((s) => s.etiquettes.length > 0)
  const sansEtiquette = strates.filter((s) => s.etiquettes.length === 0).map((s) => s.nom)
  const nTotal = avecEtiquettes.reduce((a, s) => a + s.etiquettes.length, 0)
  if (nTotal === 0) {
    return {
      estimation: null,
      n: 0,
      provisoire: true,
      stratesSansEtiquette: sansEtiquette,
      lambda: 0
    }
  }
  let lambda = 0
  if (ppi && nTotal >= 6) {
    let num = 0
    let den = 0
    for (const s of avecEtiquettes) {
      const my = moyenne(s.etiquettes.map((e) => e.y))
      const mf = moyenne(s.etiquettes.map((e) => e.f))
      for (const e of s.etiquettes) {
        num += (e.y - my) * (e.f - mf)
        den += (e.f - mf) ** 2
      }
    }
    lambda = den > 1e-12 ? num / den : 0
  }
  const NTotal = avecEtiquettes.reduce((a, s) => a + s.N, 0)
  const pooled = moyenne(avecEtiquettes.flatMap((s) => s.etiquettes.map((e) => e.y)))
  let theta = 0
  let variance = 0
  const detail = []
  for (const s of avecEtiquettes) {
    const W = s.N / NTotal
    const n = s.etiquettes.length
    const ys = s.etiquettes.map((e) => e.y)
    const fs = s.etiquettes.map((e) => e.f)
    const thetaS = moyenne(ys) + lambda * (s.fPop - moyenne(fs))
    const residus = s.etiquettes.map((e) => e.y - lambda * e.f)
    // Une seule étiquette : variance non estimable dans la strate, on prend celle du taux poolé.
    const s2 = varianceEchantillon(residus) ?? pooled * (1 - pooled)
    const fpc = Math.max(0, 1 - n / s.N)
    theta += W * thetaS
    variance += W * W * fpc * (s2 / n)
    detail.push({
      strate: s.nom,
      N: s.N,
      n,
      poids: W,
      estimation: thetaS,
      observes: ys.reduce((a, b) => a + b, 0)
    })
  }
  const borne = Math.min(1, Math.max(0, theta))
  const et = Math.sqrt(variance)
  const nEff =
    variance > 1e-12 && borne > 0 && borne < 1 ? (borne * (1 - borne)) / variance : nTotal
  return {
    estimation: borne,
    estimationBrute: theta,
    ecartType: et,
    wald: { bas: Math.max(0, theta - Z95 * et), haut: Math.min(1, theta + Z95 * et) },
    wilson: wilson(borne, nEff),
    nEffectif: nEff,
    n: nTotal,
    lambda,
    provisoire: sansEtiquette.length > 0,
    stratesSansEtiquette: sansEtiquette,
    detail
  }
}

/**
 * Assemble l'entrée de `estimer` depuis un échantillon gelé et les confirmations humaines.
 * Seules comptent les confirmations des runs TIRÉS (à étiqueter ou réserve) : une confirmation
 * donnée ailleurs a été CHOISIE par l'humain, elle biaiserait l'estimation. `cible` dit quelle
 * erreur on mesure : 'faux-vert' (y = 1 si le résultat était mauvais) ou 'faux-rouge' (y = 1 s'il était bon).
 */
export function stratesEtiquetees(echantillon, confirmations, cible) {
  const noms = cible === 'faux-rouge' ? [STRATES.ROUGE] : STRATES_CIBLE
  const parRun = new Map(echantillon.population.map((u) => [u.runId, u]))
  return noms.map((nom) => {
    const membres = echantillon.population.filter((u) => u.strate === nom)
    const ordre = [...echantillon.tirage[nom].aEtiqueter, ...echantillon.tirage[nom].reserve]
    const etiquettes = []
    for (const runId of ordre) {
      const verite = confirmations.get(runId)
      if (!verite) continue
      const y = cible === 'faux-rouge' ? (verite === 'green' ? 1 : 0) : verite === 'red' ? 1 : 0
      etiquettes.push({ runId, y, f: parRun.get(runId).f })
    }
    return {
      nom,
      N: membres.length,
      fPop: membres.length ? moyenne(membres.map((u) => u.f)) : 0,
      etiquettes
    }
  })
}

// ——— Lecture du disque (hors des fonctions pures, pour que les tests n'en dépendent pas) ———

function lireActivite(dossier) {
  const lignes = []
  if (!existsSync(dossier)) return lignes
  for (const nom of readdirSync(dossier)) {
    if (!nom.endsWith('.jsonl')) continue
    for (const l of readFileSync(path.join(dossier, nom), 'utf8').split(/\r?\n/)) {
      // Filtre texte avant le parse : 20 Mo de journaux, seules les lignes du juge servent.
      if (!l.includes('"kind":"judge"')) continue
      try {
        lignes.push(JSON.parse(l))
      } catch {
        /* ligne coupée : ignorée */
      }
    }
  }
  return lignes
}

/**
 * Le run PROPRIÉTAIRE d'un dossier de travail : celui que sa trace cite le plus. Un RUN.md cite aussi
 * d'autres runs (une branche `autowin/recovery/run-…` à fusionner, un run précédent) : relier par
 * simple mention attribuait le RUN.md d'un salvage au run qu'il réparait. Mesuré le 2026-10-16 sur
 * runs/conv-710 : le propriétaire est cité 49 à 162 fois, un run voisin 0 à 2 fois.
 */
export function proprietaireDuDossier(texte) {
  const comptes = new Map()
  for (const m of String(texte).matchAll(/run-[0-9a-f]{12}-\d+/g))
    comptes.set(m[0], (comptes.get(m[0]) ?? 0) + 1)
  let meilleur = null
  for (const [runId, n] of comptes) if (!meilleur || n > meilleur.n) meilleur = { runId, n }
  return meilleur
}

/** runId → { chemin du RUN.md (ou du dossier), première ligne du besoin }, via `proprietaireDuDossier`. */
function indexDesRunMd(dossierRuns) {
  const index = new Map()
  if (!existsSync(dossierRuns)) return index
  for (const conv of readdirSync(dossierRuns, { withFileTypes: true })) {
    if (!conv.isDirectory()) continue
    const dossierConv = path.join(dossierRuns, conv.name)
    for (const ws of readdirSync(dossierConv, { withFileTypes: true })) {
      if (!ws.isDirectory()) continue
      const d = path.join(dossierConv, ws.name)
      const lire = (nom) =>
        existsSync(path.join(d, nom)) ? readFileSync(path.join(d, nom), 'utf8') : ''
      const runMd = lire('RUN.md')
      const proprio = proprietaireDuDossier(lire('trace.json') || runMd)
      if (!proprio) continue
      const deja = index.get(proprio.runId)
      if (deja && deja.mentions >= proprio.n) continue
      index.set(proprio.runId, {
        chemin: runMd ? path.join(d, 'RUN.md') : d,
        besoin: /## Besoin\s*\n+([^\n]+)/.exec(runMd)?.[1]?.trim() ?? '',
        mentions: proprio.n
      })
    }
  }
  return index
}

/** Première ligne parlante de la tâche gardée dans run-state/<runId>.json (« go » seul ne dit rien). */
function demandeDuRunState(dossierRunState, runId) {
  const p = path.join(dossierRunState, `${runId}.json`)
  if (!existsSync(p)) return ''
  try {
    const lignes = String(JSON.parse(readFileSync(p, 'utf8')).task ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 3)
    return (lignes[0] ?? '').replace(/^CIBLE CONTEXTUALISEE\s*:\s*/i, '')
  } catch {
    return ''
  }
}

export function chargerPopulation(chemins) {
  const { parRun, confirmations, sansRun } = lireVerdicts(
    existsSync(chemins.trust) ? readFileSync(chemins.trust, 'utf8') : ''
  )
  const notes = notesDuJuge(lireActivite(chemins.activite))
  return { population: populationDesRuns(parRun, notes), confirmations, sansRun }
}

function effectifsDe(population) {
  const e = {}
  for (const s of Object.values(STRATES)) e[s] = population.filter((u) => u.strate === s).length
  return e
}

function argument(args, nom, defaut) {
  const i = args.indexOf(`--${nom}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : defaut
}

function pct(x) {
  return x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(1)} %`
}

function ficheMarkdown(echantillon, index, demandeDe) {
  const parRun = new Map(echantillon.population.map((u) => [u.runId, u]))
  const lignes = [
    `# Étiquetage du juge — tirage du ${echantillon.tireLe.slice(0, 10)} (graine ${echantillon.graine})`,
    '',
    'Pour chaque run : ouvre le RUN.md (ou la conversation), regarde le RÉSULTAT FINAL, et réponds',
    '« bon » s’il faisait vraiment ce qui était demandé, « faux » sinon. Ne regarde pas le verdict du',
    'juge avant de trancher : c’est lui qu’on mesure. Un run impossible à juger se SAUTE et se',
    'remplace par le premier de la réserve de la même strate, dans l’ordre.',
    ''
  ]
  for (const s of Object.values(STRATES)) {
    const t = echantillon.tirage[s]
    lignes.push(`## ${s} — ${t.aEtiqueter.length} à étiqueter sur ${echantillon.effectifs[s]}`, '')
    lignes.push('| # | run | conversation | date | demande | RUN.md |', '|---|---|---|---|---|---|')
    t.aEtiqueter.forEach((runId, i) => {
      const u = parRun.get(runId)
      const r = index.get(runId)
      const besoin = (r?.besoin || demandeDe(runId) || '—').replace(/\|/g, '/').slice(0, 110)
      lignes.push(
        `| ${i + 1} | \`${runId}\` | ${u.conversationId || '—'} | ${u.ts.slice(0, 10)} | ${besoin} | ${r ? `\`${path.relative(echantillon.racine, r.chemin)}\`` : 'aucun'} |`
      )
    })
    lignes.push(
      '',
      `Réserve (dans l’ordre) : ${
        t.reserve
          .slice(0, 6)
          .map((r) => `\`${r}\``)
          .join(', ') || 'vide'
      }`,
      ''
    )
  }
  return lignes.join('\n')
}

/** (Ré)écrit fiche.md depuis un tirage gelé : la fiche se corrige sans refaire l'échantillon. */
function ecrireFiche(chemins, echantillon) {
  const index = indexDesRunMd(chemins.runs)
  const fiche = path.join(chemins.sortie, 'fiche.md')
  const texte = ficheMarkdown(echantillon, index, (r) => demandeDuRunState(chemins.runState, r))
  writeFileSync(fiche, `${texte}\n`, 'utf8')
  const tires = Object.values(echantillon.tirage).flatMap((t) => t.aEtiqueter)
  return { fiche, aEtiqueter: tires.length, avecDossier: tires.filter((r) => index.has(r)).length }
}

function principal(args) {
  const racine = process.cwd()
  const chemins = cheminsDonnees(racine, argument(args, 'profil', 'autowin-os'))
  const commande = args[0]
  if (commande === 'inventaire') {
    const { population, confirmations, sansRun } = chargerPopulation(chemins)
    const notees = population.filter((u) => !u.fImpute).length
    console.log(
      JSON.stringify(
        {
          runs: population.length,
          effectifs: effectifsDe(population),
          notesConnues: notees,
          verdictsSansRun: sansRun,
          confirmations: confirmations.size
        },
        null,
        2
      )
    )
    return 0
  }
  if (commande === 'tirer') {
    const fichier = path.join(chemins.sortie, 'echantillon.json')
    if (existsSync(fichier) && !args.includes('--remplacer')) {
      console.error(
        `Un tirage existe déjà (${fichier}). Le refaire après le début de l’étiquetage fausserait le hasard ; --remplacer pour forcer.`
      )
      return 2
    }
    const n = Number(argument(args, 'n', '40'))
    const rouges = Number(argument(args, 'rouges', '8'))
    const graine = Number(argument(args, 'graine', '20261016'))
    const { population, sansRun } = chargerPopulation(chemins)
    const effectifs = effectifsDe(population)
    const alloc = allouer(effectifs, n, rouges)
    const tirage = tirer(population, alloc, graine)
    const echantillon = {
      schema: 'autowin.etiquetage-juge/v1',
      tireLe: new Date().toISOString(),
      graine,
      racine,
      effectifs,
      allocation: alloc,
      verdictsSansRun: sansRun,
      population,
      tirage
    }
    mkdirSync(chemins.sortie, { recursive: true })
    writeFileSync(fichier, `${JSON.stringify(echantillon, null, 2)}\n`, 'utf8')
    ecrireFiche(chemins, echantillon)
    console.log(
      JSON.stringify(
        { fichier, fiche: path.join(chemins.sortie, 'fiche.md'), effectifs, allocation: alloc },
        null,
        2
      )
    )
    return 0
  }
  if (commande === 'fiche') {
    const fichier = path.join(chemins.sortie, 'echantillon.json')
    if (!existsSync(fichier)) {
      console.error('Aucun tirage : lance d’abord `node scripts/juge-faux-vert.mjs tirer`.')
      return 2
    }
    console.log(
      JSON.stringify(ecrireFiche(chemins, JSON.parse(readFileSync(fichier, 'utf8'))), null, 2)
    )
    return 0
  }
  if (commande === 'estimer') {
    const fichier = path.join(chemins.sortie, 'echantillon.json')
    if (!existsSync(fichier)) {
      console.error('Aucun tirage : lance d’abord `node scripts/juge-faux-vert.mjs tirer`.')
      return 2
    }
    const echantillon = JSON.parse(readFileSync(fichier, 'utf8'))
    const { confirmations } = lireVerdicts(
      existsSync(chemins.trust) ? readFileSync(chemins.trust, 'utf8') : ''
    )
    const fv = stratesEtiquetees(echantillon, confirmations, 'faux-vert')
    const fr = stratesEtiquetees(echantillon, confirmations, 'faux-rouge')
    const rapport = {
      fauxVert: { classique: estimer(fv), ppi: estimer(fv, { ppi: true }) },
      fauxRouge: estimer(fr),
      confirmationsHorsTirage: [...confirmations.keys()].filter(
        (r) =>
          !Object.values(echantillon.tirage).some(
            (t) => t.aEtiqueter.includes(r) || t.reserve.includes(r)
          )
      ).length
    }
    console.log(JSON.stringify(rapport, null, 2))
    const p = rapport.fauxVert.ppi
    console.log(
      `\nFaux vert (PPI) : ${pct(p.estimation)} — IC 95 % Wilson [${pct(p.wilson?.bas)} ; ${pct(p.wilson?.haut)}] sur ${p.n} étiquettes, λ=${(p.lambda ?? 0).toFixed(3)}${p.provisoire ? ' — PROVISOIRE, strates sans étiquette : ' + p.stratesSansEtiquette.join(', ') : ''}`
    )
    return 0
  }
  console.error('Commande : inventaire | tirer | fiche | estimer')
  return 2
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  process.exitCode = principal(process.argv.slice(2))
}
