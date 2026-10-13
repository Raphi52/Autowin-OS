import { useEffect, useState } from 'react'
import type { RunClosureObservation } from '../../../shared/run-execution'
import type { RunEntry } from './chat-view-types'
import { RunBilanCard } from './RunBilanCard'
import { bilanDepuisCloture, lireVerdictDuJuge, type VerdictDuJuge } from './run-bilan'
import { libelleRun } from './run-label'
import './RunBilanCard.css'
import './BilanDeCloture.css'

/**
 * LE BILAN DU RUN, SOUS LE NŒUD « CLÔTURE DU RUN » (demande du 2026-10-13).
 *
 * Ce nœud ouvrait `SourceControlPane` — les fichiers modifiés par la CONVERSATION, exactement ce
 * que montre l'onglet Files —, vestige du temps où le graphe avait remplacé l'onglet Source control
 * (commit 8bf3695f). Il dit maintenant ce que le RUN a donné : son verdict, les raisons de
 * l'acceptation ou du refus, sa durée et son coût, et ouvre son RUN.md.
 *
 * Sources, toutes écrites par l'app, rien n'est déduit :
 * - la clôture de la trace (`RunClosureObservation`) : statut, durée, coût, motifs du contrôle final ;
 * - le DERNIER verdict rendu par le juge, relu au clic (`causalTraceCharges`) : l'arbre ne reçoit
 *   jamais le texte des réponses ;
 * - `closure.runPath` pour le RUN.md. Absent sur les runs clos avant que la trace garde ce lien :
 *   le bilan le DIT au lieu d'apparier par date ou par sujet.
 */
export function BilanDeCloture({
  conversationId,
  closure,
  verdictEventIds,
  runId,
  runs,
  onOuvrirRunMd
}: {
  conversationId?: string
  closure: RunClosureObservation
  verdictEventIds?: string[]
  runId?: string
  runs: readonly RunEntry[]
  onOuvrirRunMd: (run: RunEntry) => void
}): React.JSX.Element {
  const dernierVerdictId = verdictEventIds?.at(-1)
  const verdict = useDernierVerdict(conversationId, dernierVerdictId)
  const runMd = closure.runPath
    ? runs.find((r) => cheminComparable(r.path) === cheminComparable(closure.runPath!))
    : undefined
  const titre = runMd
    ? libelleRun(runMd.subject)
    : closure.runPath
      ? libelleRun(sujetDuChemin(closure.runPath))
      : runId
        ? `Run ${runId}`
        : undefined
  const motifs = (closure.gateReasons ?? []).filter((motif) => motif.trim())
  const ouvert = closure.status === 'open'

  return (
    <section className="bilan-cloture" data-bilan-cloture data-statut={closure.status}>
      <RunBilanCard
        bilan={bilanDepuisCloture(closure, {
          titre,
          passagesDuJuge: verdictEventIds?.length
        })}
      />

      <div className="bilan-cloture__bloc" data-bilan-raisons>
        <span className="bilan-cloture__kicker">
          {ouvert
            ? 'Pas encore de verdict'
            : closure.status === 'green'
              ? 'Pourquoi accepté'
              : 'Pourquoi refusé'}
        </span>
        {ouvert && (
          <p className="bilan-cloture__note">
            Le run <b>n’est pas encore clos</b> : ni durée ni coût ne sont mesurés, et aucun verdict
            final n’est écrit.
          </p>
        )}
        {motifs.length > 0 && (
          <ul className="bilan-cloture__motifs" data-bilan-motifs>
            {motifs.map((motif, index) => (
              <li key={index}>{motif}</li>
            ))}
          </ul>
        )}
        <VerdictDuJugeAffiche etat={verdict} ouvert={ouvert} />
        {!ouvert && motifs.length === 0 && !dernierVerdictId && (
          <p className="bilan-cloture__note">
            {closure.status === 'green'
              ? 'Le contrôle final n’a relevé aucun motif de refus, et aucun verdict de juge n’est écrit pour ce run.'
              : 'Aucun motif n’est écrit dans la trace pour ce refus : le RUN.md peut en dire plus.'}
          </p>
        )}
      </div>

      <div className="bilan-cloture__bloc" data-bilan-runmd>
        <span className="bilan-cloture__kicker">RUN.md</span>
        {runMd ? (
          <button
            type="button"
            className="bilan-cloture__ouvrir"
            data-bilan-ouvrir-runmd
            onClick={() => onOuvrirRunMd(runMd)}
            title={runMd.path}
          >
            Ouvrir le RUN.md de ce run
          </button>
        ) : closure.runPath ? (
          <p className="bilan-cloture__note">
            <code className="bilan-cloture__chemin">{closure.runPath}</code>
            <br />
            Ce fichier n’est pas dans la liste des runs de cette conversation (déplacé ou supprimé).
          </p>
        ) : (
          <p className="bilan-cloture__note">
            Ce run a été clos <b>avant</b> que la trace garde le chemin de son RUN.md : il se
            retrouve par son sujet dans l’onglet Runs.
          </p>
        )}
      </div>
    </section>
  )
}

type EtatVerdict =
  | { etat: 'aucun' }
  | { etat: 'chargement' }
  | { etat: 'lu'; verdict: VerdictDuJuge }
  | { etat: 'illisible'; raison: string }

function VerdictDuJugeAffiche({
  etat,
  ouvert
}: {
  etat: EtatVerdict
  ouvert: boolean
}): React.JSX.Element | null {
  if (etat.etat === 'aucun') return null
  if (etat.etat === 'chargement') {
    return <p className="bilan-cloture__note">Lecture du verdict du juge…</p>
  }
  if (etat.etat === 'illisible') {
    return (
      <p className="bilan-cloture__note" data-bilan-juge="illisible">
        Verdict du juge illisible · {etat.raison}
      </p>
    )
  }
  const { verdict } = etat
  return (
    <div className="bilan-cloture__juge" data-bilan-juge={verdict.valide ? 'valide' : 'defaut'}>
      <p className="bilan-cloture__conclusion">
        <span className="bilan-cloture__qui">
          {ouvert ? 'Dernier passage du juge' : 'Verdict final du juge'}
        </span>{' '}
        <b>{verdict.conclusion}</b>
        {verdict.score !== undefined && (
          <span className="bilan-cloture__score"> · score {verdict.score}/100</span>
        )}
      </p>
      {verdict.puces.length > 0 && (
        <ul className="bilan-cloture__puces">
          {verdict.puces.map((puce, index) => (
            <li key={index} data-gravite={puce.gravite ?? 'sans'}>
              {puce.gravite && <span className="bilan-cloture__gravite">{puce.gravite}</span>}
              {puce.texte}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Relit la réponse du juge pour CE verdict seulement. La trace est en ajout seul : un même
 * identifiant rend toujours le même texte, donc on ne relit qu'au changement d'identifiant.
 */
function useDernierVerdict(
  conversationId: string | undefined,
  eventId: string | undefined
): EtatVerdict {
  const cle = conversationId && eventId ? `${conversationId}\n${eventId}` : null
  const [lu, setLu] = useState<{ cle: string; etat: EtatVerdict } | null>(null)
  useEffect(() => {
    if (!cle || typeof window.api?.causalTraceCharges !== 'function') return
    const [conversation, id] = cle.split('\n')
    let vivant = true
    window.api
      .causalTraceCharges(conversation, [id], ['model-response'])
      .then((parEvenement) => {
        const texte = (parEvenement[id] ?? [])
          .filter((charge) => charge.kind === 'model-response')
          .map((charge) => charge.content)
          .join('\n')
        const verdict = lireVerdictDuJuge(texte)
        if (vivant)
          setLu({
            cle,
            etat: verdict
              ? { etat: 'lu', verdict }
              : { etat: 'illisible', raison: 'aucune ligne VALIDE ou DEFAUT dans sa réponse' }
          })
      })
      .catch((raison: unknown) => {
        if (vivant)
          setLu({
            cle,
            etat: {
              etat: 'illisible',
              raison: raison instanceof Error ? raison.message : String(raison)
            }
          })
      })
    return () => {
      vivant = false
    }
  }, [cle])
  if (!cle || typeof window.api?.causalTraceCharges !== 'function') return { etat: 'aucun' }
  return lu?.cle === cle ? lu.etat : { etat: 'chargement' }
}

function cheminComparable(chemin: string): string {
  return chemin.replace(/\\/g, '/').toLowerCase()
}

/** `…/runs/conv-9/corrige-le-bouton-mv6h34eh-workspace/RUN.md` → `corrige-le-bouton-mv6h34eh`. */
function sujetDuChemin(chemin: string): string {
  const morceaux = chemin.replace(/\\/g, '/').split('/')
  return (morceaux.at(-2) ?? chemin).replace(/-workspace$/, '')
}
