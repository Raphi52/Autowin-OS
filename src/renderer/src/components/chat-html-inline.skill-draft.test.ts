// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareChatHtml } from './chat-html-inline'

/**
 * La procedure /draft (skills/draft/SKILL.md) dit a l'agent avec quelles balises dessiner ses
 * maquettes dans le fil. Elle avait derive du filtre : elle annoncait `<svg>` et `<input>` retires
 * (ils sont acceptes) et taisait `<use>`, qui l'est — conv-139, tour
 * 1d9c0c1d-e6c2-4794-a927-191c11f2aaf8 : 21 icones `<use>` disparues de la maquette montree.
 * Ce test lie la procedure au code : une balise annoncee retiree doit l'etre vraiment.
 */
// Les tests sont lances depuis la racine du depot (vitest.config.ts).
const RACINE = join(process.cwd(), '/')
const SKILL = readFileSync(`${RACINE}skills/draft/SKILL.md`, 'utf8')
const SVG_SEULEMENT = new Set(['use', 'foreignobject'])

function rendu(html: string): string {
  return prepareChatHtml(html).html.toLowerCase()
}

describe('procedure /draft alignee sur le filtre du chat', () => {
  it('chaque balise annoncee RETIREE est vraiment retiree par le filtre', () => {
    const ligne = SKILL.split('\n').find((l) => l.includes('Balises RETIRÉES par le filtre'))
    expect(ligne, 'ligne « Balises RETIRÉES par le filtre » absente de la procedure').toBeTruthy()
    const balises = [...(ligne ?? '').matchAll(/`([a-zA-Z]+)`/g)].map((m) => m[1].toLowerCase())
    expect(balises).toContain('use')
    for (const balise of balises) {
      const source = SVG_SEULEMENT.has(balise)
        ? `<svg><${balise} href="#a">x</${balise}></svg>`
        : `<${balise}>x</${balise}>`
      expect(rendu(source), balise).not.toContain(`<${balise}`)
    }
  })

  it('ce que la procedure annonce ACCEPTE passe le filtre', () => {
    const sortie = rendu(
      '<style>.a{color:red}</style><svg><path d="M0 0L1 1"/></svg>' +
        '<input type="radio" id="t" checked><label for="t">x</label>'
    )
    for (const balise of ['<style', '<svg', '<path', '<input', '<label']) expect(sortie).toContain(balise)
    expect(SKILL).not.toMatch(/pas de `<svg>` \(retiré\)/u)
  })

  it('le controle de la procedure passe par l outil qui montre le rendu du chat', () => {
    expect(SKILL).toContain('node scripts/html-render-apercu.mjs')
    expect(existsSync(`${RACINE}scripts/html-render-apercu.mjs`)).toBe(true)
  })
})
