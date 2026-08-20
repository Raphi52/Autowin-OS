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
const SKILLS = ['learn', 'think'] as const

describe('skills learn/think — présentes, découvertes, invocables', () => {
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

  it('learn nomme les commandes qu’elle utilise VRAIMENT', () => {
    // Une consigne qui invoque un outil inexistant produit un tour perdu et un message d'erreur
    // incompréhensible. `remember` et `brain_query` sont au catalogue ; l'empreinte n'invente rien.
    const learn = corpsDe('learn')
    expect(learn).toContain('remember(')
    expect(learn).toContain('brain_query')
    // La forme d'ancrage est celle que le Brain accepte réellement : un `file:` relatif est refusé.
    expect(learn).toMatch(/git:<chemin>@<sha>/)
  })

  it('learn impose la RELECTURE avant écriture — c’est ce qui évite les doublons', () => {
    const learn = corpsDe('learn')
    expect(learn).toMatch(/brain_query[\s\S]{0,400}avant/i)
    expect(learn.toLowerCase()).toContain('doublon')
  })

  it('think n’invente rien : il sépare ce qu’il a LU de ce qu’il déduit', () => {
    /**
     * Le risque de `think` n'a pas changé avec sa redéfinition (2026-08-20, de « charger l'empreinte
     * du dépôt » à « réunir ce que la tâche exige ») : rendre un savoir SUPPOSÉ sous les apparences
     * d'un savoir ÉTABLI. C'est le defaut le plus couteux de cette etape — il traverse toutes les
     * phases suivantes sans jamais etre requestionne. Le test suit la garantie, pas la formulation.
     */
    const think = corpsDe('think')
    expect(think.toLowerCase()).toContain('établi')
    expect(think.toLowerCase()).toContain('supposé')
    expect(think).toMatch(/n'invente rien|n’invente rien/i)
  })

  it('think nomme ce qu’il n’a PAS trouvé — une couverture partielle passe sinon pour complète', () => {
    const think = corpsDe('think')
    expect(think.toLowerCase()).toContain('trou')
  })

  it('think reste borné à la tâche, et le dit', () => {
    // Son mode d'echec est le deballage : un contexte qui remplit la fenetre avant le premier geste
    // a depense exactement ce qu'il pretendait economiser.
    const think = corpsDe('think')
    expect(think.toLowerCase()).toContain('tâche')
    expect(think).toMatch(/scout/i)
    expect(think).toMatch(/frame/i)
  })


  it('learn dit OU est sa matiere — sinon il refuse sur une premisse fausse', () => {
    /**
     * Mesure du 2026-08-20, run reel `conv-1339` : le nœud `learn` a ecrit « je n'ai ni diff, ni
     * fichier a ancrer » alors que son contexte contenait 3969 caracteres incluant le chemin exact
     * du fichier touche ET le diff complet, prefixes `[phase build]`. Un refus rigoureux applique a
     * une premisse fausse est le pire des refus : il a l'air d'une preuve de serieux.
     *
     * La skill ne disait nulle part d'ou vient sa matiere. Un agent de phase n'a pas vecu le
     * travail : son unique source est ce qui lui est transmis.
     */
    const learn = corpsDe('learn')
    expect(learn).toMatch(/\[phase/)
    expect(learn.toLowerCase()).toContain('matière')
  })

  it('learn n abandonne pas la capitalisation pour un SHA manquant', () => {
    // `session:current` est la forme PREVUE pour un run et vaut ancrage : renoncer parce que le SHA
    // n'est pas a portee jette ce que la tache a coute pour un detail rattrapable.
    const learn = corpsDe('learn')
    expect(learn).toContain('session:current')
    expect(learn.toLowerCase()).toMatch(/pas de ne pas avoir le sha|sha manquant/)
  })

  it('think date ce qu’il charge, au lieu de le présenter comme actuel', () => {
    // Un savoir daté cité comme courant est ce qui fait perdre des heures sur un fichier déplacé.
    const think = corpsDe('think')
    expect(think).toContain('HEAD')
    expect(think.toLowerCase()).toMatch(/sha différent|écart/)
  })
})
