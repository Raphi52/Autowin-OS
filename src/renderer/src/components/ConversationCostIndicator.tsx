import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  callsLabel,
  formatDuration,
  costRowLabel,
  sharePercent,
  spendingRows,
  summarizeConversationCost,
  timeSharePercent,
  type CostRow
} from './conversation-cost'
import { aggregatePromptComposition, type CompositionCallInput } from './prompt-composition'
import './ConversationCostIndicator.css'

/**
 * Ce que la conversation a coûté, à côté du composeur — et le détail par acteur au clic.
 *
 * Le canal `os:costBreakdown` réconciliait déjà les deux journaux et personne ne l'appelait. Il a
 * fallu parser 114 fichiers .jsonl à la main pour découvrir 26,65 $/h : ce chiffre doit être à l'écran.
 *
 * HONNÊTE sur ce qu'il montre : rien tant que rien n'a été dépensé (pas de « 0 $ » qui ferait croire à
 * une mesure alors que le journal est simplement vide), et le rafraîchissement est explicite — la
 * dépense d'un tour n'est lisible qu'une fois le tour fini.
 */
interface Props {
  conversationId?: string
  /** Passe à false à la fin d'un tour → c'est là que la dépense devient lisible. */
  busy?: boolean
}

/**
 * « cache 0 % » se lit comme « rien n'a servi » alors que le premier appel ÉCRIT le cache que les
 * suivants reliront. La bulle d'aide expose ce volume ; le pourcentage, lui, reste une vraie part
 * RELUE — on ne le gonfle pas d'une écriture.
 */
function cacheWriteHint(cacheWriteTokens: number | undefined): string {
  if (!cacheWriteTokens || cacheWriteTokens <= 0) return ''
  const volume =
    cacheWriteTokens >= 1_000_000
      ? `${(cacheWriteTokens / 1_000_000).toFixed(1)}M`
      : cacheWriteTokens >= 1_000
        ? `${Math.round(cacheWriteTokens / 1_000)}k`
        : `${Math.round(cacheWriteTokens)}`
  return ` (dont ${volume} tokens écrits en cache)`
}

export function ConversationCostIndicator({
  conversationId,
  busy
}: Props): React.JSX.Element | null {
  /*
   * LES LIGNES PORTENT LE FIL DONT ELLES VIENNENT. Signalé le 2026-09-21 : « je navigue de conv en
   * conv et ça écrit le même coût ». Le serveur rendait bien un total par fil ; la pastille, elle,
   * gardait des lignes SANS propriétaire, donc affichait celles du fil précédent tant que rien ne
   * les remplaçait — et rien ne les remplaçait en arrivant sur un fil occupé (voir l'effet plus bas),
   * ni pendant le chargement, et une réponse tardive du fil quitté pouvait les écraser. Des lignes
   * étiquetées ne s'affichent que pour LEUR fil : les trois cas tombent d'un coup.
   */
  const [donnees, setDonnees] = useState<{ conversationId: string; rows: CostRow[] } | null>(null)
  /** Le fil affiché À L'INSTANT — une réponse qui revient pour un autre fil est jetée. */
  const filCourant = useRef(conversationId)
  // Mis à jour au COMMIT, avant tout effet et avant qu'une réponse en vol puisse être traitée.
  useLayoutEffect(() => {
    filCourant.current = conversationId
  }, [conversationId])
  const [openConversationId, setOpenConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /**
   * Échec du dernier refresh MANUEL (clic « Actualiser ») uniquement. Le refresh AUTOMATIQUE reste
   * silencieux à dessein (un journal illisible ne doit pas casser le composeur), mais une action
   * explicite qui échoue sans rien afficher faisait croire à un total à jour alors qu'il est périmé.
   */
  const [manualError, setManualError] = useState(false)
  /**
   * COMPOSITION DU PROMPT — la taille de chaque bloc injecté est déjà écrite à chaque appel, mais
   * rien ne l'additionnait : c'est le seul levier mesurable sur la facture. Lu à part du coût
   * (autre journal), et un échec reste silencieux : la section disparaît, le coût reste affiché.
   */
  // Même étiquette que les lignes de coût : la composition d'un autre fil ne s'affiche jamais.
  const [promptCalls, setPromptCalls] = useState<{
    conversationId: string
    calls: CompositionCallInput[]
  } | null>(null)

  const refresh = useCallback(
    async (manual = false) => {
      if (!conversationId || !window.api?.costBreakdown) return
      setLoading(true)
      if (manual) setManualError(false)
      try {
        const result = (await window.api.costBreakdown('actor', conversationId)) as
          CostRow[] | undefined
        // L'utilisateur a changé de fil pendant la requête : cette réponse n'est plus la sienne.
        if (filCourant.current !== conversationId) return
        setDonnees({ conversationId, rows: Array.isArray(result) ? result : [] })
        setManualError(false)
        try {
          const calls = await window.api?.promptCalls?.(conversationId)
          if (filCourant.current !== conversationId) return
          setPromptCalls({
            conversationId,
            calls: Array.isArray(calls) ? (calls as CompositionCallInput[]) : []
          })
        } catch {
          if (filCourant.current === conversationId) setPromptCalls({ conversationId, calls: [] })
        }
      } catch {
        // Un journal illisible ne doit pas casser le composeur : on garde le dernier total connu.
        if (manual) setManualError(true)
      } finally {
        setLoading(false)
      }
    },
    [conversationId]
  )

  /*
   * DEUX déclencheurs distincts, qui étaient confondus en un seul :
   * - à l'ARRIVÉE sur un fil, TOUJOURS — occupé ou non. L'ancien garde `if (busy) return` sautait ce
   *   chargement sur un fil qui travaille (mode auto, tour en cours) : la pastille gardait alors le
   *   total du fil précédent, soit exactement « même coût partout » sur un dossier où plusieurs fils
   *   tournent en même temps ;
   * - à la FIN d'un tour (busy repasse à false) : c'est là que le journal contient la dépense du tour.
   */
  useEffect(() => {
    // Chargement asynchrone déclenché par l'état externe du journal, pas état dérivé du rendu.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])
  const etaitOccupe = useRef(busy)
  useEffect(() => {
    const finDeTour = etaitOccupe.current === true && !busy
    etaitOccupe.current = busy
    if (finDeTour) void refresh()
  }, [busy, refresh])

  const open = openConversationId === conversationId
  // Des lignes d'un AUTRE fil ne s'affichent jamais — pas même le temps d'un chargement.
  const rows = donnees && donnees.conversationId === conversationId ? donnees.rows : []
  const summary = summarizeConversationCost(rows)
  // Rien dépensé = rien à dire. Afficher « 0 $ » laisserait croire à une mesure là où il n'y a
  // qu'un journal vide.
  if (summary.calls <= 0) return null
  const detail = spendingRows(rows)
  const composition = aggregatePromptComposition(
    promptCalls && promptCalls.conversationId === conversationId ? promptCalls.calls : []
  )
  const totalDuration = formatDuration(summary.durationMs)

  return (
    <div className="conv-cost" data-testid="conversation-cost">
      <button
        type="button"
        className={`conv-cost-btn${summary.rewritingContext ? ' warn' : ''}`}
        data-testid="conversation-cost-total"
        aria-expanded={open}
        onClick={() =>
          setOpenConversationId((id) => (id === conversationId ? null : (conversationId ?? null)))
        }
        title={
          summary.rewritingContext
            ? `${callsLabel(summary.calls)} · cache ${Math.round(summary.cacheHitRatio * 100)} %${cacheWriteHint(summary.cacheWriteTokens)} — le contexte est réécrit au lieu d’être relu`
            : `${callsLabel(summary.calls)} · cache ${Math.round(summary.cacheHitRatio * 100)} %${cacheWriteHint(summary.cacheWriteTokens)} · cliquer pour le détail`
        }
      >
        {summary.label}
        {summary.rewritingContext ? <span className="conv-cost-flag"> ⚠</span> : null}
      </button>
      {open && (
        <div className="conv-cost-panel" data-testid="conversation-cost-panel">
          <div className="conv-cost-head">
            <span>
              {callsLabel(summary.calls)} · cache {Math.round(summary.cacheHitRatio * 100)} %
              {totalDuration ? ` · ${totalDuration}` : ''}
            </span>
            <button
              type="button"
              className="conv-cost-refresh"
              onClick={() => void refresh(true)}
              disabled={loading}
            >
              {loading ? '…' : 'Actualiser'}
            </button>
          </div>
          {manualError && (
            <p className="conv-cost-warn" role="alert" data-testid="conversation-cost-error">
              L’actualisation a échoué (journal des coûts illisible) — le total affiché peut être
              périmé.
            </p>
          )}
          {summary.rewritingContext && (
            <p className="conv-cost-warn" data-testid="conversation-cost-warning">
              Le contexte est réécrit à chaque appel au lieu d’être relu depuis le cache — c’est ce
              qui fait grimper la facture.
            </p>
          )}
          <ul className="conv-cost-rows">
            {detail.map((row) => (
              <li key={row.key} data-testid={`conversation-cost-row-${row.key}`}>
                <span className="conv-cost-key">{row.key}</span>
                <span className="conv-cost-bar" aria-hidden="true">
                  <span style={{ width: `${sharePercent(row, summary.totalUsd)}%` }} />
                </span>
                <span className="conv-cost-amount">{costRowLabel(row)}</span>
                {/* Le poste le plus LENT n'est pas forcement le plus cher : les deux sont montres. */}
                <span className="conv-cost-time" data-testid={`conversation-time-${row.key}`}>
                  {formatDuration(row.durationMs ?? 0) ?? '—'}
                  {summary.durationMs > 0 && row.durationMs
                    ? ` · ${timeSharePercent(row, summary.durationMs)} %`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
          {composition.rows.length > 0 && (
            <div className="conv-cost-composition" data-testid="conversation-composition">
              <div className="conv-cost-head">
                <span>
                  Composition du prompt · {callsLabel(composition.calls)} ·{' '}
                  {Math.round(composition.totalChars / 1000)} kcar injectés
                </span>
              </div>
              <ul className="conv-cost-rows">
                {composition.rows.map((row) => (
                  <li
                    key={`${row.channel}:${row.name}`}
                    data-testid={`conversation-composition-row-${row.name}`}
                  >
                    <span className="conv-cost-key">
                      {row.name}
                      {row.channel === 'context' ? ' (contexte)' : ''}
                    </span>
                    <span className="conv-cost-bar" aria-hidden="true">
                      <span style={{ width: `${row.share}%` }} />
                    </span>
                    <span className="conv-cost-amount">
                      {row.kcharsPerCall} kcar/appel · {row.share} %
                    </span>
                    <span className="conv-cost-time">{callsLabel(row.calls)}</span>
                  </li>
                ))}
              </ul>
              <p className="conv-cost-note">
                Taille RÉELLE de chaque bloc injecté, additionnée sur les appels. « non attribué » =
                des caractères partis dans le prompt système qu’aucun bloc ne déclare. Pas de prix
                ici : le coût d’un bloc dépend du cache, il ne se déduit pas d’un nombre de
                caractères.
              </p>
            </div>
          )}
          <p className="conv-cost-note">
            Mesuré sur les journaux d’appels de cette conversation, sous-agents inclus. « — » =
            durée non enregistrée par la source, pas une opération instantanée.
          </p>
        </div>
      )}
    </div>
  )
}
