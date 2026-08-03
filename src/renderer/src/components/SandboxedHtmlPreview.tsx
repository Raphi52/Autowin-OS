import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import './SandboxedHtmlPreview.css'

const MAX_INLINE_HTML_RENDER_CHARS = 1_000_000

const SANDBOX_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const SECURITY_HEAD =
  `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_POLICY}">` +
  '<meta name="referrer" content="no-referrer">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">'

/**
 * Impose notre CSP AVANT le contenu modèle. Une CSP fournie par la page peut la resserrer, jamais
 * l'élargir : plusieurs politiques s'appliquent par intersection dans Chromium.
 */
// eslint-disable-next-line react-refresh/only-export-components -- helper pur testé avec le composant
export function buildSandboxedHtmlDocument(source: string): string {
  // L'enveloppe de confiance précède toujours le texte modèle. Chercher un <head> dans la chaîne
  // brute permettrait à un faux tag placé dans un commentaire de capturer la CSP dans ce commentaire.
  const template = document.createElement('template')
  template.innerHTML = source

  for (const meta of template.content.querySelectorAll('meta[http-equiv]')) {
    if (meta.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh') meta.remove()
  }
  for (const base of template.content.querySelectorAll('base')) base.remove()
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of ['href', 'xlink:href']) {
      const value = element.getAttribute(attribute)?.trim()
      if (value && !value.startsWith('#')) element.removeAttribute(attribute)
    }
    element.removeAttribute('action')
    element.removeAttribute('formaction')
  }

  return `<!doctype html><html><head>${SECURITY_HEAD}</head><body>${template.innerHTML}</body></html>`
}

type SandboxedHtmlPreviewProps = {
  source: string
  title?: string
  embedded?: boolean
  enforceInlineLimit?: boolean
}

export function SandboxedHtmlPreview({
  source,
  title = 'Rendu HTML',
  embedded = false,
  enforceInlineLimit = true
}: SandboxedHtmlPreviewProps): React.JSX.Element {
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const tooLarge = enforceInlineLimit && source.length > MAX_INLINE_HTML_RENDER_CHARS
  const documentSource = useMemo(
    () => (tooLarge ? '' : buildSandboxedHtmlDocument(source)),
    [source, tooLarge]
  )
  const frameUrl = useMemo(
    () => (tooLarge ? '' : `data:text/html;charset=utf-8,${encodeURIComponent(documentSource)}`),
    [documentSource, tooLarge]
  )

  useEffect(() => {
    if (!expanded) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [expanded])

  const panel = (
    <section
      className={`html-render-preview${embedded ? ' is-embedded' : ''}${expanded ? ' is-expanded' : ''}`}
      data-testid="html-render-preview"
    >
      <header className="html-render-preview__toolbar">
        <span className="html-render-preview__identity">
          <span aria-hidden="true">◇</span>
          {title}
        </span>
        <div className="html-render-preview__modes" aria-label="Mode du rendu HTML">
          <button
            type="button"
            className={mode === 'preview' ? 'is-active' : ''}
            data-action="html-preview"
            aria-pressed={mode === 'preview'}
            onClick={() => setMode('preview')}
          >
            Aperçu
          </button>
          <button
            type="button"
            className={mode === 'source' ? 'is-active' : ''}
            data-action="html-source"
            aria-pressed={mode === 'source'}
            onClick={() => setMode('source')}
          >
            Source
          </button>
        </div>
        {!tooLarge && (
          <button
            type="button"
            data-action="html-reload"
            title="Relancer le rendu"
            aria-label="Relancer le rendu HTML"
            onClick={() => {
              setMode('preview')
              setReloadVersion((version) => version + 1)
            }}
          >
            ↻
          </button>
        )}
        <button
          type="button"
          data-action="html-expand"
          aria-label={expanded ? 'Réduire le rendu HTML' : 'Agrandir le rendu HTML'}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Réduire' : 'Agrandir'}
        </button>
      </header>
      <div className="html-render-preview__body">
        {mode === 'preview' && tooLarge ? (
          <div
            className="html-render-preview__too-large"
            data-testid="html-render-too-large"
            role="alert"
          >
            <strong>Rendu HTML trop volumineux</strong>
            <span>
              {source.length.toLocaleString('fr-FR')} caractères. La limite du rendu dans le fil est
              de {MAX_INLINE_HTML_RENDER_CHARS.toLocaleString('fr-FR')} caractères.
            </span>
            <span>
              Consulte la source ici, ou demande à l’agent de fournir cette page comme artefact
              <code>.html</code>.
            </span>
            <button type="button" onClick={() => setMode('source')}>
              Voir la source
            </button>
          </div>
        ) : mode === 'preview' ? (
          <iframe
            key={reloadVersion}
            className="html-render-preview__frame"
            data-testid="html-render-frame"
            title={title}
            sandbox=""
            referrerPolicy="no-referrer"
            allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'"
            src={frameUrl}
          />
        ) : (
          <pre className="html-render-preview__source">
            <code>{source}</code>
          </pre>
        )}
      </div>
    </section>
  )

  if (!expanded) return panel
  return createPortal(
    <div
      className="html-render-preview__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Rendu HTML agrandi"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setExpanded(false)
      }}
    >
      {panel}
    </div>,
    document.body
  )
}
