import { existsSync } from 'node:fs'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { memeCheminSurDisque } from '../fichiers/meme-chemin'
import {
  ATTENTE_COPIE_MS,
  NOM_CONF_COPIE_A_LA_DEMANDE,
  NOM_DEMANDE_DE_COPIE,
  NOM_REPONSE_DE_COPIE,
  type ReponseDeCopie
} from '../../shared/copie-a-la-demande'

/**
 * LA COPIE À LA DEMANDE, CÔTÉ APP (`shared/copie-a-la-demande.ts` pour le contrôle).
 *
 * Le tour du chat qui part sans copie dans le dépôt partagé INSCRIT ici l'ouverture de sa copie
 * (`inscrireCopieALaDemande`) ; il la retire à la fin du tour. Chaque lancement du CLI de ce tour
 * (`armerCopieALaDemande`, appelé par claude.ts) pose la conf à côté du script du contrôle et guette la
 * demande. L'ouverture ne joue qu'UNE fois par tour : un second lancement, ou deux écritures en
 * parallèle, reçoivent la même copie.
 */

export type OuvrirLaCopie = () => Promise<ReponseDeCopie>

interface Inscription {
  depot: string
  ouvrir: () => Promise<ReponseDeCopie>
  /** La réponse, une fois l'ouverture finie. */
  rendue?: ReponseDeCopie
}

const inscriptions = new Map<string, Inscription>()

/** Le tour `conversationId` ouvrira sa copie de `depot` à sa première écriture. Rend le retrait. */
export function inscrireCopieALaDemande(
  conversationId: string,
  entree: { depot: string; ouvrir: OuvrirLaCopie }
): () => void {
  let enCours: Promise<ReponseDeCopie> | undefined
  const inscription: Inscription = {
    depot: entree.depot,
    ouvrir: () => {
      enCours ??= entree
        .ouvrir()
        .catch((erreur: unknown): ReponseDeCopie => ({
          ok: false,
          raison: erreur instanceof Error ? erreur.message : String(erreur)
        }))
        .then((reponse) => {
          inscription.rendue = reponse
          return reponse
        })
      return enCours
    }
  }
  inscriptions.set(conversationId, inscription)
  return () => {
    if (inscriptions.get(conversationId) === inscription) inscriptions.delete(conversationId)
  }
}

/** Vrai tant que le tour du fil attend sa première écriture pour ouvrir sa copie. */
export function copieALaDemandeInscrite(conversationId: string | undefined): boolean {
  return Boolean(conversationId && inscriptions.has(conversationId))
}

async function ecrireJson(chemin: string, valeur: unknown): Promise<void> {
  const tmp = `${chemin}.${process.pid}.app.tmp`
  await writeFile(tmp, JSON.stringify(valeur), 'utf8')
  try {
    await rename(tmp, chemin)
  } catch (erreur) {
    await unlink(tmp).catch(() => undefined)
    throw erreur
  }
}

/**
 * ARME LA COPIE À LA DEMANDE POUR UN LANCEMENT DU CLI. Ne fait rien (et rend un arrêt vide) si le fil
 * n'a pas d'inscription, ou si le lancement ne travaille pas dans le dépôt partagé inscrit : un agent
 * déjà dans une copie n'a rien à ouvrir. Rend l'arrêt du guet, à appeler à la fin du lancement.
 */
export async function armerCopieALaDemande(entree: {
  /** Dossier des réglages du lancement, où vit le script du contrôle. */
  dossier: string
  conversationId?: string
  /** Dossier de travail du lancement. */
  cwd?: string
  intervalleMs?: number
}): Promise<() => void> {
  const rien = (): void => undefined
  const inscription = entree.conversationId ? inscriptions.get(entree.conversationId) : undefined
  if (!inscription || !entree.cwd || !memeCheminSurDisque(entree.cwd, inscription.depot))
    return rien
  const demande = join(entree.dossier, NOM_DEMANDE_DE_COPIE)
  const reponse = join(entree.dossier, NOM_REPONSE_DE_COPIE)
  try {
    // Copie déjà ouverte par un lancement précédent du même tour : le contrôle la connaît d'emblée.
    if (inscription.rendue) await ecrireJson(reponse, inscription.rendue)
    await ecrireJson(join(entree.dossier, NOM_CONF_COPIE_A_LA_DEMANDE), {
      depot: inscription.depot,
      demande,
      reponse,
      attenteMs: ATTENTE_COPIE_MS
    })
  } catch {
    // Sans conf, le contrôle ne demande rien : le lancement écrit dans le dossier partagé, comme avant.
    return rien
  }
  if (inscription.rendue) return rien
  // Le guet sert toute demande restée sans réponse : une réponse qui n'a pas pu s'écrire est retentée
  // à la demande suivante, et l'ouverture, elle, ne rejoue pas (`ouvrir` rend la même promesse).
  let occupe = false
  const guet = setInterval(() => {
    if (occupe || existsSync(reponse) || !existsSync(demande)) return
    occupe = true
    void inscription
      .ouvrir()
      .then((rendue) => ecrireJson(reponse, rendue))
      .catch(() => undefined)
      .finally(() => {
        occupe = false
      })
  }, entree.intervalleMs ?? 150)
  guet.unref?.()
  return () => clearInterval(guet)
}
