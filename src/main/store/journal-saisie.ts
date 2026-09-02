import { appendFileSync, existsSync, readFileSync } from 'node:fs'
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

/**
 * RATTACHEMENT D'UNE SAISIE A SON TOUR.
 *
 * La saisie est ecrite AVANT que le tour existe — c'est tout l'interet du filet (un texte qui ne
 * produit jamais de tour reste retrouvable). Elle ne peut donc PAS porter `turnId` a l'ecriture.
 * Le lien est pose APRES, quand le controleur de chat cree le tour, par une ligne SUPPLEMENTAIRE :
 * le journal reste strictement en ajout (aucune reecriture, aucun risque de perdre une ligne sur
 * une ecriture concurrente) et la forme des lignes deja ecrites ne bouge pas.
 */
export interface RattachementDeSaisie {
  schema: 'autowin.saisie-tour/v1'
  ts: number
  conversationId: string
  turnId: string
  /** Horodatage de la saisie rattachee — la cle de jointure, exacte et non approximative. */
  saisieTs: number
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

/**
 * Relit les saisies d'UNE conversation. Aucun lecteur n'existait : le texte tapé pendant un tour
 * (voie `orientation`) était écrit puis jamais consulté, alors que c'est là que vit la correction
 * donnée en cours de route — la matière même d'une rétrospective.
 *
 * Rend une liste vide sur toute défaillance : ce journal est une trace de dernier recours, le lire
 * ne doit jamais faire échouer l'appelant.
 */
const SEPARATEUR_LIGNE = new RegExp('\r?\n')

export function lireSaisies(
  conversationId: string,
  racine?: string,
  limite = 30
): SaisieJournalisee[] {
  try {
    const chemin = journalSaisiePath(racine)
    if (!existsSync(chemin)) return []
    const saisies = readFileSync(chemin, 'utf8')
      .split(SEPARATEUR_LIGNE)
      .filter((ligne) => ligne.trim())
      .flatMap((ligne) => {
        try {
          const entree = JSON.parse(ligne) as SaisieJournalisee
          // Filtre STRICT sur la conversation ciblée : un dossier de preuve ne doit jamais
          // emporter le texte tapé dans une autre conversation.
          // Filtre STRICT sur le schéma : les lignes de RATTACHEMENT partagent le fichier et la
          // conversation, mais ne portent aucun texte — les rendre ici polluerait tout lecteur.
          if (entree?.schema !== 'autowin.saisie/v1') return []
          return entree?.conversationId === conversationId ? [entree] : []
        } catch {
          return []
        }
      })
    return saisies.slice(-limite)
  } catch {
    return []
  }
}

/**
 * Pose le lien saisie → tour. Rend `false` si aucune saisie de cette conversation ne porte
 * EXACTEMENT ce texte : sans correspondance, un lien serait un alibi, pas une preuve.
 *
 * Best-effort comme le reste du journal : jamais d'exception vers le chemin d'un tour.
 */
export function rattacherSaisieAuTour(
  conversationId: string,
  turnId: string,
  texte: string,
  racine?: string
): boolean {
  try {
    const attendu = texte.trim()
    if (!attendu) return false
    const candidates = lireSaisies(conversationId, racine, 200)
    let cible: SaisieJournalisee | undefined
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (candidates[i]?.texte.trim() === attendu) {
        cible = candidates[i]
        break
      }
    }
    if (!cible) return false
    const lien: RattachementDeSaisie = {
      schema: 'autowin.saisie-tour/v1',
      ts: Date.now(),
      conversationId,
      turnId,
      saisieTs: cible.ts
    }
    appendFileSync(
      journalSaisiePath(racine),
      `${JSON.stringify(lien)}
`,
      'utf8'
    )
    return true
  } catch {
    return false
  }
}

/** Rend le texte qui a produit CE tour, ou `undefined` si aucun lien n'a ete pose. */
export function saisieDuTour(
  conversationId: string,
  turnId: string,
  racine?: string
): SaisieJournalisee | undefined {
  try {
    const chemin = journalSaisiePath(racine)
    if (!existsSync(chemin)) return undefined
    const lignes = readFileSync(chemin, 'utf8')
      .split(SEPARATEUR_LIGNE)
      .filter((ligne) => ligne.trim())
    let saisieTs: number | undefined
    const saisies: SaisieJournalisee[] = []
    for (const ligne of lignes) {
      try {
        const entree = JSON.parse(ligne) as SaisieJournalisee | RattachementDeSaisie
        if (entree?.conversationId !== conversationId) continue
        if (entree.schema === 'autowin.saisie-tour/v1' && entree.turnId === turnId)
          saisieTs = entree.saisieTs
        else if (entree.schema === 'autowin.saisie/v1') saisies.push(entree)
      } catch {
        /* ligne illisible : ignoree, comme partout dans ce journal */
      }
    }
    if (saisieTs === undefined) return undefined
    return saisies.find((saisie) => saisie.ts === saisieTs)
  } catch {
    return undefined
  }
}
