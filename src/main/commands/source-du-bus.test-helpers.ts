import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Texte complet du bus de commandes, pour les tests qui vérifient un câblage en lisant la source :
 * `commands.ts` puis ses modules `commands/*.ts`, en LF. Le bus a été découpé en modules voisins
 * (conv-1508, lot 2) ; ces tests cherchent le même texte qu'avant, où qu'il vive désormais.
 */
export function sourceDuBus(): string {
  const dossier = join(__dirname, '..')
  const modules = readdirSync(join(dossier, 'commands'))
    .filter((nom) => nom.endsWith('.ts') && !nom.includes('.test') && nom !== 'commands.ts')
    .sort()
    .map((nom) => readFileSync(join(dossier, 'commands', nom), 'utf8'))
  return [readFileSync(join(dossier, 'commands/commands.ts'), 'utf8'), ...modules].join('\n').replace(/\r\n/g, '\n')
}
