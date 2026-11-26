import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { redactedArgs } from './rejeu'
import { GESTES_MAX } from './outils-bureau-navigateur'
import type { GesteElement, GesteTv, ImageTv, ResultatGeste } from '../bureau/hdesk-tv'

/*
 * `bureau_cache_agir` avec `gestes` (plusieurs gestes en un appel, idée reprise du lot de
 * vercel-labs/agent-desktop) et `bureau_cache_observer` avec `racine` (lire une seule zone).
 * Avant : remplir un formulaire de N champs coûtait N allers-retours avec le modèle, et un écran chargé
 * perdait ce qui dépassait la limite de texte de l'arbre, sans moyen de le demander.
 */
const os = {
  conversations: { get: () => undefined, list: () => [] },
  listBrains: () => [],
  executionWorkspace: process.cwd()
} as unknown as ConstructorParameters<typeof AppCommandBus>[0]

const IMAGE: ImageTv = {
  statut: 'ok',
  id: 'chat-conv-7',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  width: 800,
  height: 600
}

function busBureau(rendus: ResultatGeste[] = []): {
  bus: AppCommandBus
  gestes: Array<GesteTv | GesteElement>
  observes: Array<{ id: string; racine?: string }>
} {
  const bus = new AppCommandBus(os, () => undefined)
  const gestes: Array<GesteTv | GesteElement> = []
  const observes: Array<{ id: string; racine?: string }> = []
  bus.agirBureauCache = async (g) => {
    gestes.push(g)
    return rendus[gestes.length - 1] ?? { ok: true }
  }
  bus.observerBureauCache = async (id, racine) => {
    observes.push({ id, ...(racine !== undefined ? { racine } : {}) })
    return { ...IMAGE, id, arbre: 'arbre' }
  }
  bus.ficheBureauCache = (id) => ({ id, conversationId: 'conv-7' }) as never
  return { bus, gestes, observes }
}

const donnees = (r: { data?: unknown }): Record<string, unknown> =>
  r.data as Record<string, unknown>

describe('bureau_cache_agir : plusieurs gestes en un appel', () => {
  it('joue les gestes dans l’ordre et rend le résultat de chacun', async () => {
    const { bus, gestes } = busBureau([
      {
        ok: true,
        action: {
          apres: {
            changement: true,
            attenteMs: 120,
            changements: ["Edit 'Nom' : valeur '' -> 'Dupont'"]
          }
        }
      },
      { ok: true },
      { ok: true }
    ])
    const r = await bus.exec(
      'bureau_cache_agir',
      {
        gestes: [
          { element: '@k3f9a2:e5', valeur: 'Dupont' },
          { element: '@k3f9a2:e8' },
          { x: 10, y: 20, texte: 'ok', entree: true }
        ]
      },
      'conv-7'
    )
    expect(gestes).toEqual([
      { id: 'chat-conv-7', element: '@k3f9a2:e5', valeur: 'Dupont' },
      { id: 'chat-conv-7', element: '@k3f9a2:e8' },
      { id: 'chat-conv-7', x: 10, y: 20, texte: 'ok', entree: true }
    ])
    const d = donnees(r)
    expect(d).toMatchObject({ ok: true, id: 'chat-conv-7', joues: 3, total: 3 })
    const resultats = d.resultats as Array<Record<string, unknown>>
    expect(resultats.map((x) => x.n)).toEqual([1, 2, 3])
    expect(resultats[0].detail).toContain("Edit 'Nom' : valeur '' -> 'Dupont'")
    expect(resultats[0].detail).toMatch(/^Champ rempli/)
    expect(resultats[1].detail).toMatch(/^Élément appuyé/)
    expect(resultats[2].detail).toBe('Geste envoyé (sans relecture de la fenêtre).')
  })

  it('s’arrête au premier refus : code rendu, gestes suivants non joués', async () => {
    const { bus, gestes } = busBureau([
      { ok: true },
      { ok: false, code: 'PERIME', message: 'L’élément @k3f9a2:e8 a changé.' },
      { ok: true }
    ])
    const r = await bus.exec(
      'bureau_cache_agir',
      { gestes: [{ element: 'Nom', valeur: 'a' }, { element: '@k3f9a2:e8' }, { x: 1, y: 2 }] },
      'conv-7'
    )
    expect(gestes).toHaveLength(2)
    const d = donnees(r)
    expect(d).toMatchObject({ ok: false, joues: 2, total: 3 })
    const resultats = d.resultats as Array<Record<string, unknown>>
    expect(resultats[1]).toMatchObject({ n: 2, ok: false, code: 'PERIME' })
    expect(String(d.detail)).toContain('Arrêt au geste n°2 sur 3')
    expect(String(d.detail)).toContain('a changé')
    expect(String(d.detail)).toContain("Les 1 geste(s) suivant(s) n'ont pas été joués.")
  })

  it('un geste mal formé est refusé AVANT le premier : rien n’est joué', async () => {
    for (const mauvais of [
      { element: 'OK', x: 1, y: 2 },
      { x: 1 },
      { element: 'OK', texte: 'a' },
      { valeur: 'sans élément' },
      { x: 1, y: 2, sansClic: 'oui' },
      { id: 'autre-bureau', x: 1, y: 2 },
      'Valider',
      [1, 2]
    ]) {
      const { bus, gestes } = busBureau()
      const r = await bus.exec(
        'bureau_cache_agir',
        { gestes: [{ element: 'Nom', valeur: 'a' }, mauvais] },
        'conv-7'
      )
      expect(gestes, JSON.stringify(mauvais)).toHaveLength(0)
      expect(donnees(r).ok, JSON.stringify(mauvais)).toBe(false)
      expect(String(donnees(r).detail), JSON.stringify(mauvais)).toMatch(
        /^Refusé : geste n°2 sur 2 : .*Aucun geste joué\.$/s
      )
    }
  })

  it('liste en texte (voie <cmd>) = même liste ; vide, illisible ou trop longue = refus', async () => {
    const { bus, gestes } = busBureau()
    await bus.exec(
      'bureau_cache_agir',
      { gestes: '[{"element":"Nom","valeur":"a"},{"x":"3","y":"4","entree":"true"}]' },
      'conv-7'
    )
    expect(gestes).toEqual([
      { id: 'chat-conv-7', element: 'Nom', valeur: 'a' },
      { id: 'chat-conv-7', x: 3, y: 4, entree: true }
    ])
    for (const [liste, motif] of [
      [[], /vide/],
      ['pas une liste', /liste d’objets/],
      [
        Array.from({ length: GESTES_MAX + 1 }, () => ({ x: 1, y: 1 })),
        new RegExp(`${GESTES_MAX + 1} gestes, ${GESTES_MAX} au plus`)
      ]
    ] as const) {
      const b = busBureau()
      const r = await b.bus.exec('bureau_cache_agir', { gestes: liste }, 'conv-7')
      expect(donnees(r).ok).toBe(false)
      expect(String(donnees(r).detail)).toMatch(motif)
      expect(b.gestes).toHaveLength(0)
    }
  })

  it('`gestes` ET un geste seul : refusé, rien n’est joué', async () => {
    const { bus, gestes } = busBureau()
    const r = await bus.exec(
      'bureau_cache_agir',
      { gestes: [{ x: 1, y: 2 }], element: 'OK' },
      'conv-7'
    )
    expect(donnees(r)).toMatchObject({ ok: false })
    expect(String(donnees(r).detail)).toContain('pas les deux (reçu aussi : element)')
    expect(gestes).toHaveLength(0)
    // `false` ne demande rien : la liste est jouée.
    await bus.exec('bureau_cache_agir', { gestes: [{ x: 1, y: 2 }], entree: false }, 'conv-7')
    expect(gestes).toEqual([{ id: 'chat-conv-7', x: 1, y: 2 }])
  })

  it('le geste seul garde sa réponse d’avant (ok, id, action, phrase qui dit de re-observer)', async () => {
    const { bus } = busBureau([{ ok: true, action: { cible: 'Edit' } }])
    const r = await bus.exec('bureau_cache_agir', { x: 1, y: 2 }, 'conv-7')
    expect(donnees(r)).toEqual({
      ok: true,
      id: 'chat-conv-7',
      action: { cible: 'Edit' },
      detail: 'Geste envoyé : re-observe (bureau_cache_observer) pour vérifier son effet.'
    })
  })

  it('les traces ne gardent ni la frappe ni les valeurs des gestes, liste ou texte', () => {
    const vraie = redactedArgs('bureau_cache_agir', {
      gestes: [
        { element: 'mdp', valeur: 'Secret123' },
        { x: 1, y: 2, texte: 'Secret123' }
      ]
    })
    expect(JSON.stringify(vraie)).not.toContain('Secret123')
    expect(vraie.gestes).toEqual([
      { element: 'mdp', valeur: '[9 caractères]' },
      { x: 1, y: 2, texte: '[9 caractères]' }
    ])
    const texte = redactedArgs('bureau_cache_agir', {
      gestes: '[{"element":"mdp","valeur":"Secret123"}]'
    })
    expect(JSON.stringify(texte)).not.toContain('Secret123')
    const casse = redactedArgs('bureau_cache_agir', { gestes: '[{"valeur":"Secret123"' })
    expect(JSON.stringify(casse)).not.toContain('Secret123')
  })
})

describe('bureau_cache_observer : lire une seule zone', () => {
  it('`racine` part au branchement, nettoyée ; absente = tout l’arbre', async () => {
    const { bus, observes } = busBureau()
    const r = await bus.exec('bureau_cache_observer', { racine: '  @k3f9a2:e57 ' }, 'conv-7')
    expect(donnees(r)).toMatchObject({ ok: true, racine: '@k3f9a2:e57', arbre: 'arbre' })
    await bus.exec('bureau_cache_observer', {}, 'conv-7')
    expect(observes).toEqual([{ id: 'chat-conv-7', racine: '@k3f9a2:e57' }, { id: 'chat-conv-7' }])
  })

  it('`racine` trop longue ou pas un texte : refus, aucune capture', async () => {
    const { bus, observes } = busBureau()
    for (const racine of ['x'.repeat(201), { ref: 1 }, ['a']]) {
      const r = await bus.exec('bureau_cache_observer', { racine }, 'conv-7')
      expect(donnees(r).ok).toBe(false)
      expect(String(donnees(r).detail)).toContain('`racine`')
    }
    expect(observes).toHaveLength(0)
  })

  it('le catalogue publie `racine` et `gestes` avec leurs vrais types', () => {
    const cat = new AppCommandBus(os, () => undefined).catalog()
    const observer = cat.find((c) => c.name === 'bureau_cache_observer')
    const agir = cat.find((c) => c.name === 'bureau_cache_agir')
    expect(observer?.argsTypes?.racine).toEqual({ type: 'string', maxLength: 200 })
    expect(agir?.argsTypes?.gestes?.type).toBe('array')
    expect(agir?.args.gestes).toContain(`liste de 1 à ${GESTES_MAX} gestes`)
    expect(Object.keys(agir?.argsTypes?.gestes?.items?.properties ?? {}).sort()).toEqual(
      ['element', 'entree', 'molette', 'sansClic', 'texte', 'touche', 'valeur', 'x', 'y'].sort()
    )
  })
})
