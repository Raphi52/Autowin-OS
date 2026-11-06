// Ce que la boucle d'itérations d'un tour de chat lit du tour : les résultats de sa préparation
// (consigne système, session, message d'ouverture, lectures, outils directs), son état mutable et
// les paramètres de AgentPilot.chat() dont elle se sert. Construit une seule fois par chat(), juste
// avant la boucle (conv-1580, lot 4) : les modules de la boucle le reçoivent au lieu de capturer
// les locales de chat().
import type { OuvertureOutilsNatifs } from '../chat/chat-mcp'
import type { CommandSpec } from '../commands/types'
import type { ProviderRegistry } from '../providers/registry'
import type { Message } from '../providers/types'
import type { RoleBinding } from '../profil/roles'
import type { TurnTimer } from '../chat/turn-timing'
import type { MotifDeRallonge } from './aides-du-tour'
import type { AppelsNatifsDuTour } from './appels-natifs'
import type { ExecutionDeCommande } from './commandes-du-tour'
import type { EtatDuTour } from './etat-du-tour'
import type {
  PilotEventVariant,
  PilotProviderJournalLink,
  RecoveredPilotProviderCall
} from './evenements'
import type { LecturesDuTour } from './lectures-du-tour'
import type { MessageDuTour } from './message-du-tour'
import type { SessionDuTour } from './session-du-tour'
import type { SystemeDuTour } from './systeme-du-tour'

export type ContexteDuTour = SystemeDuTour &
  SessionDuTour &
  MessageDuTour &
  AppelsNatifsDuTour &
  Pick<
    LecturesDuTour,
    | 'deuxLecturesDuTour'
    | 'poserLaQuestionDesLectures'
    | 'annoncerLaLectureRetenue'
    | 'lectureRetenue'
  > & {
    etat: EtatDuTour
    emit: (e: PilotEventVariant) => void
    /** Point unique de rallonge du cap d'itérations, tenu par chat() (`recoveryReasons`). */
    grantRecoveryIteration: (reason: MotifDeRallonge) => void
    execCommandTolerante: ExecutionDeCommande
    registry: ProviderRegistry
    /** Sessions CLI du chat, par conversation : la carte de l'instance AgentPilot. */
    chatSessions: Map<string, { key: string; sessionId: string }>
    persisterSession: (conversationId: string, key: string, sessionId: string) => void
    oublierSession: (conversationId: string) => void
    outilsNatifs: boolean | Pick<OuvertureOutilsNatifs, 'demarrer'>
    timer: TurnTimer
    provider: string
    binding: RoleBinding
    catalog: CommandSpec[]
    history: Message[]
    latestUserMessage: string | undefined
    currentAttachments: NonNullable<Message['attachments']>
    conversationId: string | undefined
    turnId: string | undefined
    signal: AbortSignal | undefined
    drainDirectives: (() => string[]) | undefined
    recoveredProviderCall: RecoveredPilotProviderCall | undefined
    onProviderJournal: ((link: PilotProviderJournalLink) => void) | undefined
    sendLimits: { tourDeFond?: boolean } | undefined
    exigerExperienceSoignee: boolean
  }
