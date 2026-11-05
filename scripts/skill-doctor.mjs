#!/usr/bin/env node
/**
 * skill-doctor — ce que chaque skill coûte et combien elle sert. LECTURE SEULE : le seul accroc vient
 * de `nativeSkills`, qui crée `registry/` s'il manque (sous `--data`) et peut réparer ou migrer un
 * réglage illisible ou ancien.
 *
 * Portage du `/skill-doctor` de Claude Code (demande conv-1369, 2026-10-31), relu dans claude.exe
 * 2.1.314 et dans https://code.claude.com/docs/en/skills.md#find-unused-skills : mêmes colonnes,
 * même tri (les jamais servies d'abord, puis les plus anciennes), même signalement (« jamais
 * invoquée » = zéro usage ET présente dans la liste). Seules les SOURCES changent :
 *
 *   contexte   claude.exe : la ligne de la skill dans le prompt système.
 *              Ici : sa ligne dans `skillsDisponibles`, l'état remis au modèle à chaque tour.
 *   usages     claude.exe : un compteur dans sa config. Autowin n'en a pas : on recompte ce qui fait
 *              servir la skill — message tapé (ou tâche planifiée) et `skill_charger`, qui lisent sa
 *              procédure, plus les étapes de run, qui jouent sa phase sous un brief (`phase-briefs.ts`)
 *              sans lire le SKILL.md. Sans elles, `clean` paraîtrait jamais servie.
 *   jetons 7 j claude.exe : cache + entrée + sortie des requêtes attribuées à la skill (`Ft`).
 *              Ici : même somme, mais par tour de chat et par étape de run entiers.
 *
 * Usage (depuis la racine du dépôt) : npx tsx scripts/skill-doctor.mjs [--data <dir>] [--json]
 * tsx et pas `node` : les modules de `src/main` s'importent sans extension.
 * Code 0 = rapport rendu · 2 = aucune conversation lue (sans elles, tout paraîtrait jamais servi).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ajouterArchives, texteDuMessage } from './conversations-sur-disque.mjs'
import { nativeSkills, skillRoots } from '../src/main/native-registry.ts'
import { invokedSkillId } from '../src/main/skill-pipeline.ts'
import { nomDeSkillDemande } from '../src/main/skill-charger-command.ts'
import { corrigeSkillMalTapee, resolveSkillAlias } from '../src/shared/skill-aliases.ts'
import { skillNommeeEnTete } from '../src/shared/skill-nommee.ts'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEPT_JOURS_MS = 7 * 86_400_000
const UN_JOUR_MS = 86_400_000
const MARGE_SAISIE_MS = 10 * 60_000

/** Les enregistrements `activity` qui portent les jetons d'un tour de chat (ils s'additionnent). */
const ENREGISTREMENTS_DE_TOUR = new Set(['chat-usage', 'chat-recovered', 'chat'])

const lireJson = (fichier, defaut) => {
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'))
  } catch {
    return defaut
  }
}

const lignesDe = (fichier) => {
  try {
    return fs.readFileSync(fichier, 'utf8').split('\n')
  } catch {
    return []
  }
}

const analyser = (ligne) => {
  try {
    return JSON.parse(ligne)
  } catch {
    return null
  }
}

const entrees = (dossier) => {
  try {
    return fs.readdirSync(dossier)
  } catch {
    return []
  }
}

const dateDe = (fichier) => {
  try {
    return fs.statSync(fichier).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Snapshot, archives et journal, dans l'ordre de l'app : le fichier seul est en retard sur les fils
 * récents, et les fils inactifs depuis 14 jours n'y sont plus (`conversations-sur-disque.mjs`).
 */
export function lireCorpus(data) {
  const fichier = path.join(data, 'conversations.json')
  const base = lireJson(fichier, [])
  const parId = ajouterArchives(
    new Map((Array.isArray(base) ? base : []).map((c) => [c.id, c])),
    fichier
  )
  for (const ligne of lignesDe(`${fichier}.journal.jsonl`)) {
    const r = ligne ? analyser(ligne) : null
    if (r?.op === 'upsert' && r.conversation?.id) parId.set(r.conversation.id, r.conversation)
    else if (r?.op === 'delete') parId.delete(r.id)
    else if (r?.op === 'append-messages' && Array.isArray(r.messages)) {
      parId.get(r.id)?.messages?.push(...r.messages)
    }
  }
  return [...parId.values()]
}

/** Le nom réel derrière `/nom` : alias puis faute de frappe, comme `skillInstruction`. */
function resoudre(nom, noms) {
  const cible = resolveSkillAlias(nom).toLowerCase()
  return noms.find((n) => n.toLowerCase() === cible) ?? corrigeSkillMalTapee(cible, noms)
}

/**
 * La skill que CE message charge, avec la règle d'`agent-pilot.ts` : `/nom` en tête, sinon le nom nu
 * en tête. Une mention au fil du texte (« fais un draft ») ne charge rien, donc ne compte pas.
 */
export function skillDuMessage(texte, noms) {
  const barre = invokedSkillId(texte ?? '')
  if (barre) return resoudre(barre, noms)
  return skillNommeeEnTete(texte, noms)?.skill
}

/**
 * Un refus (skill désactivée ou inconnue) n'a rien chargé : seul le RÉSULTAT de l'appel le dit, et il
 * suit toujours son appel dans le fichier. MESURE du 2026-10-31 : 68 appels, 66 succès, 2 refus.
 */
const REFUS_DE_CHARGEMENT = /^\s*skill_charger\s*:/u

/** Les mots de l'utilisateur dans une trace causale, sans l'enveloppe du tour. */
function motsDeLaTrace(contenu) {
  const m = /<message_utilisateur>([\s\S]*?)<\/message_utilisateur>/u.exec(contenu ?? '')
  return m ? m[1] : (contenu ?? '').replace(/^UTILISATEUR:\s*/u, '')
}

function lireTraces(data, noms, depuis) {
  const dossier = path.join(data, 'causal-trace')
  const appels = []
  const tours = new Map()
  const noterTour = (turnId, nom) => {
    if (!turnId || !nom) return
    if (!tours.has(turnId)) tours.set(turnId, new Set())
    tours.get(turnId).add(nom)
  }
  for (const nomFichier of entrees(dossier)) {
    if (!nomFichier.endsWith('.jsonl')) continue
    for (const ligne of lignesDe(path.join(dossier, nomFichier))) {
      // Filtre sur le texte brut : ces fichiers pèsent des centaines de Mo, presque rien ne sert.
      if (!ligne.includes('"skill_charger"') && !ligne.includes('"user-message"')) continue
      const o = analyser(ligne)
      const charge = o?.payloads?.[0]
      const ts = Date.parse(o?.timestamp ?? '')
      if (!charge || !Number.isFinite(ts)) continue
      if (o.type === 'tool-call' && charge.name === 'skill_charger') {
        // Gardé même sans nom connu : son refus doit retomber sur lui, pas sur l'appel d'avant.
        const nom = resoudre(nomDeSkillDemande(analyser(charge.content)?.nom), noms)
        appels.push({ nom, ts, turnId: o.turnId })
      } else if (
        charge.name === 'skill_charger' &&
        REFUS_DE_CHARGEMENT.test(charge.content ?? '')
      ) {
        const rang = appels.findLastIndex((a) => a.turnId === o.turnId)
        if (rang >= 0) appels.splice(rang, 1)
      } else if (o.type === 'message' && charge.kind === 'user-message' && ts >= depuis) {
        noterTour(o.turnId, skillDuMessage(motsDeLaTrace(charge.content), noms))
      }
    }
  }
  const chargements = appels.filter((a) => a.nom)
  for (const { nom, ts, turnId } of chargements) if (ts >= depuis) noterTour(turnId, nom)
  return { chargements, tours }
}

function jetonsParTour(data, depuis) {
  const dossier = path.join(data, 'activity')
  const jetons = new Map()
  for (const nomFichier of entrees(dossier)) {
    const fichier = path.join(dossier, nomFichier)
    if (dateDe(fichier) < depuis) continue
    for (const ligne of lignesDe(fichier)) {
      if (!ligne.includes('"turnId"')) continue
      const o = analyser(ligne)
      if (!o?.turnId || !ENREGISTREMENTS_DE_TOUR.has(o.kind)) continue
      if (Date.parse(o.ts ?? '') < depuis) continue
      const total = (o.inputTokens ?? 0) + (o.outputTokens ?? 0)
      jetons.set(o.turnId, (jetons.get(o.turnId) ?? 0) + total)
    }
  }
  return jetons
}

/**
 * Chaque run joue ses étapes sous leur brief (`src/main/phase-briefs.ts`), sans lire le SKILL.md :
 * l'ancien chargeur `phaseInstruction`, sans appelant (/judge conv-1369), est retiré le 05/11
 * (conv-1602). `trace.json` les nomme et porte leurs jetons ; les runs
 * plus anciens n'ont que les titres `### phase x` de leur RUN.md. Une étape rejouée dans le même run
 * compte une fois : c'est le run qui sert la skill, pas ses reprises.
 */
function lireRuns(data, noms, depuis) {
  const connus = new Set(noms)
  const dossier = path.join(data, 'runs')
  const etapes = []
  for (const conversation of entrees(dossier)) {
    for (const run of entrees(path.join(dossier, conversation))) {
      const racineRun = path.join(dossier, conversation, run)
      const fichierTrace = path.join(racineRun, 'trace.json')
      const fichierRun = path.join(racineRun, 'RUN.md')
      const ts = Math.max(dateDe(fichierTrace), dateDe(fichierRun))
      if (ts === 0) continue
      const phases = new Map()
      const trace = lireJson(fichierTrace, [])
      for (const etape of Array.isArray(trace) ? trace : []) {
        const phase = etape?.execution?.phase
        if (!connus.has(phase)) continue
        phases.set(phase, (phases.get(phase) ?? 0) + (etape.tokens ?? 0))
      }
      for (const m of lignesDe(fichierRun)
        .join('\n')
        .matchAll(/^### phase ([a-z0-9-]+)/gmu)) {
        if (connus.has(m[1]) && !phases.has(m[1])) phases.set(m[1], 0)
      }
      for (const [nom, jetons] of phases)
        etapes.push({ nom, ts, jetons: ts >= depuis ? jetons : 0 })
    }
  }
  return etapes
}

/**
 * `saisies-utilisateur.jsonl` survit à la suppression d'un fil, pas les conversations. MESURE du
 * 2026-10-31 (conv-1369) : 33 invocations n'existaient plus que là, dont le seul `/steal`, que le
 * rapport déclarait « jamais invoquée » à tort. Une saisie déjà vue dans les conversations ne compte
 * pas deux fois : on compare texte et date, car un premier message y porte `nouvelle-conversation`
 * au lieu de l'identifiant du fil. Une « orientation », envoyée en plein tour, ne charge aucune skill.
 */
function saisiesDeFilsDisparus(data, noms, tapes) {
  const sortie = []
  for (const ligne of lignesDe(path.join(data, 'saisies-utilisateur.jsonl'))) {
    const o = ligne ? analyser(ligne) : null
    if (typeof o?.texte !== 'string' || o.voie === 'orientation') continue
    const nom = skillDuMessage(o.texte, noms)
    if (!nom) continue
    const dates = tapes.get(o.texte.trim()) ?? []
    if (!dates.some((ts) => Math.abs(ts - o.ts) < MARGE_SAISIE_MS)) sortie.push({ nom, ts: o.ts })
  }
  return sortie
}

/** Usages par skill : `tapee` (message ou tâche planifiée), `modele` (`skill_charger`), `etape` (run). */
export function mesurerUsages({ data, noms, conversations, maintenant = Date.now() }) {
  const depuis = maintenant - SEPT_JOURS_MS
  const usages = new Map(
    noms.map((nom) => [nom, { tapee: 0, modele: 0, etape: 0, dernier: 0, jetons7j: 0 }])
  )
  const compter = (nom, origine, ts) => {
    const u = usages.get(nom)
    if (!u) return
    u[origine] += 1
    if (ts > u.dernier) u.dernier = ts
  }

  const tapes = new Map()
  for (const conversation of conversations ?? lireCorpus(data)) {
    // Le journal peut rejouer un message déjà écrit dans le snapshot.
    const vus = new Set()
    for (const message of conversation.messages ?? []) {
      if (message?.role !== 'user') continue
      if (message.messageId) {
        if (vus.has(message.messageId)) continue
        vus.add(message.messageId)
      }
      const texte = texteDuMessage(message)
      const nom = skillDuMessage(texte, noms)
      if (!nom) continue
      compter(nom, 'tapee', message.ts ?? 0)
      const cle = texte.trim()
      if (!tapes.has(cle)) tapes.set(cle, [])
      tapes.get(cle).push(message.ts ?? 0)
    }
  }
  for (const { nom, ts } of saisiesDeFilsDisparus(data, noms, tapes)) compter(nom, 'tapee', ts)

  const { chargements, tours } = lireTraces(data, noms, depuis)
  for (const { nom, ts } of chargements) compter(nom, 'modele', ts)

  // Un tour qui charge plusieurs skills partage ses jetons entre elles : claude.exe n'attribue une
  // requête qu'à une seule skill, et les additionner compterait deux fois le même tour.
  const jetons = jetonsParTour(data, depuis)
  for (const [turnId, skills] of tours) {
    const part = (jetons.get(turnId) ?? 0) / skills.size
    for (const nom of skills) usages.get(nom).jetons7j += part
  }

  for (const { nom, ts, jetons: part } of lireRuns(data, noms, depuis)) {
    compter(nom, 'etape', ts)
    usages.get(nom).jetons7j += part
  }
  return usages
}

/**
 * COPIE de `ligneDeSkill` (`src/main/commands.ts`) : ce module tire tout le processus principal et
 * Electron, un script ne peut pas l'importer. Le test `skill-doctor.test.mjs` compare les deux sur
 * tout le kit : si la règle change là-bas, il passe au rouge ici.
 */
const DECLENCHEUR_MAX = 120
const FRONTIERE_MAX = 90
const CLAUSE_FRONTIERE =
  /PAS pour|NE PAS utiliser|Ne pas utiliser|NE PAS l'utiliser|PAS l'utiliser/u
const couper = (texte, max) => (texte.length > max ? `${texte.slice(0, max).trimEnd()}…` : texte)

export function ligneDeListe(id, description) {
  const brut = (description ?? '').replace(/\s+/gu, ' ').trim()
  if (!brut || brut === 'Skill (SKILL.md)') return id
  const debut = CLAUSE_FRONTIERE.exec(brut)?.index ?? -1
  if (debut < 0) return `${id} — ${couper(brut, DECLENCHEUR_MAX)}`
  const declencheur = couper(brut.slice(0, debut).trimEnd(), DECLENCHEUR_MAX)
  const clause = brut.slice(debut)
  const finDePhrase = clause.search(/\.\s/u)
  const frontiere = couper(
    finDePhrase > 0 ? clause.slice(0, finDePhrase + 1) : clause,
    FRONTIERE_MAX
  )
  return declencheur ? `${id} — ${declencheur} · ${frontiere}` : `${id} — ${frontiere}`
}

/** Même ordre de grandeur que l'affichage de claude.exe, qui arrondit de toute façon à la dizaine. */
const estimerJetons = (texte) => Math.ceil(texte.length / 4)

/** Lignes du rapport, triées comme claude.exe, et skills signalées. */
export function construireRapport({ skills, usages, maintenant = Date.now() }) {
  const lignes = skills.map((skill) => {
    const u = usages.get(skill.id) ?? { tapee: 0, modele: 0, etape: 0, dernier: 0, jetons7j: 0 }
    const total = u.tapee + u.modele + u.etape
    return {
      nom: skill.id,
      source: skill.source,
      // Désactivée = absente de la liste : elle ne coûte rien, donc rien à signaler.
      contexte: skill.enabled ? estimerJetons(ligneDeListe(skill.id, skill.description)) : null,
      jetons7j: u.jetons7j > 0 ? Math.round(u.jetons7j) : null,
      usages: total,
      detail: { tapee: u.tapee, modele: u.modele, etape: u.etape },
      joursDepuis: u.dernier > 0 ? Math.floor((maintenant - u.dernier) / UN_JOUR_MS) : null
    }
  })
  const age = (ligne) => ligne.joursDepuis ?? Number.POSITIVE_INFINITY
  lignes.sort((a, b) => {
    if (age(a) === age(b)) return a.nom.localeCompare(b.nom)
    return age(b) > age(a) ? 1 : -1
  })
  return {
    lignes,
    jamaisInvoquees: lignes.filter((l) => l.usages === 0 && l.contexte !== null),
    contexteTotal: lignes.reduce((somme, l) => somme + (l.contexte ?? 0), 0)
  }
}

export function formaterContexte(jetons) {
  if (jetons === null) return '-'
  return jetons < 20 ? '< 20' : `~${formaterJetons(Math.round(jetons / 10) * 10)}`
}

export function formaterJetons(jetons) {
  if (jetons === null) return '-'
  if (jetons < 1000) return String(jetons)
  if (jetons < 1_000_000) return `${(jetons / 1000).toFixed(1)}k`
  return `${(jetons / 1_000_000).toFixed(1)}M`
}

function formaterAge(jours) {
  if (jours === null) return 'jamais'
  if (jours === 0) return "aujourd'hui"
  return `${jours} ${jours === 1 ? 'jour' : 'jours'}`
}

const colonne = (lignes, entete, cellule) =>
  Math.max(entete.length, ...lignes.map((l) => cellule(l).length))

/** Depuis la racine du dépôt : le chemin court `registry/…` n'y existe pas (/judge conv-1369). */
const REGISTRE_PAR_DEFAUT = '.autowin-data/autowin-os/registry/enablement.v1.json'

/** « 30 skills (2 désactivées) » : `lignes` garde les coupées, pas la liste remise au modèle. */
function effectifDeLaListe(lignes) {
  const actives = lignes.filter((l) => l.contexte !== null).length
  const coupees = lignes.length - actives
  const effectif = `${actives} skill${actives > 1 ? 's' : ''}`
  if (coupees === 0) return effectif
  return `${effectif} (${coupees} désactivée${coupees > 1 ? 's' : ''})`
}

export function formaterRapport(
  { lignes, jamaisInvoquees, contexteTotal },
  registre = REGISTRE_PAR_DEFAUT
) {
  const sortie = ['Skills chargées', '']
  if (lignes.length === 0) return [...sortie, '  (aucune skill chargée)'].join('\n')

  const contexte = (l) => formaterContexte(l.contexte)
  const jetons = (l) => formaterJetons(l.jetons7j)
  const usages = (l) => `${l.usages}×`
  const largeurs = {
    nom: colonne(lignes, 'skill', (l) => l.nom),
    source: colonne(lignes, 'source', (l) => l.source),
    contexte: colonne(lignes, 'contexte', contexte),
    jetons: colonne(lignes, 'jetons 7 j', jetons),
    usages: colonne(lignes, 'usages', usages)
  }
  const rangee = (nom, source, ctx, jts, nb, age) =>
    `  ${nom.padEnd(largeurs.nom)}  ${source.padEnd(largeurs.source)}  ` +
    `${ctx.padStart(largeurs.contexte)}  ${jts.padStart(largeurs.jetons)}  ` +
    `${nb.padStart(largeurs.usages)}  ${age}`

  sortie.push(rangee('skill', 'source', 'contexte', 'jetons 7 j', 'usages', 'dernier usage'))
  for (const l of lignes) {
    sortie.push(
      rangee(l.nom, l.source, contexte(l), jetons(l), usages(l), formaterAge(l.joursDepuis))
    )
  }
  sortie.push(
    '',
    "  contexte = la ligne de la skill dans l'état remis au modèle, à chaque tour",
    "  (tiret = absente de la liste, ne coûte rien ; le SKILL.md entier n'est lu que quand elle est tapée ou choisie par le modèle)",
    '  jetons 7 j = jetons des tours et des étapes de run où la skill a servi, cache compris, 7 derniers jours, ce poste',
    '  usages = fois où elle a servi : tapée ou choisie par le modèle (procédure lue), ou étape de run (sous son brief, SKILL.md non lu)',
    '',
    `  Liste complète : ~${formaterJetons(Math.round(contexteTotal / 10) * 10)} jetons à chaque tour, ${effectifDeLaListe(lignes)}.`,
    ''
  )
  const n = jamaisInvoquees.length
  if (n > 0) {
    const pluriel = n === 1 ? '' : 's'
    sortie.push(
      `${n} skill${pluriel} chargée${pluriel} mais jamais invoquée${pluriel}. ` +
        "Chacune s'ajoute à l'état remis au modèle à chaque tour. " +
        `Pour en couper une : mets-la à false sous "skills" dans ${registre}, ` +
        'ou retire son dossier. Réglages › Skills est en lecture seule.'
    )
  } else if (lignes.every((l) => l.usages > 0)) {
    sortie.push('Toutes les skills chargées ont servi au moins une fois.')
  }
  return sortie.join('\n')
}

/** Rang de la racine = origine de la skill : dépôt d'abord, puis la racine Autowin du poste. */
function sourceDe(id, racines) {
  const rang = racines.findIndex((r) => fs.existsSync(path.join(r, id, 'SKILL.md')))
  return rang > 0 ? 'poste' : 'kit'
}

/** `--data --json` n'a pas de valeur : l'option suivante n'est pas un chemin (/judge conv-1369). */
export function valeurDOption(argv, nom, defaut) {
  const i = argv.indexOf(nom)
  const valeur = i >= 0 ? argv[i + 1] : undefined
  return valeur && !valeur.startsWith('--') ? valeur : defaut
}

export function executer(argv, ecrire = console.log) {
  const data = path.resolve(
    valeurDOption(argv, '--data', path.join(RACINE, '.autowin-data', 'autowin-os'))
  )
  const conversations = lireCorpus(data)
  if (conversations.length === 0) {
    console.error(
      `Aucune conversation lisible sous ${data} : rapport refusé, tout paraîtrait inutilisé.`
    )
    return 2
  }
  // Depuis un autre dossier, `nativeSkills` ne trouverait pas le kit du dépôt.
  process.env.AUTOWIN_SKILLS_ROOT ??= path.join(RACINE, 'skills')
  const racines = skillRoots()
  const skills = nativeSkills(data).map((s) => ({ ...s, source: sourceDe(s.id, racines) }))
  const maintenant = Date.now()
  const usages = mesurerUsages({ data, noms: skills.map((s) => s.id), conversations, maintenant })
  const rapport = construireRapport({ skills, usages, maintenant })
  const registre = path
    .relative(RACINE, path.join(data, 'registry', 'enablement.v1.json'))
    .replaceAll('\\', '/')
  ecrire(
    argv.includes('--json') ? JSON.stringify(rapport, null, 2) : formaterRapport(rapport, registre)
  )
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = executer(process.argv.slice(2))
}
