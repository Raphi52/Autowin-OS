import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { outilsDuChat } from './chat-mcp'
import { AppCommandBus, CATALOG } from './commands'
import { cheminJournalMessagesFils, messagesAAfficher } from './messages-entre-fils-app'
import { lignesDuJournal } from '../shared/messages-entre-fils'

/*
 * conv-1139 : les deux outils du chat qui remplacent `chat_send` comme canal ENTRE agents. Ce qui
 * est verrouillé ici : l'expéditeur vient du tour (fil + tour de l'appel), et l'envoi ne lance
 * JAMAIS de tour chez le destinataire — sauf un ORDRE vers un fil inactif, qui le réveille
 * (conv-1139, 2026-10-25).
 */
let base: string
const maintenant = Date.now()

interface OptionsBus {
  /** Fils où un tour tourne déjà. */
  occupes?: string[]
  /** `false` : `tourDeChatActif` n'est pas câblé. */
  sonde?: boolean
  lancement?: () => Promise<{ ok: boolean; turnId?: string; error?: string }>
}

function bus(opts: OptionsBus = {}): {
  bus: AppCommandBus
  lances: string[]
  prompts: string[]
  evenements: unknown[]
} {
  const depot = process.cwd()
  const fils = [
    { id: 'conv-A', projectPath: depot, updatedAt: maintenant, messages: [] },
    { id: 'conv-B', projectPath: depot, updatedAt: maintenant, messages: [] },
    // Inactif depuis plus que le seuil d'archivage : n'est plus un destinataire.
    {
      id: 'conv-vieux',
      projectPath: depot,
      updatedAt: maintenant - 30 * 24 * 3_600_000,
      messages: []
    }
  ]
  const os = {
    executionWorkspace: depot,
    conversations: { get: (id: string) => fils.find((f) => f.id === id), list: () => fils },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
  const evenements: unknown[] = []
  const b = new AppCommandBus(os as never, (e: unknown) => evenements.push(e))
  const lances: string[] = []
  const prompts: string[] = []
  b.conversationExiste = () => true
  b.lancerDansConversation = async (id, prompt) => {
    lances.push(id)
    prompts.push(prompt)
    return opts.lancement ? opts.lancement() : { ok: true, turnId: 't' }
  }
  if (opts.sonde !== false) b.tourDeChatActif = (id) => (opts.occupes ?? []).includes(id)
  return { bus: b, lances, prompts, evenements }
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'bus-msg-fils-'))
  configureAutowinAppDataBase(base)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  rmSync(base, { recursive: true, force: true })
})

describe('ecrire_a_un_fil / lire_mes_messages par le bus', () => {
  it('l’expéditeur est le fil et le tour de l’appel ; aucun tour lancé chez le destinataire', async () => {
    const { bus: b, lances, evenements } = bus()
    const r = await b.exec(
      'ecrire_a_un_fil',
      {
        destinataire: 'conv-B',
        texte: 'j’ai besoin d’ajouter X',
        nature: 'question',
        de: 'conv-B',
        expediteur: 'utilisateur'
      },
      'conv-A',
      undefined,
      'tour-9'
    )
    expect(r.ok).toBe(true)
    expect(lances).toEqual([])
    const lignes = lignesDuJournal(readFileSync(cheminJournalMessagesFils(), 'utf8'))
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({
      a: 'conv-B',
      de: { fil: 'conv-A', tour: 'tour-9' },
      nature: 'question'
    })
    expect(evenements).toContainEqual({ type: 'refresh', scope: 'messages-fils' })
  })

  it('hors de tout fil, ou vers un fil archivé : refus lisible, rien d’écrit', async () => {
    const { bus: b } = bus()
    const sansFil = await b.exec('ecrire_a_un_fil', { destinataire: 'conv-B', texte: 'x' })
    expect(sansFil.ok).toBe(false)
    expect(sansFil.error).toMatch(/aucun fil d'origine/)
    const archive = await b.exec(
      'ecrire_a_un_fil',
      { destinataire: 'conv-vieux', texte: 'x' },
      'conv-A'
    )
    expect(archive.error).toMatch(/inconnu, archivé ou supprimé.*conv-B/)
  })

  it('le destinataire reçoit le bloc en tête de son tour, une fois ; l’outil ne rend ensuite que du neuf', async () => {
    const { bus: b } = bus()
    await b.exec(
      'ecrire_a_un_fil',
      { destinataire: 'conv-B', texte: 'premier' },
      'conv-A',
      undefined,
      't1'
    )
    const bloc = b.messagesDesFilsPourTour('conv-B')
    expect(bloc).toContain('nature « ordre » est du travail à faire')
    expect(bloc).toContain('premier')
    expect(b.messagesDesFilsPourTour('conv-B')).toBe('')
    const vide = await b.exec('lire_mes_messages', {}, 'conv-B')
    expect((vide.data as { messages: string }).messages).toBe('aucun message')
    await b.exec(
      'ecrire_a_un_fil',
      { destinataire: 'conv-B', texte: 'second' },
      'conv-A',
      undefined,
      't2'
    )
    const lu = await b.exec('lire_mes_messages', {}, 'conv-B')
    expect((lu.data as { messages: string }).messages).toContain('second')
    expect((lu.data as { messages: string }).messages).not.toContain('premier')
  })

  it('servis aux agents du chat ; chat_send renvoie l’information entre agents vers ecrire_a_un_fil', () => {
    expect(outilsDuChat(CATALOG)).toEqual(
      expect.arrayContaining(['ecrire_a_un_fil', 'lire_mes_messages', 'chat_send'])
    )
    const chatSend = CATALOG.find((c) => c.name === 'chat_send')
    expect(chatSend?.description).toMatch(/n utilise PAS chat_send.*ecrire_a_un_fil/)
    const ecrire = CATALOG.find((c) => c.name === 'ecrire_a_un_fil')
    // Aucun chemin de fichier en argument (RUN.md, verdict et tests hors d'atteinte).
    expect(Object.keys(ecrire?.args ?? {}).sort()).toEqual([
      'destinataire',
      'nature',
      'preuve',
      'repondA',
      'texte'
    ])
  })
})

/*
 * RÉVEIL PAR UN ORDRE (conv-1139, 2026-10-25, demande de l'utilisateur) : un message de nature
 * « ordre » vers un fil INACTIF y lance un tour, signé « Ordre de conv-X ». L'ordre est noté remis
 * par ce réveil, pour ne pas revenir une seconde fois dans le bloc en tête du même tour ; si le
 * tour ne démarre pas, il redevient en attente.
 */
describe('un ordre réveille le fil destinataire inactif', () => {
  const ordre = { destinataire: 'conv-B', texte: 'relance les tests de x.ts', nature: 'ordre' }

  it('fil inactif → un tour lancé chez lui, signé « Ordre de conv-A », remis une seule fois', async () => {
    const { bus: b, lances, prompts } = bus()
    const r = await b.exec('ecrire_a_un_fil', ordre, 'conv-A', undefined, 't1')
    expect(r.ok).toBe(true)
    const envoi = r.data as { id: string; reveil: string; detail: string }
    expect(lances).toEqual(['conv-B'])
    expect(prompts[0]).toMatch(/^Ordre de conv-A \(/)
    expect(prompts[0]).toContain('relance les tests de x.ts')
    expect(prompts[0]).toContain(envoi.id)
    expect(prompts[0]).toMatch(/pas l.utilisateur/)
    expect(envoi.reveil).toBe('lance')
    expect(envoi.detail).toMatch(/tour lancé dans conv-B/)
    // Déjà dans le message du tour réveillé : le bloc en tête de tour ne le rejoue pas.
    expect(b.messagesDesFilsPourTour('conv-B')).toBe('')
    const lignes = lignesDuJournal(readFileSync(cheminJournalMessagesFils(), 'utf8'))
    expect(lignes.at(-1)).toMatchObject({ type: 'livre', fil: 'conv-B', par: 'reveil' })
  })

  it('jumeau : une information vers le même fil inactif ne lance aucun tour', async () => {
    const { bus: b, lances } = bus()
    const r = await b.exec('ecrire_a_un_fil', { ...ordre, nature: 'info' }, 'conv-A')
    expect(r.ok).toBe(true)
    expect(lances).toEqual([])
  })

  it('fil occupé → aucun tour lancé ; l’ordre attend son prochain outil ou son prochain tour', async () => {
    const { bus: b, lances } = bus({ occupes: ['conv-B'] })
    const r = await b.exec('ecrire_a_un_fil', ordre, 'conv-A')
    expect(lances).toEqual([])
    expect((r.data as { reveil: string }).reveil).toBe('occupe')
    expect(b.messagesDesFilsPourTour('conv-B')).toContain('relance les tests de x.ts')
  })

  it('activité du fil invérifiable (sonde absente) → aucun réveil', async () => {
    const { bus: b, lances } = bus({ sonde: false })
    const r = await b.exec('ecrire_a_un_fil', ordre, 'conv-A')
    expect(lances).toEqual([])
    expect((r.data as { reveil: string }).reveil).toBe('indisponible')
  })

  it.each([
    ['refusé', async () => ({ ok: false, error: 'budget épuisé' })],
    [
      'en panne',
      async (): Promise<{ ok: boolean }> => {
        throw new Error('budget épuisé')
      }
    ]
  ])('tour %s → l’ordre redevient en attente, cause nommée', async (_cas, lancement) => {
    const { bus: b, lances } = bus({ lancement })
    const r = await b.exec('ecrire_a_un_fil', ordre, 'conv-A')
    expect(r.ok).toBe(true)
    expect(lances).toEqual(['conv-B'])
    const envoi = r.data as { reveil: string; detail: string }
    expect(envoi.reveil).toBe('echec')
    expect(envoi.detail).toMatch(/budget épuisé/)
    expect(messagesAAfficher('conv-B').map((m) => m.livre)).toEqual([false])
    expect(b.messagesDesFilsPourTour('conv-B')).toContain('relance les tests de x.ts')
  })
})
