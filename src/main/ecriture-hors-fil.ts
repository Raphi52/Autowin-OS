import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * ÉCRIRE UN PETIT FICHIER ENTIER HORS DU FIL PRINCIPAL (conv-1368, 2026-10-31).
 *
 * Mesure `gels.jsonl` sur 7 jours : `renameSync` a figé la fenêtre 66,6 s, dont 16 s d'un coup, sur
 * huit petits JSON. Remplacer un fichier tout neuf peut tenir 20 s sous charge, même hors de l'app
 * (`cmd move /y`), alors que le SSD répond en 420 ms au pire : le fil attend dans le noyau, sur
 * `NtSetInformationFile` (`scripts/trace-blocage-disque.ps1`). On ne peut pas rendre ce renommage
 * rapide, seulement cesser de l'attendre sur le fil qui dessine l'interface.
 *
 * Trois garanties, celles qu'une écriture synchrone donnait sans y penser :
 *  - RELIRE SA PROPRE ÉCRITURE : `relireFichier` rend la dernière valeur déposée. Plusieurs magasins
 *    relisent leur fichier avant chaque mutation : lire le disque ferait perdre l'écriture d'avant,
 *    ou facturer deux fois un tour (`claude-session-cost.ts`).
 *  - L'ORDRE : une seule écriture en vol par fichier, et la dernière valeur gagne. Une rafale ne pose
 *    pas ses valeurs intermédiaires, et jamais une ancienne par-dessus une récente.
 *  - LA FERMETURE : `viderFichiersEnAttente` pose tout sur place depuis `before-quit`, après avoir
 *    laissé atterrir un renommage déjà parti, qui sinon recouvrirait la valeur finale.
 *
 * PAR FICHIER, jamais une file globale : un mur sur un fichier n'arrête pas les autres. Le même défaut
 * est décrit dans `conversations-disk.ts`.
 *
 * LA LIMITE : un plantage du processus perd ce qui n'est pas encore posé, quelques millisecondes en
 * temps normal, jusqu'à 20 s pendant un mur. Le fichier reste entier, dans sa version d'avant. Un
 * magasin qui doit savoir sa valeur posée attend `attendreFichier`, sans tenir le fil
 * (`task-scheduler.ts`).
 */

interface Depot {
  /** `null` = supprimer le fichier. */
  contenu: string | null
  mode?: number
}

interface Etat {
  /** La valeur la plus récente : c'est elle que voit une relecture. */
  dernier: Depot
  /** Déposée et pas encore prise. */
  attente?: Depot
  /** La boucle d'écriture, absente quand rien ne tourne. */
  boucle?: Promise<boolean>
  /** La fermeture a tout posé : une écriture encore en route doit s'effacer. */
  doublee: boolean
  /** Le temporaire dont le renommage est parti : plus rien ne peut l'annuler. */
  renommage?: string
}

const etats = new Map<string, Etat>()
let numeroDeTemporaire = 0
/** Au-delà du mur le plus long mesuré, 20 s : une fermeture ne doit pas pouvoir rester suspendue. */
const ATTENTE_MAX_DU_RENOMMAGE_MS = 25_000

const temporaireDe = (chemin: string): string =>
  `${chemin}.${process.pid}.${++numeroDeTemporaire}.tmp`

async function poser(chemin: string, depot: Depot, etat: Etat): Promise<void> {
  if (depot.contenu === null) {
    await rm(chemin, { force: true })
    return
  }
  await mkdir(dirname(chemin), { recursive: true })
  const temporaire = temporaireDe(chemin)
  try {
    await writeFile(temporaire, depot.contenu, {
      encoding: 'utf8',
      ...(depot.mode === undefined ? {} : { mode: depot.mode })
    })
    if (!etat.doublee) {
      etat.renommage = temporaire
      await rename(temporaire, chemin)
    }
  } finally {
    etat.renommage = undefined
    // Après un renommage réussi le temporaire n'existe plus : `force` rend ce retrait sans effet.
    await rm(temporaire, { force: true }).catch(() => undefined)
  }
}

/** Rend `true` si la dernière valeur est posée, `false` si le disque l'a refusée. */
async function derouler(chemin: string, etat: Etat): Promise<boolean> {
  for (let depot = etat.attente; depot && !etat.doublee; depot = etat.attente) {
    etat.attente = undefined
    try {
      await poser(chemin, depot, etat)
    } catch (erreur) {
      /*
       * Un fichier tenu par un autre processus se libère seul. Pas de nouvel essai à l'aveugle : la
       * valeur reste relisible, et le prochain dépôt ou la fermeture la repose.
       */
      etat.attente ??= depot
      etat.boucle = undefined
      console.warn(`[ecriture-hors-fil] ${chemin} non posé :`, erreur)
      return false
    }
  }
  etat.boucle = undefined
  if (etats.get(chemin) === etat) etats.delete(chemin)
  return true
}

/**
 * Dépose la nouvelle valeur d'un fichier, ou sa suppression (`null`), et rend la main. Jamais d'erreur
 * vers l'appelant : un échec se lit dans `attendreFichier` et dans le journal de l'app.
 */
export function deposerFichier(
  chemin: string,
  contenu: string | null,
  options: { mode?: number } = {}
): void {
  const depot: Depot = { contenu, ...options }
  const etat = etats.get(chemin) ?? { dernier: depot, doublee: false }
  etats.set(chemin, etat)
  etat.dernier = depot
  etat.attente = depot
  // Un `await` d'abord : la rafale du même tour de boucle se résume à sa dernière valeur.
  etat.boucle ??= Promise.resolve().then(() => derouler(chemin, etat))
}

/** Ce qu'une relecture doit voir : la dernière valeur déposée, sinon le disque. */
export function relireFichier(chemin: string): string | undefined {
  const etat = etats.get(chemin)
  if (etat) return etat.dernier.contenu ?? undefined
  return existsSync(chemin) ? readFileSync(chemin, 'utf8') : undefined
}

/**
 * Attend que le fichier (ou tous, sans chemin) soit posé, sans tenir le fil. Rend `false` si le disque
 * a refusé la dernière valeur : le fichier garde alors sa version d'avant.
 */
export async function attendreFichier(chemin?: string): Promise<boolean> {
  let pose = true
  for (;;) {
    const cibles = chemin ? [etats.get(chemin)] : [...etats.values()]
    const boucles = cibles.flatMap((etat) => (etat?.boucle ? [etat.boucle] : []))
    if (boucles.length === 0) break
    pose = (await Promise.all(boucles)).every(Boolean) && pose
  }
  return pose
}

function poserSurPlace(chemin: string, { contenu, mode }: Depot): void {
  if (contenu === null) {
    rmSync(chemin, { force: true })
    return
  }
  mkdirSync(dirname(chemin), { recursive: true })
  const temporaire = temporaireDe(chemin)
  try {
    writeFileSync(temporaire, contenu, {
      encoding: 'utf8',
      ...(mode === undefined ? {} : { mode })
    })
    renameSync(temporaire, chemin)
  } finally {
    rmSync(temporaire, { force: true })
  }
}

/**
 * Un renommage parti vit dans un fil du pool de Node : il finit sans la boucle d'événements, et sa
 * fin se lit au disque, son temporaire disparaît.
 */
function attendreAtterrissage(temporaire: string): void {
  const sommeil = new Int32Array(new SharedArrayBuffer(4))
  const limite = Date.now() + ATTENTE_MAX_DU_RENOMMAGE_MS
  while (existsSync(temporaire) && Date.now() < limite) Atomics.wait(sommeil, 0, 0, 20)
}

/**
 * Pose tout sur place : à n'appeler que depuis `before-quit`, où plus personne n'attend l'interface.
 * Ne lève jamais : un magasin refusé ne doit pas casser la suite de la fermeture.
 */
export function viderFichiersEnAttente(): void {
  for (const [chemin, etat] of etats) {
    etat.doublee = true
    etats.delete(chemin)
    try {
      if (etat.renommage) attendreAtterrissage(etat.renommage)
      poserSurPlace(chemin, etat.dernier)
    } catch (erreur) {
      console.error(`[ecriture-hors-fil] fermeture : ${chemin} non posé :`, erreur)
    }
  }
}
