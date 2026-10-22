/**
 * TITRE D'UN COMMIT AUTOMATIQUE — `type(zone): phrase (conv-NNN)`, la forme qu'exige AGENTS.md.
 *
 * Mesuré le 2026-10-22 (conv-1069) : 125 des 400 derniers commits portaient
 * `auto(conv-N): <100 premiers caractères de la demande>`, dont `auto(conv-1075): vazy` ou
 * `auto(conv-1062): corriges tout` — un historique où l'on ne retrouve plus ce qui a changé. Les
 * deux producteurs (`chat-turn-publication.ts`, `run-autoclose.ts`) partagent cette seule règle.
 *
 * La phrase vient, dans l'ordre : de la 1re action du DERNIER bloc « ✅ Fait » du tour (ce qu'il a
 * réellement fait, `agent-pilot.ts` l'impose en liste numérotée), puis de la 1re ligne de la
 * demande si c'en est une vraie. Sinon, REPLI sur l'ancien format : on n'invente pas un résumé.
 */

export interface EntreeTitreDeCommit {
  /** `conv-NNN` pour un tour de chat, l'identifiant du run sinon. */
  id: string
  demande: string
  /** Texte final du tour : son bloc « ✅ Fait » dit ce qui a été fait. */
  compteRendu?: string
  /** Chemins publiés (relatifs au dépôt) : ils donnent la zone et parfois le type. */
  fichiers?: readonly string[]
  /** Zone quand aucun fichier n'est connu. */
  zoneParDefaut?: string
  /** Texte de l'ancien format quand la demande est vide. */
  repli?: string
}

const LONGUEUR_PHRASE = 72
const MARQUE_FAIT = /✅\s*\**\s*Fait\b/gu
const ELEMENT_DE_LISTE = /^(?:\d+[.)]|[-*•])\s+(.+)$/u
const SUR_LA_LIGNE_DU_FAIT = /^✅\s*\**\s*Fait\**\s*[—:–-]\s*(.+)$/u
const COMMANDE_SLASH = /^\/([\w-]+)\s+/u
/** Un verbe de réparation : le reste est une évolution (`feat`). */
const REPARATION =
  /(?:^|[^\p{L}])(?:corrig|répar|repar|fix|bug|cass|plant|crash|erreur)|marche(?:it)? pas/iu
const EST_UN_TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/u
/** Dossiers qui ne nomment aucune zone : `src/main` ne dit rien de ce qui a changé. */
const DOSSIERS_GENERIQUES = new Set([
  '',
  '.',
  'src',
  'main',
  'renderer',
  'components',
  'shared',
  'preload',
  'lib'
])

function sansMarkdown(texte: string): string {
  return texte
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\*\*|__|`/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** La 1re action du DERNIER « ✅ Fait » : une réponse relancée peut en porter deux. */
function premiereActionFaite(compteRendu: string | undefined): string | undefined {
  if (!compteRendu) return undefined
  const marques = [...compteRendu.matchAll(MARQUE_FAIT)]
  const derniere = marques.at(-1)
  if (derniere?.index === undefined) return undefined
  const [ligneDuFait = '', ...suite] = compteRendu.slice(derniere.index).split(/\r?\n/u)
  const premiere = suite.map((ligne) => ligne.trim()).find(Boolean)
  const element = premiere ? ELEMENT_DE_LISTE.exec(premiere)?.[1] : undefined
  return element ?? SUR_LA_LIGNE_DU_FAIT.exec(ligneDuFait.trim())?.[1]
}

/** Moins de trois mots (« vazy », « go », « corriges tout ») : la demande ne nomme pas le travail. */
function estElliptique(phrase: string): boolean {
  return phrase.split(/\s+/u).filter(Boolean).length < 3
}

function borner(phrase: string): string {
  const propre = phrase.replace(/[\s.:;,]+$/u, '')
  if (propre.length <= LONGUEUR_PHRASE) return propre
  const coupe = propre.slice(0, LONGUEUR_PHRASE - 1)
  const espace = coupe.lastIndexOf(' ')
  return `${(espace > 20 ? coupe.slice(0, espace) : coupe).replace(/[\s.:;,]+$/u, '')}…`
}

function nomDeBase(chemin: string): string {
  const fichier = chemin.split(/[\\/]/u).pop() ?? chemin
  return fichier.split('.')[0] || fichier
}

function zoneDesFichiers(fichiers: readonly string[]): string | undefined {
  if (fichiers.length === 0) return undefined
  const sources = fichiers.filter((f) => !EST_UN_TEST.test(f))
  const retenus = sources.length > 0 ? sources : fichiers
  const noms = new Set(retenus.map(nomDeBase))
  if (noms.size === 1) return [...noms][0]
  const dossiers = retenus.map((f) => f.split(/[\\/]/u).slice(0, -1))
  const communs: string[] = []
  for (let i = 0; dossiers.every((d) => d[i] !== undefined && d[i] === dossiers[0]?.[i]); i++)
    communs.push(dossiers[0]?.[i] ?? '')
  const dernier = communs.at(-1) ?? ''
  return DOSSIERS_GENERIQUES.has(dernier) ? nomDeBase(retenus[0] ?? '') : dernier
}

function typeDuTravail(phrase: string, fichiers: readonly string[]): string {
  if (fichiers.length > 0 && fichiers.every((f) => EST_UN_TEST.test(f))) return 'test'
  if (fichiers.length > 0 && fichiers.every((f) => f.toLowerCase().endsWith('.md'))) return 'docs'
  return REPARATION.test(phrase) ? 'fix' : 'feat'
}

export function titreDeCommitAuto(entree: EntreeTitreDeCommit): string {
  const demande = (
    entree.demande
      .split(/\r?\n/u)
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  ).replace(/\s+/gu, ' ')
  const commande = COMMANDE_SLASH.exec(demande)?.[1]
  const demandeSansCommande = demande.replace(COMMANDE_SLASH, '')
  const faite = premiereActionFaite(entree.compteRendu)
  const phrase = faite
    ? sansMarkdown(faite)
    : !estElliptique(demandeSansCommande)
      ? sansMarkdown(demandeSansCommande)
      : ''
  if (!phrase) {
    // L'ancien format, à l'identique : sans « ✅ Fait » ni vraie demande, rien ne dit le travail.
    const tete =
      entree.demande.replace(/\s+/gu, ' ').trim().slice(0, 100) || entree.repli || 'travail du chat'
    return `auto(${entree.id}): ${tete}`
  }
  const fichiers = entree.fichiers ?? []
  const zone = zoneDesFichiers(fichiers) ?? commande ?? entree.zoneParDefaut ?? 'chat'
  return `${typeDuTravail(phrase, fichiers)}(${zone}): ${borner(phrase)} (${entree.id})`
}
