#!/usr/bin/env node
/**
 * BANC — la mémoire que prend le store des conversations du moteur principal.
 *
 * Pourquoi un banc : la mémoire de l'app ouverte bouge d'une minute à l'autre (agents, vues,
 * aperçus) ; on n'y lit pas l'effet d'un seul changement du store. Ici un processus node NEUF et
 * jetable charge le VRAI code (`persistConversations` de `src/main/store/conversations-disk.ts`,
 * compilé à la volée avec esbuild) sur une COPIE des vraies données, attend la fin de la relecture
 * des archives (`archivesChargees`), force le ramasse-miettes (`--expose-gc`) et relève `heapUsed`
 * et `rss` avant puis après chargement.
 *
 * Les originaux ne sont jamais touchés : la copie vit dans un dossier temporaire, effacé à la fin.
 * Le banc ne dépend que de `persistConversations`, `archivesChargees` et `listSummaries` : il
 * resert tel quel après la bascule des archives vers le disque.
 *
 * `--recherche` ajoute ce que coûte la RECHERCHE sur le même store : pour chaque terme de
 * `TERMES_BANC`, la durée et la plus longue pause du fil principal (un minuteur de 1 ms mesure son
 * propre retard) de la recherche littérale de la liste et de la recherche classée, la mémoire prise
 * une fois les index construits, et une EMPREINTE des résultats. Deux versions du code qui rendent
 * les mêmes fils ont la même empreinte : c'est ce qui prouve un allègement sans changement de
 * résultat. La première recherche classée, qui construit les index, est relevée à part.
 *
 * Usage : node scripts/banc-memoire-conversations.mjs [--source <dossier autowin-os>] [--recherche] [--json]
 * Code de sortie : 0 mesure faite, 1 mesure impossible (données ou compilation introuvables).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const MO = 1024 * 1024

/**
 * Termes FIGÉS : changer la liste change l'empreinte, et deux mesures ne se comparent plus.
 * Un mot absent, des accents et capitales, un terme très fréquent, un identifiant avec tiret bas.
 */
export const TERMES_BANC = [
  'zorglub',
  'mémoire',
  'Électron',
  'archive',
  'conv',
  'plan_de_lots',
  'bascule'
]

/** Octets → Mo, une décimale. */
export function enMo(octets) {
  return Math.round((octets / MO) * 10) / 10
}

/** Les fichiers d'archive d'un dossier : `<id>.json`, sans les pierres tombales `.supprime`. */
export function compterArchives(dossier) {
  if (!existsSync(dossier)) return 0
  return readdirSync(dossier).filter((nom) => nom.endsWith('.json')).length
}

/** Résume deux relevés (octets) en Mo, avec ce que le chargement a coûté. */
export function resumerReleves(avant, apres, fils) {
  const mo = (r) => ({ heapUsedMo: enMo(r.heapUsed), rssMo: enMo(r.rss) })
  return {
    avant: mo(avant),
    apres: mo(apres),
    deltaHeapMo: enMo(apres.heapUsed - avant.heapUsed),
    deltaRssMo: enMo(apres.rss - avant.rss),
    filsActifs: fils.actifs,
    filsArchives: fils.archives
  }
}

/**
 * Empreinte courte des résultats, terme par terme. `trier` : la recherche littérale FILTRE (l'ordre
 * des fils n'a pas de sens, seule compte leur présence) ; la recherche classée CLASSE (l'ordre fait
 * partie du résultat).
 */
export function empreinteResultats(idsParTerme, { trier }) {
  const normalise = idsParTerme.map((ids) => (trier ? [...ids].sort() : ids))
  return createHash('sha1').update(JSON.stringify(normalise)).digest('hex').slice(0, 12)
}

/** Résume les relevés bruts d'une recherche (une ligne par terme) : pires valeurs et empreinte. */
export function resumerRecherche(lignes, { trier }) {
  const arrondi = (n) => Math.round(n)
  return {
    pauseMaxMs: arrondi(Math.max(0, ...lignes.map((l) => l.pauseMs))),
    totalMaxMs: arrondi(Math.max(0, ...lignes.map((l) => l.totalMs))),
    trouves: lignes.map((l) => l.ids.length),
    empreinte: empreinteResultats(
      lignes.map((l) => l.ids),
      { trier }
    )
  }
}

/** Texte lisible d'un résultat. */
export function formater(r) {
  const signe = (n) => (n >= 0 ? `+${n}` : `${n}`)
  const lignes = [
    `Fils actifs : ${r.filsActifs} · fils archivés (fichiers) : ${r.filsArchives}`,
    `Avant chargement : heapUsed ${r.avant.heapUsedMo} Mo · rss ${r.avant.rssMo} Mo`,
    `Après chargement : heapUsed ${r.apres.heapUsedMo} Mo · rss ${r.apres.rssMo} Mo`,
    `Coût du store    : heapUsed ${signe(r.deltaHeapMo)} Mo · rss ${signe(r.deltaRssMo)} Mo`
  ]
  if (r.recherche) {
    const { litterale, classee, premiereClassee, coutIndexHeapMo, coutIndexRssMo } = r.recherche
    lignes.push(
      `Recherche de la liste : pause max ${litterale.pauseMaxMs} ms · durée max ${litterale.totalMaxMs} ms · empreinte ${litterale.empreinte}`,
      `Recherche classée     : pause max ${classee.pauseMaxMs} ms · durée max ${classee.totalMaxMs} ms · empreinte ${classee.empreinte}`,
      `Première classée (construit les index) : pause max ${Math.round(premiereClassee.pauseMs)} ms · durée ${Math.round(premiereClassee.totalMs)} ms`,
      `Coût des index de recherche : heapUsed ${signe(coutIndexHeapMo)} Mo · rss ${signe(coutIndexRssMo)} Mo`,
      `Trouvés (${TERMES_BANC.join(', ')}) : liste ${litterale.trouves.join('/')} · classée ${classee.trouves.join('/')}`
    )
  }
  return lignes.join('\n')
}

/**
 * Dossier de données à mesurer : `--source`, sinon `.autowin-data/autowin-os` de ce dépôt, sinon
 * celui du dépôt principal (une copie de travail git n'a pas ses propres données).
 */
export function trouverSource(argv, base = racine) {
  const i = argv.indexOf('--source')
  if (i >= 0 && argv[i + 1]) return resolve(argv[i + 1])
  const local = join(base, '.autowin-data', 'autowin-os')
  if (existsSync(join(local, 'conversations.json'))) return local
  const git = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: base, encoding: 'utf8' })
  if (git.status === 0) {
    const commun = resolve(base, git.stdout.trim())
    const principal = join(dirname(commun), '.autowin-data', 'autowin-os')
    if (existsSync(join(principal, 'conversations.json'))) return principal
  }
  return local
}

/** Copie snapshot, journal éventuel et archives dans un dossier neuf. Rend le chemin du snapshot copié. */
export function copierDonnees(source, destination) {
  const cible = join(destination, 'conversations.json')
  cpSync(join(source, 'conversations.json'), cible)
  const journal = join(source, 'conversations.json.journal.jsonl')
  if (existsSync(journal)) cpSync(journal, `${cible}.journal.jsonl`)
  const archives = join(source, 'conversations.json.archive')
  if (existsSync(archives)) cpSync(archives, `${cible}.archive`, { recursive: true })
  return cible
}

/**
 * Durée d'un travail et plus longue pause du fil principal pendant ce temps. Un minuteur de 1 ms
 * relève son propre retard : un travail mené par tranches le laisse passer entre deux tranches, un
 * travail synchrone le retarde de toute sa durée (la pause vaut alors la durée).
 */
async function chronometrer(travail) {
  let pire = 0
  let dernier = performance.now()
  let actif = true
  const sonde = () => {
    const t = performance.now()
    pire = Math.max(pire, t - dernier - 1)
    dernier = t
    if (actif) setTimeout(sonde, 1)
  }
  setTimeout(sonde, 1)
  const debut = performance.now()
  const resultat = await travail()
  const totalMs = performance.now() - debut
  await new Promise((r) => setTimeout(r, 5))
  actif = false
  return { resultat, totalMs, pauseMs: pire }
}

/**
 * Les deux recherches sur un store chargé. Les variantes asynchrones sont celles de l'app (frappe de
 * la liste, outil de recherche) ; une version plus ancienne du code qui ne les a pas est mesurée par
 * ses variantes synchrones, pour qu'un « avant » reste mesurable.
 */
async function mesurerRecherches(store, relever) {
  const litterale = (t) =>
    typeof store.rechercherParContenuAsync === 'function'
      ? store.rechercherParContenuAsync(t)
      : store.rechercherParContenu(t)
  const classee = (t) =>
    typeof store.searchAsync === 'function' ? store.searchAsync(t) : store.search(t)
  const avant = relever()
  const premiere = await chronometrer(() => classee(TERMES_BANC[1]))
  const lignes = { litterale: [], classee: [] }
  for (const [nom, chercher] of [
    ['litterale', litterale],
    ['classee', classee]
  ]) {
    for (const terme of TERMES_BANC) {
      await chronometrer(() => chercher(terme)) // à froid, écarté : on mesure la frappe suivante
      const { resultat, totalMs, pauseMs } = await chronometrer(() => chercher(terme))
      lignes[nom].push({ terme, totalMs, pauseMs, ids: resultat.map((r) => r.id) })
    }
  }
  const apres = relever()
  return {
    premiere: { totalMs: premiere.totalMs, pauseMs: premiere.pauseMs },
    lignes,
    coutIndex: { heapUsed: apres.heapUsed - avant.heapUsed, rss: apres.rss - avant.rss }
  }
}

/** Travail du processus enfant (lancé avec --expose-gc) : compile, charge, relève, imprime du JSON. */
async function travailler(cheminCopie, dossierTravail, avecRecherche) {
  const esbuild = require('esbuild')
  const sortie = join(dossierTravail, 'store.mjs')
  // Entrée synthétique : la classe du store et le branchement disque, compilés ensemble.
  await esbuild.build({
    stdin: {
      contents: `export { ConversationStore } from './src/main/store/conversations'
export { persistConversations } from './src/main/store/conversations-disk'`,
      resolveDir: racine,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: sortie,
    external: ['electron'],
    logLevel: 'silent'
  })
  const { ConversationStore, persistConversations } = await import(pathToFileURL(sortie).href)
  const relever = () => {
    global.gc()
    global.gc()
    const { heapUsed, rss } = process.memoryUsage()
    return { heapUsed, rss }
  }
  const avant = relever()
  const store = new ConversationStore()
  const persistance = persistConversations(store, cheminCopie)
  const actifs = store.listSummaries().length
  await persistance.archivesChargees
  const apres = relever()
  const recherche = avecRecherche ? await mesurerRecherches(store, relever) : undefined
  // Le store reste référencé jusqu'ici : sans cette lecture, le ramasse-miettes l'emporterait.
  const total = store.listSummaries().length
  process.stdout.write(
    JSON.stringify({
      avant,
      apres,
      actifs,
      total,
      archives: compterArchives(`${cheminCopie}.archive`),
      recherche
    })
  )
  process.exit(0)
}

async function principal(argv) {
  const source = trouverSource(argv)
  if (!existsSync(join(source, 'conversations.json'))) {
    console.error(`Données introuvables : ${join(source, 'conversations.json')} (option --source).`)
    return 1
  }
  const avecRecherche = argv.includes('--recherche')
  const dossier = mkdtempSync(join(tmpdir(), 'banc-memoire-conversations-'))
  try {
    const cheminCopie = copierDonnees(source, dossier)
    const enfant = spawnSync(
      process.execPath,
      [
        '--expose-gc',
        fileURLToPath(import.meta.url),
        '--travailleur',
        cheminCopie,
        dossier,
        ...(avecRecherche ? ['--recherche'] : [])
      ],
      { cwd: racine, encoding: 'utf8', maxBuffer: 64 * MO }
    )
    if (enfant.status !== 0) {
      console.error(`Mesure impossible (code ${enfant.status}).\n${enfant.stderr || enfant.stdout}`)
      return 1
    }
    const brut = JSON.parse(enfant.stdout.trim().split('\n').pop())
    const resultat = resumerReleves(brut.avant, brut.apres, {
      actifs: brut.actifs,
      archives: brut.archives
    })
    if (brut.recherche) {
      resultat.recherche = {
        litterale: resumerRecherche(brut.recherche.lignes.litterale, { trier: true }),
        classee: resumerRecherche(brut.recherche.lignes.classee, { trier: false }),
        premiereClassee: brut.recherche.premiere,
        coutIndexHeapMo: enMo(brut.recherche.coutIndex.heapUsed),
        coutIndexRssMo: enMo(brut.recherche.coutIndex.rss)
      }
    }
    console.log(argv.includes('--json') ? JSON.stringify(resultat, null, 2) : formater(resultat))
    return 0
  } finally {
    rmSync(dossier, { recursive: true, force: true })
  }
}

const argv = process.argv.slice(2)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (argv[0] === '--travailleur') {
    travailler(argv[1], argv[2], argv.includes('--recherche')).catch((e) => {
      console.error(e?.stack ?? e)
      process.exit(1)
    })
  } else {
    principal(argv).then((code) => process.exit(code))
  }
}
