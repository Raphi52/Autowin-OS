/**
 * SECTION « Logs » du panneau droit : la TRACE de ce que les modèles ont fait dans la conversation
 * ouverte — appel modèle, raisonnement, commande, verdict, artefact, erreur, fin de tour.
 *
 * Deux sources, fusionnées par `buildModelActivityLog` : le journal fichier du tour (le plus
 * complet, mais nettoyé après 7 jours) et les parts persistées du message (durables). Le composant
 * ne fait QUE : charger les journaux des tours affichés, et rendre le résultat du modèle pur.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import './ModelActivityLogPane.css'
import type { Msg } from './chat-view-types'
import { HumanJson } from './HumanJson'
import { deltaMs, grouperParTour, type ModelActivityTour } from './model-activity-tours'
import { detailCourt, titreCourt } from './model-log-court'
import {
  assemblerJournal,
  detailCausal,
  lignesDesSources,
  lignesDuFil,
  type ModelActivityEntry,
  type ModelActivityKind,
  type ModelActivitySource
} from './model-activity-log'

const KIND_LABEL: Record<ModelActivityKind, string> = {
  prompt: 'Demande',
  'model-call': 'Modèle',
  reasoning: 'Réflexion',
  text: 'Réponse',
  action: 'Action',
  artifact: 'Artefact',
  error: 'Erreur',
  done: 'Fin',
  injection: 'Injection',
  boundary: 'Frontière',
  usage: 'Coût',
  status: 'Signe de vie',
  brain: 'Brain',
  agent: 'Sous-agent',
  fichiers: 'Fichiers',
  event: 'Journal'
}

/**
 * Nombre de lignes RENDUES par défaut. Le journal réunit désormais quatre sources et vise à
 * remplacer l'Observatory : il devient ÉNORME. Rendre tout le filtré faisait un nœud DOM par ligne
 * (mesuré : 20 000 lignes = 20 000 nœuds, plusieurs secondes de rendu). On affiche donc la FIN —
 * l'activité récente, comme le fil — et on remonte à la demande. Rien n'est perdu : le compte total
 * reste affiché et le bouton dit combien de lignes plus anciennes attendent.
 */
const FENETRE = 300

const SOURCE_LABEL: Record<ModelActivitySource, string> = {
  thread: 'fil',
  journal: 'journal',
  parts: 'persisté',
  causal: 'trace causale',
  activity: 'activité',
  brain: 'brain',
  prompts: 'prompt envoyé',
  bureaux: 'copie de travail',
  fichiers: 'trace fichiers'
}

/**
 * ORDRE DES PISTES — une source = une voie, toujours à la MÊME position horizontale. C'est ce qui
 * rend la lecture « parallèle » possible dans 300 px : l'origine se lit à la POSITION du trait, pas
 * à un texte. Seules les sources réellement présentes prennent une voie (aucune voie vide).
 */
const SOURCE_ORDRE: readonly ModelActivitySource[] = [
  'thread',
  'prompts',
  'journal',
  'parts',
  'causal',
  'activity',
  'brain',
  'bureaux',
  'fichiers'
]

/** Heure locale HH:MM:SS — le journal n'écrit qu'un epoch, et parfois rien du tout. */
function heure(at?: number): string | null {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  return new Date(at).toLocaleTimeString('fr-FR', { hour12: false })
}

/** Durée lisible d'un tour : ms sous la seconde, sinon secondes, sinon minutes. */
function duree(ms: number): string {
  if (ms < 1_000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1_000)} s`
}

/**
 * RELIRE N'EST PAS RECALCULER (conv-252, 2026-10-11 : « corrige l'onglet Logs pour qu'il ne
 * recalcule plus tout le journal toutes les 2 à 4 s quand rien n'a changé »).
 *
 * Mesure du 2026-10-11 12:00-12:02 (`gels.jsonl`) : pendant un tour vivant, le panneau droit tenait
 * l'affichage 1,1 à 2,8 s toutes les 2 à 4 s — le rythme exact des deux relectures ci-dessous. Chaque
 * relecture posait un tableau NEUF même identique : `buildModelActivityLog` refaisait tout le journal.
 * Une relecture ne pose donc sa source que si son EMPREINTE a changé ; identique, l'ancienne référence
 * reste, et React ne rend ni ne recalcule rien. L'empreinte est exacte (le JSON entier), pas un
 * compte de lignes : une ligne modifiée sur place est vue aussi.
 */
let empreinteIllisible = 0
function empreinte(valeur: unknown): string {
  try {
    return JSON.stringify(valeur) ?? ''
  } catch {
    // Jamais vu par IPC (clonage structuré) ; illisible = toujours « changé », jamais « identique ».
    empreinteIllisible += 1
    return `\u0000illisible-${empreinteIllisible}`
  }
}

function memesEmpreintes(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false
  for (const [cle, valeur] of a) if (b.get(cle) !== valeur) return false
  return true
}

type Lignes = ReadonlyArray<Record<string, unknown>>

/**
 * LA TRACE ALLÉGÉE, comme le graphe (`WorkflowExecutionGraph`, décision du 2026-10-10) : la structure
 * sans les contenus, relue toutes les 4 s ; les contenus d'une étape sont relus quand on DÉPLIE sa
 * ligne (`LogRow`). En dev, le pont peut garder son ancienne version jusqu'au redémarrage : sans les
 * deux canaux, on relit la trace complète, comme avant — plus lent, jamais cassé.
 */
function traceAllegeeDisponible(): boolean {
  return (
    typeof window.api?.causalTraceGraphe === 'function' &&
    typeof window.api?.causalTraceCharges === 'function'
  )
}

export type ModelActivityLogPaneProps = {
  conversationId: string | null
  messages: readonly Msg[]
  /** Un tour est en cours : on recharge les journaux pour suivre l'activité vivante. */
  live?: boolean
}

export function ModelActivityLogPane({
  conversationId,
  messages,
  live
}: ModelActivityLogPaneProps): React.JSX.Element {
  const [journalByTurn, setJournalByTurn] = useState<
    Record<string, ReadonlyArray<Record<string, unknown>>>
  >({})
  const [filtre, setFiltre] = useState('')
  // Les DEUX sources que ce panneau ignorait : la trace causale (ce qu'analysait l'Observatory) et
  // le journal d'activite facturee (provider, tokens, cout, duree).
  const [causal, setCausal] = useState<ReadonlyArray<Record<string, unknown>>>([])
  const [activity, setActivity] = useState<ReadonlyArray<Record<string, unknown>>>([])
  const [kindMasque, setKindMasque] = useState<ModelActivityKind | ''>('')
  const [sourceMasquee, setSourceMasquee] = useState<ModelActivitySource | ''>('')
  const [erreursSeules, setErreursSeules] = useState(false)
  // Vue PISTES : chaque source occupe une voie fixe à gauche de l'heure. MASQUÉE d'office
  // (conv-247, 2026-10-11 : « enlève la colonne tout à gauche ») — la ligne unique commence à
  // l'heure ; le bouton Pistes la réaffiche, et la source reste lisible dans la carte dépliée.
  const [pistes, setPistes] = useState(false)
  // La SIXIEME source, et la seule qui disait ce que le modele avait LU avant de repondre : les
  // recuperations Brain et les faits deposes. Elle n'atteignait que l'Observatory.
  const [brain, setBrain] = useState<ReadonlyArray<Record<string, unknown>>>([])
  // SEPTIEME source : le prompt REELLEMENT parti au modele, appel par appel.
  const [promptCalls, setPromptCalls] = useState<ReadonlyArray<Record<string, unknown>>>([])
  // HUITIEME source : ce que les sous-agents ont fait dans leur copie de travail isolee.
  const [bureaux, setBureaux] = useState<ReadonlyArray<Record<string, unknown>>>([])
  // NEUVIEME source : ce que le travail a reellement touche sur le disque, tour par tour.
  const [fichiers, setFichiers] = useState<ReadonlyArray<Record<string, unknown>>>([])
  // Fenêtre d'affichage PAR sélection (conversation + filtres) : changer de filtre repart donc de
  // la taille par défaut sans le moindre effet, et revenir à une sélection retrouve sa fenêtre.
  const [fenetres, setFenetres] = useState<Record<string, number>>({})
  const listRef = useRef<HTMLDivElement | null>(null)

  // CLÉ des tours, et non le tableau `messages` : celui-ci change à CHAQUE fragment de stream, ce
  // qui relancerait la lecture des journaux des dizaines de fois par seconde.
  const turnKey = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => (message as { turnId?: string }).turnId)
    .filter((turnId): turnId is string => Boolean(turnId))
    .join('|')

  // Ce qui est POSÉ dans l'état, avec l'empreinte de chaque source : une relecture identique ne
  // repose rien (voir `empreinte`). Écrits seulement par les relectures, jamais pendant le rendu.
  const journalPose = useRef<Record<string, Lignes>>({})
  const empreintesTours = useRef<ReadonlyMap<string, string>>(new Map())
  const empreintesSources = useRef<Record<string, string>>({})

  // Chargement des journaux : TOUS les tours à l'ouverture, quand la liste des tours change et à la
  // fin d'un tour ; en boucle courte, tant qu'un tour est VIVANT, le SEUL dernier tour — un tour
  // terminé n'écrit plus son journal, le relire toutes les 2 s tenait le processus principal
  // (`ipc:runs:turnJournal (sync)`, 1,5 s le 2026-10-11 à 11:04).
  useEffect(() => {
    if (!conversationId) return
    const turnIds = turnKey ? turnKey.split('|') : []
    let annule = false
    const charger = async (ids: readonly string[], complet: boolean): Promise<void> => {
      const lecture = await Promise.all(
        ids.map(async (turnId) => {
          try {
            const events = ((await window.api?.turnJournal?.(conversationId, turnId)) ??
              []) as Lignes
            return [turnId, events] as const
          } catch {
            // Journal absent (nettoyé) : le tour reste tracé par ses parts durables.
            return [turnId, [] as Lignes] as const
          }
        })
      )
      if (annule) return
      // `complet` remplace tout (autre conversation, autre liste de tours) ; sinon le tour relu
      // complète ce qui est déjà posé.
      const empreintes = new Map(complet ? [] : empreintesTours.current)
      const suivant: Record<string, Lignes> = complet ? {} : { ...journalPose.current }
      for (const [turnId, events] of lecture) {
        if (events.length > 0) {
          empreintes.set(turnId, empreinte(events))
          suivant[turnId] = events
        } else {
          empreintes.delete(turnId)
          delete suivant[turnId]
        }
      }
      if (memesEmpreintes(empreintes, empreintesTours.current)) return
      empreintesTours.current = empreintes
      journalPose.current = suivant
      setJournalByTurn(suivant)
    }
    void charger(turnIds, true)
    const vivant = turnIds.at(-1)
    if (!live || !vivant)
      return () => {
        annule = true
      }
    const timer = setInterval(() => void charger([vivant], false), 2_000)
    return () => {
      annule = true
      clearInterval(timer)
    }
  }, [conversationId, turnKey, live])

  // Trace causale et activite facturee sont scopees a la CONVERSATION (pas au tour) : une seule
  // lecture, rejouee tant qu'un tour est vivant.
  useEffect(() => {
    // Pas de reinitialisation ICI : un `setState` synchrone dans un effet cascade les rendus. Sans
    // conversation il n'y a rien a lire, et l'affichage derive de `conversationId` plus bas.
    if (!conversationId) return
    let annule = false
    /** Pose une source relue SEULEMENT si son contenu a changé depuis la dernière pose. */
    const poserSiChange = (cle: string, lignes: Lignes, poser: (valeur: Lignes) => void): void => {
      const signe = empreinte(lignes)
      if (empreintesSources.current[cle] === signe) return
      empreintesSources.current[cle] = signe
      poser(lignes)
    }
    const charger = async (): Promise<void> => {
      const [trace, activite, savoir, appels, copies, touches] = await Promise.all([
        (traceAllegeeDisponible()
          ? window.api.causalTraceGraphe(conversationId).catch(() => [])
          : window.api?.causalTrace?.(conversationId).catch(() => [])) ?? [],
        window.api?.conversationActivity?.(conversationId).catch(() => []) ?? [],
        // Le spool Brain porte TOUTES les conversations : on ne garde que la nôtre.
        window.api?.brainTraces?.(conversationId).catch(() => []) ?? [],
        window.api?.promptCalls?.(conversationId).catch(() => []) ?? [],
        window.api?.getWorktreeActivity?.(conversationId).catch(() => []) ?? [],
        window.api?.conversationFileTraces?.(conversationId).catch(() => []) ?? []
      ])
      if (annule) return
      poserSiChange('causal', (trace ?? []) as Lignes, setCausal)
      poserSiChange('activite', (activite ?? []) as Lignes, setActivity)
      poserSiChange('appels', (appels ?? []) as Lignes, setPromptCalls)
      poserSiChange('copies', (copies ?? []) as Lignes, setBureaux)
      poserSiChange('fichiers', (touches ?? []) as Lignes, setFichiers)
      poserSiChange(
        'brain',
        ((savoir ?? []) as Lignes).filter(
          (item) => !item.conversationId || item.conversationId === conversationId
        ),
        setBrain
      )
    }
    void charger()
    if (!live)
      return () => {
        annule = true
      }
    const timer = setInterval(() => void charger(), 4_000)
    return () => {
      annule = true
      clearInterval(timer)
    }
  }, [conversationId, turnKey, live])

  // TROIS calculs, et non un seul (voir `assemblerJournal`) : un fragment de réponse change
  // `messages` seul, il ne refait donc que les lignes du FIL ; les six sources ne se recalculent
  // qu'avec leurs relectures (qui ne posent rien quand rien n'a changé).
  const lignesSources = useMemo(
    () =>
      lignesDesSources({
        // DERIVE, pas remis a zero par un effet : sans conversation, ces sources n'existent pas.
        causal: conversationId ? causal : [],
        activity: conversationId ? activity : [],
        brain: conversationId ? brain : [],
        promptCalls: conversationId ? promptCalls : [],
        bureaux: conversationId ? bureaux : [],
        fichiers: conversationId ? fichiers : []
      }),
    [causal, activity, brain, promptCalls, bureaux, fichiers, conversationId]
  )
  const lignesFil = useMemo(() => lignesDuFil(messages, journalByTurn), [messages, journalByTurn])
  const entries = useMemo(
    () => assemblerJournal(lignesFil, lignesSources),
    [lignesFil, lignesSources]
  )
  const motif = filtre.trim().toLowerCase()
  const visibles = entries.filter((entry) => {
    // Le rouge d'abord : chercher un echec parmi des milliers de lignes vertes est la premiere
    // chose qu'on vient faire ici, et rien ne le permettait.
    if (erreursSeules && entry.ok !== false && entry.kind !== 'error') return false
    if (kindMasque && entry.kind !== kindMasque) return false
    if (sourceMasquee && entry.source !== sourceMasquee) return false
    if (!motif) return true
    return `${entry.label} ${entry.detail ?? ''} ${KIND_LABEL[entry.kind]} ${SOURCE_LABEL[entry.source]}`
      .toLowerCase()
      .includes(motif)
  })
  // On ne rend que la FIN de ce que le filtre retient ; le reste est atteignable par le bouton.
  const selection = `${conversationId ?? ''}|${motif}|${kindMasque}|${sourceMasquee}|${erreursSeules}`
  const fenetre = fenetres[selection] ?? FENETRE
  const affichees =
    fenetre >= visibles.length ? visibles : visibles.slice(visibles.length - fenetre)
  const plusAnciennes = visibles.length - affichees.length
  // Les gestes sont RANGES par tour : sans cet en-tete, une liste plate de milliers de lignes ne
  // dit plus quel tour a fait quoi, ni ce qu'il a coute.
  const tours = grouperParTour(affichees)
  // Les listes de filtres viennent des lignes REELLEMENT presentes : jamais une categorie vide.
  const kindsPresents = [...new Set(entries.map((entry) => entry.kind))]
  const sourcesPresentes = [...new Set(entries.map((entry) => entry.source))]
  // Les VOIES : sources présentes, rangées dans l'ordre stable ci-dessus.
  const voies = SOURCE_ORDRE.filter((source) => sourcesPresentes.includes(source)).concat(
    sourcesPresentes.filter((source) => !SOURCE_ORDRE.includes(source))
  )
  const voieDe = new Map(voies.map((source, index) => [source, index] as const))

  // Le journal se lit par la FIN : l'activité récente est en bas, comme le fil.
  useEffect(() => {
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [affichees.length])

  return (
    <div className="col grow model-log" style={{ minHeight: 0, gap: 'var(--s2)' }}>
      <div className="model-log-filter">
        <input
          className="input"
          type="search"
          value={filtre}
          onChange={(event) => setFiltre(event.target.value)}
          placeholder="Filtrer les logs…"
          aria-label="Filtrer les logs"
        />
        <select
          className="input"
          aria-label="Filtrer par nature"
          value={kindMasque}
          onChange={(event) => setKindMasque(event.target.value as ModelActivityKind | '')}
        >
          <option value="">Tout</option>
          {kindsPresents.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Filtrer par source"
          value={sourceMasquee}
          onChange={(event) => setSourceMasquee(event.target.value as ModelActivitySource | '')}
        >
          <option value="">Toutes sources</option>
          {sourcesPresentes.map((source) => (
            <option key={source} value={source}>
              {SOURCE_LABEL[source]}
            </option>
          ))}
        </select>
        {/* Le compte dit ce que le filtre a retenu SUR le total : sans lui, un filtre trop etroit
            ressemble a un journal vide. */}
        <button
          type="button"
          className={`btn ghost model-log-toggle${erreursSeules ? ' is-on' : ''}`}
          aria-pressed={erreursSeules}
          data-testid="model-log-erreurs"
          onClick={() => setErreursSeules((prev) => !prev)}
          title="N’afficher que les gestes en échec"
        >
          Erreurs
        </button>
        <button
          type="button"
          className={`btn ghost model-log-toggle${pistes ? ' is-piste' : ''}`}
          aria-pressed={pistes}
          data-testid="model-log-pistes"
          onClick={() => setPistes((prev) => !prev)}
          title="Afficher une voie par source, à position fixe"
        >
          Pistes
        </button>
        <button
          type="button"
          className="btn ghost model-log-toggle"
          data-testid="model-log-export"
          onClick={() => void navigator.clipboard?.writeText(JSON.stringify(visibles, null, 2))}
          title="Copier les lignes affichées, filtres compris, au format JSON"
        >
          Exporter
        </button>
        {entries.length > 0 && (
          <span className="model-log-count">
            {visibles.length === entries.length
              ? `${entries.length}`
              : `${visibles.length}/${entries.length}`}
          </span>
        )}
      </div>
      {/* Plus de LÉGENDE des voies en tête (conv-247, 2026-10-11 : « enlève la légende en haut
          des logs ») : la source se lit dans la carte dépliée et s'isole par le menu des sources. */}
      <div
        ref={listRef}
        className="scroll-y col grow model-log-list"
        data-testid="model-activity-log"
        data-pistes={pistes ? 'true' : 'false'}
        style={{ minHeight: 0, ['--piste-total' as string]: String(voies.length) }}
      >
        {visibles.length === 0 && (
          <div className="model-log-empty">
            {conversationId
              ? 'Aucune activité modèle tracée pour l’instant — chaque appel, commande, verdict et artefact s’inscrira ici.'
              : 'Sélectionne une conversation pour lire ce que les modèles y ont fait.'}
          </div>
        )}
        {plusAnciennes > 0 && (
          <button
            type="button"
            className="btn ghost model-log-more-btn"
            data-testid="model-log-plus"
            onClick={() =>
              setFenetres((prev) => ({
                ...prev,
                [selection]: (prev[selection] ?? FENETRE) + FENETRE
              }))
            }
          >
            Afficher plus ancien ({plusAnciennes})
          </button>
        )}
        {tours.map((tour) => (
          <section key={tour.turnId} className="model-log-tour" data-testid="model-log-tour">
            <details open>
              <summary className="model-log-tour__head">
                <strong>Tour {tour.index}</strong>
                {/* Sans heure de début, pas de case « — » : elle se lisait comme un tiret
                    entre le rang et les chiffres (conv-247, 2026-10-11). */}
                {heure(tour.debut) ? <span>{heure(tour.debut)}</span> : null}
                <span>{tour.entries.length} gestes</span>
                {typeof tour.dureeMs === 'number' && <span>{duree(tour.dureeMs)}</span>}
                {typeof tour.tokens === 'number' && (
                  <span>{tour.tokens.toLocaleString('fr-FR')} tokens</span>
                )}
                {typeof tour.cout === 'number' && <span>{tour.cout.toFixed(4)} $</span>}
                {tour.erreur && <span className="model-log-tour__ko">échec</span>}
              </summary>
              {/* La FRISE : un trait continu traverse le tour, une perle par geste. */}
              <div className="model-log-frise">
                {tour.entries.map((entry) => (
                  <LogRow
                    key={entry.id}
                    entry={entry}
                    tour={tour}
                    voie={pistes ? voieDe.get(entry.source) : undefined}
                    conversationId={conversationId}
                  />
                ))}
              </div>
            </details>
          </section>
        ))}
      </div>
    </div>
  )
}

/**
 * Contenus ENTIERS d'une étape de la trace, relus quand on déplie sa ligne : la liste n'en reçoit que
 * la structure (`traceAllegeeDisponible`). La trace est en ajout seul : une fois relus, ils ne
 * changent plus, la ligne les garde.
 */
type ContenusEtape = { enCours: true } | { detail?: string; charges: Lignes } | { erreur: string }

function LogRow({
  entry,
  tour,
  voie,
  conversationId
}: {
  entry: ModelActivityEntry
  tour?: ModelActivityTour
  /** Index de la voie de la source, ou `undefined` quand la vue pistes est repliée. */
  voie?: number
  conversationId?: string | null
}): React.JSX.Element {
  const [contenus, setContenus] = useState<ContenusEtape | null>(null)
  // Garde IMMÉDIATE, pas l'état : deux signaux « ouvert » peuvent arriver avant le rendu suivant, et
  // chacun aurait relu les mêmes contenus. Relâchée sur échec : redéplier retente.
  const lectureDemandee = useRef(false)
  const eventId =
    entry.source === 'causal' && typeof entry.fields?.id === 'string' ? entry.fields.id : undefined
  const surOuverture = (ouvert: boolean): void => {
    if (!ouvert || lectureDemandee.current || !conversationId || !eventId) return
    if (!traceAllegeeDisponible()) return
    const charges = Array.isArray(entry.fields?.payloads) ? (entry.fields.payloads as Lignes) : []
    const genres = [...new Set(charges.map((charge) => String(charge.kind ?? '')))].filter(Boolean)
    if (genres.length === 0) return
    lectureDemandee.current = true
    setContenus({ enCours: true })
    window.api
      .causalTraceCharges(conversationId, [eventId], genres)
      .then((lues) => {
        const entieres = (lues?.[eventId] ?? []) as unknown as Lignes
        setContenus({
          detail: detailCausal({ ...entry.fields, payloads: entieres }),
          charges: entieres
        })
      })
      .catch((raison: unknown) => {
        lectureDemandee.current = false
        setContenus({ erreur: raison instanceof Error ? raison.message : String(raison) })
      })
  }
  // Ce que la carte dépliée montre : les contenus relus quand ils sont là, la structure sinon.
  const detailDeplie = contenus && 'charges' in contenus ? contenus.detail : entry.detail
  const champsDeplies =
    contenus && 'charges' in contenus && entry.fields
      ? { ...entry.fields, payloads: contenus.charges }
      : entry.fields
  // Ecart depuis le debut du tour : l'heure absolue ne dit pas ou le temps est parti.
  const ecart = tour ? deltaMs(entry, tour) : undefined
  const dot =
    entry.ok === false
      ? 'st-err'
      : entry.ok === true
        ? 'st-ok'
        : entry.kind === 'error'
          ? 'st-err'
          : ''
  // LIGNE UNIQUE (conv-247, 2026-10-11, maquette « tour 4 » pistes 2 + 3 + 4) : au repos, nature +
  // titre COURT + résumé gris tiennent sur une ligne ; le texte complet, la source, l'écart et les
  // champs bruts clé par clé vivent dans la carte dépliée. Le filtre et l'export lisent toujours
  // l'entrée complète : seul l'affichage est raccourci.
  const nature = KIND_LABEL[entry.kind]
  const titre = titreCourt(entry.label, nature)
  // « Demande · Demande » ne disait rien : quand le titre répète la nature, le texte prend sa place.
  const titreAffiche = titre ?? detailCourt(entry.detail ?? entry.label)
  const resume = titre !== null && entry.detail ? detailCourt(entry.detail) : null
  return (
    <div
      className="model-log-row"
      data-log-kind={entry.kind}
      data-log-ok={entry.ok === undefined ? undefined : String(entry.ok)}
      title={entry.turnId ? `tour ${entry.turnId}` : undefined}
    >
      {typeof voie === 'number' && (
        <span
          className="model-log-piste"
          data-piste-source={entry.source}
          data-piste-index={voie}
          style={{ ['--piste' as string]: String(voie) }}
          aria-hidden="true"
        />
      )}
      {/* L'heure SEULE, à gauche de la frise : les heures s'alignent en colonne et la carte garde
          toute sa largeur pour le contenu. */}
      {/* Sans heure, la colonne reste (alignement) mais VIDE : un « — » par ligne faisait un trait
          horizontal sur toute la colonne (conv-247, 2026-10-11). */}
      <time className="model-log-time">{heure(entry.at) ?? ''}</time>
      <span className="model-log-perle" aria-hidden="true" />
      <div className="model-log-carte">
        <details
          className="model-log-detail"
          data-testid="model-log-detail"
          onToggle={(evenement) => surOuverture(evenement.currentTarget.open)}
        >
          <summary className="model-log-head">
            {dot ? <span className={`status-dot ${dot}`} /> : null}
            <span className="model-log-kind">{nature}</span>
            {/* Sans résumé gris à côté, le titre prend toute la ligne (« is-plein ») ; quand il
                porte le texte de la demande ou de la réflexion, il garde une graisse normale. */}
            <span
              className={`model-log-label${titre === null ? ' is-texte' : ''}${resume ? '' : ' is-plein'}`}
            >
              {titreAffiche}
            </span>
            {resume ? <span className="model-log-resume">{resume}</span> : null}
            <span className="model-log-chevron" aria-hidden="true">
              ›
            </span>
          </summary>
          <div className="model-log-expand">
            {detailDeplie ? <div className="model-log-texte">{detailDeplie}</div> : null}
            {contenus && 'enCours' in contenus ? (
              <div className="model-log-texte" data-testid="model-log-contenus-en-cours">
                Lecture du contenu…
              </div>
            ) : null}
            {contenus && 'erreur' in contenus ? (
              <div className="model-log-texte" data-testid="model-log-contenus-erreur">
                Contenu illisible : {contenus.erreur}
              </div>
            ) : null}
            <div className="model-log-meta">
              <span className="model-log-source" data-log-source={entry.source}>
                {SOURCE_LABEL[entry.source]}
              </span>
              {typeof ecart === 'number' && ecart > 0 && (
                <span className="model-log-delta">+{duree(ecart)}</span>
              )}
              {titre !== null && titre !== entry.label ? (
                <span className="model-log-titre-complet">{entry.label}</span>
              ) : null}
              {entry.turnId ? <span>tour {entry.turnId}</span> : null}
              <span>id {entry.id}</span>
              {typeof entry.at === 'number' ? (
                <span>{new Date(entry.at).toISOString()}</span>
              ) : null}
              <button
                type="button"
                className="model-log-copy"
                onClick={(clic) => {
                  clic.preventDefault()
                  void navigator.clipboard?.writeText(JSON.stringify(entry, null, 2))
                }}
              >
                Copier
              </button>
            </div>
            {champsDeplies ? <HumanJson className="model-log-json" value={champsDeplies} /> : null}
          </div>
        </details>
      </div>
    </div>
  )
}
