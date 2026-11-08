// REJOUER LA LIGNE COMPRÉHENSION D'UN VRAI MESSAGE, sur le vrai petit modèle, hors de l'app.
//
// Usage (depuis le dépôt) : npx tsx scripts/rejeu-comprehension.mjs <conv-id> <position> [--sans-images]
//   <position> : celle du message de l'utilisateur à rejouer (outil conversation_read, champ position).
//   --sans-images : même rejeu sans les captures, pour comparer avec le comportement sans elles.
//
// Pourquoi : prouver une correction de la compréhension exige le VRAI modèle sur le VRAI message
// (fil, messages coupés, captures). Le rejeu passe par le code de l'app lui-même — composition de
// l'entrée (`entreeDuPetitModele`) et appel (`lecteurDeDeuxLectures`, profil d'outils compris) —
// et lit ensuite dans le journal brut du CLI ce que le modèle a eu le droit de faire.
//
// Deux réglages que l'app pose et qu'un script doit poser lui-même, sinon faux rouge :
// le compte Claude actif (sinon le compte par défaut, dont le quota peut être épuisé), et
// CLAUDE_CODE_GIT_BASH_PATH (sinon le contrôle des agents bloque chaque outil, Read compris).
// Consomme un peu de quota de l'abonnement Claude. N'écrit rien dans les fils ni dans cost.jsonl.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  autowinAppDataRoot,
  configureAutowinAppDataBase,
  portableAppDataBase
} from '../src/main/app/app-data.ts'
import { loadConversations } from '../src/main/store/conversations-disk.ts'
import { contenusDesToursArretes } from '../src/main/app/reprise-apres-arret.ts'
import {
  CONSIGNE_DEUX_LECTURES,
  contenusDesAvisDeLApp,
  lireLesLectures,
  lectureAAnnoncer,
  annonceDeLaLectureRetenue
} from '../src/main/chat/deux-lectures.ts'
import { lecteurDeDeuxLectures } from '../src/main/chat/deux-lectures-appel.ts'
import { entreeDuPetitModele } from '../src/main/agent-pilot/lectures-du-tour.ts'
import { ProviderRegistry } from '../src/main/providers/registry.ts'
import { ClaudeCliAdapter } from '../src/main/providers/claude.ts'
import { configureClaudeAccountEnv } from '../src/main/providers/claude-accounts.ts'
import { lireArchives, texteDuMessage } from './conversations-sur-disque.mjs'

const [idFil, positionBrute] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const sansImages = process.argv.includes('--sans-images')
const position = Number(positionBrute)
if (!idFil || !Number.isInteger(position)) {
  console.error(
    'Usage : npx tsx scripts/rejeu-comprehension.mjs <conv-id> <position> [--sans-images]'
  )
  process.exit(2)
}

// Les données de l'app, comme en dev : `.autowin-data` à la racine du dépôt réel, même lancé depuis
// une copie de travail d'agent rangée dessous.
configureAutowinAppDataBase(portableAppDataBase(process.cwd(), process.cwd(), false))
const donnees = autowinAppDataRoot()
const fichier = join(donnees, 'conversations.json')
const fil = [...loadConversations(fichier), ...lireArchives(fichier)].find((c) => c.id === idFil)
if (!fil) {
  console.error(`Fil ${idFil} introuvable dans ${fichier} (ni actif, ni archivé).`)
  process.exit(2)
}
const stockes = fil.messages.slice(0, position + 1)
if (stockes.at(-1)?.role !== 'user') {
  console.error(`Le message ${position} de ${idFil} n'est pas un message de l'utilisateur.`)
  process.exit(2)
}

/** Une pièce jointe stockée (nom, type, miniature, chemin de l'original) → celle que reçoit le modèle. */
function pieceJointe(meta) {
  const chemin = meta.artifact?.path
  const original = chemin && existsSync(chemin) ? readFileSync(chemin).toString('base64') : ''
  const kind = meta.kind ?? (String(meta.mimeType).startsWith('image/') ? 'image' : 'file')
  return { ...meta, kind, content: original, size: meta.size ?? original.length }
}

// L'historique tel que le pilote le reçoit : textes, captures, tours coupés et avis de l'app marqués.
const avecTexte = stockes.map((m) => ({ ...m, content: texteDuMessage(m) }))
const arretes = contenusDesToursArretes(avecTexte)
const avis = contenusDesAvisDeLApp(avecTexte)
const historique = avecTexte.map((m) => ({
  role: m.role,
  content: m.content,
  ...(!sansImages && m.attachments?.length ? { attachments: m.attachments.map(pieceJointe) } : {}),
  ...(m.role === 'assistant' && arretes.has(m.content) ? { arrete: true } : {}),
  ...(m.role === 'assistant' && avis.has(m.content) ? { avisDeLApp: true } : {})
}))
const demande = historique.at(-1).content
const { charge, images } = entreeDuPetitModele(historique, demande)

// Les réglages de l'app : modèle des petites tâches, compte Claude actif, Git Bash du CLI.
const lireJson = (nom) => {
  try {
    return JSON.parse(readFileSync(join(donnees, nom), 'utf8'))
  } catch {
    return undefined
  }
}
const binding = lireJson('roles.json')?.petitesTaches ?? {
  provider: 'claude',
  model: 'haiku',
  reasoningEffort: 'low'
}
if (binding.provider !== 'claude') {
  console.error(
    `Rejeu limité au CLI Claude ; le modèle des petites tâches est sur « ${binding.provider} ».`
  )
  process.exit(2)
}
const comptes = lireJson('claude-accounts.json')
const dossierCompte = comptes?.accounts?.find((c) => c.id === comptes.activeId)?.dir
configureClaudeAccountEnv(() => (dossierCompte ? { CLAUDE_CONFIG_DIR: dossierCompte } : {}))
process.env.CLAUDE_CODE_GIT_BASH_PATH ??= [
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
  'C:\\Program Files\\Git\\bin\\bash.exe'
].find((chemin) => existsSync(chemin))

const debut = Date.now()
const lecteur = lecteurDeDeuxLectures({
  registry: new ProviderRegistry().register(new ClaudeCliAdapter()),
  roles: { bindingDesPetitesTaches: () => binding },
  cost: { add: () => undefined }
})
const reponse = await lecteur(CONSIGNE_DEUX_LECTURES, charge, { issue: () => '' }, images)
const issue = lireLesLectures(reponse, demande)

// Ce que le modèle a eu le droit de faire : le journal brut de CET appel (repéré par sa réponse).
const dossierJournaux = join(donnees, 'run-stdout')
const marque = JSON.stringify(reponse.slice(0, 60)).slice(1, -1)
const journal = existsSync(dossierJournaux)
  ? readdirSync(dossierJournaux)
      .map((nom) => join(dossierJournaux, nom))
      .filter((chemin) => statSync(chemin).mtimeMs >= debut)
      .find((chemin) => readFileSync(chemin, 'utf8').includes(marque))
  : undefined
const lignes = journal
  ? readFileSync(journal, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return {}
        }
      })
  : []
const init = lignes.find((e) => e.type === 'system' && e.subtype === 'init')
const fin = lignes.findLast((e) => e.type === 'result')
const lectures = lignes
  .flatMap((e) => (e.type === 'assistant' ? (e.message?.content ?? []) : []))
  .filter((b) => b.type === 'tool_use')
  .map((b) => `${b.name} ${b.input?.file_path ?? ''}`.trim())

console.log(
  JSON.stringify(
    {
      fil: idFil,
      position,
      demande,
      images: images.map((i) => i.name),
      modele: `${binding.model} (${binding.reasoningEffort ?? 'effort par défaut'})`,
      outilsCharges: init?.tools ?? '(journal introuvable)',
      outilsAppeles: lectures,
      refus: fin?.permission_denials ?? [],
      dureeMs: fin?.duration_ms,
      ligneAffichee: issue
        ? annonceDeLaLectureRetenue(lectureAAnnoncer(issue).retenue)
        : '(aucune)',
      reponseBrute: reponse
    },
    null,
    2
  )
)
