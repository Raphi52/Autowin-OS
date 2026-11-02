import { describe, expect, it } from 'vitest'
import { metierDeLaCommande, metierDeLOutil } from './quartier-metiers'

describe('metierDeLOutil', () => {
  it('range les outils réels à leur métier', () => {
    expect(metierDeLOutil('Read')).toBe('lire')
    expect(metierDeLOutil('Grep')).toBe('chercher')
    expect(metierDeLOutil('Edit')).toBe('modifier')
    expect(metierDeLOutil('WebSearch')).toBe('web')
    expect(metierDeLOutil('orchestrate')).toBe('runs')
  })

  it('reconnaît les outils directs de l’app, avec ou sans leur préfixe', () => {
    expect(metierDeLOutil('mcp__autowin__brain_query')).toBe('brain')
    expect(metierDeLOutil('brain_query')).toBe('brain')
    expect(metierDeLOutil('mcp__autowin__verify')).toBe('tester')
    expect(metierDeLOutil('mcp__autowin__ecrire_a_un_fil')).toBe('messages')
  })

  it('classe une commande d’après son contenu, pas d’après « Bash » (D12)', () => {
    expect(metierDeLOutil('Bash', { command: 'npx vitest run x.test.ts' })).toBe('tester')
    expect(metierDeLOutil('Bash', { command: 'grep -n foo bar.ts' })).toBe('chercher')
    expect(metierDeLOutil('Bash', { command: 'cat a.txt' })).toBe('lire')
    expect(metierDeLOutil('run', { commande: 'git status --porcelain' })).toBe('publier')
  })

  it('envoie un outil inconnu à la Machine (D17)', () => {
    expect(metierDeLOutil('outil_du_futur')).toBe('commandes')
  })

  it('ne déplace personne pour sa liste de tâches ni pour une question', () => {
    expect(metierDeLOutil('TaskUpdate')).toBeNull()
    expect(metierDeLOutil('ask')).toBeNull()
  })
})

describe('metierDeLaCommande', () => {
  it('ignore le « cd » de tête', () => {
    expect(metierDeLaCommande('cd /d/AutoWinOS; npm run typecheck')).toBe('tester')
    expect(metierDeLaCommande('cd /d/AutoWinOS && rg foo')).toBe('chercher')
  })

  it('reconnaît une capture d’écran', () => {
    expect(metierDeLaCommande('node scripts/ui-capture.mjs --code-dev')).toBe('ecran')
  })

  it('garde la Machine pour tout le reste', () => {
    expect(metierDeLaCommande('python gros-calcul.py')).toBe('commandes')
  })
})
