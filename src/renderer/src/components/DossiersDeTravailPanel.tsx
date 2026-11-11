import { useEffect, useState } from 'react'
import type { Affectation } from '../../../main/brain/brain-affectation'
import type { BrainAffectationsState } from '../../../shared/preload-contracts'
import { useTextesKnowledge } from '../textes-ecrans/knowledge'
import './DossiersDeTravailPanel.css'

/**
 * Dossiers de travail (plan « Affectation des dossiers de travail aux Brains », lot 4) : quel Brain
 * reçoit les notes écrites depuis un dossier. Liste filtrable (nom du dossier, chemin dessous), choix
 * Équipe ou Perso, retrait, ajout d'un chemin absolu. Chaque demande passe par les canaux du lot 3 ;
 * la réponse porte la liste à jour, et c'est elle qui remplace l'affichage.
 */
type Brain = Affectation['brain']

const BRAINS: readonly Brain[] = ['equipe', 'perso']

/** Nom court d'un dossier : le dernier segment de son chemin ; une racine (« D:\ ») reste entière. */
function nomDuDossier(cwd: string): string {
  const segments = cwd.split(/[\\/]+/).filter(Boolean)
  return segments.length > 1 ? segments[segments.length - 1] : cwd
}

/**
 * Équipe | Perso en deux segments : le Brain choisi se lit sans ouvrir de liste, sur chaque ligne.
 * Un clic sur le segment déjà choisi ne demande rien.
 */
function ChoixBrain({
  label,
  valeur,
  disabled,
  onChange
}: {
  label: string
  valeur: Brain
  disabled: boolean
  onChange: (brain: Brain) => void
}): React.JSX.Element {
  const { t } = useTextesKnowledge()
  return (
    <span className="dossiers-travail__brains" role="group" aria-label={label}>
      {BRAINS.map((brain) => (
        <button
          key={brain}
          type="button"
          data-brain={brain}
          aria-pressed={valeur === brain}
          disabled={disabled}
          onClick={() => {
            if (valeur !== brain) onChange(brain)
          }}
        >
          {t(brain === 'perso' ? 'graphe.filtreBrains.perso' : 'graphe.filtreBrains.equipe')}
        </button>
      ))}
    </span>
  )
}

/** Forme comparable d'un chemin saisi ou rendu : séparateurs unifiés, casse ignorée, séparateur final retiré. */
function cheminComparable(chemin: string): string {
  return chemin
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** Le dossier figure-t-il dans la liste avec ce Brain ? La liste stocke le chemin résolu, pas la saisie. */
function estAssigne(affectations: Affectation[], cwd: string, brain: Brain): boolean {
  const voulu = cheminComparable(cwd)
  return affectations.some(
    (affectation) => affectation.brain === brain && cheminComparable(affectation.cwd) === voulu
  )
}

export function DossiersDeTravailPanel(): React.JSX.Element {
  const { t } = useTextesKnowledge()
  const [affectations, setAffectations] = useState<Affectation[]>([])
  const [lectureEchouee, setLectureEchouee] = useState(false)
  /** Raison donnée par le processus principal, ou message d'échec, affichée sous le formulaire. */
  const [message, setMessage] = useState('')
  const [enCours, setEnCours] = useState(false)
  /** Le message accompagne une demande qui a abouti : c'est un avertissement, pas un échec. */
  const [avertissement, setAvertissement] = useState(false)
  const [chemin, setChemin] = useState('')
  const [brainNouveau, setBrainNouveau] = useState<Brain>('equipe')
  const [filtre, setFiltre] = useState('')

  // Relue à chaque ouverture des réglages : la liste montrée est celle du fichier, pas une copie ancienne.
  // Un pont absent (app pas à jour) se dit ici : l'appel est dans le `try`, il ne fait pas tomber la vue.
  useEffect(() => {
    let courant = true
    void (async () => {
      try {
        const reponse = await window.api.brainAffectations()
        if (!courant) return
        setAffectations(reponse.affectations)
        // La lecture a répondu : une `erreur` (fichier présent mais illisible) accompagne la liste.
        // Sans elle, « aucun dossier assigné » s'afficherait alors qu'il en reste dans ce fichier.
        setMessage(reponse.erreur ?? '')
        setAvertissement(reponse.erreur !== undefined)
      } catch {
        if (courant) setLectureEchouee(true)
      }
    })()
    return () => {
      courant = false
    }
  }, [])

  /**
   * Une demande. La liste renvoyée remplace l'affichage ; un refus reste visible, sans rien effacer.
   * `reussie` dit si la réponse vaut réussite. Par défaut, aucune `erreur` : c'est la règle du
   * retrait, où une `erreur` veut dire que rien n'a été modifié.
   */
  async function ecrire(
    demande: () => Promise<BrainAffectationsState>,
    reussie: (reponse: BrainAffectationsState) => boolean = (reponse) =>
      reponse.erreur === undefined
  ): Promise<boolean> {
    setEnCours(true)
    setMessage('')
    setAvertissement(false)
    try {
      const reponse = await demande()
      setAffectations(reponse.affectations)
      setMessage(reponse.erreur ?? '')
      const ok = reussie(reponse)
      // Une `erreur` qui accompagne une écriture réussie (fichier illisible mis de côté) reste un avertissement.
      setAvertissement(ok && reponse.erreur !== undefined)
      return ok
    } catch {
      setMessage(t('dossiers.erreur.action'))
      return false
    } finally {
      setEnCours(false)
    }
  }

  /**
   * Assigne un Brain à un dossier : ajout, ou changement du Brain d'un dossier déjà listé (même canal).
   * Le succès se lit dans la liste renvoyée, pas dans l'absence de `erreur` : une `erreur` peut
   * accompagner une écriture réussie (fichier illisible mis de côté, affectation écrite dans un
   * fichier neuf).
   */
  function assigner(cwd: string, brain: Brain): Promise<boolean> {
    return ecrire(
      () => window.api.enregistrerBrainAffectation({ cwd, brain }),
      (reponse) => estAssigne(reponse.affectations, cwd, brain)
    )
  }

  async function ajouter(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const cwd = chemin.trim()
    if (cwd === '') return
    if (await assigner(cwd, brainNouveau)) setChemin('')
  }

  // Un échec de lecture passe devant tout autre message, et n'est jamais un avertissement.
  const avis = lectureEchouee ? t('dossiers.erreur.charger') : message
  const avertit = avertissement && !lectureEchouee

  const cherche = filtre.trim().toLowerCase()
  const visibles =
    cherche === ''
      ? affectations
      : affectations.filter((affectation) => affectation.cwd.toLowerCase().includes(cherche))

  return (
    <section className="dossiers-travail">
      {affectations.length === 0 ? (
        <p className="setting-help">{t('dossiers.vide')}</p>
      ) : (
        <>
          {/* `search`, pas `text` : le seul champ texte du panneau reste le chemin à assigner. */}
          <input
            type="search"
            className="dossiers-travail__filtre"
            aria-label={t('dossiers.filtre.aria')}
            placeholder={t('dossiers.filtre.placeholder')}
            value={filtre}
            onChange={(event) => setFiltre(event.target.value)}
          />
          {visibles.length === 0 ? (
            <p className="setting-help">{t('dossiers.filtre.aucun')}</p>
          ) : (
            <ul className="dossiers-travail__liste" aria-label={t('dossiers.liste.aria')}>
              {visibles.map((affectation) => (
                <li key={affectation.cwd} className="dossiers-travail__ligne">
                  <span className="dossiers-travail__texte">
                    <span className="dossiers-travail__nom">{nomDuDossier(affectation.cwd)}</span>
                    <span className="dossiers-travail__chemin">{affectation.cwd}</span>
                  </span>
                  <ChoixBrain
                    label={t('dossiers.brainDe.aria', { dossier: affectation.cwd })}
                    valeur={affectation.brain}
                    disabled={enCours}
                    onChange={(brain) => void assigner(affectation.cwd, brain)}
                  />
                  <button
                    type="button"
                    className="dossiers-travail__lien"
                    disabled={enCours}
                    aria-label={t('dossiers.retirer.aria', { dossier: affectation.cwd })}
                    onClick={() =>
                      void ecrire(() =>
                        window.api.retirerBrainAffectation({ cwd: affectation.cwd })
                      )
                    }
                  >
                    {t('dossiers.retirer')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="dossiers-travail__pied">
        {/* Replié : la liste se lit d'abord, l'ajout ne prend sa place que sur demande. */}
        <details className="dossiers-travail__pli">
          <summary className="dossiers-travail__lien">{t('dossiers.ajout.deplier')}</summary>
          <form className="dossiers-travail__ajout" onSubmit={(event) => void ajouter(event)}>
            <input
              type="text"
              aria-label={t('dossiers.chemin.aria')}
              placeholder={t('dossiers.chemin.placeholder')}
              value={chemin}
              disabled={enCours}
              onChange={(event) => setChemin(event.target.value)}
            />
            <ChoixBrain
              label={t('dossiers.brain.aria')}
              valeur={brainNouveau}
              disabled={enCours}
              onChange={setBrainNouveau}
            />
            <button
              type="submit"
              className="dossiers-travail__lien"
              disabled={enCours || chemin.trim() === ''}
            >
              {t('dossiers.ajouter')}
            </button>
          </form>
        </details>
        {/* La règle tient en quelques mots ; l'explication entière reste au survol. */}
        <span className="dossiers-travail__regle" title={t('dossiers.aide')}>
          {t('dossiers.regle')}
        </span>
      </div>
      {avis && (
        // Avertissement : `domain-warning`, la classe des réglages du Brain (couleur du thème), en
        // `status`. Échec : le style d'aide, en `alert`.
        <p
          className={avertit ? 'domain-warning' : 'setting-help'}
          role={avertit ? 'status' : 'alert'}
        >
          {avis}
        </p>
      )}
    </section>
  )
}
