/**
 * LES PERSONNES DU VILLAGE DANS LES RÉGLAGES DE L'ACCUEIL (demande utilisateur du 2026-11-05).
 *
 * Demande : « dans l'accueil je veux un setting, afficher les agents de et afficher mes agents à, avec
 * des listes de personnes à toggle pour afficher ou pas les PNJ dans l'accueil ». Deux choix par
 * personne trouvée sur le partage du Board :
 *  - « Afficher les agents de » (colonne « Je vois ») : ce que JE vois. Choix de ce poste seul
 *    (`agents-collegues.ts`), appliqué tout de suite à la scène ;
 *  - « Afficher mes agents à » (colonne « Me voit ») : ce que les AUTRES voient de moi. Rangé dans le
 *    réglage du Board, écrit dans `presence.json` (`mes-agents-masques.ts`) ; leur Autowin le suit
 *    dans les 5 s.
 *
 * UN SEUL TABLEAU, PAS DEUX LISTES (même jour, même fil : « le réglage actuel est bon mais il va
 * prendre trop de place quand la liste va grandir »). Deux listes répétaient chaque personne : 2 N
 * lignes. Ici une ligne par personne et ses deux interrupteurs côte à côte ; la hauteur est bornée
 * (le tableau défile, en-tête fixe), une recherche apparaît au-delà de SEUIL_RECHERCHE personnes, et
 * l'en-tête de chaque colonne compte les cases cochées pour lire l'état sans défiler.
 *
 * Les personnes viennent de la relecture du partage : elle tourne tant que ce bloc est affiché
 * (`suivreAgentsCollegues`, compté), même quand le fond de l'Accueil n'est pas le Quartier.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  abonnerMasquesLocaux,
  abonnerPersonnesDuVillage,
  afficherLesAgentsDe,
  couleurDuPoste,
  lireMasquesLocaux,
  lirePersonnesDuVillage,
  suivreAgentsCollegues,
  type PersonneDuVillage
} from '../quartier/agents-collegues'
import {
  choixDesMasquesDisponible,
  montrerMesAgentsA,
  useMesAgentsMasques
} from '../quartier/mes-agents-masques'
import { useTextesAccueil } from '../textes-ecrans/accueil'

/** Au-delà, la liste ne se parcourt plus d'un coup d'œil : un champ de recherche apparaît. */
export const SEUIL_RECHERCHE = 6

/**
 * Les personnes à qui mes agents sont masqués restent listées même absentes du partage : sans cela,
 * on ne pourrait plus les recocher. Elles prennent alors le nom de leur poste, à leur place
 * alphabétique.
 */
function avecLesAbsents(
  personnes: readonly PersonneDuVillage[],
  masques: readonly string[]
): readonly PersonneDuVillage[] {
  const absents = masques.filter((m) => !personnes.some((p) => p.poste.toLowerCase() === m))
  if (!absents.length) return personnes
  return [
    ...personnes,
    ...absents.map((poste) => ({
      poste,
      prenom: poste,
      couleur: couleurDuPoste(poste),
      enLigne: false
    }))
  ].sort((x, y) => x.prenom.localeCompare(y.prenom) || x.poste.localeCompare(y.poste))
}

/** « Hélène » se trouve en tapant « hel » : ni la casse ni les accents ne comptent. */
const replie = (texte: string): string =>
  texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export function HomePersonnesReglages(): React.JSX.Element {
  const { t } = useTextesAccueil()
  useEffect(() => suivreAgentsCollegues(), [])
  const personnes = useSyncExternalStore(
    abonnerPersonnesDuVillage,
    lirePersonnesDuVillage,
    lirePersonnesDuVillage
  )
  const masquesLocaux = useSyncExternalStore(
    abonnerMasquesLocaux,
    lireMasquesLocaux,
    lireMasquesLocaux
  )
  const mesMasques = useMesAgentsMasques()
  const [nonEnregistre, setNonEnregistre] = useState(false)
  const [recherche, setRecherche] = useState('')
  const liste = useMemo(() => avecLesAbsents(personnes, mesMasques), [personnes, mesMasques])
  const disponible = choixDesMasquesDisponible()
  const avecRecherche = liste.length > SEUIL_RECHERCHE
  const cherche = avecRecherche ? replie(recherche.trim()) : ''
  const affichees = cherche
    ? liste.filter((p) => replie(p.prenom).includes(cherche) || replie(p.poste).includes(cherche))
    : liste

  const jeVois = (p: PersonneDuVillage): boolean => !masquesLocaux.includes(p.poste.toLowerCase())
  const meVoit = (p: PersonneDuVillage): boolean => !mesMasques.includes(p.poste.toLowerCase())
  const compte = (coche: (p: PersonneDuVillage) => boolean): string =>
    `${liste.filter(coche).length}/${liste.length}`

  return (
    <section className="home-settings__bloc home-personnes" data-testid="home-personnes">
      <h3>{t('reglages.personnes')}</h3>
      {liste.length === 0 ? (
        <p className="home-settings__note">{t('reglages.personnesAucune')}</p>
      ) : (
        <>
          {avecRecherche ? (
            <input
              type="search"
              className="home-personnes__recherche"
              value={recherche}
              placeholder={t('reglages.personnesChercher')}
              aria-label={t('reglages.personnesChercher')}
              data-testid="home-personnes-recherche"
              onChange={(event) => setRecherche(event.target.value)}
            />
          ) : null}
          <div className="home-personnes__defile">
            <table className="home-personnes__table">
              <thead>
                <tr>
                  <th scope="col" className="home-personnes__nom-col">
                    {t('reglages.personnesColonne')}
                  </th>
                  <th scope="col" title={t('reglages.agentsDe')} data-testid="home-agents-de">
                    {t('reglages.jeVois')}
                    <span className="home-personnes__compte">{compte(jeVois)}</span>
                  </th>
                  <th scope="col" title={t('reglages.mesAgentsA')} data-testid="home-mes-agents-a">
                    {t('reglages.meVoit')}
                    <span className="home-personnes__compte">{compte(meVoit)}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {affichees.map((p) => {
                  const vois = jeVois(p)
                  const voit = meVoit(p)
                  return (
                    <tr key={p.poste} data-hors-ligne={p.enLigne ? undefined : 'true'}>
                      <th scope="row" title={p.poste}>
                        <span className="home-personnes__nom">
                          {/* couleur-fixe: le foulard de la personne, le même que sur la scène (PALETTE_COLLEGUES). */}
                          <span
                            className="home-settings__pastille"
                            style={{ background: p.couleur }}
                            aria-hidden
                          />
                          <span className="home-personnes__prenom">{p.prenom}</span>
                          {p.enLigne ? null : (
                            <span className="home-settings__discret">
                              {t('reglages.personneHorsLigne')}
                            </span>
                          )}
                        </span>
                      </th>
                      <td>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={vois}
                          aria-checked={vois}
                          aria-label={`${t('reglages.agentsDe')} ${p.prenom}`}
                          data-testid={`home-agents-de-${p.poste}`}
                          onChange={() => afficherLesAgentsDe(p.poste, !vois)}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={voit}
                          aria-checked={voit}
                          aria-label={`${t('reglages.mesAgentsA')} ${p.prenom}`}
                          disabled={!disponible}
                          data-testid={`home-mes-agents-a-${p.poste}`}
                          onChange={() =>
                            void montrerMesAgentsA(p.poste, !voit).then((ok) =>
                              setNonEnregistre(!ok)
                            )
                          }
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {affichees.length === 0 ? (
              <p className="home-settings__note" data-testid="home-personnes-aucune-trouvee">
                {t('reglages.personnesIntrouvable', { recherche: recherche.trim() })}
              </p>
            ) : null}
          </div>
        </>
      )}
      {/* Sans personne, la légende des colonnes ne légende rien : seuls restent les avertissements. */}
      {liste.length || !disponible || nonEnregistre ? (
        <p
          className="home-settings__note home-personnes__aide"
          role={nonEnregistre ? 'status' : undefined}
        >
          {t(
            !disponible
              ? 'reglages.animalIndisponible'
              : nonEnregistre
                ? 'reglages.animalErreur'
                : 'reglages.mesAgentsAAide'
          )}
        </p>
      ) : null}
    </section>
  )
}
