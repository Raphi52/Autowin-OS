import { app, shell, safeStorage, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { assertTrustedRendererSender } from './ipc-senders'
import {
  MailWatchMemory,
  MailChannelWatcher,
  listeningChannels,
  describeMail
} from '../task-manager/watchdog-mail'
import {
  TeamsGraphClient,
  parseTeamsItemId,
  replyTeams,
  describeTeamsMessage
} from '../task-manager/watchdog-teams'
import { sourceTeams, TeamsLocalClient } from '../task-manager/watchdog-teams-local'
import {
  creerJournalWatchdog,
  cheminJournalWatchdogTeams,
  creerBattementWatchdog,
  detailPilotage,
  empreinteConversation
} from '../task-manager/journal-watchdog-teams'
import { OutlookLocalGateway, OUTLOOK_HORS_INSTANCE_CACHEE } from '../outlook/outlook-local'
import type { ContexteIpcChat } from '../index'

/**
 * LE COURRIER DU POSTE : passerelle Outlook locale, Teams (Graph ou client local), surveillance
 * des mails et ses canaux. `variablePerso` reste dans chat.ts : elle lit HKCU par un appel
 * bloquant, compté au plafond de ce fichier (`scripts/appels-bloquants.plancher.json`).
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 * Ce que construit un autre module du chat arrive par `deps`.
 */

/** Ce que `registerCourrierIpc` reçoit de `registerChatIpc`, construit avant ou à côté de lui. */
export interface DependancesCourrier {
  variablePerso: (name: string) => string | undefined
}

/** Ce que `registerCourrierIpc` rend à `registerChatIpc`, qui le passe aux modules suivants. */
export interface CourrierDuChat {
  mailMemory: MailWatchMemory
  teamsClient: TeamsGraphClient | undefined
}

/** IPC : Outlook, Teams et surveillance des mails. */
export function registerCourrierIpc(
  ctx: ContexteIpcChat,
  deps: DependancesCourrier
): CourrierDuChat {
  const { appDataRoot, headlessTestInstance, scheduledTasks } = ctx
  const { variablePerso } = deps
  /**
   * La passerelle Outlook LOCALE, pour les widgets Interlocuteurs et Agenda de la vue Accueil.
   *
   * Lecture seule du profil Outlook de la machine, par automation COM. Rien ne sort du poste : c'est
   * la raison pour laquelle Microsoft Graph a ete ecarte. Elle est construite ICI, une fois, parce
   * qu'elle porte un cache — en fabriquer une par appel relancerait un dialogue COM a chaque
   * rafraichissement de la page d'accueil.
   */
  // Instance de test CACHÉE : aucun Outlook. Lu par COM depuis un bureau caché, Outlook démarre DANS
  // ce bureau, invisible, et le garde vivant après la capture (2026-10-17).
  const outlookGateway = new OutlookLocalGateway({
    appRoot: app.getAppPath(),
    // Ouvre une piece jointe RECUE, une fois copiee par Outlook. `shell.openPath` rend
    // '' en cas de succes et la cause sinon : la passerelle affiche cette cause telle quelle.
    ouvreurFichier: (chemin) => shell.openPath(chemin),
    ...(headlessTestInstance ? { horsService: OUTLOOK_HORS_INSTANCE_CACHEE } : {})
  })
  const teamsClientId = variablePerso('AUTOWIN_TEAMS_CLIENT_ID')
  const teamsVaultPath = join(app.getPath('userData'), 'teams-graph-token.bin')
  // Le jeton de renouvellement est un secret : chiffre par le systeme, jamais en clair.
  const chargerJetonTeams = (): string | undefined => {
    try {
      if (!existsSync(teamsVaultPath) || !safeStorage.isEncryptionAvailable()) return undefined
      return safeStorage.decryptString(readFileSync(teamsVaultPath))
    } catch {
      return undefined
    }
  }
  // Graph seulement s'il est deja CONNECTE ; sinon lecture locale (sourceTeams).
  const modeTeams = sourceTeams({
    clientId: teamsClientId,
    jetonGraph: chargerJetonTeams() !== undefined,
    windows: process.platform === 'win32'
  })
  console.log(`[watchdog] Teams : ${modeTeams ?? 'désactivé'}`)
  // Seul temoin lisible apres un redemarrage : la console du processus principal est jetee.
  const journalTeams = creerJournalWatchdog(cheminJournalWatchdogTeams(appDataRoot))
  // Une ligne « actif » par heure, écrite par la boucle de lecture elle-même : plus d'une heure sans
  // elle = surveillance arrêtée.
  const battementTeams = creerBattementWatchdog(journalTeams)
  journalTeams('source', {
    mode: modeTeams ?? 'désactivé',
    identifiantGraph: teamsClientId ? 'présent' : 'absent',
    jetonGraph: chargerJetonTeams() !== undefined ? 'présent' : 'absent'
  })
  const teamsClient =
    modeTeams === 'graph' && teamsClientId
      ? new TeamsGraphClient(
          {
            clientId: teamsClientId,
            tenantId: variablePerso('AUTOWIN_TEAMS_TENANT_ID') ?? 'organizations'
          },
          {
            load: chargerJetonTeams,
            save: (token) => {
              if (safeStorage.isEncryptionAvailable())
                writeFileSync(teamsVaultPath, safeStorage.encryptString(token))
            }
          },
          (prompt) => {
            console.log(
              `[watchdog] connexion Teams demandée : code ${prompt.userCode} sur ${prompt.verificationUri}`
            )
            // Plus de fenetre (demande utilisateur, 2026-09-25) : le code reste dans le journal.
          }
        )
      : undefined
  // Sans connexion Microsoft (2026-09-25) : lecture du stockage local du client Teams
  // deja connecte, reponse en pilotant sa fenetre, repli par mail si ce pilotage echoue.
  const teamsLocal =
    modeTeams === 'local'
      ? new TeamsLocalClient({
          mail: (adresse, objet, corps) => outlookGateway.sendNew(adresse, objet, corps),
          log: (ligne) => {
            console.warn(ligne)
            journalTeams('pilotage', { detail: detailPilotage(ligne) })
          }
        })
      : undefined
  const teamsSource = teamsClient ?? teamsLocal
  ctx.mailWatchdogReplier = async (itemId, body) => {
    if (parseTeamsItemId(itemId)) {
      const resultat = await (teamsLocal
        ? teamsLocal.reply(itemId, body)
        : replyTeams(teamsClient, itemId, body))
      journalTeams('reponse', {
        conv: empreinteConversation(itemId),
        ok: resultat.ok,
        erreur: resultat.ok ? undefined : resultat.erreur
      })
      return resultat
    }
    const sent = await outlookGateway.replyToItem(itemId, body)
    if (sent.ok) await outlookGateway.markRead([itemId])
    return sent
  }
  // Surveillance des mails pour les regles `outlook-mail`. Un canal n'est interroge que si une regle
  // ACTIVE l'ecoute : sans elle, aucun dialogue COM (Outlook) ni appel reseau (Teams).
  // fix-ok: une seule regle mail active suffisait a interroger Outlook ET Teams (ancien test `.some(kind === 'outlook-mail')`), et chaque `await notifyMail` attendait la FIN de l'agent : la lecture suivante, et Teams, attendaient l'agent Outlook.
  // Salvage 2026-09-26 : cette surveillance et la source Teams locale + son journal
  // ont ete ecrites en parallele ; la surveillance lit desormais `teamsSource`.
  // Le journal ne note une lecture qu'a son RETABLISSEMENT et une erreur qu'a son CHANGEMENT : pas
  // une ligne par minute.
  let lectureTeamsAnnoncee = false
  let derniereErreurTeams: string | undefined
  const mailMemoryPath = join(app.getPath('userData'), 'watchdog-mail-state.json')
  const mailMemory = new MailWatchMemory({
    load: () => (existsSync(mailMemoryPath) ? readFileSync(mailMemoryPath, 'utf8') : undefined),
    save: (text) => writeFileSync(mailMemoryPath, text)
  })
  const mailWatcher = new MailChannelWatcher({
    store: scheduledTasks,
    memory: mailMemory,
    notifyMail: async (mail) => {
      const bilan = (await ctx.watchdogEngine?.notifyMail(mail)) ?? []
      if (mail.channel !== 'teams') return
      // Journal Teams : POURQUOI un message detecte a eu, ou non, une reponse.
      const conv = empreinteConversation(mail.itemId)
      const concernees = bilan.filter((b) => b.issue !== 'autre-canal')
      if (!concernees.length) journalTeams('ignore', { conv, raison: 'aucune-regle-teams-active' })
      for (const b of concernees)
        journalTeams(b.issue === 'declenche' ? 'declenche' : 'refus', {
          conv,
          regle: b.taskId.slice(0, 8),
          raison: b.issue === 'declenche' ? undefined : b.issue
        })
    }
  })
  let mailPolling = false
  setInterval(() => {
    if (mailPolling || !ctx.watchdogEngine) return
    const listening = listeningChannels(scheduledTasks.listTasks())
    if (!listening.outlook && !(listening.teams && teamsSource)) return
    mailPolling = true
    void (async () => {
      if (listening.outlook) {
        try {
          await mailWatcher.watch(
            'outlook',
            await outlookGateway.snapshot(true),
            async (mail, full) => {
              if (!full) return describeMail(mail)
              // L'instantane coupe chaque corps a 800 caracteres (tuile d'accueil) : l'agent relit donc
              // ce seul mail en entier. Un echec de relecture garde l'apercu, et il se voit au journal.
              // fix-ok: MaxCorps=800 dans outlook-local-snapshot.ps1 — 54 mails sur 80 coupes pile a 800 (mesure 2026-09-26), describeMail recevait donc l'apercu.
              const complet = await outlookGateway.readBody(mail.id)
              if (!complet.ok)
                console.warn(
                  '[watchdog] mail relu en entier impossible, aperçu gardé :',
                  complet.erreur
                )
              return describeMail(complet.ok ? { ...mail, corps: complet.corps } : mail)
            }
          )
        } catch (error) {
          console.warn('[watchdog] lecture des mails impossible', error)
        }
      }
      // Un echec Teams ne prive pas les mails, et inversement. Source : Graph s'il est connecte,
      // sinon le stockage local du client Teams.
      if (listening.teams && teamsSource) {
        let snapshot: unknown
        try {
          const instantane = await teamsSource.snapshot()
          snapshot = instantane
          battementTeams(true)
          if (!lectureTeamsAnnoncee || derniereErreurTeams !== undefined)
            journalTeams('lecture-ok', { conversations: instantane.mails.length })
          lectureTeamsAnnoncee = true
          derniereErreurTeams = undefined
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          snapshot = { ok: false, erreur: message }
          battementTeams(false)
          console.warn('[watchdog] lecture Teams impossible :', message)
          if (message !== derniereErreurTeams)
            journalTeams('lecture-impossible', { erreur: message })
          derniereErreurTeams = message
        }
        try {
          await mailWatcher.watch('teams', snapshot, async (message) => {
            journalTeams('detecte', {
              conv: empreinteConversation(message.id),
              recuLe: message.recuLe ?? undefined
            })
            return describeTeamsMessage(message)
          })
        } catch (error) {
          console.warn('[watchdog] messages Teams non traités', error)
        }
      }
      mailPolling = false
    })()
  }, 60_000).unref?.()
  ipcMain.handle('outlook:snapshot', async (event, force: unknown) => {
    assertTrustedRendererSender(event, 'Outlook')
    return outlookGateway.snapshot(force === true)
  })
  // Canal DISTINCT de la lecture : ouvrir est un acte, lire n'en est pas un. Les separer garde la
  // garantie « lecture seule » de la passerelle lisible d'un coup d'oeil.
  ipcMain.handle('outlook:ouvrir', async (event, id: unknown) => {
    assertTrustedRendererSender(event, 'Outlook')
    return outlookGateway.openItem(id)
  })
  // OUVRE une piece jointe RECUE : Outlook la copie dans un dossier temporaire, Windows
  // l'ouvre. Rien n'est ecrit dans la boite. Identifiant, rang et nom sont revalides cote main, et un
  // type de fichier qui LANCE un programme (liste « Level 1 » d'Outlook) est refuse avant tout script.
  ipcMain.handle(
    'outlook:ouvrir-piece',
    async (event, id: unknown, rang: unknown, nom: unknown) => {
      assertTrustedRendererSender(event, 'Outlook')
      return outlookGateway.openAttachment(id, rang, nom)
    }
  )
  // Le seul canal Outlook qui ECRIT : il envoie une reponse, donc un acte irreversible. La
  // confirmation appartient a l'interface, qui est le seul endroit ou l'utilisateur est present ; ici
  // on garde la validation du contenu, parce qu'une frontiere de confiance ne se garde pas d'un cote.
  // Les PIECES JOINTES arrivent en contenu (base64) et non en chemin, comme pour un message neuf :
  // un fichier glisse depuis Outlook n'existe pas sur le disque. Elles sont donc revalidees par la
  // passerelle -- nom, forme du base64, taille -- avant de redevenir des fichiers dans un dossier
  // temporaire.
  ipcMain.handle(
    'outlook:repondre',
    async (event, id: unknown, corps: unknown, pieces: unknown) => {
      assertTrustedRendererSender(event, 'Outlook')
      return outlookGateway.replyToItem(id, corps, pieces)
    }
  )
  // MARQUE des messages comme lus. Ecrit aussi dans la boite, mais rien n'en sort : declenche par le
  // geste de l'utilisateur qui OUVRE un fil, jamais par la relecture periodique -- une relecture qui
  // marque lu viderait la boite de ses non-lus pendant qu'il regarde ailleurs.
  ipcMain.handle('outlook:marquer-lu', async (event, ids: unknown) => {
    assertTrustedRendererSender(event, 'Outlook')
    return outlookGateway.markRead(ids)
  })
  // ENVOIE un message NEUF, hors de tout fil existant : une adresse, un objet, un premier message.
  // Il ECRIT et il SORT du poste, comme `outlook:repondre`, mais rien n'est herite d'un element
  // existant -- l'adresse vient d'une saisie. Elle est donc contrainte a un motif ASCII cote main
  // AVANT de partir dans un appel COM, et l'objet comme le corps voyagent par des fichiers
  // temporaires : jamais concatenes dans une ligne de commande.
  // Les PIECES JOINTES arrivent en contenu (base64) et non en chemin : un fichier glisse depuis
  // Outlook n'existe pas sur le disque. Elles sont donc revalidees par la passerelle -- nom, forme
  // du base64, taille -- avant de redevenir des fichiers dans un dossier temporaire.
  ipcMain.handle(
    'outlook:nouveau-message',
    async (event, adresse: unknown, objet: unknown, corps: unknown, pieces: unknown) => {
      assertTrustedRendererSender(event, 'Outlook')
      return outlookGateway.sendNew(adresse, objet, corps, pieces)
    }
  )
  return { mailMemory, teamsClient }
}
