// Émission des évènements d'un tour de chat : rappel protégé, lien de reprise des échecs et
// anti-collage des deltas. Sorti tel quel de AgentPilot.chat() (conv-1580, lot 2).
import { cleDEchec } from '../chat-turn-messages'
import { protegerRappel } from '../observabilite-non-bloquante'
import { DeltaCollageTracker, detacherFenceCollee } from './collage-des-deltas'
import type { PilotEvent, PilotEventVariant } from './evenements'

export type EmetteurDuTour = {
  publier: (e: PilotEvent) => void
  emit: (e: PilotEventVariant) => void
  /** Le tour a rendu sa fin (`done` ou `error`). */
  tourEstClos: () => boolean
  /** Branche le bilan des échecs abandonnés, dit une seule fois à la fin du tour. */
  armerEchecsAbandonnes: (dire: () => void) => void
}

export function emetteurDuTour(onEvent: (e: PilotEvent) => void): EmetteurDuTour {
  // Frontière de typage T2 : chaque évènement construit ici doit correspondre EXACTEMENT à une
  // variante de `PilotEventVariant` (excess-property-check compris) avant d'atteindre le
  // consommateur externe `onEvent: (e: PilotEvent) => void`.
  // Anti-collage : un delta qui ouvre une fence, ou qui reprend un flux interrompu, doit tomber
  // sur une ligne NEUVE — sinon la fence ```html-render finit en milieu de ligne (HTML brut à l'écran).
  const collage = new DeltaCollageTracker()
  /*
   * UN GEL DE L'INTERFACE NE FAIT PLUS REPAYER LE TOUR.
   *
   * MESURE DU 2026-09-02 (journaux de la journee) : 14 appels « reprise du tour interrompu » pour
   * 13,62 $, dont 3,44 $ sur un seul (conv-96, 04:19) — un tour deja paye, relance du debut.
   *
   * Le consommateur de ces evenements ECRIT : trace causale, journal du tour, activite. Pendant un
   * gel, l'ecriture de la trace attend un verrou de sequence (`withSequenceLock`,
   * activity/trace-store.ts) qui JETTE passe son budget. Or `onEvent` etait appele A NU : ce jet
   * remontait ici et tuait un tour par ailleurs sain. `run-pilot-chat.ts` protege pourtant ses
   * ecritures une par une (« best-effort : ne jamais casser un tour ») — mais pas celles de
   * l'appel provider ni des actions, et un oubli ligne par ligne se reproduira.
   *
   * On applique donc a la SOURCE le contrat deja retenu pour le pipeline le meme jour (commit
   * d2f1f97d, `protegerRappel`) : l'observabilite d'un tour de chat n'est plus fatale. Ce n'est pas
   * un catch avale — l'echec est signale — il cesse seulement d'emporter le tour.
   */
  const publier = protegerRappel<[PilotEvent]>('chat:onEvent', onEvent) ?? onEvent
  /**
   * ECHECS EN ATTENTE DE REPRISE — nom d'action -> `actionId` du dernier echec non retente.
   * Alimente le champ `repriseProbableDe` pose sur la commande suivante de meme nom.
   */
  const echecsNonRepris = new Map<string, string>()
  /**
   * `actionId` -> clef CIBLEE de l'action. L'evenement `result` ne porte pas ses arguments : la
   * clef est donc calculee a l'emission de la commande et retrouvee ici. Sans cela le lien
   * reposerait sur le seul NOM d'action et affirmerait qu'un `edit_file` rate sur `a.ts` a ete
   * repris par un `edit_file` reussi sur `b.ts` — la reponse inverse a la question posee.
   */
  const clefParAction = new Map<string, string>()
  /*
   * Rempli plus bas, des que le registre des echecs existe. `emit` ne peut pas lire ce registre
   * (il est declare apres lui, et certains chemins emettent avant), d'ou ce relais : la seule
   * facon de couvrir TOUS les points de sortie du tour sans en oublier un.
   */
  let emettreEchecsAbandonnes: (() => void) | undefined
  /**
   * Le tour a rendu sa fin (`done` ou `error`). La ligne « Lecture retenue » lue EN PARALLÈLE du
   * modèle (conv-1240) ne s'écrit plus après : elle arriverait sous un message déjà clos.
   */
  let tourClos = false
  const emit = (e: PilotEventVariant): void => {
    if (e.kind === 'done' || e.kind === 'error') {
      tourClos = true
      const dire = emettreEchecsAbandonnes
      emettreEchecsAbandonnes = undefined
      dire?.()
    }
    if (e.kind === 'result' && e.name) {
      const clef = clefParAction.get(e.actionId) ?? e.name
      if (e.ok) echecsNonRepris.delete(clef)
      else echecsNonRepris.set(clef, e.actionId)
    }
    if (e.kind === 'command' && e.name) {
      const clef = cleDEchec(e.name, e.args as Record<string, unknown> | undefined)
      clefParAction.set(e.actionId, clef)
      const echec = echecsNonRepris.get(clef)
      if (echec !== undefined && echec !== e.actionId) {
        echecsNonRepris.delete(clef)
        publier({ ...e, repriseProbableDe: echec })
        return
      }
    }
    if (e.kind === 'delta' && e.streamId && e.text) {
      // Deux collages DISTINCTS, dans cet ordre. D'abord celui qui vit DANS le texte du delta
      // (fence soudee a la phrase precedente, cf. detacherFenceCollee), sinon la separation
      // calculee juste apres porterait sur un texte deja fautif. Ensuite celui de la JOINTURE
      // avec le delta precedent, que seul le tracker connait.
      const texte = detacherFenceCollee(e.text)
      const separation = collage.separation(e.streamId, texte)
      if (separation || texte !== e.text) {
        publier({ ...e, text: separation + texte })
        return
      }
    }
    publier(e)
  }
  return {
    publier,
    emit,
    tourEstClos: () => tourClos,
    armerEchecsAbandonnes: (dire) => {
      emettreEchecsAbandonnes = dire
    }
  }
}
