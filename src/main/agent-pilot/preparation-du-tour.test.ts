import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as aides from './aides-du-tour'
import * as commandes from './commandes-du-tour'
import * as emission from './emission-du-tour'
import * as lectures from './lectures-du-tour'
import * as message from './message-du-tour'
import * as pieces from './pieces-jointes-du-fil'
import * as route from './route-directe'
import * as session from './session-du-tour'
import * as systeme from './systeme-du-tour'

/**
 * La PRÉPARATION du tour — tout ce que `AgentPilot.chat()` faisait avant sa boucle d'itérations —
 * vit dans `agent-pilot/*.ts` depuis conv-1580 (lot 2) ; `chat()` n'en garde que les appels.
 *
 * Le défaut que le typage et les tests de comportement ne voient pas : une COPIE du bloc laissée
 * dans `chat()` à côté de l'appel au module. Le tour marche, puis le correctif suivant n'est fait
 * que d'un côté. Entrée qui fait échouer ce test : `const systemPartsAvec = (` encore écrit dans
 * `agent-pilot.ts` (ou n'importe quelle autre ligne-repère ci-dessous), ou la fonction absente de
 * son module.
 */
const DEPLACES: Array<[string, Record<string, unknown>, string, string]> = [
  [
    'emission-du-tour.ts',
    emission,
    'emetteurDuTour',
    'const emit = (e: PilotEventVariant): void => {'
  ],
  ['commandes-du-tour.ts', commandes, 'commandesDuTour', 'const execCommandTolerante = async ('],
  ['lectures-du-tour.ts', lectures, 'lecturesDuTour', 'const deuxLecturesDuTour = ('],
  [
    'route-directe.ts',
    route,
    'jouerLaRouteSansModele',
    "emit({ kind: 'command', actionId, name: 'orchestrate', args })"
  ],
  ['systeme-du-tour.ts', systeme, 'systemeDuTour', 'const systemPartsAvec = ('],
  ['session-du-tour.ts', session, 'sessionDuTour', 'const cleDeSession = ('],
  ['message-du-tour.ts', message, 'messageDuTour', 'const partiesDuMessage = {'],
  ['pieces-jointes-du-fil.ts', pieces, 'piecesJointesDuFil', 'const MAX_PIECES_JOINTES_DU_FIL = 8']
]

const lire = (chemin: string): string => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')

describe('préparation du tour sortie de chat() (conv-1580, lot 2)', () => {
  const pilote = lire(join(__dirname, '..', 'agent-pilot.ts'))

  it.each(DEPLACES)(
    '%s porte %s, et chat() n’en garde aucune copie',
    (fichier, module, nom, repere) => {
      expect(typeof module[nom], `${nom} absent de ${fichier}`).toBe('function')
      expect(lire(join(__dirname, fichier)), `repère absent de ${fichier}`).toContain(repere)
      expect(pilote, `copie laissée dans agent-pilot.ts : ${repere}`).not.toContain(repere)
    }
  )

  it('les motifs de rallonge du cap ont un seul type, dans aides-du-tour.ts', () => {
    expect(lire(join(__dirname, 'aides-du-tour.ts'))).toContain('export type MotifDeRallonge =')
    expect(aides.CAP_ITERATIONS_TOUR).toBe(Number.POSITIVE_INFINITY)
    // L'union écrite deux fois dans chat() (tableau + paramètre) : une seule source désormais.
    expect(pilote).not.toContain("| 'bloc-visuel-non-ferme'")
  })
})
