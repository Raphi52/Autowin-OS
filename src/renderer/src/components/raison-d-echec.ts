import { sensDuCodeDeBlocage } from '../../../shared/raison-de-blocage'
import type { RunClosureObservation, RunGitObservation } from '../../../shared/run-execution'
import { texteChatExecution as t } from '../textes-ecrans/chat-execution'

/**
 * POURQUOI UNE ÉTAPE ROUGE DU GRAPHE A ÉCHOUÉ (demande du 2026-10-15, conv-966 : « fais que chaque
 * étape rouge du graphe dise pourquoi elle a échoué »).
 *
 * Mesuré le 2026-10-15 sur les 67 traces du poste : 74 étapes rouges, dont l'orchestrateur, la
 * demande, la phase, la clôture du run et Git du run, rouges sans aucune raison alors que la trace
 * la portait ailleurs (l'« Erreur » voisine, le sous-agent de la phase, le code de blocage Git). Ces
 * fonctions ne fabriquent rien : elles reprennent une cause écrite, et le DISENT quand il n'y en a
 * aucune.
 */

/** Au-delà, une sortie git entière rendrait la ligne illisible ; le détail reste au clic. */
const CAUSE_MAX = 300
const FICHIERS_NOMMES = 3

function borne(texte: string): string {
  return texte.length > CAUSE_MAX ? `${texte.slice(0, CAUSE_MAX - 1)}…` : texte
}

/**
 * Pourquoi Git n'a pas publié le travail du run. Une cause observée (`detail`) passe avant la
 * traduction du code ; le code inconnu reste nommé plutôt que tu.
 */
export function raisonDuGit(git: RunGitObservation | undefined): string | undefined {
  if (!git || (git.outcome !== 'blocked' && git.outcome !== 'conflict')) return undefined
  const observee = git.detail?.trim()
  const traduite =
    git.outcome === 'conflict' ? t('echec.git.conflit') : sensDuCodeDeBlocage(git.reason)
  const cause =
    observee ||
    traduite ||
    (git.reason?.trim()
      ? t('echec.git.blocage', { raison: git.reason.trim() })
      : t('echec.git.sans-cause'))
  const fichiers = git.files ?? []
  const nommes = fichiers.slice(0, FICHIERS_NOMMES)
  const reste = fichiers.length - nommes.length
  const enCause =
    nommes.length > 0
      ? t('echec.git.fichiers', {
          fichiers: `${nommes.join(', ')}${reste > 0 ? ` (+${reste})` : ''}`
        })
      : ''
  return `${t('echec.git.non-publie', { cause: borne(cause) })}${enCause}`
}

/**
 * Pourquoi la clôture du run est rouge. Les raisons du contrôle final d'abord ; sans elles (run
 * arrêté AVANT le contrôle final, par exemple sur un quota), la publication refusée, puis l'étape en
 * échec qui l'a arrêté.
 */
export function raisonDeLaCloture(
  closure: RunClosureObservation | undefined,
  causes: { git?: string; etapeEnEchec?: string; etapeArreteeParStop?: string }
): string | undefined {
  if (closure?.status !== 'red') return undefined
  const motifs = (closure.gateReasons ?? []).map((motif) => motif.trim()).filter(Boolean)
  if (motifs.length > 0) return borne(motifs.join(' · '))
  if (causes.git) return causes.git
  if (causes.etapeEnEchec) return t('echec.cloture.avant-controle', { etape: causes.etapeEnEchec })
  // Aucune étape en échec, mais une étape annulée : c'est le Stop qui a arrêté le run (conv-966).
  if (causes.etapeArreteeParStop)
    return t('echec.cloture.stop', { etape: causes.etapeArreteeParStop })
  return t('echec.cloture.sans-raison')
}

/** La cause d'une étape en échec, préfixée de son nom : « Sous-agent · clean : quota atteint ». */
export function causeNommee(titre: string | undefined, cause: string | undefined): string {
  const nom = titre?.trim()
  if (!cause?.trim()) return t('echec.etape.sans-cause', { nom: nom || t('echec.etape.une-etape') })
  return nom ? t('echec.etape.cause', { nom, cause: cause.trim() }) : cause.trim()
}
