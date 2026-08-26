import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ce que ce test attrape et qu'un test de RÉSULTAT ne peut PAS attraper.
 *
 * `reuseOrCreateConvRun` rendait déjà le bon workflow avant ce correctif : il lisait les `RUN.md`
 * de la conversation un par un jusqu'à trouver un run ouvert apparié. Quand aucun n'apparie — le
 * cas ORDINAIRE d'une nouvelle tâche — il les lisait donc TOUS. La sortie était juste, le COÛT ne
 * l'était pas : 10 037 workspaces mesurés sous `conv-1` le 2026-08-26, soit 8,0 s à froid et 1,2 s
 * à chaud pour UN appel, et deux appels par envoi. Le défaut n'est observable que sur le NOMBRE DE
 * LECTURES.
 *
 * `listConvRuns` avait reçu sa borne le 2026-08-18 ; cette fonction-ci, dans le même fichier, avait
 * été oubliée. C'est le comptage qui le prouve, pas le rendu.
 */
const lectures = vi.hoisted(() => ({ readFile: 0 }))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    default: actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      lectures.readFile += 1
      return actual.readFile(...args)
    }
  }
})

const { CONV_RUN_REUSE_READ_LIMIT, closeConvRun, createConvRun, reuseOrCreateConvRun } =
  await import('./conv-runs')

let root: string

/** N workspaces OUVERTS de tâches TOUTES DIFFÉRENTES dans une conversation. */
function tachesVariees(convId: string, combien: number): void {
  for (let i = 0; i < combien; i++) {
    createConvRun(convId, `tache numero ${i}`, root, () => 1_000 + i)
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'autowin-reuse-borne-'))
  lectures.readFile = 0
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('reuseOrCreateConvRun — la recherche de workflow réutilisable est BORNÉE', () => {
  it('ne lit pas les RUN.md des tâches SANS RAPPORT de la conversation', async () => {
    tachesVariees('conv-large', 300)

    const { reused } = await reuseOrCreateConvRun('conv-large', 'une toute autre tache', root, () => 9_000)

    expect(reused).toBe(false)
    // AVANT le correctif : 300 lectures (tout le dossier de la conversation). APRÈS : 0, aucun
    // dossier ne porte le slug de la tâche demandée, donc aucun fichier n'est candidat.
    expect(lectures.readFile).toBe(0)
  })

  it('borne les lectures quand la MÊME tâche a été relancée un très grand nombre de fois', async () => {
    /*
     * TOUS les runs sont FERMÉS. C'est ce qui donne son sens à l'assertion : sur des runs ouverts,
     * la recherche s'arrête au premier fichier apparié et lirait 1 fichier même sans borne — le
     * test passerait sans rien mesurer. Fermés, aucun n'est réutilisable, donc la recherche va
     * aussi loin que sa borne le lui permet : sans borne elle lit les 240, avec borne exactement
     * 200. (Vérifié par sabotage : en retirant `.slice(…)`, cette assertion vire au rouge.)
     */
    const total = CONV_RUN_REUSE_READ_LIMIT + 40
    for (let i = 0; i < total; i++) {
      const chemin = createConvRun('conv-repet', 'refaire le meme travail', root, () => 2_000 + i)
      closeConvRun(chemin, 'green', 'clos pour le test')
    }
    lectures.readFile = 0

    const { reused } = await reuseOrCreateConvRun('conv-repet', 'refaire le meme travail', root, () => 9_000)

    expect(reused).toBe(false)
    expect(lectures.readFile).toBe(CONV_RUN_REUSE_READ_LIMIT)
    expect(lectures.readFile).toBeLessThan(total)
  })

  it('retrouve encore un run ouvert ANCIEN mais apparié, noyé parmi des tâches sans rapport', async () => {
    const ancien = createConvRun('conv-melange', 'continuer le meme workflow', root, () => 100)
    tachesVariees('conv-melange', 300)

    const trouve = await reuseOrCreateConvRun('conv-melange', 'Continuer le même workflow !', root, () => 9_000)

    // La borne remplace un coût, elle ne doit PAS remplacer une réutilisation par un doublon.
    expect(trouve).toEqual({ path: ancien, reused: true })
  })

  it('journalise la troncature au lieu de la taire', async () => {
    for (let i = 0; i < CONV_RUN_REUSE_READ_LIMIT + 7; i++) {
      createConvRun('conv-tronque', 'refaire le meme travail', root, () => 3_000 + i)
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await reuseOrCreateConvRun('conv-tronque', 'refaire le meme travail', root, () => 9_000)

    expect(warn).toHaveBeenCalledWith(
      '[conv-runs]',
      'conv-tronque',
      expect.stringContaining('7 plus anciens non lus')
    )
    warn.mockRestore()
  })
})
