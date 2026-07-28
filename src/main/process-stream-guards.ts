interface ErrorEventSource {
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown
}

/**
 * Un launcher peut fermer ses pipes juste après avoir démarré Electron. Node
 * transforme alors le prochain console.error interne en exception EPIPE. Cette
 * garde absorbe uniquement ce cas terminal ; les autres erreurs restent
 * disponibles pour une voie de diagnostic qui n'écrit pas dans le pipe cassé.
 */
export function guardBrokenProcessPipes(
  stdout: ErrorEventSource,
  stderr: ErrorEventSource,
  report: (error: NodeJS.ErrnoException) => void = () => undefined
): void {
  const handle = (error: NodeJS.ErrnoException): void => {
    if (error.code !== 'EPIPE') report(error)
  }
  stdout.on('error', handle)
  stderr.on('error', handle)
}
