/**
 * Ce qu'une demande « lance une conversation test » doit VRAIMENT produire.
 *
 * Defaut vecu conv-71 (2026-09-01), deux fautes dans le meme tour :
 *  1. la conversation creee s'appelait « Test — conversation de verification » alors que
 *     l'utilisateur avait ecrit « lance une conversation test. » — le modele a INVENTE un titre
 *     au lieu de reprendre les mots recus ;
 *  2. l'appel est parti DEUX fois (conv-72 puis conv-73, vide), parce que rien cote code
 *     n'empeche un second envoi identique.
 *
 * Une consigne de prompt ne corrige ni l'un ni l'autre : les deux se tranchent ici, en code
 * deterministe, testable, hors du modele.
 */

/** Titre rendu quand ni l'appelant ni le fil ne fournissent le moindre mot. */
export const TITRE_PAR_DEFAUT = 'Nouvelle conversation'

/** Deux creations identiques a moins de ca d'intervalle sont le MEME geste, envoye deux fois. */
export const FENETRE_DOUBLON_MS = 30_000

/** Longueur max d'un titre repris du fil : au-dela on coupe, on ne colle pas un paragraphe. */
const LONGUEUR_TITRE = 80

const compacter = (texte: string): string => texte.replace(/\s+/g, ' ').trim()

/**
 * Le titre a POSER : celui demande s'il existe, sinon LES MOTS DE L'UTILISATEUR.
 *
 * Jamais une reformulation : c'est exactement ce qui a echoue.
 */
export function titreDeConversationDemandee(
  titreDemande: unknown,
  dernierMessageUtilisateur?: string
): string {
  const explicite = typeof titreDemande === 'string' ? compacter(titreDemande) : ''
  if (explicite) return explicite

  const repris = compacter(
    compacter(dernierMessageUtilisateur ?? '')
      .split('\n')[0]
      .replace(/<system-reminder>[\s\S]*$/i, '')
  )
  if (!repris) return TITRE_PAR_DEFAUT
  return repris.length > LONGUEUR_TITRE
    ? `${repris.slice(0, LONGUEUR_TITRE - 1).trimEnd()}…`
    : repris
}

/** Comparaison de titres tolerante a la casse, aux accents et au point final. */
const empreinteTitre = (titre: string): string =>
  compacter(titre)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.!?…\s]+$/, '')

export type ConversationCandidate = {
  id: string
  title: string
  provider?: string
  createdAt?: number
}

/**
 * La conversation deja creee par CE meme geste, s'il y en a une.
 *
 * Meme titre, meme fournisseur, creee il y a moins de `fenetreMs` : c'est un double envoi, pas
 * une seconde intention. Passe la fenetre, deux conversations homonymes redeviennent legitimes.
 */
export function conversationRecenteEquivalente(
  existantes: readonly ConversationCandidate[],
  p: { title: string; provider: string; maintenant: number; fenetreMs?: number }
): ConversationCandidate | undefined {
  const fenetre = p.fenetreMs ?? FENETRE_DOUBLON_MS
  const cible = empreinteTitre(p.title)
  if (!cible) return undefined
  return existantes
    .filter(
      (c) =>
        empreinteTitre(c.title ?? '') === cible &&
        (c.provider ?? '') === p.provider &&
        typeof c.createdAt === 'number' &&
        p.maintenant - c.createdAt >= 0 &&
        p.maintenant - c.createdAt <= fenetre
    )
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]
}
