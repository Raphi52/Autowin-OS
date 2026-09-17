import { useCallback, useEffect, useState } from 'react'
import { Spinner } from './Spinner'

/**
 * CE QUE LES UTILISATEURS D'UN GREFFE ONT FAIT — pour le chef de greffe.
 *
 * Le widget ne connaît aucune requête : il demande un greffe, le processus principal découvre la
 * table qui trace les actions et la lit en consultation seule (`src/main/greffe-actions.ts`).
 *
 * Trois règles de rendu, et elles portent toute l'utilité :
 *  - une liste vide ne s'affiche JAMAIS nue : soit « rien depuis… », soit la cause exacte. Sans ça,
 *    un échec de lecture se lirait « mes utilisateurs n'ont rien fait », ce qui est le pire message
 *    possible pour quelqu'un qui surveille une équipe ;
 *  - le greffe se choisit, il ne s'agrège pas : 40 greffes exploités, chacun a son chef ;
 *  - rien n'est exporté ni recopié ailleurs — ce sont des données nominatives.
 */

export interface ActionAffichee {
  utilisateur: string
  quand: string
  action: string
}

type Reponse =
  { ok: true; greffe: string; actions: ActionAffichee[] } | { ok: false; raison: string }

export interface ApiActions {
  listerGreffes: () => Promise<{ database: string }[]>
  lireActions: (demande: { database: string }) => Promise<Reponse>
}

const apiParDefaut = (): ApiActions | undefined => {
  const api = (window as unknown as { api?: Partial<ApiActions> }).api
  if (!api?.listerGreffes || !api.lireActions) return undefined
  return api as ApiActions
}

const quandLisible = (brut: string): string => {
  const date = new Date(brut)
  return Number.isNaN(date.getTime()) ? brut : date.toLocaleString('fr-FR')
}

export function ActionsUtilisateursWidget({ api }: { api?: ApiActions }): React.JSX.Element {
  const service = api ?? apiParDefaut()
  const [greffes, setGreffes] = useState<string[]>([])
  const [greffe, setGreffe] = useState<string>('')
  const [actions, setActions] = useState<ActionAffichee[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(false)

  const charger = useCallback(
    async (base: string): Promise<void> => {
      if (!service || !base) return
      setChargement(true)
      setErreur(null)
      try {
        const reponse = await service.lireActions({ database: base })
        if (reponse.ok) setActions(reponse.actions)
        else {
          setActions(null)
          setErreur(reponse.raison)
        }
      } catch (cause) {
        setActions(null)
        setErreur(String(cause))
      } finally {
        setChargement(false)
      }
    },
    [service]
  )

  useEffect(() => {
    if (!service) return
    let vivant = true
    service
      .listerGreffes()
      .then((liste) => {
        if (!vivant) return
        const noms = liste.map((item) => item.database)
        setGreffes(noms)
        const premier = noms[0] ?? ''
        setGreffe(premier)
        // Le premier greffe se lit tout de suite : un widget qui demande un clic pour montrer
        // quelque chose ne se lit pas « d'un coup d'oeil ».
        void charger(premier)
      })
      .catch((cause: unknown) => vivant && setErreur(String(cause)))
    return () => {
      vivant = false
    }
  }, [service, charger])

  return (
    <div className="actions-utilisateurs" data-testid="actions-utilisateurs">
      <div className="actions-utilisateurs__barre">
        <label>
          Greffe
          <select
            aria-label="Greffe"
            value={greffe}
            onChange={(event) => {
              setGreffe(event.target.value)
              void charger(event.target.value)
            }}
          >
            {greffes.map((nom) => (
              <option key={nom} value={nom}>
                {nom}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void charger(greffe)} disabled={!greffe}>
          Rafraîchir
        </button>
      </div>

      {!service && (
        <p className="home-error">Lecture des greffes indisponible dans cette fenêtre.</p>
      )}
      {chargement && (
        <p className="home-hint">
          <Spinner /> Lecture des actions…
        </p>
      )}
      {service && !chargement && erreur && <p className="home-error">{erreur}</p>}
      {!chargement && !erreur && actions?.length === 0 && (
        <p className="home-hint">Aucune action enregistrée pour ce greffe.</p>
      )}
      {!chargement && !erreur && actions && actions.length > 0 && (
        <ul className="actions-utilisateurs__liste">
          {actions.map((item, index) => (
            <li key={`${item.utilisateur}-${item.quand}-${index}`}>
              <span className="actions-utilisateurs__qui">{item.utilisateur}</span>
              <span className="actions-utilisateurs__quoi">{item.action}</span>
              <span className="actions-utilisateurs__quand">{quandLisible(item.quand)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
