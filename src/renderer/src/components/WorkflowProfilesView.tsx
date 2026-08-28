import { useEffect, useRef, useState } from 'react'
import { WorkflowBenchPanel } from './WorkflowBenchPanel'
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

export function WorkflowProfilesView({ active }: { active: boolean }): React.JSX.Element {
  const [file, setFile] = useState<ProfilesFile>({ profiles: [], activeId: null })
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
        if (!cancelled) setError(`Impossible de lire les workflows : ${raison(reason)}`)
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
      setError(`La sélection n’a pas pu être enregistrée : ${raison(reason)}`)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setError(undefined)
    try {
      const next = (await window.api.workflowProfileRemove?.(id)) as ProfilesFile | undefined
      if (next) setFile(next)
      if (editingId === id) setEditingId(null)
    } catch (reason) {
      setError(`La suppression a échoué : ${raison(reason)}`)
    }
  }

  const save = async (profile: WorkflowProfile): Promise<void> => {
    setError(undefined)
    try {
      const next = (await window.api.workflowProfileSave?.(profile)) as ProfilesFile | undefined
      if (next) setFile(next)
    } catch (reason) {
      setError(`L’enregistrement a échoué : ${raison(reason)}`)
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
          setError(`Le renommage a échoué : ${raison(reason)}`)
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
      if (res && !res.ok && res.reason && res.reason !== 'annulé')
        setError(`Export : ${res.reason}`)
    } catch (reason) {
      setError(`L’export a échoué : ${raison(reason)}`)
    }
  }

  const importer = async (): Promise<void> => {
    setError(undefined)
    try {
      const res = await window.api.workflowProfilesImport?.()
      if (!res) return
      if (res.file) setFile(res.file)
      if (!res.ok && res.reason && res.reason !== 'annulé') {
        setError(`Import : ${res.reason}`)
        return
      }
      // Ce qui a été ÉCARTÉ se dit : un import silencieux qui perd la moitié du fichier ment.
      if (res.rejected?.length) {
        setError(
          `${res.imported ?? 0} workflow(s) importé(s) ; ${res.rejected.length} écarté(s) : ${res.rejected.join(', ')}`
        )
      }
    } catch (reason) {
      setError(`L’import a échoué : ${raison(reason)}`)
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
        name: `Workflow ${rang}`
      })) as ProfilesFile | undefined
      if (next) setFile(next)
    } catch (reason) {
      setError(`La création a échoué : ${raison(reason)}`)
    }
  }

  return (
    <section className="workflow-profiles" data-testid="workflow-profiles-view">
      <header className="workflow-profiles-head">
        <div>
          <h2>Workflows</h2>
          <p className="workflow-profiles-sub">
            Une façon de travailler nommée — modèles, efforts, phases, consignes. Sélectionne-la
            pour comparer plus tard le même objectif sous plusieurs workflows.
          </p>
        </div>
        <div className="workflow-profiles-actions">
          <button type="button" onClick={() => void importer()} data-testid="workflow-import">
            <Icone nom="import" />
            Importer
          </button>
          <button
            type="button"
            onClick={() => void exporter(null)}
            data-testid="workflow-export-all"
            disabled={file.profiles.length === 0}
          >
            <Icone nom="export" />
            Tout exporter
          </button>
          <button type="button" onClick={() => void create()} data-testid="workflow-create">
            <Icone nom="plus" />
            Nouveau
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
            Workflow « {actifProfil.name} » imposé au chat mais NON EXÉCUTABLE :{' '}
            {soucis.join(' ; ')}. Il ne sera pas joué — corrige-le ou re-clique-le pour le
            désélectionner.
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
          <Spinner /> Chargement des workflows…
        </p>
      ) : file.profiles.length === 0 && !loading ? (
        <p className="workflow-profiles-empty" data-testid="workflow-empty">
          Aucun workflow pour l’instant. Crée-en un pour figer une façon de travailler et pouvoir la
          comparer à une autre.
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
                        ? `Non exécutable : ${issues.join(' ; ')}`
                        : `Imposer ${profile.name} au chat — la case à côté dit seulement si le chat a le droit de l’invoquer lui-même, et le bouton Éditer n’impose rien`
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
                        aria-label={`Nom du workflow ${profile.name}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => rename(profile, e.target.value)}
                      />
                      {actif && <span className="wf-badge is-on">actif</span>}
                      {issues.length > 0 && (
                        <span
                          className="wf-badge is-broken"
                          data-testid={`workflow-unrunnable-${profile.id}`}
                        >
                          non exécutable
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
                        ? `Non exécutable : ${issues.join(' ; ')} — le chat ne peut pas l’invoquer tant que ce n’est pas corrigé`
                        : profile.enabled === false
                          ? `${profile.name} : le chat ne peut pas l’invoquer`
                          : `${profile.name} : le chat peut l’invoquer`
                    }
                  >
                    <input
                      type="checkbox"
                      data-testid={`workflow-enabled-${profile.id}`}
                      // Un workflow injouable laissé « invocable » permettait au ROUTEUR de le
                      // choisir seul : l'échec ne venait alors d'aucun geste de l'utilisateur.
                      disabled={issues.length > 0}
                      checked={profile.enabled !== false}
                      aria-label={`Rendre ${profile.name} invocable par le chat`}
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
                    title={`Ouvrir l’éditeur de ${profile.name} sans l’imposer au chat`}
                    aria-label={`Ouvrir l’éditeur de ${profile.name}`}
                    onClick={() => setEditingId(editingId === profile.id ? null : profile.id)}
                  >
                    Éditer
                  </button>
                  <button
                    type="button"
                    className="workflow-profile-action"
                    data-testid={`workflow-export-${profile.id}`}
                    title={`Exporter ${profile.name}`}
                    aria-label={`Exporter ${profile.name}`}
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
                      aria-label={`Confirmer la suppression de ${profile.name}`}
                    >
                      <span>Supprimer ?</span>
                      <button
                        type="button"
                        className="workflow-profile-action is-danger"
                        data-testid={`workflow-remove-confirm-${profile.id}`}
                        onClick={() => {
                          setConfirmRemoveId(null)
                          void remove(profile.id)
                        }}
                      >
                        Oui
                      </button>
                      <button
                        type="button"
                        className="workflow-profile-action"
                        data-testid={`workflow-remove-cancel-${profile.id}`}
                        onClick={() => setConfirmRemoveId(null)}
                      >
                        Non
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="workflow-profile-action is-danger"
                      data-testid={`workflow-remove-${profile.id}`}
                      title={`Supprimer ${profile.name}`}
                      aria-label={`Supprimer ${profile.name}`}
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
                            ? '(imposé par ce workflow)'
                            : '(topologie)'}
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
                      Prompt effectif
                      {profile.instructions?.mode === 'replace' ? (
                        <span
                          className="wf-badge is-broken"
                          data-testid={`workflow-prompt-replace-${profile.id}`}
                        >
                          remplace les consignes de phase
                        </span>
                      ) : (
                        <span className="wf-badge">s’ajoute aux consignes de phase</span>
                      )}
                    </summary>
                    <ul>
                      {promptEffectif(profile).map((ligne) => (
                        <li key={`${ligne.phase}-${ligne.origine}`}>
                          <b>{ligne.phase}</b>{' '}
                          <em>{ligne.origine === 'phase' ? '(consigne de phase)' : '(globale)'}</em>
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

      <WorkflowBenchPanel profiles={file.profiles} />
    </section>
  )
}
