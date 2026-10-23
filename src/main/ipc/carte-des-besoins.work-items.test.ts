/**
 * Canaux de la Carte du projet pour les WORK ITEMS (option E du cadrage conv-1127, 2026-10-23).
 *
 * Les entrées qui font échouer une version fausse : un calcul de la carte qui lit la source de
 * tickets (la carte se calcule sans réseau ni modèle) ; un rattachement ou une vérification qui
 * ÉCRIT chez le fournisseur (commentaire, état) ; un fil ouvert par la vue Tickets qui n'est pas lié
 * sans geste ; une mention `#5678` montrée comme lien avant d'avoir été lue à la source.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { CarteDesBesoins, DemandeDeLaCarte } from '../../shared/carte-des-besoins'
import type { AzureTicketSource, TicketItem } from '../../shared/tickets'
import { formatTicketReferencePrompt } from '../../renderer/src/components/ticket-treatment'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)
  }
}))
vi.mock('../ipc-senders', () => ({ assertTrustedRendererSender: () => undefined }))

import { registerCarteDesBesoinsIpc } from './carte-des-besoins'

const AZURE: AzureTicketSource = {
  id: 'azure:contoso:projet:depot',
  label: 'contoso / projet',
  provider: 'azure',
  organization: 'contoso',
  project: 'projet'
}

const fiche = (id: string, title: string): TicketItem => ({
  id,
  sourceId: AZURE.id,
  type: 'Task',
  title,
  state: 'Active',
  url: `https://example.test/${id}`,
  updatedAt: '2026-10-23T10:00:00Z',
  fields: {}
})

const connues: Record<string, string> = { '1234': 'Corriger X', '5678': 'Ajouter Y', '77': 'Z' }
const get = vi.fn(async (r: { id: string }): Promise<TicketItem> => {
  const titre = connues[r.id]
  if (titre === undefined) throw new Error(`Fiche Azure DevOps ${r.id} introuvable.`)
  return fiche(r.id, titre)
})
const update = vi.fn()

const reponse = (ts: number) => ({
  role: 'assistant',
  content: '',
  status: 'completed',
  ts,
  parts: [{ kind: 'text', text: 'Fait.' }]
})

const fil = {
  id: 'conv-7',
  title: '#1234 · Corriger X',
  updatedAt: 10,
  messages: [
    {
      role: 'user',
      content: formatTicketReferencePrompt([fiche('1234', 'Corriger X')], AZURE),
      ts: 1_000,
      messageId: 'u1'
    },
    reponse(2_000),
    { role: 'user', content: 'corrige aussi #5678 dans la foulée', ts: 3_000, messageId: 'u2' },
    reponse(4_000)
  ]
}

beforeAll(() => {
  registerCarteDesBesoinsIpc({
    os: {
      conversations: { list: () => [fil] },
      runsWithGate: async () => [],
      executionWorkspace: undefined
    } as never,
    racineDesLiens: mkdtempSync(join(tmpdir(), 'carte-work-items-')),
    tickets: { listSources: () => [AZURE], get, update } as never
  })
})

const appeler = async <T>(canal: string, ...args: unknown[]): Promise<T> => {
  const handler = handlers.get(canal)
  if (!handler) throw new Error(`canal absent : ${canal}`)
  return (await handler({}, ...args)) as T
}

const demandesDe = (carte: CarteDesBesoins): DemandeDeLaCarte[] =>
  carte.projets.flatMap((p) => p.demandes).sort((a, b) => a.rang - b.rang)

describe('Carte du projet — work items', () => {
  it('le calcul de la carte ne lit jamais la source ; le fil de la vue Tickets est lié sans geste', async () => {
    const [ouverte, mention] = demandesDe(await appeler<CarteDesBesoins>('os:carteDesBesoins'))
    expect(get).not.toHaveBeenCalled()
    expect(ouverte.workItems).toEqual([{ sourceId: AZURE.id, id: '1234', origine: 'tickets' }])
    // La mention n'est qu'un candidat tant que la fiche n'a pas été lue.
    expect(mention.references).toEqual([{ id: '5678', origine: 'mention' }])
    expect(mention.workItems).toBeUndefined()
  })

  it('la vérification lit les fiches, pose la mention, et n’écrit rien chez le fournisseur', async () => {
    const bilan = await appeler<{ lues: number; liees: number }>('os:carte:verifierMentions')
    expect(bilan).toMatchObject({ lues: 2, liees: 1 })
    const [ouverte, mention] = demandesDe(await appeler<CarteDesBesoins>('os:carteDesBesoins'))
    expect(ouverte.workItems?.[0]).toMatchObject({ id: '1234', titre: 'Corriger X' })
    expect(mention.workItems).toEqual([
      { sourceId: AZURE.id, id: '5678', titre: 'Ajouter Y', type: 'Task', origine: 'mention' }
    ])
    expect(update).not.toHaveBeenCalled()
  })

  it('rattacher puis détacher à la main : relu par la carte, aucune écriture chez le fournisseur', async () => {
    const lie = await appeler<{ ok: boolean }>('os:carte:lierWorkItem', {
      conversationId: 'conv-7',
      demande: 'u2',
      saisie: '77'
    })
    expect(lie).toMatchObject({ ok: true })
    let mention = demandesDe(await appeler<CarteDesBesoins>('os:carteDesBesoins'))[1]
    expect(mention.workItems?.map((w) => w.id)).toEqual(['5678', '77'])

    const delie = await appeler<{ ok: boolean }>('os:carte:delierWorkItem', {
      conversationId: 'conv-7',
      demande: 'u2',
      sourceId: AZURE.id,
      id: '5678'
    })
    expect(delie).toEqual({ ok: true })
    mention = demandesDe(await appeler<CarteDesBesoins>('os:carteDesBesoins'))[1]
    expect(mention.workItems?.map((w) => w.id)).toEqual(['77'])
    expect(update).not.toHaveBeenCalled()
  })

  it('un fil inconnu ou une demande absente est refusé', async () => {
    const r = await appeler<{ ok: boolean }>('os:carte:lierWorkItem', {
      conversationId: 'conv-inexistant',
      demande: 'u2',
      saisie: '77'
    })
    expect(r.ok).toBe(false)
  })
})
