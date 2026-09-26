import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Une skill qui cite un fichier ABSENT du dépôt envoie l'agent réparer un kit qui n'existe pas.
 * Mesuré le 2026-09-12 : kaizen pointait `sync-kit.ps1`, `hooks/*.ps1` et `CLAUDE.md`, tous
 * inexistants ici — sa dernière étape était donc inexécutable. Ce test ferme la porte : tout
 * chemin de DÉPÔT cité entre backticks (`src/...` ou `skills/...`, sans joker) doit exister.
 */
const RACINE = join(__dirname, '..', '..')
const CHEMIN = /`((?:src|skills)\/[A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)`/g

describe('chemins de dépôt cités par les skills', () => {
  const skills = readdirSync(join(RACINE, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  it('scanne bien le kit (sinon l’assertion suivante ne prouve rien)', () => {
    expect(skills).toEqual(expect.arrayContaining(['kaizen', 'frame', 'scout', 'remake']))
  })

  it('ne cite jamais un fichier qui n’existe pas', () => {
    const morts: string[] = []
    for (const nom of skills) {
      const fichier = join(RACINE, 'skills', nom, 'SKILL.md')
      if (!existsSync(fichier)) continue
      const texte = readFileSync(fichier, 'utf8')
      for (const m of texte.matchAll(CHEMIN)) {
        const cible = m[1]
        if (cible.includes('*') || cible.includes('<')) continue
        if (!existsSync(join(RACINE, cible))) morts.push(`${nom}: ${cible}`)
      }
    }
    expect(morts).toEqual([])
  })
})
