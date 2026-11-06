/**
 * LA RELECTURE DE LA PRÉSENCE DES COLLÈGUES (plan « Village commun », lot 2).
 *
 * Demande : voir dans l'Accueil les tanukis des collègues à côté des siens (D-8, D-10 de
 * `grill/agent-hq-japon-town.md`). Chaque poste écrit `<dossier du Board>\<compte>\presence.json`
 * (`quartier-presence.ts`, lot 1) ; ce module relit ceux des AUTRES sous-dossiers.
 *
 * Même modèle que `board-collegues.ts` : le fichier vient d'un partage d'équipe, c'est une DONNÉE.
 * Tout est contrôlé champ par champ (format, type, longueur, liste connue) ; ce qui ne passe pas est
 * écarté ; rien n'y est exécuté, et la vue n'en fait que du texte. Le poste d'un collègue est le nom
 * de SON sous-dossier, jamais la valeur écrite dans le fichier : un fichier ne peut pas se faire
 * passer pour un autre (sa couleur en dépend, D-10).
 *
 * Un partage réseau peut être lent ou injoignable (hors VPN) : deux relectures sont espacées d'au
 * moins `PRESENCE_DELAI_RELECTURE_MS`, jamais deux à la fois, un fichier inchangé (même date, même
 * taille) n'est pas relu, et un partage injoignable rend une liste vide avec l'erreur — jamais une
 * exception.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FICHIER_PRESENCE,
  FORMAT_PRESENCE,
  METIERS_PRESENCE,
  PHASES_PRESENCE,
  PRESENCE_AGENTS_MAX,
  PRESENCE_COLLEGUES_MAX,
  PRESENCE_DELAI_RELECTURE_MS,
  PRESENCE_PERIMEE_MS,
  PRESENCE_TAILLE_MAX,
  PRESENCE_TITRE_MAX,
  animalLisible,
  postesLisibles,
  tenueLisible,
  type AgentPublie,
  type AnimalAgent,
  type PersonneDuPartage,
  type PhasePresence,
  type PresenceDUnCollegue,
  type PresencesDesCollegues,
  type TenueAgent
} from '../../shared/quartier-presence'

/** Au plus 100 sous-dossiers parcourus : un partage encombré ne transforme pas la relecture en scan. */
const SOUS_DOSSIERS_MAX = 100
const NOM_MAX = 80
const ID_MAX = 80

/** Ce qu'un fichier lu devient, avant le contrôle de fraîcheur (refait à chaque relecture). */
type FichierLu =
  | {
      kind: 'presence'
      nom: string
      enregistreA: number
      coupe: boolean
      /** L'animal choisi par le collègue ; `null` = absent ou inconnu. */
      animal: AnimalAgent | null
      /** La couleur de tenue qu'il a choisie ; `null` = absente ou inconnue (d'origine). */
      tenue: TenueAgent | null
      /** Les postes à qui il masque ses agents, en minuscules ; vide = visibles pour tous. */
      masquesPour: string[]
      agents: AgentPublie[]
    }
  | { kind: 'illisible'; motif: string }

const objet = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * Les caractères qui ne s'affichent pas mais changent l'affichage : contrôles C0 et C1, espaces de
 * largeur nulle, et marques de sens d'écriture (un `\u202e` retourne la suite du titre à l'écran).
 */
// eslint-disable-next-line no-control-regex
const INVISIBLES = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g

/** Une chaîne sans caractère de contrôle ni invisible, ou `null` si ce n'est pas une chaîne. */
function propre(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return v.replace(INVISIBLES, '').trim()
}

/** Une chaîne bornée : coupée à `max` caractères (ellipse comprise). */
function borne(v: unknown, max: number): string | null {
  const t = propre(v)
  if (t === null) return null
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function dateIso(v: unknown): number | null {
  if (typeof v !== 'string' || v.length > 40) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

function phase(v: unknown): PhasePresence | null {
  return typeof v === 'string' && (PHASES_PRESENCE as readonly string[]).includes(v)
    ? (v as PhasePresence)
    : null
}

function agentLu(v: unknown): AgentPublie | null {
  const o = objet(v)
  if (!o) return null
  const id = propre(o.id)
  // Un identifiant trop long n'est pas un raccourcissement à faire : c'est un fichier piégé.
  if (!id || id.length > ID_MAX) return null
  const p = phase(o.phase)
  const depuis = dateIso(o.depuis)
  if (!p || depuis === null) return null
  // Un titre d'un autre type que texte : l'agent reste, sans titre (comme un fil privé, D6).
  const titre = o.titre === undefined ? undefined : borne(o.titre, PRESENCE_TITRE_MAX)
  const metier =
    typeof o.metier === 'string' && (METIERS_PRESENCE as readonly string[]).includes(o.metier)
      ? o.metier
      : null
  return {
    id,
    ...(titre ? { titre } : {}),
    phase: p,
    metier,
    depuis: new Date(depuis).toISOString()
  }
}

/**
 * Le contenu d'un `presence.json` de collègue, validé champ par champ. Exporté pour les tests : la
 * relecture le refait seulement quand la date ou la taille du fichier changent.
 */
export function presenceLue(contenu: string): FichierLu {
  let brut: unknown
  try {
    brut = JSON.parse(contenu)
  } catch {
    return { kind: 'illisible', motif: 'JSON invalide' }
  }
  const o = objet(brut)
  if (!o || o.format !== FORMAT_PRESENCE) return { kind: 'illisible', motif: 'format inconnu' }
  const nom = borne(o.nom, NOM_MAX)
  const enregistreA = dateIso(o.enregistreA)
  if (!nom || typeof o.poste !== 'string' || enregistreA === null || !Array.isArray(o.agents))
    return { kind: 'illisible', motif: 'champ manquant ou de mauvais type' }
  const agents = o.agents
    .slice(0, PRESENCE_AGENTS_MAX)
    .map(agentLu)
    .filter((a): a is AgentPublie => a !== null)
  // Un animal inconnu (version plus récente, fichier modifié) n'écarte pas le collègue : il garde
  // l'animal tiré de son poste, comme un fichier d'avant le réglage.
  return {
    kind: 'presence',
    nom,
    enregistreA,
    coupe: o.coupe === true,
    animal: animalLisible(o.animal),
    // Une couleur inconnue (version plus récente) laisse la tenue d'origine, sans écarter le collègue.
    tenue: tenueLisible(o.tenue),
    // Une liste abîmée ne masque rien de plus : seuls les noms lisibles comptent.
    masquesPour: postesLisibles(o.masquesPour),
    agents
  }
}

/** Le premier mot du nom, affiché au survol (D9). */
export function prenomDe(nom: string): string {
  return nom.trim().split(/\s+/)[0] ?? nom
}

export interface LecteurDePresence {
  /** Les collègues présents ; relus au plus toutes les `delaiMs`, jamais deux fois à la fois. */
  lire: () => Promise<PresencesDesCollegues>
}

export function creerLecteurDePresence(deps: {
  /** Le dossier du Board et le sous-dossier de CE poste (jamais relu) ; `null` = aucun dossier. */
  ou: () => { dossier: string; poste: string } | null
  maintenant?: () => number
  delaiMs?: number
}): LecteurDePresence {
  const maintenant = deps.maintenant ?? Date.now
  const delaiMs = deps.delaiMs ?? PRESENCE_DELAI_RELECTURE_MS
  const cache = new Map<string, { mtimeMs: number; size: number; lu: FichierLu }>()
  let dernier: { dossier: string; a: number; resultat: PresencesDesCollegues } | null = null
  let enCours: Promise<PresencesDesCollegues> | null = null

  async function relire(dossier: string, poste: string): Promise<PresencesDesCollegues> {
    const moi = poste.toLowerCase()
    let entrees
    try {
      entrees = await readdir(dossier, { withFileTypes: true })
    } catch (e) {
      return {
        collegues: [],
        erreur: `Dossier du Board injoignable : ${e instanceof Error ? e.message : String(e)}`
      }
    }
    const postes = entrees
      .filter((e) => e.isDirectory() && e.name.toLowerCase() !== moi)
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, SOUS_DOSSIERS_MAX)
    const collegues: PresenceDUnCollegue[] = []
    // Tout le partage, en ligne ou non : les réglages de l'Accueil doivent pouvoir nommer
    // quelqu'un d'éteint, pour lui masquer mes agents avant qu'il revienne. D'où la boucle qui va au
    // bout des `SOUS_DOSSIERS_MAX`, même quand le village est plein.
    const personnes: PersonneDuPartage[] = []
    const ecartes: string[] = []
    const a = maintenant()
    for (const posteDuCollegue of postes) {
      const fichier = join(dossier, posteDuCollegue, FICHIER_PRESENCE)
      try {
        const s = await stat(fichier)
        if (!s.isFile()) continue
        if (s.size > PRESENCE_TAILLE_MAX) {
          ecartes.push(`${posteDuCollegue} (fichier trop gros)`)
          continue
        }
        const connu = cache.get(fichier)
        let lu: FichierLu
        if (connu && connu.mtimeMs === s.mtimeMs && connu.size === s.size) lu = connu.lu
        else {
          lu = presenceLue(await readFile(fichier, 'utf8'))
          cache.set(fichier, { mtimeMs: s.mtimeMs, size: s.size, lu })
        }
        if (lu.kind === 'illisible') {
          ecartes.push(`${posteDuCollegue} (${lu.motif})`)
          continue
        }
        // Périmé (poste éteint), ou daté dans le futur au-delà de la même marge (horloge folle ou
        // fichier piégé qui ne vieillirait jamais) : ignoré sans bruit, ce n'est pas une erreur.
        // Partage coupé sur ce poste (D6) : ses agents n'apparaissent pas. Masqués pour MOI par son
        // réglage « afficher mes agents à » : pareil, comme s'il avait coupé.
        const enLigne =
          Math.abs(a - lu.enregistreA) <= PRESENCE_PERIMEE_MS &&
          !lu.coupe &&
          !lu.masquesPour.includes(moi)
        personnes.push({ poste: posteDuCollegue, prenom: prenomDe(lu.nom), enLigne })
        if (!enLigne || collegues.length >= PRESENCE_COLLEGUES_MAX) continue
        collegues.push({
          poste: posteDuCollegue,
          nom: lu.nom,
          ...(lu.animal ? { animal: lu.animal } : {}),
          ...(lu.tenue ? { tenue: lu.tenue } : {}),
          prenom: prenomDe(lu.nom),
          agents: lu.agents
        })
      } catch (e) {
        // Pas de presence.json dans ce sous-dossier : poste sans le village, rien à dire.
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') continue
        ecartes.push(`${posteDuCollegue} (${e instanceof Error ? e.message : String(e)})`)
      }
    }
    return {
      collegues,
      personnes,
      ...(ecartes.length ? { erreur: `Présence écartée : ${ecartes.join(', ')}` } : {})
    }
  }

  return {
    lire() {
      let ici: { dossier: string; poste: string } | null
      try {
        ici = deps.ou()
      } catch (e) {
        return Promise.resolve({
          collegues: [],
          erreur: `Réglage du Board illisible : ${e instanceof Error ? e.message : String(e)}`
        })
      }
      if (!ici) return Promise.resolve({ collegues: [] })
      const { dossier, poste } = ici
      if (dernier && dernier.dossier === dossier && maintenant() - dernier.a < delaiMs)
        return Promise.resolve(dernier.resultat)
      if (enCours) return enCours
      enCours = relire(dossier, poste)
        .catch((e: unknown): PresencesDesCollegues => ({
          collegues: [],
          erreur: `Relecture impossible : ${e instanceof Error ? e.message : String(e)}`
        }))
        .then((resultat) => {
          dernier = { dossier, a: maintenant(), resultat }
          return resultat
        })
        .finally(() => {
          enCours = null
        })
      return enCours
    }
  }
}
