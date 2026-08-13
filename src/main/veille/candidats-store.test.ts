import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CandidatVeille } from './candidats'
import {
  clesConnues,
  ecrireStockVeille,
  fusionnerPasse,
  lireStockVeille,
  type EchecSource,
  type StockVeille
} from './candidats-store'

/**
 * Le stock de veille : ce qu'il conserve, et les deux façons dont il pourrait mentir.
 *
 * (1) Écraser au lieu d'ajouter : un candidat écarté à la main reviendrait « nouveau » à chaque passe, et
 * la liste redemanderait sans fin ce qu'on vient de refuser.
 * (2) Perdre les échecs de source : une URL muette qui disparaît de l'affichage se lit « rien de neuf ».
 * Le cas est déjà CONCRET — la source Kimi de la liste initiale a sa dernière entrée en novembre 2025.
 */

const racines: string[] = []
afterEach(() => {
  for (const d of racines.splice(0)) rmSync(d, { recursive: true, force: true })
})

const chemin = (): string => {
  const dossier = mkdtempSync(join(tmpdir(), 'autowin-veille-'))
  racines.push(dossier)
  return join(dossier, 'veille-candidats.json')
}

const candidat = (partiel: Partial<CandidatVeille> = {}): CandidatVeille => ({
  id: 'codex|https://x/releases|support mcp distant',
  concurrent: 'Codex',
  titre: 'Support MCP distant',
  url: 'https://x/releases',
  dateSource: '2026-08-07',
  citation: 'Ajout du support des serveurs MCP distants avec OAuth',
  prompt: 'Implémente le support MCP distant',
  vuLe: '2026-08-13T00:00:00.000Z',
  statut: 'nouveau',
  ...partiel
})

const echec = (partiel: Partial<EchecSource> = {}): EchecSource => ({
  concurrent: 'Kimi',
  url: 'https://platform.kimi.ai/blog/posts/changelog',
  detail: 'HTTP 404',
  vuLe: '2026-08-13T00:00:00.000Z',
  ...partiel
})

describe('lecture et écriture', () => {
  it('un fichier absent rend un stock vide, sans lever', () => {
    expect(lireStockVeille(chemin())).toEqual({ candidats: [], echecs: [] })
  })

  it('un JSON corrompu rend un stock vide et ne supprime PAS le fichier', () => {
    const p = chemin()
    writeFileSync(p, '{ ceci n est pas du json', 'utf8')
    expect(lireStockVeille(p)).toEqual({ candidats: [], echecs: [] })
    // Effacer en silence perdrait des candidats récupérables à la main : le fichier reste sur le disque.
    expect(readFileSync(p, 'utf8')).toContain('ceci n est pas du json')
  })

  it('écrit puis relit à l’identique', () => {
    const p = chemin()
    const stock: StockVeille = {
      candidats: [candidat()],
      echecs: [echec()],
      dernierePasse: '2026-08-13T00:00:00.000Z'
    }
    ecrireStockVeille(stock, p)
    expect(lireStockVeille(p)).toEqual(stock)
  })

  it('ne laisse aucun fichier temporaire derrière lui', () => {
    const p = chemin()
    ecrireStockVeille({ candidats: [], echecs: [] }, p)
    // L'écriture passe par un `.tmp` renommé : le renommage doit avoir eu lieu, donc plus de `.tmp`.
    expect(() => readFileSync(`${p}.tmp`, 'utf8')).toThrow()
  })
})

describe('fusion d’une passe', () => {
  it('AJOUTE les nouveaux sans toucher aux existants', () => {
    const existant = candidat({ statut: 'prompte' })
    const stock: StockVeille = { candidats: [existant], echecs: [] }
    const fusionne = fusionnerPasse(stock, {
      retenus: [candidat({ id: 'autre', titre: 'Reprise auto', url: 'https://y/releases' })],
      echecs: [],
      maintenant: '2026-08-14T00:00:00.000Z'
    })
    expect(fusionne.candidats).toHaveLength(2)
    // LE point : un candidat déjà prompté reste prompté. Sinon la liste redemande ce qu'on a déjà lancé.
    expect(fusionne.candidats[0].statut).toBe('prompte')
  })

  it('ne réintroduit pas un candidat écarté à la main', () => {
    const ecarte = candidat({ statut: 'ecarte' })
    const stock: StockVeille = { candidats: [ecarte], echecs: [] }
    // La passe suivante relit la même page et rend la même entrée : elle ne doit pas repasser « nouveau ».
    const fusionne = fusionnerPasse(stock, {
      retenus: [candidat()],
      echecs: [],
      maintenant: '2026-08-14T00:00:00.000Z'
    })
    expect(fusionne.candidats).toHaveLength(1)
    expect(fusionne.candidats[0].statut).toBe('ecarte')
  })

  it('REMPLACE les échecs au lieu de les accumuler', () => {
    const stock: StockVeille = { candidats: [], echecs: [echec({ detail: 'HTTP 500' })] }
    const fusionne = fusionnerPasse(stock, {
      retenus: [],
      echecs: [],
      maintenant: '2026-08-14T00:00:00.000Z'
    })
    // Une source redevenue lisible sort d'elle-même : ce qui compte est « muette MAINTENANT ».
    expect(fusionne.echecs).toEqual([])
  })

  it('garde une passe sans candidat MAIS avec ses échecs', () => {
    // Le cas dangereux : zéro candidat. Sans les échecs affichés, ça se lit « rien de neuf » alors que la
    // veille n'a simplement rien pu lire.
    const fusionne = fusionnerPasse(
      { candidats: [], echecs: [] },
      { retenus: [], echecs: [echec()], maintenant: '2026-08-14T00:00:00.000Z' }
    )
    expect(fusionne.candidats).toHaveLength(0)
    expect(fusionne.echecs).toHaveLength(1)
    expect(fusionne.echecs[0].detail).toBe('HTTP 404')
    expect(fusionne.dernierePasse).toBe('2026-08-14T00:00:00.000Z')
  })

  it('les clés connues couvrent tout l’historique', () => {
    const stock: StockVeille = {
      candidats: [candidat(), candidat({ id: 'z', titre: 'Autre' })],
      echecs: []
    }
    expect(clesConnues(stock).size).toBe(2)
  })
})
