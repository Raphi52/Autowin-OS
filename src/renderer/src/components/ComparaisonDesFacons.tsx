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
import { useTextesChatDecisions } from '../textes-ecrans/chat-decisions'
import {
  coutDesLignes,
  estTresProche,
  libelleDeLEtatDeLaFacon,
  phraseDeLaRessemblance,
  phraseDeLEcart,
  phraseDesVerifications,
  phraseDuCout,
  type FaconDUnEssai
} from './trois-facons'
import './ComparaisonDesFacons.css'

type Cout = { usd: number; partiel: boolean } | null
type Traduire = ReturnType<typeof useTextesChatDecisions>['t']

/*
 * Les trois natures de façon, traduites : même ordre et même français que `FACONS` (trois-facons.ts),
 * qui reste en français parce qu'il part dans la consigne de chaque branche.
 */
const NATURES = ['facons.nature.1', 'facons.nature.2', 'facons.nature.3'] as const

function phraseDuResultat(resultat: ResultatGarderUneFacon, t: Traduire): string {
  if (!resultat.ok) return t('facons.resultat.nonPubliee', { raison: resultat.raison })
  if (resultat.etat === 'publie')
    return t('facons.resultat.publiee', {
      sha: resultat.sha ? ` (${resultat.sha.slice(0, 7)})` : '',
      fichiers: resultat.fichiers.join(', ')
    })
  if (resultat.etat === 'en-attente')
    return t('facons.resultat.enAttente', { detail: resultat.detail })
  return t('facons.resultat.differee', { detail: resultat.detail })
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
  const { t } = useTextesChatDecisions()
  const [lignes, setLignes] = useState<ReadonlyMap<string, ComparaisonDUneFacon>>(() => new Map())
  const [couts, setCouts] = useState<ReadonlyMap<string, Cout>>(() => new Map())
  /** Le message de l'erreur de lecture de la comparaison ; la phrase se compose au rendu. */
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
        if (vivant) setLecture(erreur instanceof Error ? erreur.message : String(erreur))
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
      noter({ ok: false, raison: t('facons.redemarrerGeste') })
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
      aria-label={t('facons.aria')}
    >
      <header className="comparaison-facons-tete">
        {/* fix-ok: libellé lu sur la capture réelle du 2026-10-21 (« Comparer les 1 façon ») — une
            seule branche de l'essai encore ouverte se dit comme telle. */}
        <strong>
          {facons.length > 1
            ? t('facons.titre.plusieurs', { n: facons.length })
            : t('facons.titre.une')}
        </strong>
        <span className="comparaison-facons-note">{t('facons.note')}</span>
        <button
          type="button"
          className="comparaison-facons-relire"
          title={t('facons.relire')}
          onClick={() => setRelire((compte) => compte + 1)}
        >
          ↻
        </button>
      </header>
      {(pontSansComparaison || lecture) && (
        <div className="comparaison-facons-lecture" role="status">
          {/* fix-ok: cause mesurée par eslint (« Calling setState synchronously within an effect »,
              l.65) — le message du pont absent se lit désormais au rendu, plus dans l'effet. */}
          {pontSansComparaison
            ? t('facons.redemarrerComparer')
            : t('facons.illisible', { erreur: lecture ?? '' })}
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
                <strong>{t('facons.facon', { rang: facon.rang })}</strong>
                <span>{t(NATURES[(facon.rang - 1) % NATURES.length]!)}</span>
              </div>
              {rendue && !rendue.ok ? (
                <div className="comparaison-facon-mesures">{rendue.raison}</div>
              ) : (
                <dl className="comparaison-facon-mesures">
                  <div>
                    <dt>{t('facons.etat')}</dt>
                    <dd>{mesuree ? libelleDeLEtatDeLaFacon(mesuree.bilan.etat) : '…'}</dd>
                  </div>
                  <div>
                    <dt>{t('facons.ecart')}</dt>
                    <dd title={fichiers}>{mesuree ? phraseDeLEcart(mesuree.ecart) : '…'}</dd>
                  </div>
                  <div>
                    <dt>{t('facons.verifications')}</dt>
                    <dd>{mesuree ? phraseDesVerifications(mesuree.bilan) : '…'}</dd>
                  </div>
                  {/* Le contrôle de ressemblance (conv-1057, 2026-10-22) : deux façons au même
                      code se voient d'un coup d'œil. */}
                  <div>
                    <dt>{t('facons.ressemblance')}</dt>
                    <dd
                      data-mesure="ressemblance"
                      className={estTresProche(mesuree?.ressemblance) ? 'is-proche' : undefined}
                    >
                      {mesuree ? phraseDeLaRessemblance(mesuree.ressemblance) : '…'}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('facons.cout')}</dt>
                    <dd>{couts.has(facon.id) ? phraseDuCout(couts.get(facon.id) ?? null) : '…'}</dd>
                  </div>
                </dl>
              )}
              <div className="comparaison-facon-gestes">
                {onOuvrir && (
                  <button type="button" onClick={() => onOuvrir(facon.id)}>
                    {t('facons.ouvrir')}
                  </button>
                )}
                <button
                  type="button"
                  className="comparaison-facon-garder"
                  disabled={rienAGarder || dejaPubliee || enCours !== null}
                  title={rienAGarder ? t('facons.rienAGarder') : t('facons.publierTitre')}
                  onClick={() => setAConfirmer(facon.id)}
                >
                  {enCours === facon.id ? t('facons.publication') : t('facons.garder')}
                </button>
              </div>
              {aConfirmer === facon.id && (
                <div className="comparaison-facon-confirmer" role="alertdialog">
                  <span>{t('facons.confirmer')}</span>
                  <button type="button" onClick={() => void garder(facon.id)}>
                    {t('facons.oui')}
                  </button>
                  <button type="button" onClick={() => setAConfirmer(null)}>
                    {t('facons.annuler')}
                  </button>
                </div>
              )}
              {resultat && (
                <div
                  className={`comparaison-facon-resultat is-${resultat.ok ? resultat.etat : 'refus'}`}
                  role="status"
                >
                  {phraseDuResultat(resultat, t)}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
