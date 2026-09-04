import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  nettoyerDossiersTemporairesDeTest,
  prefixesTemporairesDeLaSuite
} from './temp-cleanup'

/**
 * LA FUITE QUE CECI FERME — mesuree le 2026-09-04 sur le dossier temporaire du poste :
 * 15 581 dossiers residuels, dont `gel-` (1 582), `cible-` (1 356), `ledger-refus-` (1 169),
 * `moteur-`, `flux-brut-`, `tests-view-`... AUCUN ne commence par `autowin` ni `aos-`, les deux
 * seuls prefixes que le nettoyage connaissait. Allonger la liste a la main rouvre le trou au
 * prochain test ecrit : les prefixes se LISENT donc dans le code de la suite.
 */
describe('prefixes temporaires derives du code de la suite', () => {
  it('trouve un prefixe declare dans un fichier de test, sans liste a maintenir', () => {
    const faux = mkdtempSync(join(tmpdir(), 'autowin-prefixes-derives-'))
    mkdirSync(join(faux, 'src'), { recursive: true })
    writeFileSync(
      join(faux, 'src', 'quelque-chose.test.ts'),
      "const r = mkdtempSync(join(tmpdir(), 'ledger-refus-'))\n"
    )

    const prefixes = prefixesTemporairesDeLaSuite(faux)

    expect(prefixes).toContain('ledger-refus-')
    // Trop generique pour servir de critere : ecarte.
    expect(prefixes).not.toContain('tj-')
    expect(prefixes).not.toContain('...')
    // Les deux prefixes historiques restent couverts meme si aucun fichier ne les cite.
    expect(prefixes).toContain('autowin')
    expect(prefixes).toContain('aos-')
  })

  it('supprime un dossier au prefixe derive, ne pendant le run', () => {
    // RACINE ISOLEE, JAMAIS `tmpdir()`. Mesure du 2026-09-04 : balayer le vrai dossier temporaire
    // depuis un test arrachait les depots git des autres workers en plein travail
    // (« Command failed: git init -q -b main », ~20 rouges). Le nettoyage ne borne que par
    // horodatage : il n'a aucun droit de tourner ailleurs qu'en bac a sable.
    const bac = mkdtempSync(join(tmpdir(), 'autowin-nettoyage-bac-'))
    const cree = mkdtempSync(join(bac, 'ledger-refus-'))
    const nom = cree.slice(bac.length + 1)

    const resultat = nettoyerDossiersTemporairesDeTest(bac, Date.now() - 60_000)

    expect(resultat.supprimes).toContain(nom)
    expect(existsSync(cree)).toBe(false)
  })

  it('epargne un dossier au prefixe derive mais anterieur au run', () => {
    const bac = mkdtempSync(join(tmpdir(), 'autowin-nettoyage-bac-'))
    const cree = mkdtempSync(join(bac, 'ledger-refus-'))
    const nom = cree.slice(bac.length + 1)

    const resultat = nettoyerDossiersTemporairesDeTest(bac, Date.now() + 60_000)

    expect(resultat.supprimes).not.toContain(nom)
    expect(existsSync(cree)).toBe(true)
  })
})
