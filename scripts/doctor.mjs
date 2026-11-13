#!/usr/bin/env node
/**
 * DOCTOR — le bilan d'installation et de réglage d'Autowin OS, en LECTURE SEULE.
 *
 * Demande du 2026-10-31 : un `/doctor` « comme claude.exe ». Claude Code sépare deux
 * gestes et on garde cette séparation : `claude doctor` mesure sans rien changer (ce script),
 * `/doctor` rend ses constats puis ne répare qu'après accord (skills/doctor/SKILL.md).
 *
 * Les cinq premières zones sont celles de la documentation de Claude Code, transposées :
 * https://code.claude.com/docs/en/skills#check-your-setup-with-/doctor
 * La sixième, `services`, est propre à Autowin : Brain, gels, plantages, démarrage.
 *
 * Une sonde qui casse rend « inconnu » : un axe ne disparaît jamais du bilan en silence.
 *
 * Usage : node scripts/doctor.mjs [--json] [--zone <zone>] [--data <dossier de données>]
 * Sortie 0 = aucun constat « ko » ; 1 = au moins un ; 3 = trop de sondes muettes pour conclure.
 */
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statfsSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { racineDepot } from './racine-depot.mjs'

export const ZONES = [
  'installation',
  'extensions',
  'instructions',
  'permissions',
  'usage',
  'services'
]

const JOUR_MS = 86_400_000
const GO = 1024 ** 3

/* Chaque seuil dit à partir de quand un humain voudrait le savoir ; aucun n'est une loi. */
const SEUILS = {
  disqueKoGo: 5,
  disqueAttentionGo: 20,
  fetchVieuxJours: 7,
  attenteMedianeMs: 3_000,
  // Le temps que le planificateur rattrape ses échéances après un démarrage.
  planificateurGraceMs: 10 * 60_000,
  echecsParTache: 3,
  chargeAgents: 0.8,
  chargeProfil: 0.9,
  promptSystemeOctets: 120_000,
  refusRecurrent: 5,
  hausseCout: 2,
  quotaAttention: 80,
  // Au-delà, un relevé ne décrit plus le présent : il informe, il n'alerte pas.
  quotaReleveFraisJours: 1,
  quotaReleveVieuxJours: 3,
  gelPireMs: 10_000,
  demarrageMs: 15_000,
  // Même marge que `kit-cliquets.test.ts` : le plafond dur du modèle est 1024.
  descriptionMax: 950,
  // Plafond de `profil_ajouter` (src/main/profil/profil-utilisateur.test.ts).
  profilOctets: 2_000
}

const lireJson = (chemin) => JSON.parse(readFileSync(chemin, 'utf8'))

/*
 * Un constat recopie parfois un texte brut : refus d'outil, erreur non rattrapée, ligne de
 * `claude doctor`. Une adresse ou un jeton y entrerait, et le bilan finit dans le fil, donc dans le
 * contexte des agents. Le masque est posé à la sortie de TOUTE sonde (`diagnostiquer`) : une sonde
 * ajoutée demain en profite sans y penser.
 */
const MASQUES = [
  [/\b(bearer|basic)\s+[\w.~+/=-]{8,}/giu, '$1 ***'],
  [
    /(?<![\w-])([\w-]*(?:api[_-]?key|token|secret|access[_-]?key|password|passwd|pwd|sig|signature))(["'\\]*\s*[=:]\s*["'\\]*)[^\s"'\\&,;}]+/giu,
    '$1$2***'
  ],
  [/\b(\w+:\/\/)[^\s/@]+@/gu, '$1***@'],
  [/\b(https?:\/\/[^\s?#"']+)[?#][^\s"']*/giu, '$1?***'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/gu, '***@***']
]
/** Une longue suite opaque mêlant lettres et chiffres : un mot composé du dépôt n'en a pas. */
const CHAINE_OPAQUE = /[A-Za-z0-9_-]{24,}/gu

export function masquer(texte) {
  if (typeof texte !== 'string') return texte
  const sans = MASQUES.reduce((t, [motif, remplacement]) => t.replace(motif, remplacement), texte)
  return sans.replace(CHAINE_OPAQUE, (c) => (/[0-9]/u.test(c) && /[A-Za-z]/u.test(c) ? '***' : c))
}

/** Lignes JSON d'un journal vivant : sa dernière ligne peut être en cours d'écriture. */
export function lignesJson(texte) {
  const lignes = []
  for (const ligne of texte.split('\n')) {
    if (!ligne.trim()) continue
    try {
      lignes.push(JSON.parse(ligne))
    } catch {
      /* ligne tronquée d'un journal en cours d'écriture : elle n'apporte rien au bilan */
    }
  }
  return lignes
}

export function quantile(valeurs, q) {
  if (valeurs.length === 0) return 0
  const tries = [...valeurs].sort((a, b) => a - b)
  return tries[Math.min(tries.length - 1, Math.floor(q * tries.length))]
}

const dossierDe = (chemin) =>
  chemin
    .trim()
    .replace(/[\\/][^\\/]*$/u, '')
    .toLowerCase()

/** Dossiers distincts d'où `where claude` sert un exécutable (`claude`, `.cmd`, `.ps1` = un seul). */
export function installationsDistinctes(sortieWhere) {
  return [
    ...new Set(
      sortieWhere
        .split('\n')
        .filter((l) => l.trim())
        .map(dossierDe)
    )
  ]
}

/** Écarts entre `package.json` et la racine de `package-lock.json`. */
export function ecartsAvecLeLock(pkg, lock) {
  const racine = lock.packages?.[''] ?? {}
  const ecarts = []
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [nom, version] of Object.entries(pkg[section] ?? {})) {
      if (racine[section]?.[nom] !== version) ecarts.push(nom)
    }
  }
  return ecarts
}

/** Chemins du dépôt cités dans un texte. Un gabarit (`<nom>`, `*`) n'est pas une adresse. */
export function cheminsCites(texte) {
  const motif =
    /(?<![\w./\\-])(?:src|scripts|skills|bench)\/[\w./-]+\.(?:ts|tsx|mjs|mts|js|ps1|py|md|json)\b/gu
  // Une ligne qui raconte une disparition cite ce chemin EXPRÈS (skills/arena).
  const vivantes = texte
    .split('\n')
    .filter((l) => !/absent|n.existe|disparu|retiré|supprimé/iu.test(l))
  return [...new Set(vivantes.join('\n').match(motif) ?? [])]
}

/** Valeur de `description:` d'un SKILL.md, scalaire replié compris. */
export function descriptionDeSkill(md) {
  const lignes = md.replace(/\r/gu, '').split('\n')
  const i = lignes.findIndex((l) => /^description:/u.test(l))
  if (i < 0) return ''
  const suite = []
  for (const ligne of lignes.slice(i + 1)) {
    if (!/^\s+\S/u.test(ligne)) break
    suite.push(ligne.trim())
  }
  return [lignes[i].replace(/^description:\s*(?:[|>][-+]?)?\s*/u, ''), ...suite].join(' ').trim()
}

/**
 * Vrais refus des fils les plus récents, classés par fils touchés. Les entrées anciennes du journal
 * ne sont pas datées, mais ses clés sont des `conv-N` : le rang tient lieu de date. Il mêle aussi tous les échecs d'outils
 * (test rouge, fichier absent), qui ne disent rien des permissions : seuls les refus comptent.
 */
export function refusRecents(murs, nombreDeFils = 100) {
  const rang = (id) => Number(/(\d+)$/u.exec(id)?.[1] ?? 0)
  const fils = Object.keys(murs)
    .sort((a, b) => rang(b) - rang(a))
    .slice(0, nombreDeFils)
  const comptes = new Map()
  for (const id of fils) {
    // Une entrée est une signature seule (ancien format) ou `{ signature, derniereFois }`.
    const signatures = murs[id].map((m) => (typeof m === 'string' ? m : m?.signature))
    for (const signature of new Set(signatures)) {
      if (typeof signature !== 'string') continue
      if (!/refus|interdit|bloqu|non autoris|denied|permission/iu.test(signature)) continue
      comptes.set(signature, (comptes.get(signature) ?? 0) + 1)
    }
  }
  return { fils: fils.length, classement: [...comptes].sort((a, b) => b[1] - a[1]) }
}

/**
 * Le planificateur est-il en panne ? Seule une échéance passée ALORS QUE L'APP TOURNAIT l'accuse.
 * Après un démarrage, il rattrape ses échéances et avance `nextRunAt` : une échéance restée derrière
 * le dernier démarrage n'a donc pas été prise en charge. L'ancienne règle (« rien de fini depuis
 * 3 jours ») criait à la panne au retour d'un week-end prolongé, ou pour une tâche toute neuve.
 */
export function tachesOubliees(activees, dernierDemarrage, maintenant) {
  if (!dernierDemarrage || maintenant - dernierDemarrage < SEUILS.planificateurGraceMs) return []
  return activees.filter(
    (tache) => typeof tache.nextRunAt === 'number' && tache.nextRunAt < dernierDemarrage
  )
}

/** Coût enregistré sur deux semaines glissantes, et les postes de la dernière. */
export function bilanCout(lignes, maintenant) {
  const semaine = maintenant - 7 * JOUR_MS
  const precedente = semaine - 7 * JOUR_MS
  const postes = new Map()
  let total = 0
  let avant = 0
  for (const ligne of lignes) {
    const ts = Date.parse(ligne.ts)
    const cout = ligne.costUsd ?? 0
    if (ts >= semaine) {
      total += cout
      const poste = `${ligne.role ?? '?'} sur ${ligne.model ?? '?'}`
      postes.set(poste, (postes.get(poste) ?? 0) + cout)
    } else if (ts >= precedente) {
      avant += cout
    }
  }
  return { total, avant, postes: [...postes].sort((a, b) => b[1] - a[1]) }
}

/** Plantages datés de `crash.log` depuis `depuis`, regroupés par message. */
export function plantagesRecents(journal, depuis) {
  const comptes = new Map()
  for (const m of journal.matchAll(/^\[([^\]]+)\] (\w+): (.*)$/gmu)) {
    if (!(Date.parse(m[1]) >= depuis)) continue
    const quoi = `${m[2]} : ${m[3].slice(0, 70)}`
    comptes.set(quoi, (comptes.get(quoi) ?? 0) + 1)
  }
  return [...comptes].sort((a, b) => b[1] - a[1])
}

/** Première ligne `init` d'une sortie du modèle : elle seule nomme les serveurs d'outils du tour. */
export function initDeTour(texte) {
  for (const ligne of texte.split('\n')) {
    if (!ligne.includes('"subtype":"init"')) continue
    try {
      return JSON.parse(ligne)
    } catch {
      return null
    }
  }
  return null
}

function debutDeFichier(chemin, octets = 262_144) {
  const fd = openSync(chemin, 'r')
  try {
    const tampon = Buffer.alloc(octets)
    return tampon.toString('utf8', 0, readSync(fd, tampon, 0, octets, 0))
  } finally {
    closeSync(fd)
  }
}

function plusRecents(dossier, nombre) {
  return readdirSync(dossier)
    .map((nom) => ({ nom, stat: statSync(join(dossier, nom), { throwIfNoEntry: false }) }))
    .filter((f) => f.stat?.isFile())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, nombre)
    .map((f) => ({ chemin: join(dossier, f.nom), octets: f.stat.size, mtimeMs: f.stat.mtimeMs }))
}

function dossiersDeSkills(racine) {
  if (!existsSync(racine)) return []
  return readdirSync(racine).filter((nom) => existsSync(join(racine, nom, 'SKILL.md')))
}

/* ── installation ─────────────────────────────────────────────────────────────────────────── */

/*
 * LA PREMIÈRE QUESTION DU BILAN. Sans dossier de données, presque toutes les sondes rendent
 * « inconnu » et aucune ne rend « ko » : le script sortait en 0, comme un poste sain. C'est le cas
 * de toute copie de travail, où `.autowin-data` n'existe pas (juge du 2026-10-31).
 */
function sondeDonnees({ data }) {
  const journal = join(data, 'conversations.json.journal.jsonl')
  if (!existsSync(join(data, 'conversations.json')) && !existsSync(journal)) {
    return {
      statut: 'ko',
      titre: 'Dossier de données introuvable',
      detail: data,
      reparation: 'Lancer le bilan depuis le dépôt principal, ou le désigner avec `--data`.'
    }
  }
  if (!existsSync(journal)) return { statut: 'ok', titre: 'Dossier de données présent' }
  // La dernière ligne peut être en cours d'écriture : seules les précédentes doivent être entières.
  const lignes = readFileSync(journal, 'utf8').split('\n').filter(Boolean).slice(0, -1)
  const abimees = lignes.length - lignesJson(lignes.join('\n')).length
  return {
    statut: abimees ? 'attention' : 'ok',
    titre: abimees
      ? `Journal des conversations : ${abimees} ligne(s) illisible(s)`
      : 'Dossier de données présent, journal des conversations lisible',
    reparation: abimees
      ? 'Le démarrage écarte ces lignes : `/heal` pour trouver leur origine.'
      : undefined
  }
}

const OUTILS = [
  ['node', 'node --version'],
  ['git', 'git --version'],
  // Le lanceur de dev et ses tests passent par `py -3`.
  ['python', 'py -3 --version'],
  ['claude', 'claude --version']
]

function sondeOutils({ executer }) {
  const outils = OUTILS.map(([nom, commande]) => {
    const r = executer(commande, 20_000)
    return { nom, version: r.code === 0 ? r.sortie.trim().split('\n')[0] : null }
  })
  const absents = outils.filter((o) => !o.version).map((o) => o.nom)
  return {
    statut: absents.length ? 'ko' : 'ok',
    titre: absents.length ? `Outils absents : ${absents.join(', ')}` : 'Outils présents',
    detail: outils.map((o) => `${o.nom} ${o.version ?? 'absent'}`).join(' · '),
    reparation: absents.length ? 'Installer ces outils, ou corriger le PATH du poste.' : undefined
  }
}

function sondeInstallsClaude({ executer }) {
  const dossiers = installationsDistinctes(executer('where claude', 10_000).sortie)
  if (dossiers.length === 0) return { statut: 'ko', titre: 'CLI claude introuvable dans le PATH' }
  if (dossiers.length === 1) return { statut: 'ok', titre: 'Une seule installation du CLI claude' }
  return {
    statut: 'attention',
    titre: `${dossiers.length} installations du CLI claude`,
    detail: dossiers.join(' · '),
    reparation: 'Garder celle que le PATH sert en premier et retirer les autres.'
  }
}

function sondeClaudeDoctor({ executer }) {
  const r = executer('claude doctor', 40_000)
  if (r.code === 0 && /No installation issues found/iu.test(r.sortie)) {
    return { statut: 'ok', titre: '`claude doctor` : aucun problème' }
  }
  const lignes = r.sortie.split('\n').filter((l) => /warn|error|issue|fail/iu.test(l))
  return {
    statut: 'attention',
    titre: `\`claude doctor\` signale un problème (code ${r.code})`,
    detail: lignes.slice(0, 5).join(' · ').slice(0, 400),
    reparation: 'Lancer `claude doctor` et suivre ce qu’il indique.'
  }
}

function sondeVersion({ racine, executer, maintenant }) {
  const version = lireJson(join(racine, 'package.json')).version
  const r = executer('git rev-list --left-right --count HEAD...@{u}', 15_000)
  const [avance, retard] = r.sortie.trim().split(/\s+/u).map(Number)
  if (r.code !== 0 || !Number.isFinite(retard)) {
    return { statut: 'inconnu', titre: `Version ${version} : pas de branche distante à comparer` }
  }
  const fetchHead = join(racine, '.git', 'FETCH_HEAD')
  const age = existsSync(fetchHead)
    ? (maintenant - statSync(fetchHead).mtimeMs) / JOUR_MS
    : Infinity
  const vieux = age > SEUILS.fetchVieuxJours
  const detail = `${avance} commit(s) d'avance, ${retard} de retard, dernier contact ${
    Number.isFinite(age) ? `il y a ${age.toFixed(1)} j` : 'jamais'
  }`
  if (retard > 0) {
    return {
      statut: 'attention',
      titre: `Version ${version} : ${retard} commit(s) de retard`,
      detail,
      reparation: '`/maj` si la mise à jour bloque, sinon `/git`.'
    }
  }
  return {
    statut: vieux ? 'attention' : 'ok',
    titre: `Version ${version}${vieux ? ' : retard réel inconnu, contact trop ancien' : ' à jour'}`,
    detail
  }
}

function sondeDependances({ racine, executer }) {
  // MÊME règle que le lanceur (scripts/launch_dev_dependances.py) : une seule définition de
  // « node_modules est entier », ici relue plutôt que recopiée.
  const commande =
    "py -3 -c \"import json,sys;sys.path.insert(0,'scripts');" +
    'from pathlib import Path;from launch_dev_dependances import dependances_manquantes as d;' +
    "print(json.dumps(d(Path('.'))))\""
  const r = executer(commande, 30_000)
  if (r.code !== 0) return { statut: 'inconnu', titre: 'Contrôle de node_modules impossible' }
  const manquants = JSON.parse(r.sortie)
  const ecarts = ecartsAvecLeLock(
    lireJson(join(racine, 'package.json')),
    lireJson(join(racine, 'package-lock.json'))
  )
  if (manquants.length === 0 && ecarts.length === 0) {
    return { statut: 'ok', titre: 'Dépendances complètes et en phase avec package-lock.json' }
  }
  return {
    statut: manquants.length ? 'ko' : 'attention',
    titre: manquants.length
      ? `${manquants.length} dépendance(s) absente(s) de node_modules`
      : `package.json et package-lock.json divergent sur ${ecarts.length} paquet(s)`,
    detail: [...manquants, ...ecarts].slice(0, 6).join(' · '),
    reparation: 'Relancer l’app par le lanceur : il répare node_modules au démarrage.'
  }
}

function sondeHooksGit({ racine, executer }) {
  const chemin = executer('git config core.hooksPath', 10_000).sortie.trim()
  if (chemin === '.githooks' && existsSync(join(racine, '.githooks', 'pre-push'))) {
    return { statut: 'ok', titre: 'Garde de publication git active' }
  }
  return {
    statut: 'attention',
    titre: 'Garde de publication git inactive',
    detail: `core.hooksPath = ${chemin || '(vide)'}`,
    reparation: '`git config core.hooksPath .githooks`'
  }
}

function sondeReglages({ data }) {
  const fichiers = readdirSync(data).filter((nom) => nom.endsWith('.json'))
  const casses = fichiers.filter((nom) => {
    try {
      JSON.parse(readFileSync(join(data, nom), 'utf8'))
      return false
    } catch {
      return true
    }
  })
  return {
    statut: casses.length ? 'ko' : 'ok',
    titre: casses.length
      ? `${casses.length} fichier(s) de réglages illisible(s)`
      : `${fichiers.length} fichiers de réglages lisibles`,
    detail: casses.join(' · '),
    reparation: casses.length ? 'Restaurer depuis `sauvegardes/` ou le `.bak` voisin.' : undefined
  }
}

/*
 * Seul ce que git déclare mort compte ici : dire si une copie est encore utile est le travail de
 * `/gc`, qui connaît ses exceptions. Deux définitions d'une copie morte divergeaient déjà.
 */
function sondeCopiesRestantes({ executer }) {
  const sortie = executer('git worktree list --porcelain', 20_000).sortie
  const copies = (sortie.match(/^worktree /gmu) ?? []).length
  const orphelines = (sortie.match(/^prunable/gmu) ?? []).length
  return {
    statut: orphelines ? 'attention' : 'ok',
    titre: `${copies} copie(s) de travail, ${orphelines} orpheline(s)`,
    reparation: orphelines ? '`/gc` pour le ménage, `/git` s’il y a du travail à trier.' : undefined
  }
}

function sondeDisque({ racine }) {
  const libres = [racine, tmpdir()].map((chemin) => {
    const s = statfsSync(chemin)
    return { disque: resolve(chemin).slice(0, 3), go: (s.bavail * s.bsize) / GO }
  })
  const uniques = [...new Map(libres.map((l) => [l.disque, l])).values()]
  const pire = Math.min(...uniques.map((l) => l.go))
  return {
    statut: pire < SEUILS.disqueKoGo ? 'ko' : pire < SEUILS.disqueAttentionGo ? 'attention' : 'ok',
    titre: `Espace libre : ${uniques.map((l) => `${l.disque} ${l.go.toFixed(0)} Go`).join(' · ')}`,
    reparation:
      pire < SEUILS.disqueAttentionGo ? '`/gc` déplace les déchets en corbeille.' : undefined
  }
}

/* ── extensions ───────────────────────────────────────────────────────────────────────────── */

function sondeSkillsFormat({ racine, localAppData }) {
  const kit = join(racine, 'skills')
  const local = localAppData ? join(localAppData, 'autowin-os', 'skills') : ''
  const noms = dossiersDeSkills(kit)
  const locales = local ? dossiersDeSkills(local) : []
  const defauts = locales.filter((n) => noms.includes(n)).map((n) => `${n} : en double`)
  for (const [dossier, liste] of [
    [kit, noms],
    [local, locales]
  ]) {
    for (const nom of liste) {
      const md = readFileSync(join(dossier, nom, 'SKILL.md'), 'utf8')
      const declare = /^name:\s*(.+)$/mu.exec(md)?.[1]?.trim()
      const description = descriptionDeSkill(md)
      if (declare !== nom) defauts.push(`${nom} : se déclare « ${declare ?? 'sans nom'} »`)
      if (!description) defauts.push(`${nom} : sans description`)
      if (description.length > SEUILS.descriptionMax) {
        defauts.push(`${nom} : description de ${description.length} caractères`)
      }
    }
  }
  return {
    statut: defauts.length ? 'attention' : 'ok',
    titre: defauts.length
      ? `${defauts.length} défaut(s) de déclaration de skill`
      : `${noms.length + locales.length} skills bien déclarées`,
    detail: defauts.slice(0, 6).join(' · ')
  }
}

function sondeServeursMcp({ data }) {
  const dossier = join(data, 'run-stdout')
  const inits = plusRecents(dossier, 20)
    .map((f) => initDeTour(debutDeFichier(f.chemin)))
    .filter(Boolean)
  if (inits.length === 0) return { statut: 'inconnu', titre: 'Aucun tour récent à relire' }
  const echecs = new Set()
  const serveurs = new Set()
  for (const init of inits) {
    for (const serveur of init.mcp_servers ?? []) {
      serveurs.add(serveur.name)
      if (/fail|error|needs-auth/iu.test(serveur.status ?? '')) echecs.add(serveur.name)
    }
  }
  const outils = Math.max(...inits.map((init) => init.tools?.length ?? 0))
  return {
    statut: echecs.size ? 'ko' : 'ok',
    titre: echecs.size
      ? `Serveur d’outils en échec : ${[...echecs].join(', ')}`
      : `Serveurs d’outils joignables sur ${inits.length} tours récents`,
    detail: `${[...serveurs].join(', ') || 'aucun'} · ${outils} outils exposés au modèle`,
    reparation: echecs.size ? '`restart_app` relance le serveur d’outils d’Autowin.' : undefined
  }
}

function sondeTaches({ data, maintenant }) {
  const { tasks = [], occurrences = [] } = lireJson(join(data, 'scheduled-tasks.json'))
  const activees = tasks.filter((t) => t.enabled)
  const titres = new Map(tasks.map((t) => [t.id, t.title]))
  const depuis = maintenant - 14 * JOUR_MS
  const recentes = occurrences.filter((o) => o.scheduledFor >= depuis)
  /*
   * « missed » veut dire que l'app était fermée à l'échéance (mode active-only) : ce n'est pas une
   * panne de la tâche. Les compter comme des échecs accusait trois tâches saines.
   */
  const manquees = recentes.filter((o) => o.status === 'missed').length
  const echecs = new Map()
  for (const o of recentes.filter((o) => o.status === 'failed')) {
    echecs.set(o.taskId, (echecs.get(o.taskId) ?? 0) + 1)
  }
  const recidives = [...echecs].filter(([, n]) => n >= SEUILS.echecsParTache)
  const dernierDemarrage = lignesJson(readFileSync(join(data, 'demarrages.jsonl'), 'utf8'))
    .map((d) => Date.parse(d.ts))
    .filter(Number.isFinite)
    .at(-1)
  const oubliees = tachesOubliees(activees, dernierDemarrage, maintenant)
  if (oubliees.length > 0) {
    return {
      statut: 'ko',
      titre: 'Le planificateur ne tourne plus',
      detail: `${oubliees.length} échéance(s) passée(s) alors que l’app tournait : ${oubliees
        .slice(0, 3)
        .map((t) => t.title ?? t.id)
        .join(' · ')}`,
      reparation: '`restart_app` relance le planificateur.'
    }
  }
  return {
    statut: recidives.length ? 'attention' : 'ok',
    titre: recidives.length
      ? `${recidives.length} tâche(s) programmée(s) en échec répété sur 14 jours`
      : `${activees.length} tâche(s) programmée(s) activée(s), sans échec répété`,
    detail: [
      ...recidives.map(([id, n]) => `${titres.get(id) ?? id} (${n})`),
      ...(manquees ? [`${manquees} échéance(s) manquée(s), app fermée à l'heure dite`] : [])
    ].join(' · ')
  }
}

/*
 * L'équivalent des « crochets lents » de Claude Code : ce qu'Autowin fait AVANT d'envoyer le tour.
 * `send0:start` est un repère cumulé depuis le début du tour, donc il contient tout ce travail et
 * rien du temps de réponse du modèle.
 */
function sondeAttente({ data, maintenant }) {
  const depuis = maintenant - 7 * JOUR_MS
  const attentes = lignesJson(readFileSync(join(data, 'turn-timing.jsonl'), 'utf8'))
    .filter((l) => l.label === 'chat' && Date.parse(l.ts) >= depuis)
    .map((l) => l.marks?.['send0:start'])
    .filter((ms) => typeof ms === 'number')
  if (attentes.length === 0) return { statut: 'inconnu', titre: 'Aucun tour mesuré sur 7 jours' }
  const mediane = quantile(attentes, 0.5)
  return {
    statut: mediane > SEUILS.attenteMedianeMs ? 'attention' : 'ok',
    titre: `Préparation d’un tour : ${mediane} ms en médiane`,
    detail: `${quantile(attentes, 0.95)} ms pour les 5 % les plus lents, sur ${attentes.length} tours`,
    reparation:
      mediane > SEUILS.attenteMedianeMs ? '`/heal` sur la préparation du tour.' : undefined
  }
}

/* ── instructions ─────────────────────────────────────────────────────────────────────────── */

function sondeChargePermanente({ racine, data }) {
  const source = readFileSync(join(racine, 'src', 'main', 'consignes', 'context-files.ts'), 'utf8')
  const plafond = Number(
    /PROJECT_CONTEXT_MAX_BYTES = ([\d_]+)/u.exec(source)?.[1].replace(/_/gu, '')
  )
  // Sans plafond, toute comparaison serait fausse et la sonde répondrait « ok » en silence.
  if (!Number.isFinite(plafond)) throw new Error('PROJECT_CONTEXT_MAX_BYTES introuvable')
  const agents = statSync(join(racine, 'AGENTS.md')).size
  const dossierProfils = join(data, 'profils')
  const profils = existsSync(dossierProfils)
    ? readdirSync(dossierProfils).filter((nom) => nom.endsWith('.md'))
    : []
  const profil = Math.max(0, ...profils.map((nom) => statSync(join(dossierProfils, nom)).size))
  const [prompt] = plusRecents(join(data, 'prompt-observability', 'systems'), 1)
  const alertes = []
  if (agents > plafond * SEUILS.chargeAgents) alertes.push('AGENTS.md proche de son plafond')
  if (profil > SEUILS.profilOctets * SEUILS.chargeProfil) alertes.push('profil presque plein')
  if ((prompt?.octets ?? 0) > SEUILS.promptSystemeOctets)
    alertes.push('consigne de tour trop lourde')
  return {
    statut: alertes.length ? 'attention' : 'ok',
    titre: alertes.length ? alertes.join(' · ') : 'Charge permanente sous ses plafonds',
    detail: `consigne de tour ${prompt?.octets ?? '?'} o · AGENTS.md ${agents}/${plafond} o · profil ${profil}/${SEUILS.profilOctets} o`,
    reparation: alertes.length
      ? 'Déplacer ce qui ne sert pas à chaque tour dans une skill.'
      : undefined
  }
}

function sondeReferencesMortes({ racine }) {
  const dossierKit = join(racine, 'skills')
  const sources = [
    'AGENTS.md',
    ...dossiersDeSkills(dossierKit).map((nom) => `skills/${nom}/SKILL.md`)
  ]
  const mortes = []
  for (const source of sources) {
    for (const chemin of cheminsCites(readFileSync(join(racine, source), 'utf8'))) {
      if (!existsSync(join(racine, chemin))) mortes.push(`${source} → ${chemin}`)
    }
  }
  return {
    statut: mortes.length ? 'attention' : 'ok',
    titre: mortes.length
      ? `${mortes.length} chemin(s) cité(s) qui n’existe(nt) plus`
      : `Chemins cités valides dans ${sources.length} fichiers d’instructions`,
    detail: mortes.slice(0, 8).join(' · '),
    reparation: mortes.length ? '`/doctor prompt-audit` pour trier ces renvois.' : undefined
  }
}

function sondeDoublonsInstructions({ racine, executer }) {
  const agents = new Set(
    readFileSync(join(racine, 'AGENTS.md'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= 40)
  )
  const autres = ['CLAUDE.md', 'CLAUDE.local.md', join('.claude', 'CLAUDE.md')].filter((f) =>
    existsSync(join(racine, f))
  )
  const doublons = autres.flatMap((fichier) =>
    readFileSync(join(racine, fichier), 'utf8')
      .split('\n')
      .filter((l) => agents.has(l.trim()))
      .map(() => fichier)
  )
  const ignore = executer('git check-ignore -q AGENTS.md', 10_000).code === 0
  return {
    statut: doublons.length ? 'attention' : ignore ? 'info' : 'ok',
    titre: doublons.length
      ? `${doublons.length} ligne(s) d’AGENTS.md recopiée(s) ailleurs`
      : 'Un seul fichier de contexte projet',
    detail: ignore ? 'AGENTS.md est ignoré par git : un autre poste ne le reçoit pas.' : ''
  }
}

/* ── permissions ──────────────────────────────────────────────────────────────────────────── */

function sondeGardes({ racine }) {
  const reglages = lireJson(join(racine, '.claude', 'settings.json'))
  const commandes = Object.values(reglages.hooks ?? {})
    .flat()
    .flatMap((groupe) => groupe.hooks ?? [])
  const cibles = commandes
    .flatMap((hook) => hook.args ?? [])
    .map((arg) => arg.replace('${CLAUDE_PROJECT_DIR}/', ''))
    .filter((arg) => /\.m?js$|\.ps1$|\.py$/u.test(arg))
  const absentes = cibles.filter((cible) => !existsSync(join(racine, cible)))
  return {
    statut: absentes.length ? 'ko' : 'ok',
    titre: absentes.length
      ? `Garde pointant vers un script absent : ${absentes.join(', ')}`
      : `${commandes.length} garde(s) du CLI branchée(s) sur un script présent`
  }
}

/*
 * La vraie surface : les agents tournent en `bypassPermissions`, le CLI ne leur demande donc rien.
 * Leurs seules limites sont les gardes d'Autowin. Un agent lancé sans aucune garde est une panne.
 */
function sondeMode({ racine }) {
  const source = readFileSync(join(racine, 'src', 'main', 'providers', 'claude.ts'), 'utf8')
  const sansDemande = source.includes("'bypassPermissions'")
  const dossier = join(racine, 'src', 'main', 'gates')
  const gardes = readdirSync(dossier).filter(
    (nom) => nom.endsWith('.ts') && !nom.endsWith('.test.ts')
  )
  const branchees = existsSync(join(racine, 'src', 'main', 'hooks', 'default-gate-hooks.ts'))
  if (sansDemande && (gardes.length === 0 || !branchees)) {
    return {
      statut: 'ko',
      titre: 'Agents lancés sans autorisation du CLI, et sans garde d’Autowin',
      reparation:
        'Rétablir `src/main/hooks/default-gate-hooks.ts` et `src/main/gates` avant tout run.'
    }
  }
  return {
    statut: 'info',
    titre: sansDemande
      ? `Agents sans demande d’autorisation du CLI, limités par ${gardes.length} gardes d’Autowin`
      : 'Agents soumis aux autorisations du CLI',
    detail: gardes.map((nom) => nom.replace(/\.ts$/u, '')).join(' · ')
  }
}

function sondeRefus({ data }) {
  const { fils, classement } = refusRecents(lireJson(join(data, 'murs-rencontres.json')))
  const recurrents = classement.filter(([, n]) => n >= SEUILS.refusRecurrent)
  return {
    statut: recurrents.length ? 'attention' : 'ok',
    titre: recurrents.length
      ? `${recurrents.length} refus récurrent(s) sur les ${fils} derniers fils`
      : `Aucun refus récurrent sur les ${fils} derniers fils`,
    detail: (recurrents.length ? recurrents : classement)
      .slice(0, 3)
      .map(([signature, n]) => `${n} fils : ${signature.slice(0, 80)}`)
      .join(' · '),
    reparation: recurrents.length
      ? 'Geste légitime : assouplir sa garde. Erreur d’agent : corriger la description de l’outil.'
      : undefined
  }
}

/* ── usage ────────────────────────────────────────────────────────────────────────────────── */

function sondeCout({ data, maintenant }) {
  const lignes = lignesJson(readFileSync(join(data, 'cost.jsonl'), 'utf8'))
  const { total, avant, postes } = bilanCout(lignes, maintenant)
  const hausse = avant > 0 && total >= avant * SEUILS.hausseCout
  return {
    statut: hausse ? 'attention' : 'info',
    titre: `${total.toFixed(0)} $ enregistrés sur 7 jours, ${avant.toFixed(0)} $ la semaine d’avant`,
    detail: postes
      .slice(0, 3)
      .map(([poste, cout]) => `${poste} ${cout.toFixed(0)} $`)
      .join(' · '),
    reparation: hausse ? '`npm run scout:rendement -- --top 5` pour trouver la cause.' : undefined
  }
}

/*
 * Le forfait, pas les dollars : un compte à 95 % de sa semaine se voit ici même si le coût ne bouge
 * pas. Même relevé local, sans réseau, que `src/main/modeles/model-quotas.ts` : Claude Desktop y note
 * l'usage du forfait (`sd` sur 7 jours, `fh` sur 5 heures, en %). Il ne couvre que son compte.
 */
function sondeQuota({ appData, maintenant }) {
  const chemin = appData ? join(appData, 'Claude', 'plan-usage-history.json') : ''
  if (!chemin || !existsSync(chemin)) {
    return {
      statut: 'inconnu',
      titre: 'Quota du forfait illisible : aucun relevé local sur ce poste'
    }
  }
  const dernier = lireJson(chemin).samples?.at(-1)
  const semaine = dernier?.u?.sd
  if (typeof semaine !== 'number') return { statut: 'inconnu', titre: 'Relevé de quota vide' }
  const age = (maintenant - dernier.t) / JOUR_MS
  if (age > SEUILS.quotaReleveVieuxJours) {
    return { statut: 'inconnu', titre: `Relevé de quota vieux de ${age.toFixed(0)} jours` }
  }
  // La fenêtre de 5 h est finie depuis longtemps sur un relevé plus vieux qu'elle.
  const cinqHeures =
    age * 24 < 5 && typeof dernier.u.fh === 'number' ? `, ${dernier.u.fh} % sur 5 heures` : ''
  const frais = age <= SEUILS.quotaReleveFraisJours
  const haut = frais && semaine >= SEUILS.quotaAttention
  return {
    statut: haut ? 'attention' : 'info',
    titre: `Forfait : ${semaine} % de la semaine consommés${frais ? '' : ' au dernier relevé'}${cinqHeures}`,
    detail: `Relevé d’il y a ${age.toFixed(1)} j, compte de Claude Desktop`,
    reparation: haut
      ? '`/rendement` trouve ce qui consomme ; passer les lots simples sur un modèle léger.'
      : undefined
  }
}

/* ── services ─────────────────────────────────────────────────────────────────────────────── */

function sondeBrain({ executer }) {
  const r = executer('node scripts/brain-doctor.mjs --lecture-seule', 30_000)
  if (r.code === 0) return { statut: 'ok', titre: 'Brain joignable, protocole en phase' }
  return {
    statut: 'ko',
    titre: 'Canal Brain en panne',
    detail: r.sortie
      .split('\n')
      .filter((l) => l.startsWith('[FAIL]'))
      .slice(0, 3)
      .join(' · '),
    reparation: '`npm run brain:doctor` nomme l’endroit où ça diverge.'
  }
}

function sondeGels({ data, executer }) {
  const journal = join(data, 'gels.jsonl')
  const r = executer(
    `node scripts/gels-classement.mjs --jours 7 --json --journal "${journal}"`,
    30_000
  )
  if (r.code !== 0) return { statut: 'inconnu', titre: `Journal des gels muet (code ${r.code})` }
  const { gels = 0, pireMs = 0 } = JSON.parse(r.sortie).totaux?.fenetre ?? {}
  const grave = pireMs >= SEUILS.gelPireMs
  return {
    statut: grave ? 'attention' : 'ok',
    titre: `${gels} gel(s) de fenêtre sur 7 jours, le pire de ${(pireMs / 1000).toFixed(1)} s`,
    reparation: grave ? '`/gel` désigne le coupable.' : undefined
  }
}

function sondePlantages({ data, maintenant }) {
  const chemin = join(data, 'crash.log')
  if (!existsSync(chemin)) return { statut: 'ok', titre: 'Aucun plantage enregistré' }
  const recents = plantagesRecents(readFileSync(chemin, 'utf8'), maintenant - 7 * JOUR_MS)
  const total = recents.reduce((somme, [, n]) => somme + n, 0)
  return {
    statut: total ? 'attention' : 'ok',
    titre: `${total} erreur(s) non rattrapée(s) sur 7 jours`,
    detail: recents
      .slice(0, 3)
      .map(([quoi, n]) => `${n}× ${quoi}`)
      .join(' · '),
    reparation: total ? '`/heal` sur l’erreur la plus fréquente.' : undefined
  }
}

function sondeDemarrage({ data }) {
  const demarrages = lignesJson(readFileSync(join(data, 'demarrages.jsonl'), 'utf8')).slice(-10)
  const durees = demarrages.map((d) => d.jalons?.at(-1)?.ms).filter((ms) => typeof ms === 'number')
  if (durees.length === 0) return { statut: 'inconnu', titre: 'Aucun démarrage mesuré' }
  const mediane = quantile(durees, 0.5)
  return {
    statut: mediane > SEUILS.demarrageMs ? 'attention' : 'ok',
    titre: `Démarrage : ${(mediane / 1000).toFixed(1)} s en médiane sur ${durees.length}`
  }
}

export const SONDES = [
  ['installation', 'donnees', sondeDonnees],
  ['installation', 'outils', sondeOutils],
  ['installation', 'installs-claude', sondeInstallsClaude],
  ['installation', 'claude-doctor', sondeClaudeDoctor],
  ['installation', 'version', sondeVersion],
  ['installation', 'dependances', sondeDependances],
  ['installation', 'hooks-git', sondeHooksGit],
  ['installation', 'reglages', sondeReglages],
  ['installation', 'copies-restantes', sondeCopiesRestantes],
  ['installation', 'disque', sondeDisque],
  ['extensions', 'skills-format', sondeSkillsFormat],
  ['extensions', 'serveurs-mcp', sondeServeursMcp],
  ['extensions', 'taches', sondeTaches],
  ['extensions', 'attente', sondeAttente],
  ['instructions', 'charge-permanente', sondeChargePermanente],
  ['instructions', 'references-mortes', sondeReferencesMortes],
  ['instructions', 'doublons', sondeDoublonsInstructions],
  ['permissions', 'mode', sondeMode],
  ['permissions', 'gardes', sondeGardes],
  ['permissions', 'refus', sondeRefus],
  ['usage', 'cout', sondeCout],
  ['usage', 'quota', sondeQuota],
  ['services', 'brain', sondeBrain],
  ['services', 'gels', sondeGels],
  ['services', 'plantages', sondePlantages],
  ['services', 'demarrage', sondeDemarrage]
]

/** Lance une commande FIXE de ce fichier : aucune n'embarque de saisie de l'utilisateur. */
function executeurReel(racine) {
  return (commande, timeout) => {
    const r = spawnSync(commande, {
      cwd: racine,
      shell: true,
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { code: r.status, sortie: r.stdout ?? '' }
  }
}

/** Joue les sondes. Celle qui casse rend « inconnu » et n'emporte pas les suivantes. */
export function diagnostiquer({
  racine = racineDepot(),
  data = join(racine, '.autowin-data', 'autowin-os'),
  maintenant = Date.now(),
  localAppData = process.env.LOCALAPPDATA,
  appData = process.env.APPDATA,
  executer = executeurReel(racine),
  sondes = SONDES,
  zone
} = {}) {
  const contexte = { racine, data, maintenant, localAppData, appData, executer }
  // Le dossier de données commande tout le reste : même une zone seule doit voir son absence, sinon
  // `--zone`, qui contrôle une réparation, rendrait un faux sain.
  const utile = ([z, id]) => !zone || z === zone || id === 'donnees'
  return sondes
    .filter(utile)
    .map(([z, id, sonde]) => {
      try {
        return { zone: z, id, detail: '', ...sonde(contexte) }
      } catch (erreur) {
        return {
          zone: z,
          id,
          statut: 'inconnu',
          titre: 'Sonde en échec',
          detail: String(erreur.message ?? erreur)
        }
      }
    })
    .map((c) => ({
      ...c,
      titre: masquer(c.titre),
      detail: masquer(c.detail),
      reparation: masquer(c.reparation)
    }))
    .filter((c) => !zone || c.zone === zone || c.statut === 'ko')
}

const MARQUES = { ok: '[ok]', info: '[i] ', attention: '[!] ', ko: '[KO]', inconnu: '[?] ' }

export function rendreTexte(constats) {
  const lignes = ['Autowin OS doctor', '']
  for (const zone of ZONES) {
    const dela = constats.filter((c) => c.zone === zone)
    if (dela.length === 0) continue
    lignes.push(zone.toUpperCase())
    for (const c of dela) {
      lignes.push(`  ${MARQUES[c.statut]} ${c.titre}`)
      if (c.detail) lignes.push(`       ${c.detail}`)
      if (c.reparation) lignes.push(`       -> ${c.reparation}`)
    }
    lignes.push('')
  }
  const compte = (statut) => constats.filter((c) => c.statut === statut).length
  lignes.push(
    `Bilan : ${compte('ko')} ko · ${compte('attention')} à surveiller · ${compte('inconnu')} inconnu(s) · ${compte('info')} pour info · ${compte('ok')} ok`
  )
  return lignes.join('\n')
}

/** Une majorité de sondes muettes n'est pas un poste sain : c'est un bilan qui n'a pas eu lieu. */
export function codeDeSortie(constats) {
  if (constats.some((c) => c.statut === 'ko')) return 1
  const muettes = constats.filter((c) => c.statut === 'inconnu').length
  return constats.length > 0 && muettes * 2 >= constats.length ? 3 : 0
}

function main(argv) {
  const valeur = (nom) => (argv.includes(nom) ? argv[argv.indexOf(nom) + 1] : undefined)
  const zone = valeur('--zone')
  if (zone && !ZONES.includes(zone)) {
    console.error(`Zone inconnue : ${zone}. Zones : ${ZONES.join(', ')}`)
    return 2
  }
  const data = valeur('--data')
  const constats = diagnostiquer({ zone, ...(data ? { data: resolve(data) } : {}) })
  console.log(argv.includes('--json') ? JSON.stringify(constats, null, 2) : rendreTexte(constats))
  return codeDeSortie(constats)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
