import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * MÉMOIRE DE CE QUI A DÉJÀ ÉTÉ MIGRÉ — pour ne pas refaire au démarrage un travail déjà fait.
 *
 * Mesure du 2026-09-05 (`gels.jsonl`) : « démarrage : construction de la fenêtre » a bloqué
 * l'application pendant 3579 ms, dont 1347 ms dans 283 `readFileSync`. La pile désigne la migration
 * des traces causales : pour CHAQUE conversation (263 sur ce poste), elle relit intégralement la
 * trace causale et le journal de prompts — alors qu'elle est IDEMPOTENTE et déjà passée. Le coût
 * grandit donc à chaque conversation créée, sans que rien de nouveau ne soit produit.
 *
 * On retient ici, par conversation, l'empreinte du journal de prompts déjà migré. Comparer une
 * empreinte coûte un `statSync` — pas la lecture du fichier — et c'est exactement la leçon déjà
 * tirée dans `pruneFinishedTurnJournals` : « l'âge d'abord, la lecture coûte tout le fichier ».
 *
 * DEUX DÉPENDANCES, PAS UNE. Une conversation qui possède ses propres appels natifs ne dépend que
 * de son journal. Une conversation qui n'en a aucun reçoit ses traces du spool natif PARTAGÉ : elle
 * doit donc être reprise dès que ce spool change. C'est pourquoi l'état retient aussi ce fait.
 *
 * Aucun saut dans le doute : état absent, illisible, conversation inconnue → on migre. Sauter à
 * tort ferait disparaître des événements de la chronologie, ce qu'aucun gain de démarrage ne vaut.
 */
export interface EtatMigrationTraces {
  /** Empreinte du spool natif partagé au moment de la dernière migration. */
  spool: string
  conversations: Record<string, { prompts: string; natif: boolean }>
}

/**
 * Empreinte bon marché d'un fichier : taille + date de modification, sans jamais l'ouvrir.
 * `absent` quand il n'existe pas — c'est une information, pas une erreur.
 */
export function empreinteFichier(chemin: string): string {
  try {
    const infos = statSync(chemin)
    return `${infos.size}:${infos.mtimeMs}`
  } catch {
    return 'absent'
  }
}

/** Relit l'état ; `undefined` dès que rien d'exploitable n'est trouvé — jamais un état inventé. */
export function lireEtatMigration(chemin: string): EtatMigrationTraces | undefined {
  try {
    if (!existsSync(chemin)) return undefined
    const brut = JSON.parse(readFileSync(chemin, 'utf8')) as EtatMigrationTraces
    if (!brut || typeof brut !== 'object') return undefined
    if (typeof brut.spool !== 'string' || !brut.conversations) return undefined
    return brut
  } catch {
    return undefined
  }
}

/**
 * Écrit l'état. Best-effort assumé : ce fichier n'est qu'un cache, et une écriture impossible
 * (disque plein, chemin occupé) doit coûter une migration complète au prochain démarrage — jamais
 * un plantage au démarrage.
 */
export function ecrireEtatMigration(chemin: string, etat: EtatMigrationTraces): void {
  try {
    mkdirSync(dirname(chemin), { recursive: true })
    writeFileSync(chemin, JSON.stringify(etat), 'utf8')
  } catch {
    /* cache best-effort : on repaiera la migration, on ne casse pas le démarrage */
  }
}

/** Cette conversation doit-elle être relue et migrée ? En cas de doute : oui. */
export function doitMigrerLaConversation(
  conversationId: string,
  empreintePrompts: string,
  etat: EtatMigrationTraces | undefined,
  empreinteSpool: string
): boolean {
  if (!etat) return true
  const connue = etat.conversations[conversationId]
  if (!connue) return true
  if (connue.prompts !== empreintePrompts) return true
  // Sans appel natif à elle, ses traces viennent du spool partagé : il fait autorité.
  if (!connue.natif && etat.spool !== empreinteSpool) return true
  return false
}
