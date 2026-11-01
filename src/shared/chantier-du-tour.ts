/**
 * CHANTIER DU TOUR — le format de ligne partagé entre le processus principal qui l'ÉCRIT
 * (`main/providers/claude-workflow.ts`, à chaque avancée d'un outil Workflow du CLI) et le fil qui le
 * RELIT pour dessiner la carte du chantier (conv-1362, lot conv-1366 : « une carte vivante dans le
 * fil, avec les phases, le nombre d'agents en cours, finis et en échec, et les jetons »).
 *
 * Même transport que les étapes du tour (`etapes-du-tour.ts`) : une ligne de statut, le seul canal
 * qui va jusqu'au fil ET survit au rechargement (`actionsLog`). Mais là où une étape change seule, un
 * chantier a des dizaines d'agents : chaque ligne porte donc un INSTANTANÉ, et le dernier gagne. Le
 * début se lit tel quel là où un statut brut s'affiche, la fin est le JSON que le fil relit.
 */
export type StatutChantier = 'en-cours' | 'fini' | 'echec' | 'arrete'

export type PhaseDeChantier = {
  /** Vide : agents hors de toute phase, ou phases regroupées faute de place dans la ligne. */
  titre: string
  enAttente: number
  enCours: number
  finis: number
  echecs: number
}

export type Chantier = {
  id: string
  nom: string
  statut: StatutChantier
  phases: PhaseDeChantier[]
  enAttente: number
  enCours: number
  finis: number
  echecs: number
  jetons: number
  /** Plus de 25 agents ou plus de 1,5 million de jetons (seuils du CLI, documentés). */
  gros: boolean
  /** Le quota a refusé pendant ce chantier : en `-p`, ses agents échouent au lieu d'attendre. */
  quota: boolean
}

/** Longueur maximale d'une ligne du journal (`ACTIONS_LINE_MAX`, shared/chat-turn.ts). */
const LIGNE_MAX = 4_000
const NOM_MAX = 120
/** Au-delà, les phases suivantes sont regroupées : la ligne a une taille bornée, pas le script. */
const PHASES_MAX = 24
/** Titres de plus en plus courts tant que l'instantané ne tient pas dans une ligne. */
const TITRE_MAX = [80, 40, 16, 0]

const SEPARATEUR = ' ¦ '
const LIGNE = /^Chantier (\S+) · .* ¦ (\{.*\})$/

const STATUTS: readonly StatutChantier[] = ['en-cours', 'fini', 'echec', 'arrete']

function couper(texte: string, max: number): string {
  const propre = texte.replace(/\s+/g, ' ').trim()
  return propre.length > max ? `${propre.slice(0, Math.max(0, max - 1))}…` : propre
}

/** Les phases en trop deviennent une seule phase sans titre : les comptes restent justes. */
function phasesBornees(phases: readonly PhaseDeChantier[]): PhaseDeChantier[] {
  if (phases.length <= PHASES_MAX) return [...phases]
  const reste = phases.slice(PHASES_MAX)
  const groupe: PhaseDeChantier = { titre: '', enAttente: 0, enCours: 0, finis: 0, echecs: 0 }
  for (const p of reste) {
    groupe.enAttente += p.enAttente
    groupe.enCours += p.enCours
    groupe.finis += p.finis
    groupe.echecs += p.echecs
  }
  return [...phases.slice(0, PHASES_MAX), groupe]
}

export function ligneDeChantier(chantier: Chantier): string {
  const { id, enCours, finis, echecs, jetons } = chantier
  const tete = `Chantier ${id} · ${enCours} en cours · ${finis} finis · ${echecs} en échec · ${jetons} jetons`
  const phases = phasesBornees(chantier.phases)
  const nom = couper(chantier.nom, NOM_MAX)
  for (const max of TITRE_MAX) {
    const corps = {
      ...chantier,
      nom,
      phases: phases.map((p) => ({ ...p, titre: couper(p.titre, max) }))
    }
    const ligne = `${tete}${SEPARATEUR}${JSON.stringify(corps)}`
    if (ligne.length <= LIGNE_MAX) return ligne
  }
  return `${tete}${SEPARATEUR}${JSON.stringify({ ...chantier, nom, phases: [] })}`
}

function nombre(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function phaseValide(v: unknown): v is PhaseDeChantier {
  const p = v as PhaseDeChantier | null
  return (
    typeof p?.titre === 'string' &&
    nombre(p.enAttente) &&
    nombre(p.enCours) &&
    nombre(p.finis) &&
    nombre(p.echecs)
  )
}

export function estLigneDeChantier(ligne: string): boolean {
  return LIGNE.test(ligne)
}

/** L'instantané porté par une ligne ; `null` pour toute autre ligne, ou une ligne abîmée. */
export function lireLigneDeChantier(ligne: string): Chantier | null {
  const m = LIGNE.exec(ligne)
  if (!m) return null
  let brut: Partial<Chantier>
  try {
    brut = JSON.parse(m[2]!) as Partial<Chantier>
  } catch {
    return null
  }
  const valide =
    typeof brut.id === 'string' &&
    typeof brut.nom === 'string' &&
    STATUTS.includes(brut.statut as StatutChantier) &&
    Array.isArray(brut.phases) &&
    brut.phases.every(phaseValide) &&
    nombre(brut.enAttente) &&
    nombre(brut.enCours) &&
    nombre(brut.finis) &&
    nombre(brut.echecs) &&
    nombre(brut.jetons) &&
    typeof brut.gros === 'boolean' &&
    typeof brut.quota === 'boolean'
  return valide ? (brut as Chantier) : null
}

/** Le dernier état de chaque chantier, à sa place de première apparition. */
export function chantiersDuJournal(lignes: readonly string[] | undefined): Chantier[] {
  const parId = new Map<string, Chantier>()
  for (const ligne of lignes ?? []) {
    const chantier = lireLigneDeChantier(ligne)
    if (chantier) parId.set(chantier.id, chantier)
  }
  return [...parId.values()]
}
