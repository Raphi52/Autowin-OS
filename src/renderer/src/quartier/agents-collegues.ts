/**
 * LES AGENTS DES COLLÈGUES DANS LE QUARTIER (plan « Village commun », conv-1429, lot 4).
 *
 * Cadrage tranché dans `grill/agent-hq-japon-town.md` :
 *  - D-8 : les agents des collègues s'affichent comme les miens — mêmes lieux selon le métier et la phase ;
 *  - D-10 : un seul quartier commun, une couleur par personne ;
 *  - D8 : un bouton « Mes agents / Toute l'équipe » les masque quand il y a foule ;
 *  - D9 : foulard à la couleur de la personne, prénom au survol ; sa question ou son plantage restent
 *    discrets, car l'or veut dire « t'attend » et ce n'est pas moi qu'il attend ;
 *  - D10 : un clic montre sa carte, jamais l'ouverture d'un fil (le fil vit sur un autre poste).
 *
 * La relecture du partage est faite par le processus principal (`quartier-presence-collegues.ts`,
 * `window.api.presenceDesCollegues()`). Ce qui en revient reste une DONNÉE venue d'un autre poste :
 * elle est revalidée ici, bornée, et ne sert qu'à du texte et à des positions.
 *
 * Comme `agents-quartier.ts`, la partie décisive est faite de fonctions pures ; la scène lit la liste à
 * chaque image.
 */
import { autowinStorageKey } from '../storage-keys'
import {
  animalLisible,
  METIERS_PRESENCE,
  PHASES_PRESENCE,
  PRESENCE_TITRE_MAX,
  postesLisibles,
  type AnimalAgent,
  type PresencesDesCollegues
} from '../../../shared/quartier-presence'
import { consigneDe, type AgentQuartier, type PhaseAgent } from './agents-quartier'
import type { Consigne } from './quartier-marche'
import type { Metier } from './quartier-metiers'

/** Au plus 15 agents de collègues sur scène : le pic mesuré d'un poste, la Falaise n'en tient pas plus. */
export const COLLEGUES_AGENTS_MAX = 15
/** Le partage se relit toutes les 5 s tant que l'Accueil est affiché : assez pour suivre un tour. */
export const RELECTURE_COLLEGUES_MS = 5_000
/** Un identifiant de fil ou un nom de poste plus long n'est pas un nom : c'est un fichier piégé. */
const TEXTE_COURT_MAX = 64
const PRENOM_MAX = 40

/**
 * La couleur d'une personne : son foulard. Huit teintes fixes, loin de l'orange du kimono (le foulard
 * disparaîtrait dessus), du bleu marine de mes propres tanukis, de l'or (« t'attend ») et du rouge
 * (« planté »). Peintes sur le décor, elles ne suivent pas le thème de l'app.
 */
export const PALETTE_COLLEGUES = [
  '#22a884', // couleur-fixe: foulard d'un collègue peint sur le décor (jade)
  '#7d5bd6', // couleur-fixe: foulard d'un collègue peint sur le décor (violet)
  '#3a9be0', // couleur-fixe: foulard d'un collègue peint sur le décor (ciel)
  '#5aae3a', // couleur-fixe: foulard d'un collègue peint sur le décor (prairie)
  '#14b3c4', // couleur-fixe: foulard d'un collègue peint sur le décor (turquoise)
  '#b44fc8', // couleur-fixe: foulard d'un collègue peint sur le décor (orchidée)
  '#e0588f', // couleur-fixe: foulard d'un collègue peint sur le décor (framboise)
  '#a6cc3a' // couleur-fixe: foulard d'un collègue peint sur le décor (anis)
] as const

/**
 * L'animal d'un collègue qui n'en a pas choisi (plan « Renard des collègues », conv-1446) : son poste
 * le tire dans cette liste. Depuis conv-1537, chacun choisit le sien dans les réglages de l'Accueil
 * (`ANIMAUX_AGENTS`) ; ce tirage ne sert plus qu'aux fichiers des versions d'avant le réglage.
 */
export const ANIMAUX_COLLEGUES = ['renard'] as const
export type AnimalCollegue = (typeof ANIMAUX_COLLEGUES)[number]

/** Ce qu'un agent de collègue porte en plus des miens. */
export interface InfosCollegue {
  /** Le sous-dossier du poste (compte Windows) : il fixe la couleur, et l'animal faute de choix. */
  poste: string
  /** Le premier mot du nom choisi, affiché au survol (D9). */
  prenom: string
  couleur: string
  /**
   * L'atlas dont la scène le dessine : celui que le collègue a choisi (conv-1537), sinon celui tiré de
   * son poste. Le foulard à sa couleur le distingue d'un autre du même animal.
   */
  animal: AnimalAgent
  /** L'identifiant du fil sur SON poste : il ne s'ouvre jamais ici (D10). */
  idFil: string
}

export interface AgentCollegue extends AgentQuartier {
  collegue: InfosCollegue
}

/** FNV-1a sur 32 bits : la même personne garde la même couleur, sur tous les postes, à chaque lecture. */
function empreinte(texte: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** La couleur stable d'un poste. La casse ne compte pas : Windows ne la distingue pas non plus. */
export function couleurDuPoste(poste: string): string {
  return PALETTE_COLLEGUES[empreinte(poste.trim().toLowerCase()) % PALETTE_COLLEGUES.length]
}

/**
 * L'animal stable d'un poste : la même empreinte que la couleur, mais ses chiffres au-delà de ceux de la
 * couleur. Pris sur les mêmes chiffres, avec huit teintes et deux animaux, la teinte fixerait l'animal :
 * deux renards ne pourraient porter que la moitié des foulards.
 */
export function animalDuPoste(poste: string): AnimalCollegue {
  const h = empreinte(poste.trim().toLowerCase())
  return ANIMAUX_COLLEGUES[Math.floor(h / PALETTE_COLLEGUES.length) % ANIMAUX_COLLEGUES.length]
}

/**
 * L'animal dont la scène dessine un agent de collègue ; `null` pour les miens, dessinés avec l'animal
 * choisi dans MES réglages (`mon-animal.ts`), lu à chaque image.
 */
export function animalDeLAgent(a: AgentQuartier | AgentCollegue): AnimalAgent | null {
  return 'collegue' in a ? a.collegue.animal : null
}

const PREFIXE = 'collegue:'

/**
 * L'identifiant d'un agent de collègue dans MA scène : préfixé par son poste. Deux collègues ont tous
 * deux un `conv-12`, et le mien aussi : sans préfixe, trois fils se partageraient un même tanuki.
 */
export function idCollegue(poste: string, idFil: string): string {
  return `${PREFIXE}${poste}:${idFil}`
}

export function estIdCollegue(id: string): boolean {
  return id.startsWith(PREFIXE)
}

// eslint-disable-next-line no-control-regex
const INVISIBLES = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g

/** Un texte affichable : chaîne, sans caractère invisible, coupé à `max` ; sinon `null`. */
function texte(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(INVISIBLES, '').trim()
  if (!t) return null
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Un identifiant : trop long, ce n'est pas un nom à raccourcir, c'est un fichier piégé (comme le lot 2). */
function identifiant(v: unknown): string | null {
  const t = texte(v, Number.MAX_SAFE_INTEGER)
  return t && t.length <= TEXTE_COURT_MAX ? t : null
}

const ORDRE: Readonly<Record<PhaseAgent, number>> = {
  travail: 0,
  reflexion: 1,
  attente: 2,
  plante: 3,
  fini: 4
}

/**
 * Les agents des collègues, prêts pour la scène : revalidés champ par champ, au plus
 * `COLLEGUES_AGENTS_MAX`. Chacun son tour : un collègue qui a quinze fils ouverts ne prend pas toute la
 * place, on prend le premier agent de chacun, puis le deuxième, etc. — ceux qui travaillent d'abord.
 */
export function agentsDesCollegues(
  presences: PresencesDesCollegues | null | undefined,
  maintenant: number
): AgentCollegue[] {
  const parPersonne: AgentCollegue[][] = []
  const vus = new Set<string>()
  const collegues = Array.isArray(presences?.collegues) ? presences.collegues : []
  for (const c of collegues) {
    const poste = identifiant(c?.poste)
    if (!poste || vus.has(`poste:${poste.toLowerCase()}`)) continue
    vus.add(`poste:${poste.toLowerCase()}`)
    const prenom = texte(c.prenom, PRENOM_MAX) ?? texte(c.nom, PRENOM_MAX) ?? poste
    const couleur = couleurDuPoste(poste)
    // Son choix d'abord (conv-1537) ; un fichier d'une version d'avant le réglage n'en porte pas.
    const animal = animalLisible(c.animal) ?? animalDuPoste(poste)
    const siens: AgentCollegue[] = []
    for (const a of Array.isArray(c.agents) ? c.agents : []) {
      const idFil = identifiant(a?.id)
      const phase = (PHASES_PRESENCE as readonly unknown[]).includes(a?.phase)
        ? (a.phase as PhaseAgent)
        : null
      if (!idFil || !phase) continue
      const id = idCollegue(poste, idFil)
      if (vus.has(id)) continue
      vus.add(id)
      const metier = (METIERS_PRESENCE as readonly unknown[]).includes(a.metier)
        ? (a.metier as Metier)
        : null
      const lu = typeof a.depuis === 'string' ? Date.parse(a.depuis) : NaN
      // Une date à venir (horloge d'un autre poste) ne doit pas donner un « depuis » négatif.
      const depuis = Number.isFinite(lu) ? Math.min(lu, maintenant) : maintenant
      siens.push({
        id,
        titre: texte(a.titre, PRESENCE_TITRE_MAX) ?? '',
        phase,
        metier,
        actions: [],
        depuis,
        collegue: { poste, prenom, couleur, animal, idFil }
      })
    }
    siens.sort((x, y) => ORDRE[x.phase] - ORDRE[y.phase] || x.depuis - y.depuis)
    if (siens.length) parPersonne.push(siens)
  }
  const retenus: AgentCollegue[] = []
  for (let rang = 0; retenus.length < COLLEGUES_AGENTS_MAX; rang++) {
    let reste = false
    for (const siens of parPersonne) {
      if (rang >= siens.length) continue
      reste = true
      if (retenus.length < COLLEGUES_AGENTS_MAX) retenus.push(siens[rang])
    }
    if (!reste) break
  }
  return retenus
}

/**
 * Ce que la marche doit faire du tanuki d'un collègue : les mêmes lieux que les miens (D-8), sauf
 * l'attente. Le geste « t'attend » brandit une pancarte dorée : chez un collègue, il attend son humain,
 * pas moi (D9). Il s'assied donc là où il est, sans signal. Le plantage garde sa posture affaissée, mais
 * la scène ne lui met ni lueur rouge ni étiquette.
 */
export function consigneDuCollegue(a: AgentQuartier, maintenant: number): Consigne {
  if (a.phase === 'attente') return { metier: null, pose: 'as', partir: false }
  return consigneDe(a, maintenant)
}

/* ---------------------------------------------------------------- *
 * Le bouton « Mes agents / Toute l'équipe » (D8).
 * ---------------------------------------------------------------- */

export type ModeVillage = 'equipe' | 'moi'
export const CLE_MODE_VILLAGE = autowinStorageKey('home.quartier.village.v1')

/** Le mode retenu ; tout autre contenu (absent, abîmé) vaut « Toute l'équipe », le défaut décidé. */
export function modeLu(brut: string | null): ModeVillage {
  return brut === 'moi' ? 'moi' : 'equipe'
}

/** « Mes agents » masque tous les agents des collègues ; « Toute l'équipe » les garde tous. */
export function selonLeMode(
  mode: ModeVillage,
  agents: readonly AgentCollegue[]
): readonly AgentCollegue[] {
  return mode === 'moi' ? [] : agents
}

/* ---------------------------------------------------------------- *
 * « Afficher les agents de » : une personne à la fois (conv-1599).
 * ---------------------------------------------------------------- */

/**
 * Demande de l'utilisateur du 2026-11-05 : dans les réglages de l'Accueil, une liste de personnes à
 * cocher pour afficher ou non leurs agents. C'est un choix de CE poste seul (rangé dans le navigateur
 * de l'app) : il ne change rien à ce que les autres voient. Le bouton « Mes agents / Toute l'équipe »
 * reste au-dessus : « Mes agents » masque tout le monde, quelles que soient les cases.
 */
export const CLE_MASQUES_LOCAUX = autowinStorageKey('home.quartier.agents-de.v1')
/** Au plus 100 personnes listées : le nombre de sous-dossiers que relit le processus principal. */
const PERSONNES_MAX = 100

/** Une personne du partage, telle que les réglages la listent. */
export interface PersonneDuVillage {
  /** Le sous-dossier de son poste, tel quel ; la casse ne compte pas pour les choix. */
  poste: string
  prenom: string
  /** Son foulard : la même couleur que ses agents sur la scène. */
  couleur: string
  /** Ses agents peuvent apparaître ici maintenant (fichier récent, partage ouvert, pas masqués pour moi). */
  enLigne: boolean
}

/**
 * Les personnes du partage, revalidées, sans doublon, rangées par prénom. Un processus principal
 * d'avant le réglage ne rend pas `personnes` : on retombe sur les collègues en ligne.
 */
export function personnesDuVillage(
  presences: PresencesDesCollegues | null | undefined
): PersonneDuVillage[] {
  const source: readonly unknown[] = Array.isArray(presences?.personnes)
    ? presences.personnes
    : Array.isArray(presences?.collegues)
      ? presences.collegues.map((c) => ({ ...c, enLigne: true }))
      : []
  const vus = new Set<string>()
  const sortie: PersonneDuVillage[] = []
  for (const brut of source) {
    if (sortie.length >= PERSONNES_MAX) break
    const p = brut as { poste?: unknown; prenom?: unknown; nom?: unknown; enLigne?: unknown }
    const poste = identifiant(p?.poste)
    if (!poste || vus.has(poste.toLowerCase())) continue
    vus.add(poste.toLowerCase())
    sortie.push({
      poste,
      prenom: texte(p.prenom, PRENOM_MAX) ?? texte(p.nom, PRENOM_MAX) ?? poste,
      couleur: couleurDuPoste(poste),
      enLigne: p.enLigne === true
    })
  }
  return sortie.sort((x, y) => x.prenom.localeCompare(y.prenom) || x.poste.localeCompare(y.poste))
}

/** Les postes masqués sur CE poste ; un contenu abîmé ne masque personne. */
export function masquesLocauxLus(brut: string | null): string[] {
  if (!brut) return []
  try {
    return postesLisibles(JSON.parse(brut))
  } catch {
    return []
  }
}

/** Retire les agents des personnes décochées (comparées sans la casse, comme Windows). */
export function sansLesPersonnesMasquees(
  masques: readonly string[],
  agents: readonly AgentCollegue[]
): readonly AgentCollegue[] {
  if (!masques.length) return agents
  return agents.filter((a) => !masques.includes(a.collegue.poste.toLowerCase()))
}

/* ---------------------------------------------------------------- *
 * Le registre vivant.
 * ---------------------------------------------------------------- */

interface ApiCollegues {
  presenceDesCollegues?: () => Promise<PresencesDesCollegues>
}

const RIEN: readonly AgentCollegue[] = []
let tous: readonly AgentCollegue[] = RIEN
let visibles: readonly AgentCollegue[] = RIEN
let mode: ModeVillage | null = null
let empreinteListe = ''
const abonnes = new Set<() => void>()
const abonnesMode = new Set<() => void>()
const AUCUNE_PERSONNE: readonly PersonneDuVillage[] = []
let personnes: readonly PersonneDuVillage[] = AUCUNE_PERSONNE
let empreintePersonnes = ''
const abonnesPersonnes = new Set<() => void>()
const AUCUN_MASQUE: readonly string[] = []
let masquesLocaux: readonly string[] | null = null
const abonnesMasques = new Set<() => void>()
let suivis = 0
let minuterie: ReturnType<typeof setInterval> | null = null
let lectureEnCours = false

const api = (): ApiCollegues | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { api?: ApiCollegues }).api

function annoncer(): void {
  visibles = sansLesPersonnesMasquees(lireMasquesLocaux(), selonLeMode(lireModeVillage(), tous))
  for (const abonne of abonnes) abonne()
}

/** Les postes décochés dans « afficher les agents de » : la MÊME référence tant que rien ne change. */
export function lireMasquesLocaux(): readonly string[] {
  if (masquesLocaux) return masquesLocaux
  try {
    const lus = masquesLocauxLus(
      typeof window === 'undefined' ? null : window.localStorage.getItem(CLE_MASQUES_LOCAUX)
    )
    masquesLocaux = lus.length ? lus : AUCUN_MASQUE
  } catch {
    masquesLocaux = AUCUN_MASQUE
  }
  return masquesLocaux
}

/** Coche (`true`) ou décoche une personne : ses agents apparaissent ou disparaissent aussitôt. */
export function afficherLesAgentsDe(poste: string, afficher: boolean): void {
  const cle = poste.trim().toLowerCase()
  const avant = lireMasquesLocaux()
  if (!cle || avant.includes(cle) === !afficher) return
  const apres = afficher ? avant.filter((p) => p !== cle) : postesLisibles([...avant, cle])
  masquesLocaux = apres.length ? apres : AUCUN_MASQUE
  try {
    window.localStorage.setItem(CLE_MASQUES_LOCAUX, JSON.stringify(masquesLocaux))
  } catch {
    // Sans enregistrement, le choix vit le temps de la session : rien ne casse.
  }
  for (const abonne of abonnesMasques) abonne()
  annoncer()
}

export function abonnerMasquesLocaux(rappel: () => void): () => void {
  abonnesMasques.add(rappel)
  return () => abonnesMasques.delete(rappel)
}

/** Les personnes du partage, pour les réglages : la MÊME référence tant que rien ne bouge. */
export function lirePersonnesDuVillage(): readonly PersonneDuVillage[] {
  return personnes
}

export function abonnerPersonnesDuVillage(rappel: () => void): () => void {
  abonnesPersonnes.add(rappel)
  return () => abonnesPersonnes.delete(rappel)
}

/** Pose la liste des personnes : seulement si elle a changé. */
export function poserPersonnesDuVillage(liste: readonly PersonneDuVillage[]): void {
  const e = JSON.stringify(liste)
  if (e === empreintePersonnes) return
  empreintePersonnes = e
  personnes = liste.length ? liste : AUCUNE_PERSONNE
  for (const abonne of abonnesPersonnes) abonne()
}

export function lireModeVillage(): ModeVillage {
  if (mode) return mode
  try {
    mode = modeLu(
      typeof window === 'undefined' ? null : window.localStorage.getItem(CLE_MODE_VILLAGE)
    )
  } catch {
    mode = 'equipe'
  }
  return mode
}

export function choisirModeVillage(suivant: ModeVillage): void {
  if (suivant === lireModeVillage()) return
  mode = suivant
  try {
    window.localStorage.setItem(CLE_MODE_VILLAGE, suivant)
  } catch {
    // Sans enregistrement, le choix vit le temps de la session : rien ne casse.
  }
  for (const abonne of abonnesMode) abonne()
  annoncer()
}

export function abonnerModeVillage(rappel: () => void): () => void {
  abonnesMode.add(rappel)
  return () => abonnesMode.delete(rappel)
}

/** Les agents des collègues à montrer, selon le mode : la MÊME référence tant que rien ne bouge. */
export function lireAgentsCollegues(): readonly AgentCollegue[] {
  return visibles
}

export function abonnerAgentsCollegues(rappel: () => void): () => void {
  abonnes.add(rappel)
  return () => abonnes.delete(rappel)
}

/** L'agent de collègue de cet identifiant de scène, s'il est affiché. */
export function agentCollegue(id: string): AgentCollegue | null {
  if (!estIdCollegue(id)) return null
  return visibles.find((a) => a.id === id) ?? null
}

/** Pose la liste : seulement si elle a changé, la scène et le survol ne se recalculent pas pour rien. */
export function poserAgentsCollegues(liste: readonly AgentCollegue[]): void {
  const e = JSON.stringify(liste)
  if (e === empreinteListe) return
  empreinteListe = e
  tous = liste.length ? liste : RIEN
  annoncer()
}

async function relire(): Promise<void> {
  const lire = api()?.presenceDesCollegues
  if (!lire || lectureEnCours) return
  lectureEnCours = true
  try {
    const presences = await lire()
    poserAgentsCollegues(agentsDesCollegues(presences, Date.now()))
    poserPersonnesDuVillage(personnesDuVillage(presences))
  } catch {
    // Partage injoignable : la scène garde ce qu'elle montrait, la prochaine lecture la recalera.
  } finally {
    lectureEnCours = false
  }
}

/**
 * Relit le partage toutes les `RELECTURE_COLLEGUES_MS` tant qu'au moins un appelant le demande : l'Accueil
 * affiché sur le Quartier. Rend la fonction qui arrête ce suivi.
 */
export function suivreAgentsCollegues(): () => void {
  suivis++
  if (suivis === 1) {
    void relire()
    minuterie = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void relire()
    }, RELECTURE_COLLEGUES_MS)
  }
  let arrete = false
  return () => {
    if (arrete) return
    arrete = true
    suivis--
    if (suivis === 0 && minuterie !== null) {
      clearInterval(minuterie)
      minuterie = null
    }
  }
}

/** Pour les tests : oublie la liste, le mode, les personnes et les cases lus. */
export function oublierAgentsCollegues(): void {
  tous = RIEN
  visibles = RIEN
  mode = null
  empreinteListe = ''
  personnes = AUCUNE_PERSONNE
  empreintePersonnes = ''
  masquesLocaux = null
}
