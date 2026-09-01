import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'

/**
 * UN TOUR QUI FINIT PAR `remember` DOIT QUAND MEME CONCLURE.
 *
 * Mesure conv-34 (2026-09-01), mots de l'utilisateur : « j'ai pas eu de bloc de fin ». La garde
 * `exigeUneConclusion` vit dans la branche SANS commande du pilote ; le raccourci
 * `onlyAuxiliaryRemember` rendait `done` AVANT elle. Consequence : tout tour terminant par
 * « texte + remember » — la forme normale d'un kaizen, qui depose sa lecon en dernier — se
 * cloturait sur une phrase d'intention, sans ✅ Fait ni reste a faire, et la garde etait
 * structurellement inatteignable.
 *
 * Entree qui DOIT faire echouer ce test si la garde saute : une reponse sans bloc de cloture,
 * suivie d'un `remember`, dont le texte final ne conclut toujours pas.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})
const rolesClaude = {
  getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' as const })
}
const describePrompt = () => ({
  provider: 'claude',
  transport: 'fixture',
  messages: [],
  options: {},
  limitation: 'test'
})
function texteFinal(events: PilotEvent[]): string | undefined {
  const done = [...events].reverse().find((e) => e.kind === 'done') as
    | { kind: 'done'; text?: string }
    | undefined
  return done?.text
}

async function jouer(premiereReponse: string): Promise<{
  texte: string | undefined
  appels: number
  consignes: string[]
}> {
  const responses = [
    premiereReponse,
    'Correction posée et test vert.\n\n✅ Fait : la garde est rétablie.\n📍 Maintenant : vert.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
  ]
  const consignes: string[] = []
  const send = vi.fn(async (_p: string, messages: { content: string }[]) => {
    consignes.push(messages.map((m) => m.content).join('\n'))
    return { text: responses.shift() ?? '', provider: 'claude' }
  })
  const bus = {
    catalog: () => [{ name: 'remember', args: {}, description: 'mémoire' }],
    snapshotForPrompt,
    exec: vi.fn().mockResolvedValue({ ok: true, data: { stored: true } })
  }
  const events: PilotEvent[] = []
  await new AgentPilot({ send, describePrompt } as never, rolesClaude as never, bus as never).chat(
    [{ role: 'user', content: 'kaizen ce fil' }],
    (e) => events.push(e),
    undefined,
    6,
    'conv-cloture-remember',
    // `exigerExperienceSoignee` est la 16e position : c'est la POLITIQUE d'experience que la surface
    // de chat active en vrai (voir chat(), parametre documente). Sans elle, aucune garde de forme.
    undefined, // signal
    undefined, // drainDirectives
    undefined, // bindingOverride
    undefined, // turnId
    undefined, // runtimeBinding
    undefined, // recoveredProviderCall
    undefined, // onProviderJournal
    undefined, // sendLimits
    undefined, // routingUserMessageOverride
    undefined, // tourCoupePourCeMessage
    true // exigerExperienceSoignee
  )
  return { texte: texteFinal(events), appels: send.mock.calls.length, consignes }
}

describe('cloture — le raccourci remember n avale plus la garde', () => {
  it('un tour texte+remember SANS bloc de cloture est relance pour conclure', async () => {
    const { texte, appels, consignes } = await jouer(
      'Je dépose la leçon.<cmd>{"name":"remember","args":{"type":"lesson"}}</cmd>'
    )
    expect(appels).toBe(2)
    expect(consignes.at(-1)).toContain('ta réponse ne CONCLUT pas')
    expect(texte).toContain('✅ Fait')
    expect(texte).toContain('Reste à faire')
  })

  it('un tour texte+remember QUI CONCLUT deja ne repaie aucune generation', async () => {
    const { texte, appels } = await jouer(
      'Analyse livrée.\n\n✅ Fait : diagnostic posé.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.<cmd>{"name":"remember","args":{"type":"lesson"}}</cmd>'
    )
    expect(appels).toBe(1)
    expect(texte).toContain('diagnostic posé')
  })
})
