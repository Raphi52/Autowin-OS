import { useEffect, useRef, useState } from 'react'
import type { ContextGauge } from '../../../shared/context-gauge'
import './ModelQuotaIndicator.css'

/**
 * LA JAUGE DE CONTEXTE, CLIQUABLE — demande utilisateur du 2026-09-06.
 *
 * Elle vivait comme un simple libellé dans l'en-tête, et son détail était logé dans la popup des
 * QUOTAS : deux sujets différents dans le même panneau. Elle ouvre désormais son propre panneau,
 * exactement comme la barre de quotas (ancrage sur la FENÊTRE, fermeture au clic dehors / Échap),
 * et le bloc contexte a quitté la popup des quotas.
 *
 * Rien n'est rendu quand la jauge est inconnue : afficher 0 % dirait « ce fil est vide » là où la
 * vérité est « on l'ignore ».
 */
export function ContextGaugeIndicator({
  gauge,
  onCompact,
  busy
}: {
  gauge?: ContextGauge
  /** Absent = AUCUN bouton Compacter : le panneau ne fabrique pas une action sans destinataire. */
  onCompact?: () => void
  busy?: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [ancrage, setAncrage] = useState<{ left: number; top: number; width: number }>()

  // Ancrage sur la FENETRE : le panneau de chat qui contient l'en-tete coupe (overflow: hidden)
  // tout ce qui deborde, un positionnement relatif au parent serait donc rogne.
  useEffect(() => {
    if (!open) return
    const placer = (): void => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      if (!trigger) return
      const width = Math.min(380, window.innerWidth - 16)
      const left = Math.max(8, Math.min(trigger.left, window.innerWidth - width - 8))
      setAncrage({ left, top: trigger.bottom + 8, width })
    }
    placer()
    window.addEventListener('resize', placer)
    return () => window.removeEventListener('resize', placer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  if (!gauge) return null
  const pourcent = Math.round(gauge.ratio * 100)
  const titre =
    `Contexte : ${gauge.used.toLocaleString('fr-FR')} tokens sur ` +
    `${gauge.limit.toLocaleString('fr-FR')} (${pourcent} %), dont ` +
    `${gauge.cacheRead.toLocaleString('fr-FR')} relus du cache.`
  return (
    <div className="chat-context-gauge-root" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`chat-context-gauge is-${gauge.level}`}
        title={`${titre}\nCliquer pour le detail.`}
        aria-label={titre}
        aria-expanded={open}
        data-testid="chat-context-gauge"
        onClick={() => setOpen((etat) => !etat)}
      >
        <span className="chat-context-gauge-track">
          <span className="chat-context-gauge-fill" style={{ width: `${pourcent}%` }} />
        </span>
        {pourcent} %
      </button>
      {open && (
        <section
          className="model-quota-popover"
          data-testid="chat-context-popover"
          aria-label="Contexte de cette conversation"
          style={
            ancrage
              ? {
                  position: 'fixed',
                  left: `${ancrage.left}px`,
                  top: `${ancrage.top}px`,
                  bottom: 'auto',
                  right: 'auto',
                  width: `${ancrage.width}px`
                }
              : undefined
          }
        >
          <header>
            <div>
              <strong>Contexte de cette conversation</strong>
              <small>fenêtre du modèle servi</small>
            </div>
          </header>
          <div className="model-quota-list">
            <article
              className={`model-quota-row quota-context-gauge is-${gauge.level}`}
              data-testid="quota-context-gauge"
              aria-label={titre}
              title={titre}
            >
              <div className="model-quota-name">
                <span>
                  <strong>Occupation du fil</strong>
                  <small>
                    {gauge.used.toLocaleString('fr-FR')} / {gauge.limit.toLocaleString('fr-FR')}{' '}
                    tokens · {gauge.cacheRead.toLocaleString('fr-FR')} relus du cache
                  </small>
                </span>
              </div>
              <div className="model-quota-window">
                <div className="quota-context-gauge-track" aria-hidden="true">
                  <i className="quota-context-gauge-fill" style={{ width: `${pourcent}%` }} />
                </div>
                <strong className="model-quota-values">
                  <span>{pourcent} % occupé</span>
                  <small>{gauge.fresh.toLocaleString('fr-FR')} tokens frais</small>
                </strong>
                {onCompact && (
                  <button
                    type="button"
                    className="quota-context-compact"
                    data-testid="quota-context-compact"
                    disabled={busy === true}
                    title={
                      busy === true
                        ? 'Compaction indisponible : un tour est déjà en cours'
                        : 'Demander à l’agent un résumé dense du fil, puis repartir de ce résumé'
                    }
                    onClick={() => {
                      setOpen(false)
                      onCompact()
                    }}
                  >
                    Compacter
                  </button>
                )}
              </div>
            </article>
          </div>
        </section>
      )}
    </div>
  )
}
