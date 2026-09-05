import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * LE SONDAGE D'EMPREINTE NE DOIT PLUS TENIR LE FIL PRINCIPAL.
 *
 * Mesures cumulees (.autowin-data/autowin-os/gels.jsonl) : 87,5 s le 2026-09-02 puis 240 s le
 * 2026-09-04 de boucle main tenue par `execFileSync('powershell.exe')` dans le sondage d'empreinte
 * de `worktree-manager` — pointe 17,4 s. La memoire courte a supprime les REPETITIONS ; le
 * lancement lui-meme reste synchrone et bloquant des que la memoire est froide.
 *
 * Contrat verrouille ici : sur le FIL PRINCIPAL, avec la sonde REELLE (aucune sonde injectee),
 * le prechargement ne lance AUCUN processus externe synchrone. Il passe par la variante
 * asynchrone, qui remplit la meme memoire courte sans rendre la main plus tard.
 *
 * Entree qui ferait echouer ce test si la correction etait fausse : une memoire FROIDE sur un PID
 * VIVANT (`process.pid`) — exactement l'etat du premier recensement au demarrage, celui qui a
 * produit les gels. Un correctif qui se contenterait de differer l'appel (setTimeout) tout en
 * gardant `execFileSync` serait pris par l'assertion « execFileSync jamais appele ».
 */
const appelsSync: string[] = []
const appelsAsync: string[] = []

vi.mock('node:child_process', async (original) => {
  const vrai = await original<typeof import('node:child_process')>()
  return {
    ...vrai,
    execFileSync: (fichier: string) => {
      appelsSync.push(fichier)
      return ''
    },
    execFile: (fichier: string, ...reste: unknown[]) => {
      appelsAsync.push(fichier)
      const rappel = reste.find((a) => typeof a === 'function') as
        | ((e: Error | null, o: string, r: string) => void)
        | undefined
      queueMicrotask(() => rappel?.(null, '', ''))
      return undefined as never
    }
  }
})

const { prechargerEmpreintesProcessus, empreinteConnue, oublierEmpreintesProcessus } =
  await import('./worktree-manager')

describe('sondage d’empreinte — hors du fil principal', () => {
  beforeEach(() => {
    oublierEmpreintesProcessus()
    appelsSync.length = 0
    appelsAsync.length = 0
  })

  it('memoire FROIDE sur le fil principal : aucun processus externe SYNCHRONE', () => {
    prechargerEmpreintesProcessus([process.pid])
    expect(appelsSync).toEqual([])
  })

  it('le sondage a bien lieu, mais par la voie asynchrone', async () => {
    prechargerEmpreintesProcessus([process.pid])
    await new Promise((r) => setTimeout(r, 10))
    expect(appelsAsync.length).toBeGreaterThan(0)
    expect(appelsSync).toEqual([])
  })

  it('le recensement lit l’empreinte sans bloquer : rien de connu, aucun appel synchrone', () => {
    expect(empreinteConnue(process.pid)).toBeNull()
    expect(appelsSync).toEqual([])
  })

  it('une sonde INJECTEE par un test reste synchrone — le seam de test n’est pas casse', () => {
    const vus: number[][] = []
    prechargerEmpreintesProcessus([process.pid], (pids) => {
      vus.push(pids)
      return new Map(pids.map((p) => [p, 'empreinte']))
    })
    expect(vus).toEqual([[process.pid]])
  })
})
