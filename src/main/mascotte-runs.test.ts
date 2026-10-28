import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { creerCompteDesRuns } from './mascotte-runs'

/**
 * Le compte des runs de la mascotte (conv-1196, ligne 1 du scout). Entrée qui doit faire échouer ce
 * fichier : la bille qui reprend son nombre de l'interface (`os:presence`) au lieu des événements
 * du moteur — fenêtre fermée, le nombre se figeait.
 */
describe('compte des runs de la mascotte, tenu par le moteur (conv-1196)', () => {
  it('fenêtre fermée pendant un run : la seule fin du run ramène le compte à zéro', () => {
    const compte = creerCompteDesRuns()
    compte.evenement({ type: 'orchestrate-start', convId: 'conv-1', runPath: 'run-a' })
    expect(compte.nombre()).toBe(1)
    // Aucune interface pour renvoyer un nombre : seuls les événements du moteur arrivent.
    compte.evenement({ type: 'orchestrate-phase', convId: 'conv-1', runPath: 'run-a' })
    compte.evenement({ type: 'orchestrate-end', convId: 'conv-1', runPath: 'run-a' })
    expect(compte.nombre()).toBe(0)
  })

  it('un run par fil : deux fils comptent deux, un nouveau départ dans le même fil remplace', () => {
    const compte = creerCompteDesRuns()
    compte.evenement({ type: 'orchestrate-start', convId: 'conv-1', runPath: 'run-a' })
    compte.evenement({ type: 'orchestrate-start', convId: 'conv-2', runPath: 'run-b' })
    expect(compte.nombre()).toBe(2)
    compte.evenement({ type: 'orchestrate-start', convId: 'conv-1', runPath: 'run-c' })
    expect(compte.nombre()).toBe(2)
    compte.evenement({ type: 'orchestrate-end', convId: 'conv-2', runPath: 'run-b' })
    expect(compte.nombre()).toBe(1)
  })

  it('une fin qui nomme un AUTRE run du fil ne ferme rien ; une fin sans chemin ferme', () => {
    const compte = creerCompteDesRuns()
    compte.evenement({ type: 'orchestrate-start', convId: 'conv-1', runPath: 'run-c' })
    compte.evenement({ type: 'orchestrate-end', convId: 'conv-1', runPath: 'run-a' })
    expect(compte.nombre()).toBe(1)
    compte.evenement({ type: 'orchestrate-end', convId: 'conv-1' })
    expect(compte.nombre()).toBe(0)
  })

  it('jamais négatif : fin inconnue, événement sans fil ou d’un autre type ignorés', () => {
    const compte = creerCompteDesRuns()
    compte.evenement({ type: 'orchestrate-end', convId: 'conv-9', runPath: 'run-z' })
    compte.evenement({ type: 'orchestrate-start', runPath: 'run-sans-fil' })
    compte.evenement({ type: 'refresh', convId: 'conv-1' })
    expect(compte.nombre()).toBe(0)
  })
})

/** Câblage : `broadcast` et le gestionnaire `os:presence` sont des fonctions internes de index.ts. */
describe('câblage dans index.ts', () => {
  const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const corps = (debut: string, fin: string): string => {
    const i = source.indexOf(debut)
    expect(i).toBeGreaterThanOrEqual(0)
    return source.slice(i, source.indexOf(fin, i))
  }

  it('broadcast, passage unique des départs et fins de run, nourrit la mascotte', () => {
    expect(corps('function broadcast(e: AppEvent): void {', '\n}\n')).toContain(
      'mascotteDuBureau.evenementDeRun(e)'
    )
  })

  it('la mascotte ne prend plus son nombre de runs de l’interface (os:presence)', () => {
    expect(corps("ipcMain.handle('os:presence'", '\n  })\n')).not.toContain('mascotteDuBureau')
  })
})
