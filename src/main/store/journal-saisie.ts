import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'

/**
 * JOURNAL DES SAISIES — le filet de sécurité du texte tapé par l'utilisateur.
 *
 * Mesure du 2026-09-01 (conv-30) : l'utilisateur a écrit deux messages qui ont disparu de l'écran
 * sans laisser la moindre trace. Les quatre sources de persistance (conversations.json, son journal,
 * causal-trace, prompt-observability) étaient vides. La cause : tant qu'un texte n'a pas produit un
 * TOUR, il ne vit que dans la mémoire volatile du renderer — brouillon du composer
 * (`composerDraftsRef`), file d'attente (`queueRef`) et reçus d'orientation (`directiveReceipts`)
 * sont tous des refs ou des états React, jamais écrits sur disque. Un rechargement de fenêtre, un
 * changement de conversation ou une injection refusée effaçait donc le texte définitivement.
 *
 * Ce journal casse cette classe entière de pertes : le texte est écrit AU MOMENT où il quitte le
 * composer, quelle que soit la voie qu'il emprunte ensuite et quel que soit son sort. Il ne remplace
 * aucune persistance existante — c'est une trace de dernier recours, pas une source de vérité.
 *
 * INVARIANT NON NÉGOCIABLE : écrire ici ne doit JAMAIS empêcher un message de partir. Un disque
 * plein ou un dossier en lecture seule ferait perdre la trace, pas le message — l'inverse serait
 * pire que le défaut qu'on corrige.
 */

/**
 * Par où le texte est parti — deux voies, et deux seulement, parce qu'un texte ne peut quitter le
 * composer que par l'une d'elles. Le distinguer explique POURQUOI une trace n'a pas de tour.
 *
 * La mise en file n'est PAS une troisième voie : elle n'existe que comme repli d'une orientation
 * refusée, déjà journalisée. Lui donner sa propre ligne écrirait deux entrées pour un seul texte —
 * exactement le bruit qui fait douter au moment où l'on cherche à récupérer quelque chose.
 */
export type VoieDeSaisie =
  /** Envoi ordinaire : un tour va être créé, le texte finira dans la conversation. */
  | 'message'
  /** Tapé pendant un tour en cours : ne créera JAMAIS de tour à lui, donc invisible dans l'historique. */
  | 'orientation'

export interface SaisieUtilisateur {
  conversationId: string
  texte: string
  voie: VoieDeSaisie
}

export interface SaisieJournalisee extends SaisieUtilisateur {
  schema: 'autowin.saisie/v1'
  ts: number
}

export function journalSaisiePath(racine?: string): string {
  return join(racine ?? ensureAutowinAppData(), 'saisies-utilisateur.jsonl')
}

/**
 * Écrit la saisie et rend `true` si la trace est bien sur le disque.
 *
 * Rend `false` au lieu de lever : l'appelant est sur le chemin d'envoi d'un message, et aucune
 * défaillance d'écriture ne doit y remonter comme une erreur d'envoi (voir l'invariant ci-dessus).
 */
export function journaliserSaisie(saisie: SaisieUtilisateur, racine?: string): boolean {
  const texte = saisie.texte
  // Un texte vide n'a jamais été perdu : ne pas polluer le journal avec des lignes sans contenu.
  if (!texte.trim()) return false
  const enregistrement: SaisieJournalisee = {
    schema: 'autowin.saisie/v1',
    ts: Date.now(),
    conversationId: saisie.conversationId,
    texte,
    voie: saisie.voie
  }
  try {
    appendFileSync(journalSaisiePath(racine), `${JSON.stringify(enregistrement)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}
