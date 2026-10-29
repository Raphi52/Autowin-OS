import { useCallback, useEffect, useState } from 'react'
import './RouterView.css'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'
import type { OrchestratorProviderStatus } from './OrchestratorModelSelector'
import type { RuntimeModel, OrchestratorModelOption } from './chat-view-model'
import { useTextesSettings } from '../textes-ecrans/settings'

/**
 * LE MODÈLE DES PETITES TÂCHES, UN SEUL BLOC POUR DEUX ÉCRANS (conv-1240, 2026-10-28).
 *
 * Le réglage existait dans Réglages → Routage (conv-1097), et Routage avait quitté Agent Studio le
 * 15/10 (conv-963). L'utilisateur le cherchait dans Agent Studio : « le petit model je dois pouvoir
 * le changer dans agents studio je l'ai déjà demandé ». Le bloc est donc partagé, pas recopié :
 * même lecture (`os:petitesTaches`), même écriture (`os:setPetitesTaches`), et chaque écran se
 * relit sur l'événement `roles` — un changement fait dans l'un se voit dans l'autre.
 */
interface Binding {
  provider: string
  model?: string
  reasoningEffort?: string
}

/** Réglage des petites tâches tel que le processus principal le rend (null = jamais posé). */
interface PetitesTaches {
  reglage: Binding | null
  effectif: Binding
}

export function PetitesTachesReglage({
  active,
  models,
  statuses,
  catalogLoaded,
  idBase,
  testId
}: {
  active: boolean
  /** Le catalogue de l'écran hôte ; absent = le bloc le lit lui-même (Agent Studio). */
  models?: RuntimeModel[]
  statuses?: OrchestratorProviderStatus[]
  catalogLoaded?: boolean
  /** Deux écrans restent montés en même temps : leurs `id` ne doivent pas se croiser. */
  idBase: string
  testId: string
}): React.JSX.Element | null {
  const { t } = useTextesSettings()
  const [petitesTaches, setPetitesTaches] = useState<PetitesTaches | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const catalogueFourni = models !== undefined
  const [catalogue, setCatalogue] = useState<{
    models: RuntimeModel[]
    statuses: OrchestratorProviderStatus[]
  } | null>(null)

  // Appel OPTIONNEL : un preload plus ancien que le renderer (app packagée pas encore réinstallée)
  // n'a pas ce canal, et le bloc se cache au lieu de lever un rejet. Un échec de lecture est DIT
  // dans le bloc, jamais avalé.
  const reload = useCallback(async (): Promise<void> => {
    try {
      const etat = await window.api.petitesTaches?.()
      if (etat) setPetitesTaches(etat)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  const reloadCatalogue = useCallback(async (): Promise<void> => {
    if (catalogueFourni) return
    try {
      const [nextModels, nextStatuses] = await Promise.all([
        window.api.models(),
        window.api.providerStatus()
      ])
      setCatalogue({
        models: nextModels as RuntimeModel[],
        statuses: nextStatuses as OrchestratorProviderStatus[]
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [catalogueFourni])

  useEffect(() => {
    if (!active) return
    void Promise.resolve().then(reload)
    void Promise.resolve().then(reloadCatalogue)
    const off = window.api.onAppEvent((event) => {
      // Le modèle du chat change aussi l'EFFECTIF des petites tâches quand elles ne sont pas réglées.
      if (event.type === 'refresh' && event.scope === 'roles') {
        void reload()
        void reloadCatalogue()
      }
    })
    return () => off()
  }, [active, reload, reloadCatalogue])

  const changer = async (option: OrchestratorModelOption | null): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const etat = option
        ? await window.api.setPetitesTaches(option.provider, option.model, option.reasoningEffort)
        : await window.api.setPetitesTaches(null)
      setPetitesTaches(etat)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  if (!petitesTaches && !error) return null
  return (
    <section className="router-default" data-testid={testId}>
      <header>
        <h3>{t('routeur.petites.titre')}</h3>
        <small>{t('routeur.petites.aide')}</small>
      </header>
      <OrchestratorModelSelector
        busy={false}
        catalogLoaded={catalogueFourni ? Boolean(catalogLoaded) : catalogue !== null}
        models={models ?? catalogue?.models ?? []}
        statuses={statuses ?? catalogue?.statuses}
        binding={petitesTaches?.effectif ?? null}
        pending={pending}
        error={error}
        onSelect={(option) => void changer(option)}
        idBase={idBase}
        // Libellé et aide sont réservés aux lecteurs d'écran (`.model-select-label` est masqué) :
        // l'état « non réglé » a donc AUSSI sa phrase visible juste en dessous.
        // Non réglé = Haiku en effort low (`roles.ts`, conv-1097), plus le modèle du chat.
        libelle={
          petitesTaches?.reglage ? t('routeur.petites.regle') : t('routeur.petites.parDefaut')
        }
        aide={t('routeur.petites.application')}
      />
      {petitesTaches && !petitesTaches.reglage && (
        <p className="router-hint" data-testid={`${testId}-defaut`}>
          {t('routeur.petites.nonRegle')}
        </p>
      )}
      {petitesTaches?.reglage && (
        <button
          type="button"
          className="router-petites-taches-reset"
          disabled={pending}
          onClick={() => void changer(null)}
        >
          {t('routeur.petites.revenir')}
        </button>
      )}
    </section>
  )
}
