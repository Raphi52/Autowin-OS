import { useEffect, useState } from 'react'
import type { EtatDuDossierDuBoard } from '../../../shared/board-dossier'
import { NOM_DU_POSTE_MAX } from '../../../shared/board-nom-du-poste'
import { riche } from '../textes'
import { useTextesReglagesEtDecor } from '../textes-ecrans/reglages-et-decor'
import './NomSurLeBoardReglage.css'

/** L'erreur est gardée par sa CLÉ, pour qu'un changement de langue la retraduise (conv-1170). */
type ErreurNom = 'nomBoard.erreurLecture' | 'nomBoard.erreurEnregistrement'

interface NomSurLeBoard {
  disponible: boolean
  etat: EtatDuDossierDuBoard | null
  saisie: string
  setSaisie: (s: string) => void
  occupe: boolean
  erreur: ErreurNom | null
  compte: string
  choisi: string
  enregistrer: (nom: string | null) => Promise<void>
}

/**
 * Le nom de ce poste sur le Board : lu et enregistré par le processus principal (`board-dossier.json`).
 * Partagé par la ligne de Settings · Interface et par le rouage du Board (conv-1230) : les deux
 * affichent ce que le moteur RÉPOND après l'enregistrement, jamais la saisie supposée gardée.
 */
function useNomSurLeBoard(onEnregistre?: (etat: EtatDuDossierDuBoard) => void): NomSurLeBoard {
  const [etat, setEtat] = useState<EtatDuDossierDuBoard | null>(null)
  const [saisie, setSaisie] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<ErreurNom | null>(null)
  // Sans pont (écran rendu hors de l'app, preload d'avant redémarrage) : le champ n'est pas montré.
  const pont = window.api as Partial<typeof window.api> | undefined
  const disponible =
    typeof pont?.boardDossier === 'function' && typeof pont?.boardDossierNom === 'function'

  useEffect(() => {
    if (!disponible) return
    let vivant = true
    void window.api
      .boardDossier()
      .then((lu) => {
        if (!vivant) return
        setEtat(lu)
        setSaisie(lu.nomChoisi ?? '')
      })
      .catch(() => {
        if (vivant) setErreur('nomBoard.erreurLecture')
      })
    return () => {
      vivant = false
    }
  }, [disponible])

  const enregistrer = async (nom: string | null): Promise<void> => {
    if (!window.api.boardDossierNom || occupe) return
    setOccupe(true)
    setErreur(null)
    try {
      const suivant = await window.api.boardDossierNom(nom)
      setEtat(suivant)
      setSaisie(suivant.nomChoisi ?? '')
      // Refusé par le moteur (nom illisible) : il rend l'état d'avant, sans le nom demandé.
      const voulu = nom?.trim() ?? ''
      if (voulu && suivant.nomChoisi === undefined) setErreur('nomBoard.erreurEnregistrement')
      else onEnregistre?.(suivant)
    } catch {
      setErreur('nomBoard.erreurEnregistrement')
    } finally {
      setOccupe(false)
    }
  }

  return {
    disponible,
    etat,
    saisie,
    setSaisie,
    occupe,
    erreur,
    compte: etat?.compte ?? '',
    choisi: etat?.nomChoisi ?? '',
    enregistrer
  }
}

/** La saisie, « Enregistrer » et « Revenir au compte Windows » ; `prefixe` distingue les deux écrans. */
function ChampDuNom({ nom, prefixe }: { nom: NomSurLeBoard; prefixe: string }): React.JSX.Element {
  const { t } = useTextesReglagesEtDecor()
  const { etat, saisie, setSaisie, occupe, compte, choisi, enregistrer } = nom
  return (
    <form
      className="nom-board-choix"
      onSubmit={(e) => {
        e.preventDefault()
        void enregistrer(saisie.trim() || null)
      }}
    >
      <input
        type="text"
        className="nom-board-saisie"
        value={saisie}
        placeholder={compte}
        maxLength={NOM_DU_POSTE_MAX}
        aria-label={t('nomBoard.libelle')}
        data-testid={`${prefixe}-saisie`}
        disabled={etat === null || occupe}
        onChange={(e) => setSaisie(e.target.value)}
      />
      <button
        type="submit"
        className="btn btn-sm"
        data-testid={`${prefixe}-enregistrer`}
        disabled={etat === null || occupe || saisie.trim() === choisi}
      >
        {t('nomBoard.enregistrer')}
      </button>
      {choisi && (
        <button
          type="button"
          className="btn btn-sm"
          data-testid={`${prefixe}-defaut`}
          disabled={occupe}
          onClick={() => void enregistrer(null)}
        >
          {t('nomBoard.parDefaut')}
        </button>
      )}
    </form>
  )
}

/**
 * Settings · Interface — « Ton nom sur le Board » (demande utilisateur du 2026-10-28, conv-1230 :
 * « nom windows par défaut et un setting pour en choisir un autre »).
 *
 * Le nom vit dans le réglage du Board de ce poste (`board-dossier.json`, processus principal) : il
 * est posé sur toutes les demandes de ce poste et écrit dans `board.json`, que les collègues
 * relisent.
 */
export function NomSurLeBoardReglage(): React.JSX.Element | null {
  const { t } = useTextesReglagesEtDecor()
  const nom = useNomSurLeBoard()
  if (!nom.disponible) return null

  return (
    <div className="interface-row" data-testid="interface-nom-board">
      <div className="interface-row-text">
        <strong>{t('nomBoard.titre')}</strong>
        <p>{riche(t('nomBoard.description', { compte: nom.compte || '…' }))}</p>
        {nom.erreur && <p className="nom-board-erreur">{t(nom.erreur)}</p>}
      </div>
      <ChampDuNom nom={nom} prefixe="interface-nom-board" />
    </div>
  )
}

/**
 * Le même réglage dans le rouage du Board (demande du 2026-10-28, conv-1230 : « un raccourci vers ce
 * réglage dans le menu du dossier du Board »). `onEnregistre` laisse le Board se recalculer, pour que
 * ses post-it portent aussitôt le nouveau nom.
 */
export function NomSurLeBoardCompact({
  onEnregistre
}: {
  onEnregistre?: (etat: EtatDuDossierDuBoard) => void
}): React.JSX.Element | null {
  const { t } = useTextesReglagesEtDecor()
  const nom = useNomSurLeBoard(onEnregistre)
  if (!nom.disponible) return null

  return (
    <div className="nom-board-compact" data-testid="besoins-rouage-nom">
      <p className="nom-board-compact-titre">{t('nomBoard.titre')}</p>
      <ChampDuNom nom={nom} prefixe="besoins-rouage-nom" />
      {nom.erreur && <p className="nom-board-erreur">{t(nom.erreur)}</p>}
    </div>
  )
}
