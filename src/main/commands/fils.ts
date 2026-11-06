// Groupe de commandes « messages entre fils et plans de lots », sorti de AppCommandBus.run (lot 2).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from './commands'
import { ecrireAUnFil, reveillerSurOrdre, lireMesMessages } from '../conversations/messages-entre-fils-app'
import { arreterUnFil } from '../conversations/arreter-un-fil'

/** Cas de `AppCommandBus.run` : messages entre fils et plans de lots. Corps déplacé tel quel depuis commands.ts (lot 2). */
export async function executerFils(
  bus: AppCommandBus,
  name: string,
  a: Record<string, unknown>,
  conversationId?: string,
  turnId?: string
): Promise<unknown> {
  switch (name) {
    // L'expéditeur est le fil et le tour de CET appel, jamais un argument de l'agent.
    // Aucun tour n'est lancé chez le destinataire, SAUF un ordre vers un fil inactif (2026-10-25,
    // demande de l'utilisateur), qui y lance un tour signé « Ordre de <fil> ».
    case 'ecrire_a_un_fil': {
      const expediteur = conversationId ?? ''
      const envoi = ecrireAUnFil(
        a,
        { fil: expediteur, ...(turnId ? { tour: turnId } : {}) },
        bus.contexteDesFils()
      )
      if (envoi.nature !== 'ordre') {
        bus.broadcast({ type: 'refresh', scope: 'messages-fils' })
        return envoi
      }
      const lancer = bus.lancerDansConversation
      const tourActif = bus.tourDeChatActif
      const plans = bus.plansDeLots
      // L'ordre d'un chef vers le fil d'un de ses lots en échec relance ce lot ; le
      // coordinateur le compte et le suit. Tout autre ordre part tel quel.
      const lancerLOrdre = lancer
        ? (fil: string, prompt: string) =>
            plans
              ? plans.lancerParOrdre(expediteur, fil, prompt, (f, p, modele) =>
                  // Le modèle du lot, par la même voie que `chat_send` (« model »).
                  modele
                    ? lancer(f, p, {
                        provider: bus.os.conversations?.get?.(f)?.provider ?? 'claude',
                        model: modele
                      })
                    : lancer(f, p)
                )
              : lancer(fil, prompt)
        : undefined
      const reveil = await reveillerSurOrdre(
        { id: envoi.id, de: expediteur, a: envoi.a, texte: String(a.texte) },
        {
          ...(tourActif ? { tourActif: (fil: string) => tourActif(fil) } : {}),
          ...(lancerLOrdre ? { lancer: lancerLOrdre } : {})
        }
      )
      bus.broadcast({ type: 'refresh', scope: 'messages-fils' })
      if (reveil.reveil === 'lance') bus.broadcast({ type: 'refresh', scope: 'chat' })
      return {
        ...envoi,
        reveil: reveil.reveil,
        detail: reveil.detail,
        ...(reveil.turnId ? { turnIdReveil: reveil.turnId } : {})
      }
    }
    case 'lire_mes_messages': {
      const lu = lireMesMessages(conversationId ?? '')
      if (lu.livres) bus.broadcast({ type: 'refresh', scope: 'messages-fils' })
      return lu
    }
    // Le bouton « Arrêter » d'un AUTRE fil, pour l'agent. L'appelant vient du tour.
    case 'arreter_un_fil': {
      const arret = arreterUnFil(a, conversationId ?? '', {
        existe: (fil) =>
          bus.conversationExiste
            ? bus.conversationExiste(fil)
            : Boolean(bus.os.conversations?.get?.(fil)),
        ...(bus.toursDeChat ? { tours: bus.toursDeChat } : {}),
        couperLeRun: (fil, motif) => bus.abortOrchestration(fil, motif)
      })
      if (arret.tourCoupe || arret.runCoupe) bus.broadcast({ type: 'refresh', scope: 'chat' })
      return arret
    }
    // Le chef est le fil de CET appel ; accepter ou reprendre un plan n'est pas ici
    // (clic de l'utilisateur, canal `os:plansDeLots`).
    case 'plan_de_lots': {
      if (!bus.plansDeLots)
        throw new Error('plan_de_lots : coordinateur des plans non câblé dans ce processus.')
      return bus.plansDeLots.outil(conversationId ?? '', a)
    }
    default:
      throw new Error(`commande inconnue: ${name}`)
  }
}
