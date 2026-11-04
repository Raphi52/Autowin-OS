/**
 * Moteur `agy` (Antigravity CLI de Google) — Gemini par l'ABONNEMENT ou le compte Google, sans clé
 * (2026-11-04, conv-1499). Depuis juin 2026, Gemini CLI ne sert plus que par clé ; la connexion par
 * compte passe par agy. Calqué sur Codex : un processus par tour, `-p … --output-format stream-json`.
 *
 * Format mesuré (agy 1.5.0, sans connexion) : la fin du tour est UNE ligne JSON
 * `{"event":"result","result":{"status":"ERROR"|…,"response":"…","error":"…","usage":{…}}}`.
 * Les événements intermédiaires n'ont pas pu être mesurés sans connexion : ils sont lus de façon
 * tolérante (tout champ texte connu), et c'est `result.response` qui fait foi en fin de tour.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { planProviderLogin, spawnLoginTerminal } from '../provider-login'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk, Usage } from './types'

export const AGY_PROVIDER_ID = 'agy'

/** Message rendu quand agy réclame une connexion : le tour échoue tout de suite, sans attendre 60 s. */
export const AGY_CONNEXION_REQUISE =
  "agy n'est pas connecté à ton compte Google — lance une fois agy dans un terminal (bouton « Se connecter » du moteur) puis réessaie"

/** Emplacement de l'installeur officiel ; le PATH n'est hérité qu'après redémarrage de l'app. */
export function resolveAgyBin(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync
): string | undefined {
  const explicite = env.AUTOWIN_AGY_BIN?.trim()
  if (explicite && exists(explicite)) return explicite
  const candidats: string[] = []
  if (env.LOCALAPPDATA) candidats.push(join(env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'))
  for (const dossier of (env.PATH ?? env.Path ?? '').split(';')) {
    if (dossier.trim()) candidats.push(join(dossier.trim(), 'agy.exe'))
  }
  return candidats.find((c) => exists(c))
}

export interface AgyResultat {
  status?: string
  response?: string
  error?: string
  conversation_id?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

export type LigneAgy =
  | { kind: 'texte'; texte: string }
  | { kind: 'resultat'; resultat: AgyResultat }
  | { kind: 'connexion' }
  | { kind: 'ignore' }

/** Lit UNE ligne de sortie. Ligne vide, coupée ou non JSON → ignorée (jamais d'exception). */
export function lireLigneAgy(ligne: string): LigneAgy {
  const brut = ligne.trim()
  if (!brut) return { kind: 'ignore' }
  if (/^Authentication required/i.test(brut)) return { kind: 'connexion' }
  if (!brut.startsWith('{')) return { kind: 'ignore' }
  let evt: Record<string, unknown>
  try {
    evt = JSON.parse(brut) as Record<string, unknown>
  } catch {
    return { kind: 'ignore' }
  }
  if (evt.event === 'result' && evt.result && typeof evt.result === 'object') {
    return { kind: 'resultat', resultat: evt.result as AgyResultat }
  }
  // Format réel mesuré (agy 1.5.0, connecté, conv-1499) : le texte arrive en
  // step_update.text_delta sur les étapes « agent_response ».
  const etape = evt.step_update as Record<string, unknown> | undefined
  if (evt.event === 'step_update' && etape && typeof etape === 'object') {
    const d = etape.text_delta
    if (etape.step_type === 'agent_response' && typeof d === 'string' && d) {
      return { kind: 'texte', texte: d }
    }
    return { kind: 'ignore' }
  }
  for (const champ of ['delta', 'text', 'content']) {
    const v = evt[champ]
    if (typeof v === 'string' && v) return { kind: 'texte', texte: v }
  }
  return { kind: 'ignore' }
}

function estErreurConnexion(r: AgyResultat): boolean {
  return /authenticat|log ?in|sign ?in/i.test(r.error ?? '')
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

type SpawnLike = typeof spawn

export class AgyAdapter implements ProviderAdapter {
  readonly id = AGY_PROVIDER_ID
  readonly supportsExecution = true
  readonly honoursSessionResume = false

  constructor(
    private readonly deps: { bin?: () => string | undefined; spawnFn?: SpawnLike } = {}
  ) {}

  private bin(): string | undefined {
    return (this.deps.bin ?? resolveAgyBin)()
  }

  /** Programme présent = prêt ; une session expirée se voit au premier tour (message de connexion). */
  async auth(): Promise<boolean> {
    return this.bin() !== undefined
  }

  /** agy n'est pas sur le PATH de l'app : on lui passe son chemin résolu. */
  startLogin(): void {
    spawnLoginTerminal(planProviderLogin(AGY_PROVIDER_ID, this.bin()).command)
  }

  async *send(
    messages: Message[],
    opts: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const bin = this.bin()
    if (!bin) throw new Error('agy introuvable — installe Antigravity CLI (agy.exe absent)')
    const model = opts.model && opts.model !== 'default' ? opts.model : undefined
    // Le fil part par stdin (une ligne NDJSON), jamais en argument : un long fil dépassait la
    // limite de 32 767 caractères de la ligne de commande Windows → spawn ENAMETOOLONG
    // (conv-1499, 2026-11-04). `-p=` vide + --input-format stream-json : accepté par agy 1.5.0.
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '-p=']
    if (model) args.push('--model', model)
    if (opts.execution?.cwd) args.push('--dangerously-skip-permissions')
    const enfant = (this.deps.spawnFn ?? spawn)(bin, args, {
      cwd: opts.execution?.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    enfant.stdin?.on('error', () => {
      /* agy mort avant d'avoir lu : son événement close signale la fin */
    })
    enfant.stdin?.end(
      JSON.stringify({
        event: 'user',
        message: { role: 'user', content: promptDuFil(messages, opts.system) }
      }) + '\n'
    )
    const arreter = (): void => {
      try {
        enfant.kill()
      } catch {
        /* déjà mort */
      }
    }
    opts.signal?.addEventListener('abort', arreter, { once: true })

    const file: LigneAgy[] = []
    let reveil: (() => void) | undefined
    let fini = false
    let reste = ''
    const pousser = (l: LigneAgy): void => {
      file.push(l)
      reveil?.()
    }
    enfant.stdout?.setEncoding('utf8')
    enfant.stdout?.on('data', (morceau: string) => {
      reste += morceau
      const lignes = reste.split(/\r?\n/)
      reste = lignes.pop() ?? ''
      for (const l of lignes) pousser(lireLigneAgy(l))
    })
    const terminer = (): void => {
      if (fini) return
      if (reste) pousser(lireLigneAgy(reste))
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
        if (l.kind === 'connexion') throw new Error(AGY_CONNEXION_REQUISE)
        if (l.kind === 'texte') {
          texte += l.texte
          yield { delta: l.texte }
          continue
        }
        if (l.kind === 'resultat') {
          const r = l.resultat
          if (r.status === 'ERROR') {
            throw new Error(
              estErreurConnexion(r)
                ? AGY_CONNEXION_REQUISE
                : `agy : ${r.error || 'échec sans détail'}`
            )
          }
          const final = r.response ?? texte
          if (final.length > texte.length && final.startsWith(texte))
            yield { delta: final.slice(texte.length) }
          const usage: Usage | undefined = r.usage
            ? { inputTokens: r.usage.input_tokens ?? 0, outputTokens: r.usage.output_tokens ?? 0 }
            : undefined
          return {
            text: final,
            provider: this.id,
            sessionId: r.conversation_id || undefined,
            systemInjected: Boolean(opts.system),
            usage,
            model: model ?? 'default'
          }
        }
      }
      if (opts.signal?.aborted) throw new Error('agy : tour interrompu')
      throw new Error('agy : le programme s’est arrêté sans rendre de résultat')
    } finally {
      opts.signal?.removeEventListener('abort', arreter)
      arreter()
    }
  }
}

/** Entrée du catalogue : le modèle par défaut d'agy, proposé seulement si le programme est présent. */
export function modelesAgy(resoudre: () => string | undefined = resolveAgyBin): Array<{
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
      id: `${AGY_PROVIDER_ID}/default`,
      provider: AGY_PROVIDER_ID,
      model: 'default',
      label: 'Gemini (agy, abonnement Google)',
      reasoningEfforts: ['none'],
      defaultReasoningEffort: 'none',
      dynamicallyLoaded: true
    }
  ]
}
