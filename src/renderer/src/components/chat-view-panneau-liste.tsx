import { VueMesuree } from './VueMesuree'
import { texteFil, texteDeLaSituation, LIBELLE_FILTRE_STATUT } from './chat-view-outils'
import { LigneLimiteDeModele } from './LigneLimiteDeModele'
import { ConvListeProgressive } from './ConvListeProgressive'
import {
  libelleDensite,
  densiteSuivante,
  traitsDensite,
  type RuntimeModel,
  type OrchestratorModelOption
} from './chat-view-model'
import type { ConversationSearchHit } from './conversation-search'
import type { Conv } from './chat-view-types'
import type { CoupureParLimiteDeModele, SituationDeReprise } from '../../../shared/reprise-quota'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
/** Le panneau gauche : recherche, nouveau fil, liste des conversations (ou sélection groupée) et pied de liste. */
export function PanneauDesConversations({
  activeId,
  cleRepriseQuota,
  convDensity,
  conversationHits,
  conversationsPaneWidth,
  convQuery,
  convs,
  convsCoupeesParQuota,
  convSelectionMode,
  convStatusFilter,
  convViewMode,
  coupuresParModele,
  fermerToutesFenetresMosaique,
  lignesAffichables,
  marquerInactive,
  modelCatalog,
  mosaicIds,
  mosaicIdsRef,
  newConv,
  nouvelleFenetreMosaique,
  ouvrirDansMosaique,
  quitterModeSelection,
  rendreLignesListe,
  reprendreConversationsCoupeesParQuota,
  reprendreSurUnAutreModele,
  repriseQuotaMasqueePour,
  repriseQuotaNotice,
  selectedConvIds,
  setBulkDeleteAsking,
  setConvDensity,
  setConvFolderMenu,
  setConvQuery,
  setConvStatusFilter,
  setConvViewMode,
  setListeTelOuverte,
  setRepriseQuotaMasqueePour,
  setSaisieCategorie,
  signalerFils,
  situationsDeLaReprise
}: {
  activeId: string | null
  cleRepriseQuota: string
  convDensity: 'compact' | 'normal' | 'detail'
  conversationHits: ConversationSearchHit<Conv>[]
  conversationsPaneWidth: number
  convQuery: string
  convs: Conv[]
  convsCoupeesParQuota: Conv[]
  convSelectionMode: boolean
  convStatusFilter: 'toutes' | 'actives' | 'inactives'
  convViewMode: 'list' | 'mosaic'
  coupuresParModele: CoupureParLimiteDeModele[]
  fermerToutesFenetresMosaique: () => void
  lignesAffichables: number
  marquerInactive: (conversationId: string, on: boolean) => Promise<void>
  modelCatalog: RuntimeModel[]
  mosaicIds: string[]
  mosaicIdsRef: React.RefObject<string[]>
  newConv: () => void
  nouvelleFenetreMosaique: (brouillon?: string | undefined) => Promise<void>
  ouvrirDansMosaique: (id: string) => Promise<void>
  quitterModeSelection: () => void
  rendreLignesListe: (dessinees: number) => React.JSX.Element[]
  reprendreConversationsCoupeesParQuota: () => void
  reprendreSurUnAutreModele: (
    ids: readonly string[],
    option: OrchestratorModelOption
  ) => Promise<void>
  repriseQuotaMasqueePour: string | null
  repriseQuotaNotice: string | null
  selectedConvIds: ReadonlySet<string>
  setBulkDeleteAsking: React.Dispatch<React.SetStateAction<boolean>>
  setConvDensity: React.Dispatch<React.SetStateAction<'compact' | 'normal' | 'detail'>>
  setConvFolderMenu: React.Dispatch<
    React.SetStateAction<{
      conv: Conv | null
      ids?: string[] | undefined
      top: number
      left: number
      mode: 'dossier' | 'categorie'
    } | null>
  >
  setConvQuery: React.Dispatch<React.SetStateAction<string>>
  setConvStatusFilter: React.Dispatch<React.SetStateAction<'toutes' | 'actives' | 'inactives'>>
  setConvViewMode: React.Dispatch<React.SetStateAction<'list' | 'mosaic'>>
  setListeTelOuverte: React.Dispatch<React.SetStateAction<boolean>>
  setRepriseQuotaMasqueePour: React.Dispatch<React.SetStateAction<string | null>>
  setSaisieCategorie: React.Dispatch<React.SetStateAction<string | null>>
  signalerFils: (ids: readonly string[]) => void
  situationsDeLaReprise: SituationDeReprise[]
}): React.JSX.Element {
  return (
    <VueMesuree id="chat-liste">
      <aside
        className="lisere-dessus conv-pane"
        // Le titre visible est parti (2026-10-15) : le panneau garde son NOM pour les lecteurs d'ecran.
        // « Conversations » s'écrit pareil en anglais.
        aria-label="Conversations"
        data-view-mode={convViewMode}
        data-density={convDensity}
        // Une RECHERCHE en cours re-montre la ligne d'identifiant meme en cran serre : taper « 171 »
        // doit continuer de prouver qu'on a trouve la bonne conversation (lecon du 2026-09-03).
        data-recherche={convQuery.trim() ? 'oui' : undefined}
        style={{ width: `${conversationsPaneWidth}px` }}
      >
        {/* Le tiroir téléphone porte SON bouton de fermeture : posé sous l'en-tête à une
              hauteur devinée, il recouvrait le ☰ de l'en-tête sur le vrai écran de l'utilisateur. */}
        <button
          type="button"
          className="chat-liste-tel-btn conv-pane-fermer-tel"
          aria-label="Fermer la liste des conversations"
          onClick={() => setListeTelOuverte(false)}
        >
          ✕
        </button>
        {/* SANS TITRE (demande du 2026-10-15) : « Conversations » prenait une ligne pour ne rien
            dire. La ligne d'en-tete n'existe plus que pour « Tout fermer », en mosaique. */}
        {convViewMode === 'mosaic' && mosaicIds.length > 0 && (
          <div className="conv-head">
            <button
              type="button"
              className="conv-mosaic-close-all"
              data-testid="conv-mosaic-close-all"
              title={texteFil('mosaique.fermerTout.titre')}
              aria-label={texteFil('mosaique.fermerTout.titre')}
              onClick={fermerToutesFenetresMosaique}
            >
              {texteFil('mosaique.fermerTout')}
            </button>
          </div>
        )}
        {/* RECHERCHE EN TETE, « Nouveau fil » juste dessous (2026-10-15 : « inverse la position de
            recherche et nouveau fil »). Les deux restent HORS de la liste qui defile : le bouton
            etait sinon emporte par le defilement.
            fix-ok: cause mesuree — le bouton etait le 1er enfant de `.conv-list` (le conteneur
            scroll-y) ; ChatView.tete-panneau.test.tsx rouge sur l'ancien code
            (« expected true to be false »), vert ici. */}
        <div className="conv-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={convQuery}
            onChange={(event) => setConvQuery(event.target.value)}
            placeholder={texteFil('liste.recherche')}
            aria-label={texteFil('liste.recherche.aria')}
          />
          {convQuery && (
            <button onClick={() => setConvQuery('')} title={texteFil('liste.recherche.effacer')}>
              ×
            </button>
          )}
        </div>
        <button
          className={`conv-new-row${convViewMode !== 'mosaic' && activeId === null ? ' active' : ''}`}
          onClick={() => {
            // En mosaique, « Nouveau » doit OUVRIR UNE FENETRE de plus : vider le fil unique,
            // masque derriere la grille, ne produisait aucun effet visible.
            if (convViewMode === 'mosaic') void nouvelleFenetreMosaique()
            else newConv()
          }}
          title={texteFil('liste.nouveau.titre')}
          aria-current={activeId === null ? 'page' : undefined}
        >
          <span className="conv-new-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span className="conv-new-title">{texteFil('liste.nouveau')}</span>
        </button>
        {/*
          La barre n'existe QUE pendant une sélection en cours : hors de ce moment elle n'offrait
          qu'un bouton « Sélectionner » vu toute la journée pour un geste rare. L'entrée est
          désormais dans le menu contextuel d'une conversation, au-dessus de « Supprimer ».
        */}
        {convSelectionMode && convViewMode !== 'mosaic' && (
          <div className="conv-bulk-bar">
            <button type="button" className="conv-date-sort" onClick={() => quitterModeSelection()}>
              {texteFil('selection.annuler')}
            </button>
            {(() => {
              // Si TOUT le lot est déjà inactif, le geste utile est l'inverse.
              const lot = convs.filter((c) => selectedConvIds.has(c.id))
              const toutInactif = lot.length > 0 && lot.every((c) => c.inactive)
              return (
                <button
                  type="button"
                  className="conv-date-sort"
                  data-testid="conv-bulk-inactive"
                  disabled={selectedConvIds.size === 0}
                  onClick={() => {
                    const ids = [...selectedConvIds]
                    quitterModeSelection()
                    void (async () => {
                      for (const id of ids) await marquerInactive(id, !toutInactif)
                    })()
                  }}
                >
                  {toutInactif ? texteFil('liste.desarchiver') : texteFil('liste.archiver')}
                </button>
              )
            })()}
            <button
              type="button"
              className="conv-date-sort"
              data-testid="conv-bulk-category"
              disabled={selectedConvIds.size === 0}
              onClick={(event) => {
                const r = event.currentTarget.getBoundingClientRect()
                setSaisieCategorie(null)
                setConvFolderMenu({
                  conv: null,
                  ids: [...selectedConvIds],
                  top: r.bottom + 4,
                  left: r.left,
                  mode: 'categorie'
                })
              }}
            >
              {texteFil('liste.rangerCategorie')}
            </button>
            <button
              type="button"
              className="conv-date-sort"
              data-testid="conv-bulk-signaler"
              disabled={selectedConvIds.size === 0}
              title={texteFil('selection.signaler.titre')}
              onClick={() => {
                const ids = [...selectedConvIds]
                quitterModeSelection()
                signalerFils(ids)
              }}
            >
              {texteFil('selection.signaler', { n: selectedConvIds.size })}
            </button>
            <button
              type="button"
              className="conv-date-sort conv-bulk-del"
              disabled={selectedConvIds.size === 0}
              onClick={() => setBulkDeleteAsking(true)}
            >
              {texteFil('selection.supprimer', { n: selectedConvIds.size })}
            </button>
          </div>
        )}
        {/* MASQUE quand rien n'est coupe : un bouton « 0 » vu toute la journee devient du decor.
            La notice garde le bloc ouvert quelques secondes apres le clic : tous les fils repris
            passent occupes d'un coup et sortent de la liste des coupes, le clic resterait sinon
            sans accuse de reception. */}
        {(convsCoupeesParQuota.length > 0 || coupuresParModele.length > 0 || repriseQuotaNotice) &&
          repriseQuotaMasqueePour !== cleRepriseQuota && (
            <div className="conv-reprise-quota" data-testid="conv-reprise-quota">
              <button
                type="button"
                className="conv-reprise-quota-fermer"
                data-testid="conv-reprise-quota-fermer"
                aria-label={texteFil('quota.masquer')}
                title={texteFil('quota.masquer.titre')}
                onClick={() => setRepriseQuotaMasqueePour(cleRepriseQuota)}
              >
                ×
              </button>
              {/* Le BOUTON lui-meme ne s'affiche que s'il a quelque chose a reprendre : apres une
                reprise, la notice reste seule quelques secondes, sans un « (0) » qui n'offre
                rien a cliquer. */}
              {convsCoupeesParQuota.length > 0 ? (
                <button
                  type="button"
                  className="conv-date-sort"
                  data-testid="conv-reprise-quota-bouton"
                  onClick={reprendreConversationsCoupeesParQuota}
                  title={texteFil('quota.reprendre.titre')}
                >
                  {texteFil('quota.reprendre', { n: convsCoupeesParQuota.length })}
                </button>
              ) : null}
              {situationsDeLaReprise.map((situation) => (
                <span
                  key={`${situation.etat}:${situation.etat === 'manuelle' ? situation.raison : ''}`}
                  className="conv-auto-notice"
                  data-testid="conv-reprise-quota-etat"
                >
                  {texteDeLaSituation(situation)}
                </span>
              ))}
              {/* La limite d'UN modèle : le bouton du dessus la reprendrait sur le même modèle, qui
                refuserait encore. Sa ligne propose un autre modèle, au clic seulement. */}
              {coupuresParModele.map((coupure) => (
                <LigneLimiteDeModele
                  key={coupure.modele}
                  coupure={coupure}
                  models={modelCatalog}
                  onReprendre={(ids, option) => void reprendreSurUnAutreModele(ids, option)}
                />
              ))}
              {repriseQuotaNotice ? (
                <span className="conv-auto-notice" data-testid="conv-reprise-quota-notice">
                  {repriseQuotaNotice}
                </span>
              ) : null}
            </div>
          )}
        {/* fix-ok: cause mesurée — chaque tranche relançait tout ChatView, un rendu du chat par tranche pendant le
              déroulé (ChatView.gel-liste-detail.test.tsx). L'état du déroulé vit dans ConvListeProgressive,
              qui porte aussi la zone `.conv-list`. */}
        <ConvListeProgressive total={lignesAffichables} rendre={rendreLignesListe}>
          {convs.length === 0 && (
            <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>
              {texteFil('liste.vide')}
            </div>
          )}
          {convs.length > 0 && conversationHits.length === 0 && (
            <div className="conv-search-empty">{texteFil('liste.aucunResultat')}</div>
          )}
        </ConvListeProgressive>
        {/* PIED DE LISTE (demande du 2026-09-23) : filtre de statut, densite et mosaique
            vivent ici, plus dans l'en-tete. */}
        <div className="conv-foot" data-testid="conv-foot">
          <button
            type="button"
            className="conv-status-filter"
            data-testid="conv-status-filter"
            data-filter={convStatusFilter}
            title={texteFil('liste.filtre.titre', {
              statut: texteFil(LIBELLE_FILTRE_STATUT[convStatusFilter])
            })}
            aria-label={texteFil('liste.filtre.aria', {
              statut: texteFil(LIBELLE_FILTRE_STATUT[convStatusFilter])
            })}
            onClick={() =>
              setConvStatusFilter((f) =>
                f === 'toutes' ? 'actives' : f === 'actives' ? 'inactives' : 'toutes'
              )
            }
          >
            {/* Icone et libelles du pied : MASQUES par defaut (ChatView.css), montres par le
                theme qui les dessine (Nebuleuse de verre, capsule D2-6 choisie). */}
            {convStatusFilter === 'toutes' && (
              <svg
                className="conv-foot-icone"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M4 5h16l-6 7v6l-4 2v-8z" />
              </svg>
            )}
            {convStatusFilter === 'toutes'
              ? texteFil('liste.filtre.toutes')
              : convStatusFilter === 'actives'
                ? texteFil('liste.filtre.activesPied')
                : texteFil('liste.filtre.archiveesPied')}
          </button>
          <span className="conv-foot-spacer" />
          <button
            type="button"
            className="conv-density-toggle"
            data-testid="conv-density-toggle"
            data-density={convDensity}
            title={texteFil('densite.titre', {
              densite: libelleDensite(convDensity),
              suivante: libelleDensite(densiteSuivante(convDensity))
            })}
            aria-label={texteFil('densite.aria', { densite: libelleDensite(convDensity) })}
            onClick={() => setConvDensity(densiteSuivante(convDensity))}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              {traitsDensite(convDensity).map((y) => (
                <rect key={y} x="2" y={y} width="12" height="1.5" rx="0.75" />
              ))}
            </svg>
            <span className="conv-foot-libelle">{libelleDensite(convDensity)}</span>
          </button>
          <button
            type="button"
            className="conv-view-toggle"
            data-testid="conv-view-toggle"
            role="switch"
            aria-checked={convViewMode === 'mosaic'}
            aria-label={texteFil('vue.mosaique.aria')}
            title={
              convViewMode === 'mosaic'
                ? texteFil('vue.revenirListe')
                : texteFil('vue.passerMosaique')
            }
            onClick={() => {
              if (convViewMode === 'mosaic') {
                setConvViewMode('list')
                return
              }
              setConvViewMode('mosaic')
              // La mosaique s'ouvre SUR ce qu'on regardait. Sans cette reprise, la bascule
              // laissait la moitie droite VIDE alors qu'une conversation etait ouverte juste
              // avant le clic (demande du 2026-09-17). On ne sert QUE la mosaique vide : si
              // des fenetres sont deja ouvertes, l'utilisateur a deja choisi son plan de
              // travail, et « Tout fermer » doit rester une mosaique vide.
              if (mosaicIdsRef.current.length === 0 && activeId) void ouvrirDansMosaique(activeId)
            }}
          >
            <svg
              className="conv-foot-icone"
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
              <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
              <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
              <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
            </svg>
            {/* « Chat » s'écrit pareil en anglais. */}
            <span className="conv-foot-libelle">
              {convViewMode === 'mosaic' ? texteFil('vue.mosaique') : 'Chat'}
            </span>
            <span className="conv-view-toggle-knob" aria-hidden="true" />
          </button>
        </div>
      </aside>
    </VueMesuree>
  )
}
