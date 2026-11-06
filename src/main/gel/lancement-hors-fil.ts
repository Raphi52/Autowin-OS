import { Worker } from 'node:worker_threads'

/**
 * LANCER UN PROCESSUS DÉTACHÉ SANS TENIR LE FIL PRINCIPAL (conv-1368, 2026-10-31).
 *
 * `child_process.spawn` n'est asynchrone que pour la suite : la création du processus, elle, bloque
 * le fil qui l'appelle. Mesuré sur 7 jours (`gels.jsonl`) : `spawn cmd.exe start` du brain_server a
 * figé la fenêtre 18,5 s en 4 appels, dont 7,7 s d'un seul coup. Le SSD n'y est pour rien (420 ms au
 * pire sur 675 relevés Windows) : la création attendait au-dessus du disque.
 *
 * Un fil dédié porte donc ce blocage, comme le témoin de `gel-main.ts`. Le code tient dans une chaîne
 * pour la même raison : aucun fichier de plus à construire ni à empaqueter.
 */
const CODE_DU_FIL = `const { spawn } = require('node:child_process')
const { parentPort, workerData } = require('node:worker_threads')
const { bin, args, options } = workerData
try {
  const enfant = spawn(bin, args, options)
  enfant.once('error', (erreur) => parentPort.postMessage({ erreur: erreur.message }))
  enfant.once('spawn', () => {
    enfant.unref()
    parentPort.postMessage({})
  })
} catch (erreur) {
  parentPort.postMessage({ erreur: erreur.message })
}`

export interface OptionsDeLancementDetache {
  cwd?: string
  env: NodeJS.ProcessEnv
  detached: true
  stdio: 'ignore'
  windowsHide: true
}

/** Rend la main quand le processus existe, et lève si sa création a échoué. */
export function lancerDetacheHorsFil(
  bin: string,
  args: readonly string[],
  options: OptionsDeLancementDetache
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fil = new Worker(CODE_DU_FIL, {
      eval: true,
      workerData: { bin, args: [...args], options: { ...options, env: { ...options.env } } }
    })
    // Une relance en attente ne doit jamais retenir l'application ouverte.
    fil.unref()
    fil.once('message', (reponse: { erreur?: string }) => {
      if (reponse.erreur) reject(new Error(reponse.erreur))
      else resolve()
    })
    fil.once('error', reject)
    fil.once('exit', () => reject(new Error(`fil de lancement arrêté avant ${bin}`)))
  })
}
