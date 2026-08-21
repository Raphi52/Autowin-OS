import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PIPELINE_PHASES } from '../shared/pipeline-phases'
import { routeSkillRequest } from './skill-routing'
import { skillInstruction } from './skill-pipeline'

/**
 * AUCUNE phase canonique n'est INATTEIGNABLE — l'invariant que trois listes divergentes menaçaient.
 *
 * `shared/pipeline-phases.ts` a été créé pour qu'il n'existe qu'UNE liste de phases : son en-tête
 * raconte qu'une copie périmée faisait afficher « Remake injouable » par l'onglet Workflows, et il
 * promettait que « si quelqu'un l'oublie, le typage le lui dira ». Le typage ne le dit pas : une
 * expression régulière littérale et un `Set` de chaînes lui échappent complètement.
 *
 * Ce test n'exige PAS que toute phase soit routée comme phase — ce serait imposer un mécanisme.
 * `remake` est atteint par une autre voie, DÉLIBÉRÉMENT : son corps de skill est injecté dans la
 * conversation, parce que `remake` PILOTE le pipeline au lieu d'en occuper une étape. Exiger le
 * routage l'aurait cassé (vérifié : `skill-invocation.test.ts` passe au rouge).
 *
 * Ce qui compte, et que ce test garde, c'est qu'une phase déclarée soit ATTEIGNABLE par au moins une
 * voie. Une phase que l'application liste, documente et n'atteint par aucun chemin est une étiquette
 * qui ment — c'est exactement le défaut d'origine.
 */
describe('aucune phase canonique n est inatteignable', () => {
  it.each([...PIPELINE_PHASES])('/%s est atteignable par au moins une voie', (phase) => {
    const routee = routeSkillRequest(`/${phase} ameliorer la vue Accueil`)?.explicitPhase === phase
    const corpsInjectable = skillInstruction(phase).length > 0
    expect(
      routee || corpsInjectable,
      `/${phase} n'est ni routee comme phase ni porteuse d'un corps de skill : ` +
        `l'application la declare sans pouvoir l'atteindre`
    ).toBe(true)
  })

  it('n invente pas de phase pour une commande inconnue', () => {
    for (const inconnu of ['/inconnu quelque chose', '/scoute', '/buildx']) {
      expect(routeSkillRequest(inconnu)?.explicitPhase).toBeUndefined()
    }
  })

  it('ne route pas une phase mentionnee AU FIL du texte', () => {
    expect(
      routeSkillRequest('regarde ce que /build ferait ici quand tu auras le temps')?.explicitPhase
    ).toBeUndefined()
  })
})

describe('la liste des phases acceptees par le modele est DERIVEE, pas recopiee', () => {
  it('ORCHESTRATE_PHASES se construit depuis PIPELINE_PHASES', () => {
    const source = readFileSync(join(__dirname, 'commands.ts'), 'utf8')
    const declaration = source.slice(source.indexOf('const ORCHESTRATE_PHASES'))
    const corps = declaration.slice(0, declaration.indexOf('\n\n'))
    expect(corps).toContain('PIPELINE_PHASES')
    // La récidive est attrapée AVANT qu'elle ne divergе : une liste recopiée passe le jour où on
    // l'écrit, et échoue silencieusement des semaines plus tard, à la phase suivante. C'est
    // exactement ce qui s'est produit deux fois.
    for (const phase of PIPELINE_PHASES) {
      expect(corps).not.toContain(`'${phase}'`)
    }
  })
})
