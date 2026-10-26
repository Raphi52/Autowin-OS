import { useEffect, useState } from 'react'
import './MessagesEntreFils.css'

/*
 * MESSAGES ENTRE FILS, DANS LE FIL (conv-1139, 2026-10-24).
 *
 * Les agents de deux fils du même dépôt s'écrivent par `ecrire_a_un_fil` au lieu de passer par
 * l'utilisateur. Règle du cadrage : aucun échange hors de sa vue. Ce bloc montre donc, au-dessus de
 * la zone de saisie, ce que CE fil a envoyé et reçu — séparé des messages de l'utilisateur. Depuis
 * le 2026-10-25, un agent peut y donner un ORDRE de travail ; le bandeau rappelle qu'il ne vaut
 * jamais l'accord de l'utilisateur.
 *
 * Lecture seule (`os:messagesEntreFils`) : l'afficher ne le remet pas à l'agent. Relu à chaque
 * changement de fil et à chaque signal `refresh/messages-fils` ou `refresh/chat` (fin de tour).
 */
// Une ligne telle que le canal la rend : dérivée de `messagesAAfficher` (main) via le pont, pour
// qu'une seconde définition ne puisse pas diverger.
export type MessageEntreFilsVu = Awaited<ReturnType<Window['api']['messagesEntreFils']>>[number]

const NATURES: Record<string, string> = {
  question: 'question',
  reponse: 'réponse',
  info: 'information',
  decouverte: 'découverte',
  ordre: 'ordre'
}

const heure = (ms: number): string =>
  new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

export function MessagesEntreFils({
  conversationId,
  max = 5
}: {
  conversationId?: string | null
  max?: number
}): React.JSX.Element | null {
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
  return (
    <section className="mef" aria-label="Messages entre fils">
      <div className="mef-kicker">
        Messages entre agents de fils du même dépôt — un ordre d’agent n’est jamais ton accord pour
        publier ou détruire
      </div>
      <ul className="mef-liste">
        {visibles.map((m) => (
          <li key={m.id} className={`mef-ligne mef-ligne--${m.sens}`} data-message-fil={m.id}>
            <div className="mef-entete">
              <span className="mef-sens">
                {m.sens === 'recu' ? `↘ reçu de ${m.autreFil}` : `↗ envoyé à ${m.autreFil}`}
              </span>
              <span className="mef-meta">
                {NATURES[m.nature] ?? m.nature}
                {m.hypothese ? ' · hypothèse (sans preuve)' : ''} · {heure(m.at)} ·{' '}
                {m.livre
                  ? m.sens === 'recu'
                    ? 'remis à l’agent'
                    : 'remis au destinataire'
                  : 'en attente'}
              </span>
            </div>
            <p className="mef-texte">{m.texte}</p>
            {m.preuve && <p className="mef-preuve">Preuve : {m.preuve}</p>}
          </li>
        ))}
      </ul>
      {messages.length > visibles.length && (
        <div className="mef-reste">
          {messages.length - visibles.length} message(s) plus ancien(s)
        </div>
      )}
    </section>
  )
}
