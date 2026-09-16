/**
 * LE GUICHET — le chaînon qui manquait entre le REFUS et l'ÉCRAN.
 *
 * Avant lui, la porte (`prod-gate.ts`) refusait et rendait un texte au modèle ; l'écran
 * (`ProdPassphraseGate.tsx`) savait demander la phrase, mais personne ne l'ouvrait. L'utilisateur
 * voyait donc un refus sans aucun moyen d'autoriser.
 *
 * CE QU'IL FAIT, ET POURQUOI IL ATTEND. Au refus, le guichet publie la demande vers l'écran puis
 * ATTEND le jeton. Le geste refusé est ensuite REJOUÉ dans le même appel d'outil. L'alternative —
 * rendre le refus au modèle et compter sur lui pour recommencer — remet la décision à la pièce qui
 * n'a justement pas le droit de décider ; et un modèle qui ne recommence pas laisse l'utilisateur
 * devant un écran qui ne sert à rien.
 *
 * L'ATTENTE EST BORNÉE. Sans délai, un outil resterait suspendu indéfiniment si personne ne regarde
 * l'écran. À l'expiration, la demande est retirée et le refus initial vaut : l'absence de réponse
 * n'autorise rien.
 *
 * CE QUI NE PASSE PAS PAR ICI : la phrase. Le guichet ne voit qu'un identifiant de demande et un
 * jeton opaque. Le secret ne quitte jamais le canal `prod:passphrase:*`.
 */
import type { NiveauProtectionProd } from '../shared/prod-protection'

export interface DemandeProdPubliee {
  /** Identifiant de CETTE demande. C'est lui qui revient avec le jeton, jamais la cible seule. */
  id: string
  cible: string
  operation: string
  raison: string
  /**
   * Ce que la fenêtre doit demander : « voulez-vous continuer ? » (`confirmation`) ou la phrase de
   * passe (`phrase`). La fenêtre ne le devine pas — c'est le point de passage qui l'impose.
   */
  niveau: Exclude<NiveauProtectionProd, 'aucun'>
}

/**
 * CE QUI REVIENT DE LA FENÊTRE. Deux formes, jamais mélangées : un simple accord donné par clic, ou
 * un jeton délivré contre la phrase de passe. `undefined` = refus ou délai expiré.
 */
export type ReponseGuichet = { type: 'confirme' } | { type: 'jeton'; valeur: string } | undefined

export interface GuichetProdPorts {
  /** Publie la demande vers l'écran de l'utilisateur. */
  notifier(demande: DemandeProdPubliee): void
  /** Retire la demande de l'écran (jeton reçu, annulation, ou expiration). */
  retirer?(id: string): void
  /** Délai d'attente avant abandon, en millisecondes. */
  delaiMs?: number
  /** Générateur d'identifiants — injectable pour rendre les tests lisibles. */
  identifiant?(): string
}

interface Attente {
  demande: DemandeProdPubliee
  resoudre(reponse: ReponseGuichet): void
  minuteur: ReturnType<typeof setTimeout>
}

let compteur = 0

export class GuichetProd {
  private readonly attentes = new Map<string, Attente>()

  constructor(private readonly ports: GuichetProdPorts) {}

  /** Les demandes encore ouvertes — ce que l'écran affiche s'il se recharge en cours de route. */
  enAttente(): DemandeProdPubliee[] {
    return [...this.attentes.values()].map((attente) => attente.demande)
  }

  /**
   * Publie une demande et attend sa résolution. Rend le jeton, ou `undefined` si l'utilisateur a
   * annulé ou si le délai a expiré — dans les deux cas, le geste reste refusé.
   */
  demander(demande: Omit<DemandeProdPubliee, 'id'>): Promise<ReponseGuichet> {
    const id = this.ports.identifiant?.() ?? `prod-${Date.now()}-${++compteur}`
    const publiee: DemandeProdPubliee = { ...demande, id }
    return new Promise<ReponseGuichet>((resolve) => {
      const minuteur = setTimeout(() => this.clore(id, undefined), this.ports.delaiMs ?? 120_000)
      // Une attente d'autorisation ne doit pas, à elle seule, retenir le processus en vie.
      minuteur.unref?.()
      this.attentes.set(id, { demande: publiee, resoudre: resolve, minuteur })
      try {
        this.ports.notifier(publiee)
      } catch {
        // L'écran est injoignable (fenêtre fermée) : inutile d'attendre une réponse qui ne viendra
        // pas. On referme tout de suite, et le refus initial tient.
        this.clore(id, undefined)
      }
    })
  }

  /** Dépose le jeton obtenu par l'écran. Rend `false` si la demande n'existe plus (délai expiré). */
  deposer(id: string, jeton: string): boolean {
    if (typeof jeton !== 'string' || jeton.length === 0) return false
    return this.clore(id, { type: 'jeton', valeur: jeton })
  }

  /**
   * L'utilisateur a cliqué « continuer » (niveau `confirmation`). Aucun secret n'est échangé : c'est
   * le CLIC qui autorise, et il ne peut venir que de la fenêtre, jamais du modèle.
   */
  confirmer(id: string): boolean {
    return this.clore(id, { type: 'confirme' })
  }

  /** L'utilisateur a refusé d'autoriser. Le geste reste refusé. */
  annuler(id: string): boolean {
    return this.clore(id, undefined)
  }

  private clore(id: string, reponse: ReponseGuichet): boolean {
    const attente = this.attentes.get(id)
    if (!attente) return false
    this.attentes.delete(id)
    clearTimeout(attente.minuteur)
    this.ports.retirer?.(id)
    attente.resoudre(reponse)
    return true
  }
}
