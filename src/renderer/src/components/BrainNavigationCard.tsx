import { useState } from 'react'

interface BrainNavigationCandidate {
  rank: number
  path: string
  type: string
  denseCos: number
  retained: boolean
  chunkByteStart?: number
  chunkByteEnd?: number
}
interface BrainNavigation {
  query: string
  minDense: number
  root?: string
  candidates: BrainNavigationCandidate[]
}
export interface BrainTraceView {
  timestamp: string
  conversationId: string
  query: string
  injectedChars: number
  navigation?: BrainNavigation
}

/**
 * Convertit un offset OCTETS (fichier UTF-8 brut) en index CARACTÈRE dans la string décodée.
 * Les offsets `chunkByteStart/End` sont des positions d'octets ; le surlignage se fait sur le texte
 * (caractères JS). Un accent FR = plusieurs octets → mapping obligatoire, sinon décalage.
 */
function byteToChar(content: string, byteOffset: number): number {
  const bytes = new TextEncoder().encode(content)
  const clamped = Math.max(0, Math.min(byteOffset, bytes.length))
  return new TextDecoder().decode(bytes.slice(0, clamped)).length
}

/** Ligne candidate dépliable : au dépli, charge la note et surligne le passage retenu. */
function CandidateRow({
  candidate,
  root,
  minDense
}: {
  candidate: BrainNavigationCandidate
  root?: string
  minDense: number
}): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')

  const canHighlight =
    typeof candidate.chunkByteStart === 'number' && typeof candidate.chunkByteEnd === 'number'

  const load = async (): Promise<void> => {
    if (state !== 'idle') return
    if (!root) {
      // Trace ANCIENNE (produite avant l'exposition de `root` par le serveur) : on ne peut pas
      // résoudre le chemin absolu → message explicite au lieu d'un dépli vide silencieux.
      setError('trace ancienne (sans racine Brain) — relance une orchestration pour voir la note')
      setState('error')
      return
    }
    setState('loading')
    try {
      // Le path candidat est relatif à la racine Brain → on résout l'absolu (readNodeFile est borné
      // à la racine côté main, donc pas de traversal possible même si le path était malicieux).
      const abs = `${root}/${candidate.path}`
      const res = await window.api.readNodeFile(abs)
      setContent(res?.content ?? '')
      setState('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  const renderBody = (): React.JSX.Element => {
    if (state === 'loading') return <p className="brain-nav-note-status">chargement…</p>
    if (state === 'error') return <p className="brain-nav-note-status">{error}</p>
    if (state !== 'ready') return <></>
    if (!content) return <p className="brain-nav-note-status">note vide ou introuvable</p>
    if (!canHighlight) {
      return <pre className="brain-nav-note">{content}</pre>
    }
    const s = byteToChar(content, candidate.chunkByteStart as number)
    const e = byteToChar(content, candidate.chunkByteEnd as number)
    // Bornes défensives : si le mapping dérape (fichier modifié depuis l'index), on rend sans surlignage.
    if (!(e > s && s >= 0 && e <= content.length)) {
      return <pre className="brain-nav-note">{content}</pre>
    }
    return (
      <pre className="brain-nav-note">
        {content.slice(0, s)}
        <mark className="brain-nav-highlight">{content.slice(s, e)}</mark>
        {content.slice(e)}
      </pre>
    )
  }

  return (
    <li className={candidate.retained ? 'is-retained' : 'is-dropped'}>
      <details
        onToggle={(ev) => {
          if ((ev.currentTarget as HTMLDetailsElement).open) void load()
        }}
      >
        <summary>
          <span className="brain-nav-rank">#{candidate.rank}</span>
          <strong>{candidate.path}</strong>
          <span className="brain-nav-score">dense {candidate.denseCos.toFixed(3)}</span>
          <span className="brain-nav-badge">
            {candidate.retained ? 'retenu → injecté' : `écarté (< ${minDense})`}
          </span>
        </summary>
        {renderBody()}
      </details>
    </li>
  )
}

/**
 * Carte « Navigation Brain » : ce que le Brain a fait pour un tour — requête réelle envoyée, candidats
 * PARCOURUS puis SCORÉS (dense_cos), RETENUS (≥ seuil) vs écartés, et caractères INJECTÉS dans le prompt.
 * Chaque candidat est DÉPLIABLE : au clic, la note .md s'affiche avec le passage retenu surligné.
 * Alimentée par la trace Brain dédiée (os:brainTraces), distincte de la reconstruction RAG depuis l'injecté.
 */
export function BrainNavigationCard({ trace }: { trace: BrainTraceView }): React.JSX.Element {
  const nav = trace.navigation
  const retained = nav?.candidates.filter((c) => c.retained).length ?? 0
  const status = trace.injectedChars > 0 ? 'is-injected' : 'is-absent'
  return (
    <section className={`brain-nav-card ${status}`} data-brain-status={status}>
      <header>
        <span>Navigation Brain</span>
        <strong>
          {nav
            ? `${nav.candidates.length} parcouru${nav.candidates.length > 1 ? 's' : ''} · ${retained} retenu${retained > 1 ? 's' : ''}`
            : 'navigation non exposée'}
        </strong>
        <small>{trace.injectedChars.toLocaleString('fr-FR')} caractères injectés</small>
      </header>
      {trace.query && (
        <p className="brain-nav-query">
          <b>Requête</b>
          <span>{trace.query}</span>
        </p>
      )}
      {nav && nav.candidates.length > 0 && (
        <ol className="brain-nav-candidates">
          {nav.candidates.map((c) => (
            <CandidateRow
              key={`${c.rank}:${c.path}`}
              candidate={c}
              root={nav.root}
              minDense={nav.minDense}
            />
          ))}
        </ol>
      )}
    </section>
  )
}
