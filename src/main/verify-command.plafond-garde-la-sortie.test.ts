import { describe, expect, it } from 'vitest'
import { VERIFY_TIMEOUT_MS, verifyTimeoutOutcome } from './verify-command'

/**
 * LE PLAFOND NE DOIT PLUS RENDRE LA MAIN LES MAINS VIDES.
 *
 * DÉFAUT VÉCU le 2026-08-25 (conv-1400). Un tour a lancé `verify`, qui rejoue la suite entière.
 * Elle a tourné 600 s, a été coupée au plafond, et le résultat rendu était `exitCode: null` avec
 * pour toute sortie la phrase « vérification arrêtée après 600 s ». Pendant ces dix minutes vitest
 * avait écrit des centaines de lignes — fichiers traversés, tests verts, rouges éventuels — et
 * `verifyTimeoutOutcome` les REMPLAÇAIT intégralement par son message. L'utilisateur a donc attendu
 * dix minutes pour apprendre qu'il ne saurait rien, et n'avait aucun moyen de distinguer « la suite
 * est trop lente » de « la suite est bloquée sur un test qui ne rend jamais la main ».
 *
 * Ce que ces tests exigent : le verdict reste NÉGATIF — une suite interrompue n'a rien prouvé, et
 * `ok: false` / `exitCode: null` ne bougent pas — mais ce qu'elle avait déjà écrit REVIENT avec lui.
 * C'est la seule chose qui rende le plafond diagnosticable.
 */
describe('verifyTimeoutOutcome — le plafond rend ce qui a déjà été écrit', () => {
  it('conserve la sortie partielle collectée avant la coupure', () => {
    const partiel = ['✓ src/a.test.ts (12)', '✓ src/b.test.ts (8)', '❯ src/lent.test.ts'].join('\n')

    const res = verifyTimeoutOutcome('npm run test:unit', VERIFY_TIMEOUT_MS, partiel)

    expect(res.output).toContain('src/lent.test.ts')
    expect(res.output).toContain('src/a.test.ts')
    // Le plafond reste NOMMÉ : la sortie partielle ne doit pas faire oublier pourquoi ça s'arrête.
    expect(res.output).toContain('600 s')
  })

  it('le verdict reste négatif : une suite coupée n’a rien prouvé', () => {
    // Piège à éviter : une sortie partielle pleine de ✓ ne doit JAMAIS se lire comme un vert.
    const res = verifyTimeoutOutcome('npm run test:unit', VERIFY_TIMEOUT_MS, '✓ tout va bien (900)')

    expect(res.ok).toBe(false)
    expect(res.exitCode).toBeNull()
  })

  /*
   * L'ASSERTION D'ORIGINE COMPTAIT LES LIGNES — une approximation de l'intention, qui a cesse de
   * tenir le 2026-08-25 quand le message de plafond a gagne sa consigne de sortie de secours
   * (conv-1405 : « rien n'est prouve » sterile faisait relancer la meme commande). L'intention n'a
   * pas bouge d'un pouce : PAS de section « ce que la suite avait ecrit » quand il n'y a rien a y
   * mettre. On l'exige donc directement, au lieu de la deduire d'un nombre de lignes.
   */
  it('sans sortie partielle, aucune section « ce qui a été écrit » n’est fabriquée', () => {
    const res = verifyTimeoutOutcome('npm run test:unit', VERIFY_TIMEOUT_MS)

    expect(res.output).toContain('plafond')
    expect(res.output).not.toContain('avait écrit')
  })

  it('une sortie partielle vide ou blanche ne fabrique pas de section creuse', () => {
    const blanc = ['   ', '  ', ''].join(String.fromCharCode(10))
    const res = verifyTimeoutOutcome('npm run test:unit', VERIFY_TIMEOUT_MS, blanc)

    expect(res.output).not.toContain('avait écrit')
    // Et rien de plus que le message de plafond lui-meme : aucun blanc traine en queue.
    expect(res.output).toBe(verifyTimeoutOutcome('npm run test:unit', VERIFY_TIMEOUT_MS).output)
  })
})
