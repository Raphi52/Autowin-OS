import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  classerGels,
  lireJournal,
  principal,
  rendreClassement,
  resoudreAppelant
} from './gels-classement.mjs'

/*
 * Le cas fondateur (queue de gels.jsonl, 2026-10-21 07:34Z) : un gel de fenêtre de 30 734 ms dont
 * `accumulation` porte un `git status`, ET la ligne `io:` du même `git status` écrite à part.
 */
const FENETRE = {
  ts: '2026-10-21T07:34:13.534Z',
  blocageMs: 30734,
  operation: 'spawn git status',
  cause: 'entree-sortie-bloquante',
  appelant: 'main/index.js:1:1',
  accumulation: [
    {
      operation: 'spawn git status',
      cumulMs: 15040,
      appels: 2,
      appelant: 'main/index.js:2:1 < main/index.js:1:1'
    },
    { operation: 'renameSync', cumulMs: 10008, appels: 1, appelant: 'main/index.js:3:1' }
  ]
}
const UNITAIRE = {
  ts: '2026-10-21T07:34:07.837Z',
  blocageMs: 15025,
  operation: 'io:processus:spawn git status',
  cause: 'entree-sortie-bloquante',
  appelant: 'main/index.js:1:1'
}
const RENDU = {
  ts: '2026-10-20T09:55:32.381Z',
  blocageMs: 1590,
  operation: 'renderer:chat-saisie',
  cause: 'boucle-tenue',
  conversationId: 'conv-1025'
}

describe('classerGels — trois familles, jamais additionnées', () => {
  it('ne compte PAS deux fois l appel lent déjà inclus dans le gel de fenêtre', () => {
    const c = classerGels([FENETRE, UNITAIRE, RENDU])
    expect(c.totaux.fenetre).toEqual({ gels: 1, cumulMs: 30734, pireMs: 30734 })
    expect(c.totaux.unitaires).toEqual({ appels: 1, cumulMs: 15025 })
    expect(c.totaux.rendu.cumulMs).toBe(1590)
    expect(c.fenetre.map((o) => o.operation)).toEqual(['spawn git status'])
  })

  it('attribue la fenêtre à ses contributeurs mesurés, du plus coûteux au moins coûteux', () => {
    const c = classerGels([FENETRE])
    expect(c.appelants.map((a) => [a.operation, a.cumulMs, a.appels])).toEqual([
      ['spawn git status', 15040, 2],
      ['renameSync', 10008, 1]
    ])
  })

  it('sans accumulation, prend l appelant du gel ; sans rien, le compte à part', () => {
    const c = classerGels([
      { ts: FENETRE.ts, blocageMs: 900, operation: 'readFileSync', appelant: 'main/index.js:3:1' },
      { ts: FENETRE.ts, blocageMs: 700, operation: 'inconnu', indice: 'trace' }
    ])
    expect(c.appelants).toHaveLength(1)
    expect(c.appelants[0]).toMatchObject({ operation: 'readFileSync', cumulMs: 900 })
    expect(c.totaux.sansAppelant).toEqual({ gels: 1, cumulMs: 700 })
    // Un gel anonyme garde sa piste dans son nom de groupe.
    expect(c.fenetre.map((o) => o.operation)).toContain('inconnu (piste: trace)')
  })

  it('compte à part démarrages, gels non imputables, lignes hors période et sans durée', () => {
    const c = classerGels(
      [
        { ts: FENETRE.ts, temoin: 'demarrage' },
        { ts: FENETRE.ts, blocageMs: 5000, operation: 'x', cause: 'process-prive-de-cpu' },
        { ts: '2026-01-01T00:00:00.000Z', blocageMs: 9000, operation: 'vieux' },
        { ts: FENETRE.ts, blocageMs: 0, operation: 'nul' }
      ],
      { depuisMs: Date.parse('2026-10-01T00:00:00Z') }
    )
    expect(c.totaux.demarrages).toBe(1)
    expect(c.totaux.nonImputables).toEqual({ gels: 1, cumulMs: 5000 })
    expect(c.totaux.horsPeriode).toBe(1)
    expect(c.totaux.sansDuree).toBe(1)
    expect(c.totaux.fenetre.gels).toBe(0)
  })

  it('range les gels du rendu avec les fils où ils sont survenus', () => {
    const c = classerGels([RENDU, { ...RENDU, ts: '2026-10-20T10:00:00.000Z' }])
    expect(c.rendu[0]).toMatchObject({ operation: 'renderer:chat-saisie', gels: 2 })
    expect(c.rendu[0].conversations).toEqual({ 'conv-1025': 2 })
  })

  it('compte une ligne illisible au lieu de la jeter', () => {
    const { gels, illisibles } = lireJournal(`${JSON.stringify(RENDU)}\n{pas du json\n\n`)
    expect(gels).toHaveLength(1)
    expect(illisibles).toBe(1)
  })
})

/*
 * Un bundle factice et sa carte : ligne 1 -> src/main/a.ts:1, ligne 2 -> src/main/gel-main.ts
 * (l'instrument, à sauter), ligne 3 -> src/main/a.ts:3. VLQ : AAAA, ACAA (source +1), ADEA
 * (source -1, ligne +2).
 */
function bundleFactice() {
  const racine = mkdtempSync(join(tmpdir(), 'gels-classement-'))
  mkdirSync(join(racine, 'main'), { recursive: true })
  const carte = join(racine, 'main', 'index.js.map')
  writeFileSync(
    carte,
    JSON.stringify({
      version: 3,
      sources: ['../../src/main/a.ts', '../../src/main/gel-main.ts'],
      names: [],
      mappings: 'AAAA;ACAA;ADEA'
    })
  )
  return { racine, carte }
}

describe('resoudreAppelant — du bundle aux sources', () => {
  it('remonte chaque frame à src/…:ligne et saute l instrument lui-même', () => {
    const { racine, carte } = bundleFactice()
    utimesSync(carte, new Date('2026-10-20T08:00:00Z'), new Date('2026-10-20T08:00:00Z'))
    const r = resoudreAppelant('main/index.js:2:1 < main/index.js:3:1 < main/index.js:1:1', {
      racineOut: racine,
      gelTs: '2026-10-21T07:34:13.534Z'
    })
    expect(r.sources).toEqual(['src/main/a.ts:3', 'src/main/a.ts:1'])
    expect(r.carte).toBe('en-vigueur')
  })

  it('signale une carte réécrite APRÈS le gel : la position n est plus fiable', () => {
    const { racine, carte } = bundleFactice()
    utimesSync(carte, new Date('2026-10-21T09:00:00Z'), new Date('2026-10-21T09:00:00Z'))
    const r = resoudreAppelant('main/index.js:1:1', {
      racineOut: racine,
      gelTs: '2026-10-21T07:34:13.534Z'
    })
    expect(r.carte).toBe('posterieure-au-gel')
  })

  /*
   * Juge de conv-1043 (2026-10-21) : une carte écrite AVANT le gel mais APRÈS le démarrage qui le
   * précède décrit un bundle reconstruit pendant que l'app tournait encore sur l'ancien code ; elle
   * était déclarée `en-vigueur`. Entrée qui rend ces tests rouges : démarrage 06:00, carte 07:00,
   * gel 07:34.
   */
  it('signale une carte écrite après le démarrage qui précède le gel : ce n est pas le code qui tournait', () => {
    const { racine, carte } = bundleFactice()
    utimesSync(carte, new Date('2026-10-21T07:00:00Z'), new Date('2026-10-21T07:00:00Z'))
    const r = resoudreAppelant('main/index.js:1:1', {
      racineOut: racine,
      gelTs: FENETRE.ts,
      demarrageMs: Date.parse('2026-10-21T06:00:00Z')
    })
    expect(r.carte).toBe('posterieure-au-demarrage')
  })

  it('une carte écrite avant ce démarrage reste en vigueur', () => {
    const { racine, carte } = bundleFactice()
    utimesSync(carte, new Date('2026-10-21T05:00:00Z'), new Date('2026-10-21T05:00:00Z'))
    const r = resoudreAppelant('main/index.js:1:1', {
      racineOut: racine,
      gelTs: FENETRE.ts,
      demarrageMs: Date.parse('2026-10-21T06:00:00Z')
    })
    expect(r).toEqual({ sources: ['src/main/a.ts:1'], carte: 'en-vigueur' })
  })

  it('le classement prend le démarrage qui PRÉCÈDE le gel, même hors période, jamais un démarrage suivant', () => {
    const { racine, carte } = bundleFactice()
    utimesSync(carte, new Date('2026-10-21T07:00:00Z'), new Date('2026-10-21T07:00:00Z'))
    const demarrage = (ts) => ({
      ts,
      blocageMs: 0,
      operation: 'detecteur:demarre',
      temoin: 'demarrage'
    })
    const c = classerGels(
      [demarrage('2026-10-21T06:00:00.000Z'), FENETRE, demarrage('2026-10-21T08:22:19.231Z')],
      { depuisMs: Date.parse('2026-10-21T07:00:00Z') }
    )
    const texte = rendreClassement(c, { racineOut: racine })
    expect(texte).toContain('posterieure-au-demarrage')
    expect(texte).toContain('(non résolu)')
    expect(texte).not.toContain('src/main/a.ts')
  })

  it('le classement rend alors la frame brute, pas une source qui enverrait corriger ailleurs', () => {
    const { racine, carte } = bundleFactice()
    utimesSync(carte, new Date('2026-10-21T09:00:00Z'), new Date('2026-10-21T09:00:00Z'))
    const texte = rendreClassement(classerGels([FENETRE]), { racineOut: racine })
    expect(texte).toContain('(non résolu)')
    expect(texte).not.toContain('src/main/a.ts')
  })

  /*
   * Mesuré sur le vrai journal le 2026-10-21 : la pile `main/index.js:… < chunks/worktree-manager-
   * CMl2mhoZ.js:…` d'un gel du 15/10 (morceau haché disparu depuis, donc SANS carte) était remontée
   * par la carte du 20/10 vers `conversation-file-trace-spool.ts:68` — `if (!trimmed) return null`,
   * ni `renameSync` ni PowerShell — et rendue comme une source, colonne « absente ». La carte
   * absente du second morceau effaçait le constat « postérieure » posé par le premier.
   * Entrée qui rend ces tests rouges : une pile qui MÉLANGE une carte réécrite après le gel et un
   * morceau sans carte, dans un sens ou dans l'autre.
   */
  it('une carte postérieure au gel l emporte sur une carte absente, quel que soit l ordre', () => {
    const { racine, carte } = bundleFactice()
    utimesSync(carte, new Date('2026-10-21T09:00:00Z'), new Date('2026-10-21T09:00:00Z'))
    for (const appelant of [
      'main/index.js:1:1 < chunks/disparu-Q7BF3nQA.js:5:5',
      'chunks/disparu-Q7BF3nQA.js:5:5 < main/index.js:1:1'
    ]) {
      const r = resoudreAppelant(appelant, { racineOut: racine, gelTs: FENETRE.ts })
      expect(r.carte, appelant).toBe('posterieure-au-gel')
    }
  })

  it('le classement ne rend pas la source tirée d une carte postérieure, même à côté d un morceau sans carte', () => {
    const { racine, carte } = bundleFactice()
    utimesSync(carte, new Date('2026-10-21T09:00:00Z'), new Date('2026-10-21T09:00:00Z'))
    const gel = {
      ...FENETRE,
      accumulation: [
        {
          operation: 'renameSync',
          cumulMs: 9600,
          appels: 4,
          appelant: 'main/index.js:1:1 < chunks/disparu-Q7BF3nQA.js:5:5'
        }
      ]
    }
    const texte = rendreClassement(classerGels([gel]), { racineOut: racine })
    expect(texte).toContain('(non résolu)')
    expect(texte).not.toContain('src/main/a.ts')
  })

  it('jumeau accepté : une carte d AVANT le gel garde sa source, même à côté d un morceau sans carte', () => {
    const { racine, carte } = bundleFactice()
    utimesSync(carte, new Date('2026-10-20T08:00:00Z'), new Date('2026-10-20T08:00:00Z'))
    const r = resoudreAppelant('main/index.js:1:1 < chunks/disparu-Q7BF3nQA.js:5:5', {
      racineOut: racine,
      gelTs: FENETRE.ts
    })
    expect(r.carte).toBe('absente')
    expect(r.sources[0]).toBe('src/main/a.ts:1')
    expect(r.sources[1]).toContain('carte absente')
  })

  it('dit quand la carte manque, sans inventer de source', () => {
    const r = resoudreAppelant('main/index.js:1:1', {
      racineOut: mkdtempSync(join(tmpdir(), 'gels-sans-carte-')),
      gelTs: FENETRE.ts
    })
    expect(r.carte).toBe('absente')
    expect(r.sources[0]).toContain('carte absente')
  })
})

describe('principal — codes de sortie', () => {
  const muet = () => {}

  it('journal absent -> 2', () => {
    expect(principal(['--journal', join(tmpdir(), 'nulle-part', 'gels.jsonl')], muet)).toBe(2)
  })

  it('ni gel ni démarrage dans la période -> 3 (on ne conclut pas sur un journal muet)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gels-vide-'))
    writeFileSync(
      join(dir, 'gels.jsonl'),
      `${JSON.stringify({ ...RENDU, ts: '2026-01-01T00:00:00Z' })}\n`
    )
    expect(principal(['--journal', join(dir, 'gels.jsonl'), '--jours', '1'], muet)).toBe(3)
  })

  it('un journal avec des gels dans la période -> 0 et un classement lisible', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gels-plein-'))
    writeFileSync(
      join(dir, 'gels.jsonl'),
      [FENETRE, UNITAIRE, RENDU].map((g) => JSON.stringify(g)).join('\n')
    )
    const lignes = []
    const code = principal(
      ['--journal', join(dir, 'gels.jsonl'), '--depuis', '2026-10-01T00:00:00Z', '--out', dir],
      (l) => lignes.push(l)
    )
    expect(code).toBe(0)
    expect(lignes.join('\n')).toContain('Fenêtre figée : **30.7 s** en 1 gels')
  })
})
