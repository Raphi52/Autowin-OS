import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  armerRelanceAutoMoteur,
  changementSansEffetSurLeMoteur,
  empreinteDuCodeCompile,
  relanceAutoMoteurPermise,
  type ReglagesRelanceMoteur,
  type ResultatCompilation
} from './relance-auto-moteur'

/**
 * Relance automatique du moteur en dev (conv-918) : « l'app recompile le moteur et ne se relance
 * que quand aucun agent ne tourne ». Chaque test vise une façon de relancer À TORT (agent coupé,
 * code cassé, modification sans effet) ou de NE PAS relancer alors qu'il le fallait.
 */

const REGLAGES: ReglagesRelanceMoteur = {
  attenteApresModificationMs: 100,
  intervalleVerificationMs: 50,
  reposMinimalMs: 200,
  preavisMs: 300
}

function harnais(options: { initiale?: ResultatCompilation; modifieesAvant?: boolean } = {}) {
  let surChangement: (chemin: string) => void = () => {}
  const etat = {
    prochaine: options.initiale ?? ({ ok: true, empreinte: 'A' } as ResultatCompilation),
    repos: true,
    annonces: [] as string[],
    relances: [] as string[],
    surveillanceCoupee: false
  }
  const compiler = vi.fn(async (): Promise<ResultatCompilation> => etat.prochaine)
  const armee = armerRelanceAutoMoteur(
    {
      surveiller: (cb) => {
        surChangement = cb
        return () => {
          etat.surveillanceCoupee = true
        }
      },
      compiler,
      auRepos: () => etat.repos,
      annoncer: (texte) => etat.annonces.push(texte),
      relancer: (cause) => etat.relances.push(cause),
      sourcesModifieesDepuisLeDemarrage: async () => options.modifieesAvant ?? false
    },
    REGLAGES
  )
  return {
    etat,
    compiler,
    armee,
    modifier: (chemin = 'src/main/x.ts') => surChangement(chemin)
  }
}

describe('relance automatique du moteur', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('moteur modifié + aucun agent : préavis, puis relance — une seule fois', async () => {
    const h = harnais()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.armee.etat().empreinteChargee).toBe('A')

    h.etat.prochaine = { ok: true, empreinte: 'B' }
    h.modifier()
    await vi.advanceTimersByTimeAsync(100 + 200 + 50)
    expect(h.etat.annonces.at(-1)).toMatch(/^Moteur modifié : Autowin redémarre dans/)
    expect(h.etat.relances).toEqual([])

    await vi.advanceTimersByTimeAsync(400)
    expect(h.etat.relances).toHaveLength(1)
    expect(h.etat.relances[0]).toMatch(/aucun agent/)
    expect(h.etat.surveillanceCoupee).toBe(true)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.etat.relances).toHaveLength(1)
  })

  it('une modification qui ne change pas le code compilé (commentaire) ne relance rien', async () => {
    const h = harnais()
    await vi.advanceTimersByTimeAsync(0)
    h.modifier()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.compiler).toHaveBeenCalledTimes(2)
    expect(h.etat.annonces).toEqual([])
    expect(h.etat.relances).toEqual([])
  })

  it('un moteur qui ne compile pas ne relance JAMAIS, et le motif est dit une fois', async () => {
    const h = harnais()
    await vi.advanceTimersByTimeAsync(0)
    h.etat.prochaine = {
      ok: false,
      erreur: 'vite v7\nERROR: Expected ";" but found "}"\n  at src/main/x.ts:3:1'
    }
    h.modifier()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.etat.relances).toEqual([])
    expect(h.etat.annonces).toEqual([
      'Le moteur modifié ne compile pas : Autowin ne redémarre pas. ERROR: Expected ";" but found "}"'
    ])
    h.modifier()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.etat.annonces).toHaveLength(1)
  })

  it('une casse APRÈS un changement valide annule la relance qui attendait', async () => {
    const h = harnais()
    await vi.advanceTimersByTimeAsync(0)
    h.etat.repos = false
    h.etat.prochaine = { ok: true, empreinte: 'B' }
    h.modifier()
    await vi.advanceTimersByTimeAsync(150)
    expect(h.armee.etat().relanceEnAttente).toBe(true)

    h.etat.prochaine = { ok: false, erreur: 'error TS: cannot find module' }
    h.modifier()
    await vi.advanceTimersByTimeAsync(150)
    h.etat.repos = true
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.armee.etat().relanceEnAttente).toBe(false)
    expect(h.etat.relances).toEqual([])
  })

  it('tant qu’un agent tourne, aucune relance ; elle part au repos suivant', async () => {
    const h = harnais()
    await vi.advanceTimersByTimeAsync(0)
    h.etat.repos = false
    h.etat.prochaine = { ok: true, empreinte: 'B' }
    h.modifier()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.etat.annonces).toEqual([])
    expect(h.etat.relances).toEqual([])

    h.etat.repos = true
    await vi.advanceTimersByTimeAsync(600)
    expect(h.etat.relances).toHaveLength(1)
  })

  it('un agent qui démarre pendant le préavis reporte la relance, et le dit', async () => {
    const h = harnais()
    await vi.advanceTimersByTimeAsync(0)
    h.etat.prochaine = { ok: true, empreinte: 'B' }
    h.modifier()
    await vi.advanceTimersByTimeAsync(100 + 250)
    expect(h.armee.etat().preavisEnCours).toBe(true)

    h.etat.repos = false
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.etat.relances).toEqual([])
    expect(h.etat.annonces.at(-1)).toMatch(/^Redémarrage reporté/)

    h.etat.repos = true
    await vi.advanceTimersByTimeAsync(600)
    expect(h.etat.relances).toHaveLength(1)
  })

  it('un fichier de test modifié ne déclenche aucune compilation', async () => {
    const h = harnais()
    await vi.advanceTimersByTimeAsync(0)
    h.modifier('src/main/x.test.ts')
    h.modifier('src/main/__tests__/y.ts')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.compiler).toHaveBeenCalledTimes(1)
  })

  it('une rafale de modifications donne UNE compilation', async () => {
    const h = harnais()
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 10; i++) {
      h.modifier(`src/main/f${i}.ts`)
      await vi.advanceTimersByTimeAsync(50)
    }
    await vi.advanceTimersByTimeAsync(150)
    expect(h.compiler).toHaveBeenCalledTimes(2)
  })

  it('sources modifiées avant la surveillance : la mesure ne décrit pas le moteur chargé, on relance', async () => {
    const h = harnais({ modifieesAvant: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.armee.etat().empreinteChargee).toBeNull()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.etat.relances).toHaveLength(1)
  })

  it('une modification PENDANT la mesure initiale n’est pas perdue', async () => {
    let libererMesure: (r: ResultatCompilation) => void = () => {}
    let surChangement: (c: string) => void = () => {}
    const relances: string[] = []
    let appels = 0
    armerRelanceAutoMoteur(
      {
        surveiller: (cb) => {
          surChangement = cb
          return () => {}
        },
        compiler: () => {
          appels++
          if (appels === 1) return new Promise((r) => (libererMesure = r))
          return Promise.resolve({ ok: true, empreinte: 'B' })
        },
        auRepos: () => true,
        annoncer: () => {},
        relancer: (c) => relances.push(c)
      },
      REGLAGES
    )
    surChangement('src/main/x.ts')
    libererMesure({ ok: true, empreinte: 'B' })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(relances).toHaveLength(1)
  })
})

describe('relanceAutoMoteurPermise', () => {
  const base = {
    isPackaged: false,
    instanceIsolee: false,
    executionDeTache: false,
    env: { ELECTRON_RENDERER_URL: 'http://localhost:5173' }
  }
  it('active en dev principal sous le serveur de développement', () => {
    expect(relanceAutoMoteurPermise(base)).toBe(true)
  })
  it.each([
    ['version installée', { isPackaged: true }],
    ['instance de test isolée', { instanceIsolee: true }],
    ['exécution de tâche programmée', { executionDeTache: true }],
    ['hors serveur de développement', { env: {} }],
    ['interrupteur coupé', { env: { ...base.env, AUTOWIN_RELANCE_AUTO_MOTEUR: '0' } }]
  ])('désactivée : %s', (_nom, ecart) => {
    expect(relanceAutoMoteurPermise({ ...base, ...ecart })).toBe(false)
  })
})

describe('changementSansEffetSurLeMoteur', () => {
  it.each([
    ['src/main/a.test.ts', true],
    ['src\\main\\a.spec.tsx', true],
    ['src/main/__tests__/a.ts', true],
    ['src/main/a.ts', false],
    ['src/shared/test-utils.ts', false]
  ])('%s → %s', (chemin, attendu) => {
    expect(changementSansEffetSurLeMoteur(chemin)).toBe(attendu)
  })
})

describe('empreinteDuCodeCompile', () => {
  let dossier = ''
  afterEach(() => {
    if (dossier) rmSync(dossier, { recursive: true, force: true })
  })

  it('ne regarde que les .js : une carte de sources (.map) ne change pas l’empreinte', () => {
    dossier = mkdtempSync(join(tmpdir(), 'empreinte-moteur-'))
    mkdirSync(join(dossier, 'main', 'chunks'), { recursive: true })
    writeFileSync(join(dossier, 'main', 'index.js'), 'a()')
    writeFileSync(join(dossier, 'main', 'chunks', 'x.js'), 'b()')
    const avant = empreinteDuCodeCompile(dossier)
    writeFileSync(join(dossier, 'main', 'index.js.map'), '{"sourcesContent":["// commentaire"]}')
    expect(empreinteDuCodeCompile(dossier)).toBe(avant)
    writeFileSync(join(dossier, 'main', 'chunks', 'x.js'), 'c()')
    expect(empreinteDuCodeCompile(dossier)).not.toBe(avant)
  })
})
