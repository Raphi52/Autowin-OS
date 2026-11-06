import { spawnSync } from 'node:child_process'

/**
 * EXTINCTION DES ARBRES DE VERIFICATION.
 *
 * DEFAUT MESURE le 2026-08-26 : trois chaines `npm -> cmd -> node` tournaient depuis la veille,
 * ~267 Mo, alors qu'Autowin n'etait meme pas lance. Elles venaient d'une verification dont le
 * process parent s'est termine AVANT que l'horloge du plafond ne tire : `spawnVerify` ne tue
 * l'arbre que sur ce seul chemin, et Node ne tue jamais ses enfants en sortant. Sonde du meme
 * jour, terrain propre : sortie GRACIEUSE du parent -> 1 orphelin ; sortie FORCEE -> 1 orphelin.
 *
 * CE QUE CECI NE COUVRE PAS, et il faut le savoir en le lisant : une `TerminateProcess` brutale
 * (Task Manager, `Stop-Process -Force`, coupure de courant) n'execute AUCUN code utilisateur —
 * ni `exit`, ni `SIGINT`, ni `SIGTERM`. Le seul mecanisme Windows qui survivrait a cela est un
 * Job Object `KILL_ON_JOB_CLOSE`, qui demande un addon natif. Ce module traite le cas courant
 * (fermeture normale de l'app, Ctrl-C), pas le cas brutal : c'est une reduction de la fuite,
 * jamais une garantie d'absence d'orphelin.
 */

/** Tue un arbre de process, de maniere SYNCHRONE — un `spawn` asynchrone meurt avec le parent. */
export function tuerArbre(pid: number, executer: typeof spawnSync = spawnSync): void {
  try {
    if (process.platform === 'win32') {
      executer('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch {
    // Un process deja mort n'est pas une erreur : c'est le resultat recherche.
  }
}

/** Les arbres de verification encore vivants, a eteindre si ce process s'arrete avant eux. */
const vivants = new Set<number>()

/** Pour les tests : l'etat observable du registre, sans exposer le Set lui-meme. */
export function arbresSuivis(): number[] {
  return [...vivants]
}

/**
 * Eteint tout ce qui est encore suivi. Appele par les gardes de sortie, et directement par les
 * tests — c'est la seule facon d'observer le comportement sans terminer le process de test.
 */
export function eteindreTout(executer: typeof spawnSync = spawnSync): void {
  for (const pid of [...vivants]) {
    vivants.delete(pid)
    tuerArbre(pid, executer)
  }
}

let gardesPosees = false

/**
 * Pose les gardes de sortie UNE fois. `exit` n'autorise que du synchrone — d'ou `spawnSync`.
 * Sur signal on eteint puis on laisse la sortie suivre son cours, sinon on transformerait un
 * Ctrl-C en process increvable.
 */
function poserLesGardes(): void {
  if (gardesPosees) return
  gardesPosees = true
  process.on('exit', () => eteindreTout())
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      eteindreTout()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }
}

/**
 * Suit un arbre le temps de sa verification. Rend la fonction qui l'OUBLIE : elle doit etre
 * appelee des que l'arbre s'est termine de lui-meme, sinon le registre garderait des pid morts —
 * et un pid recycle par Windows serait tue a la place d'un innocent.
 */
export function suivreArbre(pid: number | undefined): () => void {
  if (pid === undefined) return () => undefined
  poserLesGardes()
  vivants.add(pid)
  return () => {
    vivants.delete(pid)
  }
}
