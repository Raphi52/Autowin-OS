import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { signalFinExplicite } from '../shared/prompt-suivant'
import { TITRE_CONVERSATION_MAX } from '../renderer/src/components/titre-conversation'

const RACINE = resolve(__dirname, '..', '..')
const DOC = join(RACINE, 'docs', 'prise-en-main.md')

describe('docs/prise-en-main.md', () => {
  it('existe et commence par un titre', () => {
    expect(existsSync(DOC)).toBe(true)
    expect(readFileSync(DOC, 'utf8').startsWith('# Prise en main')).toBe(true)
  })
  it('ne renvoie vers aucun fichier absent', () => {
    const texte = readFileSync(DOC, 'utf8')
    const liens = [...texte.matchAll(/\]\(([^)#]+)\)/g)].map((m) => join(RACINE, 'docs', m[1]))
    const chemins = [...texte.matchAll(/`((?:src|docs|scripts)\/[^`]+)`/g)].map((m) => join(RACINE, m[1]))
    expect(liens.length + chemins.length).toBeGreaterThan(0)
    for (const cible of [...liens, ...chemins]) expect(existsSync(cible), cible).toBe(true)
  })
  it('décrit le comportement réel du code (titre, fin du mode auto, scripts)', () => {
    const texte = readFileSync(DOC, 'utf8')
    expect(texte).toContain(`${TITRE_CONVERSATION_MAX} caractères`)
    expect(signalFinExplicite(texte.match(/`(AUTOWIN_FIN_V1)`/)![1])).toBe(true)
    const scripts = JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8')).scripts
    for (const m of texte.matchAll(/`npm run ([\w:-]+)`/g)) expect(scripts[m[1]], m[1]).toBeDefined()
  })
})
