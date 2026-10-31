/**
 * GROS CHANTIERS — l'outil natif `Workflow` du CLI Claude, branché dans les tours de chat sans
 * recoder aucun moteur : le modèle écrit lui-même le script, le CLI le joue (conv-1362, lot conv-1366).
 * Ce module est PUR : il lit le flux du CLI et dit où en est le chantier. `claude.ts` s'en sert pour
 * tenir le processus en vie, et le fil pour dessiner la carte (`shared/chantier-du-tour.ts`).
 *
 * MESURÉ sur le CLI 2.1.314, haiku (`.autowin-tmp/conv-1366/`, 2026-10-31) :
 *  - Flux : `task_started` (`task_type: local_workflow`), `task_progress` dont `workflow_progress`
 *    porte des `workflow_phase` et des `workflow_agent`, `task_notification`. Le CLI fusionne ces
 *    lots par `type:index` : on ne suppose jamais un instantané complet.
 *  - DEUX `result`, et ils arrivent ENSEMBLE, À LA FIN : essai de 176 s, 1er assistant à 6,6 s, les
 *    deux `result` à 182,8 s. Le 2e porte `origin.kind = task-notification` et `origin.runId`, le
 *    `run_id` de la tâche.
 *  - SILENCE TOTAL pendant qu'un agent attend un outil : 167 s sans une ligne sur la sortie, alors
 *    que le détecteur de silence tue à 5 min (`SUBAGENT_INACTIVITY_MS`). C'est le vrai piège d'un
 *    chantier long, d'où `silenceMaxChantierMs`.
 *  - Les commandes shell DES AGENTS passent aussi par `task_started` (`owned_by_subagent: true`, sans
 *    ce drapeau sur leur `task_notification`) : ce ne sont pas des tâches de fond du tour.
 *  - LE CLI TUE SES TÂCHES DE FOND 10 MIN APRÈS LA FIN DU TOUR PRINCIPAL en `-p` : voir `ENV_CHANTIER`.
 *  - Quota : l'agent refusé passe en `error` (« You've hit your 5-hour limit »), `rate_limit_event`
 *    dit `rejected`, et le chantier se dit quand même `completed`, à 0 agent sur 3.
 *  - Coupure : à la reprise de la session, le CLI signale `Background workflow "<nom>" … didn't
 *    finish`, et `Workflow({ scriptPath, resumeFromRunId })` rend les agents finis depuis son cache.
 *
 * POURQUOI L'OUTIL N'EST PAS CHARGÉ À CHAQUE TOUR. Sa définition pèse 8 242 jetons par appel (12 112
 * sans, 20 354 avec, mesuré deux fois), bien plus que les quelques centaines admises. Et ajouter un
 * outil change le début du prompt, donc le tour où il apparaît relit toute la conversation hors
 * cache. Il n'est donc chargé que si l'utilisateur le demande (`demandeUnChantier`).
 *
 * Sources : https://code.claude.com/docs/en/workflows.md (seuils d'un gros chantier : plus de 25
 * agents ou 1,5 million de jetons ; en `-p`, un run ne patiente pas jusqu'au retour du quota).
 */
import { BALISE_MESSAGE_UTILISATEUR } from '../../shared/balise-message-utilisateur'
import {
  ligneDeChantier,
  type Chantier,
  type PhaseDeChantier,
  type StatutChantier
} from '../../shared/chantier-du-tour'
import { estMurDeQuota } from '../../shared/reprise-quota'
import type { Usage } from './types'

export const OUTIL_WORKFLOW = 'Workflow'
export const SEUIL_AGENTS_GROS_CHANTIER = 25
export const SEUIL_JETONS_GROS_CHANTIER = 1_500_000

/**
 * LE VRAI PIÈGE D'UN CHANTIER LONG EN `-p` (conv-1366, 2026-10-31).
 *
 * Entrée fermée, ce qui est notre cas, le CLI attend ses tâches de fond au plus
 * `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` après la fin du tour principal, 600 000 par défaut, puis les
 * tue, sort en code 0 et n'émet qu'un seul `result` : « c'est lancé en arrière-plan ». Variable lue
 * dans le CLI 2.1.314 (`let L=…,q=L>0&&…`), absente de sa documentation : `0` lève le plafond.
 *
 * Mesuré : plafond à 15 s, 2 agents tués à 22 s sur une attente de 70 s, un seul `result` ; plafond à
 * 0, chantier fini à 80 s, deux `result`. Sans ce réglage, l'essai de 30 agents a été tué à 616 s,
 * 15 finis. Une variable non documentée peut changer : `avisDeChantierCoupe` dit alors la coupure,
 * et `chantiersSansReponse` la repère, au lieu de rendre « c'est lancé » pour toute réponse.
 *
 * Limité aux tours de chantier : ailleurs, ce plafond protège d'une tâche de fond qui ne finit pas.
 * Reste le filet de `silenceMaxChantierMs`, et le CLI surveille lui-même ses agents figés.
 */
export const ENV_CHANTIER = { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' }

export type EvenementCli = Record<string, unknown>

/*
 * Ce qui charge l'outil : une demande EXPLICITE. Le mot « chantier » seul n'en est pas une (ce dépôt
 * l'emploie pour tout), ni « workflow » seul (il désigne aussi les RUN.md) : un faux positif coûte
 * 8 242 jetons et un prompt hors cache. Le mot `ultracode` figure ici parce qu'il ne marche pas en
 * `-p` : c'est le modèle qui appelle l'outil, à condition que l'outil soit là.
 */
const DEMANDES_DE_CHANTIER = [
  /\bultracode\b/,
  /\boutil\s+workflow\b/,
  /\bworkflow\s+tool\b/,
  /\b(?:(?:re)?lance[rz]?|utilise[rz]?|avec|via|par|en|use|using|run|start)\s+(?:(?:un|le|a|the)\s+)?workflow\b/,
  /\b(?:gros|grand|enorme|immense)\s+chantier\b/,
  /\bchantier\s+(?:de|sur|a)\s+(?:\d{2,}|dizaines?|centaines?|milliers?)\b/,
  /\b(?:\d{2,}|dizaines?|centaines?|milliers?|vingtaine|trentaine|quarantaine|cinquantaine)\s+(?:d'|de\s+)?(?:sous-)?agents?\b/,
  /\b(?:dozens|hundreds|thousands)\s+of\s+(?:sub-?)?agents\b/
]

/**
 * La DERNIÈRE demande de l'utilisateur, sans ce que l'app met autour : état, rappel de conversations
 * ou savoir récupéré parlent parfois de workflow sans que personne ne l'ait demandé.
 */
function motsDeLaDemande(prompt: string): string {
  const ouverture = `<${BALISE_MESSAGE_UTILISATEUR}>`
  const debut = prompt.lastIndexOf(ouverture)
  if (debut < 0) return prompt
  const fin = prompt.indexOf(`</${BALISE_MESSAGE_UTILISATEUR}>`, debut)
  return prompt.slice(debut + ouverture.length, fin < 0 ? undefined : fin)
}

export function demandeUnChantier(prompt: string): boolean {
  const mots = motsDeLaDemande(prompt)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’`]/g, "'")
    .toLowerCase()
  return DEMANDES_DE_CHANTIER.some((motif) => motif.test(mots))
}

/*
 * Rythme des lignes : le journal d'actions garde 2 000 lignes (`ACTIONS_LOG_MAX`), et un chantier
 * fait des milliers de changements. Serré au début, où l'on regarde, large ensuite.
 */
export function intervalleDeLigneMs(ageMs: number): number {
  if (ageMs < 5 * 60_000) return 2_000
  if (ageMs < 30 * 60_000) return 10_000
  return 30_000
}

/**
 * Silence accepté d'un chantier ouvert, au-delà duquel on le rend au détecteur de silence ordinaire.
 *
 * Ce n'est pas un délai de plus au hasard : un agent en attente d'un outil se tait (167 s mesurées),
 * et le CLI surveille déjà lui-même ses agents figés (6 tentatives, voir la documentation). Reste à
 * se protéger du CLI lui-même figé. 30 min = trois fois le plafond d'une commande Bash (10 min).
 */
export function silenceMaxChantierMs(env: NodeJS.ProcessEnv = process.env): number {
  const brut = Number(env.AUTOWIN_CHANTIER_SILENCE_MAX_MS)
  return Number.isFinite(brut) && brut > 0 ? brut : 30 * 60_000
}

type EtatAgent = 'attente' | 'cours' | 'fini' | 'echec' | 'ignore'
type AgentSuivi = { phase: number; titrePhase: string; etat: EtatAgent }
type EtatChantier = {
  id: string
  runId: string
  nom: string
  statut: StatutChantier
  phases: Map<number, string>
  agents: Map<number, AgentSuivi>
  jetons: number
  quota: boolean
  debutMs: number
  derniereLigneMs: number
  derniereLigne: string
}

/** Copié du CLI (`workflow_agent`) : « start » sans `startedAt` mais avec `queuedAt` attend sa place. */
function etatDeLAgent(a: Record<string, unknown>): EtatAgent {
  if (a.state === 'done') return 'fini'
  if (a.state === 'error') return a.skipped === true ? 'ignore' : 'echec'
  if (a.state === 'start' && a.startedAt === undefined && a.queuedAt !== undefined) return 'attente'
  return 'cours'
}

function chaine(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function instantane(c: EtatChantier): Chantier {
  const ouvert = c.statut === 'en-cours'
  const phases = new Map<number, PhaseDeChantier>()
  const phaseDe = (index: number, titre: string): PhaseDeChantier => {
    let phase = phases.get(index)
    if (!phase) {
      phase = { titre, enAttente: 0, enCours: 0, finis: 0, echecs: 0 }
      phases.set(index, phase)
    }
    return phase
  }
  for (const [index, titre] of c.phases) phaseDe(index, titre)
  const total = { enAttente: 0, enCours: 0, finis: 0, echecs: 0 }
  for (const agent of c.agents.values()) {
    const phase = phaseDe(agent.phase, agent.titrePhase)
    // Chantier fermé : un agent coupé n'est plus « en cours », et il n'a pas non plus réussi.
    const compte = (
      {
        attente: ouvert ? 'enAttente' : null,
        cours: ouvert ? 'enCours' : null,
        fini: 'finis',
        echec: 'echecs',
        ignore: null
      } as const
    )[agent.etat]
    if (!compte) continue
    phase[compte] += 1
    total[compte] += 1
  }
  return {
    id: c.id,
    nom: c.nom,
    statut: c.statut,
    phases: [...phases.entries()].sort(([a], [b]) => a - b).map(([, phase]) => phase),
    ...total,
    jetons: c.jetons,
    gros: c.agents.size > SEUIL_AGENTS_GROS_CHANTIER || c.jetons > SEUIL_JETONS_GROS_CHANTIER,
    quota: c.quota
  }
}

function jetonsDe(o: EvenementCli): number | undefined {
  const total = (o.usage as { total_tokens?: unknown } | undefined)?.total_tokens
  return typeof total === 'number' && Number.isFinite(total) ? total : undefined
}

function statutDeFin(status: unknown): StatutChantier {
  const s = String(status ?? '').toLowerCase()
  if (s === 'completed') return 'fini'
  return s === 'failed' ? 'echec' : 'arrete'
}

/**
 * Les chantiers d'UN appel du CLI. Pur hors de l'heure, fournie par l'appelant : testable sans CLI.
 *
 * `recevoir` dit aussi si l'événement est ABSORBÉ : la tâche d'un chantier et celles de ses agents ne
 * doivent pas passer par le suivi des tâches de fond de `claude.ts`, qui les annoncerait perdues à
 * la fin du tour et chercherait à les relancer.
 */
export class SuiviDesChantiers {
  private readonly chantiers = new Map<string, EtatChantier>()
  private readonly tachesDesAgents = new Set<string>()
  /** `run_id` des chantiers finis dont le `result` de notification n'est pas encore arrivé. */
  private readonly resultatsAttendus = new Set<string>()
  /** Chantiers d'un tour précédent, coupés avant leur fin : le CLI repris les signale. */
  private coupes: string[] = []
  private dernierTouche: EtatChantier | undefined

  ouvert(): boolean {
    for (const c of this.chantiers.values()) if (c.statut === 'en-cours') return true
    return false
  }

  /**
   * Vrai tant que la réponse du tour n'est pas arrivée : chantier en cours, ou fini mais dont le
   * `result` qui le traite manque encore.
   */
  attendUnResultat(): boolean {
    return this.ouvert() || this.resultatsAttendus.size > 0
  }

  recevoir(o: EvenementCli, maintenant: number): { lignes: string[]; absorbe: boolean } {
    if (o.type === 'rate_limit_event') return this.limite(o, maintenant)
    if (o.type !== 'system') return { lignes: [], absorbe: false }
    const id = chaine(o.task_id)
    if (o.subtype === 'task_started') {
      if (o.task_type === 'local_workflow') return this.demarrage(o, id, maintenant)
      if (o.owned_by_subagent === true && this.ouvert()) {
        this.tachesDesAgents.add(id)
        return { lignes: [], absorbe: true }
      }
      return { lignes: [], absorbe: false }
    }
    if (o.subtype === 'task_progress') {
      const chantier = this.chantiers.get(id)
      if (!chantier) return { lignes: [], absorbe: false }
      this.progres(chantier, o)
      return { lignes: this.ligneSiDue(chantier, maintenant), absorbe: true }
    }
    if (o.subtype === 'task_notification') {
      if (this.tachesDesAgents.delete(id)) return { lignes: [], absorbe: true }
      const chantier = this.chantiers.get(id)
      if (!chantier) {
        // Mesuré : `Background workflow "<nom>" (run wf_…) didn't finish before the previous session
        // ended`. Ses agents finis restent en cache : ce n'est pas un résultat perdu.
        const coupe = /^Background workflow "([^"]*)"/.exec(chaine(o.summary))
        if (coupe) this.coupes.push(coupe[1]!)
        return { lignes: [], absorbe: coupe !== null }
      }
      chantier.statut = statutDeFin(o.status)
      chantier.jetons = Math.max(chantier.jetons, jetonsDe(o) ?? 0)
      this.resultatsAttendus.add(chantier.runId)
      return { lignes: [this.poserLigne(chantier, maintenant)], absorbe: true }
    }
    return { lignes: [], absorbe: false }
  }

  /** Un `result` du CLI. Vrai s'il traite la fin d'un chantier : c'est la réponse du tour. */
  resultatRecu(o: EvenementCli): boolean {
    const origine = o.origin as { kind?: unknown; runId?: unknown } | undefined
    if (origine?.kind !== 'task-notification') return false
    return this.resultatsAttendus.delete(chaine(origine.runId))
  }

  /** La ligne de l'état présent, sans attendre son tour : un signe de vie, ou la dernière vue. */
  ligneCourante(): string | undefined {
    return this.dernierTouche ? ligneDeChantier(instantane(this.dernierTouche)) : undefined
  }

  /** Une ligne par chantier ouvert, même inchangée : le signe de vie d'un chantier silencieux. */
  battement(maintenant: number): string[] {
    return [...this.chantiers.values()]
      .filter((c) => c.statut === 'en-cours')
      .map((c) => this.poserLigne(c, maintenant))
  }

  /** Ferme ce qui reste ouvert, quand le tour s'arrête sans que le CLI ait pu le dire. */
  clore(statut: StatutChantier, maintenant: number): string[] {
    const lignes: string[] = []
    for (const c of this.chantiers.values()) {
      if (c.statut !== 'en-cours') continue
      c.statut = statut
      lignes.push(this.poserLigne(c, maintenant))
    }
    this.resultatsAttendus.clear()
    return lignes
  }

  instantanes(): Chantier[] {
    return [...this.chantiers.values()].map(instantane)
  }

  /** Encore ouverts, ou finis sans que le `result` qui les traite soit arrivé. */
  chantiersSansReponse(): Chantier[] {
    return [...this.chantiers.values()]
      .filter((c) => c.statut === 'en-cours' || this.resultatsAttendus.has(c.runId))
      .map(instantane)
  }

  /** Les chantiers coupés à annoncer, une seule fois ; aucun si l'appel en a relancé un. */
  chantiersCoupes(): string[] {
    const coupes = this.chantiers.size > 0 ? [] : this.coupes
    this.coupes = []
    return coupes
  }

  private demarrage(
    o: EvenementCli,
    id: string,
    maintenant: number
  ): { lignes: string[]; absorbe: boolean } {
    const chantier: EtatChantier = {
      id,
      runId: chaine(o.run_id),
      nom: chaine(o.workflow_name) || chaine(o.description) || id,
      statut: 'en-cours',
      phases: new Map(),
      agents: new Map(),
      jetons: 0,
      quota: false,
      debutMs: maintenant,
      derniereLigneMs: 0,
      derniereLigne: ''
    }
    this.chantiers.set(id, chantier)
    return { lignes: [this.poserLigne(chantier, maintenant)], absorbe: true }
  }

  private progres(chantier: EtatChantier, o: EvenementCli): void {
    this.dernierTouche = chantier
    chantier.jetons = Math.max(chantier.jetons, jetonsDe(o) ?? 0)
    if (!Array.isArray(o.workflow_progress)) return
    for (const brut of o.workflow_progress as Array<Record<string, unknown>>) {
      if (brut.type === 'workflow_phase' && typeof brut.index === 'number')
        chantier.phases.set(brut.index, chaine(brut.title))
      if (brut.type !== 'workflow_agent' || typeof brut.index !== 'number') continue
      const etat = etatDeLAgent(brut)
      chantier.agents.set(brut.index, {
        phase: typeof brut.phaseIndex === 'number' ? brut.phaseIndex : 0,
        titrePhase: chaine(brut.phaseTitle),
        etat
      })
      if (etat === 'echec' && estMurDeQuota(chaine(brut.error))) chantier.quota = true
    }
  }

  private limite(o: EvenementCli, maintenant: number): { lignes: string[]; absorbe: boolean } {
    const info = o.rate_limit_info as { status?: unknown } | undefined
    const lignes: string[] = []
    if (info?.status === 'rejected') {
      for (const c of this.chantiers.values()) {
        if (c.statut !== 'en-cours' || c.quota) continue
        c.quota = true
        lignes.push(this.poserLigne(c, maintenant))
      }
    }
    return { lignes, absorbe: false }
  }

  private ligneSiDue(chantier: EtatChantier, maintenant: number): string[] {
    const ligne = ligneDeChantier(instantane(chantier))
    if (ligne === chantier.derniereLigne) return []
    const intervalle = intervalleDeLigneMs(maintenant - chantier.debutMs)
    if (maintenant - chantier.derniereLigneMs < intervalle) {
      // Un refus de quota vu sur un agent ne se fait pas attendre, le reste peut.
      const quotaNouveau = chantier.quota && !chantier.derniereLigne.includes('"quota":true')
      if (!quotaNouveau) return []
    }
    return [this.poserLigne(chantier, maintenant)]
  }

  private poserLigne(chantier: EtatChantier, maintenant: number): string {
    this.dernierTouche = chantier
    const ligne = ligneDeChantier(instantane(chantier))
    chantier.derniereLigne = ligne
    chantier.derniereLigneMs = maintenant
    return ligne
  }
}

/**
 * Ce que la réponse du tour doit dire d'un chantier fini, quoi que le modèle ait écrit : en `-p`, le
 * quota ne fait pas patienter les agents, il les fait échouer, et un résultat partiel se lit comme
 * un résultat complet si rien ne le signale.
 */
export function avisDeFinDeChantier(chantier: Chantier): string {
  const { nom, finis, echecs } = chantier
  const agents = `${echecs} agent${echecs > 1 ? 's' : ''}`
  if (chantier.quota) {
    const perdus = echecs > 0 ? ` : ${agents} en échec sur ${finis + echecs}` : ''
    return (
      `\n\n⛔ Quota atteint pendant le chantier « ${nom} »${perdus}. Lancé par Autowin, un chantier ` +
      `ne patiente pas jusqu'au retour du quota : ses agents échouent au lieu d'attendre. ` +
      `Le résultat ci-dessus est donc partiel : relance-le quand le quota est revenu.`
    )
  }
  if (echecs > 0)
    return `\n\n⚠️ Chantier « ${nom} » : ${agents} en échec sur ${finis + echecs}. Le résultat ci-dessus peut être partiel.`
  return ''
}

/** Le CLI est sorti sans que le chantier ait fini : ce que le fil ne pourrait pas deviner. */
export function avisDeChantierCoupe(chantier: Chantier): string {
  return `\n\n⚠️ Le chantier « ${chantier.nom} » s'est arrêté avant sa fin : ${chantier.finis} agent${chantier.finis > 1 ? 's' : ''} fini${chantier.finis > 1 ? 's' : ''}, le reste n'a pas abouti. Ce résultat n'est pas complet.`
}

/**
 * Un chantier coupé à un tour précédent. Mesuré (`banc-reprise.mjs`) : relancé avec
 * `resumeFromRunId`, le CLI rend les agents finis depuis son cache (`cached: true`) sans les rejouer.
 * Ces mots le rechargent, sinon l'outil n'est pas là au tour suivant.
 */
export function avisDeChantierPrecedent(nom: string): string {
  return `\n\n⚠️ Le chantier « ${nom} » a été coupé avant sa fin. Ses agents finis sont gardés : écris « relance le workflow » pour reprendre où il en était.`
}

/** Deux `result` pour un seul tour : le tour coûte la somme des deux, pas le dernier. */
export function cumulerUsage(precedent: Usage | undefined, suivant: Usage): Usage {
  if (!precedent) return suivant
  const somme = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)
  const champs = {
    cacheReadTokens: somme(precedent.cacheReadTokens, suivant.cacheReadTokens),
    cacheCreationTokens: somme(precedent.cacheCreationTokens, suivant.cacheCreationTokens),
    cacheCreation1hTokens: somme(precedent.cacheCreation1hTokens, suivant.cacheCreation1hTokens),
    costUsd: somme(precedent.costUsd, suivant.costUsd)
  }
  return {
    ...suivant,
    inputTokens: precedent.inputTokens + suivant.inputTokens,
    outputTokens: precedent.outputTokens + suivant.outputTokens,
    ...Object.fromEntries(Object.entries(champs).filter(([, valeur]) => valeur !== undefined))
  }
}
