import { existsSync } from 'node:fs'
import { mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { memeCheminSurDisque } from '../fichiers/meme-chemin'
import {
  ATTENTE_COPIE_CONTROLE_COURT_MS,
  ATTENTE_COPIE_MS,
  NOM_CONF_COPIE_A_LA_DEMANDE,
  NOM_DEMANDE_DE_COPIE,
  NOM_MODULE_COPIE_A_LA_DEMANDE,
  NOM_REPONSE_DE_COPIE,
  VARIABLE_COPIE_A_LA_DEMANDE,
  moduleCopieALaDemande,
  type ReponseDeCopie
} from '../../shared/copie-a-la-demande'

/**
 * LA COPIE À LA DEMANDE, CÔTÉ APP (`shared/copie-a-la-demande.ts` pour le contrôle).
 *
 * Le tour du chat qui part sans copie dans le dépôt partagé INSCRIT ici l'ouverture de sa copie
 * (`inscrireCopieALaDemande`) ; il la retire à la fin du tour. Chaque lancement du CLI de ce tour
 * (`armerCopieALaDemande`, appelé par claude.ts) pose la conf à côté du script du contrôle et guette la
 * demande. Codex, Grok et agy n'ont pas de dossier de réglages par lancement : `armerCopieALaDemandeDuCli`
 * leur en crée un et le désigne à leur contrôle par une variable d'environnement. L'ouverture ne joue qu'UNE fois par tour : un second lancement, ou deux écritures en
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
  /** Attente du contrôle avant de rendre la main ; celle de Claude par défaut. */
  attenteMs?: number
  /** Le module que charge le contrôle fixe de Codex, Grok et agy, à poser à côté de la conf. */
  avecModule?: boolean
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
    const module = entree.avecModule
      ? join(entree.dossier, NOM_MODULE_COPIE_A_LA_DEMANDE)
      : undefined
    if (module) await writeFile(module, moduleCopieALaDemande(), 'utf8')
    await ecrireJson(join(entree.dossier, NOM_CONF_COPIE_A_LA_DEMANDE), {
      depot: inscription.depot,
      demande,
      reponse,
      attenteMs: entree.attenteMs ?? ATTENTE_COPIE_MS,
      ...(module ? { module } : {})
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

/**
 * ARME LA COPIE À LA DEMANDE POUR UN LANCEMENT DE CODEX, GROK OU AGY. Leur contrôle avant outil est
 * un script fixe du dépôt (`scripts/garde-ecriture-hors-copie.mjs`) : il trouve la conf par la
 * variable rendue ici, à poser dans l'environnement du SEUL processus lancé. Sans inscription pour ce
 * fil, ou hors du dépôt partagé inscrit : aucune variable, aucun dossier, et le contrôle ne fait rien.
 * `arreter` coupe le guet et retire le dossier ; à appeler à la fin du lancement.
 */
export async function armerCopieALaDemandeDuCli(entree: {
  conversationId?: string
  cwd?: string
  /** Le CLI laisse-t-il son contrôle attendre l'ouverture entière (agy), ou le coupe-t-il avant ? */
  attenteLongue?: boolean
  intervalleMs?: number
}): Promise<{ env: Record<string, string>; arreter: () => void }> {
  const rien = { env: {}, arreter: (): void => undefined }
  if (!copieALaDemandeInscrite(entree.conversationId)) return rien
  let dossier: string
  try {
    dossier = await mkdtemp(join(tmpdir(), 'autowin-copie-a-la-demande-'))
  } catch {
    return rien
  }
  const retirer = (): void => {
    void rm(dossier, { recursive: true, force: true }).catch(() => undefined)
  }
  const arreterLeGuet = await armerCopieALaDemande({
    dossier,
    conversationId: entree.conversationId,
    cwd: entree.cwd,
    intervalleMs: entree.intervalleMs,
    attenteMs: entree.attenteLongue ? ATTENTE_COPIE_MS : ATTENTE_COPIE_CONTROLE_COURT_MS,
    avecModule: true
  })
  const conf = join(dossier, NOM_CONF_COPIE_A_LA_DEMANDE)
  // Pas de conf : le lancement ne travaille pas dans le dépôt partagé, ou elle n'a pas pu s'écrire.
  if (!existsSync(conf)) {
    arreterLeGuet()
    retirer()
    return rien
  }
  return {
    env: { [VARIABLE_COPIE_A_LA_DEMANDE]: conf },
    arreter: () => {
      arreterLeGuet()
      retirer()
    }
  }
}
