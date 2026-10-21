/**
 * « ESSAIE 3 FAÇONS » — LA CARTE DE COMPARAISON ET « GARDER CELLE-CI » (conv-1038, 2026-10-21 —
 * idée 6 du scout : « une carte compare les écarts, les tests et le coût, et fusionne la gagnante »).
 *
 * Une ligne par façon, avec ce que le processus principal a MESURÉ : l'état de son tour, l'écart de
 * sa copie depuis la photo de l'essai, ce que ses vérifications ont rendu (`verify`), et ce que ses
 * appels ont coûté (`costBreakdown`, le même calcul que le reste de l'app). Les copies d'essai n'ont
 * pas de `node_modules` : une vérification qui en a besoin y est rouge, et la carte le montre tel quel.
 *
 * « Garder celle-ci » publie dans main par le chemin des copies (`os:conversations:garderEssai`) :
 * un geste qui sort du poste, donc CONFIRMÉ. Une publication en attente (fichier non commité dans le
 * dossier partagé) est dite comme une attente, jamais comme un échec ni comme une réussite.
 */
import React, { useEffect, useState } from 'react'
import type {
  ComparaisonDUneFacon,
  ResultatGarderUneFacon
} from '../../../shared/essai-trois-facons'
import {
  FACONS,
  LIBELLES_ETAT_DE_LA_FACON,
  coutDesLignes,
  phraseDeLEcart,
  phraseDesVerifications,
  phraseDuCout,
  type FaconDUnEssai
} from './trois-facons'
import './ComparaisonDesFacons.css'

type Cout = { usd: number; partiel: boolean } | null

function phraseDuResultat(resultat: ResultatGarderUneFacon): string {
  if (!resultat.ok) return `Non publiée : ${resultat.raison}`
  if (resultat.etat === 'publie')
    return `Publiée dans main${resultat.sha ? ` (${resultat.sha.slice(0, 7)})` : ''} : ${resultat.fichiers.join(', ')}.`
  if (resultat.etat === 'en-attente') return `En attente — ${resultat.detail}`
  return `Publication différée — ${resultat.detail}`
}

export function ComparaisonDesFacons({
  facons,
  signature,
  onOuvrir
}: {
  facons: readonly FaconDUnEssai[]
  /** Change quand une façon démarre ou finit un tour : la carte se relit alors. */
  signature: string
  onOuvrir?: (id: string) => void
}): React.JSX.Element | null {
  const [lignes, setLignes] = useState<ReadonlyMap<string, ComparaisonDUneFacon>>(() => new Map())
  const [couts, setCouts] = useState<ReadonlyMap<string, Cout>>(() => new Map())
  const [lecture, setLecture] = useState<string | null>(null)
  const [aConfirmer, setAConfirmer] = useState<string | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [resultats, setResultats] = useState<ReadonlyMap<string, ResultatGarderUneFacon>>(
    () => new Map()
  )
  const [relire, setRelire] = useState(0)
  const ids = facons.map((facon) => facon.id).join('|')

  // Un pont d'avant redémarrage n'a pas ce canal : lu au rendu (un état posé dans l'effet
  // relancerait un rendu en cascade, règle react-hooks relevée par eslint).
  const pontSansComparaison = !window.api?.conversationComparerLesFacons

  useEffect(() => {
    let vivant = true
    const comparer = window.api?.conversationComparerLesFacons
    if (!comparer) return
    const liste = ids ? ids.split('|') : []
    void comparer(liste).then(
      (rendues) => {
        if (!vivant) return
        setLecture(null)
        setLignes(new Map(rendues.map((rendue) => [rendue.id, rendue])))
      },
      (erreur: unknown) => {
        if (vivant)
          setLecture(
            `Comparaison illisible : ${erreur instanceof Error ? erreur.message : String(erreur)}`
          )
      }
    )
    // Le coût d'une branche est celui de ses propres appels : la même somme que le reste de l'app.
    void Promise.all(
      liste.map(async (id): Promise<[string, Cout]> => {
        const rangs = await Promise.resolve(window.api?.costBreakdown?.('provider', id)).catch(
          () => undefined
        )
        return [id, Array.isArray(rangs) ? coutDesLignes(rangs) : null]
      })
    ).then((paires) => {
      if (vivant) setCouts(new Map(paires))
    })
    return () => {
      vivant = false
    }
  }, [ids, signature, relire])

  async function garder(id: string): Promise<void> {
    setAConfirmer(null)
    const garderEssai = window.api?.conversationGarderEssai
    const noter = (resultat: ResultatGarderUneFacon): void =>
      setResultats((actuels) => new Map(actuels).set(id, resultat))
    if (!garderEssai) {
      noter({ ok: false, raison: 'Autowin doit redémarrer pour ce geste.' })
      return
    }
    setEnCours(id)
    try {
      noter(await garderEssai(id))
    } catch (erreur) {
      noter({ ok: false, raison: erreur instanceof Error ? erreur.message : String(erreur) })
    } finally {
      setEnCours(null)
      setRelire((compte) => compte + 1)
    }
  }

  if (facons.length === 0) return null

  return (
    <section
      className="comparaison-facons"
      data-origine="comparaison-facons"
      aria-label="Comparer les façons"
    >
      <header className="comparaison-facons-tete">
        {/* fix-ok: libellé lu sur la capture réelle du 2026-10-21 (« Comparer les 1 façon ») — une
            seule branche de l'essai encore ouverte se dit comme telle. */}
        <strong>
          {facons.length > 1
            ? `Comparer les ${facons.length} façons`
            : 'Une seule façon de cet essai'}
        </strong>
        <span className="comparaison-facons-note">
          écart depuis la photo de l’essai · vérifications lancées · coût mesuré
        </span>
        <button
          type="button"
          className="comparaison-facons-relire"
          title="Relire l’écart, les vérifications et le coût de chaque façon"
          onClick={() => setRelire((compte) => compte + 1)}
        >
          ↻
        </button>
      </header>
      {(pontSansComparaison || lecture) && (
        <div className="comparaison-facons-lecture" role="status">
          {/* fix-ok: cause mesurée par eslint (« Calling setState synchronously within an effect »,
              l.65) — le message du pont absent se lit désormais au rendu, plus dans l'effet. */}
          {pontSansComparaison ? 'Autowin doit redémarrer pour comparer les façons.' : lecture}
        </div>
      )}
      <ul className="comparaison-facons-liste">
        {facons.map((facon) => {
          const rendue = lignes.get(facon.id)
          const resultat = resultats.get(facon.id)
          const mesuree = rendue?.ok ? rendue : undefined
          const rienAGarder =
            !mesuree ||
            !mesuree.ecart.ok ||
            mesuree.ecart.fichiers.length === 0 ||
            mesuree.bilan.etat === 'en-cours' ||
            mesuree.bilan.etat === 'pas-parti'
          const dejaPubliee = resultat?.ok === true && resultat.etat === 'publie'
          const fichiers =
            mesuree?.ecart.ok === true
              ? mesuree.ecart.fichiers.map((fichier) => fichier.chemin).join('\n')
              : undefined
          return (
            <li key={facon.id} className="comparaison-facon" data-facon={facon.id}>
              <div className="comparaison-facon-nom">
                <strong>{`Façon ${facon.rang}`}</strong>
                <span>{FACONS[(facon.rang - 1) % FACONS.length]}</span>
              </div>
              {rendue && !rendue.ok ? (
                <div className="comparaison-facon-mesures">{rendue.raison}</div>
              ) : (
                <dl className="comparaison-facon-mesures">
                  <div>
                    <dt>État</dt>
                    <dd>{mesuree ? LIBELLES_ETAT_DE_LA_FACON[mesuree.bilan.etat] : '…'}</dd>
                  </div>
                  <div>
                    <dt>Écart</dt>
                    <dd title={fichiers}>{mesuree ? phraseDeLEcart(mesuree.ecart) : '…'}</dd>
                  </div>
                  <div>
                    <dt>Vérifications</dt>
                    <dd>{mesuree ? phraseDesVerifications(mesuree.bilan) : '…'}</dd>
                  </div>
                  <div>
                    <dt>Coût</dt>
                    <dd>{couts.has(facon.id) ? phraseDuCout(couts.get(facon.id) ?? null) : '…'}</dd>
                  </div>
                </dl>
              )}
              <div className="comparaison-facon-gestes">
                {onOuvrir && (
                  <button type="button" onClick={() => onOuvrir(facon.id)}>
                    Ouvrir
                  </button>
                )}
                <button
                  type="button"
                  className="comparaison-facon-garder"
                  disabled={rienAGarder || dejaPubliee || enCours !== null}
                  title={
                    rienAGarder
                      ? 'Rien à garder : cette façon n’a pas fini, ou n’a rien changé'
                      : 'Publier dans main ce que cette façon a changé — et seulement cela'
                  }
                  onClick={() => setAConfirmer(facon.id)}
                >
                  {enCours === facon.id ? 'Publication…' : 'Garder celle-ci'}
                </button>
              </div>
              {aConfirmer === facon.id && (
                <div className="comparaison-facon-confirmer" role="alertdialog">
                  <span>
                    Publier cette façon dans main ? Seul ce qu’elle a changé part ; un fichier non
                    commité dans le dossier partagé met la publication en attente.
                  </span>
                  <button type="button" onClick={() => void garder(facon.id)}>
                    Oui, publier
                  </button>
                  <button type="button" onClick={() => setAConfirmer(null)}>
                    Annuler
                  </button>
                </div>
              )}
              {resultat && (
                <div
                  className={`comparaison-facon-resultat is-${resultat.ok ? resultat.etat : 'refus'}`}
                  role="status"
                >
                  {phraseDuResultat(resultat)}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
