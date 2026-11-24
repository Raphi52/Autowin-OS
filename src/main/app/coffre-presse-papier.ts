/**
 * RANGER AU COFFRE UNE CLÉ COPIÉE, SANS QUE SA VALEUR PASSE PAR L'AGENT.
 *
 * Pourquoi : un agent qui crée lui-même une clé API sur un site (navigateur intégré ou bureau caché)
 * doit pouvoir la garder sans la recopier, et sans demander à l'utilisateur de la coller dans
 * Réglages > Clés. Il clique « Copier » sur le site ; ce module lit le presse-papier DANS le processus
 * principal, range la valeur, vide le presse-papier et ne rend que le nom et la longueur.
 *
 * Refus, sans rien ranger :
 * - presse-papier vide, ou qui ne ressemble pas à une clé seule (espace, plusieurs lignes) : le
 *   « Copier » a échoué et le presse-papier porte autre chose, peut-être un texte de l'utilisateur ;
 * - valeur trop courte pour être masquée dans les sorties ;
 * - nom déjà au coffre : remplacer une clé reste un geste de l'utilisateur (Réglages > Clés), pour
 *   qu'une page piégée ne puisse pas substituer sa propre clé à celle qu'il a rangée ;
 * - `site` donné mais pas en https:// : vérifié AVANT de lire le presse-papier, qui reste intact.
 *
 * Avec `site`, la valeur est un mot de passe lié à cette origine : seul le navigateur intégré la
 * tape, sur ce site-là, et elle n'est jamais posée chez les agents (`coffre-cles.ts`).
 *
 * Après le rangement, les fichiers déjà écrits pendant ce tour (une page relue où la clé
 * s'affichait encore, avant qu'elle soit au coffre) sont repassés et masqués sur place.
 */
import { createRequire } from 'node:module'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Clipboard } from 'electron'
import { autowinAppDataRoot } from './app-data'
import {
  ajouterCle as ajouterAuCoffre,
  LONGUEUR_MIN_MASQUAGE,
  listerCles as listerLeCoffre,
  memeNom,
  normaliserSite,
  type CleListee
} from './coffre-cles'
import { masquerFichierSansEchec, motifsDeMasquage } from '../runs/masquage-sur-disque'

/**
 * Tiré du type d'Electron, pas recopié : depuis Electron 44, `readText()` rend une promesse. Une
 * interface écrite à la main l'avait gardé synchrone, et seul l'appel réel l'a révélé.
 */
export type PressePapier = Pick<Clipboard, 'readText' | 'clear'>

export interface RangementDepuisPressePapier {
  ok: boolean
  nom: string
  /** Jamais la valeur : sa longueur suffit à voir qu'une clé entière a été copiée. */
  longueur?: number
  /** L'origine à laquelle la valeur est liée, quand `site` a été donné. */
  site?: string
  /** Occurrences déjà écrites sur disque pendant ce tour, masquées après coup. */
  masqueesApresCoup?: number
  detail: string
}

/** Chargé à la demande, comme `safeStorage` dans le coffre : les tests tournent hors d'Electron. */
function pressePapierElectron(): PressePapier | undefined {
  try {
    const mod = createRequire(__filename)('electron') as { clipboard?: Clipboard }
    return typeof mod?.clipboard?.readText === 'function' ? mod.clipboard : undefined
  } catch {
    return undefined
  }
}

/** Le journal du tour le plus récent du fil : celui du tour en cours. */
async function journalDuTourEnCours(conversationId: string | undefined): Promise<string[]> {
  if (!conversationId || !/^[A-Za-z0-9_-]+$/.test(conversationId)) return []
  const dossier = join(autowinAppDataRoot(), 'turn-journals', conversationId)
  let noms: string[]
  try {
    noms = (await readdir(dossier)).filter((n) => n.endsWith('.jsonl'))
  } catch {
    return []
  }
  const dates = await Promise.all(
    noms.map(async (n) => ({
      chemin: join(dossier, n),
      quand: (await stat(join(dossier, n))).mtimeMs
    }))
  )
  dates.sort((a, b) => b.quand - a.quand)
  return dates.slice(0, 1).map((d) => d.chemin)
}

export async function rangerDepuisPressePapier(entree: {
  nom: string
  /** Facultatif : adresse https:// du site où ce mot de passe sera tapé. */
  site?: string
  conversationId?: string
  pressePapier?: PressePapier
  coffre?: {
    listerCles(): CleListee[]
    ajouterCle(nom: string, valeur: string, site?: string): void
  }
  fichiersARepasser?: () => Promise<string[]>
}): Promise<RangementDepuisPressePapier> {
  const nom = typeof entree.nom === 'string' ? entree.nom.trim() : ''
  const refus = (detail: string): RangementDepuisPressePapier => ({ ok: false, nom, detail })
  const coffre = entree.coffre ?? { listerCles: listerLeCoffre, ajouterCle: ajouterAuCoffre }
  const pressePapier = entree.pressePapier ?? pressePapierElectron()
  if (!pressePapier) return refus('Presse-papier indisponible hors de l’app : rien n’est rangé.')
  const avecSite = entree.site !== undefined && entree.site !== ''
  const site = avecSite ? normaliserSite(entree.site) : undefined
  if (site === null)
    return refus(
      'Site invalide : donne l’adresse https:// de la page du site (ex. https://exemple.fr/connexion). ' +
        'Rien n’est rangé, le presse-papier est intact.'
    )
  if (coffre.listerCles().some((c) => memeNom(c.nom, nom)))
    return refus(
      `${nom} est déjà au coffre : rien n’est remplacé. L’utilisateur la remplace lui-même dans ` +
        'Réglages > Clés, ou choisis un autre nom.'
    )
  const valeur = (await pressePapier.readText()).trim()
  if (!valeur)
    return refus(
      'Le presse-papier est vide : clique d’abord le bouton « Copier » de la clé sur le site.'
    )
  if (/\s/.test(valeur))
    return refus(
      'Le presse-papier ne contient pas une clé seule (espaces ou plusieurs lignes) : le « Copier » ' +
        'n’a sans doute pas marché. Rien n’est rangé.'
    )
  if (valeur.length < LONGUEUR_MIN_MASQUAGE)
    return refus(
      `Le presse-papier contient moins de ${LONGUEUR_MIN_MASQUAGE} caractères : ce n’est pas une clé, rien n’est rangé.`
    )
  try {
    coffre.ajouterCle(nom, valeur, site)
  } catch (erreur) {
    // Les refus du coffre ne citent jamais la valeur : leur message part tel quel.
    return refus(erreur instanceof Error ? erreur.message : String(erreur))
  }
  try {
    if ((await pressePapier.readText()).trim() === valeur) pressePapier.clear()
  } catch {
    // Un presse-papier verrouillé ne défait pas le rangement : la clé est au coffre.
  }
  const motifs = motifsDeMasquage({ [nom]: valeur })
  const fichiers = await (
    entree.fichiersARepasser ?? (() => journalDuTourEnCours(entree.conversationId))
  )()
  let masqueesApresCoup = 0
  for (const fichier of fichiers)
    masqueesApresCoup += (await masquerFichierSansEchec(fichier, motifs)).remplacements
  if (site)
    return {
      ok: true,
      nom,
      longueur: valeur.length,
      site,
      masqueesApresCoup,
      detail:
        `${nom} est au coffre (${valeur.length} caractères), lié à ${site} ; le presse-papier est ` +
        'vidé. Seul le navigateur intégré le tape, sur ce site : navigateur_agir, action `saisir`, ' +
        `\`depuisCoffre: ${nom}\`. Il n’est pas servi aux agents. Sa valeur est masquée partout.`
    }
  return {
    ok: true,
    nom,
    longueur: valeur.length,
    masqueesApresCoup,
    detail:
      `${nom} est au coffre (${valeur.length} caractères), le presse-papier est vidé. Elle est servie ` +
      'aux agents lancés à partir de maintenant, pas à celui-ci : pour t’en servir dans ce tour, ' +
      'passe par une étape lancée après (orchestrate). Sa valeur est masquée partout où elle apparaît.'
  }
}
