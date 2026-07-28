import { defineConfig } from 'vitest/config'

/**
 * Budget temps de la suite — volontairement le SEUL réglage ici (rien d'autre n'est configuré, pour
 * ne pas changer silencieusement la résolution des tests).
 *
 * Pourquoi : la suite compte ~240 fichiers joués en parallèle (~150 s de temps de test cumulé). Sous
 * cette charge, un worker peut voir son event loop affamé bien au-delà du défaut vitest de 5 s — pour
 * du travail qui prend 50 ms à vide. Symptôme observé : un test rouge DIFFÉRENT à chaque passe, vert
 * en isolation. Ce n'était pas un code fragile, c'était une horloge trop serrée.
 *
 * 20 s laisse passer la contention sans jamais masquer un vrai blocage (un test réellement pendu
 * échoue toujours, 15 s plus tard). Les rares fichiers à I/O lourde (vrais dépôts git, copie d'un
 * exécutable de ~100 Mo) relèvent encore ce budget chez eux via `vi.setConfig`.
 */
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
})
