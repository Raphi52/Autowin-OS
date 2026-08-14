import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bundledSkillsRoot, listNativeRegistry } from './native-registry'
import { invokedSkillId, skillInstruction } from './skill-pipeline'

/**
 * SAVE et LOAD — l'empreinte d'un dépôt, écrite dans le Brain puis rechargée.
 *
 * Ce fichier vérifie la seule chose qu'un `SKILL.md` ne prouve pas tout seul : qu'il est ATTEIGNABLE.
 * Le piège est connu de ce dépôt — une capacité présente en fichier, jamais invoquée, qui passe pour
 * livrée pendant des semaines. Un skill déposé sans être découvert par le registre, ou dont le corps
 * ne se charge pas, est exactement ce cas : le fichier existe, et rien ne l'exécute jamais.
 */
const SKILLS = ['save', 'load'] as const

describe('skills save/load — présentes, découvertes, invocables', () => {
  it.each(SKILLS)('%s est livrée dans le dépôt', (id) => {
    const racine = bundledSkillsRoot()
    expect(racine).toBeTruthy()
    expect(existsSync(join(racine!, id, 'SKILL.md'))).toBe(true)
  })

  it.each(SKILLS)('%s est DÉCOUVERTE par le registre des capacités', (id) => {
    // Sans cette découverte, la skill n'apparaît nulle part dans l'app : ni activable, ni listée.
    expect(listNativeRegistry('skills').map((s) => s.id)).toContain(id)
  })

  it.each(SKILLS)('le corps de %s se CHARGE, et n’est pas vide', (id) => {
    // `skillInstruction` rend '' quand rien n'est trouvé : un retour vide passerait inaperçu au
    // runtime — la phase s'injecterait sans consigne, et le modèle improviserait.
    const corps = skillInstruction(id)
    expect(corps.length).toBeGreaterThan(500)
    expect(corps).toContain(id.toUpperCase())
  })

  it.each(SKILLS)('/%s est reconnue comme invocation en tête de message', (id) => {
    expect(invokedSkillId(`/${id}`)).toBe(id)
    expect(invokedSkillId(`/${id} le dépôt courant`)).toBe(id)
    // Une mention au fil du texte n'est PAS une invocation : sinon en parler coûterait son corps.
    expect(invokedSkillId(`pense à lancer /${id} plus tard`)).toBeUndefined()
  })

  const corpsDe = (id: string): string =>
    readFileSync(join(bundledSkillsRoot()!, id, 'SKILL.md'), 'utf8')

  it('save nomme les commandes qu’elle utilise VRAIMENT', () => {
    // Une consigne qui invoque un outil inexistant produit un tour perdu et un message d'erreur
    // incompréhensible. `remember` et `brain_query` sont au catalogue ; l'empreinte n'invente rien.
    const save = corpsDe('save')
    expect(save).toContain('remember(')
    expect(save).toContain('brain_query')
    // La forme d'ancrage est celle que le Brain accepte réellement : un `file:` relatif est refusé.
    expect(save).toMatch(/git:<chemin>@<sha>/)
  })

  it('save impose la RELECTURE avant écriture — c’est ce qui évite les doublons', () => {
    const save = corpsDe('save')
    expect(save).toMatch(/brain_query[\s\S]{0,400}avant/i)
    expect(save.toLowerCase()).toContain('doublon')
  })

  it('load refuse de FABRIQUER une empreinte absente', () => {
    // Le vrai risque de `load` : combler le vide en lisant le dépôt à la volée, et rendre un résumé
    // non vérifié indiscernable d'un savoir capitalisé.
    const load = corpsDe('load')
    expect(load).toMatch(/AUCUNE empreinte/i)
    expect(load.toLowerCase()).toContain('/save')
  })

  it('load date ce qu’il charge, au lieu de le présenter comme actuel', () => {
    // Un savoir daté cité comme courant est ce qui fait perdre des heures sur un fichier déplacé.
    const load = corpsDe('load')
    expect(load).toContain('HEAD')
    expect(load.toLowerCase()).toMatch(/sha différent|écart/)
  })
})
