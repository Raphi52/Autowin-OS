import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  buildOrchestratorModelGroups,
  type OrchestratorModelOption,
  type RuntimeModel
} from './chat-view-model'
import type { OrchestratorProviderStatus } from './OrchestratorModelSelector'
import { effortLabel, sortEfforts } from './model-effort-labels'
import { recommendedEffort } from './model-effort-recommendations'
import { shortModelLabel } from './model-display-label'
import { libelleFournisseur } from './provider-labels'
import { CLE_DU_STATUT, STATUTS_BLOQUANTS } from './statuts-fournisseur'
import { useTextesChatPanneaux } from '../textes-ecrans/chat-panneaux'
import { Spinner } from './Spinner'
import './ModeleDeroulant.css'

/**
 * LE MENU DÉROULANT DE MODÈLE D'AGENT STUDIO — choix de l'utilisateur : un vrai menu déroulant
 * sous sa barre, de la même largeur qu'elle, et non la fenêtre du chat (onglets par fournisseur,
 * curseurs d'effort, coins décorés, plus étroite que la barre).
 *
 * La liste vit DANS la carte, collée sous la barre (`position: absolute`) : elle suit la barre au
 * défilement, prend sa largeur exacte et passe par-dessus la suite de la carte. Les modèles y sont
 * groupés par fournisseur ; chaque ligne porte ses niveaux d'effort en pastilles, alignés en
 * colonnes dans un même fournisseur. Cliquer le nom choisit le modèle à son effort retenu ;
 * cliquer une pastille choisit le modèle à cet effort.
 *
 * Mêmes règles de choix que le menu du chat : mêmes modèles (`buildOrchestratorModelGroups`),
 * mêmes efforts lus dans le catalogue, même refus d'un fournisseur injoignable.
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

interface LigneDeModele {
  cle: string
  option: OrchestratorModelOption
  /** Efforts réellement choisissables, dans l'ordre croissant ; vide = modèle sans effort. */
  efforts: string[]
  statut?: string
  bloquee: boolean
}

interface GroupeDeFournisseur {
  libelle: string
  lignes: LigneDeModele[]
  /** Union ordonnée des efforts du groupe : une colonne par effort, pour aligner les pastilles. */
  colonnes: string[]
}

/** L'effort que prend un clic sur le NOM : le courant s'il s'agit du modèle choisi, sinon celui
 *  du catalogue, sinon le cran du milieu — la même règle que la matrice du chat. */
function effortRetenu(ligne: LigneDeModele, active: boolean, effortActif?: string): string {
  if (ligne.efforts.length === 0) return 'none'
  if (active && effortActif && ligne.efforts.includes(effortActif)) return effortActif
  const duCatalogue = ligne.option.defaultReasoningEffort
  if (duCatalogue && ligne.efforts.includes(duCatalogue)) return duCatalogue
  return ligne.efforts[Math.floor((ligne.efforts.length - 1) / 2)]
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

  const groupes = useMemo((): GroupeDeFournisseur[] => {
    const parLibelle = new Map<string, LigneDeModele[]>()
    for (const option of grouped.groups.flatMap((groupe) => groupe.options)) {
      const statut = statuses?.find((s) => s.provider === option.provider)?.status
      const ligne: LigneDeModele = {
        cle: `${option.provider}:${option.model}`,
        option,
        efforts: sortEfforts(option.reasoningEfforts.filter((effort) => effort !== 'none')),
        statut,
        bloquee: statut !== undefined && STATUTS_BLOQUANTS.has(statut)
      }
      // Groupés par NOM de fournisseur : Gemini par abonnement et par clé restent ensemble.
      const libelleGroupe = libelleFournisseur(option.provider)
      const lignes = parLibelle.get(libelleGroupe)
      if (lignes) lignes.push(ligne)
      else parLibelle.set(libelleGroupe, [ligne])
    }
    return [...parLibelle.entries()].map(([libelleGroupe, lignes]) => ({
      libelle: libelleGroupe,
      lignes,
      colonnes: sortEfforts([...new Set(lignes.flatMap((ligne) => ligne.efforts))])
    }))
  }, [grouped, statuses])

  const optionCourante = groupes
    .flatMap((groupe) => groupe.lignes)
    .find((ligne) => ligne.cle === cleActive)?.option
  /*
   * Un enregistrement en cours ne ferme pas la barre : la vue des rôles enfile ses écritures dans
   * l'ordre (`persist`), et les petites tâches ignorent un second choix tant que le premier
   * s'écrit. La roue qui tourne au bout de la barre dit seulement que l'écriture n'est pas finie.
   */
  const desactive = busy || !catalogLoaded || models.length === 0
  const libelleStatut = (statut: string): string => {
    const cle = CLE_DU_STATUT[statut]
    return cle ? t(cle) : statut
  }
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

  function choisir(ligne: LigneDeModele, effort: string): void {
    if (ligne.bloquee || busy) return
    fermer(true)
    onSelect({ ...ligne.option, reasoningEffort: effort })
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
  // bord de la page), puis le modèle choisi prend le focus, pour un choix au clavier immédiat.
  useEffect(() => {
    if (!ouvert) return
    const liste = listeRef.current
    if (!liste) return
    liste.scrollIntoView?.({ block: 'nearest' })
    const cible =
      liste.querySelector<HTMLButtonElement>('[aria-current="true"]') ??
      liste.querySelector<HTMLButtonElement>('button')
    cible?.focus({ preventScroll: true })
    cible?.scrollIntoView?.({ block: 'nearest' })
  }, [ouvert])

  /** Flèches haut et bas : d'un bouton de la liste au suivant, noms et pastilles compris. */
  function naviguer(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const boutons = [...(listeRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    if (boutons.length === 0) return
    event.preventDefault()
    const index = boutons.indexOf(document.activeElement as HTMLButtonElement)
    const pas = event.key === 'ArrowDown' ? 1 : -1
    const suivant = index === -1 ? 0 : (index + pas + boutons.length) % boutons.length
    boutons[suivant].focus()
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
            {groupes.map((groupe) => (
              <section
                key={groupe.libelle}
                className="modele-deroulant-groupe"
                aria-label={groupe.libelle}
              >
                <span className="modele-deroulant-fournisseur" aria-hidden="true">
                  {groupe.libelle}
                </span>
                {groupe.lignes.map((ligne) => {
                  const active = ligne.cle === cleActive
                  const nom = shortModelLabel(ligne.option.label, ligne.option.provider)
                  const refus = ligne.bloquee
                    ? t('selecteur.injoignable', {
                        provider: ligne.option.provider,
                        statut: libelleStatut(ligne.statut as string)
                      })
                    : undefined
                  const conseille = recommendedEffort(ligne.option.provider, ligne.option.model)
                  return (
                    <div
                      key={ligne.cle}
                      className={`modele-deroulant-ligne${active ? ' is-active' : ''}${ligne.bloquee ? ' is-bloquee' : ''}`}
                      data-row={ligne.cle}
                    >
                      <button
                        type="button"
                        className="modele-deroulant-nom"
                        aria-current={active || undefined}
                        aria-disabled={ligne.bloquee || busy || undefined}
                        title={refus}
                        onClick={() => choisir(ligne, effortRetenu(ligne, active, effortActif))}
                      >
                        <strong>{nom}</strong>
                        <small>{ligne.option.model}</small>
                        {/* Seul un état qui REFUSE le choix s'affiche : « installé, non testé »
                            sur chaque ligne n'était que du bruit. */}
                        {ligne.bloquee && (
                          <em className="modele-deroulant-statut">
                            {libelleStatut(ligne.statut as string)}
                          </em>
                        )}
                      </button>
                      {ligne.efforts.length > 0 && (
                        <span
                          className="modele-deroulant-crans"
                          role="radiogroup"
                          aria-label={t('matrice.effortPour', { modele: nom })}
                          style={{ '--colonnes': groupe.colonnes.length } as React.CSSProperties}
                        >
                          {groupe.colonnes.map((effort) =>
                            ligne.efforts.includes(effort) ? (
                              <button
                                key={effort}
                                type="button"
                                role="radio"
                                data-effort={effort}
                                aria-checked={active && effort === effortActif}
                                aria-disabled={ligne.bloquee || busy || undefined}
                                className={`modele-deroulant-cran${conseille === effort ? ' is-conseille' : ''}`}
                                title={
                                  refus ??
                                  (conseille === effort
                                    ? t('matrice.recommande', {
                                        effort: effortLabel(effort),
                                        modele: nom
                                      })
                                    : undefined)
                                }
                                onClick={() => choisir(ligne, effort)}
                              >
                                {effortLabel(effort)}
                              </button>
                            ) : (
                              // Place gardée : les pastilles restent alignées en colonnes.
                              <span
                                key={effort}
                                className="modele-deroulant-cran is-absent"
                                aria-hidden="true"
                              >
                                {effortLabel(effort)}
                              </span>
                            )
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}
              </section>
            ))}
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
