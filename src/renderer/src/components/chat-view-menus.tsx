import { texteFil } from './chat-view-outils'
import { nomDeDossier } from './conversation-groups'
import type { Conv } from './chat-view-types'
import { Spinner } from './Spinner'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
/** Le menu qui range une conversation (ou une sélection) dans un dossier ou une catégorie. */
export function MenuDossierConversation({
  appliquerRangement,
  categoriesConnues,
  convFolderMenu,
  convFolderMenuRef,
  defaultWorkspace,
  dossierPersonnel,
  dossiersConversations,
  estDossierPersonnel,
  estRetire,
  oublierDossier,
  saisieCategorie,
  setConvFolderMenu,
  setSaisieCategorie
}: {
  appliquerRangement: (
    menu: { conv: Conv | null; ids?: string[] | undefined },
    chemin: string | null
  ) => void
  categoriesConnues: string[]
  convFolderMenu: {
    conv: Conv | null
    ids?: string[] | undefined
    top: number
    left: number
    mode: 'categorie' | 'dossier'
  }
  convFolderMenuRef: React.RefObject<HTMLDivElement | null>
  defaultWorkspace: string | undefined
  dossierPersonnel: string | null
  dossiersConversations: string[]
  estDossierPersonnel: (chemin: string | null | undefined) => boolean
  estRetire: (chemin: string | null | undefined) => boolean
  oublierDossier: (chemin: string) => void
  saisieCategorie: string | null
  setConvFolderMenu: React.Dispatch<
    React.SetStateAction<{
      conv: Conv | null
      ids?: string[] | undefined
      top: number
      left: number
      mode: 'categorie' | 'dossier'
    } | null>
  >
  setSaisieCategorie: React.Dispatch<React.SetStateAction<string | null>>
}): React.JSX.Element {
  return (
    <>
      <div
        className="conv-menu-backdrop"
        onClick={() => {
          setConvFolderMenu(null)
        }}
      />
      <div
        ref={convFolderMenuRef}
        className="conv-menu-pop"
        role="menu"
        aria-label={
          convFolderMenu.mode === 'categorie'
            ? texteFil('dossiers.categories.aria')
            : texteFil('dossiers.repertoires.aria')
        }
        style={{ top: convFolderMenu.top, left: convFolderMenu.left }}
      >
        {/*
                Le dossier de REPLI est ce que la pastille affiche quand aucun dossier n'est
                assigne. Il n'entrait jamais dans la memoire des dossiers connus : l'utilisateur
                lisait donc « ContosoApp » sur l'en-tete sans le trouver dans ce menu
                (2026-09-16). On l'expose en tete, marque « par defaut », et il devient
                choisissable comme les autres.
              */}
        {/* « This computer » est TOUJOURS là, même si une ancienne croix du Board
                  l'a mémorisé comme retiré : il ne se retire pas. */}
        {convFolderMenu.mode === 'dossier' && dossierPersonnel && (
          <button
            role="menuitem"
            data-testid="conv-project-this-computer"
            data-project-path={dossierPersonnel}
            title={texteFil('dossiers.cetOrdinateur.titre', { chemin: dossierPersonnel })}
            onClick={() => {
              const menu = convFolderMenu
              setConvFolderMenu(null)
              appliquerRangement(menu, dossierPersonnel)
            }}
          >
            <span className="conv-menu-ic" aria-hidden="true">
              💻
            </span>
            This computer
          </button>
        )}
        {convFolderMenu.mode === 'dossier' &&
          defaultWorkspace?.trim() &&
          !estDossierPersonnel(defaultWorkspace) &&
          !estRetire(defaultWorkspace) &&
          !dossiersConversations.includes(defaultWorkspace.trim()) && (
            <button
              role="menuitem"
              data-testid="conv-project-default"
              data-project-path={defaultWorkspace.trim()}
              title={defaultWorkspace.trim()}
              onClick={() => {
                const menu = convFolderMenu
                const repli = defaultWorkspace.trim()
                setConvFolderMenu(null)
                appliquerRangement(menu, repli)
              }}
            >
              <span className="conv-menu-ic" aria-hidden="true">
                🗂
              </span>
              {texteFil('dossiers.parDefaut', { nom: nomDeDossier(defaultWorkspace.trim()) })}
            </button>
          )}
        {convFolderMenu.mode !== 'dossier' ? null : dossiersConversations.length === 0 &&
          !defaultWorkspace?.trim() &&
          !dossierPersonnel ? (
          <span className="conv-menu-empty">{texteFil('dossiers.aucun')}</span>
        ) : (
          // Le dossier personnel est déjà proposé sous son nom, « This computer ».
          dossiersConversations
            .filter((chemin) => !estDossierPersonnel(chemin))
            .map((chemin) => (
              <div className="conv-menu-ligne" key={chemin}>
                <button
                  role="menuitem"
                  data-testid="conv-project-choice"
                  data-project-path={chemin}
                  onClick={() => {
                    const menu = convFolderMenu
                    setConvFolderMenu(null)
                    appliquerRangement(menu, chemin)
                  }}
                >
                  <span className="conv-menu-ic" aria-hidden="true">
                    🗂
                  </span>
                  {chemin}
                </button>
                <button
                  className="conv-menu-oubli"
                  data-testid="conv-project-forget"
                  data-project-path={chemin}
                  aria-label={texteFil('dossiers.retirerNom', { chemin })}
                  title={texteFil('dossiers.retirer')}
                  onClick={(event) => {
                    // Le clic ne doit PAS ranger la conversation dans le dossier qu'on retire.
                    event.stopPropagation()
                    oublierDossier(chemin)
                  }}
                >
                  ✕
                </button>
              </div>
            ))
        )}
        {convFolderMenu.mode === 'dossier' && (
          <button
            role="menuitem"
            data-testid="conv-project-pick"
            onClick={() => {
              const menu = convFolderMenu
              setConvFolderMenu(null)
              void window.api.pickGitRepo?.().then((chemin) => {
                if (chemin) appliquerRangement(menu, chemin)
              })
            }}
          >
            <span className="conv-menu-ic" aria-hidden="true">
              📁
            </span>
            {texteFil('dossiers.parcourir')}
          </button>
        )}
        {/*
                CATEGORIES — l'autre moitie du geste « ranger ». Depuis que le dossier de travail
                et le libelle de classement sont deux champs distincts, ce menu ne
                proposait plus que des chemins : « Fiches Team » etait devenu inatteignable a la
                souris alors que des fils y vivaient toujours. Le tri entre les deux se
                fait plus bas, sur la FORME de la valeur — un libelle n'ecrase jamais le dossier.
              */}
        {/*
                Les DOSSIERS sont aussi des categories dans la barre laterale (AUTOWINOS,
                CONTOSOV3DESKTOP…). Sans eux ici, le menu ouvert depuis la selection multiple etait
                vide des qu'aucun libelle libre n'existait (2026-09-23).
              */}
        {convFolderMenu.mode === 'categorie' &&
          (categoriesConnues.length > 0 || dossiersConversations.length > 0) && (
            <span className="conv-menu-titre">{texteFil('dossiers.categories')}</span>
          )}
        {(convFolderMenu.mode === 'categorie' ? dossiersConversations : []).map((chemin) => (
          <button
            key={`dossier:${chemin}`}
            role="menuitem"
            data-testid="conv-category-folder-choice"
            data-project-path={chemin}
            title={chemin}
            onClick={() => {
              const menu = convFolderMenu
              setConvFolderMenu(null)
              setSaisieCategorie(null)
              appliquerRangement(menu, chemin)
            }}
          >
            <span className="conv-menu-ic" aria-hidden="true">
              🗂
            </span>
            {nomDeDossier(chemin)}
          </button>
        ))}
        {(convFolderMenu.mode === 'categorie' ? categoriesConnues : []).map((libelle) => (
          <button
            key={libelle}
            role="menuitem"
            data-testid="conv-category-choice"
            data-category={libelle}
            onClick={() => {
              const menu = convFolderMenu
              setConvFolderMenu(null)
              setSaisieCategorie(null)
              appliquerRangement(menu, libelle)
            }}
          >
            <span className="conv-menu-ic" aria-hidden="true">
              🏷
            </span>
            {libelle}
          </button>
        ))}
        {convFolderMenu.mode !== 'categorie' ? null : saisieCategorie === null ? (
          <button
            role="menuitem"
            data-testid="conv-category-new"
            onClick={() => setSaisieCategorie('')}
          >
            <span className="conv-menu-ic" aria-hidden="true">
              ＋
            </span>
            {texteFil('dossiers.nouvelleCategorie')}
          </button>
        ) : (
          <input
            className="conv-menu-saisie"
            data-testid="conv-category-input"
            aria-label={texteFil('dossiers.nomNouvelleCategorie')}
            placeholder={texteFil('dossiers.nomCategorie')}
            autoFocus
            value={saisieCategorie}
            onChange={(event) => setSaisieCategorie(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSaisieCategorie(null)
                return
              }
              if (event.key !== 'Enter') return
              const libelle = saisieCategorie.trim()
              if (!libelle) return
              const menu = convFolderMenu
              setSaisieCategorie(null)
              setConvFolderMenu(null)
              appliquerRangement(menu, libelle)
            }}
          />
        )}
      </div>
    </>
  )
}

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
/** Le menu de la branche git du fil. */
export function MenuBrancheDuFil({
  brancheMenu,
  brancheMenuRef,
  gitBranch,
  gitCwd,
  setBrancheMenu
}: {
  brancheMenu: { top: number; left: number; branches: string[] | null; refus?: string | undefined }
  brancheMenuRef: React.RefObject<HTMLDivElement | null>
  gitBranch: string | null
  gitCwd: string | undefined
  setBrancheMenu: React.Dispatch<
    React.SetStateAction<{
      top: number
      left: number
      branches: string[] | null
      refus?: string | undefined
    } | null>
  >
}): React.JSX.Element {
  return (
    <>
      <div className="conv-menu-backdrop" onClick={() => setBrancheMenu(null)} />
      <div
        ref={brancheMenuRef}
        className="conv-menu-pop"
        role="menu"
        aria-label={texteFil('branches.aria')}
        style={{ top: brancheMenu.top, left: brancheMenu.left }}
      >
        {brancheMenu.branches === null ? (
          <span
            className="conv-menu-empty"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Spinner size={12} label={texteFil('branches.lecture.aria')} />
            {texteFil('branches.lecture')}
          </span>
        ) : brancheMenu.branches.length === 0 ? (
          <span className="conv-menu-empty">{texteFil('branches.aucune')}</span>
        ) : (
          brancheMenu.branches.map((nom) => (
            <button
              key={nom}
              role="menuitem"
              data-testid="chat-branch-choice"
              data-branch={nom}
              onClick={() => {
                /*
                        BASCULE REELLE, et bornee : l'application refuse si l'arbre de travail porte
                        des modifications non enregistrees. On NE ferme PAS le menu tout de suite --
                        un refus doit rester visible la ou l'utilisateur vient de cliquer, sinon la
                        branche « ne change pas » sans que rien ne l'explique.
                      */
                setBrancheMenu((m) => (m ? { ...m, refus: undefined } : m))
                void window.api
                  .checkoutGitBranch?.(nom, gitCwd)
                  .then((r) => {
                    if (r?.ok) {
                      setBrancheMenu(null)
                      // Relecture IMMEDIATE du badge : sans elle, il garde l'ancien nom
                      // jusqu'au prochain battement (5 s) et la bascule parait sans effet.
                      window.dispatchEvent(new Event('focus'))
                    } else
                      setBrancheMenu((m) =>
                        m ? { ...m, refus: r?.reason ?? texteFil('branches.refusee') } : m
                      )
                  })
                  .catch((e: unknown) =>
                    setBrancheMenu((m) => (m ? { ...m, refus: String(e) } : m))
                  )
              }}
            >
              <span className="conv-menu-ic" aria-hidden="true">
                ⑂
              </span>
              {nom}
              {nom === gitBranch ? texteFil('branches.courante') : ''}
            </button>
          ))
        )}
        {brancheMenu.refus && (
          <span className="conv-menu-empty" role="alert" data-testid="chat-branch-refus">
            {brancheMenu.refus}
          </span>
        )}
      </div>
    </>
  )
}

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
/** Le menu contextuel d’une conversation de la liste. */
export function MenuConversation({
  convMenu,
  convMenuRef,
  convViewMode,
  marquerInactive,
  marquerPrive,
  rangerDans,
  removeConv,
  renameConv,
  setConvFolderMenu,
  setConvMenu,
  setConvSelectionMode,
  setSelectedConvIds,
  signalerFils,
  surligner
}: {
  convMenu: { conv: Conv; top: number; left: number }
  convMenuRef: React.RefObject<HTMLDivElement | null>
  convViewMode: 'list' | 'mosaic'
  marquerInactive: (conversationId: string, on: boolean) => Promise<void>
  marquerPrive: (conversationId: string, on: boolean) => Promise<void>
  rangerDans: (conversationId: string, chemin?: string | null | undefined) => Promise<void>
  removeConv: (c: Conv) => Promise<void>
  renameConv: (c: Conv) => void
  setConvFolderMenu: React.Dispatch<
    React.SetStateAction<{
      conv: Conv | null
      ids?: string[] | undefined
      top: number
      left: number
      mode: 'categorie' | 'dossier'
    } | null>
  >
  setConvMenu: React.Dispatch<
    React.SetStateAction<{ conv: Conv; top: number; left: number } | null>
  >
  setConvSelectionMode: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedConvIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>
  signalerFils: (ids: readonly string[]) => void
  surligner: (conversationId: string, on: boolean) => Promise<void>
}): React.JSX.Element {
  return (
    <>
      <div className="conv-menu-backdrop" onClick={() => setConvMenu(null)} />
      <div
        ref={convMenuRef}
        className="conv-menu-pop"
        role="menu"
        style={{ top: convMenu.top, left: convMenu.left }}
      >
        <button
          role="menuitem"
          onClick={() => {
            const conv = convMenu.conv
            setConvMenu(null)
            renameConv(conv)
          }}
        >
          <span className="conv-menu-ic" aria-hidden="true">
            ✎
          </span>
          {texteFil('menu.renommer')}
        </button>
        {/*
                La MÊME action que le glisser-déposer, au clavier. Ce n'est pas un doublon de confort :
                une fonctionnalité qui n'existe qu'au glisser est inatteignable sans souris.
              */}
        <button
          role="menuitem"
          data-testid="conv-menu-set-project"
          onClick={() => {
            const { conv, top, left } = convMenu
            setConvMenu(null)
            setConvFolderMenu({ conv, top, left, mode: 'categorie' })
          }}
        >
          <span className="conv-menu-ic" aria-hidden="true">
            🗂
          </span>
          {texteFil('liste.rangerCategorie')}
        </button>
        {/*
                L'entree « Choisir le repertoire de travail… » a ete RETIREE de ce menu sur demande
                (2026-09-17). Le choix du depot de travail reste entier : il se fait par la
                pastille 📁 de la barre du haut (data-testid="chat-project-dot"), qui ouvre le meme
                selecteur en mode 'dossier', et par le glisser-deposer.
              */}
        {/*
                La categorie compte autant que le dossier : sans elle dans ce test, un fil range
                sous un libelle n'avait plus AUCUN moyen d'en sortir depuis le menu.
              */}
        {(convMenu.conv.projectPath || convMenu.conv.categorie) && (
          <button
            role="menuitem"
            data-testid="conv-menu-clear-project"
            onClick={() => {
              const conv = convMenu.conv
              setConvMenu(null)
              void rangerDans(conv.id, null)
            }}
          >
            <span className="conv-menu-ic" aria-hidden="true">
              ↩
            </span>
            {texteFil('menu.sortirDossier')}
          </button>
        )}
        {/*
                Le repère visuel : la MEME entree pose et retire, comme une bascule. Deux entrees
                distinctes auraient allonge le menu pour un etat qui n'en a que deux.
              */}
        <button
          role="menuitem"
          data-testid="conv-menu-highlight"
          onClick={() => {
            const conv = convMenu.conv
            setConvMenu(null)
            void surligner(conv.id, !conv.surlignee)
          }}
        >
          <span className="conv-menu-ic" aria-hidden="true">
            ★
          </span>
          {convMenu.conv.surlignee
            ? texteFil('menu.retirerSurlignage')
            : texteFil('menu.surligner')}
        </button>
        <button
          role="menuitem"
          data-testid="conv-menu-inactive"
          onClick={() => {
            const conv = convMenu.conv
            setConvMenu(null)
            void marquerInactive(conv.id, conv.inactive !== true)
          }}
        >
          <span className="conv-menu-ic" aria-hidden="true">
            {convMenu.conv.inactive ? '●' : '○'}
          </span>
          {convMenu.conv.inactive ? texteFil('liste.desarchiver') : texteFil('liste.archiver')}
        </button>
        {/* Fil privé du village commun (D6) : une bascule, comme le surlignage. */}
        <button
          role="menuitem"
          data-testid="conv-menu-prive"
          title={texteFil('menu.prive.titre')}
          onClick={() => {
            const conv = convMenu.conv
            setConvMenu(null)
            void marquerPrive(conv.id, conv.prive !== true)
          }}
        >
          <span className="conv-menu-ic" aria-hidden="true">
            {convMenu.conv.prive ? '◉' : '◌'}
          </span>
          {convMenu.conv.prive ? texteFil('menu.retirerPrive') : texteFil('menu.marquerPrive')}
        </button>
        <button
          role="menuitem"
          data-testid="conv-menu-signaler"
          title={texteFil('menu.signaler.titre')}
          onClick={() => {
            const conv = convMenu.conv
            setConvMenu(null)
            signalerFils([conv.id])
          }}
        >
          <span className="conv-menu-ic" aria-hidden="true">
            ⚑
          </span>
          {texteFil('menu.signaler')}
        </button>
        {/*
                Le mode selection entre PAR ICI : garder un bouton permanent en haut du panneau
                coutait un item d'interface visible toute la journee pour un geste rare.
              */}
        {convViewMode !== 'mosaic' && (
          <button
            role="menuitem"
            data-testid="conv-menu-select-mode"
            onClick={() => {
              const conv = convMenu.conv
              setConvMenu(null)
              setConvSelectionMode(true)
              setSelectedConvIds(new Set([conv.id]))
            }}
          >
            <span className="conv-menu-ic" aria-hidden="true">
              ☑
            </span>
            {texteFil('menu.selectionner')}
          </button>
        )}
        <button
          role="menuitem"
          className="c-err"
          onClick={() => {
            const conv = convMenu.conv
            setConvMenu(null)
            removeConv(conv)
          }}
        >
          <span className="conv-menu-ic" aria-hidden="true">
            🗑
          </span>
          {texteFil('menu.supprimer')}
        </button>
      </div>
    </>
  )
}
