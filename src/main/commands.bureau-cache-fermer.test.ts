import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import type { DemandeFermeture, GesteTv, ImageTv, ResultatFermeture } from './hdesk-tv'
import type { DemandeCreationBureau } from '../shared/hdesk-gestion'

/*
 * LOT 1 du RUN outils-agent-1-2-4-6-7 (conv-222) : l'outil Autowin `bureau_cache_fermer`.
 * Le pont d'outils (lot 2) ne sert que des commandes DÉCLARÉES au catalogue : sans cette
 * déclaration, il n'y aurait rien à servir.
 *
 * Deux promesses : la conversation vient du FIL COURANT, jamais du modèle (le script refuse le
 * bureau d'un autre fil, encore faut-il ne pas lui mentir sur le fil) ; et un outil non câblé
 * le DIT au lieu de prétendre avoir fermé.
 */
const os = {
  conversations: { get: () => undefined, list: () => [] },
  listBrains: () => [],
  executionWorkspace: process.cwd()
} as unknown as ConstructorParameters<typeof AppCommandBus>[0]

const busAvec = (
  rendu: ResultatFermeture = { ok: true, code: 0, ferme: true, forces: [], survivants: [] }
): { bus: AppCommandBus; appels: DemandeFermeture[] } => {
  const bus = new AppCommandBus(os, () => undefined)
  const appels: DemandeFermeture[] = []
  bus.fermerBureauCache = async (d) => {
    appels.push(d)
    return rendu
  }
  return { bus, appels }
}

describe('bureau_cache_fermer', () => {
  it('est déclaré au catalogue comme un geste destructif, sans argument de conversation', () => {
    const spec = new AppCommandBus(os, () => undefined)
      .catalog()
      .find((c) => c.name === 'bureau_cache_fermer')
    expect(spec).toBeDefined()
    expect(spec?.annotations?.destructiveHint).toBe(true)
    expect(spec?.annotations?.readOnlyHint).toBe(false)
    expect(Object.keys(spec?.args ?? {})).not.toContain('conversationId')
  })

  it('sans identifiant, ferme le bureau du fil courant (chat-<fil>)', async () => {
    const { bus, appels } = busAvec()
    const r = await bus.exec('bureau_cache_fermer', {}, 'conv-222')
    expect(r.ok).toBe(true)
    expect(appels).toEqual([{ id: 'chat-conv-222', conversationId: 'conv-222' }])
    expect(r.data).toMatchObject({ ferme: true, id: 'chat-conv-222' })
  })

  it('transmet un identifiant et un délai, mais garde le fil courant', async () => {
    const { bus, appels } = busAvec()
    await bus.exec(
      'bureau_cache_fermer',
      { id: 'run-abc', delaiDouxSecondes: '3', conversationId: 'conv-pirate' },
      'conv-222'
    )
    expect(appels).toEqual([{ id: 'run-abc', conversationId: 'conv-222', delaiDouxSecondes: 3 }])
  })

  // conv-344 : le mode « sans fiche » (aucun fil exigé) est réservé à la vue Bureaux cachés. Un
  // modèle qui le glisse en argument ne doit pas pouvoir fermer le bureau d'un autre fil par là.
  it('ignore un `sansFiche` glissé par le modèle : le fil courant reste exigé', async () => {
    const { bus, appels } = busAvec()
    await bus.exec('bureau_cache_fermer', { id: 'ui-capture-1', sansFiche: true }, 'conv-222')
    expect(appels).toEqual([{ id: 'ui-capture-1', conversationId: 'conv-222' }])
    expect(Object.keys(appels[0])).not.toContain('sansFiche')
  })

  it('rend le refus du script (autre conversation) sans le maquiller', async () => {
    const { bus } = busAvec({
      ok: false,
      code: 5,
      ferme: false,
      conversationOccupante: 'conv-b',
      erreur: "Bureau 'x' d'une autre conversation (conv-b)"
    })
    const r = await bus.exec('bureau_cache_fermer', { id: 'x' }, 'conv-222')
    expect(r.data).toMatchObject({ ferme: false, code: 5 })
    expect(String((r.data as { detail?: string }).detail)).toMatch(/autre conversation/)
  })

  it('refuse sans conversation courante, et dit quand il n est pas câblé', async () => {
    const { bus, appels } = busAvec()
    const sansFil = await bus.exec('bureau_cache_fermer', {})
    expect(sansFil.data).toMatchObject({ ferme: false })
    expect(appels).toEqual([])

    const nonCable = new AppCommandBus(os, () => undefined)
    const r = await nonCable.exec('bureau_cache_fermer', {}, 'conv-222')
    expect(r.data).toMatchObject({ ferme: false })
    expect(String((r.data as { detail?: string }).detail)).toMatch(/indisponible/i)
  })
})

/*
 * conv-344 (scout n°4) : lancer, observer et agir étaient des commandes PowerShell que l'agent
 * RECOPIAIT de sa consigne — d'où les identifiants inventés et les fils oubliés (le lanceur a dû
 * rendre -Travail obligatoire). Ces outils fixent le fil (celui de l'appel, jamais un argument) et
 * l'identifiant par défaut (`chat-<fil>`) ; observer et agir refusent le bureau d'un autre fil.
 */
describe('bureau_cache_lancer / observer / agir', () => {
  const FICHE_A_MOI = { id: 'chat-conv-222', conversationId: 'conv-222', pid: 1 }
  const IMAGE: ImageTv = {
    statut: 'ok',
    id: 'chat-conv-222',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 800,
    height: 600
  }
  const busOutils = (fiches: Array<{ id: string; conversationId?: string }> = [FICHE_A_MOI]) => {
    const bus = new AppCommandBus(os, () => undefined)
    const lancements: DemandeCreationBureau[] = []
    const observes: string[] = []
    const gestes: GesteTv[] = []
    bus.lancerBureauCache = async (d) => (
      lancements.push(d),
      { ok: true, id: d.id, pid: 42, message: `Bureau « ${d.id} » prêt.` }
    )
    bus.observerBureauCache = async (id) => (observes.push(id), { ...IMAGE, id })
    bus.agirBureauCache = async (g) => (gestes.push(g), { ok: true, action: { cible: 'Edit' } })
    bus.ficheBureauCache = (id) => fiches.find((f) => f.id === id)
    return { bus, lancements, observes, gestes }
  }

  it('sont déclarés au catalogue, sans argument de conversation', () => {
    const cat = new AppCommandBus(os, () => undefined).catalog()
    for (const nom of ['bureau_cache_lancer', 'bureau_cache_observer', 'bureau_cache_agir']) {
      const spec = cat.find((c) => c.name === nom)
      expect(spec, nom).toBeDefined()
      expect(Object.keys(spec?.args ?? {})).not.toContain('conversationId')
    }
    expect(cat.find((c) => c.name === 'bureau_cache_observer')?.annotations?.readOnlyHint).toBe(
      true
    )
  })

  it('lancer : fil de l’appel, identifiant chat-<fil> par défaut ; un conversationId glissé est ignoré', async () => {
    const { bus, lancements } = busOutils()
    const r = await bus.exec(
      'bureau_cache_lancer',
      {
        executable: 'C:\\Windows\\System32\\charmap.exe',
        arguments: '/x',
        travail: 'Essai',
        conversationId: 'conv-pirate'
      },
      'conv-222'
    )
    expect(r.ok).toBe(true)
    expect(lancements).toEqual([
      {
        id: 'chat-conv-222',
        executable: 'C:\\Windows\\System32\\charmap.exe',
        arguments: '/x',
        travail: 'Essai',
        conversationId: 'conv-222'
      }
    ])
    expect(r.data).toMatchObject({ ok: true, id: 'chat-conv-222' })
  })

  it.each([
    ['exécutable absent', { travail: 'Essai' }],
    ['travail absent', { executable: 'C:\\a.exe' }]
  ])('lancer : %s → refus nommé, rien n’est lancé', async (_cas, args) => {
    const { bus, lancements } = busOutils()
    const r = await bus.exec('bureau_cache_lancer', args, 'conv-222')
    expect(lancements).toEqual([])
    expect(r.data).toMatchObject({ ok: false })
  })

  it('observer : l’image part en pièce jointe pour le modèle', async () => {
    const { bus, observes } = busOutils()
    const r = await bus.exec('bureau_cache_observer', {}, 'conv-222')
    expect(observes).toEqual(['chat-conv-222'])
    expect(r.attachments).toEqual([
      {
        name: 'bureau-chat-conv-222.png',
        mimeType: 'image/png',
        size: expect.any(Number),
        kind: 'image',
        content: 'iVBORw0KGgo='
      }
    ])
    expect(r.data).toMatchObject({ statut: 'ok', id: 'chat-conv-222', width: 800, height: 600 })
  })

  it('agir : le geste part avec le fil vérifié, aux pixels de la capture', async () => {
    const { bus, gestes } = busOutils()
    const r = await bus.exec(
      'bureau_cache_agir',
      { x: '120', y: 80, texte: 'bonjour', entree: true },
      'conv-222'
    )
    expect(gestes).toEqual([{ id: 'chat-conv-222', x: 120, y: 80, texte: 'bonjour', entree: true }])
    expect(r.data).toMatchObject({ ok: true })
  })

  it('agir : le texte tapé n’atteint jamais la trace (un mot de passe passe par ici)', async () => {
    const { bus } = busOutils()
    const traces: Array<Record<string, unknown>> = []
    bus.trace = (_nom, args) => traces.push(args)
    await bus.exec('bureau_cache_agir', { x: 1, y: 1, texte: 'secret123' }, 'conv-222')
    expect(JSON.stringify(traces)).not.toContain('secret123')
    expect(traces[0]).toMatchObject({ texte: '[9 caractères]' })
  })

  it.each(['bureau_cache_observer', 'bureau_cache_agir'])(
    '%s : bureau d’un AUTRE fil, ou sans fiche → refus, rien n’est lancé',
    async (outil) => {
      const { bus, observes, gestes } = busOutils([{ id: 'chat-conv-b', conversationId: 'conv-b' }])
      const autre = await bus.exec(outil, { id: 'chat-conv-b', x: 1, y: 1 }, 'conv-222')
      expect(autre.data).toMatchObject({ ok: false })
      expect(String((autre.data as { detail?: string }).detail)).toMatch(/autre fil/)
      const sansFiche = await bus.exec(outil, { id: 'ui-capture-1', x: 1, y: 1 }, 'conv-222')
      expect(sansFiche.data).toMatchObject({ ok: false })
      expect(observes).toEqual([])
      expect(gestes).toEqual([])
    }
  )

  it.each(['bureau_cache_lancer', 'bureau_cache_observer', 'bureau_cache_agir'])(
    '%s : sans conversation courante → refus ; non câblé → « indisponible »',
    async (outil) => {
      const { bus, lancements, observes, gestes } = busOutils()
      const args = { executable: 'C:\\a.exe', travail: 'x', x: 1, y: 1 }
      expect((await bus.exec(outil, args)).data).toMatchObject({ ok: false })
      expect([...lancements, ...observes, ...gestes]).toEqual([])
      const nonCable = new AppCommandBus(os, () => undefined)
      const r = await nonCable.exec(outil, args, 'conv-222')
      expect(String((r.data as { detail?: string }).detail)).toMatch(/indisponible/i)
    }
  )
})
