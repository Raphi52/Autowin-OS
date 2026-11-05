// Groupe de commandes « vérification, Brain, profil, skills, tâches, SQL, tickets », sorti de AppCommandBus.run (conv-1508, lot 2).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from '../commands'
import { profilAjouter, profilRetirer } from '../profil-utilisateur'
import { estCheminPerso, envDuBrainPerso, cheminSansPrefixePerso, origineBrainPerso } from '../brain-perso'
import { brainServiceToken } from '../brain-retrieval'
import { runBrainGraph, runBrainRead, tracerLectureBrain } from '../brain-graph-command'
import { condenserLecture } from '../brain-condenseur'
import { brainCorpusForWorkspace } from '../brain-corpus-scope'
import { chargerSkillPourLeModele } from '../skill-charger-command'
import { createTicketFromCommand, type TicketCreateArgs } from '../ticket-create-command'
import { createTaskFromCommand, updateTaskFromCommand, deleteTaskFromCommand, listTasksFromCommand } from '../task-manager/task-create-command'
import { runSqlRead } from '../sql-read-command'
import { getSqlCatalogConfig } from '../sql-read-catalog'
import { getTicketFromCommand, type TicketGetArgs } from '../ticket-get-command'
import { updateTicketFromCommand, type TicketUpdateArgs } from '../ticket-update-command'
import { searchTicketsFromCommand, type TicketSearchArgs } from '../ticket-search-command'

/** Cas de `AppCommandBus.run` : vérification, Brain, profil, skills, tâches, SQL, tickets. Corps déplacé tel quel depuis commands.ts (conv-1508, lot 2). */
export async function executerOutilsMetier(
  bus: AppCommandBus,
  name: string,
  a: Record<string, unknown>,
  conversationId?: string,
  turnId?: string,
  onProgress?: (text: string) => void
): Promise<unknown> {
  switch (name) {
    case 'verify':
      return await bus.runVerify(
        onProgress,
        typeof a.cible === 'string' ? a.cible : undefined,
        conversationId,
        typeof a.type === 'string' ? a.type : undefined
      )
    case 'brain_query':
      return await bus.runBrainQuery(a.question, conversationId, turnId, a.entier)
    case 'profil_ajouter':
      // Un refus (profil plein, identité inconnue, préférence vide) LÈVE : rien n'est écrit (conv-1098).
      return profilAjouter(a.preference)
    case 'profil_retirer':
      return profilRetirer(a.preference)
    case 'brain_graph':
    case 'brain_read': {
      /*
       * NOTE DU BRAIN PERSO (conv-1233) : la recherche rend ses chemins préfixés `perso:`. On
       * l'ouvre sur le serveur perso, sans filtre de dépôt — les notes perso ne sont rangées
       * par aucun projet.
       */
      const cible = String((name === 'brain_read' ? a.path : a.entity) ?? '')
      if (estCheminPerso(cible)) {
        const envPerso = envDuBrainPerso()
        if (!envPerso) {
          return {
            found: false,
            status: 'unavailable',
            knowledge: '',
            note: 'aucun Brain perso réglé (Réglages › Diagnostic › Brain perso)'
          }
        }
        const argsPerso =
          name === 'brain_read'
            ? { ...a, path: cheminSansPrefixePerso(cible) }
            : { ...a, entity: cheminSansPrefixePerso(cible) }
        const depsPerso = { token: brainServiceToken(envPerso), origin: origineBrainPerso() }
        const debutPerso = performance.now()
        const luPerso =
          name === 'brain_graph'
            ? await runBrainGraph(argsPerso, depsPerso)
            : await runBrainRead(argsPerso, depsPerso)
        // Le chemin tracé garde `perso:` (`a`, pas `argsPerso`) : c'est la forme servie au modèle.
        tracerLectureBrain(name === 'brain_graph' ? 'brain_graph' : 'brain_read', a, luPerso, {
          conversationId,
          turnId,
          durationMs: Math.round(performance.now() - debutPerso)
        })
        return name === 'brain_read'
          ? await condenserLecture(luPerso, a, bus.condenseurBrain, conversationId)
          : luPerso
      }
      const corpus = brainCorpusForWorkspace(bus.workspaceDuTour)
      if (corpus?.length === 0) {
        return {
          found: false,
          status: 'empty',
          knowledge: '',
          note: 'aucun savoir Brain pour ce dossier'
        }
      }
      const deps = { token: brainServiceToken(), corpus: corpus ?? null }
      const debut = performance.now()
      const lu =
        name === 'brain_graph' ? await runBrainGraph(a, deps) : await runBrainRead(a, deps)
      // conv-1303 : ces lectures injectaient des notes entières sans aucune trace Brain.
      tracerLectureBrain(name === 'brain_graph' ? 'brain_graph' : 'brain_read', a, lu, {
        conversationId,
        turnId,
        durationMs: Math.round(performance.now() - debut)
      })
      return name === 'brain_read'
        ? await condenserLecture(lu, a, bus.condenseurBrain, conversationId)
        : lu
    }
    case 'skill_charger':
      return chargerSkillPourLeModele(a)
    case 'ticket_create':
      // Écriture chez un tiers : la cible et les bornes sont décidées hors du modèle
      // (`ticket-create-command.ts` + `TicketService`), jamais d'après les arguments bruts.
      return await createTicketFromCommand(a as TicketCreateArgs, {
        listSources: bus.listTicketSources,
        ...(bus.createTicket ? { create: bus.createTicket } : {})
      })
    case 'task_create':
      // Même chemin que le bouton « Créer » de l'écran : rien qui échappe au bouton « Supprimer ».
      return await createTaskFromCommand(a as { task?: unknown }, bus.taskManager)
    case 'task_update':
      // Mêmes chemins que les boutons « Enregistrer » et « Supprimer » de l'écran (conv-1370).
      return await updateTaskFromCommand(a as { id?: unknown; patch?: unknown }, bus.taskManager)
    case 'task_delete':
      return await deleteTaskFromCommand(a as { id?: unknown }, bus.taskManager)
    case 'task_list':
      // Le stockage que l'écran affiche : ce que l'agent lit est ce que l'utilisateur peut supprimer.
      return listTasksFromCommand(bus.taskManager)
    case 'sql_query':
      // La cible et la nature de la requête sont décidées hors du modèle (`sql-read-guard.ts`),
      // jamais d'après les arguments bruts : le compte Windows utilisé PEUT écrire en production.
      return await runSqlRead(
        {
          server:
            typeof a.server === 'string' && a.server ? a.server : (getSqlCatalogConfig()?.server ?? ''),
          database: a.database,
          query: a.query
        },
        {
          ...(bus.cheminSqlcmd() ? { sqlcmdPath: bus.cheminSqlcmd() } : {}),
          // La porte décide dans `runSqlRead`, pas ici : un garde posé sur le site d'appel se
          // contourne en ajoutant un second appelant. Aucun jeton n'est transmis par le modèle —
          // il ne peut donc pas s'autoriser en l'inventant dans ses arguments.
          // Le fil d'où part le geste : l'écran d'autorisation vit DANS la conversation, il ne
          // doit donc s'afficher que dans celle-ci (conv-626, 2026-09-16).
          ...(conversationId ? { conversationId } : {}),
          ...(bus.porteProd ? { porteProd: bus.porteProd } : {}),
          // Le guichet ne contourne rien : il ouvre l'écran de saisie de l'utilisateur quand la
          // porte refuse, et c'est la porte qui tranche à nouveau avec le jeton obtenu.
          ...(bus.guichetProd ? { guichetProd: bus.guichetProd } : {})
        }
      )
    case 'ticket_get':
      return await getTicketFromCommand(a as TicketGetArgs, {
        listSources: bus.listTicketSources,
        ...(bus.getTicket ? { get: bus.getTicket } : {})
      })
    case 'ticket_update':
      return await updateTicketFromCommand(a as TicketUpdateArgs, {
        listSources: bus.listTicketSources,
        ...(bus.updateTicket ? { update: bus.updateTicket } : {})
      })
    case 'ticket_search':
      // Lecture chez un tiers : même garde de cible que la création (le modèle nomme au plus un
      // `sourceId`), et le filtre est échappé plus bas dans la chaîne, jamais ici.
      return await searchTicketsFromCommand(a as TicketSearchArgs, {
        listSources: bus.listTicketSources,
        ...(bus.listTickets ? { list: bus.listTickets } : {})
      })
    default:
      throw new Error(`commande inconnue: ${name}`)
  }
}
