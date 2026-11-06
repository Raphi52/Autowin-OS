// Groupe de commandes « navigation, question cliquable, envoi au chat », sorti de AppCommandBus.run (conv-1508, lot 2).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from './commands'
import { resolveAppLocation } from '../../shared/navigation'
import { normaliserReponsesAsk, choixMultipleDemande } from '../chat/ask-options'
import { CONTEXT_MESSAGE_LIMIT } from '../conversations/conversation-window'
import { optionsQuiPresupposentUneSolution } from '../chat/option-lecture-ou-solution'
import type { Role } from '../profil/roles'
import type { Message } from '../providers/types'

/** Cas de `AppCommandBus.run` : navigation, question cliquable, envoi au chat. Corps déplacé tel quel depuis commands.ts (conv-1508, lot 2). */
export async function executerInterface(
  bus: AppCommandBus,
  name: string,
  a: Record<string, unknown>,
  conversationId?: string
): Promise<unknown> {
  const s = (k: string): string => String(a[k] ?? '')
  switch (name) {
    case 'desktop_act': {
      if (!bus.desktop) throw new Error('Controle desktop indisponible')
      // Pendant une confirmation de production, le modèle ne clique pas « continuer » à la place
      // de l'utilisateur (conv-738) : la confirmation doit venir d'un vrai clic humain.
      if ((bus.guichetProd?.enAttente().length ?? 0) > 0)
        throw new Error('desktop_act refusé : une confirmation de production attend la réponse de l’utilisateur.')
      return await bus.desktop.act(a.actions)
    }
    case 'navigate': {
      const requestedTab = s('tab')
      const location = resolveAppLocation(requestedTab)
      bus.tab = location.destination
      const origin = typeof a.origin === 'string' ? a.origin : undefined
      bus.broadcast({
        type: 'navigate',
        tab: requestedTab,
        ...(origin ? { origin } : {})
      })
      return {
        tab: location.destination,
        section: location.section,
        // Sans lui, « hdesk » répondrait `chat` : l'agent croirait la demande mal comprise (conv-1378).
        ...(location.panneau ? { panneau: location.panneau } : {})
      }
    }
    case 'ask': {
      // Les options arrivent DECLAREES, jamais devinees a partir du texte de la reponse.
      // Mesure du 2026-08-10 sur 883 conversations : le modele ne liste pas ses options, il finit
      // en prose (« Veux-tu que je le fasse ? »). Une heuristique sur les puces de fin de message
      // proposait comme reponses cliquables des resultats de tests et des chemins de fichiers —
      // 3 echantillons sur 4. Un choix se declare.
      // Contrat elargi le 20/08 : une reponse porte un libelle COURT + sa consequence, et non
      // une phrase entiere. Les chaines nues restent acceptees — un modele qui emet l'ancienne
      // forme obtient un bloc degrade, jamais une erreur.
      const options = normaliserReponsesAsk(a.options)
      if (options.length < 2) throw new Error('Une question cliquable demande 2 a 10 reponses')
      // SIGNAL, JAMAIS REFUS. Quand le fil part d'un symptome et que l'utilisateur n'a nomme
      // aucune cible, une option qui envoie deja un chemin de fichier lui fait ACCEPTER une
      // solution qu'il n'a pas choisie — mesure conv-1376 du 2026-08-23 : le texte clique devient
      // le message de l'utilisateur, puis l'objectif du run. On le trace pour pouvoir le compter.
      // Aucun refus : le precedent du 2026-08-18 (`conversation-task-contract.ts`) a montre qu'une
      // heuristique locale qui BLOQUE produit onze faux blocages sur du travail legitime.
      const filUtilisateur = (bus.os.conversations.get(conversationId ?? '')?.messages ?? [])
        .filter((message) => message.role === 'user')
        .slice(-CONTEXT_MESSAGE_LIMIT)
        .map((message) => message.content)
      const presupposees = optionsQuiPresupposentUneSolution(filUtilisateur, options)
      if (presupposees.length) {
        bus.trace?.(
          'ask_option_presuppose_une_solution',
          { conversationId: conversationId ?? '', signaux: presupposees },
          true
        )
      }
      const choixMultiple = choixMultipleDemande(a.choixMultiple)
      return { question: s('question'), options, ...(choixMultiple && { choixMultiple }) }
    }
    case 'chat_send': {
      // Une commande `/xxx` est un chemin d'INTERFACE : la zone de saisie reconnait la skill et
      // construit la tache. `chat_send` n'a AUCUNE destination — son texte part en echange
      // ponctuel avec le modele, qui repond « Unknown command ». Mesure le 2026-09-05
      // (conv-297 -> conv-300 « /curate ») : le fil est reste vide, la skill n'a jamais tourne.
      // Refus DETERMINISTE, qui nomme la commande capable de cibler une conversation.
      // Un chemin de fichier absolu (`/home/x/y.txt`) commence AUSSI par `/` : le premier mot
      // d'une commande de skill ne contient ni second `/` ni point, ce qui separe les deux.
      const messageEnvoye = s('message').trim()
      // DESTINATION NOMMEE : le message devient un vrai tour utilisateur dans ce fil, via la
      // meme capacite que les taches planifiees. Le pilote y resout `/xxx` comme une skill
      // (agent-pilot.ts, invokedSkillId) : c'est le chemin qui manquait le 2026-09-05.
      const cibleConversation =
        typeof a.conversationId === 'string' && a.conversationId.trim()
          ? a.conversationId.trim()
          : ''
      if (cibleConversation) {
        if (!bus.lancerDansConversation)
          throw new Error(
            `chat_send ne peut pas viser « ${cibleConversation} » : l'envoi vers une ` +
              `conversation n'est pas disponible dans ce processus.`
          )
        if (bus.conversationExiste && !bus.conversationExiste(cibleConversation))
          throw new Error(`chat_send : conversation inconnue « ${cibleConversation} ».`)
        const modeleDemande = typeof a.model === 'string' ? a.model.trim() : ''
        const fournisseur =
          typeof a.provider === 'string' && a.provider.trim() ? a.provider.trim() : 'claude'
        const lance = modeleDemande
          ? await bus.lancerDansConversation(cibleConversation, messageEnvoye, {
              provider: fournisseur,
              model: modeleDemande
            })
          : await bus.lancerDansConversation(cibleConversation, messageEnvoye)
        if (!lance.ok)
          throw new Error(
            `chat_send : le tour n'a pas demarre dans « ${cibleConversation} » ` +
              `(${lance.error ?? 'cause non renseignee'}).`
          )
        bus.broadcast({ type: 'refresh', scope: 'chat' })
        return {
          conversationId: cibleConversation,
          ...(lance.turnId ? { turnId: lance.turnId } : {}),
          envoye: true
        }
      }
      const premierMot = messageEnvoye.split(/\s/)[0]
      if (/^\/[a-z0-9][\w-]*$/i.test(premierMot)) {
        const skill = premierMot
        throw new Error(
          `chat_send ne peut pas lancer « ${skill} » : il n'a pas de conversation destinataire ` +
            `et le texte partirait en simple question au modele. Utiliser orchestrate ` +
            `(argument conversationId) pour lancer une skill dans une conversation.`
        )
      }
      const text = bus.onChat
        ? await bus.onChat(
            a.provider ? s('provider') : undefined,
            a.role ? s('role') : undefined,
            s('message')
          )
        : (
            await bus.os.chat(
              a.provider ? s('provider') : undefined,
              (a.role ? s('role') : undefined) as Role | undefined,
              [{ role: 'user', content: s('message') } as Message],
              () => {}
            )
          ).text
      bus.broadcast({ type: 'refresh', scope: 'chat' })
      return { reply: text }
    }
    default:
      throw new Error(`commande inconnue: ${name}`)
  }
}
