import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CostAggregator } from './cost'

/**
 * Le défaut corrigé, mesuré le 2026-09-12 sur le poste de dev : `CostAggregator.add` posait chaque
 * tour avec `appendFileSync`. Une de ces écritures a figé le processus principal **9 449 ms** —
 * donc l'interface entière, puisque c'est le même fil. 83 des 117 gels du jour sont de cette
 * famille (entrées-sorties synchrones sur le fil de rendu).
 *
 * Ce que ces tests verrouillent : `add` ne touche PLUS le disque pendant son exécution, et rien
 * n'est perdu pour autant.
 */
function chemin(): string {
  return join(mkdtempSync(join(tmpdir(), 'cost-async-')), 'cost.jsonl')
}

const tour = (costUsd: number) => ({
  provider: 'claude',
  inputTokens: 10,
  outputTokens: 5,
  costUsd
})

describe('CostAggregator — écriture non bloquante', () => {
  it('n’écrit RIEN sur le disque pendant `add` (c’est ça, le gel de 9,4 s)', () => {
    const path = chemin()
    const cost = new CostAggregator(undefined, path)

    cost.add(tour(0.1))

    // Le fichier n'existe pas encore : aucune entrée-sortie n'a eu lieu sur le fil appelant.
    expect(existsSync(path)).toBe(false)
    // Mais l'agrégation en mémoire, elle, est immédiate — l'appelant n'attend rien.
    expect(cost.totalUsd()).toBeCloseTo(0.1)
  })

  it('pose bien tout sur le disque une fois la vidange faite', async () => {
    const path = chemin()
    const cost = new CostAggregator(undefined, path)

    cost.add(tour(0.1))
    cost.add(tour(0.2))
    await cost.flushPersist()

    const lignes = readFileSync(path, 'utf8').trim().split('\n')
    expect(lignes).toHaveLength(2)
    expect(new CostAggregator(undefined, path).totalUsd()).toBeCloseTo(0.3)
  })

  it('groupe une rafale de tours au lieu d’une écriture par tour', async () => {
    const path = chemin()
    const cost = new CostAggregator(undefined, path)

    const debut = performance.now()
    for (let i = 0; i < 500; i += 1) cost.add(tour(0.001))
    const duree = performance.now() - debut

    // 500 appels sans aucune écriture : le budget est celui d'un `push`, pas d'un disque.
    expect(existsSync(path)).toBe(false)
    expect(duree).toBeLessThan(200)

    await cost.flushPersist()
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(500)
  })

  it('ne perd rien un tour ajouté PENDANT la vidange', async () => {
    const path = chemin()
    const cost = new CostAggregator(undefined, path)

    cost.add(tour(0.1))
    const enVol = cost.flushPersist()
    cost.add(tour(0.2)) // arrive alors que la première écriture est déjà partie
    await enVol
    await cost.flushPersist()

    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2)
  })

  it('solde ce qui reste à la fermeture, sans attendre la boucle', () => {
    const path = chemin()
    const cost = new CostAggregator(undefined, path)

    cost.add(tour(0.5))
    cost.flushPersistSync()

    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(1)
  })
})
