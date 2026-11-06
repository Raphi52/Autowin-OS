/**
 * Moteur `grok` (Grok Build, CLI officiel d'xAI) — Grok par l'ABONNEMENT SuperGrok, sans clé
 * (2026-11-04, conv-1499). Règle de l'utilisateur : Grok passe par le CLI d'xAI, jamais par
 * l'API directe avec XAI_API_KEY — d'où la clé RETIRÉE de l'environnement du processus : sans elle,
 * grok ne peut se servir que de la session ouverte par `grok login` (~/.grok/auth.json).
 *
 * Calqué sur agy : un processus par tour, `--prompt-file … --output-format streaming-json`.
 * Le fil part dans un FICHIER, jamais en argument (limite de 32 767 caractères de la ligne de
 * commande Windows, cf. spawn ENAMETOOLONG d'agy).
 *
 * Format : doc livrée avec grok 1.0.70 (~/.grok/docs/user-guide/14-headless-mode.md) — une ligne
 * JSON par événement, `type` = text | thought | tool_call | … | end | error. Mesuré sans connexion :
 * `{"type":"error","message":"Not signed in. …"}`.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planProviderLogin, spawnLoginTerminal } from './provider-login'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk, Usage } from './types'

export const GROK_PROVIDER_ID = 'grok'

export const GROK_CONNEXION_REQUISE =
  "grok n'est pas connecté à ton compte SuperGrok — lance une fois `grok login` dans un terminal (bouton « Se connecter » du moteur) puis réessaie"

/** Emplacement de l'installeur officiel (`~/.grok/bin`) ; le PATH n'est hérité qu'après redémarrage. */
export function resolveGrokBin(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync
): string | undefined {
  const explicite = env.AUTOWIN_GROK_BIN?.trim()
  if (explicite && exists(explicite)) return explicite
  const candidats: string[] = []
  if (env.USERPROFILE) candidats.push(join(env.USERPROFILE, '.grok', 'bin', 'grok.exe'))
  for (const dossier of (env.PATH ?? env.Path ?? '').split(';')) {
    if (dossier.trim()) candidats.push(join(dossier.trim(), 'grok.exe'))
  }
  return candidats.find((c) => exists(c))
}

export interface GrokFin {
  stopReason?: string
  sessionId?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

export type LigneGrok =
  | { kind: 'texte'; texte: string }
  | { kind: 'fin'; fin: GrokFin }
  | { kind: 'erreur'; message: string }
  | { kind: 'ignore' }

/** Lit UNE ligne de sortie. Ligne vide, coupée ou non JSON → ignorée (jamais d'exception). */
export function lireLigneGrok(ligne: string): LigneGrok {
  const brut = ligne.trim()
  if (!brut.startsWith('{')) return { kind: 'ignore' }
  let evt: Record<string, unknown>
  try {
    evt = JSON.parse(brut) as Record<string, unknown>
  } catch {
    return { kind: 'ignore' }
  }
  if (evt.type === 'text' && typeof evt.data === 'string' && evt.data) {
    return { kind: 'texte', texte: evt.data }
  }
  if (evt.type === 'end') return { kind: 'fin', fin: evt as GrokFin }
  if (evt.type === 'error') {
    return { kind: 'erreur', message: typeof evt.message === 'string' ? evt.message : '' }
  }
  return { kind: 'ignore' }
}

function estErreurConnexion(message: string): boolean {
  return /not signed in|not authenticated|grok login/i.test(message)
}

function promptDuFil(messages: Message[], system?: string): string {
  const parties: string[] = []
  if (system) parties.push(system)
  for (const m of messages) {
    const joints = (m.attachments ?? [])
      .filter((a) => a.kind === 'text')
      .map((a) => `\n\n[Pièce jointe ${a.name}]\n${a.content}`)
      .join('')
    parties.push(messages.length > 1 ? `[${m.role}]\n${m.content}${joints}` : m.content + joints)
  }
  return parties.join('\n\n')
}

/** Environnement du processus SANS clé d'API xAI : seule la session d'abonnement peut servir. */
export function envSansCleXai(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copie = { ...env }
  delete copie.XAI_API_KEY
  return copie
}

type SpawnLike = typeof spawn

export class GrokAdapter implements ProviderAdapter {
  readonly id = GROK_PROVIDER_ID
  readonly supportsExecution = true
  readonly honoursSessionResume = false

  constructor(
    private readonly deps: { bin?: () => string | undefined; spawnFn?: SpawnLike } = {}
  ) {}

  private bin(): string | undefined {
    return (this.deps.bin ?? resolveGrokBin)()
  }

  /** Programme présent = prêt ; une session absente se voit au premier tour (message de connexion). */
  async auth(): Promise<boolean> {
    return this.bin() !== undefined
  }

  startLogin(): void {
    spawnLoginTerminal(planProviderLogin(GROK_PROVIDER_ID, this.bin()).command)
  }

  async *send(
    messages: Message[],
    opts: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const bin = this.bin()
    if (!bin) throw new Error('grok introuvable — installe Grok Build (https://x.ai/cli)')
    const model = opts.model && opts.model !== 'default' ? opts.model : undefined
    const dossier = mkdtempSync(join(tmpdir(), 'autowin-grok-'))
    const fichier = join(dossier, 'prompt.txt')
    writeFileSync(fichier, promptDuFil(messages, opts.system), 'utf8')
    const args = ['--prompt-file', fichier, '--output-format', 'streaming-json', '--no-auto-update']
    if (model) args.push('--model', model)
    if (opts.execution?.cwd) args.push('--cwd', opts.execution.cwd, '--always-approve')
    const enfant = (this.deps.spawnFn ?? spawn)(bin, args, {
      cwd: opts.execution?.cwd,
      env: envSansCleXai(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const arreter = (): void => {
      try {
        enfant.kill()
      } catch {
        /* déjà mort */
      }
    }
    opts.signal?.addEventListener('abort', arreter, { once: true })

    const file: LigneGrok[] = []
    let reveil: (() => void) | undefined
    let fini = false
    let reste = ''
    const pousser = (l: LigneGrok): void => {
      file.push(l)
      reveil?.()
    }
    enfant.stdout?.setEncoding('utf8')
    enfant.stdout?.on('data', (morceau: string) => {
      reste += morceau
      const lignes = reste.split(/\r?\n/)
      reste = lignes.pop() ?? ''
      for (const l of lignes) pousser(lireLigneGrok(l))
    })
    const terminer = (): void => {
      if (fini) return
      if (reste) pousser(lireLigneGrok(reste))
      reste = ''
      fini = true
      reveil?.()
    }
    enfant.on('close', terminer)
    enfant.on('error', terminer)

    let texte = ''
    try {
      for (;;) {
        const l = file.shift()
        if (!l) {
          if (fini) break
          await new Promise<void>((r) => (reveil = r))
          reveil = undefined
          continue
        }
        if (l.kind === 'erreur') {
          throw new Error(
            estErreurConnexion(l.message)
              ? GROK_CONNEXION_REQUISE
              : `grok : ${l.message || 'échec sans détail'}`
          )
        }
        if (l.kind === 'texte') {
          texte += l.texte
          yield { delta: l.texte }
          continue
        }
        if (l.kind === 'fin') {
          const u = l.fin.usage
          const usage: Usage | undefined = u
            ? { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 }
            : undefined
          return {
            text: texte,
            provider: this.id,
            sessionId: l.fin.sessionId || undefined,
            systemInjected: Boolean(opts.system),
            usage,
            model: model ?? 'default'
          }
        }
      }
      if (opts.signal?.aborted) throw new Error('grok : tour interrompu')
      throw new Error('grok : le programme s’est arrêté sans rendre de résultat')
    } finally {
      opts.signal?.removeEventListener('abort', arreter)
      arreter()
      rmSync(dossier, { recursive: true, force: true })
    }
  }
}

/** Catalogue : le modèle par défaut de grok, proposé seulement si le programme est présent. */
export function modelesGrok(resoudre: () => string | undefined = resolveGrokBin): Array<{
  id: string
  provider: string
  model: string
  label: string
  reasoningEfforts: Array<'none'>
  defaultReasoningEffort: 'none'
  dynamicallyLoaded: boolean
}> {
  if (!resoudre()) return []
  return [
    {
      id: `${GROK_PROVIDER_ID}/default`,
      provider: GROK_PROVIDER_ID,
      model: 'default',
      label: 'Grok (abonnement SuperGrok)',
      reasoningEfforts: ['none'],
      defaultReasoningEffort: 'none',
      dynamicallyLoaded: true
    }
  ]
}
