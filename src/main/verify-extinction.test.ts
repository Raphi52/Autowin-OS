import { describe, expect, it } from 'vitest'
import { arbresSuivis, eteindreTout, suivreArbre, tuerArbre } from './verify-extinction'

/**
 * DEFAUT MESURE le 2026-08-26 : une verification dont le process parent s'arrete avant le plafond
 * laisse son arbre `npm -> cmd -> node` vivant. Sonde du jour, terrain propre (baseline 0) :
 * sortie GRACIEUSE -> 1 orphelin, sortie FORCEE -> 1 orphelin.
 *
 * ENTREES QUI DOIVENT FAIRE ECHOUER CES TESTS SI LA CORRECTION EST FAUSSE :
 *  - un arbre suivi que l'extinction n'irait pas tuer (la fuite reste) ;
 *  - un arbre OUBLIE — donc termine de lui-meme — que l'extinction tuerait quand meme : Windows
 *    recycle les pid, on tuerait un process innocent. Les deux sens comptent.
 */
const tueur = (): { appels: number[]; executer: never } => {
  const appels: number[] = []
  const executer = ((_fichier: string, args: readonly string[]) => {
    const i = args.indexOf('/PID')
    appels.push(Number(i >= 0 ? args[i + 1] : args[0]))
    return { status: 0 }
  }) as never
  return { appels, executer }
}

describe('extinction des arbres de vérification', () => {
  it('éteint ce qui est encore suivi', () => {
    eteindreTout(tueur().executer) // registre remis a zero, quel que soit l'ordre des tests
    suivreArbre(4242)
    suivreArbre(4243)
    expect(arbresSuivis()).toEqual([4242, 4243])

    const { appels, executer } = tueur()
    eteindreTout(executer)

    expect(appels.sort()).toEqual([4242, 4243])
    // Le registre est VIDE apres extinction : sinon la garde de sortie retuerait des pid recyclés.
    expect(arbresSuivis()).toEqual([])
  })

  it('n’éteint plus un arbre oublié — un pid recyclé tuerait un innocent', () => {
    eteindreTout(tueur().executer)
    const oublier = suivreArbre(5150)
    oublier()
    expect(arbresSuivis()).toEqual([])

    const { appels, executer } = tueur()
    eteindreTout(executer)

    expect(appels).toEqual([])
  })

  it('un pid absent ne fabrique pas de suivi fantôme', () => {
    eteindreTout(tueur().executer)
    expect(suivreArbre(undefined)()).toBeUndefined()
    expect(arbresSuivis()).toEqual([])
  })

  it('la mort d’un process déjà mort n’est pas une erreur', () => {
    expect(() =>
      tuerArbre(999_999, (() => {
        throw new Error('process introuvable')
      }) as never)
    ).not.toThrow()
  })
})
