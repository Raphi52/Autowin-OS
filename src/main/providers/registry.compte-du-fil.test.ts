import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { estMurDeQuota } from '../../shared/reprise-quota'
import { ProviderRegistry, basculeApresQuota } from './registry'
import {
  ProviderCallError,
  type Message,
  type ProviderAdapter,
  type SendOptions,
  type SendResult,
  type StreamChunk
} from './types'

/**
 * LE COMPTE CHOISI POUR UN FIL N'EST JAMAIS REMPLACÉ EN SILENCE (conv-1416, 2026-11-01).
 *
 * Cas réel : conv-1403 réglé sur le compte pro, vide jusqu'au 3 novembre. Le tour a pourtant
 * tourné sur le compte gmail (`run-stdout/9049aaed-…`, session rangée dans `claude-accounts/compte-3`),
 * sans un mot dans le fil, et la barre de quota montrait gmail à côté de la puce du compte pro.
 * Choix de l'utilisateur : « si le compte choisi est vide, le tour s'arrête avec un message ».
 *
 * Le changement automatique reste la règle des fils SANS compte choisi (conv-1069, conv-1328).
 */
const REFUS = "You've hit your weekly limit · resets Nov 3, 1am (Europe/Paris)"
const refusDeQuota = (): ProviderCallError =>
  new ProviderCallError(`Claude a interrompu l'appel : ${REFUS}`, {
    code: 'success',
    retryable: false
  })

const UN_TOUR = [{ role: 'user' as const, content: 'travaille' }]

class FauxClaude implements ProviderAdapter {
  readonly id = 'claude'
  readonly supportsExecution = true
  appels = 0
  erreur: Error | undefined
  /** Un fragment de texte part avant l'erreur : la coupure en plein tour. */
  texteAvantErreur = false
  /** Refus décidé à chaque appel : il dépend du compte alors actif. */
  refuser: (() => boolean) | undefined

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    _messages: Message[],
    _options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.appels += 1
    if (this.refuser?.()) throw refusDeQuota()
    if (this.erreur) {
      if (this.texteAvantErreur) yield { delta: 'je commence' } as StreamChunk
      throw this.erreur
    }
    return { text: 'ok', provider: this.id, systemInjected: false }
  }
}

function monter(choisis: Record<string, string> = { 'conv-A': 'pro' }): {
  claude: FauxClaude
  registry: ProviderRegistry
  etat: { actif: string; rotations: number; bascules: number }
} {
  const claude = new FauxClaude()
  const etat = { actif: 'gmail', rotations: 0, bascules: 0 }
  const registry = new ProviderRegistry(
    undefined,
    undefined,
    () => etat.actif,
    (_provider, mure) => {
      etat.rotations += 1
      etat.actif = mure === 'gmail' ? 'pro' : 'gmail'
      return etat.actif
    },
    async () => {
      etat.bascules += 1
      return undefined
    },
    (_provider, fil) => {
      const id = fil ? choisis[fil] : undefined
      return id ? { id, nom: 'Compte pro' } : undefined
    }
  ).register(claude)
  return { claude, registry, etat }
}

describe('registre — fil au compte choisi', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T05:30:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('aucun changement de compte avant le lancement, même si le compte actif est un autre', async () => {
    const { registry, etat } = monter()
    await registry.send('claude', UN_TOUR, { conversationId: 'conv-A' })
    expect(etat.bascules).toBe(0)
    expect(etat.actif).toBe('gmail')
  })

  it('refus de quota : le tour s’arrête, sans rotation, avec un message qui dit quoi faire', async () => {
    const { claude, registry, etat } = monter()
    claude.erreur = refusDeQuota()

    const erreur = await registry
      .send('claude', UN_TOUR, { conversationId: 'conv-A' })
      .catch((e: Error) => e)

    expect(erreur).toBeInstanceOf(ProviderCallError)
    const message = (erreur as Error).message
    expect(message).toContain('« Compte pro »')
    expect(message).toContain('mardi 3 novembre')
    expect(message).toContain('choisis un autre compte')
    // Le refus d'origine reste cité : la reprise automatique relit son heure et son vocabulaire.
    expect(message).toContain(REFUS)
    expect(estMurDeQuota(message)).toBe(true)
    expect(claude.appels).toBe(1)
    expect(etat.rotations).toBe(0)
    expect(etat.actif).toBe('gmail')
  })

  it('compte déjà connu comme vide : rien n’est lancé, même message, aucune rotation', async () => {
    const { claude, registry, etat } = monter()
    claude.erreur = refusDeQuota()
    await registry.send('claude', UN_TOUR, { conversationId: 'conv-A' }).catch(() => undefined)
    claude.erreur = undefined

    await expect(registry.send('claude', UN_TOUR, { conversationId: 'conv-A' })).rejects.toThrow(
      /« Compte pro ».*mardi 3 novembre/
    )
    expect(claude.appels).toBe(1)
    expect(etat.rotations).toBe(0)
  })

  it('coupure APRÈS du texte : aucune bascule marquée sur l’erreur, donc aucun rejeu', async () => {
    const { claude, registry, etat } = monter()
    claude.erreur = refusDeQuota()
    claude.texteAvantErreur = true

    const erreur = await registry
      .send('claude', UN_TOUR, { conversationId: 'conv-A' }, () => {})
      .catch((e: Error) => e)

    expect((erreur as Error).message).toContain('« Compte pro »')
    expect(basculeApresQuota(erreur)).toBeUndefined()
    expect(etat.rotations).toBe(0)
  })

  it('le fil d’un run compte aussi : un agent orchestré ne change pas de compte', async () => {
    const { claude, registry, etat } = monter()
    claude.erreur = refusDeQuota()

    await registry
      .send('claude', UN_TOUR, {
        execution: {
          cwd: 'D:/copie',
          sandbox: 'read-only',
          agentEnv: { AUTOWIN_CONVERSATION_ID: 'conv-A' }
        }
      })
      .catch(() => undefined)

    expect(claude.appels).toBe(1)
    expect(etat.rotations).toBe(0)
    expect(etat.bascules).toBe(0)
  })

  it('le compte vide d’un fil ne ferme pas la porte du compte actif aux autres fils', async () => {
    const { claude, registry } = monter()
    claude.erreur = refusDeQuota()
    await registry.send('claude', UN_TOUR, { conversationId: 'conv-A' }).catch(() => undefined)
    claude.erreur = undefined

    await expect(registry.send('claude', UN_TOUR, { conversationId: 'conv-B' })).resolves.toEqual(
      expect.objectContaining({ text: 'ok' })
    )
    expect(claude.appels).toBe(2)
  })

  it('témoin — fil SANS compte choisi : le changement automatique continue', async () => {
    const { claude, registry, etat } = monter()
    claude.refuser = () => etat.actif === 'gmail'

    await expect(registry.send('claude', UN_TOUR, { conversationId: 'conv-B' })).resolves.toEqual(
      expect.objectContaining({ text: 'ok' })
    )
    expect(etat.bascules).toBe(1)
    expect(etat.rotations).toBe(1)
    expect(etat.actif).toBe('pro')
  })
})
