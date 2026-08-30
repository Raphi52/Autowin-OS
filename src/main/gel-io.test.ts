import { describe, expect, it } from 'vitest'
import { instrumenterAccesBloquants, marquerOperation } from './gel-main'
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
})
