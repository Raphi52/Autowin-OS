import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * LIRE LE CODE DU PROCESS PRINCIPAL LÀ OÙ IL VIT — pas à un chemin de fichier figé.
 *
 * Plusieurs contrats de ce dépôt vérifient un CÂBLAGE en lisant le texte source : le budget du tour
 * de chat, les canaux IPC, le cap d'itérations, l'inventaire d'observabilité. Tous lisaient
 * `src/main/index.ts` en dur.
 *
 * MESURE DU 2026-09-02 : l'extraction du tour pilote vers `src/main/chat/run-pilot-chat.ts`
 * (~1300 lignes déplacées) a fait rougir 10 contrôles dans 4 fichiers alors qu'AUCUN câblage
 * n'avait changé — les tests cherchaient au mauvais endroit. Un déplacement de code n'est pas une
 * régression, et la leçon avait déjà été payée le même jour sur `auto-kaizen-index-contract`
 * (commit ead623a4) : la corriger fichier par fichier la fait revenir au déménagement suivant.
 *
 * Ces lecteurs portent donc sur une ZONE — « le process principal », « le tour de chat » — et non
 * sur un chemin. Ils restent verts que le dossier `src/main/chat/` existe ou non.
 *
 * Ce que ça NE fait PAS : prouver qu'un câblage est juste. Une garde par lecture de source est
 * grossière, et c'est assumé : elle prouve seulement qu'il n'est pas ABSENT.
 */
const RACINE_MAIN = join(process.cwd(), 'src/main')

/** Les modules extraits d'`index.ts` vers `src/main/chat/` — vide si le dossier n'existe pas. */
export function fichiersDuTourDeChat(): string[] {
  const dossier = join(RACINE_MAIN, 'chat')
  if (!existsSync(dossier)) return []
  return readdirSync(dossier)
    .filter((nom) => nom.endsWith('.ts') && !nom.endsWith('.test.ts'))
    .sort()
    .map((nom) => join(dossier, nom))
}

/** `index.ts` ET les modules du tour de chat, bout à bout, fins de ligne normalisées. */
export function sourceProcessPrincipal(): string {
  return [join(RACINE_MAIN, 'index.ts'), ...fichiersDuTourDeChat()]
    .map((fichier) => readFileSync(fichier, 'utf8'))
    .join('\n')
    .replace(/\r\n/g, '\n')
}

/**
 * La ZONE du tour de chat, bornée.
 *
 * Le module extrait quand il existe ; sinon la tranche d'`index.ts` entre la déclaration du runner
 * et le canal IPC qui l'expose — les deux bornes historiques de ce code.
 */
export function zoneDuTourDeChat(): string {
  const extrait = join(RACINE_MAIN, 'chat', 'run-pilot-chat.ts')
  if (existsSync(extrait)) return readFileSync(extrait, 'utf8').replace(/\r\n/g, '\n')
  const index = readFileSync(join(RACINE_MAIN, 'index.ts'), 'utf8').replace(/\r\n/g, '\n')
  const debut = index.indexOf('const runPilotChat')
  const fin = index.indexOf("ipcMain.handle('os:pilotChat'")
  return debut < 0 ? index : index.slice(debut, fin < 0 ? undefined : fin)
}
