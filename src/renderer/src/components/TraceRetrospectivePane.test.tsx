// @vitest-environment happy-dom
/**
 * Exigence de l'utilisateur (2026-09-12) : « c'est sur le disque mais je peux le consulter nulle
 * part — faudrait pouvoir recup tout le raisonnement et les actions de la conv dans la right bar ».
 *
 * Entrées qui feraient échouer une correction fausse :
 *  1. une trace REELLE (raisonnement + appels d'outil) -> les deux doivent s'afficher ;
 *  2. une trace VIDE -> un message qui dit pourquoi, jamais un panneau muet ;
 *  3. une lecture qui ECHOUE -> l'échec est dit, pas confondu avec « aucune trace ».
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { TraceRetrospectivePane } from './TraceRetrospectivePane'

function event(o: Record<string, unknown>): unknown {
  return {
    schema: 'autowin.trace/v1',
    conversationId: 'conv-1',
    timestamp: '2026-09-12T10:00:00.000Z',
    sequence: 1,
    status: 'completed',
    actor: { id: 'a', kind: 'agent', label: 'Agent' },
    channel: 'assistant',
    payloads: [],
    observation: { boundary: 'test', fidelity: 'exact' },
    ...o
  }
}

async function rendre(causalTrace: () => Promise<unknown>): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  ;(window as unknown as { api: unknown }).api = { causalTrace }
  await act(async () => {
    createRoot(host).render(createElement(TraceRetrospectivePane, { conversationId: 'conv-1' }))
  })
  return host
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('onglet Trace du panneau de droite', () => {
  it('affiche le raisonnement ET les actions lus sur le disque', async () => {
    const host = await rendre(async () => [
      event({
        id: '1',
        turnId: 't1',
        type: 'model-response',
        payloads: [{ kind: 'reasoning', content: 'je relis le fichier' }]
      }),
      event({
        id: '2',
        turnId: 't1',
        type: 'tool-call',
        sequence: 2,
        payloads: [{ kind: 'tool-call', name: 'Bash', content: '{"name":"Bash","args":{"command":"npm test"}}' }]
      })
    ])

    expect(host.querySelector('[data-testid="trace-retrospective"]')).not.toBeNull()
    expect(host.textContent).toContain('je relis le fichier')
    expect(host.textContent).toContain('Bash')
    expect(host.textContent).toContain('npm test')
  })

  it('dit pourquoi c’est vide au lieu de rester muet', async () => {
    const host = await rendre(async () => [])
    expect(host.querySelector('[data-testid="trace-vide"]')?.textContent).toContain('7 jours')
  })

  it('distingue une lecture en échec d’une absence de trace', async () => {
    const host = await rendre(async () => {
      throw new Error('EACCES')
    })
    expect(host.querySelector('[data-testid="trace-erreur"]')?.textContent).toContain('EACCES')
    expect(host.querySelector('[data-testid="trace-vide"]')).toBeNull()
  })
})
