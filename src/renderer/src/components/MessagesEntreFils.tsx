import { useEffect, useState } from 'react'
import { formaterDate } from '../langue'
import { riche } from '../textes'
import {
  auPluriel,
  useTextesChatFilsEtLots,
  type CleChatFilsEtLots
} from '../textes-ecrans/chat-fils-et-lots'
import './MessagesEntreFils.css'

/*
 * MESSAGES ENTRE FILS, DANS LE FIL (conv-1139, 2026-10-24).
 *
 * Les agents de deux fils du même dépôt s'écrivent par `ecrire_a_un_fil` au lieu de passer par
 * l'utilisateur. Règle du cadrage : aucun échange hors de sa vue. Ce bloc montre donc ce que CE fil
 * a envoyé et reçu — séparé des messages de l'utilisateur. Il vit en tête de l'onglet Runs du
 * panneau Détails (WorkflowsPanel) depuis le 2026-10-25, plus au-dessus de la zone de saisie. Depuis
 * le 2026-10-25, un agent peut y donner un ORDRE de travail ; la bulle de chaque ordre rappelle
 * qu'il ne vaut jamais l'accord de l'utilisateur. Mise en page « Bulles » (choisie au /draft du
 * 2026-10-25) : un petit chat par fil correspondant, les envois de CE fil à droite.
 *
 * Lecture seule (`os:messagesEntreFils`) : l'afficher ne le remet pas à l'agent. Relu à chaque
 * changement de fil et à chaque signal `refresh/messages-fils` ou `refresh/chat` (fin de tour).
 */
// Une ligne telle que le canal la rend : dérivée de `messagesAAfficher` (main) via le pont, pour
// qu'une seconde définition ne puisse pas diverger.
export type MessageEntreFilsVu = Awaited<ReturnType<Window['api']['messagesEntreFils']>>[number]

// La clé `nature` (question, ordre…) vient du canal et sert de classe CSS : seul son libellé se traduit.
const NATURES: Record<string, CleChatFilsEtLots> = {
  question: 'messages.nature.question',
  reponse: 'messages.nature.reponse',
  info: 'messages.nature.info',
  decouverte: 'messages.nature.decouverte',
  ordre: 'messages.nature.ordre'
}

const heure = (ms: number): string => formaterDate(ms, { hour: '2-digit', minute: '2-digit' })

export function MessagesEntreFils({
  conversationId,
  max = 5
}: {
  conversationId?: string | null
  max?: number
}): React.JSX.Element | null {
  const { langue, t } = useTextesChatFilsEtLots()
  // L'état porte le fil qu'il décrit : à un changement de fil, l'ancien n'est jamais affiché, et
  // aucun état n'est posé en synchrone dans l'effet (règle react-hooks/set-state-in-effect).
  const [lu, setLu] = useState<{ fil: string; messages: MessageEntreFilsVu[] }>({
    fil: '',
    messages: []
  })

  useEffect(() => {
    if (!conversationId || typeof window.api?.messagesEntreFils !== 'function') return
    let vivant = true
    const relire = (): void => {
      window.api.messagesEntreFils(conversationId).then(
        (recus) => {
          if (vivant) setLu({ fil: conversationId, messages: Array.isArray(recus) ? recus : [] })
        },
        // Un shell plus ancien n'expose pas ce canal : rien à montrer, rien de cassé.
        () => {
          if (vivant) setLu({ fil: conversationId, messages: [] })
        }
      )
    }
    relire()
    const off = window.api?.onAppEvent?.((e) => {
      if (e.type === 'refresh' && (e.scope === 'messages-fils' || e.scope === 'chat')) relire()
    })
    return () => {
      vivant = false
      off?.()
    }
  }, [conversationId])

  const messages = lu.fil === conversationId ? lu.messages : []
  if (!messages.length) return null
  const visibles = messages.slice(-max)
  const plusAnciens = messages.length - visibles.length
  return (
    <section className="mef" aria-label={t('messages.aria')}>
      {plusAnciens > 0 && (
        <div className="mef-reste">
          {t(
            auPluriel(plusAnciens, langue)
              ? 'messages.plusAnciens.plusieurs'
              : 'messages.plusAnciens.un',
            { n: plusAnciens }
          )}
        </div>
      )}
      {parFil(visibles).map((groupe) => (
        <div key={groupe.fil} className="mef-groupe">
          <div className="mef-avec">{riche(t('messages.avec', { fil: groupe.fil }), 'b')}</div>
          <ul className="mef-liste">
            {groupe.messages.map((m) => (
              <li
                key={m.id}
                className={`mef-bulle mef-bulle--${m.sens}`}
                data-message-fil={m.id}
                aria-label={
                  m.sens === 'recu'
                    ? t('messages.recuDe', { fil: m.autreFil })
                    : t('messages.envoyeA', { fil: m.autreFil })
                }
              >
                <div className="mef-corps">
                  <span className={`mef-nature mef-nature--${m.nature}`}>
                    {NATURES[m.nature] ? t(NATURES[m.nature]) : m.nature}
                    {m.hypothese ? t('messages.hypothese') : ''}
                  </span>
                  <p className="mef-texte">{m.texte}</p>
                  {m.preuve && (
                    <p className="mef-preuve">{t('messages.preuve', { preuve: m.preuve })}</p>
                  )}
                </div>
                <div className="mef-meta">
                  {heure(m.at)} ·{' '}
                  {m.livre
                    ? m.sens === 'recu'
                      ? t('messages.remisAgent')
                      : t('messages.remisDestinataire')
                    : t('messages.enAttente')}
                  {m.nature === 'ordre' ? t('messages.ordrePasAccord') : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/*
 * Un groupe par fil correspondant, dans l'ordre du journal à l'intérieur ; le groupe dont le
 * dernier message est le plus récent va EN BAS, comme dans un chat (conv-1139, 2026-10-25,
 * proposition « Bulles » du /draft).
 */
function parFil(
  messages: MessageEntreFilsVu[]
): Array<{ fil: string; messages: MessageEntreFilsVu[] }> {
  const groupes = new Map<string, MessageEntreFilsVu[]>()
  for (const m of messages) {
    const groupe = groupes.get(m.autreFil)
    if (groupe) groupe.push(m)
    else groupes.set(m.autreFil, [m])
  }
  const dernier = (ms: MessageEntreFilsVu[]): number => Math.max(...ms.map((m) => m.at))
  return [...groupes]
    .map(([fil, ms]) => ({ fil, messages: ms }))
    .sort((a, b) => dernier(a.messages) - dernier(b.messages))
}
