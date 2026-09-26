/**
 * MOT DE PASSE DE PRODUCTION — la porte que le modèle ne peut pas ouvrir seul.
 *
 * DEMANDE DE L'UTILISATEUR (2026-09-16) : « je veux un système de password que je dois rentrer dans
 * Autowin OS au moment où il doit faire une requête en prod ».
 *
 * CE QUE ÇA CHANGE PAR RAPPORT À `prod-guard.ts`. Le classifieur dit SI une cible est de la
 * production. Il ne dit pas QUI autorise. Ici, l'autorisation vient d'un secret que seul l'utilisateur
 * connaît, saisi à l'instant du geste. Le modèle ne peut pas s'autoriser en l'écrivant : il ne
 * connaît pas la phrase, et l'empreinte stockée ne permet pas de la retrouver.
 *
 * LE SECRET N'EST JAMAIS GARDÉ EN CLAIR. On stocke une empreinte `scrypt` avec un sel aléatoire par
 * installation. Les paramètres sont ceux recommandés par l'OWASP Password Storage Cheat Sheet pour
 * scrypt (N = 2^17, r = 8, p = 1) — source :
 * https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 * La comparaison passe par `timingSafeEqual` : une comparaison `===` sur des chaînes fuit la
 * longueur du préfixe correct par son temps d'exécution.
 *
 * LA PHRASE NE TRANSITE PAS PAR LE MODÈLE, ET C'EST LA PROPRIÉTÉ CENTRALE. Elle entre par l'écran de
 * l'utilisateur et meurt dans ce module. Aucune fonction d'ici ne rend la phrase, ne la journalise,
 * ne la met dans un message d'erreur ni dans un verdict. Un système où le modèle « demande le mot de
 * passe dans le chat » serait strictement inutile : le secret se retrouverait dans l'historique de
 * conversation, donc dans le contexte du modèle au tour suivant.
 *
 * LE JETON EST BORNÉ TROIS FOIS, parce qu'une autorisation qui traîne est une autorisation volée :
 *   1. À UNE CIBLE ET UNE OPÉRATION. Autoriser un UPDATE sur `RIG_AMIENS` n'autorise rien d'autre.
 *   2. DANS LE TEMPS. Cinq minutes par défaut. Au-delà, il faut ressaisir.
 *   3. À UN SEUL USAGE. Consommé, il est mort. Sinon une boucle du modèle rejouerait le même jeton.
 *
 * LES ÉCHECS SONT FREINÉS. Cinq tentatives fausses verrouillent la porte quinze minutes. Ce n'est pas
 * pour le modèle — qui ne devinera pas une phrase — mais pour quiconque a la main sur le poste.
 *
 * L'HORLOGE EST INJECTÉE (`maintenant`). Sans cela, l'expiration et le verrouillage ne seraient pas
 * testables autrement qu'en attendant réellement cinq minutes.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

/** Paramètres scrypt, alignés sur la recommandation OWASP citée en en-tête. */
const SCRYPT_N = 131072
const SCRYPT_R = 8
const SCRYPT_P = 1
const LONGUEUR_CLE = 32
/** `scryptSync` refuse de travailler si N * r * 128 dépasse `maxmem` — il faut donc le relever. */
const SCRYPT_MAXMEM = 256 * SCRYPT_N * SCRYPT_R

/** Durée de vie d'une autorisation. Assez pour exécuter le geste, trop peu pour être oubliée. */
export const DUREE_JETON_MS = 5 * 60 * 1000
/** Tentatives fausses tolérées avant verrouillage. */
export const TENTATIVES_AVANT_VERROU = 5
/** Durée du verrouillage après trop d'échecs. */
export const DUREE_VERROU_MS = 15 * 60 * 1000

/**
 * UNE PHRASE TROP COURTE NE PROTÈGE RIEN. Ce plancher vaut à la DÉFINITION du secret, jamais à la
 * vérification : refuser une saisie courte à la vérification révélerait la longueur du vrai secret.
 */
export const LONGUEUR_MINIMALE_PHRASE = 12

/** L'empreinte stockée. Aucun champ ne permet de retrouver la phrase. */
export interface EmpreintePhrase {
  algorithme: 'scrypt'
  sel: string
  empreinte: string
  /** Quand la phrase a été définie, en millisecondes — utile pour savoir si elle date. */
  definieLe: number
}

/** Ce que l'appelant veut faire, et sur quoi. Le jeton est lié exactement à ce couple. */
export interface Demande {
  /** La cible, telle que `prod-guard.ts` l'a classée (ex. `base:RIG_AMIENS`). */
  cible: string
  /** L'opération, nommée par l'appelant (ex. `sql-write`, `deploiement`). */
  operation: string
}

export interface Jeton {
  valeur: string
  cible: string
  operation: string
  expireLe: number
}

export type ResultatOuverture =
  { accorde: true; jeton: Jeton } | { accorde: false; motif: string; verrouilleJusqua?: number }

export type ResultatConsommation = { autorise: true } | { autorise: false; motif: string }

/**
 * DÉFINIT LA PHRASE. Appelée une fois, depuis l'écran de réglages — jamais par le modèle.
 * Lève plutôt que de rendre un objet abîmé : une empreinte silencieusement invalide donnerait une
 * porte qui refuse tout, sans dire pourquoi.
 */
export function definirPhrase(phrase: string, maintenant: number = Date.now()): EmpreintePhrase {
  if (typeof phrase !== 'string' || phrase.length < LONGUEUR_MINIMALE_PHRASE) {
    throw new Error(
      `La phrase de passe doit faire au moins ${LONGUEUR_MINIMALE_PHRASE} caractères.`
    )
  }
  const sel = randomBytes(16).toString('hex')
  return {
    algorithme: 'scrypt',
    sel,
    empreinte: deriver(phrase, sel),
    definieLe: maintenant
  }
}

function deriver(phrase: string, sel: string): string {
  return scryptSync(phrase.normalize('NFKC'), sel, LONGUEUR_CLE, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  }).toString('hex')
}

/**
 * COMPARE UNE SAISIE À L'EMPREINTE. Rend un simple booléen : aucun détail sur ce qui a échoué ne doit
 * sortir d'ici. La comparaison est à temps constant sur des tampons de même longueur.
 */
export function phraseCorrespond(phrase: string, empreinte: EmpreintePhrase | undefined): boolean {
  if (!empreinte || empreinte.algorithme !== 'scrypt') return false
  if (typeof phrase !== 'string' || phrase.length === 0) return false
  let candidat: Buffer
  try {
    candidat = Buffer.from(deriver(phrase, empreinte.sel), 'hex')
  } catch {
    return false
  }
  const attendu = Buffer.from(empreinte.empreinte, 'hex')
  if (candidat.length !== attendu.length || attendu.length === 0) return false
  return timingSafeEqual(candidat, attendu)
}

/**
 * LE COFFRE — il détient les jetons vivants et le compteur d'échecs.
 *
 * Il vit dans le processus principal et n'est JAMAIS sérialisé : un jeton qui survivrait à un
 * redémarrage serait une autorisation que l'utilisateur ne sait plus avoir donnée. Tout est perdu à
 * la fermeture, et c'est voulu.
 */
export class CoffreAutorisationProd {
  private readonly jetons = new Map<string, Jeton>()
  private echecs = 0
  private verrouilleJusqua = 0

  constructor(private readonly empreinte: EmpreintePhrase | undefined) {}

  /** `true` si aucune phrase n'a encore été définie — la porte refuse alors tout. */
  get phraseAbsente(): boolean {
    return this.empreinte === undefined
  }

  /**
   * OUVRE POUR UN GESTE PRÉCIS. La phrase saisie entre ici et n'en ressort sous aucune forme.
   */
  ouvrir(phrase: string, demande: Demande, maintenant: number = Date.now()): ResultatOuverture {
    if (maintenant < this.verrouilleJusqua) {
      return {
        accorde: false,
        motif: 'Trop de tentatives : la porte est verrouillée.',
        verrouilleJusqua: this.verrouilleJusqua
      }
    }
    if (!this.empreinte) {
      return {
        accorde: false,
        motif: "Aucune phrase de passe n'est définie : aucun geste de production n'est possible."
      }
    }
    const cible = (demande?.cible ?? '').trim()
    const operation = (demande?.operation ?? '').trim()
    if (cible.length === 0 || operation.length === 0) {
      return { accorde: false, motif: 'Cible ou opération manquante : rien à autoriser.' }
    }
    if (!phraseCorrespond(phrase, this.empreinte)) {
      this.echecs += 1
      if (this.echecs >= TENTATIVES_AVANT_VERROU) {
        this.verrouilleJusqua = maintenant + DUREE_VERROU_MS
        this.echecs = 0
        return {
          accorde: false,
          motif: 'Trop de tentatives : la porte est verrouillée.',
          verrouilleJusqua: this.verrouilleJusqua
        }
      }
      return { accorde: false, motif: 'Phrase de passe incorrecte.' }
    }
    this.echecs = 0
    const jeton: Jeton = {
      valeur: randomUUID(),
      cible,
      operation,
      expireLe: maintenant + DUREE_JETON_MS
    }
    this.jetons.set(jeton.valeur, jeton)
    return { accorde: true, jeton }
  }

  /**
   * CONSOMME LE JETON AU MOMENT DU GESTE. Il est retiré AVANT toute vérification de cible : un jeton
   * présenté pour autre chose que ce qu'il couvre est brûlé, pas rendu réutilisable.
   */
  consommer(
    valeur: string,
    demande: Demande,
    maintenant: number = Date.now()
  ): ResultatConsommation {
    const jeton = typeof valeur === 'string' ? this.jetons.get(valeur) : undefined
    if (!jeton) return { autorise: false, motif: 'Autorisation inconnue ou déjà utilisée.' }
    this.jetons.delete(valeur)
    if (maintenant >= jeton.expireLe) {
      return { autorise: false, motif: 'Autorisation expirée : ressaisir la phrase de passe.' }
    }
    if (jeton.cible !== (demande?.cible ?? '').trim()) {
      return { autorise: false, motif: 'Autorisation donnée pour une autre cible.' }
    }
    if (jeton.operation !== (demande?.operation ?? '').trim()) {
      return { autorise: false, motif: 'Autorisation donnée pour une autre opération.' }
    }
    return { autorise: true }
  }

  /** Nombre de jetons encore vivants — pour l'affichage, jamais pour décider. */
  jetonsVivants(maintenant: number = Date.now()): number {
    let vivants = 0
    for (const jeton of this.jetons.values()) if (maintenant < jeton.expireLe) vivants += 1
    return vivants
  }
}
