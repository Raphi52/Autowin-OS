import { texteFil, PastilleEnTete, type ModeleDuFil } from './chat-view-outils'
import { OrchestratorModelSelector, type OrchestratorAccounts } from './OrchestratorModelSelector'
import { shortModelLabel } from './model-display-label'
import { nomDeDossier } from './conversation-groups'
import { ForkIcon } from './chat-view-icons'
import { ConversationCostIndicator } from './ConversationCostIndicator'
import { BoutonNavigateur, BoutonBureauxCaches, BoutonDetails } from './BoutonNavigateur'
import { basculerBureauxDans, type OutilDuPanneau } from './panneau-outil'
import { ChatContextRule } from './ChatContextRule'
import { formaterNombre } from '../langue'
import { ContextGaugeDetail } from './ContextGaugeIndicator'
import { composerContexte, type ContexteStatique } from '../../../shared/contexte-detaille'
import { COMPACT_REQUEST, type ContextGauge } from '../../../shared/context-gauge'
import type { Conv, SendOptions } from './chat-view-types'
import type { OrchestratorModelOption, RuntimeModel, ChatRuntimeIdentity } from './chat-view-model'
import type { CopieAffichee } from './copie-du-fil-entete'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
/** L’en-tête du fil unique : titre, identité du modèle, dossier, branche, coût, jauge de contexte et boutons des panneaux. */
export function EnTeteDuFil({
  active,
  activeId,
  basculerNavigateur,
  bindingEffectif,
  bureauxNonVus,
  bureauxOuverts,
  busy,
  changerModeleDuFil,
  comptesDeConversation,
  contextesStatiques,
  copieAffichee,
  defaultWorkspace,
  dossierProjetAffiche,
  estDossierPersonnel,
  gitBranch,
  gitCwd,
  identifiantCopie,
  jaugeCourante,
  listeTelOuverte,
  modelCatalog,
  modelCatalogLoaded,
  modelChangeError,
  modelChangePending,
  modeleDuFil,
  navigateurOuvert,
  openRunsCount,
  pagesNonVues,
  placePanneau,
  runtimeIdentity,
  send,
  setBrancheMenu,
  setConvFolderMenu,
  setIdentifiantCopie,
  setListeTelOuverte,
  setPanneaux,
  setShowRuns,
  showRuns
}: {
  active: Conv | undefined
  activeId: string | null
  basculerNavigateur: () => void
  bindingEffectif: ModeleDuFil | null
  bureauxNonVus: number
  bureauxOuverts: boolean
  busy: boolean
  changerModeleDuFil: (option: OrchestratorModelOption | null) => Promise<void>
  comptesDeConversation: OrchestratorAccounts | undefined
  contextesStatiques: Record<string, ContexteStatique>
  copieAffichee: CopieAffichee | null
  defaultWorkspace: string | undefined
  dossierProjetAffiche: string | undefined
  estDossierPersonnel: (chemin: string | null | undefined) => boolean
  gitBranch: string | null
  gitCwd: string | undefined
  identifiantCopie: string | null
  jaugeCourante: ContextGauge | undefined
  listeTelOuverte: boolean
  modelCatalog: RuntimeModel[]
  modelCatalogLoaded: boolean
  modelChangeError: string | null
  modelChangePending: boolean
  modeleDuFil: ModeleDuFil | null
  navigateurOuvert: boolean
  openRunsCount: number
  pagesNonVues: number
  placePanneau: string
  runtimeIdentity: ChatRuntimeIdentity | null
  send: (text?: string | undefined, options?: SendOptions | undefined) => Promise<void>
  setBrancheMenu: React.Dispatch<
    React.SetStateAction<{
      top: number
      left: number
      branches: string[] | null
      refus?: string | undefined
    } | null>
  >
  setConvFolderMenu: React.Dispatch<
    React.SetStateAction<{
      conv: Conv | null
      ids?: string[] | undefined
      top: number
      left: number
      mode: 'dossier' | 'categorie'
    } | null>
  >
  setIdentifiantCopie: React.Dispatch<React.SetStateAction<string | null>>
  setListeTelOuverte: React.Dispatch<React.SetStateAction<boolean>>
  setPanneaux: (
    changer: (
      ouverts: Readonly<Record<string, OutilDuPanneau>>
    ) => Readonly<Record<string, OutilDuPanneau>>
  ) => void
  setShowRuns: React.Dispatch<React.SetStateAction<boolean>>
  showRuns: boolean
}): React.JSX.Element {
  return (
    <header className="chat-head row">
      <div className="row gap2 chat-head-titre" style={{ alignItems: 'center', minWidth: 0 }}>
        <button
          type="button"
          className="chat-liste-tel-btn"
          aria-label="Conversations"
          aria-expanded={listeTelOuverte}
          onClick={() => setListeTelOuverte((o) => !o)}
        >
          ☰
        </button>
        <div className="col" style={{ gap: 1, minWidth: 0 }}>
          <span className="chat-head-kicker">
            {active ? active.title : texteFil('entete.nouvelle')}
          </span>
          <div className="chat-runtime" data-testid="chat-runtime-identity">
            {/* La perle d'etat remplace l'ancienne boule de 26 px : meme case,
                      meme perle, meme spinner que la liste des fils. */}
            <PastilleEnTete
              occupe={busy}
              messageCount={active ? (active.messageCount ?? active.messages?.length ?? 0) : 0}
              lastMessageRole={
                active
                  ? (active.lastMessageRole ??
                    [...(active.messages ?? [])].reverse().find((m) => m.orientation !== true)
                      ?.role)
                  : undefined
              }
              lastAssistantStatus={active?.lastAssistantStatus}
              asksUser={active?.lastAssistantAsksUser === true}
              tourEnCours={active?.hasStreamingTurn === true}
            />
            <span className={`chat-runtime-provider is-${bindingEffectif?.provider ?? 'loading'}`}>
              {bindingEffectif?.provider ?? texteFil('entete.connexion')}
            </span>
            {/*
                    LE MODÈLE DU FIL, EN LISTE DÉROULANTE (2026-10-11). Il était affiché
                    ici en simple texte ET choisi dans la barre de saisie : deux fois la même
                    information. Le choix vit désormais ici seul, et il ne vaut QUE pour cette
                    conversation (`changerModeleDuFil`). Menu ouvert VERS LE BAS : vers le haut,
                    il sortirait de la fenêtre.
                  */}
            <OrchestratorModelSelector
              busy={busy}
              catalogLoaded={modelCatalogLoaded}
              models={modelCatalog}
              binding={bindingEffectif}
              pending={modelChangePending}
              error={modelChangeError}
              onSelect={(option) => void changerModeleDuFil(option)}
              comptes={comptesDeConversation}
              ouverture="bas"
              defaut={{
                label: runtimeIdentity?.modelLabel
                  ? shortModelLabel(runtimeIdentity.modelLabel, runtimeIdentity.provider)
                  : texteFil('entete.modeleApplication'),
                actif: modeleDuFil === null,
                onChoisir: () => void changerModeleDuFil(null)
              }}
            />
            {/*
                  L'IDENTIFIANT de la conversation, a la place de « interface prete ».

                  Ce libelle ne disait rien : une interface affichee est prete, sinon on ne la
                  lirait pas. Pendant ce temps l'agent cite des conversations par leur id
                  (« conv-12 ») sans que rien a l'ecran ne permette de savoir laquelle on regarde.
                  La place etait donc occupee par du bruit alors qu'il manquait la seule
                  information qui relie ce que l'agent dit a ce que l'utilisateur voit.

                  L'etat occupe reste porte par la classe `is-busy`. La mention « · en cours »
                  qui suivait l'id a ete retiree (2026-10-11, « ca prend de la place pour rien ») :
                  le fil en cours se voit deja dans la conversation elle-meme.

                  UN CLIC LE COPIE (2026-11-25, « que ca me mette le nom dans le clipboard comme
                  ctrl+c ») : on le recolle dans un message ou un ticket. Reste un <span> et non un
                  <button> : la ligne pose ses separateurs « · » par `span + span`. Le retour
                  passe par la couleur et l'infobulle, pas par le texte : la ligne ne bouge pas.
                */}
            <span
              className={`chat-runtime-state${busy ? ' is-busy' : ''}${
                activeId && identifiantCopie === activeId ? ' is-copie' : ''
              }${activeId ? ' is-copiable' : ''}`}
              data-testid="chat-runtime-conv"
              role={activeId ? 'button' : undefined}
              tabIndex={activeId ? 0 : undefined}
              title={
                activeId
                  ? identifiantCopie === activeId
                    ? texteFil('entete.identifiantCopie', { id: activeId })
                    : texteFil('entete.identifiant', { id: activeId })
                  : texteFil('entete.aucuneOuverte')
              }
              onClick={() => {
                if (!activeId) return
                const id = activeId
                void navigator.clipboard
                  ?.writeText(id)
                  .then(() => setIdentifiantCopie(id))
                  .catch(() => undefined)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.currentTarget.click()
              }}
            >
              {activeId ?? texteFil('entete.aucune')}
            </span>
            {(() => {
              /*
                      SANS conversation ouverte, la pastille parle du PROCHAIN fil. Elle etait
                      `disabled` dans ce cas : le dossier de travail ne pouvait se choisir qu'apres
                      le premier tour, donc ce premier tour partait toujours dans le depot de repli
                      (« je dois pouvoir choisir mon CWD dans un nouveau fil », 2026-09-09).
                    */
              // Meme source que le badge de branche (`gitCwd`), sinon les deux divergent.
              const dossierProjet = dossierProjetAffiche
              const cheminEffectif = dossierProjet || defaultWorkspace
              const surCetOrdinateur = estDossierPersonnel(cheminEffectif)
              // Un fil dans sa copie : la pastille nomme le projet, la copie passe dans l'info-bulle.
              const labelDossier = copieAffichee
                ? nomDeDossier(copieAffichee.projet)
                : surCetOrdinateur
                  ? 'This computer'
                  : cheminEffectif
                    ? nomDeDossier(cheminEffectif)
                    : 'Autowin OS'
              // Même icône que sa ligne du menu (💻), pas le 📁 d'un projet.
              const iconeDossier = surCetOrdinateur ? '💻' : '📁'
              const titreDossier = copieAffichee
                ? texteFil('entete.dossierCopie', { ...copieAffichee })
                : dossierProjet
                  ? active
                    ? texteFil('entete.dossierAssigne', { chemin: dossierProjet })
                    : texteFil('entete.dossierProchainFil', { chemin: dossierProjet })
                  : texteFil('entete.dossierRacine', {
                      chemin: cheminEffectif ?? texteFil('entete.racineDepot')
                    })
              return (
                <button
                  type="button"
                  className="chat-cost-dot chat-project-dot"
                  title={texteFil('entete.dossier.titre', { titre: titreDossier })}
                  aria-label={titreDossier}
                  data-testid="chat-project-dot"
                  onClick={(event) => {
                    const r = event.currentTarget.getBoundingClientRect()
                    setConvFolderMenu({
                      conv: active ?? null,
                      top: r.bottom + 4,
                      left: r.left,
                      // La pastille de la barre du haut PARLE du repertoire de travail : elle
                      // n'ouvre donc que celui-la, jamais le classement.
                      mode: 'dossier'
                    })
                  }}
                >
                  {iconeDossier} {labelDossier}
                </button>
              )
            })()}
            {gitBranch && copieAffichee && (
              // La branche se change dans le dossier principal, pas depuis la copie : sans menu.
              <span
                className="chat-git-branch-btn"
                data-testid="chat-git-branch"
                title={texteFil('entete.copieDuFil.titre', {
                  projet: copieAffichee.projet,
                  branche: gitBranch
                })}
              >
                <ForkIcon /> {gitBranch}
              </span>
            )}
            {gitBranch && !copieAffichee && (
              <button
                type="button"
                className="chat-git-branch-btn"
                data-testid="chat-git-branch"
                title={texteFil('entete.branche.titre', { branche: gitBranch })}
                onClick={(event) => {
                  const r = event.currentTarget.getBoundingClientRect()
                  setBrancheMenu({ top: r.bottom + 4, left: r.left, branches: null })
                  void window.api
                    .getGitBranches?.(gitCwd)
                    .then((liste) =>
                      setBrancheMenu((m) => (m ? { ...m, branches: liste ?? [] } : m))
                    )
                    .catch(() => setBrancheMenu((m) => (m ? { ...m, branches: [] } : m)))
                }}
              >
                <ForkIcon /> {gitBranch}
              </button>
            )}
            {/* La depense du fil vit dans la barre du haut, plus dans la zone de saisie. */}
            <ConversationCostIndicator conversationId={activeId ?? undefined} busy={busy} />
          </div>
        </div>
      </div>
      <div className="row gap2 chat-head-actions">
        {/* NAVIGATEUR INTÉGRÉ (lot 3/5 ; Mini-adresse) : ouvre ou ferme le
                  panneau, comme Ctrl+Shift+B. */}
        <BoutonNavigateur
          conversationId={activeId}
          ouvert={navigateurOuvert}
          nonVus={pagesNonVues}
          onBasculer={basculerNavigateur}
        />
        <BoutonBureauxCaches
          ouvert={bureauxOuverts}
          nonVus={bureauxNonVus}
          onBasculer={() => setPanneaux((ouverts) => basculerBureauxDans(ouverts, placePanneau))}
        />
        {/* DÉTAILS, LE MÊME BOUTON CREUX QUE LA MINI-ADRESSE (2026-10-30 : « le bouton
                  détail met lui le meme look »). Il portait le balisage de ThinkingBlock,
                  donc ses règles, ses reflets et le chanfrein de chaque thème : un vrai bouton de
                  la même classe que son voisin garde les deux identiques. */}
        <BoutonDetails
          ouvert={showRuns}
          libelle={texteFil('entete.details')}
          titre={texteFil('entete.details.titre')}
          runsOuverts={openRunsCount}
          onBasculer={() => setShowRuns((v) => !v)}
        />
      </div>
      {/* LA JAUGE DE CONTEXTE EST LE SEPARATEUR ENTRE L'EN-TETE ET LE FIL : posee sur
               le filet du bas de l'en-tete. Meme source que tout le reste : `jaugeCourante`. Au survol,
               le panneau de detail et son action Compacter. */}
      <ChatContextRule
        ratio={jaugeCourante?.ratio}
        level={jaugeCourante?.level}
        title={(() => {
          const j = jaugeCourante
          if (!j) return undefined
          return texteFil('contexte.jauge', {
            utilises: formaterNombre(j.used),
            limite: formaterNombre(j.limit),
            pourcent: Math.round(j.ratio * 100),
            cache: formaterNombre(j.cacheRead)
          })
        })()}
        panelNode={(() => {
          const j = jaugeCourante
          if (!j) return undefined
          const statique = activeId != null ? contextesStatiques[activeId] : undefined
          return (
            <ContextGaugeDetail
              gauge={j}
              contexte={statique ? composerContexte(statique, j.used, j.limit) : undefined}
              busy={busy}
              onCompact={activeId != null ? () => void send(COMPACT_REQUEST) : undefined}
            />
          )
        })()}
      />
    </header>
  )
}
