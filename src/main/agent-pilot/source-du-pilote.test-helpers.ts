import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Texte complet du pilote de chat, pour les tests qui vérifient un câblage en lisant la source :
 * `agent-pilot.ts` puis ses modules `agent-pilot/*.ts`, en LF. Le pilote a été découpé en modules
 * voisins (conv-1580, lot 1) ; ces tests cherchent le même texte qu'avant, où qu'il vive désormais.
 */
export function sourceDuPilote(): string {
  const dossier = join(__dirname, '..')
  const modules = readdirSync(join(dossier, 'agent-pilot'))
    .filter((nom) => nom.endsWith('.ts') && !nom.includes('.test') && nom !== 'agent-pilot.ts')
    .sort()
    .map((nom) => readFileSync(join(dossier, 'agent-pilot', nom), 'utf8'))
  return [readFileSync(join(dossier, 'agent-pilot/agent-pilot.ts'), 'utf8'), ...modules]
    .join('\n')
    .replace(/\r\n/g, '\n')
}
