import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { canonicalProjectPath, estCheminDeDossier } from '../shared/project-path'

/**
 * LES PROJETS DÉJÀ OUVERTS DANS claude.exe, pour pré-remplir la liste des dossiers du Chat.
 *
 * Demande d'origine (conv-5, 2026-09-23) : « ajoute à ma liste de CWD tous les projets sur
 * lesquels je travaillais sur claude.exe ». Le CLI Claude tient cette liste dans le champ
 * `projects` de son profil `~/.claude.json` — chaque CLÉ est un dossier où il a été lancé.
 *
 * DEUX RÈGLES NON NÉGOCIABLES :
 *  - LECTURE SEULE, et seules les CLÉS de `projects` sortent d'ici. Le reste du profil porte des
 *    identifiants (oauthAccount, userID, machineID…) qui ne doivent JAMAIS atteindre le renderer
 *    ni un journal. Aucune valeur du fichier n'est relue, copiée ni tracée.
 *  - JAMAIS D'ERREUR : cette liste alimente un confort (pré-remplissage). Un profil absent,
 *    illisible ou corrompu rend `[]` — la liste du Chat reste celle que l'utilisateur avait.
 *
 * FILTRAGE, mesuré sur le profil réel le 2026-09-23 : sur 24 entrées, seules 5 étaient de vrais
 * projets. Le reste : le dossier personnel lui-même (claude lancé sans projet), des doublons
 * `E:/…` vs `E:\…` (fusionnés par la canonisation partagée), des copies de travail
 * (`…\.claude\worktrees\…`) et des dossiers jetables (`…\AppData\Roaming\Claude\scratch-workspaces\…`).
 */
export function extraireDossiersProjetsClaude(
  brutJson: string,
  dossierPersonnel: string
): string[] {
  let projets: Record<string, unknown>
  try {
    const profil = JSON.parse(brutJson) as { projects?: unknown }
    if (
      !profil ||
      typeof profil !== 'object' ||
      !profil.projects ||
      typeof profil.projects !== 'object' ||
      Array.isArray(profil.projects)
    ) {
      return []
    }
    projets = profil.projects as Record<string, unknown>
  } catch {
    return [] // profil corrompu : rien à importer, jamais une erreur
  }
  const personnel = canonicalProjectPath(dossierPersonnel)?.toLowerCase()
  const vus = new Set<string>()
  const dossiers: string[] = []
  for (const brut of Object.keys(projets)) {
    // La FORME d'abord (même frontière que la liste du Chat) : une clé qui n'est pas un chemin
    // de dossier Windows n'a rien à faire dans un sélecteur de dossier de travail.
    if (!estCheminDeDossier(brut)) continue
    const canon = canonicalProjectPath(brut)
    if (!canon) continue
    const cle = canon.toLowerCase()
    // Le dossier personnel n'est pas un projet : c'est claude.exe lancé « nulle part ».
    if (vus.has(cle) || cle === personnel) continue
    if (estDossierJetable(canon)) continue
    vus.add(cle)
    dossiers.push(canon)
  }
  return dossiers
}

/**
 * Copies de travail et dossiers temporaires — ce que la demande d'origine excluait explicitement.
 * Un segment caché (`.claude`, `.autowin-data`, `.git`…) signale une zone interne d'outil, jamais
 * un projet choisi ; les autres noms sont les emplacements jetables observés sur le profil réel.
 */
const SEGMENTS_JETABLES = new Set([
  'worktrees',
  'scratch-workspaces',
  'appdata',
  'temp',
  'tmp',
  'node_modules'
])

function estDossierJetable(cheminCanonique: string): boolean {
  return cheminCanonique.split('\\').some((segment) => {
    const bas = segment.toLowerCase()
    return (bas.startsWith('.') && bas.length > 1) || SEGMENTS_JETABLES.has(bas)
  })
}

/** Injectable pour tester sans toucher le disque ni dépendre du poste. */
export interface LectureProfilClaudeDeps {
  /** Bases candidates où chercher `.claude.json`, dans l'ordre. */
  candidats?: readonly (string | undefined)[]
  existe?: (chemin: string) => boolean
  lire?: (chemin: string) => string
}

/**
 * Lit le profil claude.exe RÉEL et rend les dossiers de projets filtrés.
 *
 * Plusieurs bases sont sondées parce qu'elles DIVERGENT sur ce poste (mesuré le 2026-09-23) :
 * `HOME` pointe sur `Z:\` (sans profil) alors que le CLI écrit sous `USERPROFILE`
 * (`os.homedir()` sur Windows). Aucun chemin utilisateur en dur : uniquement l'environnement.
 * La PREMIÈRE base qui porte un `.claude.json` gagne — c'est celle que le CLI utilise.
 */
export function lireDossiersProjetsClaude(deps: LectureProfilClaudeDeps = {}): string[] {
  const candidats = deps.candidats ?? [process.env.USERPROFILE, homedir(), process.env.HOME]
  const existe = deps.existe ?? existsSync
  const lire = deps.lire ?? ((chemin: string): string => readFileSync(chemin, 'utf8'))
  const vus = new Set<string>()
  for (const base of candidats) {
    const propre = base?.trim()
    if (!propre) continue
    if (vus.has(propre.toLowerCase())) continue // USERPROFILE et homedir() sont souvent le même
    vus.add(propre.toLowerCase())
    try {
      const profil = join(propre, '.claude.json')
      if (!existe(profil)) continue
      return extraireDossiersProjetsClaude(lire(profil), propre)
    } catch {
      continue // base illisible (lecteur réseau débranché…) : la suivante peut encore répondre
    }
  }
  return []
}
