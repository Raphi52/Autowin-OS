/**
 * LA LISTE DES DOSSIERS DE TRAVAIL DU CHAT — une seule liste, partagée par le Chat et le Board
 * (demande utilisateur du 2026-10-28, conv-1212 : « ça doit vraiment être uniquement mes CWD de la
 * partie chat et quand je les supprime ça doit aussi les supprimer là-bas, et là-bas je veux un
 * bouton croix au bout des lignes de projets qui fait pareil »).
 *
 * La liste est celle du menu « Ranger dans… » du Chat (sa croix, `ChatView`), gardée dans le
 * stockage local de la vue. Elle sortait de `ChatView` pour que la croix du Board écrive LA MÊME
 * liste, avec la même mémoire des retraits (sans elle, l'import claude.exe ressusciterait le dossier
 * au lancement suivant). Un retrait fait ailleurs que dans le Chat est annoncé par
 * `EVT_DOSSIERS_DU_CHAT` : le Chat, toujours monté, relit alors la liste — sinon sa copie en mémoire
 * réécrirait le dossier retiré à son prochain changement.
 *
 * Le processus principal en reçoit une copie (`transmettreDossiersDuChat`) : c'est lui qui réduit le
 * Board à ces dossiers, pour l'écran comme pour la copie vers le partage
 * (`shared/board-dossiers-du-chat.ts`). La vue rejoue la même règle sur ce qu'elle reçoit
 * (`carteDuBoardAffichee`) : un processus principal d'avant redémarrage ne réduit rien, et
 * l'utilisateur voyait alors « depot » et « Divers » sans croix (conv-1212, 2e demande).
 *
 * Les lignes du menu « Projets » ont une croix (même demande : « des éléments que je ne peux même
 * pas supprimer, ils n'ont pas la petite croix ») : sur le dépôt par défaut, que le Chat propose
 * toujours, elle le range dans la mémoire des retraits, et il quitte le Board comme le menu du Chat.
 * SAUF « This computer » (conv-1231 : « j'ai perdu le this computer, il doit être impossible à
 * supprimer ») : pas de croix, et un retrait déjà mémorisé à son nom est ignoré partout.
 */
import type { CarteDesBesoins } from '../../../shared/carte-des-besoins'
import { estCheminDeDossier } from '../../../shared/project-path'
import {
  carteDesDossiersDuChat,
  cleDeDossier,
  dossiersDuBoard
} from '../../../shared/board-dossiers-du-chat'
import { avecDossierRetire } from './chat-dossiers-import'
import { nomDeDossier } from './conversation-groups'

/** Dossiers de classement déjà choisis, mémorisés entre les sessions. */
export const CLE_DOSSIERS_CONNUS = 'autowin.conv-folders.connus'
/**
 * Dossiers RETIRÉS par une croix — la mémoire qui empêche l'import claude.exe de les ressusciter à
 * chaque lancement. Distincte de la liste : « absent » ne dit pas si c'est « jamais vu » ou
 * « retiré exprès », et l'import a besoin de cette différence.
 */
export const CLE_DOSSIERS_RETIRES = 'autowin.conv-folders.retires'
/** Annoncé sur `window` quand la liste change hors du Chat (croix du Board). */
export const EVT_DOSSIERS_DU_CHAT = 'autowin:dossiers-du-chat'

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

function stockageParDefaut(): Stockage {
  return window.localStorage
}

/**
 * La liste mémorisée. SEULS DES CHEMINS y entrent (conv-81) : le filtre posé à la lecture vide ce
 * qui s'y était installé avant, des libellés de classement proposés comme dossiers de travail.
 */
export function lireDossiersDuChat(stockage: Stockage = stockageParDefaut()): string[] {
  try {
    const brut = stockage.getItem(CLE_DOSSIERS_CONNUS)
    const lu = brut ? (JSON.parse(brut) as unknown) : null
    if (Array.isArray(lu))
      return lu.filter((x): x is string => typeof x === 'string' && estCheminDeDossier(x))
  } catch {
    /* préférence illisible : on repart des dossiers réellement utilisés */
  }
  return []
}

export function lireDossiersRetires(stockage: Stockage = stockageParDefaut()): string[] {
  try {
    const lu = JSON.parse(stockage.getItem(CLE_DOSSIERS_RETIRES) ?? '[]') as unknown
    return Array.isArray(lu) ? lu.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return [] // mémoire illisible : au pire un dossier retiré revient UNE fois, la croix le range
  }
}

/** Écrit la mémoire des retraits ; rend l'erreur au lieu de la lever (stockage plein). */
export function ecrireDossiersRetires(
  retires: string[],
  stockage: Stockage = stockageParDefaut()
): unknown {
  try {
    stockage.setItem(CLE_DOSSIERS_RETIRES, JSON.stringify(retires))
    return null
  } catch (error) {
    return error
  }
}

/**
 * La croix du Board : retire le dossier de la liste du Chat, le mémorise comme retiré, et l'annonce
 * au Chat. Rend la liste restante, à transmettre au processus principal.
 */
export function retirerDossierDuChat(
  chemin: string,
  stockage: Stockage = stockageParDefaut(),
  annoncer: () => void = () => window.dispatchEvent(new Event(EVT_DOSSIERS_DU_CHAT))
): string[] {
  ecrireDossiersRetires(avecDossierRetire(lireDossiersRetires(stockage), chemin), stockage)
  const cle = cleDeDossier(chemin)
  const restants = lireDossiersDuChat(stockage).filter((connu) => cleDeDossier(connu) !== cle)
  stockage.setItem(CLE_DOSSIERS_CONNUS, JSON.stringify(restants))
  annoncer()
  return restants
}

/**
 * Transmet la liste et ses retraits au processus principal, qui réduit le Board à ces dossiers.
 * Pont absent (preload d'avant redémarrage) = seule la vue réduit (`carteDuBoardAffichee`) jusqu'au
 * redémarrage, jamais une panne.
 */
export async function transmettreDossiersDuChat(
  dossiers: readonly string[],
  retires: readonly string[] = lireDossiersRetires()
): Promise<void> {
  await window.api.boardDossiersDuChat?.([...dossiers], [...retires])
}

/**
 * Le dossier personnel, « This computer » — jamais retirable (conv-1231). `null` = pont absent
 * (preload d'avant redémarrage) ou illisible.
 */
export async function lireDossierPersonnel(): Promise<string | null> {
  try {
    const chemin = await window.api.dossierPersonnel?.()
    return chemin && estCheminDeDossier(chemin) ? chemin.trim() : null
  } catch {
    return null
  }
}

/**
 * Les dossiers que le Chat propose toujours : le dépôt actif de la session et le dossier personnel
 * (« This computer »), lus au processus principal — les mêmes qu'il ajoute de son côté. `null` =
 * illisibles : la vue ne refiltre pas, plutôt que de faire disparaître le dépôt par défaut.
 */
export async function lireDossiersToujoursProposes(): Promise<string[] | null> {
  try {
    const [espace, personnel] = await Promise.all([
      window.api.executionWorkspace?.(),
      lireDossierPersonnel()
    ])
    if (!espace?.path?.trim()) return null
    return personnel?.trim() ? [espace.path, personnel] : [espace.path]
  } catch {
    return null
  }
}

/**
 * Le Board tel que la vue le montre : la règle du processus principal, rejouée sur ce qu'il rend
 * (sans effet s'il a déjà réduit). `toujours` à `null` = la carte reçue telle quelle. `personnel`
 * (« This computer ») reste même s'il a été retiré (conv-1231).
 */
export function carteDuBoardAffichee(
  carte: CarteDesBesoins,
  dossiers: readonly string[],
  toujours: readonly string[] | null,
  retires: readonly string[],
  personnel: string | null = null
): CarteDesBesoins {
  if (toujours === null) return carte
  return carteDesDossiersDuChat(carte, dossiersDuBoard(dossiers, toujours, retires, [personnel]))
}

/** Le nom du dossier personnel dans le menu « Projets » : le même que dans le Chat (conv-1230). */
export const NOM_DU_DOSSIER_PERSONNEL = '💻 This computer'

/** Une ligne du menu « Projets » du Board. `retirable` = le chemin que sa croix retire du Chat. */
export interface LigneDeProjet {
  cle: string
  libelle: string
  demandes: number
  retirable?: string
}

/**
 * Les lignes du menu « Projets » : les projets du Board (déjà réduits aux dossiers du Chat), puis
 * les dossiers du Chat qui n'ont encore aucune demande — la liste commune y est donc entière.
 * Chaque ligne qui est un dossier a sa croix, y compris le dépôt par défaut, absent de la liste
 * mémorisée : sa croix le range dans la mémoire des retraits. Seul `personnel` (« This computer »)
 * n'en a pas : il ne se retire jamais (conv-1231).
 */
export function lignesDuMenuDesProjets(
  projets: readonly { cle: string; libelle: string; demandes: number }[],
  dossiers: readonly string[],
  personnel: string | null = null
): LigneDeProjet[] {
  const clePersonnelle = cleDeDossier(personnel)
  const retirable = (chemin: string | undefined): string | undefined =>
    chemin && (!clePersonnelle || cleDeDossier(chemin) !== clePersonnelle) ? chemin : undefined
  // Le dossier personnel porte le nom que lui donne le Chat (ChatView.tsx), pas celui du dossier :
  // le nom du compte Windows se lisait comme le nom d'une personne (conv-1230, « c'est quoi cette ligne »).
  const nomAffiche = (cle: string, libelle: string): string =>
    clePersonnelle && cle === clePersonnelle ? NOM_DU_DOSSIER_PERSONNEL : libelle
  const parCle = new Map<string, string>()
  for (const chemin of dossiers) {
    const cle = cleDeDossier(chemin)
    if (cle && !parCle.has(cle)) parCle.set(cle, chemin)
  }
  const vus = new Set<string>()
  const lignes: LigneDeProjet[] = projets.map((p) => {
    const cle = cleDeDossier(p.cle) ?? p.cle
    vus.add(cle)
    const chemin = retirable(parCle.get(cle) ?? (estCheminDeDossier(p.cle) ? p.cle : undefined))
    const ligne = { ...p, libelle: nomAffiche(cle, p.libelle) }
    return chemin ? { ...ligne, retirable: chemin } : ligne
  })
  for (const [cle, chemin] of parCle) {
    if (vus.has(cle)) continue
    const croix = retirable(chemin)
    lignes.push({
      cle: chemin,
      libelle: nomAffiche(cle, nomDeDossier(chemin)),
      demandes: 0,
      ...(croix ? { retirable: croix } : {})
    })
  }
  // « This computer » en tête (conv-1243 : « met le en premier de la liste ») ; les autres gardent
  // leur ordre d'activité.
  if (!clePersonnelle) return lignes
  const estPersonnelle = (l: LigneDeProjet): boolean =>
    (cleDeDossier(l.cle) ?? l.cle) === clePersonnelle
  return [...lignes.filter(estPersonnelle), ...lignes.filter((l) => !estPersonnelle(l))]
}
