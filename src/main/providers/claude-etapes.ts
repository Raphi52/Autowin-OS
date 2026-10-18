/**
 * ÉTAPES DU TOUR — la liste de tâches que claude.exe dessine (☐ à faire, ◼ en cours, ✔ terminée),
 * relayée dans le fil d'Autowin.
 *
 * Demande de l'utilisateur (conv-304, 2026-10-17) : « j'aimerais que dans mon chat ça affiche un
 * bloc avec les étapes de la task et leur progression, ils ont mis ça dans claude.exe ».
 *
 * MESURÉ sur le CLI réel (2.1.302, flux `stream-json` du 2026-10-17, `.autowin-tmp/taches-cli/`) :
 * l'ancien `TodoWrite` n'existe plus ; le modèle tient sa liste avec quatre outils natifs :
 *   - `TaskCreate {subject, description, activeForm?}` → `tool_use_result.task = {id, subject}`
 *   - `TaskUpdate {taskId, status?, subject?, …}`      → `tool_use_result.statusChange = {from, to}`
 *   - `TaskList {}`                                    → `tool_use_result.tasks = [{id, subject, status}]`
 *   - `TaskGet` (non chargé par le chat : +390 jetons pour un détail que le bloc n'affiche pas)
 * Statuts : `pending` → `in_progress` → `completed`, et `deleted`.
 * La liste vit PAR SESSION dans `<CLAUDE_CONFIG_DIR ou ~/.claude>/tasks/<session_id>/<id>.json`, et
 * un tour repris (`--resume`) garde la même session : un tour peut donc faire avancer une étape
 * créée au tour précédent, dont le flux de CE tour ne dit pas le sujet.
 *
 * TRANSPORT : une LIGNE DE STATUT par changement, `Étape #<id> <état> · <sujet>` (format dans
 * `shared/etapes-du-tour.ts`). C'est le seul canal qui va jusqu'au fil ET survit au rechargement
 * (journal des actions, `actionsLog`, lignes coupées à 300 caractères) : un instantané JSON de
 * toute la liste n'y tiendrait pas. Le fil reconstruit la liste en rejouant ces lignes.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ligneDEtape, type StatutEtape } from '../../shared/etapes-du-tour'

/** Les outils d'étapes chargés par le tour de chat (voir l'en-tête pour TaskGet). */
export const OUTILS_ETAPES = 'TaskCreate,TaskUpdate,TaskList'

const NOMS = /^Task(Create|Update|List|Get)$/

export function estOutilDEtapes(nom: string): boolean {
  return NOMS.test(nom)
}

function statutValide(v: unknown): StatutEtape | null {
  return v === 'pending' || v === 'in_progress' || v === 'completed' || v === 'deleted' ? v : null
}

export type EtapeConnue = { id: string; sujet: string; statut: StatutEtape }

/** Dossier où le CLI range la liste d'une session — le même que celui du compte du tour. */
export function dossierDesEtapes(
  sessionId: string,
  env: Record<string, string | undefined>
): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'tasks', sessionId)
}

/**
 * La liste telle que le CLI l'a écrite sur disque. Lecture seule, tolérante : un dossier absent
 * ou un fichier illisible ne rend rien — le bloc se nourrit alors du seul flux du tour.
 */
export function etapesSurDisque(dossier: string): EtapeConnue[] {
  let noms: string[]
  try {
    noms = readdirSync(dossier).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  const sortie: EtapeConnue[] = []
  for (const nom of noms) {
    try {
      const brut = JSON.parse(readFileSync(join(dossier, nom), 'utf8')) as Record<string, unknown>
      const statut = statutValide(brut.status)
      if (typeof brut.id !== 'string' || !statut) continue
      sortie.push({ id: brut.id, sujet: String(brut.subject ?? ''), statut })
    } catch {
      continue
    }
  }
  return sortie.sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id))
}

/** Identifiant d'une étape créée : le champ structuré, sinon le texte « Task #3 created … ». */
function idCree(resultat: unknown, texte: string): string | null {
  const tache = (resultat as { task?: { id?: unknown } } | undefined)?.task
  if (tache && (typeof tache.id === 'string' || typeof tache.id === 'number'))
    return String(tache.id)
  return /Task #(\w+) created/.exec(texte)?.[1] ?? null
}

/**
 * Suivi d'UN tour : reçoit les appels et les résultats des outils d'étapes, rend les lignes à
 * relayer. Pur hors de `lireDisque`, fourni par l'appelant (testable sans CLI).
 */
export class SuiviDesEtapes {
  private readonly connues = new Map<string, EtapeConnue>()
  private readonly appels = new Map<string, { nom: string; input: Record<string, unknown> }>()
  private amorce = false

  constructor(private readonly lireDisque: () => EtapeConnue[]) {}

  /**
   * Premier appel du tour : la liste d'AVANT ce tour est relue du disque (l'outil n'a pas encore
   * tourné). Seules les étapes encore ouvertes sont montrées : celles d'une demande déjà finie
   * n'ont rien à faire dans le bloc de la nouvelle.
   */
  appel(toolUseId: string, nom: string, input: Record<string, unknown> | undefined): string[] {
    this.appels.set(toolUseId, { nom, input: input ?? {} })
    if (this.amorce) return []
    this.amorce = true
    const lignes: string[] = []
    for (const e of this.lireDisque()) {
      this.connues.set(e.id, e)
      if (e.statut === 'pending' || e.statut === 'in_progress')
        lignes.push(ligneDEtape(e.id, e.statut, e.sujet))
    }
    return lignes
  }

  /**
   * Résultat d'un outil d'étapes : les lignes des étapes qui ont CHANGÉ. Un échec ne change rien.
   * `null` : ce résultat n'est pas celui d'un appel d'étapes suivi ici — l'appelant le traite.
   */
  resultat(
    toolUseId: string,
    enErreur: boolean,
    resultat: unknown,
    texte: string
  ): string[] | null {
    const appel = this.appels.get(toolUseId)
    if (!appel) return null
    this.appels.delete(toolUseId)
    if (enErreur) return []
    if (appel.nom === 'TaskCreate') {
      const id = idCree(resultat, texte)
      if (!id) return []
      return this.poser(id, 'pending', String(appel.input.subject ?? ''))
    }
    if (appel.nom === 'TaskUpdate') {
      const id = appel.input.taskId
      if (typeof id !== 'string' && typeof id !== 'number') return []
      const cle = String(id)
      const avant = this.connues.get(cle) ?? this.lireDisque().find((e) => e.id === cle)
      const statut =
        statutValide(appel.input.status) ??
        statutValide((resultat as { statusChange?: { to?: unknown } })?.statusChange?.to) ??
        avant?.statut ??
        'pending'
      const sujet =
        typeof appel.input.subject === 'string' ? appel.input.subject : (avant?.sujet ?? '')
      return this.poser(cle, statut, sujet)
    }
    if (appel.nom === 'TaskList') {
      const taches = (resultat as { tasks?: unknown })?.tasks
      if (!Array.isArray(taches)) return []
      const lignes: string[] = []
      for (const t of taches as Array<Record<string, unknown>>) {
        const statut = statutValide(t.status)
        if ((typeof t.id !== 'string' && typeof t.id !== 'number') || !statut) continue
        const cle = String(t.id)
        // Une étape terminée qu'on ne suivait pas vient d'une demande close : on ne la ressort pas.
        if (!this.connues.has(cle) && statut === 'completed') continue
        lignes.push(...this.poser(cle, statut, String(t.subject ?? '')))
      }
      return lignes
    }
    return []
  }

  private poser(id: string, statut: StatutEtape, sujet: string): string[] {
    const avant = this.connues.get(id)
    const sujetFinal = sujet || avant?.sujet || ''
    if (avant && avant.statut === statut && avant.sujet === sujetFinal) return []
    this.connues.set(id, { id, sujet: sujetFinal, statut })
    return [ligneDEtape(id, statut, sujetFinal)]
  }
}
