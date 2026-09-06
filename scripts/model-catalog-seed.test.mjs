import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { racineDepot } from './racine-depot.mjs'

/*
 * POURQUOI CETTE GARDE : une instance isolee demarre sur un profil VIERGE. Le catalogue de modeles
 * par defaut est VIDE cote code (DEFAULT_IMPORTED_MODELS = []), donc la topologie par defaut ne peut
 * pas etre creee et le demarrage s'arrete AVANT l'ouverture du port CDP. `autowin-headless.ps1` seme
 * donc `scripts/fixtures/model-catalog-seed.json`. Si cette semence cesse de satisfaire le contrat
 * de lecture du cache (src/main/models.ts : isValidCachedModel / readCatalogCache), elle est
 * SILENCIEUSEMENT ignoree et l'instance redevient indemarrable. Ce test rend cet echec bruyant.
 */
const racine = racineDepot()
const semence = JSON.parse(readFileSync(join(racine, 'scripts/fixtures/model-catalog-seed.json'), 'utf8'))
const lanceur = readFileSync(join(racine, 'scripts/autowin-headless.ps1'), 'utf8')

describe('semence du catalogue de modeles', () => {
  it('respecte la version et la date de decouverte attendues par le cache', () => {
    expect(semence.version).toBe(1)
    expect(Number.isFinite(semence.discoveredAt)).toBe(true)
  })

  it('porte au moins un modele claude au contrat de isValidCachedModel', () => {
    expect(Array.isArray(semence.claude)).toBe(true)
    expect(semence.claude.length).toBeGreaterThan(0)
    for (const modele of semence.claude) {
      expect(modele.provider).toBe('claude')
      expect(modele.model).toMatch(/^claude-[a-z0-9-]+$/)
      expect(modele.id).toBe(`claude/${modele.model}`)
      expect(modele.label.trim().length).toBeGreaterThan(0)
      expect(modele.reasoningEfforts.length).toBeGreaterThan(0)
      for (const effort of modele.reasoningEfforts) {
        expect(['low', 'medium', 'high', 'xhigh', 'max']).toContain(effort)
      }
      expect(modele.reasoningEfforts).toContain(modele.defaultReasoningEffort)
    }
  })

  it("le lanceur seme ce fichier dans la racine de donnees reelle du profil isole", () => {
    expect(lanceur).toContain('fixtures/model-catalog-seed.json')
    expect(lanceur).toContain("Join-Path (Join-Path $userData 'app-data') 'autowin-os'")
    expect(lanceur).toContain('model-catalog.json')
  })

  it("ne remplace jamais un cache deja present", () => {
    expect(lanceur).toContain('if (-not (Test-Path -LiteralPath $cacheModeles))')
  })
})
