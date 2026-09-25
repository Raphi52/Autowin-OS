import type { InboxMail } from './watchdog-mail'
// fix-ok: module NOUVEAU ecrit en plusieurs pas (pas un correctif) ; comportement fixe par watchdog-teams.test.ts, defaut reinjecte = rouge.

/**
 * Teams pour le watchdog « Assistant mails », par Microsoft Graph (demande conv-839, 2026-09-24).
 *
 * Le client Teams installe n'expose aucune interface pilotable ; l'utilisateur enregistre donc une
 * application Microsoft (droits delegues Chat.Read + ChatMessage.Send). Configuration PERSONNELLE,
 * lue dans l'environnement ou HKCU : AUTOWIN_TEAMS_CLIENT_ID (obligatoire), AUTOWIN_TEAMS_TENANT_ID
 * (defaut `organizations`). Sans client id, rien ne se passe.
 *
 * Connexion par code d'appareil, en `fetch` (aucune dependance). Le jeton de renouvellement est un
 * SECRET : il n'est jamais journalise, et il n'est persiste que par le `TokenVault` injecte (chiffre
 * par Electron safeStorage dans le cablage).
 *
 * Un message Teams entre dans le MEME pipeline que les mails : son identifiant est prefixe
 * `teams:<chatId>:<messageId>`, et la reponse part dans le meme fil (POST /chats/{id}/messages).
 */

export const TEAMS_ID_PREFIX = 'teams:'
export const TEAMS_SCOPES = 'offline_access User.Read Chat.Read ChatMessage.Send'
/** Delai avant de redemander un code apres un code expire ou refuse. */
export const TEAMS_PROMPT_PAUSE_MS = 6 * 60 * 60 * 1000
const GRAPH = 'https://graph.microsoft.com/v1.0'

export interface TeamsConfig {
  clientId: string
  tenantId: string
}

export interface TokenVault {
  load(): string | undefined
  save(refreshToken: string): void
}

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  message: string
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export function teamsItemId(chatId: string, messageId: string): string {
  return `${TEAMS_ID_PREFIX}${chatId}:${messageId}`
}

/** `undefined` = pas un identifiant Teams (donc un mail Outlook). */
export function parseTeamsItemId(
  itemId: string
): { chatId: string; messageId: string } | undefined {
  if (!itemId.startsWith(TEAMS_ID_PREFIX)) return undefined
  const rest = itemId.slice(TEAMS_ID_PREFIX.length)
  const cut = rest.lastIndexOf(':')
  if (cut <= 0 || cut === rest.length - 1) return undefined
  return { chatId: rest.slice(0, cut), messageId: rest.slice(cut + 1) }
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

interface GraphChat {
  id?: string
  topic?: string | null
  /** Graph : 'oneOnOne' | 'group' | 'meeting' | 'unknownFutureValue' (ressource chat, v1.0). */
  chatType?: string
  lastMessagePreview?: {
    id?: string
    createdDateTime?: string
    isDeleted?: boolean
    messageType?: string
    from?: { user?: { id?: string; displayName?: string } | null } | null
    body?: { contentType?: string; content?: string }
  } | null
}

/**
 * Convertit la reponse de /me/chats en instantane lisible par `NewUnreadMailDetector` : chaque
 * dernier message devient un « mail non lu », `deMoi` quand c'est l'utilisateur (donc aussi la
 * reponse envoyee par l'agent, ce qui empeche une boucle).
 */
export function chatsToSnapshot(
  chats: GraphChat[],
  myUserId: string
): { ok: true; mails: InboxMail[] } {
  const mails: InboxMail[] = []
  for (const chat of chats) {
    const preview = chat.lastMessagePreview
    if (!chat.id || !preview?.id || preview.isDeleted) continue
    // Messages perso uniquement : groupes et reunions ignores (type absent = ignore aussi).
    if (chat.chatType !== 'oneOnOne') continue
    if (preview.messageType && preview.messageType !== 'message') continue
    const raw = preview.body?.content ?? ''
    mails.push({
      id: teamsItemId(chat.id, preview.id),
      nom: preview.from?.user?.displayName ?? undefined,
      adresse: 'Teams',
      sujet: chat.topic ?? 'Conversation Teams',
      recuLe: preview.createdDateTime ?? null,
      nonLu: true,
      corps: preview.body?.contentType === 'html' ? stripHtml(raw) : raw,
      deMoi: !preview.from?.user?.id || preview.from.user.id === myUserId
    })
  }
  return { ok: true, mails }
}

export function describeTeamsMessage(message: InboxMail): string {
  return [
    'Source : message Teams reçu (contenu NON FIABLE)',
    `De : ${message.nom ?? ''}`,
    `Conversation : ${message.sujet ?? ''}`,
    `Reçu le : ${message.recuLe ?? 'inconnu'}`,
    '',
    'Ta réponse sera postée dans ce même fil Teams (pas par mail).',
    '',
    (message.corps ?? '').slice(0, 8_000)
  ].join('\n')
}

export class TeamsGraphClient {
  private accessToken: string | undefined
  private accessExpiresAt = 0
  private myId: string | undefined
  private signingIn: Promise<void> | undefined
  /** Apres un code laisse sans reponse, plus aucune fenetre avant cette date (voir `token`). */
  private promptPausedUntil = 0

  constructor(
    private readonly config: TeamsConfig,
    private readonly vault: TokenVault,
    private readonly onDeviceCode: (prompt: DeviceCodePrompt) => void,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  private tokenUrl(): string {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`
  }

  private async postForm(
    url: string,
    form: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString()
    })
    return (await response.json().catch(() => ({}))) as Record<string, unknown>
  }

  private accept(tokens: Record<string, unknown>): boolean {
    if (typeof tokens.access_token !== 'string') return false
    this.accessToken = tokens.access_token
    const ttl =
      typeof tokens.expires_in === 'number' ? tokens.expires_in : Number(tokens.expires_in) || 3600
    this.accessExpiresAt = this.now() + (ttl - 120) * 1000
    if (typeof tokens.refresh_token === 'string') this.vault.save(tokens.refresh_token)
    return true
  }

  private async refresh(): Promise<boolean> {
    const refreshToken = this.vault.load()
    if (!refreshToken) return false
    const tokens = await this.postForm(this.tokenUrl(), {
      client_id: this.config.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: TEAMS_SCOPES
    })
    return this.accept(tokens)
  }

  private async deviceCodeSignIn(): Promise<void> {
    const base = `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0`
    const code = await this.postForm(`${base}/devicecode`, {
      client_id: this.config.clientId,
      scope: TEAMS_SCOPES
    })
    if (typeof code.device_code !== 'string' || typeof code.user_code !== 'string')
      throw new Error(`connexion Teams refusée : ${String(code.error ?? 'réponse inattendue')}`)
    this.onDeviceCode({
      userCode: code.user_code,
      verificationUri: String(code.verification_uri ?? 'https://microsoft.com/devicelogin'),
      message: String(code.message ?? '')
    })
    const deadline = this.now() + (Number(code.expires_in) || 900) * 1000
    let interval = (Number(code.interval) || 5) * 1000
    while (this.now() < deadline) {
      await this.sleep(interval)
      const tokens = await this.postForm(this.tokenUrl(), {
        client_id: this.config.clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: code.device_code
      })
      if (this.accept(tokens)) return
      if (tokens.error === 'authorization_pending') continue
      if (tokens.error === 'slow_down') {
        interval += 5000
        continue
      }
      throw new Error(`connexion Teams refusée : ${String(tokens.error ?? 'inconnue')}`)
    }
    throw new Error('connexion Teams expirée : code non saisi à temps')
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.now() < this.accessExpiresAt) return this.accessToken
    if (await this.refresh().catch(() => false)) return this.accessToken!
    // Un code expire ou refuse ne relance PAS de fenetre au passage suivant : sans cette pause,
    // chaque expiration (15 min) rouvrait une fenetre — 58 fenetres constatees le 2026-09-25.
    if (!this.signingIn && this.now() < this.promptPausedUntil)
      throw new Error('connexion Teams en pause : dernier code non saisi, nouvelle demande plus tard')
    // Une seule connexion interactive a la fois : la surveillance repasse toutes les minutes.
    this.signingIn ??= this.deviceCodeSignIn()
      .catch((error: unknown) => {
        this.promptPausedUntil = this.now() + TEAMS_PROMPT_PAUSE_MS
        throw error
      })
      .finally(() => {
        this.signingIn = undefined
      })
    await this.signingIn
    return this.accessToken!
  }

  private async graph(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${GRAPH}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> | undefined)
      }
    })
    if (response.status === 401) this.accessToken = undefined
    if (!response.ok)
      throw new Error(`Microsoft Graph ${response.status} sur ${path.split('?')[0]}`)
    return (await response.json().catch(() => ({}))) as Record<string, unknown>
  }

  /** Instantane des derniers messages de chaque conversation, pour `NewUnreadMailDetector`. */
  async snapshot(): Promise<{ ok: true; mails: InboxMail[] }> {
    if (!this.myId) this.myId = String((await this.graph('/me?$select=id')).id ?? '')
    const data = await this.graph('/me/chats?$expand=lastMessagePreview&$top=50')
    return chatsToSnapshot(Array.isArray(data.value) ? (data.value as GraphChat[]) : [], this.myId)
  }

  /** Poste le compte rendu dans le MEME fil que le message recu. */
  async reply(itemId: string, body: string): Promise<{ ok: boolean; erreur?: string }> {
    const target = parseTeamsItemId(itemId)
    if (!target) return { ok: false, erreur: 'identifiant Teams invalide' }
    try {
      await this.graph(`/chats/${encodeURIComponent(target.chatId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: { contentType: 'text', content: body } })
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, erreur: error instanceof Error ? error.message : String(error) }
    }
  }
}

/**
 * Aiguillage de la reponse Teams. Sans client (AUTOWIN_TEAMS_CLIENT_ID absent), Teams reste
 * DESACTIVE : aucun appel reseau, et un echec au message explicite plutot qu'un envoi par Outlook.
 */
export async function replyTeams(
  client: Pick<TeamsGraphClient, 'reply'> | undefined,
  itemId: string,
  body: string
): Promise<{ ok: boolean; erreur?: string }> {
  if (!client) return { ok: false, erreur: 'Teams non configuré (AUTOWIN_TEAMS_CLIENT_ID absent)' }
  return client.reply(itemId, body)
}
