import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import type { PromptSnapshot } from './commands'
import { loadChatSessions, saveChatSession } from './runs/chat-session-store'

/**
 * PREUVE DU BRANCHEMENT, pas du module.
 *
 * Le store de sessions est teste ailleurs (`runs/chat-session-store.test.ts`). Ici on teste la seule
 * chose qui compte pour l'utilisateur : un `AgentPilot` NEUF — c'est-a-dire une app qui vient de
 * redemarrer, dont la `Map` memoire est donc vide — reprend-il la session depuis le disque ?
 *
 * Sans ce test, on aurait un store correct et un import visible dans `agent-pilot.ts`, ce qui est
 * exactement le motif « ca a l'air branche, ca ne l'est pas ». La question utile n'est jamais « le
 * module est-il correct ? » mais « qui l'appelle vraiment, et l'effet arrive-t-il ? ».
 *
 * L'effet observable choisi : `options.resumeSessionId` transmis au provider. C'est lui qui fait que
 * le CLI reprend la session au lieu de re-payer l'historique (mesure du 2026-07-28 citee dans
 * `agent-pilot.ts` : ~79 k tokens re-payes par tour, 1,85 M de `cache_write` par heure).
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

/** Provider qui HONORE la reprise — sans ca, `agent-pilot` refuse d'armer `resumeSessionId`. */
function harnais() {
  const optionsVues: Array<Record<string, unknown>> = []
  const registry = {
    send: (_p: string, _m: unknown, options: Record<string, unknown>) => {
      optionsVues.push(options)
      return Promise.resolve({ text: 'Réponse', provider: 'claude', sessionId: 'sess-neuve' })
    },
    describePrompt: () => ({
      provider: 'claude',
      transport: 'cli',
      messages: [],
      options: {},
      limitation: 'opaque'
    }),
    honoursSessionResume: () => true
  }
  const roles = {
    getBinding: () => ({ provider: 'claude', model: 'opus', reasoningEffort: 'medium' })
  }
  const bus = { catalog: () => [], snapshotForPrompt }
  return { optionsVues, registry, roles, bus }
}

describe('AgentPilot — la reprise de session survit au redémarrage', () => {
  afterEach(() => {
    // Ne JAMAIS laisser une racine de test configurée : le prochain test écrirait dans un temp mort.
    configureAutowinAppDataBase(undefined)
    vi.restoreAllMocks()
  })

  it('un pilote NEUF reprend la session écrite sur disque par un pilote précédent', async () => {
    const base = mkdtempSync(join(tmpdir(), 'aos-pilot-sess-'))
    configureAutowinAppDataBase(base)

    // Un tour précédent, dans une vie antérieure de l'app, avait mémorisé sa session.
    // La cle porte AUSSI l'id du compte Claude actif (vide hors configuration) : une session
    // ouverte sous un autre compte n'existe pas dans son CLAUDE_CONFIG_DIR et ne se reprend pas.
    saveChatSession('conv-42', 'claude:opus:', 'sess-anterieure')

    // Pilote NEUF : sa Map mémoire est vide, comme après un redémarrage.
    const { optionsVues, registry, roles, bus } = harnais()
    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'bonjour' }],
      () => {},
      undefined,
      12,
      'conv-42'
    )

    expect(optionsVues[0]?.resumeSessionId).toBe('sess-anterieure')
  })

  it('sans session persistée, aucun resumeSessionId n est armé (pas de reprise fantôme)', async () => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-pilot-sess-vide-')))
    const { optionsVues, registry, roles, bus } = harnais()
    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'bonjour' }],
      () => {},
      undefined,
      12,
      'conv-inconnue'
    )
    expect(optionsVues[0]?.resumeSessionId).toBeUndefined()
  })

  it('REFUSE de reprendre une session ouverte sous un AUTRE binding', async () => {
    const base = mkdtempSync(join(tmpdir(), 'aos-pilot-sess-binding-'))
    configureAutowinAppDataBase(base)
    // Session écrite pour un binding différent de celui que le pilote va utiliser.
    saveChatSession('conv-42', 'codex:gpt', 'sess-autre-binding')

    const { optionsVues, registry, roles, bus } = harnais()
    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'bonjour' }],
      () => {},
      undefined,
      12,
      'conv-42'
    )
    // Reprendre ici élirait un historique que cette session n'a jamais reçu — c'est la panne
    // « resume fantôme » déjà vécue avec codex (0 appel réellement repris, 31 prompts amputés).
    expect(optionsVues[0]?.resumeSessionId).toBeUndefined()
    // L'entrée PÉRIMÉE ne doit pas survivre — sinon elle ressusciterait au prochain démarrage et
    // ferait reprendre une session ouverte sous un autre modèle.
    // Elle est remplacée, PAS effacée : le tour vient d'ouvrir une session claude pour cette même
    // conversation, et la persister est exactement ce qu'on veut. L'invariant est donc « plus aucune
    // trace de l'ancien binding », pas « plus rien du tout » — la première version de cette assertion
    // exigeait l'absence totale et affirmait donc quelque chose de faux.
    const apres = loadChatSessions()['conv-42']
    expect(apres?.key).not.toBe('codex:gpt')
    expect(apres?.sessionId).not.toBe('sess-autre-binding')
  })

  it('un tour PERSISTE la session rendue par le provider, pour le prochain démarrage', async () => {
    const base = mkdtempSync(join(tmpdir(), 'aos-pilot-sess-write-'))
    configureAutowinAppDataBase(base)
    const { registry, roles, bus } = harnais()
    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'bonjour' }],
      () => {},
      undefined,
      12,
      'conv-7'
    )
    expect(loadChatSessions()['conv-7']).toEqual({
      key: 'claude:opus:',
      sessionId: 'sess-neuve'
    })
  })

  it('FAIL-OPEN : un store illisible ne casse pas le tour', async () => {
    // Racine inexistante et non créable proprement : la persistance doit échouer en silence.
    configureAutowinAppDataBase(join(tmpdir(), `aos-pilot-sess-absent-${Date.now()}`, 'x', 'y'))
    const { registry, roles, bus } = harnais()
    // On n'affirme pas une valeur de retour (le tour n'en promet aucune) : on affirme qu'il ne JETTE
    // pas. Un cache indisponible doit coûter un renvoi d'historique, jamais un tour perdu.
    let jete: unknown
    try {
      await new AgentPilot(registry as never, roles as never, bus as never).chat(
        [{ role: 'user', content: 'bonjour' }],
        () => {},
        undefined,
        12,
        'conv-9'
      )
    } catch (e) {
      jete = e
    }
    expect(jete).toBeUndefined()
  })
})
