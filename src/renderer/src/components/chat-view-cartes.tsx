import { texteFil } from './chat-view-outils'
import type { RunEntry, Conv } from './chat-view-types'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
/** La carte qui confirme la suppression d’un run (de ce fil, ou de partout). */
export function CarteSuppressionRun({
  confirmDeleteRun,
  deleteRunCandidate,
  runDeleteError,
  runDeletePending,
  setDeleteRunCandidate
}: {
  confirmDeleteRun: () => Promise<void>
  deleteRunCandidate: { run: RunEntry; scope: 'conv' | 'tous'; conversationId?: string | undefined }
  runDeleteError: string | null
  runDeletePending: boolean
  setDeleteRunCandidate: React.Dispatch<
    React.SetStateAction<{
      run: RunEntry
      scope: 'conv' | 'tous'
      conversationId?: string | undefined
    } | null>
  >
}): React.JSX.Element {
  return (
    <div
      className="delete-confirm-layer"
      role="presentation"
      onClick={() => {
        if (!runDeletePending) setDeleteRunCandidate(null)
      }}
    >
      <section
        className="delete-confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-delete-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="delete-confirm-orbit" aria-hidden="true">
          ✦
        </div>
        <span className="delete-confirm-kicker">
          {deleteRunCandidate.scope === 'conv' && deleteRunCandidate.run.session === 'attaché'
            ? texteFil('run.pieceJointe')
            : texteFil('run.irreversible')}
        </span>
        <h2 id="run-delete-confirm-title">
          {deleteRunCandidate.scope === 'conv' && deleteRunCandidate.run.session === 'attaché'
            ? texteFil('run.detacherTitre')
            : texteFil('run.supprimerTitre')}
        </h2>
        <p>
          <strong>« {deleteRunCandidate.run.subject} »</strong>{' '}
          {deleteRunCandidate.scope === 'conv' && deleteRunCandidate.run.session === 'attaché'
            ? texteFil('run.detacherDetail')
            : texteFil('run.supprimerDetail')}
        </p>
        {runDeleteError && <div className="attachment-error">⚠️ {runDeleteError}</div>}
        <div className="delete-confirm-actions">
          <button
            className="btn delete-confirm-cancel run-delete-cancel"
            onClick={() => setDeleteRunCandidate(null)}
            disabled={runDeletePending}
            autoFocus
          >
            {texteFil('dialogue.annuler')}
          </button>
          <button
            className="btn delete-confirm-danger run-delete-confirm"
            onClick={() => void confirmDeleteRun()}
            disabled={runDeletePending}
          >
            {runDeletePending
              ? texteFil('run.traitement')
              : deleteRunCandidate.scope === 'conv' && deleteRunCandidate.run.session === 'attaché'
                ? texteFil('run.detacher')
                : texteFil('run.supprimer')}
          </button>
        </div>
      </section>
    </div>
  )
}

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
/** La carte qui renomme une conversation. */
export function CarteRenommerConversation({
  confirmRenameConv,
  renameCandidate,
  setRenameCandidate
}: {
  confirmRenameConv: () => Promise<void>
  renameCandidate: { conv: Conv; value: string }
  setRenameCandidate: React.Dispatch<React.SetStateAction<{ conv: Conv; value: string } | null>>
}): React.JSX.Element {
  return (
    <div
      className="delete-confirm-layer"
      role="presentation"
      onClick={() => setRenameCandidate(null)}
    >
      <form
        className="delete-confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-conv-title"
        data-testid="rename-conv-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          void confirmRenameConv()
        }}
      >
        <span className="delete-confirm-kicker">{texteFil('renommer.surtitre')}</span>
        <h2 id="rename-conv-title">{texteFil('renommer.titre')}</h2>
        <input
          className="rename-conv-input"
          data-testid="rename-conv-input"
          aria-label={texteFil('renommer.champ')}
          value={renameCandidate.value}
          autoFocus
          onChange={(event) =>
            setRenameCandidate((current) =>
              current ? { ...current, value: event.target.value } : current
            )
          }
          onKeyDown={(event) => {
            if (event.key === 'Escape') setRenameCandidate(null)
          }}
        />
        <div className="delete-confirm-actions">
          <button
            type="button"
            className="btn delete-confirm-cancel"
            onClick={() => setRenameCandidate(null)}
          >
            {texteFil('dialogue.annuler')}
          </button>
          <button type="submit" className="btn" data-testid="rename-conv-confirm">
            {texteFil('menu.renommer')}
          </button>
        </div>
      </form>
    </div>
  )
}

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
/** L'image du fil agrandie par-dessus l'application ; un clic hors de l'image ou la croix la ferme. */
export function ImageAgrandie({
  openImage,
  setOpenImage
}: {
  openImage: { src: string; name: string }
  setOpenImage: React.Dispatch<React.SetStateAction<{ src: string; name: string } | null>>
}): React.JSX.Element {
  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={texteFil('apercu.aria', { nom: openImage.name })}
      onClick={() => setOpenImage(null)}
    >
      <div className="image-lightbox-content" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="image-lightbox-close"
          aria-label={texteFil('apercu.fermer')}
          onClick={() => setOpenImage(null)}
        >
          ×
        </button>
        <img src={openImage.src} alt={openImage.name} />
      </div>
    </div>
  )
}
