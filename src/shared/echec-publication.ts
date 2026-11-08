/**
 * Pourquoi un envoi vers le dépôt distant n'est pas parti, dit en mots courants.
 *
 * Une seule lecture pour les deux endroits où l'utilisateur regarde : la réponse du run dans son fil,
 * et le panneau Git. Le texte du garde-fou de noms internes contient un chemin et des termes réservés :
 * on n'en reprend jamais la forme, seulement la nature du refus.
 */

export interface RefusDePublication {
  /** « Envoi refusé » : une règle a arrêté l'envoi. « Envoi échoué » : le dépôt a renvoyé une erreur. */
  titre: 'Envoi refusé' | 'Envoi échoué'
  /** Ce qui a été refusé, sans point final. */
  raison: string
  /** Ce que l'utilisateur fait pour débloquer, en une phrase. */
  action: string
}

/** Une cause reprise d'une erreur brute tient en une ligne : au-delà, le fil et le panneau débordent. */
const LONGUEUR_MAX_CAUSE = 240

const MOTIFS_SKIPPED: Record<string, Omit<RefusDePublication, 'titre'>> = {
  'protected-branch': {
    raison: 'la branche visée est protégée (main ou master)',
    action: 'Vérifie la branche de publication, puis relance /git.'
  },
  'invalid-publication-range': {
    raison: "le commit à publier n'a pas pu être identifié sans ambiguïté",
    action: "Relance /git ; si ça revient, regarde l'historique de la branche."
  },
  'concurrent-commits': {
    raison: "l'historique à publier contient un commit qui n'est pas celui de ce travail",
    action: "Regarde l'historique de la branche, puis relance /git."
  },
  'tests-rouges': {
    raison: 'les tests des fichiers de ce tour sont rouges',
    action: 'Corrige les tests en échec, puis relance /git.'
  },
  'typage-rouge': {
    raison: 'le typage de ce qui part est rouge',
    action: 'Corrige les erreurs de typage (npm run typecheck), puis relance /git.'
  },
  // La porte d'un fil en copie (tour de chat) : elle refuse un conflit avec la base, une base absente
  // ou une erreur git. L'attente (`porte-en-attente`) n'est pas un refus : elle se réessaie seule.
  'porte-refusee': {
    raison:
      "la copie de ce fil n'a pas pu entrer dans main (conflit avec la base, base absente ou erreur git)",
    action: 'Règle la cause (fichiers en conflit, base du fil), puis relance /git.'
  },
  // Dépôt qui n'est pas celui d'Autowin : la clôture n'envoie rien ; le commit local reste.
  'depot-tiers': {
    raison: "ce dépôt n'est pas celui d'Autowin, donc rien n'a été envoyé vers son serveur",
    action: "Le commit reste sur ce poste. Tu l'envoies toi-même si tu le veux."
  }
}

/** Le garde-fou de noms internes (`scripts/separation-avant-push.mjs`, `.githooks/pre-push`). */
const RE_GARDE_NOMS = /d[eé]p[oô]t public/i
/** Le garde-fou ne peut pas tourner : sans node, il ne contrôle rien, donc il refuse. */
const RE_NODE_ABSENT = /node est introuvable/i

function refusDUneErreur(texte: string): RefusDePublication {
  if (RE_NODE_ABSENT.test(texte)) {
    return {
      titre: 'Envoi refusé',
      raison:
        'le contrôle des noms internes ne peut pas tourner : node est introuvable sur ce poste',
      action: 'Installe Node ou corrige le PATH, puis relance /git.'
    }
  }
  if (RE_GARDE_NOMS.test(texte)) {
    return {
      titre: 'Envoi refusé',
      raison:
        "ce qui part contient un élément réservé à l'entreprise (nom, terme ou fichier privé)",
      action:
        "Retire-le, commite la correction, puis relance /git. L'élément reste dans l'historique : le réécrire demande ton accord."
    }
  }
  // La ligne de commande git (« Command failed: … ») n'apprend rien à l'utilisateur : on garde la cause.
  const cause =
    texte
      .split(/\r?\n/u)
      .map((ligne) => ligne.trim())
      .find((ligne) => ligne && !/^Command failed:/iu.test(ligne)) ?? ''
  return {
    titre: 'Envoi échoué',
    raison: cause ? cause.slice(0, LONGUEUR_MAX_CAUSE) : 'cause non précisée',
    action: 'Relance /git une fois la cause réglée.'
  }
}

/**
 * Le refus d'un compte rendu de publication, ou `undefined` si l'envoi est parti ou n'avait rien à
 * envoyer. Un « pas de distant », un « rien à publier » ou un travail seulement commité ne sont pas des
 * refus : les dire dans le fil ferait du bruit à chaque tour.
 */
export function refusDePublication(resultat: unknown): RefusDePublication | undefined {
  if (typeof resultat !== 'object' || resultat === null) return undefined
  const { status, reason, detail, error } = resultat as {
    status?: unknown
    reason?: unknown
    detail?: unknown
    error?: unknown
  }
  if (status === 'failed') return refusDUneErreur(typeof error === 'string' ? error : '')
  if (status !== 'skipped' || typeof reason !== 'string') return undefined
  if (reason === 'secret-detected') {
    // Le motif seul : la valeur du secret ne sort jamais.
    const nature = typeof detail === 'string' && detail.trim() ? ` (${detail.trim()})` : ''
    return {
      titre: 'Envoi refusé',
      raison: `un secret est dans ce qui part${nature}`,
      action:
        "Retire le secret, commite la correction, puis relance /git. Il reste dans l'historique : le réécrire demande ton accord."
    }
  }
  // fix-ok: cause mesurée — le contrôle des noms sur un commit de fin de run n'avait aucune phrase : le
  // refus restait muet dans le fil et sur le Board. Le détail (terme, chemin) ne sort jamais.
  if (reason === 'separation-entreprise') {
    return {
      titre: 'Envoi refusé',
      raison:
        "un élément réservé à l'entreprise (nom, terme ou fichier privé) était dans un commit à créer : ce commit n'a pas été fait, rien n'est parti",
      action: 'Retire-le du travail, puis relance /git.'
    }
  }
  const motif = MOTIFS_SKIPPED[reason]
  return motif ? { titre: 'Envoi refusé', ...motif } : undefined
}

/** La phrase d'un refus, pour le fil : ce qui s'est passé, puis ce qu'il faut faire. */
export function phraseDuRefus(refus: RefusDePublication): string {
  return `⛔ ${refus.titre} : ${refus.raison}. ${refus.action}`
}

/**
 * Reconnaît une phrase de refus (`phraseDuRefus`) à son préfixe : le Board la relit depuis le fil, sans
 * la refaire. Le préfixe vit ici, à côté de la phrase qu'il désigne.
 */
const LIGNE_DU_REFUS = /^⛔ (?:Envoi refusé|Envoi échoué) : [^\r\n]*/mu

/**
 * La phrase d'un refus (`phraseDuRefus`) écrite dans un texte du fil, ligne entière. Le Board la relit
 * ainsi sans la refaire : la réponse d'un run la porte après son bandeau de commit, pas en tête.
 */
export function phraseDuRefusDans(texte: string): string | undefined {
  return LIGNE_DU_REFUS.exec(texte)?.[0]
}

/** Vrai si le texte porte une phrase de refus. Le préfixe vit à côté de la phrase qu'il désigne. */
export function estUnRefusDePublication(texte: string): boolean {
  return phraseDuRefusDans(texte) !== undefined
}

/**
 * Un envoi parti, avec une réserve à lire : le contrôle des noms n'a pas pu tourner pour le profil,
 * ou le commit de rattachement a été refusé et la branche locale n'a pas été rattachée. Ce n'est pas un
 * refus : l'envoi est bien parti. `undefined` pour un envoi sans réserve.
 */
export function avertissementDePublication(resultat: unknown): string | undefined {
  if (typeof resultat !== 'object' || resultat === null) return undefined
  const { status, rejoue } = resultat as { status?: unknown; rejoue?: unknown }
  if (status !== 'pushed' || typeof rejoue !== 'object' || rejoue === null) return undefined
  const { controleNonFait, rattachementRefuse, rattachementSansControle } = rejoue as {
    controleNonFait?: unknown
    rattachementRefuse?: unknown
    rattachementSansControle?: unknown
  }
  if (controleNonFait === true) {
    return "⚠️ Publié sans contrôle des noms d'entreprise : un profil d'entreprise de ce poste est mal formé. Corrige-le : le pré-envoi refuse tant qu'il ne l'est pas."
  }
  if (rattachementRefuse === true) {
    return "⚠️ Publié, mais la branche locale n'a pas été rattachée : le contrôle des noms d'entreprise n'a pas validé le commit de rattachement. Retire l'élément réservé s'il y en a un, puis relance /git."
  }
  if (rattachementSansControle === true) {
    return '⚠️ Publié, mais la branche locale n’a pas été rattachée : le contrôle des noms d’entreprise n’a pas pu tourner sur le commit de rattachement. Relance /git.'
  }
  return undefined
}

/**
 * La publication du projet doit être rejouée : l'erreur porte le compte rendu, pour que la réponse du
 * run dise pourquoi l'envoi n'est pas parti (le rejeu, lui, reste celui du coordinateur).
 */
export class PublicationARejouer extends Error {
  readonly project: unknown
  constructor(project: unknown) {
    super(`Publication projet distante a rejouer: ${JSON.stringify(project)}`)
    this.name = 'PublicationARejouer'
    this.project = project
  }
}
