// fix-ok: messages 1:1 = conversationId en @unq.gbl.spaces, auteur = isSentByCurrentUser (mesure sur le vrai stockage : 27 conversations 1:1) — les editions ont aligne le lecteur sur ces champs. Garde destinataire (code 6) : titre de fenetre verifie avant saisie et avant Entree, prouvee rouge sans elle.
import { execFile } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { latestValues, readLog, readTable, type LevelEntry } from './leveldb-lite'
import { decodeIndexedDbValue } from './v8-value-lite'
import type { InboxMail } from './watchdog-mail'
import { parseTeamsItemId, stripHtml, teamsItemId } from './watchdog-teams'

/**
 * Teams SANS connexion Microsoft (demande conv-854, 2026-09-25 : l'utilisateur ne peut pas se
 * connecter lui-meme ; voie 1 + voie 2).
 *
 * Voie 1 — LECTURE : le client Teams deja connecte garde ses messages dans son IndexedDB
 * (WebView2). On COPIE les fichiers dans un dossier temporaire (le client les verrouille, et on
 * n'ecrit jamais dans son dossier), on les decode, on supprime la copie.
 * Forme constatee le 2026-09-25 : objets « fil de reponses » `{ conversationId, messageMap }`, chaque
 * message portant `id`, `messageType`, `content`, `imDisplayName`, `creator`, `originalArrivalTime`,
 * `isSentByCurrentUser`. Conversation 1:1 = identifiant finissant par `@unq.gbl.spaces`.
 *
 * Voie 2 — REPONSE : pilote la fenetre Teams de l'ecran reel (autorisation explicite de
 * l'utilisateur pour cette fonction) : lien profond vers la conversation, puis collage + Entree,
 * chaque touche precedee d'une verification que Teams est au premier plan. Aucun jeton, aucun mot
 * de passe.
 */

export function teamsLocalStoreDir(): string {
  return join(
    process.env.LOCALAPPDATA ?? '',
    'Packages',
    'MSTeams_8wekyb3d8bbwe',
    'LocalCache',
    'Microsoft',
    'MSTeams',
    'EBWebView',
    'WV2Profile_tfw',
    'IndexedDB',
    'https_teams.microsoft.com_0.indexeddb.leveldb'
  )
}

const ONE_ON_ONE = /@unq\.gbl\.spaces$/
const READABLE = new Set(['RichText/Html', 'Text'])

interface LocalMessage {
  id?: unknown
  conversationId?: unknown
  messageType?: unknown
  contentType?: unknown
  content?: unknown
  imDisplayName?: unknown
  creator?: unknown
  originalArrivalTime?: unknown
  isSentByCurrentUser?: unknown
  deletionInfo?: unknown
  properties?: unknown
}

function arrival(message: LocalMessage): number {
  const raw = message.originalArrivalTime
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') return Number(raw) || Date.parse(raw) || 0
  return 0
}

function isDeleted(message: LocalMessage): boolean {
  const props = message.properties as Record<string, unknown> | undefined
  return Boolean(props && props.deletetime) || Boolean(message.deletionInfo)
}

export interface LocalTeamsSnapshot {
  ok: true
  mails: InboxMail[]
  /** Adresse mail de l'expediteur par identifiant d'element, pour le repli par mail. */
  emails: Map<string, string>
  /** Nom affiche de l'expediteur par identifiant d'element : la reponse verifie que c'est bien sa conversation qui est ouverte. */
  noms: Map<string, string>
  /** Nombre de conversations 1:1 vues (preuve sans contenu). */
  conversations: number
}

/**
 * Valeurs decodees → instantane `NewUnreadMailDetector` : pour chaque conversation 1:1, le DERNIER
 * message lisible (comme `chatsToSnapshot` avec `lastMessagePreview`), `deMoi` pour les messages de
 * l'utilisateur — donc aussi la reponse postee par l'agent, ce qui empeche une boucle.
 */
export function localValuesToSnapshot(values: Iterable<unknown>): LocalTeamsSnapshot {
  const latest = new Map<string, LocalMessage>()
  const emailByMri = new Map<string, string>()
  // Heure de DERNIERE LECTURE par conversation : l'enregistrement de conversation (cle `id`) porte
  // properties.consumptionhorizon = « heureDeLecture;heure;idMessage » (format Skype/Teams, mesure sur
  // le stockage reel le 2026-09-26 ; le champ consumptionHorizon des chaines de reponses, lui, est vide).
  const luJusqua = new Map<string, number>()
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    const record = value as Record<string, unknown>
    if (typeof record.mri === 'string' && typeof record.email === 'string' && record.email)
      emailByMri.set(record.mri.toLowerCase(), record.email)
    const props = record.properties as Record<string, unknown> | undefined
    if (typeof record.id === 'string' && typeof props?.consumptionhorizon === 'string') {
      const lu = Number(props.consumptionhorizon.split(';')[0])
      if (Number.isFinite(lu) && lu > 0) luJusqua.set(record.id, lu)
    }
    const map = record.messageMap
    if (typeof record.conversationId !== 'string' || !map || typeof map !== 'object') continue
    if (!ONE_ON_ONE.test(record.conversationId)) continue
    for (const message of Object.values(map as Record<string, LocalMessage>)) {
      if (!message || typeof message !== 'object' || typeof message.id !== 'string') continue
      if (!READABLE.has(String(message.messageType)) || isDeleted(message)) continue
      const known = latest.get(record.conversationId)
      if (!known || arrival(message) > arrival(known)) latest.set(record.conversationId, message)
    }
  }
  const mails: InboxMail[] = []
  const emails = new Map<string, string>()
  const noms = new Map<string, string>()
  for (const [conversationId, message] of latest) {
    const id = teamsItemId(conversationId, String(message.id))
    const raw = typeof message.content === 'string' ? message.content : ''
    const when = arrival(message)
    const creator = typeof message.creator === 'string' ? message.creator.toLowerCase() : ''
    const email = emailByMri.get(creator)
    if (email) emails.set(id, email)
    if (typeof message.imDisplayName === 'string' && message.imDisplayName.trim())
      noms.set(id, message.imDisplayName.trim())
    const lu = luJusqua.get(conversationId)
    mails.push({
      id,
      nom: typeof message.imDisplayName === 'string' ? message.imDisplayName : undefined,
      // Vraie adresse quand la personne est connue du stockage ; « Teams » sinon (l'identite d'un
      // expediteur Teams reste son NOM pour le moteur : senderKey, watchdog-mail.ts).
      adresse: email ?? 'Teams',
      sujet: 'Conversation Teams',
      recuLe: when ? new Date(when).toISOString() : null,
      // Lu dans Teams = arrive au plus tard a l'heure de derniere lecture. Sans horizon connu, on ne
      // sait pas : non lu, comme avant (le detecteur ne reagit de toute facon qu'aux NOUVEAUX messages).
      nonLu: lu === undefined || when > lu,
      corps: String(message.messageType) === 'RichText/Html' ? stripHtml(raw) : raw,
      deMoi: message.isSentByCurrentUser === true
    })
  }
  return { ok: true, mails, emails, noms, conversations: latest.size }
}

/** Lit une COPIE du stockage (jamais le dossier du client lui-meme). */
export function readLocalTeamsStore(dir: string = teamsLocalStoreDir()): LocalTeamsSnapshot {
  if (!existsSync(dir)) throw new Error('stockage Teams local introuvable (nouveau Teams absent ?)')
  const copy = mkdtempSync(join(tmpdir(), 'autowin-teams-'))
  try {
    const entries: LevelEntry[] = []
    for (const name of readdirSync(dir)) {
      if (!/\.(ldb|log)$/.test(name)) continue
      const target = join(copy, name)
      try {
        copyFileSync(join(dir, name), target)
      } catch {
        continue // fichier supprime entre la liste et la copie (compactage) : ignore
      }
      const buf = readFileSync(target)
      try {
        entries.push(...(name.endsWith('.ldb') ? readTable(buf) : readLog(buf)))
      } catch {
        // table illisible : les autres suffisent
      }
    }
    const decoded: unknown[] = []
    for (const value of latestValues(entries).values()) {
      const v = decodeIndexedDbValue(value)
      if (v !== undefined) decoded.push(v)
    }
    return localValuesToSnapshot(decoded)
  } finally {
    // Le contenu des messages ne traine pas sur le disque.
    rmSync(copy, { recursive: true, force: true })
  }
}

type ReplyResult = { ok: boolean; erreur?: string }
export type PowerShellRunner = (
  scriptPath: string,
  env: Record<string, string>
) => Promise<{
  code: number
  stdout: string
}>

/** Codes de sortie du script de reponse → message d'echec (jamais un faux succes). */
export const LOCAL_REPLY_FAILURES: Record<number, string> = {
  2: 'Teams ne tourne pas (aucune fenêtre ms-teams)',
  3: 'la fenêtre Teams n’est pas passée au premier plan',
  4: 'zone de saisie Teams introuvable',
  5: 'Teams a perdu le premier plan pendant la saisie : envoi annulé',
  6: 'la conversation ouverte dans Teams n’est pas celle de l’expéditeur : envoi annulé'
}

/**
 * Script PowerShell de reponse. Conversation et texte arrivent par variables d'environnement
 * (aucune injection possible dans la ligne de commande). Chaque frappe est precedee d'une
 * verification : la fenetre au premier plan appartient a ms-teams, sinon arret (code 5).
 * Le presse-papiers de l'utilisateur est restaure a la fin.
 */
export const LOCAL_REPLY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class AwFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
$teams = @(Get-Process ms-teams -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($teams.Count -eq 0) { exit 2 }
$pids = @($teams | ForEach-Object { [uint32]$_.Id })
function Test-TeamsFront {
  $procId = [uint32]0
  [void][AwFg]::GetWindowThreadProcessId([AwFg]::GetForegroundWindow(), [ref]$procId)
  return $pids -contains $procId
}
Start-Process ("msteams:/l/chat/" + [uri]::EscapeDataString($env:AUTOWIN_TEAMS_CONV) + "/conversations")
Start-Sleep -Seconds 4
[void][AwFg]::SetForegroundWindow($teams[0].MainWindowHandle)
Start-Sleep -Milliseconds 500
if (-not (Test-TeamsFront)) { exit 3 }
# Garde anti-erreur de destinataire : le titre de la fenetre Teams (« Chat | <Nom> | Microsoft Teams »)
# doit contenir le nom de l'expediteur, sinon rien n'est tape (code 6).
function Test-BonneConversation {
  $titre = (Get-Process -Id $pids -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowTitle }) -join ' '
  return $env:AUTOWIN_TEAMS_EXPECT -and $titre.IndexOf($env:AUTOWIN_TEAMS_EXPECT, [StringComparison]::OrdinalIgnoreCase) -ge 0
}
if (-not (Test-BonneConversation)) { exit 6 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle([AwFg]::GetForegroundWindow())
$edit = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit))) |
  Where-Object { $_.Current.IsKeyboardFocusable -and $_.Current.Name -match 'message|Tapez|Type' } |
  Select-Object -Last 1
if (-not $edit) { exit 4 }
$edit.SetFocus()
Start-Sleep -Milliseconds 300
$saved = $null
try { $saved = Get-Clipboard -Raw } catch {}
try {
  Set-Clipboard -Value $env:AUTOWIN_TEAMS_BODY
  if (-not (Test-TeamsFront)) { exit 5 }
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 400
  if (-not (Test-TeamsFront)) { exit 5 }
  if (-not (Test-BonneConversation)) { exit 6 }
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 300
} finally {
  if ($null -ne $saved) { Set-Clipboard -Value $saved } else { Set-Clipboard -Value $null }
}
Write-Output 'OK'
exit 0
`

export const defaultPowerShellRunner: PowerShellRunner = (scriptPath, env) =>
  new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', scriptPath],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 60_000 },
      (error, stdout) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({ code, stdout: String(stdout ?? '') })
      }
    )
  })

/** Envoi d'un mail de repli (`OutlookLocalGateway.sendNew`). */
export type MailFallback = (adresse: string, objet: string, corps: string) => Promise<ReplyResult>

export class TeamsLocalClient {
  private emails = new Map<string, string>()
  private noms = new Map<string, string>()

  constructor(
    private readonly options: {
      read?: () => LocalTeamsSnapshot
      run?: PowerShellRunner
      mail?: MailFallback
      log?: (line: string) => void
    } = {}
  ) {}

  async snapshot(): Promise<{ ok: true; mails: InboxMail[] }> {
    const snap = (this.options.read ?? readLocalTeamsStore)()
    this.emails = snap.emails
    this.noms = snap.noms
    return { ok: true, mails: snap.mails }
  }

  /** Voie 2 ; en cas d'echec, repli par mail a l'expediteur si son adresse est connue. */
  async reply(itemId: string, body: string): Promise<ReplyResult> {
    const target = parseTeamsItemId(itemId)
    if (!target) return { ok: false, erreur: 'identifiant Teams invalide' }
    const attendu = this.noms.get(itemId)
    const teams: ReplyResult = attendu
      ? await this.postInTeams(target.chatId, body, attendu)
      : {
          ok: false,
          erreur: 'nom de l’expéditeur inconnu : impossible de vérifier la conversation ouverte'
        }
    if (teams.ok) return teams
    const log = this.options.log ?? ((line: string) => console.warn(line))
    log(`[watchdog] réponse Teams impossible : ${teams.erreur}`)
    const adresse = this.emails.get(itemId)
    if (!this.options.mail || !adresse)
      return { ok: false, erreur: `${teams.erreur} ; repli par mail impossible (adresse inconnue)` }
    const mailed = await this.options.mail(adresse, 'Réponse à ton message Teams', body)
    if (mailed.ok) {
      log('[watchdog] réponse envoyée par mail à la place de Teams')
      return { ok: true }
    }
    return {
      ok: false,
      erreur: `${teams.erreur} ; repli par mail en échec : ${mailed.erreur ?? ''}`
    }
  }

  private async postInTeams(
    conversationId: string,
    body: string,
    attendu: string
  ): Promise<ReplyResult> {
    if (process.platform !== 'win32' && !this.options.run)
      return { ok: false, erreur: 'Teams local disponible sous Windows uniquement' }
    const dir = mkdtempSync(join(tmpdir(), 'autowin-teams-reply-'))
    try {
      const script = join(dir, 'reply.ps1')
      // BOM : Windows PowerShell 5 lit sinon le script en ANSI.
      writeFileSync(script, '﻿' + LOCAL_REPLY_SCRIPT, 'utf8')
      const { code, stdout } = await (this.options.run ?? defaultPowerShellRunner)(script, {
        AUTOWIN_TEAMS_CONV: conversationId,
        AUTOWIN_TEAMS_BODY: body,
        AUTOWIN_TEAMS_EXPECT: attendu
      })
      if (code === 0 && stdout.includes('OK')) return { ok: true }
      return {
        ok: false,
        erreur: LOCAL_REPLY_FAILURES[code] ?? `échec du pilotage Teams (code ${code})`
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
