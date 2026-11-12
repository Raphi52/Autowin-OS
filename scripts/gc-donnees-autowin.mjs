#!/usr/bin/env node
/**
 * LES DONNÉES D'AUTOWIN, ÉTAPE 3 DU `/gc` QUOTIDIEN (`skills/gc/SKILL.md`).
 *
 * `scripts/gc-disque.mjs` pèse `.autowin-data` sans la juger : un reste n'y est mort que si l'on sait
 * quels fils vivent et quels runs attendent encore un regard. Ce script tient ces deux listes, puis
 * applique les règles propres du skill, catégorie par catégorie. Chaque candidat porte sa PREUVE de
 * mort dans `motif` ; sans preuve, il reste. Avant lui, chaque passe réécrivait cette sonde à la main,
 * hors du dépôt, et la passe du 11/11 a dû y corriger une expression régulière à chaud.
 *
 * LES DEUX LISTES
 * - Fils vivants : `conversations.json`, puis son journal rejoué DANS L'ORDRE (`upsert` ajoute,
 *   `delete` retire), puis les archives (`idsArchives`, pierres tombales écartées). `--controle`
 *   reçoit des ids lus dans `get_state` : un seul absent et rien n'est jugé (code 2), car la liste
 *   serait fausse et tous les satellites de ce fil passeraient pour orphelins.
 * - Runs à garder : scan COMPLET de `runs/` (`scanRuns` sans borne + `isBlocked`), jamais la fenêtre
 *   de 24 RUN.md de `get_state` (les passes des 02 et 03/10 ont jeté 42 runs rouges sur cette foi).
 *   S'y ajoutent les travaux non publiés (`--travaux`, ids lus dans `get_state`) : leur `run-state`
 *   et la conversation qu'il nomme restent.
 *
 * LES RÈGLES, reprises du skill (même convention d'âge que `gc-disque.mjs` : jours pleins, seuil
 * atteint = candidat ; date des seuls FICHIERS, par `peser`) :
 * - satellites `activity/`, `causal-trace/`, `chat-artifacts/`, `turn-journals/` : l'id du nom n'est
 *   pas vivant, et rien n'y bouge depuis 24 h ;
 * - `prompt-observability/` (entrées directes, jamais `systems/`) : orphelin ET calme depuis 14 j —
 *   le skill y donne deux preuves, on exige les deux ;
 * - `runs/<session>` : calme depuis 30 j, aucun run bloqué, hors travaux non publiés ;
 * - `run-state/<run>.json` : calme depuis 30 j, sa `conversationId` lisible et sans run bloqué, hors
 *   travaux non publiés ;
 * - `run-stdout/` (fichiers directs) : calme depuis 14 j, son uuid cité par aucun `run-state` ;
 * - sauvegardes ponctuelles d'`autowin-os/` (`*.bak`, `*.bak.N`, `*.avant-*`, `*.pre-*`,
 *   `g.tmp.jsonl`) : calme depuis 14 j. Celles de `conversations.json` ne vont JAMAIS en corbeille :
 *   la purge garde d'office toute corbeille qui en contient une (`gc-purger-corbeilles.mjs`), le
 *   dossier du jour entier resterait. Elles sortent dans `aVerifier`, à ranger dans `sauvegardes/` ;
 * - bancs d'essai d'`autowin-os/` (`arena-bench*`, `banc-*`, `critere-reprises`, `judge-session-*`) :
 *   calme depuis 14 j ;
 * - racine des données (`tmp/`, `tmp-*.png`, `vitest-*.txt`, `*.log` de plus de 5 Mo) : calme
 *   depuis 7 j.
 * Jamais candidat : un nom dont l'id ne se lit pas sans ambiguïté, un reste pesé à moitié, un
 * dossier qui contient une copie git. Une sonde qui échoue retire sa catégorie du jour, et le dit.
 *
 * Usage, depuis le dépôt Autowin (`npx tsx` : `runs-scan.ts` importe sans extension, `node` seul
 * s'arrête sur ERR_MODULE_NOT_FOUND) :
 *   npx tsx scripts/gc-donnees-autowin.mjs [--balayer] [--donnees <chemin>]
 *     [--travaux run-a,run-b] [--controle conv-1,conv-2]
 *
 * Sans `--balayer`, lecture seule. Avec, chaque candidat part dans la corbeille de son disque par
 * `balayer` (`gc-disque.mjs`) : ligne de `MANIFEST.txt` écrite avant le renommage. Sortie : JSON.
 * Code 0 = passe faite ; 1 = une sonde ou un déplacement a échoué (dit dans le bilan) ; 2 = commande
 * refusée, ou un id de `--controle` absent de la liste vivante : rien n'a bougé.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { idsArchives } from './conversations-sur-disque.mjs'
import { balayer, depotEtDonnees, peser } from './gc-disque.mjs'

const JOUR_MS = 86_400_000
const SATELLITES = ['activity', 'causal-trace', 'chat-artifacts', 'turn-journals']
const SAUVEGARDE = /\.bak(\.\d+)?$|\.avant-|\.pre-|^g\.tmp\.jsonl$/u
const BANC = /^arena-bench|^banc-|^critere-reprises$|^judge-session-/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const LOG_LOURD_OCTETS = 5 * 1024 * 1024

/**
 * L'id de conversation d'un nom de satellite, ou `null` s'il ne se lit pas sans ambiguïté. Pure.
 * Un point devant (`.conv-12.sequence`) ne rend pas l'id ambigu ; après l'id vient la fin du nom, un
 * point ou un tiret (`conv-12.jsonl`, `conv-12-tour-3`). `conv-12abc` n'est l'id d'aucun fil.
 */
export function idDuSatellite(nom) {
  return /^\.?(conv-\d+)(?=$|[.-])/u.exec(nom)?.[1] ?? null
}

const lireJson = (chemin) => JSON.parse(readFileSync(chemin, 'utf8').replace(/^\uFEFF/u, ''))

/**
 * Les fils vivants : instantané, journal rejoué dans l'ordre, puis archives. Lève si l'instantané ou
 * une ligne du journal est illisible : une liste partielle condamnerait des fils vivants.
 */
export function filsVivants(autowinOs) {
  const fichier = join(autowinOs, 'conversations.json')
  const instantane = lireJson(fichier)
  const liste = Array.isArray(instantane) ? instantane : (instantane?.conversations ?? [])
  const ids = new Set(liste.map((c) => c?.id).filter(Boolean))
  const journal = join(autowinOs, 'conversations.json.journal.jsonl')
  const operations = {}
  if (existsSync(journal)) {
    for (const ligne of readFileSync(journal, 'utf8').split('\n')) {
      if (!ligne.trim()) continue
      const op = JSON.parse(ligne)
      operations[op.op] = (operations[op.op] ?? 0) + 1
      if (op.op === 'upsert' && op.conversation?.id) ids.add(op.conversation.id)
      if (op.op === 'delete' && op.id) ids.delete(op.id)
    }
  }
  const archives = idsArchives(fichier)
  for (const id of archives) ids.add(id)
  return { ids, instantane: liste.length, operations, archives: archives.length }
}

/**
 * Les sessions de `runs/` à garder : celles qui portent un run bloqué, et celles des travaux non
 * publiés (leur `run-state` nomme la conversation). `entrees` : sortie de `scanRuns`, sans borne.
 */
export function sessionsAGarder(entrees, { isBlocked, travaux = [], autowinOs }) {
  const bloquees = new Set()
  const deTravaux = new Set()
  let bloques = 0
  for (const entree of entrees) {
    if (isBlocked(entree.summary)) {
      bloques += 1
      bloquees.add(entree.session)
    }
    if (travaux.some((id) => String(entree.path).includes(id))) deTravaux.add(entree.session)
  }
  for (const id of travaux) {
    const etat = join(autowinOs, 'run-state', `${id}.json`)
    if (!existsSync(etat)) continue
    const conversation = lireJson(etat)?.conversationId
    if (conversation) deTravaux.add(String(conversation))
  }
  return { bloquees, deTravaux, bloques, total: entrees.length }
}

/**
 * Le jugement, catégorie par catégorie. `ctx` : `donnees`, `maintenant`, `vivants` (Set ou `null` si
 * la sonde a échoué), `runs` (sortie de `sessionsAGarder`, ou `null`), `travaux`. Lecture seule.
 */
export function jugerDonnees(ctx) {
  const ao = join(ctx.donnees, 'autowin-os')
  const bilan = { candidats: [], aVerifier: [], compteurs: {}, sondesEnEchec: [] }
  const compter = (categorie, verdict) => {
    const c = (bilan.compteurs[categorie] ??= {})
    c[verdict] = (c[verdict] ?? 0) + 1
  }
  const lister = (dossier, categorie) => {
    try {
      return readdirSync(dossier)
    } catch (erreur) {
      // Absent : rien à juger. Illisible : la catégorie n'est pas jugée ce jour-là.
      if (erreur?.code === 'ENOENT') return []
      bilan.sondesEnEchec.push({
        categorie,
        motif: `${dossier} illisible (${erreur?.code ?? erreur})`
      })
      return null
    }
  }
  /** Pèse puis tranche : `vivant` (trop récent), `garde` (copie git, pesée partielle) ou `candidat`. */
  const juger = (chemin, categorie, joursCalme, preuve) => {
    const pesee = peser(chemin)
    const ageJours = Math.floor((ctx.maintenant - pesee.plusRecentMs) / JOUR_MS)
    let verdict = 'candidat'
    if (ageJours < joursCalme) verdict = 'vivant'
    else if (pesee.contientGit || !pesee.complete) {
      verdict = 'garde'
      bilan.aVerifier.push({
        chemin,
        categorie,
        taille: pesee.taille,
        motif: pesee.contientGit
          ? 'contient une copie git : son tri relève de /git'
          : 'pesée incomplète'
      })
    } else {
      bilan.candidats.push({
        chemin,
        zone: `donnees-autowin:${categorie}`,
        taille: pesee.taille,
        ageJours,
        motif: `${preuve} ; rien de modifié depuis ${ageJours} j (seuil ${joursCalme} j)`
      })
    }
    compter(categorie, verdict)
  }

  // Satellites : seulement si la liste vivante est sûre.
  if (!ctx.vivants)
    bilan.sondesEnEchec.push({ categorie: 'satellites', motif: 'liste vivante illisible' })
  else {
    for (const dossier of [...SATELLITES, 'prompt-observability']) {
      const noms = lister(join(ao, dossier), dossier)
      for (const nom of noms ?? []) {
        if (dossier === 'prompt-observability' && nom === 'systems') continue
        const id = idDuSatellite(nom)
        if (!id) {
          compter(dossier, 'ambigu')
          continue
        }
        if (ctx.vivants.has(id)) {
          compter(dossier, 'fil vivant')
          continue
        }
        const jours = dossier === 'prompt-observability' ? 14 : 1
        juger(
          join(ao, dossier, nom),
          dossier,
          jours,
          `satellite orphelin : ${id} n'est ni vivant ni archivé`
        )
      }
    }
  }

  // Runs et leurs états : seulement si le scan complet des runs a répondu.
  const etats = lister(join(ao, 'run-state'), 'run-state')
  if (!ctx.runs)
    bilan.sondesEnEchec.push({ categorie: 'runs', motif: 'scan complet des runs en échec' })
  else {
    const { bloquees, deTravaux } = ctx.runs
    for (const session of lister(join(ao, 'runs'), 'runs') ?? []) {
      const chemin = join(ao, 'runs', session)
      if (!lstatSync(chemin).isDirectory()) continue
      if (bloquees.has(session) || deTravaux.has(session)) compter('runs', 'run bloqué ou travail')
      else juger(chemin, 'runs', 30, 'sortie de run sans run bloqué, hors travaux non publiés')
    }
    for (const nom of (etats ?? []).filter((n) => n.endsWith('.json'))) {
      const chemin = join(ao, 'run-state', nom)
      let conversation = ''
      try {
        conversation = String(lireJson(chemin)?.conversationId ?? '')
      } catch {
        // illisible : pas de preuve, il reste
      }
      if (!conversation) compter('run-state', 'sans conversation lisible')
      else if (
        bloquees.has(conversation) ||
        deTravaux.has(conversation) ||
        (ctx.travaux ?? []).includes(nom.slice(0, -'.json'.length))
      )
        compter('run-state', 'run bloqué ou travail')
      else juger(chemin, 'run-state', 30, `état de run, ${conversation} sans run bloqué`)
    }
  }

  // run-stdout : la citation se lit dans TOUS les run-state ; l'un d'eux illisible et rien n'est jugé.
  if (etats) {
    let cites = null
    try {
      cites = etats
        .filter((n) => n.endsWith('.json'))
        .map((n) => readFileSync(join(ao, 'run-state', n), 'utf8'))
        .join('\n')
    } catch (erreur) {
      bilan.sondesEnEchec.push({
        categorie: 'run-stdout',
        motif: `run-state illisible (${erreur?.code ?? erreur})`
      })
    }
    for (const nom of cites === null ? [] : (lister(join(ao, 'run-stdout'), 'run-stdout') ?? [])) {
      const chemin = join(ao, 'run-stdout', nom)
      if (!lstatSync(chemin).isFile()) continue
      const uuid = nom.slice(0, 36)
      if (!UUID.test(uuid)) compter('run-stdout', 'ambigu')
      else if (cites.includes(uuid)) compter('run-stdout', 'cité par un run-state')
      else juger(chemin, 'run-stdout', 14, `sortie de run, ${uuid} cité par aucun run-state`)
    }
  }

  // Sauvegardes et bancs d'autowin-os/.
  for (const nom of lister(ao, 'autowin-os') ?? []) {
    const chemin = join(ao, nom)
    const infos = lstatSync(chemin)
    if (infos.isFile() && SAUVEGARDE.test(nom)) {
      if (nom.startsWith('conversations.json')) {
        compter('sauvegarde', 'conversations.json')
        if (
          Math.floor((ctx.maintenant - infos.mtimeMs) / JOUR_MS) >= 14 &&
          !nom.endsWith('.pre-remake')
        )
          bilan.aVerifier.push({
            chemin,
            categorie: 'sauvegarde',
            taille: infos.size,
            motif:
              'sauvegarde de conversations.json : à ranger dans sauvegardes/, jamais en corbeille du jour'
          })
      } else juger(chemin, 'sauvegarde', 14, 'sauvegarde ponctuelle')
    } else if (infos.isDirectory() && BANC.test(nom)) juger(chemin, 'banc', 14, "banc d'essai")
  }

  // Racine des données.
  for (const nom of lister(ctx.donnees, 'racine') ?? []) {
    const chemin = join(ctx.donnees, nom)
    const infos = lstatSync(chemin)
    const vise =
      (nom === 'tmp' && infos.isDirectory()) ||
      (infos.isFile() &&
        (/^tmp-.*\.png$/u.test(nom) ||
          /^vitest-.*\.txt$/u.test(nom) ||
          (nom.endsWith('.log') && infos.size > LOG_LOURD_OCTETS)))
    if (vise) juger(chemin, 'racine', 7, 'reste à la racine des données')
  }

  bilan.taille = bilan.candidats.reduce((somme, c) => somme + c.taille, 0)
  return bilan
}

const liste = (texte) =>
  String(texte ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

async function main() {
  let options
  try {
    options = parseArgs({
      options: {
        balayer: { type: 'boolean', default: false },
        donnees: { type: 'string' },
        travaux: { type: 'string' },
        controle: { type: 'string' }
      }
    }).values
  } catch (erreur) {
    console.error(`commande refusée : ${erreur.message}`)
    process.exit(2)
  }
  const donnees = resolve(
    options.donnees ?? depotEtDonnees(dirname(fileURLToPath(import.meta.url))).donnees
  )
  const ao = join(donnees, 'autowin-os')
  const travaux = liste(options.travaux)
  const sortie = { donnees, mode: options.balayer ? 'balayage' : 'lecture seule', travaux }

  let vivants = null
  try {
    const fils = filsVivants(ao)
    vivants = fils.ids
    const absents = liste(options.controle).filter((id) => !vivants.has(id))
    sortie.vivants = {
      total: vivants.size,
      instantane: fils.instantane,
      operations: fils.operations,
      archives: fils.archives
    }
    if (absents.length > 0) {
      console.log(
        JSON.stringify(
          {
            ...sortie,
            refus: `contrôle raté, absents de la liste vivante : ${absents.join(', ')}`
          },
          null,
          1
        )
      )
      process.exit(2)
    }
  } catch (erreur) {
    sortie.vivants = { erreur: String(erreur?.message ?? erreur) }
  }

  let runs = null
  try {
    const { scanRuns } = await import(
      pathToFileURL(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '..',
          'src',
          'main',
          'dashboards',
          'runs-scan.ts'
        )
      ).href
    )
    const { isBlocked } = await import(
      pathToFileURL(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'shared', 'run-blocked.ts')
      ).href
    )
    runs = sessionsAGarder(await scanRuns(join(ao, 'runs')), { isBlocked, travaux, autowinOs: ao })
    sortie.runs = {
      total: runs.total,
      bloques: runs.bloques,
      sessionsBloquees: runs.bloquees.size,
      sessionsDeTravaux: [...runs.deTravaux]
    }
  } catch (erreur) {
    sortie.runs = { erreur: String(erreur?.message ?? erreur) }
  }

  const maintenant = Date.now()
  const bilan = jugerDonnees({ donnees, maintenant, vivants, runs, travaux })
  Object.assign(sortie, bilan)
  if (options.balayer) {
    sortie.balayage = balayer(bilan.candidats, {
      donnees,
      localAppData: process.env.LOCALAPPDATA,
      maintenant
    })
  }
  console.log(JSON.stringify(sortie, null, 1))
  const echec = bilan.sondesEnEchec.length > 0 || (sortie.balayage?.echecs.length ?? 0) > 0
  process.exit(echec ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
