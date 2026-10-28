/**
 * LA CARTE « LANCER EN N FILS » (conv-1147, 2026-10-25). Elle est dessinée depuis le bloc
 * ```aw-fils de l'agent (`shared/lancer-en-fils.ts`).
 *
 * Elle montre les tâches regroupées par fichiers communs et ce que ça coûte. Deux boutons :
 * « Lancer en N fils » et « Tout ici, l'une après l'autre ». Rien ne part sans clic, et un clic ne
 * part qu'UNE fois. La carte s'en souvient (localStorage, clé tirée de sa source ET de la réponse
 * qui la porte, défaut D5), car le fil la re-rend à chaque tour. Le lancement lui-même appartient à ChatView
 * (`proposition-fils-evenements.ts`).
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { cleDuLancement, planDesFils, type TacheDeFil } from '../../../shared/lancer-en-fils'
import { riche } from '../textes'
import { auPluriel, useTextesChatFilsEtLots } from '../textes-ecrans/chat-fils-et-lots'
import { MessageDuFil } from './message-du-fil'
import {
  EVT_FILS_LANCES,
  EVT_LANCER_EN_FILS,
  ecrireSouvenir,
  lireSouvenir,
  type ConfirmationDeLancement,
  type DemandeDeLancement,
  type ModeDeLancement,
  type SouvenirDeCarte as Souvenir
} from './proposition-fils-evenements'
import './BlocDonnees.css'
import './PropositionDeFils.css'

export function PropositionDeFils({
  taches,
  source
}: {
  taches: TacheDeFil[]
  source: string
}): React.JSX.Element {
  const { langue, t } = useTextesChatFilsEtLots()
  // L'identité de la réponse qui porte la carte (`message-du-fil.ts`, fil + tour) : un souvenir PAR
  // réponse (défaut D5). `''` = réponse encore en cours d'écriture : son tour n'est peut-être pas
  // connu, donc un clic se souviendrait sous une clé qui changera, et les boutons reviendraient.
  const reponse = useContext(MessageDuFil)
  const enEcriture = reponse === ''
  const cle = useMemo(() => cleDuLancement(source, reponse || undefined), [source, reponse])
  const plan = useMemo(() => planDesFils(taches), [taches])
  /*
   * L'ANCIENNE CLÉ, tirée de la seule source (avant la correction D5), est RELUE mais jamais plus
   * écrite (2e relecture externe, conv-1147). Sans elle, une carte cliquée avant la correction
   * réaffichait ses boutons, et un second clic relançait N tours. Prix assumé : deux cartes au même
   * contenu cliquées AVANT la correction paraissent toutes deux lancées. Mieux vaut un bouton absent
   * que N tours relancés.
   */
  const ancienneCle = useMemo(() => cleDuLancement(source), [source])
  const relire = (c: string): Souvenir | null =>
    lireSouvenir(c) ?? (c === ancienneCle ? null : lireSouvenir(ancienneCle))
  // Le souvenir est rattaché à SA clé : quand la clé change (l'identifiant arrive), il est relu.
  const [lu, setLu] = useState<{ cle: string; souvenir: Souvenir | null }>(() => ({
    cle,
    souvenir: relire(cle)
  }))
  const souvenir = lu.cle === cle ? lu.souvenir : relire(cle)
  // Refus avant toute dépense : la raison est dite, et les boutons reviennent (rien n'a coûté).
  const rienNestParti = Boolean(souvenir && 'rienNestParti' in souvenir && souvenir.rienNestParti)
  const raisonDuRefus = souvenir && 'refus' in souvenir ? souvenir.refus?.join(' · ') : undefined
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const confirme = (event: Event): void => {
      const detail = (event as CustomEvent<ConfirmationDeLancement>).detail
      if (detail?.cle !== cle) return
      const suivant = {
        mode: detail.mode,
        fils: detail.fils,
        refus: detail.refus,
        ...(detail.rienNestParti ? { rienNestParti: true as const } : {})
      }
      ecrireSouvenir(cle, suivant)
      setLu({ cle, souvenir: suivant })
    }
    window.addEventListener(EVT_FILS_LANCES, confirme)
    return () => window.removeEventListener(EVT_FILS_LANCES, confirme)
  }, [cle])

  const lancer = (mode: ModeDeLancement): void => {
    if ((souvenir && !rienNestParti) || enEcriture) return
    const noeud = ref.current
    // Le fil qui AFFICHE la carte : la fenêtre de mosaïque le pose (`data-conv-id`) ; au chat
    // plein, ChatView prend le fil affiché. Jamais `data-fil-du-tour` : sur une réponse COPIÉE
    // dans une branche, il vaut le fil d'ORIGINE, et le clic partait de là (défaut 2, conv-1147).
    const conversationId =
      noeud?.closest('[data-conv-id]')?.getAttribute('data-conv-id') || undefined
    // La réponse et son tour, posés par ChatMessageRow. Le tour suffit à ChatView quand la réponse,
    // peinte en direct, n'a pas encore d'identifiant de message.
    const reponseDuDom = noeud?.closest('[data-message-id], [data-turn-id]')
    const messageId = reponseDuDom?.getAttribute('data-message-id') || undefined
    const turnId = reponseDuDom?.getAttribute('data-turn-id') || undefined
    const envoye: Souvenir = { mode, envoye: true }
    ecrireSouvenir(cle, envoye)
    setLu({ cle, souvenir: envoye })
    const demande: DemandeDeLancement = {
      mode,
      plan,
      cle,
      ...(conversationId ? { conversationId } : {}),
      ...(messageId ? { messageId } : {}),
      ...(turnId ? { turnId } : {})
    }
    window.dispatchEvent(new CustomEvent(EVT_LANCER_EN_FILS, { detail: demande }))
  }

  const total = plan.reduce((somme, fil) => somme + fil.taches.length, 0)
  const parallele = plan.length >= 2

  return (
    <div ref={ref} className="md-donnees md-fils" data-testid="proposition-fils">
      <div className="md-donnees__titre">
        {total >= 2 ? t('fils.titre.plusieurs', { n: total }) : t('fils.titre.une')}
      </div>
      {plan.length === 0 ? (
        <div className="md-donnees__note">{t('fils.rienADecouper')}</div>
      ) : (
        <ol className="md-fils__liste">
          {plan.map((fil, rang) => (
            <li key={rang} className="md-fils__fil">
              {parallele ? (
                <span className="md-fils__rang">{t('fils.rang', { n: rang + 1 })}</span>
              ) : null}
              <span className="md-fils__taches">
                {fil.taches.map((tache, n) => (
                  <span key={n} className="md-fils__tache">
                    <b>{tache.titre}</b>
                    {n > 0 ? (
                      <span className="md-donnees__ton--discret">{t('fils.aLaSuite')}</span>
                    ) : null}
                    {tache.fichiers.length ? (
                      <span className="md-fils__fichiers">{tache.fichiers.join(' · ')}</span>
                    ) : null}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      )}
      {plan.length === 1 ? (
        <div className="md-donnees__note">{riche(t('fils.memesFichiers'), 'b')}</div>
      ) : null}
      {rienNestParti ? (
        <div className="md-donnees__ton--ko">
          {t('fils.rienNestParti', { raison: raisonDuRefus ?? t('fils.raisonInconnue') })}
        </div>
      ) : null}
      {souvenir && !rienNestParti ? (
        <EtatLance souvenir={souvenir} />
      ) : plan.length > 0 ? (
        <div className="md-fils__actions">
          {parallele ? (
            <button
              type="button"
              className="btn btn-sm btn-accent"
              disabled={enEcriture}
              onClick={() => lancer('fils')}
            >
              {t('fils.lancer', { n: plan.length })}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-sm"
            disabled={enEcriture}
            onClick={() => lancer('ici')}
          >
            {t('fils.toutIci')}
          </button>
          <span className="md-donnees__note">
            {enEcriture
              ? t('fils.boutonsEnAttente')
              : riche(
                  t('fils.cout', {
                    tours: t(
                      auPluriel(total, langue) ? 'fils.cout.tours.plusieurs' : 'fils.cout.tours.un',
                      { n: total }
                    ),
                    dont: parallele ? t('fils.cout.dont', { n: plan.length }) : ''
                  }),
                  'b'
                )}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function EtatLance({ souvenir }: { souvenir: Souvenir }): React.JSX.Element {
  const { t } = useTextesChatFilsEtLots()
  if ('envoye' in souvenir)
    return <div className="md-donnees__note">{t('fils.lancementDemande')}</div>
  const ouvrir = (id: string): void => {
    window.dispatchEvent(new CustomEvent('autowin:open-conversation', { detail: id }))
  }
  return (
    <div className="md-fils__lance">
      <span className="md-donnees__ton--ok">
        {souvenir.mode === 'ici' ? t('fils.lanceIci') : t('fils.lance')}
      </span>
      {souvenir.mode === 'fils'
        ? souvenir.fils.map((fil) => (
            <button
              key={fil.id}
              type="button"
              className="md-fils__lien"
              onClick={() => ouvrir(fil.id)}
              title={t('fils.ouvrirCeFil')}
            >
              {fil.titre} <span className="md-fils__id">{fil.id}</span>
            </button>
          ))
        : null}
      {souvenir.refus?.length ? (
        <span className="md-donnees__ton--ko">
          {t('fils.nonParti', { liste: souvenir.refus.join(' · ') })}
        </span>
      ) : null}
    </div>
  )
}
