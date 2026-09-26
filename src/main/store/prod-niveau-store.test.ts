import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { cheminNiveauProd, ecrireNiveauProd, lireNiveauProd } from './prod-niveau-store'

/**
 * LE NIVEAU DE PROTECTION SUR DISQUE. Le point vérifié partout ici : une anomalie retombe sur
 * `confirmation`, JAMAIS sur `aucun`. Effacer ou abîmer le fichier ne doit pas ouvrir la production.
 */
function racineNeuve(contenu?: string): string {
  const racine = mkdtempSync(`${tmpdir()}/prod-niveau-`)
  if (contenu !== undefined) writeFileSync(cheminNiveauProd(racine), contenu, 'utf8')
  return racine
}

describe('lecture du niveau', () => {
  it('rend « confirmation » quand le fichier est ABSENT', () => {
    expect(lireNiveauProd(racineNeuve())).toBe('confirmation')
  })

  it('rend « confirmation » quand le JSON est illisible', () => {
    expect(lireNiveauProd(racineNeuve('{ pas du json'))).toBe('confirmation')
  })

  it('rend « confirmation » quand le niveau écrit est inconnu', () => {
    expect(lireNiveauProd(racineNeuve('{"niveau":"ouvert"}'))).toBe('confirmation')
  })

  it('relit les trois niveaux valables', () => {
    for (const niveau of ['aucun', 'confirmation', 'phrase'] as const) {
      const racine = racineNeuve()
      ecrireNiveauProd(racine, niveau)
      expect(lireNiveauProd(racine)).toBe(niveau)
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('n’écrit rien d’autre que le niveau et sa date', () => {
    const racine = racineNeuve()
    ecrireNiveauProd(racine, 'phrase')
    const ecrit = JSON.parse(readFileSync(cheminNiveauProd(racine), 'utf8')) as Record<
      string,
      unknown
    >
    expect(Object.keys(ecrit).sort()).toEqual(['changeLe', 'niveau'])
  })
})
