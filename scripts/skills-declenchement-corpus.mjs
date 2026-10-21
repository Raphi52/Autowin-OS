/**
 * LE JEU DE DEMANDES RÉELLES qui sert à vérifier qu'une skill se déclenche sur les bonnes demandes.
 *
 * Pourquoi (conv-1036, 2026-10-21, piste 3 du scout de skills) : « une skill jamais exercée est une
 * hypothèse » (skills/graft/SKILL.md:55), et l'historique du poste porte déjà les étiquettes —
 * chaque message que l'utilisateur a COMMENCÉ par `/heal`, `/salvage`… dit quelle skill il voulait.
 * Ce script en tire le jeu : le texte SANS sa commande, étiqueté par la skill.
 *
 * Il ne mesure PAS le déclenchement : sans `/` en tête, c'est le modèle du chat qui choisit une skill
 * dans le catalogue des descriptions (aucun aiguillage déterministe, src/main/skill-routing.ts ne
 * reconnaît que la commande explicite). La mesure coûte donc un tour de chat par demande. Ce jeu
 * dit, gratuitement, sur quoi elle peut porter : une skill invoquée 60 fois toujours SANS texte
 * (« /salvage » seul) ne peut pas être évaluée sur son déclencheur.
 *
 * Même règle d'invocation que l'app : la commande EN TÊTE du message (`invokedSkillId`,
 * src/main/skill-pipeline.ts) ; une mention au fil du texte n'en est pas une. Mêmes racines de
 * skills que `skillRoots()` (src/main/native-registry.ts) : `skills/` et
 * `%LOCALAPPDATA%/autowin-os/skills`.
 *
 * Lit l'instantané `conversations.json` et ses archives (scripts/conversations-sur-disque.mjs) ; les
 * tout derniers messages, encore dans le seul journal, n'y sont pas.
 * Le jeu contient des messages de l'utilisateur : il s'écrit sous `.autowin-data/`, ignoré par git.
 *
 * Usage : node scripts/skills-declenchement-corpus.mjs [--conversations <fichier>]
 *           [--skills <dossier>]... [--sortie <fichier.jsonl>]
 * Sortie 0 = jeu écrit ; 2 = conversations absentes.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ajouterArchives, texteDuMessage } from './conversations-sur-disque.mjs'
import { resolveSkillAlias } from '../src/shared/skill-aliases.ts'

/** La règle de `invokedSkillId` (skill-pipeline.ts), plus le texte qui suit la commande. */
const INVOCATION = /^\s*\/([a-z][a-z0-9-]*)\b([\s\S]*)$/i

/**
 * Sous 3 mots, une demande privée de sa commande ne dit plus rien qu'une description puisse
 * reconnaître (« /salvage », « /heal vas-y ») : elle est comptée, pas mise dans le jeu.
 */
const MOTS_MINIMUM = 3
const nombreDeMots = (texte) => (texte.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length

/** Les invocations de skills des messages UTILISATEUR, commande retirée, un exemplaire par texte. */
export function extraireDemandes(conversations, skillsConnues) {
  const parTexte = new Map()
  const parSkill = {}
  const inconnues = {}
  for (const conversation of conversations) {
    for (const message of conversation?.messages ?? []) {
      if (message?.role !== 'user') continue
      const m = INVOCATION.exec(texteDuMessage(message))
      if (!m) continue
      const skill = resolveSkillAlias(m[1].toLowerCase()).toLowerCase()
      if (!skillsConnues.has(skill)) {
        inconnues[skill] = (inconnues[skill] ?? 0) + 1
        continue
      }
      const compte = (parSkill[skill] ??= { invocations: 0, exploitables: 0, sansTexte: 0 })
      compte.invocations += 1
      const demande = m[2].replace(/\s+/g, ' ').trim()
      if (nombreDeMots(demande) < MOTS_MINIMUM) {
        compte.sansTexte += 1
        continue
      }
      const cle = `${skill}\u0000${demande}`
      const deja = parTexte.get(cle)
      if (deja) {
        deja.occurrences += 1
        if (!deja.conversations.includes(conversation.id)) deja.conversations.push(conversation.id)
        continue
      }
      compte.exploitables += 1
      parTexte.set(cle, { skill, demande, occurrences: 1, conversations: [conversation.id] })
    }
  }
  return { demandes: [...parTexte.values()], parSkill, inconnues }
}

/** Les skills présentes sur disque : un dossier qui porte un SKILL.md, comme `scanSkillDirs`. */
export function skillsSurDisque(racines) {
  const noms = new Set()
  for (const racine of racines) {
    let entrees = []
    try {
      entrees = readdirSync(racine, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entrees) {
      if (e.isDirectory() && existsSync(join(racine, e.name, 'SKILL.md')))
        noms.add(e.name.toLowerCase())
    }
  }
  return noms
}

function lireConversations(fichier) {
  const donnees = JSON.parse(readFileSync(fichier, 'utf8'))
  const actives = Array.isArray(donnees) ? donnees : (donnees?.conversations ?? [])
  return [...ajouterArchives(new Map(actives.map((c) => [c.id, c])), fichier).values()]
}

const valeurs = (argv, nom) =>
  argv.flatMap((a, i) => (a === nom && argv[i + 1] ? [argv[i + 1]] : []))

export function principal(argv = process.argv.slice(2), sortie = console.log) {
  const fichier = resolve(
    valeurs(argv, '--conversations')[0] ?? '.autowin-data/autowin-os/conversations.json'
  )
  const racines = valeurs(argv, '--skills')
  if (!racines.length) {
    racines.push(resolve('skills'))
    if (process.env.LOCALAPPDATA)
      racines.push(join(process.env.LOCALAPPDATA, 'autowin-os', 'skills'))
  }
  const destination = resolve(
    valeurs(argv, '--sortie')[0] ?? '.autowin-data/autowin-os/skills-declenchement-corpus.jsonl'
  )
  if (!existsSync(fichier)) {
    sortie(`Conversations absentes : ${fichier}`)
    return 2
  }
  const conversations = lireConversations(fichier)
  const { demandes, parSkill, inconnues } = extraireDemandes(
    conversations,
    skillsSurDisque(racines)
  )
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(
    destination,
    demandes.map((d) => JSON.stringify(d)).join('\n') + (demandes.length ? '\n' : '')
  )

  const l = [
    `## Invocations de skills — ${conversations.length} fils lus (instantané + archives)`,
    '',
    '| Skill | Invocations | Textes exploitables | Sans texte |',
    '|---|---|---|---|'
  ]
  for (const [skill, c] of Object.entries(parSkill).sort(
    (a, b) => b[1].invocations - a[1].invocations
  )) {
    l.push(`| \`${skill}\` | ${c.invocations} | ${c.exploitables} | ${c.sansTexte} |`)
  }
  const absentes = Object.entries(inconnues).sort((a, b) => b[1] - a[1])
  if (absentes.length) {
    l.push(
      '',
      `Commandes sans skill sur disque : ${absentes.map(([s, n]) => `/${s}×${n}`).join(', ')}`
    )
  }
  l.push(
    '',
    `Jeu écrit : ${destination} (${demandes.length} demandes, commande retirée).`,
    'Mesurer le déclenchement = rejouer chaque demande SANS sa commande et lire quelle skill le modèle ' +
      'charge (« Skill chargée » dans le fil) : un tour de chat payant par demande.'
  )
  sortie(l.join('\n'))
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(principal())
}
