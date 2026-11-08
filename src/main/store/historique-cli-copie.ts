import type { Dirent } from 'node:fs'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { supprimerArbre } from '../fichiers/fs-supprimer'

/**
 * Suppression de l'HISTORIQUE CLI laissé derrière une copie de travail effacée.
 *
 * POURQUOI. Le CLI Claude écrit ses conversations dans `<config>/projects/<cwd encodé>/`, hors de
 * tout ce qu'Autowin gère. `cleanupWorktree` supprime la copie de travail ; cet historique, lui,
 * restait sur le disque. Mesuré le 2026-09-12 sur le poste de dev : 80 dossiers d'historique pour
 * 11 copies vivantes, 87 Mo de déchet pur accumulés en 11 jours, dont AUCUN ne pouvait plus être
 * relu par qui que ce soit — le dossier qu'ils décrivent n'existe plus.
 *
 * LE CLI EN EFFACE AUSSI, MAIS TARD (vérifié le 2026-11-05). Depuis la 2.1.317, il purge
 * les historiques anciens même quand des appels sautent ce ménage, « such as runs using
 * `--setting-sources` » — c'est ainsi qu'Autowin lance chaque appel. Le délai est `cleanupPeriodDays`,
 * 30 jours par défaut, et Autowin ne charge pas les réglages de l'utilisateur : c'est donc 30 jours.
 * Sources : https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md (2.1.317) et
 * https://code.claude.com/docs/en/data-usage (« for 30 days by default »). Ce module reste utile :
 * il libère la place le jour même au lieu d'un mois plus tard. Les deux lecteurs de ces historiques
 * vivent avec la purge : le repli local des quotas (`model-quotas.ts`) ne regarde que 5 h et 7 jours ;
 * la relecture du coût d'un appel tué (`activity/cli-usage-recovery.ts`) ne retrouve plus rien
 * au-delà de 30 jours, et l'appel redevient « non exposé ».
 *
 * L'ENCODAGE, vérifié sur le disque réel : le chemin absolu du répertoire courant, chaque caractère
 * non alphanumérique remplacé par un tiret. `D:\AutoWinOS` devient `D--AutoWinOS` (le deux-points
 * ET l'antislash donnent chacun un tiret).
 *
 * LE PIÈGE, et pourquoi `cheminsPreserves` existe : un run ne tourne pas seulement DANS la copie,
 * mais aussi dans ses sous-dossiers (`<copie>/agent__run-xxx/1`), qui produisent des dossiers
 * d'historique préfixés par celui de la copie. Il faut donc balayer le préfixe — et un balayage par
 * préfixe NU détruirait l'historique d'une copie voisine dont le nom commence pareil : effacer
 * `arena-a` emporterait `arena-a-r1`, observé côte à côte sur ce poste. Tout chemin encore présent
 * est donc passé en préservation et coupe le préfixe.
 *
 * Le PLAN est PUR (noms de dossiers -> noms à supprimer), comme `planWorkspaceGc` : la règle se
 * teste sans toucher au disque.
 */

/** Encodage du répertoire courant tel que le CLI nomme son dossier d'historique. */
export function encoderCheminCli(chemin: string): string {
  return chemin.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Décide quels dossiers d'historique appartiennent à la copie effacée. PUR.
 *
 * On prend le dossier de la copie ET ses descendants (préfixe + tiret), sauf ceux qu'un chemin
 * encore vivant revendique.
 */
export function planHistoriqueCliASupprimer(
  cheminCopie: string,
  dossiersHistorique: readonly string[],
  cheminsPreserves: readonly string[] = []
): string[] {
  const cible = encoderCheminCli(cheminCopie)
  if (cible.length === 0) return []
  const preserves = [...new Set(cheminsPreserves.map(encoderCheminCli))].filter(
    (nom) => nom !== cible
  )
  const revendiquePar = (nom: string, base: string): boolean =>
    nom === base || nom.startsWith(`${base}-`)
  return dossiersHistorique.filter(
    (nom) => revendiquePar(nom, cible) && !preserves.some((p) => revendiquePar(nom, p))
  )
}

/**
 * Racines `projects` à balayer pour une copie donnée.
 *
 * Deux sources, et aucune n'est devinée au hasard : l'identité Claude par défaut (`~/.claude`), et
 * les comptes dédiés qu'Autowin range dans `<userData>/claude-accounts/<compte>/`. La racine
 * `userData` se DÉDUIT du chemin de la copie — elles vivent sous `<userData>/worktrees/` —, ce qui
 * évite de coupler le gestionnaire de copies au module des comptes.
 */
export function racinesHistoriqueCliPour(cheminCopie: string): string[] {
  const racines = [join(homedir(), '.claude', 'projects')]
  const userData = racineDeDonnees(cheminCopie)
  const comptes = join(userData, 'claude-accounts')
  let noms: string[] = []
  try {
    noms = readdirSync(comptes)
  } catch {
    noms = []
  }
  for (const compte of noms) racines.push(join(comptes, compte, 'projects'))
  return racines
}

// fix-ok: cause mesurée — test rouge « trouve les comptes aussi quand la copie d’agent est sous un dossier de dépôt » (historique-cli-copie.test.ts) : 1 échec avant correctif ; l'ancienne remontée fixe à deux niveaux tombait dans `worktrees` et ne trouvait pas `claude-accounts`.
/**
 * Le dossier de données d'Autowin, déduit de la POSITION de la copie (un nom de dossier n'est pas un
 * contrat, sa place dans l'arborescence l'est). Une copie de fil vit sous `<données>/copies-de-fil/<fil>`,
 * une copie d'agent sous `<données>/worktrees/<dépôt>/<agent>` : deux niveaux, car chaque dépôt a son
 * dossier. On prend le premier de ces deux niveaux qui porte `claude-accounts`. Une remontée fixe à deux
 * niveaux ratait les comptes des copies d'agent (test rouge mesuré : 1 échec sur ce point).
 */
function racineDeDonnees(cheminCopie: string): string {
  const niveauCourt = dirname(dirname(cheminCopie))
  const niveauLong = dirname(niveauCourt)
  return (
    [niveauCourt, niveauLong].find((n) => existsSync(join(n, 'claude-accounts'))) ?? niveauCourt
  )
}

/**
 * Applique le plan au disque. Best-effort assumé, comme `collectRunWorkspaces` : l'échec d'une
 * suppression ne doit JAMAIS faire échouer la libération de la copie elle-même, qui a réussi.
 */
export function supprimerHistoriqueCli(
  cheminCopie: string,
  cheminsPreserves: readonly string[] = [],
  racines: readonly string[] = racinesHistoriqueCliPour(cheminCopie)
): string[] {
  const supprimes: string[] = []
  for (const racine of racines) {
    let noms: string[]
    try {
      noms = readdirSync(racine)
    } catch {
      continue // racine absente (compte jamais utilisé) : rien à faire
    }
    for (const nom of planHistoriqueCliASupprimer(cheminCopie, noms, cheminsPreserves)) {
      const cible = join(racine, nom)
      try {
        supprimerArbre(cible)
        supprimes.push(cible)
      } catch {
        /* verrouillé : la copie est partie quand même, on ne fait pas échouer pour ça */
      }
    }
  }
  return supprimes
}

/** Ce qu'il advient de la session d'un fil quand il change de dossier (voir `suivreSessionEntreDossiers`). */
export type SuiviDeSession = 'suivie' | 'absente' | 'echec'

/**
 * LA SESSION SUIT LE FIL ENTRE DEUX DOSSIERS, DANS LES DEUX SENS. Le CLI cherche une session sous le
 * dossier de SON cwd. Un fil qui passe dans sa copie, ou qui en revient quand le ménage l'a retirée,
 * change de cwd : sans recopie, la reprise ne trouve plus rien et l'agent relit tout le fil. On pose donc,
 * sous le dossier d'arrivée, la session du fil : son `.jsonl` et son dossier `<session>/` (sorties
 * d'outils trop longues).
 *
 * LA SOURCE FAIT FOI, ET ELLE ÉCRASE. La clé de session pointe encore sur l'ancien dossier : le
 * dernier tour réussi sous cette clé est donc celui de la source. Une copie déjà posée sous la copie
 * ne contient que des tours échoués (un passage réessayé), ou une version ancienne : la garder
 * ferait reprendre une session périmée. La source n'est jamais modifiée.
 *
 * Rend `absente` (rien à suivre : le CLI n'a pas écrit cette session sous l'ancien dossier, ou
 * l'identifiant est invalide), `suivie`, ou `echec` (la session n'est pas posée : le tour repart
 * sans reprise, comme avant ce mécanisme).
 */
export function suivreSessionEntreDossiers(entree: {
  configDir?: string
  depuis: string
  vers: string
  sessionId: string
}): SuiviDeSession {
  // Un identifiant de session est un UUID : rien d'autre ne doit composer un chemin.
  if (!/^[A-Za-z0-9-]+$/.test(entree.sessionId)) return 'absente'
  const projets = join(entree.configDir || join(homedir(), '.claude'), 'projects')
  const source = join(projets, encoderCheminCli(entree.depuis))
  const cible = join(projets, encoderCheminCli(entree.vers))
  const fichier = `${entree.sessionId}.jsonl`
  if (source === cible) return existsSync(join(cible, fichier)) ? 'suivie' : 'absente'
  if (!existsSync(join(source, fichier))) return 'absente'
  try {
    mkdirSync(cible, { recursive: true })
    if (existsSync(join(source, entree.sessionId))) {
      cpSync(join(source, entree.sessionId), join(cible, entree.sessionId), {
        recursive: true,
        force: true
      })
    }
    copyFileSync(join(source, fichier), join(cible, fichier))
    return 'suivie'
  } catch {
    return 'echec'
  }
}

/** Copies de travail encore présentes sous la même racine — elles revendiquent leur historique. */
export function copiesVivantes(cheminCopie: string): string[] {
  const parent = dirname(cheminCopie)
  try {
    return readdirSync(parent).map((nom) => join(parent, nom))
  } catch {
    return []
  }
}

/** Une session du CLI au premier niveau d'un dossier d'historique : son identifiant et sa dernière écriture. */
export interface SessionHistorique {
  id: string
  mtime: number
}

/** Un dossier d'historique du CLI, avec ses sessions. `illisible` : son contenu n'a pas pu être lu en entier. */
export interface DossierHistorique {
  racine: string
  nom: string
  sessions: SessionHistorique[]
  illisible?: boolean
}

export interface DecisionDeRangement {
  chemin: string
  racine: string
  nom: string
  decision: 'ranger' | 'garder'
  /** Pourquoi on garde : un rangement muet se lirait « tout est fait ». */
  raison?: string
}

const SUFFIXE_SESSION = '.jsonl'

/**
 * LES RESTES DÉJÀ SUR LE DISQUE. PUR.
 *
 * Un reste est un dossier d'historique qui sort d'un dossier de copies, sans qu'AUCUNE copie présente
 * ne le revendique : la copie a disparu, son historique non. Il ne part que si CHACUNE de ses sessions a
 * une version posée AILLEURS, dans un dossier qui n'est pas un reste, plus récente ou égale : une session
 * sans autre exemplaire serait perdue avec lui. Les restes ne se couvrent jamais entre eux.
 */
export function planifierRangementHistoriquesCli(entree: {
  dossiers: readonly DossierHistorique[]
  copiesExistantes: readonly string[]
  dossiersDeCopies: readonly string[]
}): DecisionDeRangement[] {
  const copies = entree.copiesExistantes.map(encoderCheminCli)
  const parents = entree.dossiersDeCopies.map(encoderCheminCli)
  const revendiqueParUneCopie = (nom: string): boolean =>
    copies.some((c) => nom === c || nom.startsWith(`${c}-`))
  const sortDUnDossierDeCopies = (nom: string): boolean =>
    parents.some((p) => nom.startsWith(`${p}-`))
  const restes = entree.dossiers.filter(
    (d) => sortDUnDossierDeCopies(d.nom) && !revendiqueParUneCopie(d.nom)
  )
  const restesSet = new Set(restes)
  const ailleurs = entree.dossiers.filter((d) => !restesSet.has(d))
  return restes.map((reste): DecisionDeRangement => {
    const base = { chemin: join(reste.racine, reste.nom), racine: reste.racine, nom: reste.nom }
    if (reste.illisible) {
      return {
        ...base,
        decision: 'garder',
        raison: 'contenu illisible : on ne sait pas ce qu’il porte'
      }
    }
    if (reste.sessions.length === 0) {
      return {
        ...base,
        decision: 'garder',
        raison: 'aucune session : rien ne prouve qu’il est superflu'
      }
    }
    const sansVersion = reste.sessions.find(
      (s) => !ailleurs.some((a) => a.sessions.some((x) => x.id === s.id && x.mtime >= s.mtime))
    )
    if (sansVersion) {
      return {
        ...base,
        decision: 'garder',
        raison: `la session ${sansVersion.id} n’a pas de version plus récente ou égale ailleurs`
      }
    }
    return { ...base, decision: 'ranger' }
  })
}

/** Ce qu'a donné le rangement : le compte avant et après, et ce qui a bougé ou été gardé. */
export interface BilanDuRangement {
  /** Dossiers d'historique présents avant le geste. */
  avant: number
  /** Restes repérés, rangés ou non (en mesure seule, rien n'est déplacé). */
  aRanger: string[]
  /** Restes effectivement déplacés dans la corbeille datée. */
  ranges: string[]
  gardes: Array<{ chemin: string; raison: string }>
  /** Dossiers d'historique présents après le geste. */
  apres: number
}

/** La corbeille datée d'une racine : à côté de son `projects`, dans le même dossier de configuration. */
function corbeilleDe(racine: string, jour: string): string {
  return join(dirname(racine), 'corbeille-historique-cli', jour)
}

function lireSessions(dossier: string): { sessions: SessionHistorique[]; illisible: boolean } {
  let entrees: Dirent[]
  try {
    entrees = readdirSync(dossier, { withFileTypes: true })
  } catch {
    return { sessions: [], illisible: true }
  }
  const sessions: SessionHistorique[] = []
  let illisible = false
  for (const entree of entrees) {
    if (!entree.isFile() || !entree.name.endsWith(SUFFIXE_SESSION)) continue
    try {
      sessions.push({
        id: entree.name.slice(0, -SUFFIXE_SESSION.length),
        mtime: statSync(join(dossier, entree.name)).mtimeMs
      })
    } catch {
      illisible = true
    }
  }
  return { sessions, illisible }
}

function lireDossiersHistorique(racines: readonly string[]): DossierHistorique[] {
  const dossiers: DossierHistorique[] = []
  for (const racine of racines) {
    let entrees: Dirent[]
    try {
      entrees = readdirSync(racine, { withFileTypes: true })
    } catch {
      continue // racine absente (compte jamais utilisé) : rien à ranger
    }
    for (const entree of entrees) {
      if (!entree.isDirectory()) continue
      const { sessions, illisible } = lireSessions(join(racine, entree.name))
      dossiers.push({ racine, nom: entree.name, sessions, illisible })
    }
  }
  return dossiers
}

/** Tout ce qui se trouve dans les dossiers de copies : ce sont les copies présentes, qui revendiquent leur historique. */
function copiesDesDossiers(dossiersDeCopies: readonly string[]): string[] {
  return dossiersDeCopies.flatMap((dossier) => {
    try {
      return readdirSync(dossier).map((nom) => join(dossier, nom))
    } catch {
      return []
    }
  })
}

/**
 * Range les restes dans une corbeille DATÉE, à côté de leur `projects` (même disque : un renommage, jamais
 * une copie). Rien n'est supprimé, rien n'est écrasé : une entrée déjà là pour le même jour reste en place.
 * `mesurer` compte sans rien déplacer. `dossiersDeCopies` sont les dossiers qui portent directement les copies
 * (`worktrees/<dépôt>`, `copies-de-fil`, `retours-de-tour`) : leurs enfants sont les copies présentes.
 */
export function rangerHistoriquesCliOrphelins(entree: {
  racines: readonly string[]
  dossiersDeCopies: readonly string[]
  jour: string
  mesurer?: boolean
}): BilanDuRangement {
  const avant = lireDossiersHistorique(entree.racines)
  const decisions = planifierRangementHistoriquesCli({
    dossiers: avant,
    copiesExistantes: copiesDesDossiers(entree.dossiersDeCopies),
    dossiersDeCopies: entree.dossiersDeCopies
  })
  const aRanger = decisions.filter((d) => d.decision === 'ranger')
  const gardes = decisions
    .filter((d) => d.decision === 'garder')
    .map((d) => ({ chemin: d.chemin, raison: d.raison ?? '' }))
  const ranges: string[] = []
  if (!entree.mesurer) {
    for (const d of aRanger) {
      const destination = join(corbeilleDe(d.racine, entree.jour), d.nom)
      if (existsSync(destination)) {
        gardes.push({
          chemin: d.chemin,
          raison: 'une entrée de même nom est déjà dans la corbeille du jour : rien n’est écrasé'
        })
        continue
      }
      try {
        mkdirSync(dirname(destination), { recursive: true })
        renameSync(d.chemin, destination)
        ranges.push(d.chemin)
      } catch (erreur) {
        gardes.push({
          chemin: d.chemin,
          raison: `déplacement refusé : ${erreur instanceof Error ? erreur.message : String(erreur)}`
        })
      }
    }
  }
  return {
    avant: avant.length,
    aRanger: aRanger.map((d) => d.chemin),
    ranges,
    gardes,
    apres: lireDossiersHistorique(entree.racines).length
  }
}
