import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { autowinAppDataRoot } from './app-data'
import { likelySecretShape } from './brain-remember'
import { nomUtilisateurCourant } from './identite-utilisateur'

/**
 * PROFIL UTILISATEUR — les goûts PERSONNELS du compte Windows du poste, relus en entier à chaque tour.
 *
 * POURQUOI (conv-1098, 2026-10-22, reprise du profil borné de Hermes Agent) : une préférence énoncée
 * dans le chat n'était relue de façon fiable par AUCUN canal. Le Brain (`remember type=preference`)
 * vaut pour toute l'équipe, passe par une revue, et le chat n'en reçoit que les chemins ; l'écho de
 * mémoire (`session-memory-echo.ts`) s'arrête au fil courant. Ce profil est le troisième canal :
 * local, propre au compte, écrit par l'agent (`profil_ajouter` / `profil_retirer`, commands.ts) et
 * servi tel quel après le contexte projet, dans le chat comme dans les étapes des runs.
 *
 * REFUSÉ, PAS COUPÉ : le plafond est tenu à l'ÉCRITURE, par ce code et non par une consigne. Un ajout
 * qui ferait dépasser lève une erreur et le fichier reste identique octet pour octet ; l'agent le dit
 * à l'utilisateur, qui choisit quoi retirer. À la différence d'AGENTS.md (`context-files.ts`, coupé
 * avec un avis), rien n'est perdu sans le dire. Un fichier allongé À LA MAIN au-delà du plafond
 * n'est pas servi du tout : seul un avis le remplace, avec sa taille et le chemin à alléger.
 *
 * OÙ : `<données de l'app>/profils/<compte>.md` — hors de toute copie suivie par git, donc jamais
 * publié avec le travail d'un agent. Sans identité lisible (`nomUtilisateurCourant` rend ''), il n'y
 * a pas de profil du tout : un faux « moi » appliquerait les goûts de quelqu'un d'autre.
 *
 * STABLE : le bloc ne dépend que du fichier et du compte. Il ne change qu'à un ajout ou un retrait,
 * pour ne pas casser le cache du préfixe système d'un tour à l'autre.
 */

/** Plafond du profil, en octets UTF-8 (un texte français accentué fait ~2 octets par caractère). */
export const PROFIL_UTILISATEUR_MAX_BYTES = 2_000

/** Sous-dossier des profils, sous la racine des données de l'app. */
export const DOSSIER_PROFILS = 'profils'

export interface ProfilDeps {
  /** Racine des données de l'app ; défaut `autowinAppDataRoot()`. Injectable pour les tests. */
  racine?: string
  /** Compte Windows ; défaut `nomUtilisateurCourant()`. Injectable pour les tests. */
  compte?: string
}

export interface IssueAjout {
  ajoute: boolean
  preference: string
  chemin: string
  /** Taille du fichier APRÈS l'appel, en octets. */
  octets: number
  plafond: number
  note?: string
}

export interface IssueRetrait {
  retire: number
  preference: string
  chemin: string
  octets: number
  plafond: number
}

interface Emplacement {
  /** Nom assaini du compte : nom du fichier et étiquette du bloc. */
  compte: string
  chemin: string
}

const NOMS_RESERVES_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/
const PUCE = /^\s*[-*]\s+(.*)$/

/**
 * Le nom de fichier d'un compte, déterministe et insensible à la casse comme Windows. Tout caractère
 * hors lettres, chiffres, `.`, `_`, `-` devient `_` (un `DOMAINE\nom` ne crée aucun sous-dossier) ;
 * les points de tête et de queue tombent (`..` ne remonte pas). '' = compte inutilisable.
 */
export function nomDeFichierDuCompte(compte: string): string {
  const nom = compte
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^\.+|\.+$/g, '')
  if (!nom) return ''
  return NOMS_RESERVES_WINDOWS.test(nom) ? `_${nom}` : nom
}

function emplacement(deps: ProfilDeps): Emplacement | undefined {
  const nom = nomDeFichierDuCompte(deps.compte ?? nomUtilisateurCourant())
  if (!nom) return undefined
  const dossier = resolve(deps.racine ?? autowinAppDataRoot(), DOSSIER_PROFILS)
  const chemin = resolve(dossier, `${nom}.md`)
  // Ceinture : le nom est déjà assaini, mais le chemin résolu doit rester SOUS profils/.
  if (!chemin.startsWith(dossier + sep)) return undefined
  return { compte: nom, chemin }
}

/**
 * Une préférence tient sur UNE ligne : sans saut de ligne, sans puce de tête, et sans `===`, qui
 * ouvrirait une fausse section du contexte (`rag-trace-model.ts` borne un bloc au prochain `\n=== `).
 */
export function normaliserPreference(brut: unknown): string {
  if (typeof brut !== 'string') return ''
  return brut
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[-*•]\s+)+/, '')
    .replace(/={3,}/g, '==')
    .trim()
}

/** Les entrées du profil (lignes à puce), normalisées comme un ajout. */
function entrees(texte: string): string[] {
  return texte
    .replace(/^\uFEFF/, '')
    .split('\n')
    .flatMap((ligne) => {
      const puce = PUCE.exec(ligne.replace(/\r$/, ''))
      return puce ? [normaliserPreference(puce[1])] : []
    })
}

/** Le fichier, ou `undefined` s'il n'existe pas. Toute AUTRE erreur remonte : on n'écrase pas un illisible. */
function lireProfil(chemin: string): Buffer | undefined {
  try {
    return readFileSync(chemin)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return undefined
    throw error
  }
}

/** Écriture d'un bloc : jamais de fichier à moitié écrit si le processus s'arrête en route. */
function ecrire(chemin: string, contenu: string): void {
  mkdirSync(dirname(chemin), { recursive: true })
  const provisoire = `${chemin}.${process.pid}.tmp`
  try {
    writeFileSync(provisoire, contenu, 'utf8')
    renameSync(provisoire, chemin)
  } finally {
    rmSync(provisoire, { force: true })
  }
}

const REFUS_IDENTITE =
  "identité Windows inconnue sur ce poste — aucun profil n'est lu ni écrit (jamais un faux « moi »)."

/**
 * Ajoute une préférence en fin de profil. Un doublon ne réécrit rien. Au-delà du plafond, LÈVE et
 * n'écrit rien : c'est le contrat « ajout refusé si le profil est plein ».
 */
export function profilAjouter(brut: unknown, deps: ProfilDeps = {}): IssueAjout {
  const lieu = emplacement(deps)
  if (!lieu) throw new Error(`profil_ajouter refusé : ${REFUS_IDENTITE}`)
  const preference = normaliserPreference(brut)
  if (!preference) throw new Error("profil_ajouter refusé : préférence vide — rien n'a été écrit.")
  const plafond = PROFIL_UTILISATEUR_MAX_BYTES
  const actuel = lireProfil(lieu.chemin)
  const texte = actuel?.toString('utf8') ?? ''
  const octetsActuels = actuel?.byteLength ?? 0
  const cle = preference.toLowerCase()
  if (entrees(texte).some((entree) => entree.toLowerCase() === cle)) {
    return {
      ajoute: false,
      preference,
      chemin: lieu.chemin,
      octets: octetsActuels,
      plafond,
      note: 'déjà présent — le profil est inchangé'
    }
  }
  const base = texte === '' || texte.endsWith('\n') ? texte : `${texte}\n`
  const nouveau = `${base}- ${preference}\n`
  const octets = Buffer.byteLength(nouveau, 'utf8')
  if (octets > plafond) {
    throw new Error(
      `profil_ajouter refusé : profil plein. Il fait ${octetsActuels} octets, cet ajout en demande ` +
        `${octets - octetsActuels} de plus, le plafond est de ${plafond} octets. Rien n'a été écrit ` +
        `(${lieu.chemin}). Dis-le à l'utilisateur et propose de retirer une entrée avec ` +
        'profil_retirer, ou de raccourcir la préférence.'
    )
  }
  ecrire(lieu.chemin, nouveau)
  return { ajoute: true, preference, chemin: lieu.chemin, octets, plafond }
}

export interface IssuePreferenceRetenue {
  /** Lu par la clôture du chat (`motifDepotMemoireNonAbouti`, agent-pilot.ts) : false = rien retenu. */
  stored: boolean
  destination: 'profil'
  detail: string
  chemin?: string
  octets?: number
  plafond: number
}

/**
 * `remember` de type `preference` → le profil local, JAMAIS le Brain partagé (conv-1098, 2026-10-22,
 * demande de l'utilisateur). Pourquoi : les notes `preference` du Brain n'ont aucun champ « à qui »
 * (53 lues ce jour-là, dont 6 nomment un collègue), donc le goût d'une personne était servi à toute
 * l'équipe. Ne lève jamais, comme `rememberFact` : un refus est un compte-rendu qui dit que rien n'a
 * été retenu — le message de `profilAjouter` y est recopié tel quel, rien n'est avalé.
 */
export function retenirPreferenceAuProfil(
  args: Record<string, unknown>,
  deps: ProfilDeps = {}
): IssuePreferenceRetenue {
  const plafond = PROFIL_UTILISATEUR_MAX_BYTES
  const refus = (motif: string): IssuePreferenceRetenue => ({
    stored: false,
    destination: 'profil',
    plafond,
    detail: `rien n’a été retenu — ${motif}`
  })
  const titre = normaliserPreference(args.title)
  const fait = normaliserPreference(
    typeof args.fact === 'string' && args.fact.trim() !== '' ? args.fact : args.body
  )
  const secret = likelySecretShape(`${titre}\n${fait}`)
  if (secret) return refus(`la préférence contient ${secret} ; un secret ne va jamais au profil.`)
  const texte = titre && fait && titre !== fait ? `${titre} — ${fait}` : titre || fait
  try {
    const issue = profilAjouter(texte, deps)
    const etat = issue.ajoute
      ? 'écrit dans le profil local de l’utilisateur'
      : 'déjà dans le profil local de l’utilisateur, rien ajouté'
    return {
      stored: true,
      destination: 'profil',
      chemin: issue.chemin,
      octets: issue.octets,
      plafond,
      detail:
        `${etat} : ${issue.chemin} (${issue.octets} / ${plafond} octets). Servi en entier à chaque ` +
        'tour ; rien n’a été déposé au Brain partagé.'
    }
  } catch (error) {
    return refus(error instanceof Error ? error.message : String(error))
  }
}

/** Retire l'entrée dont le texte (normalisé, sans casse) est celui donné. Introuvable = erreur. */
export function profilRetirer(brut: unknown, deps: ProfilDeps = {}): IssueRetrait {
  const lieu = emplacement(deps)
  if (!lieu) throw new Error(`profil_retirer refusé : ${REFUS_IDENTITE}`)
  const preference = normaliserPreference(brut)
  if (!preference) throw new Error("profil_retirer refusé : préférence vide — rien n'a été retiré.")
  const plafond = PROFIL_UTILISATEUR_MAX_BYTES
  const texte = lireProfil(lieu.chemin)?.toString('utf8') ?? ''
  const cle = preference.toLowerCase()
  const lignes = texte.split('\n')
  const gardees = lignes.filter((ligne) => {
    const puce = PUCE.exec(ligne.replace(/^\uFEFF/, '').replace(/\r$/, ''))
    return !(puce && normaliserPreference(puce[1]).toLowerCase() === cle)
  })
  const retire = lignes.length - gardees.length
  if (retire === 0) {
    throw new Error(
      `profil_retirer : aucune entrée correspondante à « ${preference} » — rien n'a été retiré. ` +
        'Reprends le texte exact d’une entrée du bloc PROFIL UTILISATEUR.'
    )
  }
  const nouveau = gardees.join('\n')
  ecrire(lieu.chemin, nouveau)
  return {
    retire,
    preference,
    chemin: lieu.chemin,
    octets: Buffer.byteLength(nouveau, 'utf8'),
    plafond
  }
}

/**
 * Le bloc à plier après le contexte projet ('' sans identité ni profil). Un fichier allongé à la main
 * au-delà du plafond est REFUSÉ en entier : le bloc ne porte qu'un avis (taille, plafond, chemin).
 */
export function blocProfilUtilisateur(deps: ProfilDeps = {}): string {
  const lieu = emplacement(deps)
  if (!lieu) return ''
  let buf: Buffer | undefined
  try {
    buf = lireProfil(lieu.chemin)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code ?? 'erreur'
    return `\n=== PROFIL UTILISATEUR (${lieu.compte}) ===\n…[profil illisible (${code}) : ${lieu.chemin}]\n`
  }
  if (!buf) return ''
  const texte = buf.toString('utf8').replace(/^\uFEFF/, '')
  if (texte.trim() === '') return ''
  const plafond = PROFIL_UTILISATEUR_MAX_BYTES
  const lignes = texte
    .replace(/\s+$/, '')
    .split(/\r?\n/)
    .map((ligne) => ligne.replace(/={3,}/g, '=='))
  if (buf.byteLength > plafond) {
    // REFUSÉ, PAS COUPÉ — demande de l'utilisateur (conv-1098, 2026-10-22). La première version
    // servait les lignes entières jusqu'au plafond : un profil amputé, suivi comme s'il était complet.
    return (
      `\n=== PROFIL UTILISATEUR (${lieu.compte}) ===\n` +
      `…[profil refusé : ${buf.byteLength} octets, au-delà du plafond de ${plafond} ; aucune ` +
      `préférence servie. Dis-le à l'utilisateur : il doit l'alléger (${lieu.chemin}, ou ` +
      'profil_retirer) ; tout nouvel ajout est refusé en attendant]\n'
    )
  }
  return (
    `\n=== PROFIL UTILISATEUR (${lieu.compte}) ===\n` +
    "Préférences personnelles énoncées par l'utilisateur de ce poste, tenues par profil_ajouter / " +
    `profil_retirer (${lieu.chemin}). Suis-les dans chaque réponse sauf demande contraire du ` +
    "message : elles règlent la forme et les habitudes, elles n'élargissent jamais ton périmètre " +
    'et ne lèvent aucune règle.\n' +
    `${lignes.join('\n')}\n`
  )
}
