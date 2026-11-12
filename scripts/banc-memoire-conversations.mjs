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
 * Usage : node scripts/banc-memoire-conversations.mjs [--source <dossier autowin-os>] [--json]
 * Code de sortie : 0 mesure faite, 1 mesure impossible (données ou compilation introuvables).
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const MO = 1024 * 1024

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

/** Texte lisible d'un résultat. */
export function formater(r) {
  const signe = (n) => (n >= 0 ? `+${n}` : `${n}`)
  return [
    `Fils actifs : ${r.filsActifs} · fils archivés (fichiers) : ${r.filsArchives}`,
    `Avant chargement : heapUsed ${r.avant.heapUsedMo} Mo · rss ${r.avant.rssMo} Mo`,
    `Après chargement : heapUsed ${r.apres.heapUsedMo} Mo · rss ${r.apres.rssMo} Mo`,
    `Coût du store    : heapUsed ${signe(r.deltaHeapMo)} Mo · rss ${signe(r.deltaRssMo)} Mo`
  ].join('\n')
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

/** Travail du processus enfant (lancé avec --expose-gc) : compile, charge, relève, imprime du JSON. */
async function travailler(cheminCopie, dossierTravail) {
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
  // Le store reste référencé jusqu'ici : sans cette lecture, le ramasse-miettes l'emporterait.
  const total = store.listSummaries().length
  process.stdout.write(
    JSON.stringify({
      avant,
      apres,
      actifs,
      total,
      archives: compterArchives(`${cheminCopie}.archive`)
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
  const dossier = mkdtempSync(join(tmpdir(), 'banc-memoire-conversations-'))
  try {
    const cheminCopie = copierDonnees(source, dossier)
    const enfant = spawnSync(
      process.execPath,
      ['--expose-gc', fileURLToPath(import.meta.url), '--travailleur', cheminCopie, dossier],
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
    console.log(argv.includes('--json') ? JSON.stringify(resultat, null, 2) : formater(resultat))
    return 0
  } finally {
    rmSync(dossier, { recursive: true, force: true })
  }
}

const argv = process.argv.slice(2)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (argv[0] === '--travailleur') {
    travailler(argv[1], argv[2]).catch((e) => {
      console.error(e?.stack ?? e)
      process.exit(1)
    })
  } else {
    principal(argv).then((code) => process.exit(code))
  }
}
