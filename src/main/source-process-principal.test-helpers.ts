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
 * DEUXIÈME MESURE, le même jour, run de 15 min sur `src/main` : 8 contrats sont tombés en rouge
 * alors qu'aucun n'était cassé — un refactor tournait EN PARALLÈLE et réécrivait `index.ts`
 * pendant la suite (dernière écriture à 17:02, fin du run à 17:04, deux commits dans l'intervalle).
 * Les contrats relisaient le disque à CHAQUE appel : deux assertions du même fichier pouvaient donc
 * juger deux versions différentes du code, et une lecture tombée au milieu d'un déménagement rend
 * une source amputée. Rejoués sur l'état stabilisé : tous verts.
 *
 * D'où l'INSTANTANÉ : la découverte des fichiers ET leur contenu sont lus UNE SEULE FOIS par
 * process de test, au premier appel, puis figés. Toute la suite juge alors la MÊME version du code,
 * quoi qu'il arrive au disque ensuite. Un nouveau process (le run suivant) relit, évidemment — le
 * gel ne dure QUE le temps d'une exécution, il ne masque aucune modification réelle.
 *
 * Ce que ça NE fait PAS : prouver qu'un câblage est juste. Une garde par lecture de source est
 * grossière, et c'est assumé : elle prouve seulement qu'il n'est pas ABSENT.
 */
const RACINE_MAIN = join(process.cwd(), 'src/main')

/** Un lecteur de sources dont l'instantané est pris au premier appel, puis figé. */
export interface LecteurSource {
  fichiersDuTourDeChat(): string[]
  modulesExtraitsDuDemarrage(): string[]
  sourceProcessPrincipal(): string
  zoneDuTourDeChat(): string
}

/**
 * Fabrique un lecteur sur une racine `src/main` donnée.
 *
 * Exportée pour que l'insensibilité à une réécriture concurrente soit PROUVABLE sur une
 * arborescence jetable, sans toucher au dépôt.
 */
export function creerLecteurSource(racine: string = RACINE_MAIN): LecteurSource {
  const contenus = new Map<string, string>()
  const listes = new Map<string, string[]>()

  /** Lit un fichier une seule fois ; les appels suivants rendent l'instantané. */
  const lire = (chemin: string): string => {
    const connu = contenus.get(chemin)
    if (connu !== undefined) return connu
    const texte = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')
    contenus.set(chemin, texte)
    return texte
  }

  /** Liste un dossier une seule fois — l'apparition d'un fichier en cours de run ne compte pas. */
  const lister = (dossier: string, garde: (fichier: string) => boolean): string[] => {
    const connu = listes.get(dossier)
    if (connu !== undefined) return connu
    const fichiers = existsSync(dossier)
      ? readdirSync(dossier)
          .filter(garde)
          .sort()
          .map((nom) => join(dossier, nom))
      : []
    listes.set(dossier, fichiers)
    return fichiers
  }

  const existeFige = (chemin: string): boolean => {
    if (contenus.has(chemin)) return true
    if (!existsSync(chemin)) return false
    lire(chemin)
    return true
  }

  const fichiersDuTourDeChat = (): string[] =>
    lister(join(racine, 'chat'), (nom) => nom.endsWith('.ts') && !nom.endsWith('.test.ts'))

  const modulesExtraitsDuDemarrage = (): string[] => {
    const nommes = ['window.ts', 'ipc-senders.ts']
      .map((nom) => join(racine, nom))
      .filter((chemin) => existeFige(chemin))
    const dossierIpc = lister(
      join(racine, 'ipc'),
      (fichier) => fichier.endsWith('.ts') && !/\.test[.-]/.test(fichier)
    )
    return [...nommes, ...dossierIpc]
  }

  const sourceProcessPrincipal = (): string =>
    [join(racine, 'index.ts'), ...modulesExtraitsDuDemarrage(), ...fichiersDuTourDeChat()]
      .map((fichier) => lire(fichier))
      .join('\n')

  const zoneDuTourDeChat = (): string => {
    const extrait = join(racine, 'chat', 'run-pilot-chat.ts')
    if (existeFige(extrait)) return lire(extrait)
    const index = lire(join(racine, 'index.ts'))
    const debut = index.indexOf('const runPilotChat')
    const fin = index.indexOf("ipcMain.handle('os:pilotChat'")
    return debut < 0 ? index : index.slice(debut, fin < 0 ? undefined : fin)
  }

  return {
    fichiersDuTourDeChat,
    modulesExtraitsDuDemarrage,
    sourceProcessPrincipal,
    zoneDuTourDeChat
  }
}

/** Le lecteur du dépôt : un seul instantané, partagé par tous les contrats du process de test. */
const DEPOT = creerLecteurSource()

/** Les modules extraits d'`index.ts` vers `src/main/chat/` — vide si le dossier n'existe pas. */
export function fichiersDuTourDeChat(): string[] {
  return DEPOT.fichiersDuTourDeChat()
}

/**
 * Les modules SORTIS d'`index.ts` qui restent du câblage de démarrage — vides s'ils n'existent pas.
 *
 * Le fenêtrage (`window.ts`) et les gardes d'expéditeur IPC (`ipc-senders.ts`) ont quitté
 * `index.ts` le 2026-09-02. Même leçon que pour le tour de chat : un contrat qui lit « le process
 * principal » doit suivre le déménagement, sinon il rougit sans qu'aucun câblage n'ait changé.
 */
export function modulesExtraitsDuDemarrage(): string[] {
  return DEPOT.modulesExtraitsDuDemarrage()
}

/** `index.ts` ET les modules qui en ont été extraits, bout à bout, fins de ligne normalisées. */
export function sourceProcessPrincipal(): string {
  return DEPOT.sourceProcessPrincipal()
}

/**
 * La ZONE du tour de chat, bornée.
 *
 * Le module extrait quand il existe ; sinon la tranche d'`index.ts` entre la déclaration du runner
 * et le canal IPC qui l'expose — les deux bornes historiques de ce code.
 */
export function zoneDuTourDeChat(): string {
  return DEPOT.zoneDuTourDeChat()
}
