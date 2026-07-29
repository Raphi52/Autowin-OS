import { isAbsolute, relative, resolve } from 'node:path'

/**
 * COMMANDE `edit_file` — le « chemin du milieu » entre parler et orchestrer.
 *
 * Pourquoi (2026-07-28) : Autowin n'avait que deux regimes. Pour « renomme cette variable », il
 * lançait scout/frame/build/juge. C'est ce qui rendait le travail lourd la-bas et fluide ici : non
 * pas la qualite du modele, mais l'echelle du geste face a l'echelle de la tache.
 *
 * C'est le SEUL point de la journee qui RETIRE un garde-fou (ecrire sans juge). Il n'est donc
 * legitime que parce que l'agent sait desormais VERIFIER (commande `verify`) ce qu'il vient d'ecrire.
 * Toutes les bornes vivent ici, dans une decision PURE et testee — jamais dans un outil du CLI, dont
 * les patterns d'autorisation ont ete mesures INOPERANTS le meme jour (`Bash(npm test)` laissait
 * passer `echo`).
 *
 * Bornes, chacune couverte par un test de refus :
 *   1. le fichier reste DANS le workspace (traversee `..` et chemins absolus exterieurs refuses) ;
 *   2. jamais `.git/` (corromprait le depot), ni un fichier de secrets ;
 *   3. remplacement d'une chaine EXACTE, pas de contenu libre (on ne peut pas ecraser un fichier) ;
 *   4. l'ancienne chaine doit etre presente et UNIQUE (une correspondance ambigue est refusee) ;
 *   5. un seul fichier par appel.
 */

export type EditDecision =
  | { allowed: true; absolutePath: string; relativePath: string; oldText: string; newText: string }
  | { allowed: false; reason: string }

/** Chemins qu'un agent ne doit jamais reecrire, meme dans le workspace. */
const FORBIDDEN_SEGMENTS = ['.git', 'node_modules', 'dist', 'out']
const FORBIDDEN_FILES = [
  '.env',
  'auth.json',
  'settings.json',
  'settings.local.json',
  'credentials.json',
  'id_rsa'
]

function isForbidden(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase()
  const segments = normalized.split('/')
  for (const segment of FORBIDDEN_SEGMENTS) {
    if (segments.includes(segment)) return `dossier protégé : ${segment}`
  }
  const fileName = segments[segments.length - 1] ?? ''
  for (const forbidden of FORBIDDEN_FILES) {
    if (fileName === forbidden || fileName.endsWith(`.${forbidden}`)) {
      return `fichier sensible : ${fileName}`
    }
  }
  return undefined
}

/**
 * Decide si une edition est recevable. `readFile` est injecte pour rester pur et testable ; il rend
 * `null` quand le fichier n'existe pas (creer un fichier n'est PAS du ressort de cette commande).
 */
export function decideEdit(
  input: { path?: unknown; oldText?: unknown; newText?: unknown },
  workspace: string | undefined,
  readFile: (absolutePath: string) => string | null
): EditDecision {
  if (!workspace || !workspace.trim()) {
    return { allowed: false, reason: 'aucun workspace résolu' }
  }
  if (typeof input.path !== 'string' || !input.path.trim()) {
    return { allowed: false, reason: 'chemin de fichier manquant' }
  }
  if (typeof input.oldText !== 'string' || input.oldText === '') {
    // Interdire la chaine vide est essentiel : elle « correspondrait » partout.
    return { allowed: false, reason: 'texte à remplacer manquant (une chaîne vide est refusée)' }
  }
  if (typeof input.newText !== 'string') {
    return { allowed: false, reason: 'texte de remplacement manquant' }
  }
  if (input.oldText === input.newText) {
    return { allowed: false, reason: 'aucun changement demandé' }
  }

  // 1. Confinement au workspace. `resolve` neutralise les `..` ; `relative` prouve l'appartenance.
  const absolutePath = isAbsolute(input.path)
    ? resolve(input.path)
    : resolve(workspace, input.path)
  const relativePath = relative(resolve(workspace), absolutePath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return { allowed: false, reason: 'chemin hors du workspace' }
  }

  // 2. Zones interdites.
  const forbidden = isForbidden(relativePath)
  if (forbidden) return { allowed: false, reason: forbidden }

  // 3-4. Le fichier doit exister, et la correspondance doit etre unique.
  const content = readFile(absolutePath)
  if (content === null) {
    return { allowed: false, reason: 'fichier inexistant (cette commande ne crée pas de fichier)' }
  }
  const occurrences = content.split(input.oldText).length - 1
  if (occurrences === 0) {
    return { allowed: false, reason: 'texte à remplacer introuvable dans le fichier' }
  }
  if (occurrences > 1) {
    return {
      allowed: false,
      reason: `texte présent ${occurrences} fois — ambigu, précise un extrait unique`
    }
  }

  return {
    allowed: true,
    absolutePath,
    relativePath: relativePath.replace(/\\/g, '/'),
    oldText: input.oldText,
    newText: input.newText
  }
}

/** Diff minimal, lisible dans le fil : ce qui part, ce qui arrive. */
export function editDiff(oldText: string, newText: string): string {
  const removed = oldText.split('\n').map((line) => `- ${line}`)
  const added = newText.split('\n').map((line) => `+ ${line}`)
  return [...removed, ...added].join('\n')
}

/** Applique le remplacement UNIQUE déjà validé. Pur : rend le nouveau contenu. */
export function applyEdit(content: string, oldText: string, newText: string): string {
  const index = content.indexOf(oldText)
  if (index < 0) return content
  return content.slice(0, index) + newText + content.slice(index + oldText.length)
}
