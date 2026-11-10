import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { configureAutowinAppDataBase } from '../app/app-data'
import { configureClaudeActiveAccountId } from '../providers/claude-accounts'
import { ProviderRegistry } from '../providers/registry'
import {
  ProviderCallError,
  type Message,
  type ProviderAdapter,
  type SendOptions,
  type SendResult,
  type StreamChunk
} from '../providers/types'

/**
 * UN TOUR DE CHAT COUPÉ PAR LE QUOTA APRÈS DU TEXTE S'ARRÊTE SUR SON COMPTE (2026-11-10).
 *
 * Cas réel : `run-stdout/c6ba0030-384c-4095-ac84-c96af2026180.stdout.jsonl`, un appel de 31 min et
 * 96 blocs de texte, fini sur « You've hit your session limit · resets 11:30am ». Le tour mourait en
 * pastille rouge alors qu'un second abonnement était libre, et repartait tout seul sur lui.
 *
 * Désormais le compte ne change jamais sans l'utilisateur : le tour s'arrête, le texte déjà affiché
 * reste (il est réel), rien n'est rejoué, et l'erreur nomme le compte épuisé.
 *
 * Câblé sur le VRAI `ProviderRegistry` : c'est la jonction registre → tour qui est en cause.
 */
type Appel = { compte: string; options: SendOptions; contenu: string }

const SESSION_LIMIT = (): ProviderCallError =>
  new ProviderCallError(
    "Claude a interrompu l'appel : You've hit your session limit · resets 11:30am (Europe/Paris)",
    { code: 'success', retryable: false }
  )

/**
 * Faux Claude multi-comptes. `reponse(rang, compte)` décide de chaque appel : une `Error` est levée
 * APRÈS un premier fragment affiché (la coupure en plein tour) ; un résultat est rendu tel quel.
 */
function monter(
  reponse: (rang: number, compte: string, contenu: string) => SendResult | Error,
  comptes = { actif: 'compte-A' },
  noms?: Record<string, string>
): { pilote: AgentPilot; appels: Appel[]; comptes: { actif: string } } {
  const appels: Appel[] = []
  const claude: ProviderAdapter = {
    id: 'claude',
    honoursSessionResume: true,
    async auth() {
      return true
    },
    async *send(messages: Message[], options: SendOptions = {}) {
      const contenu = messages[0]?.content ?? ''
      const compte = comptes.actif
      appels.push({ compte, options: { ...options }, contenu })
      const issue = reponse(appels.length - 1, compte, contenu)
      if (issue instanceof Error) {
        yield { delta: 'Je commence le travail, je lis les fichiers…' } as StreamChunk
        throw issue
      }
      return issue
    }
  }
  const registry = new ProviderRegistry(
    undefined,
    undefined,
    () => comptes.actif,
    undefined,
    noms ? (_providerId, compte) => noms[compte] : undefined
  ).register(claude)
  configureClaudeActiveAccountId(() => comptes.actif)
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', description: 'etat', args: {} }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: true }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilote: new AgentPilot(registry, roles as any, bus as any), appels, comptes }
}

const fil = (...tours: string[]): Message[] =>
  tours.map(
    (content, rang) => ({ role: rang % 2 === 0 ? 'user' : 'assistant', content }) as Message
  )

const OK = (sessionId: string, text = 'voila la reponse'): SendResult =>
  ({ text, provider: 'claude', systemInjected: false, sessionId }) as SendResult

describe('chat() — quota épuisé APRÈS du texte affiché : le tour s’arrête sur son compte', () => {
  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-quota-apres-texte-')))
  })
  afterEach(() => {
    configureClaudeActiveAccountId(() => undefined)
    configureAutowinAppDataBase(undefined)
  })

  it('le tour s’arrête sur son compte : rien n’est rejoué, et l’erreur nomme ce compte', async () => {
    const comptes = { actif: 'compte-A' }
    const { pilote, appels } = monter(() => SESSION_LIMIT(), comptes, {
      'compte-A': 'perso@gmail.com'
    })
    const evenements: PilotEvent[] = []

    const erreur = await pilote
      .chat(
        fil('bonjour', 'ma reponse', 'et maintenant ?'),
        (e) => evenements.push(e),
        undefined,
        1,
        'conv-Q'
      )
      .then(
        () => undefined,
        (e: unknown) => e
      )

    // Un seul appel : le texte coupé n'est jamais rejoué, et le compte actif n'a pas bougé.
    expect(appels.map((a) => a.compte)).toEqual(['compte-A'])
    expect(comptes.actif).toBe('compte-A')
    expect(evenements.some((e) => e.kind === 'retry')).toBe(false)
    // Le tour échoue en le disant : quel compte, et le geste à faire.
    expect(erreur).toBeInstanceOf(ProviderCallError)
    const echec = (erreur as Error).message
    expect(echec).toContain('« perso@gmail.com »')
    expect(echec).toContain('choisis un autre compte')
    expect(echec).toContain('session limit')
  })

  it('compte changé ENTRE deux itérations du même tour : la session de A n’est pas réclamée sur B', async () => {
    // Le cas de l'utilisateur : il bascule à la main pendant qu'un tour tourne. L'itération suivante
    // partait sur B avec `--resume` d'une session rangée chez A → « No conversation found ».
    const comptes = { actif: 'compte-A' }
    const { pilote, appels } = monter((rang, _compte, contenu) => {
      if (rang === 0) {
        comptes.actif = 'compte-B' // bascule manuelle pendant l'appel
        return OK('sess-A', '<cmd>{"name":"get_state","args":{}}</cmd>')
      }
      return OK('sess-B', contenu.includes('RÉSULTATS') ? 'voila la reponse' : 'autre')
    }, comptes)
    await pilote.chat(
      fil('bonjour', 'ma reponse', 'regarde l etat'),
      () => {},
      undefined,
      4,
      'conv-M'
    )

    expect(appels.length).toBeGreaterThanOrEqual(2)
    expect(appels[1]!.compte).toBe('compte-B')
    expect(appels[1]!.options.resumeSessionId).toBeUndefined()
    expect(appels[1]!.contenu).toContain('TOI: ma reponse')
    expect(appels[1]!.contenu).toContain('RÉSULTATS')
  })

  /*
   * Cas réel (2026-11-09 19:27, run-stdout f3c665df puis cdca4224) : le compte gmail tombe sur sa
   * limite hebdomadaire, puis le compte pro, à sa limite lui aussi. Chaque échec doit nommer SON
   * compte : c'est ce qui a manqué au fil, lu comme une erreur de compte.
   */
  it('deux comptes épuisés à la suite : chaque échec nomme SON compte, et rien ne bascule seul', async () => {
    const noms = { 'compte-A': 'perso@gmail.com', 'compte-B': 'pro@entreprise.fr' }
    const comptes = { actif: 'compte-A' }
    const premier = monter(
      () =>
        new ProviderCallError(
          "Claude a interrompu l'appel : You've hit your weekly limit · resets Nov 12, 4am (Europe/Paris)",
          { code: 'success', retryable: false }
        ),
      comptes,
      noms
    )
    const erreurA = await premier.pilote
      .chat(fil('travaille'), () => {}, undefined, 1, 'conv-W')
      .then(
        () => undefined,
        (e: unknown) => e
      )
    expect(premier.appels.map((a) => a.compte)).toEqual(['compte-A'])
    expect((erreurA as Error).message).toContain('« perso@gmail.com »')

    // L'utilisateur choisit l'autre compte à la main : son refus le nomme à son tour.
    comptes.actif = 'compte-B'
    const second = monter(
      () =>
        new ProviderCallError(
          "Claude a interrompu l'appel : You've hit your weekly limit · resets 1am (Europe/Paris)",
          { code: 'success', retryable: false }
        ),
      comptes,
      noms
    )
    const erreurB = await second.pilote
      .chat(fil('travaille'), () => {}, undefined, 1, 'conv-W')
      .then(
        () => undefined,
        (e: unknown) => e
      )
    expect(second.appels.map((a) => a.compte)).toEqual(['compte-B'])
    expect((erreurB as Error).message).toContain('« pro@entreprise.fr »')
    expect((erreurB as Error).message).toContain('resets 1am')
  })
})
