import { useEffect, useRef, useState } from 'react'
import { formaterNombre, langueCourante } from '../langue'
import { traduireAgentStudio, useTextesAgentStudio } from '../textes-ecrans/agent-studio'
import { WorkflowGraphEditor } from './WorkflowGraphEditor'
import { profileSummary, promptEffectif } from './workflow-profile-summary'
import { rolesEffectifs, trackNodes, workflowIssues } from './workflow-executability'
import { useSkillsInventory } from './useSkillsInventory'
import './WorkflowProfilesView.css'
import { Spinner } from './Spinner'

/**
 * Choisir SA façon de travailler.
 *
 * La manière dont un run se déroule était éparpillée : modèles et efforts dans les rôles, phases
 * dans le régime, consignes dans les skills. Impossible de dire « lance ça en Rapide, puis en
 * Rigoureux, et compare ». Cette vue rend le workflow nommable, sélectionnable — et confrontable :
 * le panneau du bas rejoue un même objectif sous plusieurs d'entre eux et en compare le résultat.
 */

interface WorkflowProfile {
  id: string
  name: string
  description?: string
  roles?: Record<string, { provider?: string; model?: string; reasoningEffort?: string }>
  phases?: string[]
  graph?: import('./WorkflowCanvas').CanvasGraph
  allocation?: { judgeMembers?: number; maxGreedyNodes?: number }
  /** `perPhase` prime sur `text` pour la phase visée — le modèle main le porte déjà (`workflow-profiles.ts`). */
  instructions?: { mode: 'append' | 'replace'; text?: string; perPhase?: Record<string, string> }
  /** Le chat peut-il invoquer ce workflow de lui-même ? Absent vaut oui (voir `workflow-profiles.ts`). */
  enabled?: boolean
}

interface ProfilesFile {
  profiles: WorkflowProfile[]
  activeId: string | null
}

/**
 * Icônes en SVG inline : un glyphe typographique détourné (× ↥ ↩) dépend de la police installée et
 * s'aligne mal. Trait de 1,5 px, `currentColor`, 14 px — elles héritent donc de la couleur du bouton,
 * y compris à son survol.
 */
function Icone({ nom }: { nom: 'import' | 'export' | 'plus' | 'poubelle' }): React.JSX.Element {
  const traces: Record<typeof nom, string> = {
    // Flèche vers le BAS dans un bac : ce qui entre dans l'application.
    import: 'M8 2v7m0 0 3-3m-3 3L5 6M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11',
    // Flèche vers le HAUT hors du bac : ce qui en sort.
    export: 'M8 9V2m0 0 3 3M8 2 5 5M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11',
    plus: 'M8 3.5v9M3.5 8h9',
    poubelle: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2'
  }
  return (
    <svg
      className="wf-icone"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={traces[nom]} />
    </svg>
  )
}

/* ── La portée : la topologie d'un workflow lue d'un seul regard, sans l'ouvrir ── */
const TN_W = 118
const TN_GAP = 34
const TRACK_PAD = 14

/**
 * Une portée horizontale par workflow. C'est ce qui permet de COMPARER sans cliquer : la séquence, la
 * densité de fan-out et les retours bornés se lisent côte à côte, workflow après workflow.
 */
/**
 * Le tracé d'un retour, en COUDE arrondi plutôt qu'en courbe de Bézier d'un bout à l'autre.
 *
 * La Bézier donnait un arc dissymétrique : ses deux poignées verticales tiraient la courbe vers le
 * bas près de la source et l'aplatissaient près de la cible, si bien que le trait semblait sortir de
 * nulle part d'un côté et raser la pastille de l'autre — et la pointe, prenant la tangente de cette
 * fin plate, arrivait de biais. Le coude règle les deux : segments francs, virages de rayon constant,
 * et une arrivée VERTICALE, donc une pointe qui entre droit dans la pastille cible.
 *
 * C'est aussi la géométrie des arêtes du canevas (`COURBE` dans `WorkflowCanvas`) : deux vues du même
 * graphe qui dessinent leurs retours autrement se lisent comme deux mécanismes différents.
 */
function arcRetour(xa: number, xb: number, bas: number, creux: number): string {
  const sens = xb > xa ? 1 : -1
  const r = Math.min(7, Math.abs(xb - xa) / 2, (creux - bas) / 2)
  // Trop court ou trop plat pour loger deux virages : un coude dégénéré serait plus laid que l'arc.
  if (r < 2) return `M${xa} ${bas} C${xa} ${creux}, ${xb} ${creux}, ${xb} ${bas + 3}`
  return (
    `M${xa} ${bas}` +
    `V${creux - r}` +
    `Q${xa} ${creux} ${xa + r * sens} ${creux}` +
    `H${xb - r * sens}` +
    `Q${xb} ${creux} ${xb} ${creux - r}` +
    // Jusqu'au bas de la pastille, pas 3px au-dessus du coude : la remontée doit être PLUS LONGUE que
    // la pointe, sinon la flèche ne se lit pas comme une arrivée mais comme un triangle posé sur le
    // trait horizontal. C'est ce que montrait la première version — coude correct, lecture fausse.
    `V${bas}`
  )
}

function WorkflowTrack({ profile }: { profile: WorkflowProfile }): React.JSX.Element | null {
  const nodes = trackNodes(profile)
  if (!nodes.length) return null
  const rang = new Map(nodes.map((n, i) => [n.id, i]))
  const retours = (profile.graph?.edges ?? []).filter((e) => e.when !== 'always')
  const centre = (i: number): number => TRACK_PAD + i * (TN_W + TN_GAP) + TN_W / 2
  const largeur = TRACK_PAD * 2 + nodes.length * TN_W + (nodes.length - 1) * TN_GAP
  // Les arcs de retour partent du BAS des pastilles (top 8px + ~36px de contenu) : un arc qui démarre
  // dans le vide se lit comme une flèche orpheline plutôt que comme un retour entre deux phases.
  const basPastille = 46
  // La profondeur du creux n'est pas décorative : elle donne à la remontée finale de quoi être plus
  // longue que la pointe de flèche. Trop peu, et l'arrivée ne se lit pas.
  const hauteur = basPastille + (retours.length ? 24 + retours.length * 16 : 4)

  return (
    <div
      className="wf-track"
      style={{ width: largeur, height: hauteur }}
      data-testid={`wf-track-${profile.id}`}
    >
      <svg width={largeur} height={hauteur} aria-hidden="true">
        <defs>
          {/*
            Id UNIQUE par piste. Il était fixe (`wft-r`) : chaque workflow rendant son propre <defs>,
            le document contenait autant de fois le même id que de pistes. Tous les `markerEnd` se
            résolvaient alors vers le PREMIER — et démonter ce premier workflow faisait disparaître la
            pointe de tous les autres. Un défaut qui ne se voit qu'après une suppression.
            `refX` sur la pointe (7) et non 6 : sinon la flèche dépasse d'un pixel le bout du tracé.
          */}
          <marker
            id={`wft-r-${profile.id}`}
            markerWidth="7"
            markerHeight="7"
            refX="7"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 z" className="wf-ar-r" />
          </marker>
        </defs>
        <line x1={TRACK_PAD} y1="30" x2={largeur - TRACK_PAD} y2="30" className="wf-track-line" />
        {retours.map((edge, i) => {
          const a = rang.get(edge.from)
          const b = rang.get(edge.to)
          if (a === undefined || b === undefined) return null
          const creux = basPastille + 20 + i * 16
          return (
            <path
              key={`${edge.from}>${edge.to}`}
              d={arcRetour(centre(a), centre(b), basPastille, creux)}
              className={`wf-track-arc wf-wire-${edge.when}`}
              markerEnd={`url(#wft-r-${profile.id})`}
            />
          )
        })}
      </svg>
      {nodes.map((node, i) => (
        <span
          key={node.id}
          className={`wf-tn wf-ph-${node.phase}`}
          style={{ left: TRACK_PAD + i * (TN_W + TN_GAP), width: TN_W }}
        >
          <span className="wf-tn-head">
            <span className="wf-dot" />
            {node.phase}
          </span>
          <span className="wf-tn-ags">
            {Array.from({ length: node.agents }, (_, k) => (
              <i className="wf-ag" key={k} />
            ))}
          </span>
        </span>
      ))}
    </div>
  )
}

/**
 * Ce qu'un rejet IPC dit VRAIMENT. Un `catch {}` remplaçait la raison par une phrase générique :
 * l'utilisateur voyait « L'enregistrement a échoué » sans jamais savoir que le disque était plein
 * ou le fichier verrouillé. On garde la phrase de contexte ET on y accroche la raison réelle.
 */
/** Retire une clé d'un dictionnaire sans en déstructurer une variable jamais lue. */
function oublier(source: Record<string, string>, cle: string): Record<string, string> {
  const copie = { ...source }
  delete copie[cle]
  return copie
}

function raison(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * MESURES D'ARENE DEJA PAYEES.
 *
 * Les bancs ecrivent `arena-duels.jsonl` (82 duels au 2026-09-09 : duree, cout, verdict par
 * workflow). Cette vue promettait de « comparer » en REJOUANT l'objectif — donc en repayant 2,1 a
 * 16 min et 0,55 a 5,51 $ par bras. On lit la mesure au lieu de la refaire ; quand aucun duel ne
 * porte le workflow, on le DIT plutot que d'afficher un zero qui passerait pour une mesure.
 */
interface AgregatDuels {
  duels: number
  dureeMedianeMs: number
  coutMedianUsd: number
  verdicts: Record<string, number>
  dernierTs?: string
}

/** Le journal nomme les workflows a sa facon (« A pipeline complet ») : rapprochement souple. */
function mesuresPour(nom: string, duels: Record<string, AgregatDuels>): AgregatDuels | undefined {
  const cible = nom.trim().toLowerCase()
  if (!cible) return undefined
  const exact = Object.entries(duels).find(([k]) => k.trim().toLowerCase() === cible)
  if (exact) return exact[1]
  const approche = Object.entries(duels).find(([k]) => k.toLowerCase().includes(cible))
  return approche?.[1]
}

function dureeLisible(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} min`
  return `${Math.round(ms / 1000)} s`
}

/** Deux décimales, sans séparateur de milliers : « 0,55 $ » en français, « $0.55 » en anglais. */
function coutLisible(usd: number): string {
  const montant = formaterNombre(usd, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false
  })
  return traduireAgentStudio('wf.cout', langueCourante(), { montant })
}

/** La ligne affichee sous le nom du workflow. Une phrase pure, donc lisible et testable. */
function phraseMesures(nom: string, duels: Record<string, AgregatDuels>): string {
  const langue = langueCourante()
  const m = mesuresPour(nom, duels)
  if (!m || m.duels === 0) return traduireAgentStudio('wf.arene.aucune', langue)
  // Les verdicts sont ceux du journal des duels, tels qu'il les écrit : une donnée, pas un libellé.
  const verdicts = Object.entries(m.verdicts)
    .map(([verdict, n]) => `${n} ${verdict}`)
    .join(', ')
  return traduireAgentStudio(m.duels > 1 ? 'wf.arene.plusieurs' : 'wf.arene.un', langue, {
    n: m.duels,
    duree: dureeLisible(m.dureeMedianeMs),
    cout: coutLisible(m.coutMedianUsd),
    verdicts: verdicts ? ` · ${verdicts}` : ''
  })
}

/**
 * CE QUE LE WORKFLOW A RÉELLEMENT DONNÉ EN USAGE (piste 1, conv-1070), relu dans la trace causale
 * par `resultats-reels-workflows.ts`. Les runs INTERROMPUS (Stop, limite de session, panne en
 * face) sont dits, mais hors du taux de réussite et des médianes : l'abonnement qui dit non ne rend
 * pas un workflow mauvais. Rapprochement EXACT par nom : c'est le nom écrit dans la trace au départ
 * du run, pas un libellé de banc.
 */
interface ResultatsReels {
  runs: number
  abouties: number
  echecs: number
  interrompues: number
  nonCloses: number
  dureeMedianeMs?: number
  coutMedianUsd?: number
}

type CleDeTexteAgentStudio = Parameters<typeof traduireAgentStudio>[0]

/**
 * Un message posé APRÈS une attente (échec d'IPC, renommage retombé 300 ms plus tard) : la langue
 * se lit au moment où il naît, pas à celui du rendu qui a lancé l'appel.
 */
function texteMaintenant(
  cle: CleDeTexteAgentStudio,
  valeurs?: Record<string, string | number>
): string {
  return traduireAgentStudio(cle, langueCourante(), valeurs)
}

/** `n` suivi du mot au singulier jusqu'à 1, au pluriel au-delà — chaque forme a sa clé. */
function pluriel(n: number, un: CleDeTexteAgentStudio, plusieurs = un): string {
  return traduireAgentStudio(n > 1 ? plusieurs : un, langueCourante(), { n })
}

function phraseResultatsReels(nom: string, reels: Record<string, ResultatsReels>): string {
  const langue = langueCourante()
  const ici = (cle: CleDeTexteAgentStudio, valeurs?: Record<string, string | number>): string =>
    traduireAgentStudio(cle, langue, valeurs)
  const cible = nom.trim().toLowerCase()
  const r = Object.entries(reels).find(([k]) => k.trim().toLowerCase() === cible)?.[1]
  if (!r || r.runs === 0) return ici('wf.reels.aucun')
  const morceaux = [pluriel(r.runs, 'wf.reels.run.un', 'wf.reels.run.plusieurs')]
  const allesAuBout = r.abouties + r.echecs
  const issues = [
    pluriel(r.abouties, 'wf.reels.abouti.un', 'wf.reels.abouti.plusieurs'),
    ici('wf.reels.echecs', { n: r.echecs })
  ]
  morceaux.push(
    allesAuBout > 0
      ? ici('wf.reels.taux', {
          issues: issues.join(', '),
          taux: Math.round((r.abouties / allesAuBout) * 100)
        })
      : issues.join(', ')
  )
  if (r.interrompues > 0)
    morceaux.push(
      pluriel(r.interrompues, 'wf.reels.interrompu.un', 'wf.reels.interrompu.plusieurs')
    )
  if (r.nonCloses > 0) morceaux.push(pluriel(r.nonCloses, 'wf.reels.nonClos'))
  if (r.dureeMedianeMs !== undefined)
    morceaux.push(ici('wf.reels.median', { valeur: dureeLisible(r.dureeMedianeMs) }))
  if (r.coutMedianUsd !== undefined)
    morceaux.push(ici('wf.reels.median', { valeur: coutLisible(r.coutMedianUsd) }))
  return ici('wf.reels.phrase', { morceaux: morceaux.join(' · ') })
}

export function WorkflowProfilesView({ active }: { active: boolean }): React.JSX.Element {
  const { t } = useTextesAgentStudio()
  const [file, setFile] = useState<ProfilesFile>({ profiles: [], activeId: null })
  /** Duels deja mesures, par nom de workflow. Lecture seule : rien n'est rejoue ici. */
  const [duels, setDuels] = useState<Record<string, AgregatDuels>>({})
  /** Résultats réels par nom de workflow, relus dans la trace causale (piste 1, conv-1070). */
  const [reels, setReels] = useState<Record<string, ResultatsReels>>({})
  /**
   * Un noeud peut porter une SKILL du disque et non une phase du pipeline. Sans cet inventaire, la
   * vue declarait « phase inconnue » une brique que sa propre palette propose, et bloquait son
   * activation. `null` = inventaire indetermine (IPC en vol) : on ne juge rien, plutot que
   * d'afficher un faux positif le temps d'un rendu.
   */
  const skills = useSkillsInventory()
  const soucisDe = (profil: WorkflowProfile): string[] =>
    skills ? workflowIssues(profil, skills) : []
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  /** Ouvrir l'éditeur n'est PAS activer le workflow : deux gestes, deux états (point 3). */
  const [editingId, setEditingId] = useState<string | null>(null)
  /** Une suppression se confirme : le geste est irréversible et voisin du bouton Exporter. */
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  /** Nom en cours de frappe, par workflow. Sans lui, chaque caractère partait en IPC. */
  const [names, setNames] = useState<Record<string, string>>({})
  const renameTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve())
  /** Renommages saisis mais pas encore écrits, à flusher si la vue disparaît avant la retombée. */
  const pendingRenamesRef = useRef<Record<string, WorkflowProfile>>({})
  const persistVersionRef = useRef(0)

  useEffect(() => {
    if (!active) return
    let annule = false
    // Les mesures d'arene sont un BONUS : leur absence ne doit ni retarder ni casser la liste.
    void Promise.resolve(window.api.arenaDuelsParWorkflow?.())
      .then((agr) => {
        if (!annule && agr) setDuels(agr as Record<string, AgregatDuels>)
      })
      .catch(() => {
        /* journal absent ou illisible : la liste s'affiche sans mesure */
      })
    // Même règle que les bancs : un BONUS, qui ne retarde ni ne casse la liste.
    void Promise.resolve(window.api.workflowResultatsReels?.())
      .then((agr) => {
        if (!annule && agr) setReels(agr)
      })
      .catch(() => {
        /* trace absente ou illisible : la liste s'affiche sans résultat réel */
      })
    return () => {
      annule = true
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void Promise.resolve()
      .then(() => {
        if (cancelled) return undefined
        setLoading(true)
        setError(undefined)
        return window.api.workflowProfiles?.()
      })
      .then((next) => {
        if (!cancelled && next) setFile(next as ProfilesFile)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(texteMaintenant('wf.erreur.lecture', { raison: raison(reason) }))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active])

  const select = async (id: string | null): Promise<void> => {
    setError(undefined)
    try {
      const next = (await window.api.workflowProfileSelect?.(id)) as ProfilesFile | undefined
      if (next) setFile(next)
    } catch (reason) {
      setError(texteMaintenant('wf.erreur.selection', { raison: raison(reason) }))
    }
  }

  const remove = async (id: string): Promise<void> => {
    setError(undefined)
    try {
      const next = (await window.api.workflowProfileRemove?.(id)) as ProfilesFile | undefined
      if (next) setFile(next)
      if (editingId === id) setEditingId(null)
    } catch (reason) {
      setError(texteMaintenant('wf.erreur.suppression', { raison: raison(reason) }))
    }
  }

  const save = async (profile: WorkflowProfile): Promise<void> => {
    setError(undefined)
    try {
      const next = (await window.api.workflowProfileSave?.(profile)) as ProfilesFile | undefined
      if (next) setFile(next)
    } catch (reason) {
      setError(texteMaintenant('wf.erreur.enregistrement', { raison: raison(reason) }))
    }
  }

  /**
   * Renommage : l'input était piloté par `profile.name` et écrivait en IPC à CHAQUE frappe — une
   * écriture par caractère, donc autant de courses d'écriture, et un nom vide silencieusement
   * perdu. Même contrat que `persist()` dans `AgentsTopologyView` : état local, debounce, file
   * sérialisée, et rollback VISIBLE (le champ revient au nom persisté) quand l'IPC rejette.
   */
  const rename = (profile: WorkflowProfile, name: string): void => {
    setNames((current) => ({ ...current, [profile.id]: name }))
    clearTimeout(renameTimersRef.current[profile.id])
    // Un nom vide rendrait le profil illisible ET le ferait rejeter à la relecture : on garde la
    // frappe à l'écran mais on n'enregistre rien tant qu'elle ne dit rien.
    if (!name.trim()) return
    // Ce qui reste À ÉCRIRE si la vue disparaît avant la retombée : sans cette mémoire, le cleanup
    // ne pouvait que jeter la frappe (clearTimeout sans flush).
    pendingRenamesRef.current[profile.id] = { ...profile, name }
    renameTimersRef.current[profile.id] = setTimeout(() => {
      delete pendingRenamesRef.current[profile.id]
      const version = ++persistVersionRef.current
      setError(undefined)
      const request = persistQueueRef.current.then(
        () => window.api.workflowProfileSave?.({ ...profile, name }) as Promise<ProfilesFile>
      )
      persistQueueRef.current = request.then(
        () => undefined,
        () => undefined
      )
      void request.then(
        (next) => {
          if (version !== persistVersionRef.current) return
          if (next) setFile(next)
          setNames((current) => oublier(current, profile.id))
        },
        (reason: unknown) => {
          if (version !== persistVersionRef.current) return
          setError(texteMaintenant('wf.erreur.renommage', { raison: raison(reason) }))
          // Rollback visible : le champ retrouve le nom réellement persisté.
          setNames((current) => oublier(current, profile.id))
        }
      )
    }, 300)
  }

  /**
   * Quitter la section juste après avoir renommé PERDAIT le renommage : le cleanup faisait
   * `clearTimeout` sans jamais écrire. On annule le minuteur ET on écrit ce qui restait en attente.
   */
  useEffect(() => {
    const timers = renameTimersRef.current
    const pending = pendingRenamesRef.current
    return () => {
      for (const timer of Object.values(timers)) clearTimeout(timer)
      for (const id of Object.keys(pending)) {
        const profil = pending[id]
        delete pending[id]
        // Démonté : plus aucun état à mettre à jour, seule l'ÉCRITURE compte. Elle reste dans la MÊME
        // file que les debounces déjà partis : sinon une ancienne sauvegarde lente peut finir après
        // ce flush et réécrire l'ancien nom.
        const request = persistQueueRef.current.then(
          () => window.api.workflowProfileSave?.(profil) as Promise<ProfilesFile>
        )
        persistQueueRef.current = request.then(
          () => undefined,
          () => undefined
        )
      }
    }
  }, [])

  /** `id` nul = tout le fichier ; un id = ce seul workflow, pour en partager un sans donner le reste. */
  const exporter = async (id: string | null): Promise<void> => {
    try {
      const res = await window.api.workflowProfilesExport?.(id)
      // Une annulation n'est pas une erreur : on ne crie pas quand l'utilisateur ferme la boîte.
      // `'annulé'` : la raison qu'écrit le processus principal, comparée ici — elle reste en français.
      if (res && !res.ok && res.reason && res.reason !== 'annulé')
        setError(texteMaintenant('wf.erreur.exportRaison', { raison: res.reason }))
    } catch (reason) {
      setError(texteMaintenant('wf.erreur.export', { raison: raison(reason) }))
    }
  }

  const importer = async (): Promise<void> => {
    setError(undefined)
    try {
      const res = await window.api.workflowProfilesImport?.()
      if (!res) return
      if (res.file) setFile(res.file)
      if (!res.ok && res.reason && res.reason !== 'annulé') {
        setError(texteMaintenant('wf.erreur.importRaison', { raison: res.reason }))
        return
      }
      // Ce qui a été ÉCARTÉ se dit : un import silencieux qui perd la moitié du fichier ment.
      if (res.rejected?.length) {
        setError(
          texteMaintenant('wf.erreur.importEcartes', {
            importes: res.imported ?? 0,
            ecartes: res.rejected.length,
            liste: res.rejected.join(', ')
          })
        )
      }
    } catch (reason) {
      setError(texteMaintenant('wf.erreur.import', { raison: raison(reason) }))
    }
  }

  const create = async (): Promise<void> => {
    // Un identifiant lisible, mais RÉELLEMENT libre : `profiles.length + 1` collisionnait dès qu'un
    // workflow intermédiaire avait été supprimé (3 workflows, on retire le 2e → « Nouveau »
    // régénérait `workflow-3` et ÉCRASAIT le workflow existant, sans un mot).
    const pris = new Set(file.profiles.map((profile) => profile.id))
    let rang = file.profiles.length + 1
    while (pris.has(`workflow-${rang}`)) rang += 1
    try {
      const next = (await window.api.workflowProfileSave?.({
        id: `workflow-${rang}`,
        // Un nom ENREGISTRÉ dans le profil, pas un libellé : il ne change pas avec la langue.
        name: `Workflow ${rang}`
      })) as ProfilesFile | undefined
      if (next) setFile(next)
    } catch (reason) {
      setError(texteMaintenant('wf.erreur.creation', { raison: raison(reason) }))
    }
  }

  return (
    <section className="workflow-profiles" data-testid="workflow-profiles-view">
      <header className="workflow-profiles-head">
        <div>
          {/* « Workflows » : le même mot en anglais. */}
          <h2>Workflows</h2>
          <p className="workflow-profiles-sub">{t('wf.sousTitre')}</p>
        </div>
        <div className="workflow-profiles-actions">
          <button type="button" onClick={() => void importer()} data-testid="workflow-import">
            <Icone nom="import" />
            {t('wf.importer')}
          </button>
          <button
            type="button"
            onClick={() => void exporter(null)}
            data-testid="workflow-export-all"
            disabled={file.profiles.length === 0}
          >
            <Icone nom="export" />
            {t('wf.toutExporter')}
          </button>
          <button type="button" onClick={() => void create()} data-testid="workflow-create">
            <Icone nom="plus" />
            {t('wf.nouveau')}
          </button>
        </div>
      </header>

      {error && (
        <p className="workflow-profiles-error" role="alert">
          {error}
        </p>
      )}

      {/* Le workflow IMPOSÉ peut avoir été cassé par une édition après sa sélection : `bloque`
          exemptait l'actif, donc plus rien ne le disait. Main le refuse désormais au moteur — ici on
          le dit, sans verrouiller le bouton, qui reste le seul chemin vers la désélection. */}
      {(() => {
        const actifProfil = file.profiles.find((p) => p.id === file.activeId)
        const soucis = actifProfil ? soucisDe(actifProfil) : []
        return soucis.length > 0 && actifProfil ? (
          <p
            className="workflow-profiles-error"
            role="alert"
            data-testid="workflow-active-unrunnable"
          >
            {t('wf.actif.injouable', { nom: actifProfil.name, soucis: soucis.join(' ; ') })}
          </p>
        ) : null
      })()}

      {/* CE QUE « ACTIF » VEUT DIRE (piste 3, conv-1070). Le workflow actif n'est plus qu'une
          VALEUR PAR DÉFAUT (choix de l'utilisateur, 2026-10-22) : le choix automatique passe avant
          lui, et il ne pilote que les demandes pour lesquelles ce choix n'en propose aucun
          (`os.ts`, `poseConversationWorkflow`). Avant, il passait avant tout : 39 démarrages sur 39
          en source `manuel`. */}
      {(() => {
        const actifProfil = file.profiles.find((p) => p.id === file.activeId)
        return actifProfil ? (
          <p className="workflow-profiles-sub" role="note" data-testid="workflow-active-default">
            {t('wf.actif.parDefaut', { nom: actifProfil.name })}
          </p>
        ) : null
      })()}

      {/* L'état vide était gardé par `!loading` mais AUCUNE branche ne couvrait le chargement :
          pendant la lecture, la vue ne rendait ni liste ni message. */}
      {loading && file.profiles.length === 0 ? (
        <p
          className="workflow-profiles-empty"
          role="status"
          aria-busy="true"
          data-testid="workflow-loading"
        >
          <Spinner /> {t('wf.chargement')}
        </p>
      ) : file.profiles.length === 0 && !loading ? (
        <p className="workflow-profiles-empty" data-testid="workflow-empty">
          {t('wf.vide')}
        </p>
      ) : (
        <ul className="workflow-profiles-list">
          {file.profiles.map((profile) => {
            // L'exécutabilité se calcule AVANT d'offrir l'activation : un workflow structurellement
            // mort (phase inconnue, nœud sans agent, arête orpheline) ne doit pas pouvoir partir.
            const issues = soucisDe(profile)
            const actif = file.activeId === profile.id
            const bloque = issues.length > 0 && !actif
            const nom = names[profile.id] ?? profile.name
            return (
              <li
                key={profile.id}
                className={`workflow-profile${actif ? ' is-active' : ''}${issues.length ? ' is-unrunnable' : ''}`}
                data-testid={`workflow-profile-${profile.id}`}
              >
                {/* Ce que ce workflow a DEJA coute et dure, lu du journal des duels : la
                    comparaison n'exige plus de repayer un rejeu. */}
                <p
                  className="workflow-profile-mesures"
                  data-testid={`workflow-mesures-${profile.id}`}
                >
                  {phraseMesures(nom, duels)}
                </p>
                <p
                  className="workflow-profile-mesures"
                  data-testid={`workflow-reels-${profile.id}`}
                >
                  {phraseResultatsReels(nom, reels)}
                </p>
                {/* En-tête sur UNE ligne, puis portée et éditeur PLEINE LARGEUR dessous. Sans cette
                    séparation, la ligne étant un flex horizontal, l'éditeur se retrouvait comprimé
                    dans une colonne entre le bouton de sélection et la croix de suppression. */}
                <div className="workflow-profile-row">
                  <button
                    type="button"
                    className="workflow-profile-pick"
                    data-testid={`workflow-pick-${profile.id}`}
                    aria-pressed={actif}
                    disabled={bloque}
                    // Deux états DISTINCTS, dits ici plutôt qu'en texte de liste : « imposé » = ce
                    // bouton, un seul à la fois ; « invocable » = la case voisine, le chat a le droit
                    // de le choisir lui-même. Ouvrir l'éditeur n'est ni l'un ni l'autre.
                    title={
                      bloque
                        ? t('wf.imposer.bloque', { soucis: issues.join(' ; ') })
                        : t('wf.imposer.titre', { nom: profile.name })
                    }
                    // Re-cliquer le workflow imposé le DÉSÉLECTIONNE. C'est le seul chemin qui reste
                    // vers « aucun workflow imposé » depuis que la ligne « Configuration courante » a
                    // été retirée : sans ce retour, une sélection serait définitive.
                    onClick={() => void select(actif ? null : profile.id)}
                  >
                    <span className="workflow-profile-line">
                      {/* Le nom se corrige SUR PLACE. La frappe vit en local et n'est persistée
                          qu'une fois retombée (300 ms) : une écriture IPC par caractère produisait
                          autant de courses d'écriture que de lettres. */}
                      <input
                        className="workflow-profile-name"
                        data-testid={`workflow-rename-${profile.id}`}
                        value={nom}
                        aria-label={t('wf.renommer.aria', { nom: profile.name })}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => rename(profile, e.target.value)}
                      />
                      {actif && <span className="wf-badge is-on">{t('wf.badge.actif')}</span>}
                      {issues.length > 0 && (
                        <span
                          className="wf-badge is-broken"
                          data-testid={`workflow-unrunnable-${profile.id}`}
                        >
                          {t('wf.badge.injouable')}
                        </span>
                      )}
                      <span className="workflow-profile-summary">{profileSummary(profile)}</span>
                    </span>
                    {profile.description && (
                      <span className="workflow-profile-desc">{profile.description}</span>
                    )}
                  </button>
                  {/* Invocable ou non par le chat. Distinct de la sélection : cocher n'impose rien,
                      décocher retire du choix automatique sans supprimer le workflow. */}
                  <label
                    className="workflow-profile-toggle"
                    title={
                      issues.length > 0
                        ? t('wf.invocable.bloque', { soucis: issues.join(' ; ') })
                        : profile.enabled === false
                          ? t('wf.invocable.non', { nom: profile.name })
                          : t('wf.invocable.oui', { nom: profile.name })
                    }
                  >
                    <input
                      type="checkbox"
                      data-testid={`workflow-enabled-${profile.id}`}
                      // Un workflow injouable laissé « invocable » permettait au ROUTEUR de le
                      // choisir seul : l'échec ne venait alors d'aucun geste de l'utilisateur.
                      disabled={issues.length > 0}
                      checked={profile.enabled !== false}
                      aria-label={t('wf.invocable.aria', { nom: profile.name })}
                      onChange={(e) => void save({ ...profile, enabled: e.target.checked })}
                    />
                  </label>
                  {/* Ouvrir l'éditeur était réservé au workflow imposé : on ne pouvait pas corriger
                      un workflow sans d'abord l'imposer au chat. Les deux gestes sont séparés. */}
                  <button
                    type="button"
                    className="workflow-profile-action"
                    data-testid={`workflow-edit-${profile.id}`}
                    aria-pressed={editingId === profile.id}
                    title={t('wf.editer.titre', { nom: profile.name })}
                    aria-label={t('wf.editer.aria', { nom: profile.name })}
                    onClick={() => setEditingId(editingId === profile.id ? null : profile.id)}
                  >
                    {t('wf.editer')}
                  </button>
                  <button
                    type="button"
                    className="workflow-profile-action"
                    data-testid={`workflow-export-${profile.id}`}
                    title={t('wf.exporter', { nom: profile.name })}
                    aria-label={t('wf.exporter', { nom: profile.name })}
                    onClick={() => void exporter(profile.id)}
                  >
                    <Icone nom="export" />
                  </button>
                  {/* Suppression irréversible et voisine d'Exporter : elle se confirme, et elle ne
                      porte pas la même apparence que son voisin (`is-danger`). */}
                  {confirmRemoveId === profile.id ? (
                    <span
                      className="workflow-profile-confirm"
                      role="alertdialog"
                      aria-label={t('wf.supprimer.confirmerAria', { nom: profile.name })}
                    >
                      <span>{t('wf.supprimer.question')}</span>
                      <button
                        type="button"
                        className="workflow-profile-action is-danger"
                        data-testid={`workflow-remove-confirm-${profile.id}`}
                        onClick={() => {
                          setConfirmRemoveId(null)
                          void remove(profile.id)
                        }}
                      >
                        {t('wf.oui')}
                      </button>
                      <button
                        type="button"
                        className="workflow-profile-action"
                        data-testid={`workflow-remove-cancel-${profile.id}`}
                        onClick={() => setConfirmRemoveId(null)}
                      >
                        {t('wf.non')}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="workflow-profile-action is-danger"
                      data-testid={`workflow-remove-${profile.id}`}
                      title={t('wf.supprimer', { nom: profile.name })}
                      aria-label={t('wf.supprimer', { nom: profile.name })}
                      onClick={() => setConfirmRemoveId(profile.id)}
                    >
                      <Icone nom="poubelle" />
                    </button>
                  )}
                </div>
                {issues.length > 0 && (
                  <ul
                    className="workflow-profile-issues"
                    data-testid={`workflow-issues-${profile.id}`}
                  >
                    {issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
                {/* Quel modèle joue quoi, RÉELLEMENT : le workflow imposé écrase la topologie rôle
                    par rôle. Sans cette dérivation, deux sources de vérité cohabitent en silence. */}
                {actif && rolesEffectifs(profile).length > 0 && (
                  <ul
                    className="workflow-profile-roles"
                    data-testid={`workflow-roles-${profile.id}`}
                  >
                    {rolesEffectifs(profile).map((ligne) => (
                      <li key={ligne.role}>
                        <b>{ligne.role}</b> → {ligne.modele}{' '}
                        <em>
                          {ligne.origine === 'workflow'
                            ? t('wf.role.workflow')
                            : t('wf.role.topologie')}
                        </em>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Le PROMPT EFFECTIF : ce que les consignes du workflow enverront réellement,
                    phase par phase, et si elles s'ajoutent ou REMPLACENT le corps de la phase. */}
                {promptEffectif(profile).length > 0 && (
                  <details
                    className="workflow-profile-prompt"
                    data-testid={`workflow-prompt-${profile.id}`}
                  >
                    <summary>
                      {t('wf.prompt')}
                      {profile.instructions?.mode === 'replace' ? (
                        <span
                          className="wf-badge is-broken"
                          data-testid={`workflow-prompt-replace-${profile.id}`}
                        >
                          {t('wf.prompt.remplace')}
                        </span>
                      ) : (
                        <span className="wf-badge">{t('wf.prompt.ajoute')}</span>
                      )}
                    </summary>
                    <ul>
                      {promptEffectif(profile).map((ligne) => (
                        <li key={`${ligne.phase}-${ligne.origine}`}>
                          <b>{ligne.phase}</b>{' '}
                          <em>
                            {ligne.origine === 'phase'
                              ? t('wf.prompt.phase')
                              : t('wf.prompt.globale')}
                          </em>
                          <blockquote>{ligne.texte}</blockquote>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {/* La portée reste visible même quand l'éditeur est ouvert : on ne perd jamais la
                    vue d'ensemble. */}
                <WorkflowTrack profile={profile} />
                {editingId === profile.id && (
                  <WorkflowGraphEditor
                    profile={profile}
                    onSave={(graph) => void save({ ...profile, graph })}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
