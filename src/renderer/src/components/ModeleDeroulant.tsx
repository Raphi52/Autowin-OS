import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  buildOrchestratorModelGroups,
  type OrchestratorModelOption,
  type RuntimeModel
} from './chat-view-model'
import type { OrchestratorProviderStatus } from './OrchestratorModelSelector'
import { ModelEffortMatrix, type ModelEffortRow } from './ModelEffortMatrix'
import { effortLabel } from './model-effort-labels'
import { shortModelLabel } from './model-display-label'
import { CLE_DU_STATUT, STATUTS_BLOQUANTS } from './statuts-fournisseur'
import { useTextesChatPanneaux } from '../textes-ecrans/chat-panneaux'
import { Spinner } from './Spinner'
// La grille modèle × effort et ses onglets gardent les styles de la fenêtre du chat.
import './ChatView.css'
import './ModelQuotaIndicator.css'
import './ModeleDeroulant.css'

/**
 * LE MENU DÉROULANT DE MODÈLE D'AGENT STUDIO — choix de l'utilisateur, en deux temps :
 *  - un vrai menu déroulant, soudé sous sa barre et de la même largeur qu'elle, et non une fenêtre
 *    flottante plus étroite que la barre ;
 *  - dedans, la même grille que la fenêtre du chat : un onglet par fournisseur, une ligne par
 *    modèle, un point par niveau d'effort (`ModelEffortMatrix`, réutilisée telle quelle).
 *
 * La liste vit DANS la carte (`position: absolute`) : elle suit la barre au défilement et passe
 * par-dessus la suite de la carte. Mêmes règles de choix que le menu du chat : mêmes modèles
 * (`buildOrchestratorModelGroups`), mêmes efforts lus dans le catalogue, même refus d'un
 * fournisseur injoignable.
 */
export interface ProprietesMenuDeModele {
  /** Un tour tourne : aucun modèle ne se choisit. */
  busy: boolean
  catalogLoaded: boolean
  models: RuntimeModel[]
  /** Absent = aucun statut connu : aucun modèle n'est alors refusé. */
  statuses?: OrchestratorProviderStatus[]
  binding: { provider: string; model?: string; reasoningEffort?: string } | null
  pending: boolean
  error: string | null
  onSelect: (option: OrchestratorModelOption) => void
  /** Nom du réglage, pour les lecteurs d'écran (« Orchestrateur », « Sous-agent 2 »…). */
  libelle?: string
  aide?: string
  idBase?: string
}

export function ModeleDeroulant({
  busy,
  catalogLoaded,
  models,
  statuses,
  binding,
  pending,
  error,
  onSelect,
  libelle,
  aide,
  idBase: idBaseFourni
}: ProprietesMenuDeModele): React.JSX.Element {
  const { t } = useTextesChatPanneaux()
  const idAuto = useId()
  const idBase = idBaseFourni ?? `modele-deroulant-${idAuto}`
  const [ouvert, setOuvert] = useState(false)
  const coqueRef = useRef<HTMLDivElement>(null)
  const barreRef = useRef<HTMLButtonElement>(null)
  const listeRef = useRef<HTMLDivElement>(null)

  const grouped = useMemo(
    () => buildOrchestratorModelGroups(models, binding ?? undefined),
    [models, binding]
  )
  // Le catalogue peut nommer le modèle par son `id` : la clé active suit le nom du catalogue.
  const modeleCourant = binding?.model
    ? (models.find(
        (item) =>
          item.provider === binding.provider &&
          (item.model === binding.model || item.id === binding.model)
      )?.model ?? binding.model)
    : undefined
  const cleActive = binding && modeleCourant ? `${binding.provider}:${modeleCourant}` : null
  const effortActif =
    binding?.reasoningEffort && binding.reasoningEffort !== 'none'
      ? binding.reasoningEffort
      : undefined

  const libelleStatut = (statut: string): string => {
    const cle = CLE_DU_STATUT[statut]
    return cle ? t(cle) : statut
  }

  /*
   * Une ligne de la grille par modèle du catalogue. Un modèle sans niveau de réflexion garde un
   * point unique, « Standard » (`none`) : sans lui, il n'aurait aucune place dans les onglets (la
   * fenêtre du chat le relègue dans une liste sous la grille).
   */
  const lignes: ModelEffortRow[] = grouped.groups
    .flatMap((groupe) => groupe.options)
    .map((option) => {
      const statut = statuses?.find((s) => s.provider === option.provider)?.status
      const injoignable = statut !== undefined && STATUTS_BLOQUANTS.has(statut)
      const efforts = option.reasoningEfforts.filter((effort) => effort !== 'none')
      return {
        key: `${option.provider}:${option.model}`,
        label: option.label,
        model: option.model,
        option,
        efforts: efforts.length > 0 ? efforts : ['none'],
        blocked: injoignable || busy,
        blockedReason: injoignable
          ? t('selecteur.injoignable', {
              provider: option.provider,
              statut: libelleStatut(statut as string)
            })
          : busy
            ? t('selecteur.verrouille')
            : undefined
      }
    })

  const optionCourante = lignes.find((ligne) => ligne.key === cleActive)?.option
  /*
   * Un enregistrement en cours ne ferme pas la barre : la vue des rôles enfile ses écritures dans
   * l'ordre (`persist`), et les petites tâches ignorent un second choix tant que le premier
   * s'écrit. La roue qui tourne au bout de la barre dit seulement que l'écriture n'est pas finie.
   */
  const desactive = busy || !catalogLoaded || models.length === 0
  const libelleCourant = !catalogLoaded ? (
    <>
      <Spinner /> {t('selecteur.chargement')}
    </>
  ) : models.length === 0 ? (
    t('selecteur.aucunModele')
  ) : (
    shortModelLabel(
      grouped.currentMissing?.label ?? optionCourante?.label ?? t('selecteur.choisirCible'),
      grouped.currentMissing?.provider ?? optionCourante?.provider
    )
  )

  function fermer(rendreLeFocus: boolean): void {
    setOuvert(false)
    if (rendreLeFocus) barreRef.current?.focus()
  }

  // Un clic hors du menu le referme, comme toute liste déroulante.
  useEffect(() => {
    if (!ouvert) return
    const fermerAuClicDehors = (event: PointerEvent): void => {
      if (event.target instanceof Node && !coqueRef.current?.contains(event.target)) {
        setOuvert(false)
      }
    }
    document.addEventListener('pointerdown', fermerAuClicDehors)
    return () => document.removeEventListener('pointerdown', fermerAuClicDehors)
  }, [ouvert])

  // À l'ouverture : la liste entre dans la vue (la carte du bas la ferait sinon déborder sous le
  // bord de la page), puis le point du modèle choisi prend le focus, pour un choix au clavier.
  useEffect(() => {
    if (!ouvert) return
    const liste = listeRef.current
    if (!liste) return
    liste.scrollIntoView?.({ block: 'nearest' })
    const cible =
      liste.querySelector<HTMLButtonElement>('[data-effort][aria-checked="true"]') ??
      liste.querySelector<HTMLButtonElement>('button[data-effort]')
    cible?.focus({ preventScroll: true })
  }, [ouvert])

  /**
   * Les flèches dans la grille : gauche et droite d'un point au voisin de la même ligne (ou d'un
   * onglet au voisin), haut et bas au même niveau d'effort de la ligne voisine.
   */
  function naviguer(event: React.KeyboardEvent<HTMLDivElement>): void {
    const liste = listeRef.current
    const actif = document.activeElement
    if (!liste || !(actif instanceof HTMLElement)) return
    const versLe = (cible: Element | null | undefined): void => {
      if (!(cible instanceof HTMLElement)) return
      event.preventDefault()
      cible.focus()
    }
    const voisin = (elements: Element[], courant: Element, pas: number): Element | undefined =>
      elements[elements.indexOf(courant) + pas]
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown'
    const pas = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    if (actif.getAttribute('role') === 'tab') {
      if (horizontal) versLe(voisin([...liste.querySelectorAll('[role="tab"]')], actif, pas))
      else if (event.key === 'ArrowDown') versLe(liste.querySelector('button[data-effort]'))
      return
    }
    const ligne = actif.closest('[data-row]')
    if (!ligne || !actif.matches('button[data-effort]')) return
    if (horizontal) {
      versLe(voisin([...ligne.querySelectorAll('button[data-effort]')], actif, pas))
      return
    }
    if (!vertical) return
    const autre = voisin([...liste.querySelectorAll('[data-row]')], ligne, pas)
    if (!autre) {
      // En haut de la grille, la flèche remonte aux onglets.
      if (pas === -1) versLe(liste.querySelector('[role="tab"][aria-selected="true"]'))
      return
    }
    const effort = actif.getAttribute('data-effort')
    const points = [...autre.querySelectorAll('button[data-effort]')]
    versLe(points.find((point) => point.getAttribute('data-effort') === effort) ?? points.at(-1))
  }

  return (
    <div
      ref={coqueRef}
      className={`modele-deroulant${ouvert ? ' is-ouvert' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && ouvert) {
          event.stopPropagation()
          fermer(true)
        }
      }}
      onBlur={(event) => {
        // Le focus quitte le menu (Tab) : la liste se referme. Un clic dans la liste garde
        // `relatedTarget` vide ou dedans : elle reste ouverte.
        if (
          ouvert &&
          event.relatedTarget instanceof Node &&
          !coqueRef.current?.contains(event.relatedTarget)
        ) {
          setOuvert(false)
        }
      }}
    >
      <span className="modele-deroulant-cache" id={`${idBase}-libelle`}>
        {libelle ?? t('selecteur.libelle.orchestrateur')}
      </span>
      <div className="modele-deroulant-ancre">
        <button
          ref={barreRef}
          type="button"
          id={idBase}
          data-testid={idBase}
          className="modele-deroulant-barre"
          aria-expanded={ouvert}
          aria-controls={`${idBase}-liste`}
          aria-labelledby={`${idBase}-libelle ${idBase}-courant`}
          aria-describedby={`${idBase}-help ${idBase}-status`}
          aria-busy={pending || undefined}
          disabled={desactive}
          onClick={() => setOuvert((courant) => !courant)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && !ouvert) {
              event.preventDefault()
              setOuvert(true)
            }
          }}
        >
          <strong id={`${idBase}-courant`}>{libelleCourant}</strong>
          {effortActif && <em>{effortLabel(effortActif)}</em>}
          {pending ? <Spinner /> : <i className="modele-deroulant-chevron" aria-hidden="true" />}
        </button>
        {ouvert && (
          <div
            ref={listeRef}
            id={`${idBase}-liste`}
            data-testid={`${idBase}-liste`}
            className="modele-deroulant-liste"
            role="group"
            aria-label={libelle ?? t('selecteur.libelle.orchestrateur')}
            onKeyDown={naviguer}
          >
            {lignes.length > 0 && (
              // La classe de la fenêtre du chat : chaque thème habille ses points et ses lignes
              // sous elle seulement. Le cadre de la fenêtre, lui, est neutralisé (ModeleDeroulant.css).
              <div className="model-select-menu modele-deroulant-grille">
                <ModelEffortMatrix
                  variant="inline"
                  // Déjà en anglais, identique dans les deux langues.
                  title="MODEL × EFFORT"
                  rows={lignes}
                  activeKey={cleActive}
                  activeEffort={effortActif}
                  onSelect={onSelect}
                  onClose={() => fermer(true)}
                />
              </div>
            )}
          </div>
        )}
      </div>
      <span id={`${idBase}-help`} className="modele-deroulant-cache">
        {busy ? t('selecteur.aide.verrouille') : (aide ?? t('selecteur.aide.application'))}
      </span>
      <span
        id={`${idBase}-status`}
        className="modele-deroulant-etat"
        role="status"
        aria-live="polite"
      >
        {pending
          ? t('projet.enregistrement')
          : (error ??
            (catalogLoaded && models.length === 0
              ? t('selecteur.catalogueVide')
              : (grouped.currentMissing?.label ?? '')))}
      </span>
    </div>
  )
}
