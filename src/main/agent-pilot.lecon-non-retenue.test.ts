import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { AVERTISSEMENT_LECON_NON_RETENUE } from './lecon-non-retenue'

/**
 * UNE LEÇON ÉCRITE SANS DÉPÔT EST DITE À LA CLÔTURE — conv-335, tours
 * ff240730-2bbf-49e3-9923-5db1839772ba (deux « Leçon : » écrites, aucune déposée) et
 * d5bf24a1-958a-4c94-ad13-80b67a3a1fe0 (l'utilisateur doit demander « Ca sert vraiment ces lecons? »).
 *
 * Ce qui doit faire échouer ces tests : un tour qui écrit « **Leçon** : … » sans rien déposer et se
 * clôt sans l'avertissement, ou un avertissement posé alors que le tour a bien déposé.
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

const LECON =
  "C'est corrigé : l'étape #12 est retirée.\n\n**Leçon** : quand le travail d'une étape est confié " +
  "à une tâche programmée, je retire l'étape de la liste du fil à ce moment-là."

async function jouer(
  reponses: Array<{ texte: string; statuts?: string[] }>,
  exec = vi.fn().mockResolvedValue({ ok: true, data: { stored: true } })
): Promise<string | undefined> {
  const restantes = [...reponses]
  const send = vi.fn(
    async (_p: unknown, _m: unknown, _o: unknown, onChunk?: (c: { status?: string }) => void) => {
      const r = restantes.shift() ?? { texte: '' }
      for (const status of r.statuts ?? []) onChunk?.({ status })
      return { text: r.texte, provider: 'claude' }
    }
  )
  const bus = {
    catalog: () => [
      { name: 'remember', args: {}, description: 'mémoire' },
      { name: 'list_files', args: {}, description: 'liste' }
    ],
    snapshotForPrompt,
    exec
  }
  const events: PilotEvent[] = []
  await new AgentPilot({ send, describePrompt } as never, rolesClaude as never, bus as never).chat(
    [{ role: 'user', content: 'le tour s’est fini et le bloc étape écrit 0/1' }],
    (e) => events.push(e),
    undefined,
    6,
    'conv-lecon-non-retenue'
  )
  const done = [...events].reverse().find((e) => e.kind === 'done') as
    { kind: 'done'; text?: string } | undefined
  return done?.text
}

describe('clôture du chat — leçon écrite sans dépôt', () => {
  it('une « Leçon : » sans aucun dépôt dans le tour reçoit l’avertissement', async () => {
    const texte = await jouer([{ texte: LECON }])
    expect(texte).toContain("**Leçon** : quand le travail d'une étape")
    expect(texte).toContain(AVERTISSEMENT_LECON_NON_RETENUE)
  })

  it('un `remember` accepté plus tôt dans le tour suffit : pas d’avertissement', async () => {
    const texte = await jouer([
      {
        texte:
          'Je dépose et je vérifie.<cmd>{"name":"remember","args":{"type":"lesson"}}</cmd>' +
          '<cmd>{"name":"list_files","args":{"path":"."}}</cmd>'
      },
      { texte: LECON }
    ])
    expect(texte).toContain('**Leçon**')
    expect(texte).not.toContain(AVERTISSEMENT_LECON_NON_RETENUE)
  })

  it('une écriture native dans la mémoire du poste suffit : pas d’avertissement', async () => {
    const texte = await jouer([
      {
        texte: LECON,
        statuts: [
          'Write · C:\\Users\\User\\.claude\\projects\\D--Autowin\\memory\\etapes-du-tour.md'
        ]
      }
    ])
    expect(texte).not.toContain(AVERTISSEMENT_LECON_NON_RETENUE)
  })

  it('une réponse qui PARLE des leçons sans en écrire reste intacte', async () => {
    const texte = await jouer([
      { texte: 'Les deux « leçons » que tu as recollées n’ont servi à rien.' }
    ])
    expect(texte).toBe('Les deux « leçons » que tu as recollées n’ont servi à rien.')
  })
})
