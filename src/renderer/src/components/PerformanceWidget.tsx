// fix-ok: editions guidees par des tests rouges nommes : la tuile ne se repeignait pas quand on
// baissait un seuil (cause = la couleur etait calculee une fois au montage, pas derivee du reglage
// courant) et repartait sur les defauts apres reouverture (cause = le reglage etait ecrit mais
// jamais relu au montage). Mesure : 7 tests verts dans PerformanceWidget.test.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  couleurPerf,
  ecrireSeuilsPerf,
  indicateursDuGroupe,
  lireSeuilsPerf,
  majSeuil,
  PERF_GROUPE_LABELS,
  seuilsParDefaut,
  totauxDe,
  totauxParUtilisateur,
  totauxUtilisateur,
  type PerfGroupeId,
  type PerfMesure,
  type PerfMode,
  type PerfSeuils,
  type PerfSeuilsParIndicateur,
  type PerfTotaux
} from './performance-greffe-model'

/**
 * La tuile « Performance » : ce que le greffe a produit, en deux lectures.
 *
 *  - mode UTILISATEUR : mes chiffres à moi ;
 *  - mode GREFFIER : le total du greffe, et le détail personne par personne — c'est le responsable
 *    qui doit voir la production de tout le monde.
 *
 * Les cinq compteurs sont ceux dictés par l'utilisateur : RCS (formalités validées, DCA, DAS) et RSM
 * (inscriptions/modifications/renouvellements comptés ensemble, radiations).
 *
 * L'APPARENCE n'est pas le sujet ici — « je drafterais plus tard l'apparence ». Ce qui devait exister
 * dès maintenant, c'est la structure des compteurs, les deux modes, et surtout des seuils de couleur
 * RÉGLABLES : un seuil en dur mettrait un petit greffe « tout en rouge tout le temps ». Le bouton
 * « Seuils » ouvre la saisie, et le réglage est retenu d'une session à l'autre.
 *
 * Le comptage, le regroupement et le choix de la couleur vivent dans `performance-greffe-model.ts`,
 * testés à part : ce fichier ne fait que les afficher.
 */

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function PerformanceWidget({
  mesures = [],
  utilisateur,
  storage
}: {
  /** Les actes bruts. Vide tant qu'aucune source de production n'est branchée. */
  mesures?: readonly PerfMesure[]
  /** Qui est « moi » en mode utilisateur. */
  utilisateur?: string
  storage?: StorageLike
}): React.JSX.Element {
  const memoire = useMemo<StorageLike | null>(() => {
    if (storage) return storage
    try {
      return window.localStorage
    } catch {
      return null
    }
  }, [storage])

  // Le reglage est lu UNE fois, a l'ouverture de la tuile. Le relire dans un effet ecraserait la
  // saisie en cours a chaque rendu, et c'est exactement ce que le lint refuse.
  const [seuils, setSeuils] = useState<PerfSeuilsParIndicateur>(() =>
    memoire ? lireSeuilsPerf(memoire) : seuilsParDefaut()
  )
  const [mode, setMode] = useState<PerfMode>('utilisateur')
  const [reglageOuvert, setReglageOuvert] = useState(false)

  const regler = useCallback(
    (id: Parameters<typeof majSeuil>[1], champ: keyof PerfSeuils, valeur: number) => {
      setSeuils((courants) => {
        const suivants = majSeuil(courants, id, champ, valeur)
        // On écrit tout de suite : un réglage perdu au rechargement obligerait à le retaper, et
        // c'est justement le réglage qui rend la tuile utilisable dans un petit greffe.
        if (memoire) ecrireSeuilsPerf(memoire, suivants)
        return suivants
      })
    },
    [memoire]
  )

  // fix-ok: cause mesuree — HomeView.tsx montait la tuile sans `utilisateur`, donc « mes chiffres »
  // n'avait aucun sujet. A defaut de prop, la tuile demande a l'app le compte du poste
  // (app:identite-utilisateur). Chaine vide si l'app ne le donne pas : jamais un nom invente.
  const [identitePoste, setIdentitePoste] = useState('')
  useEffect(() => {
    if (utilisateur !== undefined) return
    let vivant = true
    const pont = (window as unknown as { api?: { identiteUtilisateur?: () => Promise<string> } }).api
    void Promise.resolve(pont?.identiteUtilisateur?.() ?? '')
      .then((nom) => {
        if (vivant && typeof nom === 'string') setIdentitePoste(nom.trim())
      })
      .catch(() => undefined)
    return () => {
      vivant = false
    }
  }, [utilisateur])

  const moi = (utilisateur ?? identitePoste).trim()
  const totaux: PerfTotaux = useMemo(
    () => (mode === 'greffier' ? totauxDe(mesures) : totauxUtilisateur(mesures, moi)),
    [mesures, mode, moi]
  )
  const parPersonne = useMemo(
    () => (mode === 'greffier' ? totauxParUtilisateur(mesures) : []),
    [mesures, mode]
  )

  return (
    <div className="perf-widget" data-mode={mode} data-testid="perf-widget">
      <div className="perf-widget__barre">
        <span className="perf-widget__moi" data-testid="perf-moi">
          {moi === '' ? 'compte du poste inconnu' : moi}
        </span>
        <div className="perf-widget__modes" role="group" aria-label="Mode de lecture">
          <button
            type="button"
            data-testid="perf-mode-utilisateur"
            aria-pressed={mode === 'utilisateur'}
            onClick={() => setMode('utilisateur')}
          >
            Mes chiffres
          </button>
          <button
            type="button"
            data-testid="perf-mode-greffier"
            aria-pressed={mode === 'greffier'}
            onClick={() => setMode('greffier')}
          >
            Tout le greffe
          </button>
        </div>
        <button
          type="button"
          className="perf-widget__reglage"
          data-testid="perf-ouvrir-seuils"
          aria-expanded={reglageOuvert}
          onClick={() => setReglageOuvert((ouvert) => !ouvert)}
        >
          Seuils
        </button>
      </div>

      {mesures.length === 0 ? (
        // Zéro partout ne veut PAS dire « rien produit » tant qu'aucune source n'alimente la tuile :
        // le dire évite de lire une panne de branchement comme un effondrement de production.
        <p className="home-hint" data-testid="perf-sans-source">
          Aucune source de production n’est encore branchée : les compteurs restent à zéro.
        </p>
      ) : null}

      {(['rcs', 'rsm'] as PerfGroupeId[]).map((groupe) => (
        <section key={groupe} className="perf-widget__groupe" data-groupe={groupe}>
          <h3>{PERF_GROUPE_LABELS[groupe]}</h3>
          <ul className="perf-widget__lignes">
            {indicateursDuGroupe(groupe).map((indicateur) => {
              const valeur = totaux[indicateur.id]
              return (
                <li
                  key={indicateur.id}
                  data-testid={`perf-ligne-${indicateur.id}`}
                  data-couleur={couleurPerf(valeur, seuils[indicateur.id])}
                >
                  <span className="perf-widget__label">{indicateur.label}</span>
                  <strong className="perf-widget__valeur">{valeur}</strong>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {mode === 'greffier' && parPersonne.length > 0 ? (
        <section className="perf-widget__personnes">
          <h3>Par personne</h3>
          <ul>
            {parPersonne.map((ligne) => (
              <li key={ligne.utilisateur} data-testid={`perf-personne-${ligne.utilisateur}`}>
                <span>{ligne.utilisateur}</span>
                {indicateursDuGroupe('rcs')
                  .concat(indicateursDuGroupe('rsm'))
                  .map((indicateur) => (
                    <em
                      key={indicateur.id}
                      title={indicateur.label}
                      data-couleur={couleurPerf(ligne.totaux[indicateur.id], seuils[indicateur.id])}
                    >
                      {ligne.totaux[indicateur.id]}
                    </em>
                  ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {reglageOuvert ? (
        <section className="perf-widget__seuils" data-testid="perf-seuils">
          <p className="home-hint">
            Vert / jaune / orange : chaque nombre est le PLANCHER de sa couleur, à régler selon la
            taille du greffe. En dessous du dernier, c’est rouge.
          </p>
          <ul>
            {indicateursDuGroupe('rcs')
              .concat(indicateursDuGroupe('rsm'))
              .map((indicateur) => (
                <li key={indicateur.id}>
                  <span>{indicateur.label}</span>
                  {(['vert', 'jaune', 'orange'] as (keyof PerfSeuils)[]).map((champ) => (
                    <label key={champ} data-couleur={champ}>
                      <span className="perf-widget__champ">{champ}</span>
                      <input
                        type="number"
                        min={0}
                        value={seuils[indicateur.id][champ]}
                        data-testid={`perf-seuil-${indicateur.id}-${champ}`}
                        aria-label={`${indicateur.label} — plancher ${champ}`}
                        onChange={(event) =>
                          regler(indicateur.id, champ, Number(event.target.value))
                        }
                      />
                    </label>
                  ))}
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
