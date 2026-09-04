import { describe, expect, it } from 'vitest'
import { defaultProcessIdentity, oublierEmpreintesProcessus } from './worktree-manager'

/*
 * MESURE DU 2026-09-02 (.autowin-data/autowin-os/gels.jsonl) : `execFileSync powershell.exe` porte
 * 48 gels du journal, 87,5 s de fenetre morte cumulee, jusqu'a 3 s d'un coup — deuxieme poste apres
 * les gels non nommes. Le sondage d'empreinte d'un PID lance un PowerShell SYNCHRONE sur le thread
 * qui pompe les messages de la fenetre, et le recensement rappelle les MEMES PID en rafale (trois
 * appels entre 19:54:17 et 19:54:22 le 2026-09-01). L'empreinte d'un PID vivant ne change pas :
 * la resonder dans la seconde ne rapporte rien et coute une fenetre figee.
 */
describe('empreinte de processus — le sondage systeme est memoise', () => {
  it('ne relance pas le sondage pour le meme PID dans la fenetre courte', () => {
    let appels = 0
    const sonde = (): string => {
      appels += 1
      return 'empreinte-1'
    }
    let horloge = 1_000
    const maintenant = (): number => horloge

    expect(defaultProcessIdentity(process.pid, sonde, maintenant)).toBe('empreinte-1')
    horloge += 900
    expect(defaultProcessIdentity(process.pid, sonde, maintenant)).toBe('empreinte-1')
    horloge += 900
    expect(defaultProcessIdentity(process.pid, sonde, maintenant)).toBe('empreinte-1')

    expect(appels).toBe(1)
  })

  it('resonde le systeme une fois la memoire expiree', () => {
    let appels = 0
    const sonde = (): string => {
      appels += 1
      return `empreinte-${appels}`
    }
    let horloge = 500_000
    const maintenant = (): number => horloge

    expect(defaultProcessIdentity(process.pid, sonde, maintenant)).toBe('empreinte-1')
    horloge += 60_000
    expect(defaultProcessIdentity(process.pid, sonde, maintenant)).toBe('empreinte-2')
    expect(appels).toBe(2)
  })

  it('un PID absent rend undefined sans sonder le systeme', () => {
    let appels = 0
    const sonde = (): string => {
      appels += 1
      return 'jamais'
    }
    // PID hors de portee : `process.kill(pid, 0)` leve ESRCH, l'absence est PROUVEE.
    expect(defaultProcessIdentity(2_147_483_646, sonde, () => 1_000)).toBeUndefined()
    expect(appels).toBe(0)
  })
  /*
   * MESURE DU 2026-09-04 (.autowin-data/autowin-os/gels.jsonl) : la sonde PowerShell porte encore
   * 39,3 s de fil principal bloque sur les 174 s de gel du jour, dont des gels a EXACTEMENT 3013 ms
   * — la duree du `timeout` de la sonde. C'est donc le cas d'ECHEC qui coute : la memoire courte ne
   * retenait que les succes (`if (identity) set ... else delete`), si bien qu'un PID vivant dont
   * l'empreinte est illisible (droits, timeout) etait resonde a CHAQUE appel du recensement, en
   * rafale, au prix maximal. Un echec de lecture est un fait aussi stable qu'un succes dans une
   * fenetre de quelques secondes : il se memorise pareil.
   */
  it('ne relance pas le sondage apres un ECHEC dans la fenetre courte', () => {
    oublierEmpreintesProcessus()
    let appels = 0
    const sonde = (): string | null => {
      appels += 1
      return null
    }
    let horloge = 900_000
    const maintenant = (): number => horloge

    expect(defaultProcessIdentity(process.pid, sonde, maintenant)).toBeNull()
    horloge += 900
    expect(defaultProcessIdentity(process.pid, sonde, maintenant)).toBeNull()
    horloge += 900
    expect(defaultProcessIdentity(process.pid, sonde, maintenant)).toBeNull()

    expect(appels).toBe(1)
  })

  it('resonde apres un echec une fois la memoire expiree', () => {
    oublierEmpreintesProcessus()
    let appels = 0
    const sonde = (): string | null => {
      appels += 1
      return appels === 1 ? null : 'empreinte-revenue'
    }
    let horloge = 1_900_000
    const maintenant = (): number => horloge

    expect(defaultProcessIdentity(process.pid, sonde, maintenant)).toBeNull()
    horloge += 60_000
    expect(defaultProcessIdentity(process.pid, sonde, maintenant)).toBe('empreinte-revenue')
    expect(appels).toBe(2)
  })
})
