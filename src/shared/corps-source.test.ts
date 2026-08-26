import { describe, expect, it } from 'vitest'
import { corpsDeBloc } from './corps-source'

/**
 * Trois gardes du depot etaient ROUGES le 2026-08-26 alors que le code garde etait INTACT : tous
 * decoupaient la source sur une borne fragile (une fenetre de 900 caracteres, un repere interieur
 * a la fonction). La borne doit suivre la STRUCTURE, pas un compte d'octets.
 */
describe('corpsDeBloc — la borne suit les accolades', () => {
  const source = [
    'const avant = () => { return 1 }',
    'const cible = () => {',
    '  // un commentaire long qui pousse le contenu plus loin',
    '  if (x) {',
    '    appelAttendu()',
    '  }',
    '  return 2',
    '}',
    'const apres = () => { interdit() }'
  ].join('\n')

  it('rend le bloc ENTIER, imbrications comprises', () => {
    const bloc = corpsDeBloc(source, 'const cible')

    expect(bloc).toContain('appelAttendu()')
    expect(bloc).toContain('return 2')
  })

  it('ne déborde PAS sur ce qui suit', () => {
    // L'entree qui ferait echouer un comptage d'accolades casse : `apres` ne doit jamais entrer.
    expect(corpsDeBloc(source, 'const cible')).not.toContain('interdit()')
  })

  it('ne commence pas avant l’ancre', () => {
    expect(corpsDeBloc(source, 'const cible')).not.toContain('const avant')
  })

  it('ancre introuvable : rend une chaîne vide, pas la source entière', () => {
    // Rendre TOUTE la source ferait passer n'importe quel `toContain` — un garde qui ne garde rien.
    expect(corpsDeBloc(source, 'const inexistant')).toBe('')
  })
})
