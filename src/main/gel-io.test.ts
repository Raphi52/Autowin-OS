import { describe, expect, it } from 'vitest'
import {
  cumulerAccesBloquant,
  instrumenterAccesBloquants,
  marquerOperation,
  preleverAccesCumules
} from './gel-main'
import { nommerAccesBloquant } from '../shared/gel-detector'
import type { Gel } from '../shared/gel-detector'

/**
 * INSTRUMENTATION DES ENTREES-SORTIES DU MAIN.
 *
 * Le temoin a prouve que les gels sont des `entree-sortie-bloquante` : la boucle est tenue par un
 * appel synchrone qui ne brule pas de CPU. Reste a le NOMMER — quel appel, sur quel chemin, et
 * s'il part vers le partage reseau (//ged2) ou vers le disque local.
 */
describe('nommerAccesBloquant — nommer le coupable, pas seulement le constater', () => {
  it('distingue un acces RESEAU d’un acces disque local', () => {
    expect(nommerAccesBloquant('readFileSync', '//ged2/rig/Projets IA/x.md')).toBe(
      'io:reseau:readFileSync //ged2/rig/…/x.md'
    )
    // Chemin UNC Windows, ecrit sans litteral echappe pour rester lisible.
    const b = String.fromCharCode(92)
    expect(nommerAccesBloquant('readFileSync', `${b}${b}ged2${b}rig${b}x.md`)).toContain(
      'io:reseau:'
    )
    expect(nommerAccesBloquant('readFileSync', `C:${b}Amitel${b}Autowin OS${b}package.json`)).toBe(
      'io:disque:readFileSync C:/…/package.json'
    )
  })

  it('reste lisible sans cible et ne jette jamais sur une cible non textuelle', () => {
    expect(nommerAccesBloquant('readFileSync')).toBe('io:disque:readFileSync')
    expect(nommerAccesBloquant('readSync', 12)).toBe('io:disque:readSync')
  })
})

describe('instrumenterAccesBloquants — mesure DIRECTE du segment synchrone', () => {
  function hoteFactice(dureeMs: number): { lire: (chemin: string) => string } {
    return {
      lire(chemin: string): string {
        const fin = Date.now() + dureeMs
        while (Date.now() < fin) {
          /* on TIENT la boucle, exactement comme un readFileSync sur //ged2 */
        }
        return `contenu:${chemin}`
      }
    }
  }

  it('journalise un acces lent, nomme et cause entree-sortie-bloquante', () => {
    marquerOperation('')
    const gels: Gel[] = []
    const hote = hoteFactice(40)
    const defaire = instrumenterAccesBloquants(hote, ['lire'], 20, (g) => gels.push(g))
    expect(hote.lire('//ged2/rig/a.md')).toBe('contenu://ged2/rig/a.md')
    defaire()
    expect(gels).toHaveLength(1)
    expect(gels[0]?.operation).toBe('io:reseau:lire //ged2/rig/a.md')
    expect(gels[0]?.cause).toBe('entree-sortie-bloquante')
    expect(gels[0]?.blocageMs).toBeGreaterThanOrEqual(20)
  })

  // ENTREE QUI DOIT FAIRE ECHOUER une correction fausse (journalisation aveugle) :
  it('ne journalise RIEN sous le seuil — un acces rapide n’est pas un gel', () => {
    const gels: Gel[] = []
    const hote = hoteFactice(0)
    const defaire = instrumenterAccesBloquants(hote, ['lire'], 500, (g) => gels.push(g))
    for (let i = 0; i < 50; i += 1) hote.lire('C:/x.md')
    defaire()
    expect(gels).toEqual([])
  })

  // ENTREE QUI DOIT FAIRE ECHOUER un wrapper qui avale ou altere le comportement :
  it('laisse passer le jet d’origine et restaure la fonction au defaire', () => {
    const gels: Gel[] = []
    const originale = (): never => {
      throw new Error('ENOENT')
    }
    const hote: { lire: () => never } = { lire: originale }
    const defaire = instrumenterAccesBloquants(hote, ['lire'], 0, (g) => gels.push(g))
    expect(() => hote.lire()).toThrow('ENOENT')
    expect(gels).toHaveLength(1)
    defaire()
    expect(hote.lire).toBe(originale)
  })
})

describe('instrumenterEntreesSortiesDuMain — cablage sur les vrais modules', () => {
  it('capte un readFileSync REEL et le nomme, puis restaure fs a l’identique', async () => {
    const { instrumenterEntreesSortiesDuMain } = await import('./gel-main')
    // Le main est bundle en CJS : ses appels passent par l'OBJET de module require('node:fs'),
    // c'est donc lui qu'on patche et qu'on verifie ici (un namespace ESM, lui, est fige).
    const { createRequire } = await import('node:module')
    const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs')
    const gels: Gel[] = []
    const avant = fs.readFileSync
    const defaire = instrumenterEntreesSortiesDuMain(0, (g) => gels.push(g))
    fs.readFileSync('package.json', 'utf8')
    defaire()
    expect(gels.some((g) => g.operation.startsWith('io:disque:readFileSync'))).toBe(true)
    expect(gels.every((g) => g.cause === 'entree-sortie-bloquante')).toBe(true)
    expect(fs.readFileSync).toBe(avant)
  })

  it('preserve les SOUS-FONCTIONS de l’API patchee (realpathSync.native)', async () => {
    const { instrumenterEntreesSortiesDuMain } = await import('./gel-main')
    const { createRequire } = await import('node:module')
    const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs')
    const avant = fs.realpathSync
    const defaire = instrumenterEntreesSortiesDuMain(0, () => {})
    try {
      /*
       * REGRESSION DU 2026-08-31 (conv-9). `fs.realpathSync` porte une sous-fonction `.native`, et
       * un enrobage nu ne la transportait pas : des le demarrage, les dix sites
       * `realpathSync.native(...)` du main tombaient sur « node_fs.realpathSync.native is not a
       * function » (`os:semanticTimeline` mort, telemetrie indisponible). Observer un appel ne doit
       * jamais amputer sa surface d'API.
       */
      expect(typeof fs.realpathSync.native).toBe('function')
      const resolu = fs.realpathSync.native(process.cwd())
      expect(typeof resolu).toBe('string')
      expect(resolu.length).toBeGreaterThan(0)
    } finally {
      defaire()
    }
    expect(fs.realpathSync).toBe(avant)
  })
})

import { nommerAccumulation } from '../shared/gel-detector'

/**
 * MORT PAR MILLE COUPURES — mesure du 2026-09-02 sur le journal reel de l'utilisateur : sept gels
 * de 9,1 a 12,6 s, tous `operation:'inconnu'`, cause `entree-sortie-bloquante`, alors que
 * node:fs ET node:child_process sont instrumentes depuis le 2026-08-31. Explication trouvee dans
 * l'instrument lui-meme : il ne journalise qu'un appel dont la duree SEULE depasse le seuil. Cent
 * lectures de 100 ms tiennent la boucle dix secondes et ne laissent AUCUNE trace.
 *
 * L'entree falsifiante est donc celle-ci : 100 appels de 100 ms, chacun tres en dessous du seuil,
 * pendant un gel de 12 s. L'ancien instrument n'ecrivait rien ; le cumul doit les nommer.
 */
describe('accumulation d appels courts — nommer ce qu aucun appel isole ne trahit', () => {
  it('nomme readFileSync quand 100 appels de 100 ms expliquent un gel de 12 s', () => {
    preleverAccesCumules()
    for (let i = 0; i < 100; i++) cumulerAccesBloquant('readFileSync', 100)
    for (let i = 0; i < 5; i++) cumulerAccesBloquant('statSync', 4)
    const cumules = preleverAccesCumules()
    const nommes = nommerAccumulation(cumules, 12_000)
    expect(nommes?.[0]).toEqual({ operation: 'readFileSync', cumulMs: 10_000, appels: 100 })
    expect(nommes?.[1]).toEqual({ operation: 'statSync', cumulMs: 20, appels: 5 })
  })

  it('n accuse PERSONNE quand le cumul n explique pas le gel (200 ms sur 12 s)', () => {
    preleverAccesCumules()
    cumulerAccesBloquant('readFileSync', 200)
    expect(nommerAccumulation(preleverAccesCumules(), 12_000)).toBeUndefined()
  })

  it('remet le cumul a zero une fois preleve — un gel n herite pas de la fenetre precedente', () => {
    preleverAccesCumules()
    cumulerAccesBloquant('readFileSync', 5_000)
    expect(preleverAccesCumules()).toHaveLength(1)
    expect(preleverAccesCumules()).toEqual([])
    expect(nommerAccumulation([], 12_000)).toBeUndefined()
  })

  it('cumule aussi les appels SOUS le seuil, que l ancien instrument jetait', () => {
    const hote = {
      lire(): string {
        const fin = Date.now() + 30
        while (Date.now() < fin) {
          /* segment synchrone court : sous le seuil, donc jamais journalise */
        }
        return 'ok'
      }
    }
    const gels: Gel[] = []
    const defaire = instrumenterAccesBloquants(hote, ['lire'], 1_000, (gel) => gels.push(gel))
    preleverAccesCumules()
    hote.lire()
    hote.lire()
    defaire()
    const cumules = preleverAccesCumules()
    expect(gels).toEqual([])
    expect(cumules.find((c) => c.operation === 'lire')?.appels).toBe(2)
    expect(cumules.find((c) => c.operation === 'lire')?.cumulMs ?? 0).toBeGreaterThanOrEqual(50)
  })
})

/**
 * MORT PAR MILLE COUPURES : le cumul doit dire QUI, pas seulement QUOI.
 *
 * Mesure du 2026-09-03 : un gel de demarrage porte `execFileSync git for-each-ref` x27 (2 252 ms)
 * sans aucun appelant — le champ pose sur l'appel UNIQUE hors seuil ne couvre pas les cumuls, qui
 * sont pourtant la forme habituelle des gels.
 */
describe('appelant dominant d’un cumul', () => {
  it('garde l’appelant qui porte le plus de temps, pas le plus frequent', () => {
    preleverAccesCumules()
    cumulerAccesBloquant('execFileSync git status', 50, 'store/worktree-manager.ts:1209:7')
    cumulerAccesBloquant('execFileSync git status', 50, 'store/worktree-manager.ts:1209:7')
    cumulerAccesBloquant('execFileSync git status', 400, 'main/commands.ts:1710:9')
    const [entree] = preleverAccesCumules()
    expect(entree.operation).toBe('execFileSync git status')
    expect(entree.cumulMs).toBe(500)
    expect(entree.appels).toBe(3)
    expect(entree.appelant).toBe('main/commands.ts:1710:9')
  })
  it('n’invente aucun appelant quand aucun n’a ete capture', () => {
    preleverAccesCumules()
    cumulerAccesBloquant('readFileSync', 12)
    expect(preleverAccesCumules()[0].appelant).toBeUndefined()
  })
})
