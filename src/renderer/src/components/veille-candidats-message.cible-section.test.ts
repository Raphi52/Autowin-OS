import { describe, expect, it } from 'vitest'
import { selectionAutoDepuisScout } from './veille-candidats-message'

// conv-690, saisie ts 1789715005953 : le scout avait choisi « la piste 1 », 5 candidats sur 5 sont partis.
const texte = [
  '## Cible',
  'La piste 1 : une ligne `CIBLES:` n’est pas reconnue. Règle de `skills/scout/SKILL.md` l.54-62.',
  '',
  '| Score | Type | What | Why | How |',
  '|---|---|---|---|---|',
  '| 72 | fix | a | l.2 et l.3 | x |',
  '| 65 | fix | b | voir 4 | y |',
  '| 50 | fix | c | 5 | z |'
].join('\n')
const candidats = ['a', 'b', 'c', 'd', 'e'].map((t) => ({ titre: `candidat ${t}` }))

describe('section ## Cible suivie du tableau', () => {
  it('ne lit que la prose de la section, pas le tableau qui la suit', () => {
    expect([...(selectionAutoDepuisScout(candidats, texte) ?? [])]).toEqual([0])
  })
})
