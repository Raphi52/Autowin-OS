// Consigne SYSTÈME d'un tour de chat : modes lecture seule, dossier du tour, blocs système et
// variante sans les commandes servies en outils directs. Sortie telle quelle de AgentPilot.chat()
// (conv-1580, lot 2).
import { AUTOWIN_WORKSPACE_ENV } from '../../shared/app-identity'
import { CONSIGNE_CLASSES_PAGES_HTML } from '../../shared/classes-pages-html'
import { blocsSystemeEcran, buildChatPilotagePrompt } from '../consignes/chat-pilotage-prompt'
import type { CommandSpec } from '../commands/types'
import { CONSTITUTION } from '../consignes/constitution'
import { blocLangueDeReponse } from '../profil/langue-reglage'
import { blocMemoireDeTete } from '../brain/memoire-de-tete'
import { blocProfilUtilisateur } from '../profil/profil-utilisateur'
import type { Message, SendOptions } from '../providers/types'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from '../consignes/response-style'

export type SystemeAssemble = {
  system: string
  systemBlocks: Array<{ name: string; chars: number }>
}

export type SystemeDuTour = SystemeAssemble & {
  watchdogReadOnly: boolean
  commandFreeReadOnly: boolean
  workspaceDuTour: string
  providerLimits: Pick<SendOptions, 'maxBudgetUsd' | 'toolProfile' | 'workspaceCwd'>
  catalogueLectureSeule: CommandSpec[]
  systemeAvecOutilsDirects: (noms: readonly string[]) => SystemeAssemble
}

export function systemeDuTour(entree: {
  sendLimits:
    (Pick<SendOptions, 'maxBudgetUsd'> & { systemProfile?: 'watchdog-read-only' }) | undefined
  conversationId: string | undefined
  catalog: CommandSpec[]
  latestUserMessage: string | undefined
  history: Message[]
  executionWorkspace: (conversationId?: string) => string
  projectContext: (conversationId?: string) => string
}): SystemeDuTour {
  const {
    sendLimits,
    conversationId,
    catalog,
    latestUserMessage,
    history,
    executionWorkspace,
    projectContext
  } = entree
  // MÊME config que les phases orchestrées : la CONSTITUTION (soul/réflexes) est la source
  // UNIQUE partagée ; le chat y ajoute seulement ce qui lui est propre (pilotage par commandes).
  const watchdogReadOnly = sendLimits?.systemProfile === 'watchdog-read-only'
  // OPEN BAR (choix utilisateur explicite 2026-08-14) : un tour PILOTÉ PAR L'UTILISATEUR reçoit
  // TOUJOURS le catalogue complet — jamais un catalogue réduit derrière une classification
  // « lecture seule » du message. Cette classification (`classifyMutationConfidence`) starvait des
  // tours qui devaient agir, mesuré à répétition (dont le scout de veille conv-1154→1157). L'utilisateur
  // ASSUME la perte de garde-fou, dans la continuité du retrait du sandbox (décision C, 2026-08-06) :
  // dans SON chat, si une demande d'analyse amène le modèle à écrire ou supprimer, c'est permis.
  //
  // La SEULE porte conservée est `watchdog-read-only` : le triage interne d'Auto-Kaizen, imposé par
  // le SYSTÈME (pas par l'utilisateur) sur un incident. L'ouvrir laisserait un run échoué déclencher
  // des écritures automatiques — hors du périmètre demandé, et son pilote refuse l'exec de toute façon.
  const directReadOnly = false
  const commandFreeReadOnly = watchdogReadOnly || directReadOnly
  // Le dossier du tour est RESOLU depuis la conversation (le dossier global fige au demarrage n'est
  // plus qu'un repli, cf. `dossierDeTravailDuTour`). Meme valeur que le cwd envoye au CLI, sinon la
  // session est reclamee depuis un autre dossier et le tour meurt a 0 message (conv-48, 2026-09-06).
  const workspaceDuTour =
    executionWorkspace(conversationId).trim() || (process.env[AUTOWIN_WORKSPACE_ENV] ?? '')
  const providerLimits: Pick<SendOptions, 'maxBudgetUsd' | 'toolProfile' | 'workspaceCwd'> = {
    ...(sendLimits?.maxBudgetUsd ? { maxBudgetUsd: sendLimits.maxBudgetUsd } : {}),
    ...(commandFreeReadOnly ? { toolProfile: 'watchdog-read-only' as const } : {}),
    ...(workspaceDuTour ? { workspaceCwd: workspaceDuTour } : {})
  }
  /**
   * Un tour LECTURE SEULE n'est plus SANS COMMANDES : il garde les commandes `readOnlyHint`.
   *
   * L'allègement d'origine (pas de catalogue sur un tour read-only) datait d'un catalogue où
   * TOUTES les commandes mutaient quelque chose. Depuis `read_file`/`find_in_files`, c'est
   * l'inverse : une ANALYSE est exactement le tour qui a besoin de lire. Mesuré sur 4 runs réels
   * du scout de veille (conv-1154→1157) : classé read-only, il recevait zéro outil et répondait
   * honnêtement « je n'ai pas pu exécuter les lectures obligatoires ». Le triage Watchdog, lui,
   * reste volontairement sans commandes (son pilote refuse tout exec de toute façon).
   */
  const catalogueLectureSeule = catalog.filter((commande) => commande.annotations?.readOnlyHint)
  const pilotage = watchdogReadOnly
    ? ''
    : directReadOnly
      ? catalogueLectureSeule.length > 0
        ? buildChatPilotagePrompt(catalogueLectureSeule)
        : ''
      : buildChatPilotagePrompt(catalog)
  /**
   * PRÉFIXE SYSTEM STABLE = condition du cache (mesure 2026-07-28 : cache_read = 0 sur 100 % des
   * appels, ~16 k de cache_write REÉCRITS à chaque tour, ~0,32 $ pour répondre une phrase).
   *
   * Le contexte Brain est un résultat de recherche qui DÉPEND du message de l'utilisateur : tant
   * qu'il était concaténé ici, le system prompt changeait à chaque tour et aucun préfixe ne pouvait
   * être réutilisé. Il est désormais passé dans le MESSAGE (voir `convo`) : même information remise
   * au modèle, mais le system redevient identique d'un tour à l'autre, donc cachable.
   *
   * Fonction du texte de pilotage (conv-1229) : un envoi qui reçoit les outils directs prend la
   * consigne SANS les commandes déjà servies en outils (`systemeAvecOutilsDirects`, plus bas).
   */
  const systemPartsAvec = (pilotage: string): Array<{ name: string; text: string }> =>
    watchdogReadOnly
      ? [
          {
            name: 'watchdog-read-only',
            text:
              "Tu es le triage automatique non invasif d'Autowin OS. Reponds en francais, " +
              'directement et en moins de 250 mots. Tu observes un incident en LECTURE SEULE : ' +
              "n'emets aucune commande Autowin, ne lance aucune orchestration, ne modifie rien et " +
              'ne cree aucun worktree. Utilise au plus les lectures locales strictement necessaires. ' +
              'Si le contexte ne cite aucun artefact ou chemin precis, ne fouille pas le depot au hasard : ' +
              'distingue les faits, la cause seulement si elle est prouvee, puis la preuve manquante. ' +
              'Respecte exactement toute derniere ligne ISSUE demandee par le message utilisateur.\n'
          }
        ]
      : directReadOnly
        ? [
            {
              name: 'direct-read-only',
              text:
                "Tu es le chat direct d'Autowin OS. Reponds en francais a la demande exacte de " +
                "l'utilisateur, sans preambule inutile. Ce tour est strictement en LECTURE SEULE : " +
                "n'emets aucune commande qui MODIFIE quoi que ce soit, ne lance aucune orchestration, " +
                'ne modifie rien et ne cree aucun worktree. Utilise uniquement les lectures locales ' +
                'strictement necessaires. Distingue les faits observes des deductions et respecte tout ' +
                'format de sortie explicitement demande. Si le message dit « reponds exactement X », ' +
                'ta sortie ENTIERE doit etre exactement X, sans note, explication ni mise en forme en plus. ' +
                'EXPRESSION VISUELLE : hors format strict demande, des que ta reponse a une STRUCTURE ' +
                '(comparaison, etapes, statuts, chiffres, recapitulatif), prefere un bloc ferme ' +
                '```html-render en DIRECTION « transparence totale » (choix utilisateur) : aucun ' +
                'panneau ni fond opaque, typographie sur le fond de l’app, mise en page COMPACTE ' +
                '(interlignes 1.45-1.55, marges de section <=10px, aucun grand vide vertical), jamais de ' +
                'halos ; sans JavaScript ni URL externe. ' +
                // Les classes de l'app remplacent la recette de couleurs en dur (conv-1074).
                CONSIGNE_CLASSES_PAGES_HTML +
                ' Garde le texte simple pour une ou deux phrases.\n'
            },
            // Les commandes de LECTURE restent servies : une analyse est exactement le tour qui a
            // besoin de lire (mesure : scout de veille, conv-1154→1157, zero outil, zero candidat).
            // `pilotage` est deja reduit au catalogue readOnlyHint dans ce cas ('' si vide).
            { name: 'pilotage-lecture', text: pilotage }
          ]
        : [
            { name: 'constitution', text: CONSTITUTION },
            { name: 'pilotage', text: pilotage },
            { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
            // Le profil personnel suit le contexte projet : stable entre deux ajouts (conv-1098).
            // La mémoire de tête (faits clés de l'entreprise) le suit, stable elle aussi (conv-1285).
            {
              name: 'projectContext',
              text:
                projectContext(conversationId) +
                blocProfilUtilisateur() +
                blocMemoireDeTete() +
                blocLangueDeReponse()
            },
            /**
             * DERNIERS blocs (`blocsSystemeEcran`, chat-pilotage-prompt.ts) : l'ecran de l'utilisateur,
             * TOUJOURS servi et identique pour tous les fils (kaizen conv-835, tour
             * ac1d0434-51c7-4dee-adf9-a8cb0a8e41f8 : « envoi un message teams… » n'avait aucun mot
             * visuel, le chat n'a donc pas recu la regle et a ouvert Teams sur l'ecran reel), puis les
             * regles de travail visuel, conditionnelles (conv-614) — image jointe comprise (conv-742).
             *
             * En DERNIER a dessein : le cache du provider vaut par son PREFIXE. Seule la queue
             * visuelle apparait ou disparait d'un tour a l'autre.
             */
            ...blocsSystemeEcran(
              latestUserMessage ?? '',
              (history.at(-1)?.attachments ?? []).some((piece) => piece.kind === 'image'),
              conversationId ?? ''
            )
          ]
  const assemblerSysteme = (
    texte: string
  ): { system: string; systemBlocks: Array<{ name: string; chars: number }> } => {
    const parts = systemPartsAvec(texte)
    return {
      system: parts.map((p) => p.text).join(''),
      systemBlocks: parts.filter((p) => p.text).map((p) => ({ name: p.name, chars: p.text.length }))
    }
  }
  // Le système COMPLET (liste entière des commandes) : défaut de chaque envoi, et seul servi quand
  // les outils directs ne démarrent pas — le texte `<cmd>` est alors le seul chemin du modèle.
  const { system, systemBlocks } = assemblerSysteme(pilotage)
  /**
   * LISTE DES COMMANDES SANS DOUBLON (conv-1229, 2026-10-28). Mesure sur le texte réellement envoyé
   * (prompt-observability, conv-1229) : 46 des 55 commandes de la liste étaient AUSSI servies en
   * outils directs, avec la même description et des arguments plus détaillés
   * (`outilsPublies`, skill-node-mcp.ts) — 18 830 caractères payés deux fois à chaque requête.
   * Quand les outils directs sont servis, la consigne ne détaille plus que les commandes texte seul.
   * Calculé au premier envoi servi, puis réutilisé : même texte d'un envoi à l'autre, donc cachable.
   */
  let systemeOutilsDirects:
    | { cle: string; system: string; systemBlocks: Array<{ name: string; chars: number }> }
    | undefined
  const systemeAvecOutilsDirects = (
    noms: readonly string[]
  ): { system: string; systemBlocks: Array<{ name: string; chars: number }> } => {
    // Surveillance (aucune commande) et lecture seule (catalogue réduit) gardent leur consigne.
    if (watchdogReadOnly || directReadOnly || noms.length === 0) return { system, systemBlocks }
    const cle = noms.join(',')
    if (systemeOutilsDirects?.cle !== cle) {
      systemeOutilsDirects = {
        cle,
        ...assemblerSysteme(buildChatPilotagePrompt(catalog, { outilsDirects: noms }))
      }
    }
    return systemeOutilsDirects
  }
  return {
    watchdogReadOnly,
    commandFreeReadOnly,
    workspaceDuTour,
    providerLimits,
    catalogueLectureSeule,
    system,
    systemBlocks,
    systemeAvecOutilsDirects
  }
}
