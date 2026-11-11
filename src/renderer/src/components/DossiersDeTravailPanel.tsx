import { useEffect, useState } from 'react'
import type { Affectation } from '../../../main/brain/brain-affectation'
import type { BrainAffectationsState } from '../../../shared/preload-contracts'
import { useTextesKnowledge } from '../textes-ecrans/knowledge'
import { SettingsSection } from './GraphView.panels'
import './DossiersDeTravailPanel.css'

/**
 * Dossiers de travail (plan « Affectation des dossiers de travail aux Brains », lot 4) : quel Brain
 * reçoit les notes écrites depuis un dossier. Liste, choix Équipe ou Perso, retrait, ajout d'un chemin
 * absolu. Chaque demande passe par les canaux du lot 3 ; la réponse porte la liste à jour, et c'est
 * elle qui remplace l'affichage.
 */
type Brain = Affectation['brain']

/** Un `<select>` ne donne que sa valeur texte : seule « perso » désigne le Brain perso. */
function versBrain(valeur: string): Brain {
  return valeur === 'perso' ? 'perso' : 'equipe'
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

  return (
    <SettingsSection title={t('dossiers.titre')}>
      <p className="setting-help">{t('dossiers.aide')}</p>
      {affectations.length === 0 ? (
        <p className="setting-help">{t('dossiers.vide')}</p>
      ) : (
        <ul className="dossiers-travail__liste" aria-label={t('dossiers.liste.aria')}>
          {affectations.map((affectation) => (
            <li key={affectation.cwd} className="dossiers-travail__ligne">
              <code className="dossiers-travail__chemin">{affectation.cwd}</code>
              <select
                aria-label={t('dossiers.brainDe.aria', { dossier: affectation.cwd })}
                value={affectation.brain}
                disabled={enCours}
                onChange={(event) => void assigner(affectation.cwd, versBrain(event.target.value))}
              >
                <option value="equipe">{t('graphe.filtreBrains.equipe')}</option>
                <option value="perso">{t('graphe.filtreBrains.perso')}</option>
              </select>
              <button
                type="button"
                disabled={enCours}
                aria-label={t('dossiers.retirer.aria', { dossier: affectation.cwd })}
                onClick={() =>
                  void ecrire(() => window.api.retirerBrainAffectation({ cwd: affectation.cwd }))
                }
              >
                {t('dossiers.retirer')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="dossiers-travail__ajout" onSubmit={(event) => void ajouter(event)}>
        <input
          type="text"
          aria-label={t('dossiers.chemin.aria')}
          placeholder={t('dossiers.chemin.placeholder')}
          value={chemin}
          disabled={enCours}
          onChange={(event) => setChemin(event.target.value)}
        />
        <select
          aria-label={t('dossiers.brain.aria')}
          value={brainNouveau}
          disabled={enCours}
          onChange={(event) => setBrainNouveau(versBrain(event.target.value))}
        >
          <option value="equipe">{t('graphe.filtreBrains.equipe')}</option>
          <option value="perso">{t('graphe.filtreBrains.perso')}</option>
        </select>
        <button type="submit" disabled={enCours || chemin.trim() === ''}>
          {t('dossiers.ajouter')}
        </button>
      </form>
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
    </SettingsSection>
  )
}
