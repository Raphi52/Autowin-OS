import { useEffect, useState } from 'react'
import type { Affectation } from '../../../main/brain/brain-affectation'
import type { BrainAffectationsState } from '../../../shared/preload-contracts'
import { cleDeDossier, dossiersDuBoard } from '../../../shared/board-dossiers-du-chat'
import { useTextesKnowledge } from '../textes-ecrans/knowledge'
import {
  EVT_DOSSIERS_DU_CHAT,
  NOM_DU_DOSSIER_PERSONNEL,
  lireDossierPersonnel,
  lireDossiersDuChat,
  lireDossiersRetires,
  lireDossiersToujoursProposes,
  retirerDossierDuChat,
  transmettreDossiersDuChat
} from './dossiers-du-chat'
import './DossiersDeTravailPanel.css'

/**
 * Brain par dossier : quel Brain reçoit les notes écrites depuis chaque dossier de travail.
 * LA LISTE EST CELLE DU CHAT (son choix de dossier de travail, la même que le Board), ni plus ni
 * moins : ce menu ne tient pas une seconde liste. Un dossier s'ajoute depuis le Chat ; sa croix, ici
 * comme là-bas, le retire de cette liste commune. Chaque ligne montre
 * le Brain qui s'applique VRAIMENT au dossier — le sien, celui d'un dossier parent, sinon l'équipe —
 * et un clic sur l'autre segment l'assigne. La réponse porte les affectations à jour, et c'est elle
 * qui remplace l'affichage.
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

/**
 * Le Brain qui reçoit les notes de ce dossier : la règle de `brainPourCwd` (processus principal),
 * rejouée pour l'affichage. L'affectation la plus précise qui couvre le dossier gagne ; aucune =
 * l'équipe. Le `/` ajouté empêche un frère au nom voisin (« Notes » et « NotesVoisin ») d'y passer.
 */
function brainDuDossier(affectations: readonly Affectation[], cwd: string): Brain {
  const cible = cheminComparable(cwd)
  let brain: Brain = 'equipe'
  let longueur = -1
  for (const affectation of affectations) {
    const dossier = cheminComparable(affectation.cwd)
    if (dossier.length <= longueur) continue
    if (cible !== dossier && !cible.startsWith(`${dossier}/`)) continue
    brain = affectation.brain
    longueur = dossier.length
  }
  return brain
}

/**
 * Les dossiers de travail du Chat, dans l'ordre de son menu : « This computer », puis le dépôt de la
 * session, puis les dossiers mémorisés. La règle est celle du Board (`dossiersDuBoard`) : un dossier
 * toujours proposé sort quand sa croix l'a retiré, sauf « This computer ».
 */
async function lireLesDossiersDeTravail(): Promise<{
  dossiers: string[]
  personnel: string | null
}> {
  const [toujours, personnel] = await Promise.all([
    lireDossiersToujoursProposes(),
    lireDossierPersonnel()
  ])
  const proposes = [personnel, ...(toujours ?? [])]
  const tous = dossiersDuBoard(lireDossiersDuChat(), proposes, lireDossiersRetires(), [personnel])
  const rang = new Map(
    dossiersDuBoard([], proposes, lireDossiersRetires(), [personnel]).map((chemin, i) => [
      cleDeDossier(chemin),
      i
    ])
  )
  const place = (chemin: string): number => rang.get(cleDeDossier(chemin)) ?? proposes.length
  return { dossiers: [...tous].sort((a, b) => place(a) - place(b)), personnel }
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
  const [dossiers, setDossiers] = useState<string[]>([])
  /** « This computer » : il porte ce nom dans le Chat, pas celui du compte Windows. */
  const [personnel, setPersonnel] = useState<string | null>(null)
  const [filtre, setFiltre] = useState('')

  // La liste suit le Chat : lue à l'ouverture, relue quand un dossier y est retiré pendant que le menu est
  // ouvert (croix du Board ou du Chat).
  useEffect(() => {
    let courant = true
    const lire = (): void => {
      void lireLesDossiersDeTravail().then((lu) => {
        if (!courant) return
        setDossiers(lu.dossiers)
        setPersonnel(lu.personnel)
      })
    }
    lire()
    window.addEventListener(EVT_DOSSIERS_DU_CHAT, lire)
    return () => {
      courant = false
      window.removeEventListener(EVT_DOSSIERS_DU_CHAT, lire)
    }
  }, [])

  // Relues à chaque ouverture du menu : les Brains montrés sont ceux du fichier, pas une copie ancienne.
  // Un pont absent (app pas à jour) se dit ici : l'appel est dans le `try`, il ne fait pas tomber la vue.
  useEffect(() => {
    let courant = true
    void (async () => {
      try {
        const reponse = await window.api.brainAffectations()
        if (!courant) return
        setAffectations(reponse.affectations)
        // La lecture a répondu : une `erreur` (fichier présent mais illisible) accompagne la liste.
        // Sans elle, chaque dossier se lirait « Équipe » alors que ce fichier en assigne peut-être.
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
   * Assigne un Brain à un dossier. Les affectations renvoyées remplacent l'affichage ; un refus reste
   * visible, sans rien effacer. Le succès se lit dans la liste renvoyée, pas dans l'absence de
   * `erreur` : une `erreur` peut accompagner une écriture réussie (fichier illisible mis de côté,
   * affectation écrite dans un fichier neuf), et c'est alors un avertissement.
   */
  async function assigner(cwd: string, brain: Brain): Promise<void> {
    setEnCours(true)
    setMessage('')
    setAvertissement(false)
    try {
      const reponse: BrainAffectationsState = await window.api.enregistrerBrainAffectation({
        cwd,
        brain
      })
      setAffectations(reponse.affectations)
      setMessage(reponse.erreur ?? '')
      setAvertissement(estAssigne(reponse.affectations, cwd, brain) && reponse.erreur !== undefined)
    } catch {
      setMessage(t('dossiers.erreur.action'))
    } finally {
      setEnCours(false)
    }
  }

  /**
   * La croix : retire le dossier de la liste du Chat — le même geste que la croix du Chat et du Board,
   * qui l'annonce aux autres vues — et transmet la liste restante au processus principal, pour le
   * Board. Le Brain assigné au dossier n'est pas touché : il revient avec lui s'il est rajouté.
   */
  function retirer(cwd: string): void {
    void transmettreDossiersDuChat(retirerDossierDuChat(cwd)).catch(() => {
      // Pont absent ou coupé : le Chat, toujours monté, retransmet la liste à son prochain changement.
    })
  }

  // Un échec de lecture passe devant tout autre message, et n'est jamais un avertissement.
  const avis = lectureEchouee ? t('dossiers.erreur.charger') : message
  const avertit = avertissement && !lectureEchouee

  const clePersonnelle = cleDeDossier(personnel)
  const nomAffiche = (cwd: string): string =>
    clePersonnelle && cleDeDossier(cwd) === clePersonnelle
      ? NOM_DU_DOSSIER_PERSONNEL
      : nomDuDossier(cwd)
  const cherche = filtre.trim().toLowerCase()
  const visibles =
    cherche === ''
      ? dossiers
      : dossiers.filter((cwd) =>
          `${cwd}
${nomAffiche(cwd)}`
            .toLowerCase()
            .includes(cherche)
        )

  return (
    <section className="dossiers-travail">
      {lectureEchouee ? null : dossiers.length === 0 ? (
        // Sans Brain lu, montrer « Équipe » sur chaque ligne affirmerait ce qu'on ne sait pas.
        <p className="setting-help">{t('dossiers.vide')}</p>
      ) : (
        <>
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
              {visibles.map((cwd) => (
                <li key={cwd} className="dossiers-travail__ligne">
                  <span className="dossiers-travail__texte">
                    <span className="dossiers-travail__nom">{nomAffiche(cwd)}</span>
                    <span className="dossiers-travail__chemin">{cwd}</span>
                  </span>
                  <ChoixBrain
                    label={t('dossiers.brainDe.aria', { dossier: cwd })}
                    valeur={brainDuDossier(affectations, cwd)}
                    disabled={enCours}
                    onChange={(brain) => void assigner(cwd, brain)}
                  />
                  {/* « This computer » ne se retire jamais : pas de croix, la colonne reste vide. */}
                  {clePersonnelle && cleDeDossier(cwd) === clePersonnelle ? null : (
                    <button
                      type="button"
                      className="dossiers-travail__croix"
                      aria-label={t('dossiers.retirer.aria', { dossier: cwd })}
                      title={t('dossiers.retirer')}
                      onClick={() => retirer(cwd)}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!lectureEchouee && (
        // La règle tient en quelques mots ; l'explication entière reste au survol.
        <p className="dossiers-travail__regle" title={t('dossiers.aide')}>
          {t('dossiers.regle')}
        </p>
      )}
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
