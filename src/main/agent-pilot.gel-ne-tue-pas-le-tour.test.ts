import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * UN GEL DE L'INTERFACE NE DOIT PAS TUER UN TOUR DE CHAT — et donc le faire REPAYER en entier.
 *
 * MESURE DU 2026-09-02 (journaux de la journee, `.autowin-data/<profil>/activity/conv-*.jsonl`) :
 * 14 appels portent le libelle « reprise du tour interrompu » pour 13,62 $ — un tour deja paye,
 * relance depuis le debut. Le plus cher a lui seul : 3,44 $ (conv-96, 04:19).
 *
 * LE LIEN, deja etabli et corrige COTE ORCHESTRATEUR le meme jour (commit d2f1f97d) : pendant un
 * gel, l'ecriture de la trace causale attend un verrou de sequence (`withSequenceLock`,
 * src/main/activity/trace-store.ts:106) qui JETTE passe son budget — « allocation de sequence
 * verrouillee trop longtemps ». Ce correctif n'a protege que les rappels du PIPELINE.
 *
 * Le chemin CHAT a exactement la meme forme et n'a PAS ete traite : `run-pilot-chat.ts` ecrit la
 * trace de l'appel provider (~l.887) et celle de chaque action (~l.933) HORS de tout try/catch —
 * les ecritures voisines (journal du tour, raisonnement, artefact) sont pourtant protegees, ligne
 * apres ligne, par le commentaire « best-effort : ne jamais casser un tour ». Et `emit()` appelle
 * `onEvent(e)` A NU (agent-pilot.ts:683) : le jet remonte donc dans la boucle du tour et le tue.
 *
 * Ce test ne simule pas le gel : il simule sa CONSEQUENCE observable — le consommateur d'evenements
 * jette. Le tour doit quand meme aller jusqu'a `done`.
 */
const provider = () => ({
  send: vi.fn(
    async (_p: string, _m: Message[], _o: SendOptions): Promise<SendResult> =>
      ({ text: 'Réponse du modèle.', provider: 'codex', systemInjected: true }) as SendResult
  ),
  describePrompt: vi.fn(() => ({ provider: 'codex', messages: [], transport: 'test' }))
})
const roles = () => ({ getBinding: vi.fn(() => ({ provider: 'codex', model: 'gpt-test' })) })
const bus = () => ({
  catalog: vi.fn(() => []),
  snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
  exec: vi.fn()
})

async function tourAvecConsommateurQuiJette(
  jetteSur: string
): Promise<{ kinds: string[]; erreur: unknown }> {
  const kinds: string[] = []
  let erreur: unknown
  try {
    await new AgentPilot(provider() as never, roles() as never, bus() as never).chat(
      [{ role: 'user', content: 'Bonjour' }],
      (event) => {
        kinds.push(event.kind)
        if (event.kind === jetteSur)
          throw new Error('allocation de sequence verrouillee trop longtemps')
      },
      undefined,
      2,
      'conv-gel'
    )
  } catch (e) {
    erreur = e
  }
  return { kinds, erreur }
}

describe('une écriture d’observabilité qui échoue ne tue pas le tour de chat', () => {
  it('le tour va jusqu’à « done » malgré un consommateur qui jette sur l’appel provider', async () => {
    const { kinds, erreur } = await tourAvecConsommateurQuiJette('prompt-call')
    expect(erreur).toBeUndefined()
    expect(kinds).toContain('done')
  })

  it('idem quand il jette sur un delta de réponse', async () => {
    const { kinds, erreur } = await tourAvecConsommateurQuiJette('delta')
    expect(erreur).toBeUndefined()
    expect(kinds).toContain('done')
  })
})
