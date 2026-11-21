import { describe, expect, it } from 'vitest'
import { jouerLaRouteSansModele } from './route-directe'
import type { ExecutionDeCommande } from './commandes-du-tour'
import type { PilotEventVariant } from './evenements'

/**
 * LA CARTE D'UNE PHASE NOMMÉE AVANCE COMME CELLE D'UN TOUR ORDINAIRE.
 *
 * Un message qui commence par « /build » (tous les lots d'un plan) part droit à l'orchestration,
 * sans modèle. Ce chemin lançait le travail sans relais de progression : la carte « Orchestration »
 * restait des heures sur « Travail lancé : … », sans durée ni dernier geste, alors que le run
 * travaillait (relevé du 21/11 : un tour de 4 h 30 sans une seule ligne `action-progress` dans son
 * journal). Le tour ordinaire, lui, relaie chaque battement (`execution-des-commandes.ts`).
 */
function rejouer(execCommand: ExecutionDeCommande): Promise<PilotEventVariant[]> {
  const emis: PilotEventVariant[] = []
  return jouerLaRouteSansModele({
    deuxLecturesDuTour: async () => undefined,
    fermerSurLaQuestionDesLectures: async () => undefined,
    annoncerLaLectureRetenue: () => undefined,
    tache: '/build fais X',
    emit: (e) => emis.push(e),
    signal: undefined,
    execCommand,
    drainDirectives: undefined,
    conversationId: undefined,
    deposerCompteRendu: () => undefined
  } as unknown as Parameters<typeof jouerLaRouteSansModele>[0]).then(() => emis)
}

describe('route sans modèle — battement de l’orchestration', () => {
  it('relaie chaque battement du run sur la carte qu’elle a posée', async () => {
    const emis = await rejouer(async (_nom, _args, onProgress) => {
      onProgress?.('12 s · build · Bash · dotnet build')
      onProgress?.('27 s · build · Read · Applicateur.cs')
      return { ok: true, data: { status: 'succeeded' } }
    })
    const commande = emis.find((e) => e.kind === 'command')
    expect(commande).toMatchObject({ actionId: 'route:0', name: 'orchestrate' })
    expect(emis.filter((e) => e.kind === 'action-progress')).toEqual([
      { kind: 'action-progress', actionId: 'route:0', text: '12 s · build · Bash · dotnet build' },
      { kind: 'action-progress', actionId: 'route:0', text: '27 s · build · Read · Applicateur.cs' }
    ])
    // Les battements tombent ENTRE la pose de la carte et son issue.
    const kinds = emis.map((e) => e.kind)
    expect(kinds.indexOf('command')).toBeLessThan(kinds.indexOf('action-progress'))
    expect(kinds.lastIndexOf('action-progress')).toBeLessThan(kinds.indexOf('result'))
  })
})
