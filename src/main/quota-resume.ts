import { readQuotaReset } from './quota-reset'
import type { ScheduledTaskInput } from './task-manager/types'

/**
 * REPRENDRE quand le quota revient — sans jamais sonder.
 *
 * Aujourd'hui, un mur de quota tient toute la session : `providers/registry.ts` refuse de re-tester
 * periodiquement, et il a raison (« re-tester si le quota est revenu COUTERAIT du quota »). Le prix
 * de cette prudence est paye par l'utilisateur : le travail s'arrete, et c'est lui qui doit se
 * souvenir de revenir, puis relancer l'application.
 *
 * Ce module supprime ce prix sans lever la prudence : le refus ANNONCE son heure de retour
 * (`quota-reset.ts` la lit), donc on n'a rien a sonder — il suffit d'attendre l'heure dite.
 *
 * Le vehicule est une TACHE PLANIFIEE ordinaire, et c'est deliberé :
 *  - elle SURVIT a la fermeture de l'application, contrairement a un minuteur en memoire — or un mur
 *    de quota est precisement le moment ou on ferme l'app et on va faire autre chose ;
 *  - elle est VISIBLE dans le Task Manager, donc l'utilisateur voit qu'une reprise est armee, a
 *    quelle heure, et peut l'annuler. Un reveil invisible qui repart seul dans une conversation
 *    serait une surprise, pas un service ;
 *  - elle reutilise un chemin d'execution deja eprouve au lieu d'en ouvrir un second.
 *
 * Une seule occurrence : `recurrence: none`. Un quota epuise n'est pas un evenement recurrent, et une
 * tache qui se rejouerait chaque jour a la meme heure relancerait un travail que personne n'a demande.
 */

export interface QuotaResumePlan {
  task: ScheduledTaskInput
  /** Instant du reveil, pour le journaliser et l'annoncer a l'utilisateur. */
  at: number
  /** Ce qui a permis de lire l'heure — cite dans le prompt pour que la reprise soit explicable. */
  source: string
}

function isoDateParts(at: number, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(at))
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00'
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    // `en-CA` rend 24 pour minuit : `StructuredSchedule` attend `00`.
    time: `${value('hour') === '24' ? '00' : value('hour')}:${value('minute')}`
  }
}

/**
 * Prepare la reprise, ou rend `undefined` s'il n'y a rien a armer.
 *
 * Rend `undefined` quand le refus n'annonce PAS d'heure (cas reel : « reached your Fable 5 limit »).
 * Armer une reprise a une heure inventee serait nuisible : l'agent se reveillerait sur un mur encore
 * debout, brulerait un appel pour le decouvrir, et il faudrait tout recommencer.
 */
export function planQuotaResume(input: {
  conversationId: string
  reason: string
  now: number
  timeZone: string
  /** Ce que l'utilisateur faisait, pour que la reprise sache a quoi elle revient. */
  interrupted?: string
}): QuotaResumePlan | undefined {
  const read = readQuotaReset(input.reason, input.now)
  if (!read) return undefined
  if (!input.conversationId.trim()) return undefined

  const { date, time } = isoDateParts(read.at, input.timeZone)
  const quand = new Intl.DateTimeFormat('fr-FR', {
    timeZone: input.timeZone,
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(read.at))

  return {
    at: read.at,
    source: read.source,
    task: {
      title: `Reprise après quota — ${quand}`,
      prompt: [
        `Le quota était épuisé et il vient de revenir (retour annoncé pour ${quand}, lu dans le`,
        `refus du provider via \`${read.source}\`). Reprends le travail interrompu.`,
        '',
        ...(input.interrupted?.trim()
          ? ['Ce qui était en cours :', input.interrupted.trim(), '']
          : []),
        'Commence par établir où en était le travail — relis les derniers messages de cette',
        "conversation plutôt que de repartir d'une page blanche. Si le quota n'est en réalité pas",
        'revenu, dis-le et arrête-toi : ne relance pas une série d’appels contre un mur encore debout.'
      ].join('\n'),
      enabled: true,
      // La reprise n'a de sens que si l'application tourne : elle reprend une conversation OUVERTE.
      mode: 'active-only',
      destination: { kind: 'existing', conversationId: input.conversationId },
      schedule: {
        startDate: date,
        time,
        timeZone: input.timeZone,
        // UNE fois. Un quota épuisé n'est pas un rendez-vous quotidien.
        recurrence: { unit: 'none', interval: 1 }
      }
    }
  }
}
