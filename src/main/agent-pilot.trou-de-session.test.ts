import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * LE TROU DE SESSION — un tour exécuté SANS le modèle disparaissait pour lui.
 *
 * Constaté par l'utilisateur le 2026-08-14. Dans son fil, à la question « on a bien fait tout le
 * processus ouverture workspace worktree ? », l'agent a répondu : « je vois bien qu'un `orchestrate` a
 * été lancé dans cette conversation, mais la trace fournie ne contient ni son `runId`, ni ses phases,
 * ni son résultat ». Réponse HONNÊTE face à un trou — le défaut était le trou.
 *
 * Mécanique exacte, et elle exige TROIS tours pour se produire :
 *   1. un tour normal ouvre une session CLI (le provider rend un `sessionId`) ;
 *   2. un `/skill` prend la route `explicit-skill` : l'app lance l'orchestration ELLE-MÊME et rend la
 *      main AVANT tout appel au modèle. La bulle affichée est rédigée par du code, et la session du
 *      modèle n'en garde aucune trace ;
 *   3. le tour suivant REPREND cette session et n'envoie que le dernier message — donc le tour 2 est
 *      invisible, alors qu'on affirmait au modèle qu'il connaissait déjà tout l'historique.
 *
 * Un test à deux tours ne prouverait RIEN : sans tour 1, aucune session n'existe, le fil complet part,
 * et le tour app-généré est visible via l'historique. C'est précisément la reprise qui creuse le trou.
 */
function pilote(): { pilot: AgentPilot; envoyes: string[]; exec: ReturnType<typeof vi.fn> } {
  const envoyes: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      envoyes.push(messages.at(-1)?.content ?? '')
      return { text: 'réponse du modèle', sessionId: 'sess-1' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    // Sans cela, la reprise n'est PAS armée (garde « RESUME FANTÔME ») et le trou ne peut pas exister.
    honoursSessionResume: vi.fn(() => true)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const exec = vi.fn(async (name: string) =>
    name === 'orchestrate'
      ? {
          ok: true,
          data: {
            status: 'succeeded',
            // `runPath` et non un `runId` nu : le libellé du run est dérivé du dossier
            // `<sujet>-workspace`, donc un identifiant sans chemin ne produirait AUCUN nom lisible
            // — première fixture écrite, et le test échouait pour cette raison, pas pour la bonne.
            runPath: 'C:/runs/sess-1/ouvrir-workspace-workspace/RUN.md',
            valid: true
          }
        }
      : { ok: true, data: { ok: true } }
  )
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pilot: new AgentPilot(registry as any, roles as any, bus as any),
    envoyes,
    exec
  }
}

const CONV = 'conv-trou-1'

describe('un tour exécuté sans le modèle est réinjecté au tour suivant', () => {
  it('le tour suivant REÇOIT le compte-rendu du tour que le modèle n’a jamais vu', async () => {
    const { pilot, envoyes, exec } = pilote()

    // Tour 1 — normal : il ouvre la session CLI que le tour 3 reprendra.
    await pilot.chat([{ role: 'user', content: 'bonjour' }], () => {}, undefined, 12, CONV)

    // Tour 2 — `/skill` : route explicit-skill, l'app orchestre, le modèle n'est PAS appelé.
    const appelsAvant = envoyes.length
    await pilot.chat(
      [
        { role: 'user', content: 'bonjour' },
        { role: 'assistant', content: 'réponse du modèle' },
        { role: 'user', content: '/frame ouvrir un workspace' }
      ],
      () => {},
      undefined,
      12,
      CONV
    )
    expect(exec).toHaveBeenCalledWith('orchestrate', expect.anything(), CONV)
    // La prémisse du trou : ce tour n'a produit AUCUN appel au modèle.
    expect(envoyes.length).toBe(appelsAvant)

    // Tour 3 — la question de l'utilisateur sur ce qui vient d'être fait.
    await pilot.chat(
      [
        { role: 'user', content: 'bonjour' },
        { role: 'assistant', content: 'réponse du modèle' },
        { role: 'user', content: '/frame ouvrir un workspace' },
        { role: 'assistant', content: 'compte-rendu app' },
        { role: 'user', content: 'on a bien fait tout le processus ?' }
      ],
      () => {},
      undefined,
      12,
      CONV
    )

    const dernier = envoyes.at(-1) ?? ''
    // LA garantie : le run est nommé dans ce que le modèle reçoit.
    expect(dernier).toContain('ouvrir-workspace')
    // Et on ne lui affirme plus qu'il connaît déjà tout l'historique.
    expect(dernier).not.toContain("tu en connais déjà l'historique")
  })

  it('le compte-rendu n’est injecté QU’UNE fois', async () => {
    // Le laisser en place le rendrait a contretemps : un vieux résultat présenté comme frais.
    const { pilot, envoyes } = pilote()
    await pilot.chat([{ role: 'user', content: 'bonjour' }], () => {}, undefined, 12, CONV)
    await pilot.chat(
      [{ role: 'user', content: '/frame ouvrir un workspace' }],
      () => {},
      undefined,
      12,
      CONV
    )
    await pilot.chat([{ role: 'user', content: 'et alors ?' }], () => {}, undefined, 12, CONV)
    await pilot.chat([{ role: 'user', content: 'et ensuite ?' }], () => {}, undefined, 12, CONV)

    expect(envoyes.at(-2)).toContain('ouvrir-workspace')
    expect(envoyes.at(-1)).not.toContain('ouvrir-workspace')
  })
})
