import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import { configureClaudeActiveAccountId } from './claude-accounts'
import { ProviderRegistry } from './providers/registry'
import {
  ProviderCallError,
  type Message,
  type ProviderAdapter,
  type SendOptions,
  type SendResult,
  type StreamChunk
} from './providers/types'
import { loadChatSessions } from './runs/chat-session-store'

/**
 * UN TOUR DE CHAT COUPÉ PAR LE QUOTA APRÈS DU TEXTE REPART SUR LE COMPTE SUIVANT (conv-1063).
 *
 * Cas réel : `run-stdout/c6ba0030-384c-4095-ac84-c96af2026180.stdout.jsonl`, un appel de 31 min et
 * 96 blocs de texte, fini sur « You've hit your session limit · resets 11:30am ». Le tour mourait en
 * pastille rouge alors qu'un second abonnement était libre ; il fallait relancer chaque fil à la main.
 *
 * Le registre bascule le pool et marque l'erreur (`basculeApresQuota`, registry.quota-wall.test.ts).
 * Ici, le tour de chat doit : effacer le texte déjà affiché, LÂCHER la session (elle vit dans le
 * dossier du compte épuisé) et renvoyer le fil ENTIER sur le compte suivant.
 *
 * Câblé sur le VRAI `ProviderRegistry` : c'est la jonction registre → tour qui est en cause.
 */
const PHRASE_REPRISE = 'Suite de NOTRE conversation'

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
  comptes = { actif: 'compte-A' }
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
    (_providerId, walled) => {
      comptes.actif = walled === 'compte-A' ? 'compte-B' : 'compte-A'
      return comptes.actif
    }
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

describe('chat() — quota épuisé APRÈS du texte affiché : le tour repart sur le compte suivant', () => {
  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-quota-apres-texte-')))
  })
  afterEach(() => {
    configureClaudeActiveAccountId(() => undefined)
    configureAutowinAppDataBase(undefined)
  })

  it('efface le texte coupé, lâche la session et renvoie le fil ENTIER sur le compte B', async () => {
    // Tour 1 sur A : ouvre la session `sess-A` du compte A.
    const comptes = { actif: 'compte-A' }
    await monter(() => OK('sess-A'), comptes).pilote.chat(
      fil('bonjour'),
      () => {},
      undefined,
      1,
      'conv-Q'
    )
    expect(loadChatSessions()['conv-Q']?.sessionId).toBe('sess-A')

    // Tour 2 : reprend `sess-A`, affiche du texte, puis le quota de A tombe.
    const { pilote, appels } = monter(
      (rang) => (rang === 0 ? SESSION_LIMIT() : OK('sess-B')),
      comptes
    )
    const evenements: PilotEvent[] = []
    await pilote.chat(
      fil('bonjour', 'ma reponse', 'et maintenant ?'),
      (e) => evenements.push(e),
      undefined,
      1,
      'conv-Q'
    )

    expect(appels.map((a) => a.compte)).toEqual(['compte-A', 'compte-B'])
    // Le 1er appel reprenait la session de A, message amputé : c'est voulu.
    expect(appels[0]!.options.resumeSessionId).toBe('sess-A')
    expect(appels[0]!.contenu).toContain(PHRASE_REPRISE)
    // Le rejeu sur B : session de A inouvrable depuis B → aucune reprise, fil entier.
    expect(appels[1]!.options.resumeSessionId).toBeUndefined()
    expect(appels[1]!.contenu).toContain('TOI: ma reponse')
    expect(appels[1]!.contenu).toContain('et maintenant ?')
    expect(appels[1]!.contenu).not.toContain(PHRASE_REPRISE)

    // Le texte coupé est EFFACÉ du fil (sinon il resterait affiché au-dessus de la réponse rejouée).
    const premierFlux = evenements.find((e) => e.kind === 'delta')
    expect(premierFlux).toBeDefined()
    expect(evenements).toContainEqual(
      expect.objectContaining({
        kind: 'stream-reset',
        streamId: (premierFlux as { streamId: string }).streamId
      })
    )
    // Le tour finit VERT, sur la réponse rejouée — pas en pastille rouge.
    expect(evenements.some((e) => e.kind === 'error')).toBe(false)
    expect(evenements.at(-1)).toMatchObject({ kind: 'done' })
    expect(JSON.stringify(evenements.at(-1))).toContain('voila la reponse')
  })

  it('le tour suivant REPREND la session ouverte sur B au lieu de repayer le fil', async () => {
    const comptes = { actif: 'compte-A' }
    await monter(() => OK('sess-A'), comptes).pilote.chat(
      fil('bonjour'),
      () => {},
      undefined,
      1,
      'conv-S'
    )
    await monter((rang) => (rang === 0 ? SESSION_LIMIT() : OK('sess-B')), comptes).pilote.chat(
      fil('bonjour', 'r', 'suite'),
      () => {},
      undefined,
      1,
      'conv-S'
    )

    const { pilote, appels } = monter(() => OK('sess-B2'), comptes)
    await pilote.chat(
      fil('bonjour', 'r', 'suite', 'r2', 'encore'),
      () => {},
      undefined,
      1,
      'conv-S'
    )
    expect(appels[0]!.compte).toBe('compte-B')
    expect(appels[0]!.options.resumeSessionId).toBe('sess-B')
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
})
