import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ChatGPT constitution', () => {
  it('looks beyond the immediate request instead of stopping at minimum compliance', () => {
    const soul = readFileSync(join(process.cwd(), 'resources', 'kit-soul.md'), 'utf8')

    expect(soul).toContain("inférer la destination probable de l'utilisateur")
    expect(soul).toContain('regarder un à deux coups plus loin')
    expect(soul).toContain("Le minimum conforme n'est pas une condition d'arrêt")
    expect(soul).toContain("n'autorise ni extension silencieuse du périmètre ni mutation non demandée")
    expect(soul).toContain("signal explicite de l'utilisateur ou d'un artefact observé")
    expect(soul).toContain('une seule extension concrète à forte valeur, en une phrase')
    expect(soul).toContain('sans lancer de nouvel outil ni de recherche supplémentaire')
    expect(soul).toContain('Une demande explicitement bornée')
    expect(soul).toContain("Un artefact peut confirmer un état, jamais définir à lui seul l'intention utilisateur")
    expect(soul).toContain('sécurité, accès, données personnelles ou secrets')
  })
})
