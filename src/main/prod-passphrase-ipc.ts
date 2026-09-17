/**
 * LE CANAL DE LA PHRASE DE PASSE — le seul chemin par lequel une autorisation de production entre.
 *
 * POURQUOI CE CANAL EST À PART. La phrase vient de l'ÉCRAN de l'utilisateur, jamais du modèle. C'est
 * exactement ce que l'IPC apporte : le renderer est un canal que le modèle n'atteint pas. Une
 * autorisation demandée dans le chat serait inutile — le secret se retrouverait dans l'historique de
 * conversation, donc dans le contexte du modèle au tour suivant.
 *
 * TROIS RÈGLES TENUES ICI, et chacune a son test :
 *   1. AUCUN CANAL NE REND LA PHRASE. Les réponses ne portent que des booléens, des motifs et un
 *      jeton opaque. Rien de ce qui sort d'ici ne permet de retrouver le secret.
 *   2. L'ÉTAT NE DIT QUE « définie ou non ». Ni longueur, ni empreinte, ni sel : l'écran n'a besoin
 *      que de savoir s'il faut proposer de définir la phrase ou de la saisir.
 *   3. L'EXPÉDITEUR EST VÉRIFIÉ. Le garde de provenance (`assertTrustedRendererSender` dans l'app)
 *      est injecté, parce qu'un canal qui accorde des droits ne doit pas répondre à n'importe quelle
 *      fenêtre.
 *
 * LA CONSOMMATION DU JETON N'EST PAS ICI. Elle appartient au point de passage devant les outils, dans
 * le processus principal. Exposer « consommer » au renderer n'aurait aucun sens : ce n'est pas
 * l'utilisateur qui exécute le geste.
 */
import type { CoffreAutorisationProd, Demande, EmpreintePhrase } from './prod-passphrase'
import { definirPhrase, LONGUEUR_MINIMALE_PHRASE, phraseCorrespond } from './prod-passphrase'

export interface ProdPassphraseIpcRegistrar {
  // La signature d'`invoke` d'Electron est volontairement variadique d'un canal à l'autre.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, handler: (event: any, ...args: any[]) => unknown): void
}

/** Ce que l'écran a besoin de savoir. Volontairement pauvre : aucun détail sur le secret. */
export interface EtatPhraseProd {
  definie: boolean
  /** Quand elle a été définie (0 si inconnue) — pour dire « elle date de… », rien de plus. */
  definieLe: number
  longueurMinimale: number
}

export interface ProdPassphrasePorts {
  /** Lit l'empreinte persistée. `undefined` = aucune phrase, donc production fermée. */
  lireEmpreinte(): EmpreintePhrase | undefined
  /** Écrit la nouvelle empreinte, puis remplace le coffre en service. */
  enregistrerPhrase(phrase: string): void
  /** Le coffre courant, qui détient les jetons vivants. */
  coffre(): CoffreAutorisationProd
  /** Garde de provenance de la fenêtre appelante ; lève si l'expéditeur n'est pas de confiance. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verifierExpediteur(event: any, libelle: string): void
}

export const CANAL_ETAT = 'prod:passphrase:etat'
export const CANAL_DEFINIR = 'prod:passphrase:definir'
export const CANAL_AUTORISER = 'prod:passphrase:autoriser'

export type ReponseDefinition = { ok: true } | { ok: false; erreur: string }

export type ReponseAutorisation =
  | { accorde: true; jeton: string; expireLe: number }
  | { accorde: false; motif: string; verrouilleJusqua?: number }

/**
 * Extrait une phrase d'un argument venu du renderer. Le typage ne protège de rien à cette frontière :
 * ce qui arrive est `unknown` jusqu'à preuve du contraire.
 */
function phraseDe(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur : ''
}

function demandeDe(valeur: unknown): Demande {
  const objet = (valeur ?? {}) as Partial<Demande>
  return {
    cible: typeof objet.cible === 'string' ? objet.cible : '',
    operation: typeof objet.operation === 'string' ? objet.operation : ''
  }
}

export function registerProdPassphraseIpc(
  ipc: ProdPassphraseIpcRegistrar,
  ports: ProdPassphrasePorts
): void {
  ipc.handle(CANAL_ETAT, (event): EtatPhraseProd => {
    ports.verifierExpediteur(event, 'Phrase de passe de production')
    const empreinte = ports.lireEmpreinte()
    return {
      definie: empreinte !== undefined,
      definieLe: empreinte?.definieLe ?? 0,
      longueurMinimale: LONGUEUR_MINIMALE_PHRASE
    }
  })

  /**
   * DÉFINIR OU CHANGER LA PHRASE. Le refus d'une phrase trop courte vient de `definirPhrase`, seule
   * autorité sur cette borne — on ne la recopie pas ici, sinon les deux divergeraient un jour.
   */
  ipc.handle(CANAL_DEFINIR, (event, brut: unknown, brutActuelle: unknown): ReponseDefinition => {
    ports.verifierExpediteur(event, 'Phrase de passe de production')
    const phrase = phraseDe(brut)
    /*
     * CHANGER EXIGE DE CONNAÎTRE LA PHRASE EN COURS. Sans cette vérification, la protection se
     * désactiverait en une ligne : il suffirait de réécrire la phrase par-dessus pour s'ouvrir la
     * production. Le premier réglage, lui, n'a rien à prouver — il n'y a encore rien à protéger.
     */
    const empreinte = ports.lireEmpreinte()
    if (empreinte && !phraseCorrespond(phraseDe(brutActuelle), empreinte)) {
      return { ok: false, erreur: 'Phrase de passe actuelle incorrecte.' }
    }
    try {
      definirPhrase(phrase)
    } catch (erreur) {
      return { ok: false, erreur: erreur instanceof Error ? erreur.message : 'Phrase refusée.' }
    }
    ports.enregistrerPhrase(phrase)
    return { ok: true }
  })

  /**
   * AUTORISER UN GESTE PRÉCIS. Rend le jeton, jamais la phrase — et le jeton ne vaut que pour la
   * cible et l'opération demandées, cinq minutes, une seule fois.
   */
  ipc.handle(CANAL_AUTORISER, (event, brutPhrase: unknown, brutDemande: unknown) => {
    ports.verifierExpediteur(event, 'Phrase de passe de production')
    const resultat = ports.coffre().ouvrir(phraseDe(brutPhrase), demandeDe(brutDemande))
    if (!resultat.accorde) {
      const refus: ReponseAutorisation = { accorde: false, motif: resultat.motif }
      if (resultat.verrouilleJusqua !== undefined) {
        refus.verrouilleJusqua = resultat.verrouilleJusqua
      }
      return refus
    }
    return {
      accorde: true,
      jeton: resultat.jeton.valeur,
      expireLe: resultat.jeton.expireLe
    } satisfies ReponseAutorisation
  })
}
