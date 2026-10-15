import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * CÂBLAGE — le tour de chat écrit dans la trace ce que l'arbre du panneau Détails doit montrer
 * (candidats du scout interne, 2026-10-12). Les événements eux-mêmes sont testés dans
 * `activity/chat-turn-trace.test.ts` ; ici, on vérifie qu'ils sont bien ÉMIS, au bon endroit :
 *  - la demande reçue AVANT le premier appel au modèle (sinon l'arbre montrait le tour précédent),
 *    jamais pour une reprise (son tour l'a déjà, et l'identifiant fixe ferait échouer l'écriture) ;
 *  - un geste fini de l'agent à chaque ligne d'état « X terminé - N s » ;
 *  - les deux en best-effort : une écriture d'observabilité ne casse jamais un tour.
 */
const source = readFileSync(join(__dirname, 'run-pilot-chat.ts'), 'utf8')

function bloc(debut: string, fin: string): string {
  const i = source.indexOf(debut)
  expect(i, `repère introuvable : ${debut}`).toBeGreaterThanOrEqual(0)
  const j = source.indexOf(fin, i)
  expect(j, `fin introuvable après : ${debut}`).toBeGreaterThan(i)
  return source.slice(i, j)
}

describe('run-pilot-chat écrit la demande reçue et les gestes de l’agent', () => {
  it('écrit la demande reçue au début du tour, hors reprise, sans casser le tour', () => {
    const demande = bloc('evenementDemandeRecue({', 'contenu: last.content')
    expect(demande).toContain('sequence: traceSequence')
    const garde = bloc('LA DEMANDE ENTRE DANS LA TRACE', 'evenementDemandeRecue({')
    expect(garde).toMatch(/!recovery && !continuation && last\?\.role === 'user'/)
    expect(garde).toContain('try {')
    // Avant le premier envoi au modèle : la demande est écrite avant que le pilote ne tourne.
    expect(source.indexOf('evenementDemandeRecue({')).toBeLessThan(
      source.indexOf("pilotEvent.kind === 'provider-status' && pilotEvent.text")
    )
  })

  it('écrit un geste de l’agent pour chaque ligne d’état de fin, avec un identifiant unique', () => {
    const geste = bloc(
      "if (pilotEvent.kind === 'provider-status' && pilotEvent.text) {",
      "if (pilotEvent.kind === 'think'"
    )
    expect(geste).toContain('gesteDeLaLigne(pilotEvent.text)')
    expect(geste).toContain('evenementGesteAgent({')
    expect(geste).toContain('id: `${turnId}:geste:${randomUUID()}`')
    expect(geste).toContain('try {')
    // Le détail (commande + retour) suit le geste dans la trace (2026-10-15).
    expect(geste).toContain('detail: pilotEvent.detail')
  })

  it('le pilote relaie le détail que l’adaptateur joint à la ligne de fin', () => {
    const pilote = readFileSync(join(__dirname, '..', 'agent-pilot.ts'), 'utf8')
    expect(pilote).toContain('...(chunk.statusDetail ? { detail: chunk.statusDetail } : {})')
  })

  it('ne pousse pas la sortie entière des outils dans le flux en direct', () => {
    const flux = bloc('const livePilotEvent = { ...pilotEvent }', "'pilot:event'")
    expect(flux).toContain('delete livePilotEvent.detail')
  })
})
