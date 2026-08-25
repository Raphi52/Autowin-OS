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

  it('sans sortie partielle, le message du plafond est rendu seul', () => {
    const res = verifyTimeoutOutcome('npm run test:unit', VERIFY_TIMEOUT_MS)

    expect(res.output).toContain('plafond')
    expect(res.output.trim().split('\n')).toHaveLength(1)
  })

  it('une sortie partielle vide ou blanche ne fabrique pas de section creuse', () => {
    const res = verifyTimeoutOutcome('npm run test:unit', VERIFY_TIMEOUT_MS, '   \n  \n')

    expect(res.output.trim().split('\n')).toHaveLength(1)
  })
})
