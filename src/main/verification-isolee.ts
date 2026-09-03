import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { isForbidden } from './edit-file-command'

/**
 * LA VERIFICATION NE DOIT PAS SE JOUER DANS UN DOSSIER QUE QUELQU'UN D'AUTRE ECRIT.
 *
 * DEFAUT MESURE le 2026-09-02 (conv-133) : `verify` lance la suite dans l'espace de travail
 * PARTAGE. Pendant un lot de tests, un autre agent a reecrit `src/main/runs/conv-runs.ts` a
 * 14:23:44 puis l'a remis a l'identique — la suite a echoue au chargement (« Unterminated regular
 * expression ») sur un fichier qui n'avait aucun defaut. Un verdict qu'une ecriture concurrente
 * peut retourner ne prouve rien : ni le rouge (faux rouge, ici), ni le vert.
 *
 * La correction est celle d'`edit_file` : jouer dans une COPIE isolee. Mais une copie nait sur un
 * COMMIT et exclut donc tout le travail non committe — verifier dedans repondrait a une question
 * que personne ne pose (« le dernier commit est-il vert ? »). L'etat COURANT doit donc y etre
 * reporte : c'est ce que fait ce module, fichier a fichier, et rien d'autre.
 */

export type GesteDeVerification =
  | { action: 'copier'; relatif: string; source: string; destination: string }
  | { action: 'supprimer'; relatif: string; destination: string }
  | { action: 'ignorer'; relatif: string; raison: string }

/**
 * Identifiant STABLE du bureau de verification — un par conversation, pas un par appel.
 *
 * Meme levier que `cleDeBureau` pour `edit_file` (2026-08-25) : sans stabilite, chaque `verify`
 * fabriquerait une copie de plus. La cle reste courte : elle nomme un DOSSIER, donc elle consomme
 * le budget de chemin de Windows.
 */
export function cleDuBureauDeVerification(conversationId: string | undefined): string {
  const conv = (conversationId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-12)
  return `command-verify-${conv || 'sans-conversation'}`
}

/**
 * Decide PUREMENT quoi reporter de l'espace de travail vivant vers la copie, pour les chemins
 * NOMMES par git (fichiers modifies ou non suivis). Rien d'autre n'est touche : le reste de la
 * copie porte deja le commit de base.
 *
 * `lireOctets` rend `undefined` quand le chemin n'est pas un fichier lisible — c'est ce qui permet
 * de distinguer un fichier SUPPRIME dans l'espace de travail (present dans la copie : on l'enleve)
 * d'un chemin absent des deux cotes (rien a faire).
 */
export function gestesDeVerification(
  changements: readonly string[],
  workspace: string | undefined,
  bureau: string | undefined,
  lireOctets: (chemin: string) => Uint8Array | undefined
): GesteDeVerification[] {
  if (!workspace?.trim() || !bureau?.trim()) return []
  const racineWorkspace = resolve(workspace)
  const racineBureau = resolve(bureau)
  // Une copie confondue avec l'espace de travail n'a rien a synchroniser — et se copier sur
  // soi-meme detruirait le fichier.
  if (racineWorkspace === racineBureau) return []
  const gestes: GesteDeVerification[] = []
  const vus = new Set<string>()
  for (const chemin of changements) {
    const brut = (chemin ?? '').trim()
    if (!brut) continue
    const absolu = isAbsolute(brut) ? resolve(brut) : resolve(racineWorkspace, brut)
    const relatif = relative(racineWorkspace, absolu).split(String.fromCharCode(92)).join('/')
    if (!relatif || relatif.startsWith('..') || isAbsolute(relatif)) {
      gestes.push({ action: 'ignorer', relatif: brut, raison: "hors de l'espace de travail" })
      continue
    }
    if (vus.has(relatif.toLowerCase())) continue
    vus.add(relatif.toLowerCase())
    const interdit = isForbidden(relatif)
    if (interdit) {
      gestes.push({ action: 'ignorer', relatif, raison: interdit })
      continue
    }
    const destination = resolve(racineBureau, relatif)
    const octetsWorkspace = lireOctets(absolu)
    const octetsBureau = lireOctets(destination)
    if (!octetsWorkspace) {
      if (octetsBureau) gestes.push({ action: 'supprimer', relatif, destination })
      else gestes.push({ action: 'ignorer', relatif, raison: 'absent des deux côtés' })
      continue
    }
    if (octetsBureau && memeContenu(octetsWorkspace, octetsBureau)) {
      gestes.push({ action: 'ignorer', relatif, raison: 'déjà identique' })
      continue
    }
    gestes.push({ action: 'copier', relatif, source: absolu, destination })
  }
  return gestes
}

/** Egalite d'OCTETS : comparer en texte re-encoderait, donc mentirait sur un fichier non-UTF-8. */
function memeContenu(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

/** Lecture qui ne jette jamais : un dossier, un lien casse ou un droit manquant valent « absent ». */
function octetsOuRien(chemin: string): Uint8Array | undefined {
  try {
    const infos = statSync(chemin)
    if (!infos.isFile()) return undefined
    return readFileSync(chemin)
  } catch {
    return undefined
  }
}

/**
 * Git nomme un DOSSIER quand tout son contenu est non suivi (`? src/nouveau/`). Sans cette
 * expansion, un module entier tout neuf — le cas le plus courant d'un travail en cours — resterait
 * absent de la copie, et la verification se jouerait sur un etat qui n'existe nulle part.
 *
 * Bornee : au-dela de `plafond` fichiers on s'arrete, un dossier non suivi enorme (build, cache)
 * ne doit pas transformer une verification en copie de disque.
 */
export function fichiersDeLEtatCourant(
  workspace: string,
  changements: readonly string[],
  plafond = 2000
): string[] {
  const sortie: string[] = []
  const empiler = (relatif: string): void => {
    if (sortie.length >= plafond) return
    const absolu = resolve(workspace, relatif)
    let infos: ReturnType<typeof statSync>
    try {
      infos = statSync(absolu)
    } catch {
      // Chemin disparu (fichier supprime dans l'espace de travail) : il reste dans la liste, c'est
      // lui qui produira le geste « supprimer » cote copie.
      sortie.push(relatif)
      return
    }
    if (infos.isFile()) {
      sortie.push(relatif)
      return
    }
    if (!infos.isDirectory()) return
    if (isForbidden(relatif)) return
    let entrees: string[] = []
    try {
      entrees = readdirSync(absolu)
    } catch {
      return
    }
    for (const entree of entrees) empiler(`${relatif.replace(/\/+$/, '')}/${entree}`)
  }
  for (const chemin of changements) {
    const propre = (chemin ?? '').trim()
    if (propre) empiler(propre)
  }
  return sortie
}

/**
 * Reporte l'etat courant dans la copie et rend ce qui a REELLEMENT ete fait. Les gestes ignores
 * sont rendus aussi : une synchronisation muette empecherait de comprendre un verdict surprenant.
 */
export function synchroniserBureauDeVerification(
  workspace: string,
  bureau: string,
  changements: readonly string[]
): { copies: string[]; supprimes: string[]; ignores: string[] } {
  const gestes = gestesDeVerification(
    fichiersDeLEtatCourant(workspace, changements),
    workspace,
    bureau,
    octetsOuRien
  )
  const copies: string[] = []
  const supprimes: string[] = []
  const ignores: string[] = []
  for (const geste of gestes) {
    if (geste.action === 'copier') {
      mkdirSync(dirname(geste.destination), { recursive: true })
      copyFileSync(geste.source, geste.destination)
      copies.push(geste.relatif)
    } else if (geste.action === 'supprimer') {
      rmSync(geste.destination, { force: true })
      supprimes.push(geste.relatif)
    } else {
      ignores.push(`${geste.relatif} (${geste.raison})`)
    }
  }
  return { copies, supprimes, ignores }
}

/** Le dossier existe-t-il vraiment ? Une copie annoncee mais absente ne doit pas etre utilisee. */
export function bureauUtilisable(chemin: string | undefined): chemin is string {
  return typeof chemin === 'string' && chemin.trim().length > 0 && existsSync(chemin)
}

/** Rappel porte AVEC le verdict quand la copie isolee n'a pas pu etre obtenue. */
export const VERIFY_SANS_ISOLATION =
  '⚠ vérification jouée dans le dossier partagé (copie isolée indisponible) — une écriture concurrente peut fausser ce verdict'
