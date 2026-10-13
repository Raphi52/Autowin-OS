// @vitest-environment happy-dom
/**
 * Le cadre « grand, deux lignes » de la barre d'activite (conv-904, 2026-10-12, /draft : « grand 2 lignes »,
 * « Pleine largeur », « couleur sur l'exception », puis « Rond de verre »).
 *
 * Ce que ces tests verrouillent :
 *  - le ROND DE VERRE porte le nombre et la COULEUR du verdict du groupe (vert, rouge, ambre) — un
 *    groupe « avec erreur » ne peut pas avoir un rond vert (le faux vert refuse depuis le 2026-08-26
 *    sur l'en-tete) ;
 *  - le VERDICT se lit en deux cases (commande, code) sans perdre son texte ;
 *  - la LEGENDE ne colore que l'exception et ne fond jamais un echec dans des reussites voisines ;
 *  - le cadre n'ecrit AUCUNE couleur en dur et aucune feuille de theme ne le repeint : c'est ce qui
 *    le rend juste dans tous les themes (le defaut de l'ancienne carte, repeinte par sept feuilles).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LegendeDesOutils } from './anneau-activite'
import {
  casesDuVerdict,
  exceptionDuGroupe,
  groupesDeLegende,
  verdictDuRond
} from './anneau-activite-calcul'
import { AssistantActivityGroup } from './ChatView.parts'

const ICI = dirname(fileURLToPath(import.meta.url))

describe('verdictDuRond — la couleur du rond', () => {
  // « je preferais voir du vert et rouge la jme rend pas compte si un truc a rate »
  it('un groupe tout reussi est vert, un groupe avec un echec est rouge', () => {
    expect(exceptionDuGroupe(['ok', 'ok', 'ok'])).toBeNull()
    expect(verdictDuRond(['ok', 'ok', 'ok'])).toBe('ok')
    expect(verdictDuRond(['ok', 'ko', 'ok'])).toBe('ko')
  })

  // La plus grave l'emporte : un echec cache dans un groupe qui tourne encore doit se voir.
  it('un echec l emporte sur une attente, une attente sur ce qui tourne', () => {
    expect(exceptionDuGroupe(['ok', 'encours', 'ko'])).toBe('ko')
    expect(exceptionDuGroupe(['encours', 'attente'])).toBe('attente')
    expect(exceptionDuGroupe(['ok', 'encours'])).toBe('encours')
  })
})

describe('casesDuVerdict — commande et code', () => {
  it('coupe « commande → code » en deux cases', () => {
    expect(casesDuVerdict('npm run typecheck → exit 0')).toEqual({
      commande: 'npm run typecheck',
      code: 'exit 0'
    })
  })

  it('garde un verdict sans fleche en une seule case', () => {
    expect(casesDuVerdict('échec : tests rouges')).toEqual({ code: 'échec : tests rouges' })
    expect(casesDuVerdict('succeeded')).toEqual({ code: 'succeeded' })
  })
})

describe('groupesDeLegende — regroupement des repetitions', () => {
  it('regroupe les outils CONSECUTIFS de meme nom et de meme verdict', () => {
    expect(
      groupesDeLegende([
        { nom: 'brain_query', etat: 'ok' },
        { nom: 'brain_read', etat: 'ok' },
        { nom: 'brain_read', etat: 'ok' }
      ])
    ).toEqual([
      { nom: 'brain_query', etat: 'ok', fois: 1 },
      { nom: 'brain_read', etat: 'ok', fois: 2 }
    ])
  })

  // ENTREE QUI FAIT ECHOUER UN REGROUPEMENT PAR NOM SEUL : l'echec du 6e Edit disparaitrait dans
  // « Edit ×4 », alors que c'est la seule chose a voir.
  it('ne fond jamais un echec dans des reussites de meme nom', () => {
    expect(
      groupesDeLegende([
        { nom: 'Edit', etat: 'ok' },
        { nom: 'Edit', etat: 'ko' },
        { nom: 'Edit', etat: 'ok' }
      ]).map((g) => [g.nom, g.etat, g.fois])
    ).toEqual([
      ['Edit', 'ok', 1],
      ['Edit', 'ko', 1],
      ['Edit', 'ok', 1]
    ])
  })
})

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('LegendeDesOutils — couleur sur l exception', () => {
  it('un outil reussi n a pas de point ; en cours, en echec ou en attente, il en a un', () => {
    act(() =>
      root.render(
        createElement(LegendeDesOutils, {
          outils: [
            { nom: 'Read', etat: 'ok' },
            { nom: 'Grep', etat: 'ok' },
            { nom: 'Grep', etat: 'ok' },
            { nom: 'Edit', etat: 'ko' },
            { nom: 'verify', etat: 'encours' },
            { nom: 'run', etat: 'attente' }
          ]
        })
      )
    )
    const items = [...container.querySelectorAll('[data-testid="legende-outil"]')]
    expect(
      items.map((i) => [
        i.textContent,
        i.getAttribute('data-etat'),
        Boolean(i.querySelector('.legende-point'))
      ])
    ).toEqual([
      ['Read', 'ok', false],
      ['Grep ×2', 'ok', false],
      ['Edit', 'ko', true],
      ['verify', 'encours', true],
      ['run', 'attente', true]
    ])
  })
})

type Action = Parameters<typeof AssistantActivityGroup>[0]['actions'][number]
const action = (over: Partial<Action>): Action =>
  ({ kind: 'action', name: 'brain_read', args: {}, ok: true, ...over }) as Action

describe('la barre d activite porte le rond de verre, la legende et le verdict', () => {
  const rendre = (actions: Action[]): void => {
    act(() => root.render(createElement(AssistantActivityGroup, { actions })))
  }
  const couleur = (): string | null =>
    container.querySelector('[data-testid="activity-compte"]')?.getAttribute('data-verdict') ?? null

  it('le nombre dans le rond, a la couleur de ce qui tourne', () => {
    rendre([
      action({ name: 'brain_query' }),
      action({ name: 'brain_read' }),
      action({ name: 'brain_read', ok: undefined })
    ])
    const rond = container.querySelector('[data-testid="activity-compte"]')
    expect(rond?.getAttribute('data-etats')).toBe('ok ok encours')
    expect(rond?.textContent).toBe('3')
    expect(couleur()).toBe('encours')
    // Le cadre porte toujours l'etat du groupe (contrat de B3-γ) et allume son reflet en cours.
    const cadre = container.querySelector('.activity-anneau')
    expect(cadre?.getAttribute('data-state')).toBe('running')
    expect(cadre?.classList.contains('is-live')).toBe(true)
    // La phrase d'etat reste ENTIERE (aucun libelle change).
    expect(cadre?.textContent).toContain('2 actions terminées · 1 action en cours')
  })

  // ENTREE QUI FAIT ECHOUER UNE PASTILLE PERMANENTE : un groupe tout reussi doit rester silencieux.
  it('un groupe tout reussi a un rond VERT', () => {
    rendre([action({ name: 'brain_query' }), action({ name: 'brain_read' })])
    expect(container.querySelector('[data-testid="activity-compte"]')?.textContent).toBe('2')
    expect(couleur()).toBe('ok')
  })

  it('l echec rend le rond ROUGE et colore la legende', () => {
    rendre([action({ name: 'brain_query' }), action({ name: 'brain_read', ok: false })])
    expect(
      container.querySelector('[data-testid="activity-compte"]')?.getAttribute('data-etats')
    ).toBe('ok ko')
    expect(couleur()).toBe('ko')
    const legende = [...container.querySelectorAll('[data-testid="legende-outil"]')]
    expect(legende.map((l) => l.getAttribute('data-etat'))).toEqual(['ok', 'ko'])
    expect(container.querySelector('.activity-anneau')?.getAttribute('data-state')).toBe('failed')
  })

  // ENTREE QUI FAIT ECHOUER UN ETAT TIRE DU SEUL `ok` : un depot Brain refuse REUSSIT a rendre un
  // refus (`ok` reste vrai) — l'en-tete dit « sans effet », le rond ne peut pas etre vert.
  it('un groupe sans effet a un rond ambre, jamais vert', () => {
    rendre([
      action({
        name: 'remember',
        ok: true,
        args: { title: 'Une leçon' },
        data: { allowed: false, stored: false, reason: 'type invalide' }
      } as Partial<Action>)
    ])
    expect(container.querySelector('.activity-anneau')?.getAttribute('data-state')).toBe('failed')
    expect(container.querySelector('[data-testid="activity-group"]')?.textContent).toContain(
      'sans effet'
    )
    expect(couleur()).toBe('attente')
    expect(
      container.querySelector('[data-testid="legende-outil"]')?.getAttribute('data-etat')
    ).toBe('attente')
  })

  // Le verdict d'une verification : deux cases, la commande puis le code. Le texte entier reste
  // lisible tel quel (copie, infobulle, tests existants qui lisent « … → exit 1 »).
  it('le verdict se lit en deux cases, sans perdre son texte', () => {
    rendre([
      action({
        name: 'verify',
        ok: false,
        data: { exitCode: 1, command: 'npm test', ok: false }
      } as Partial<Action>)
    ])
    const verdict = container.querySelector('[data-testid="activity-outcome"]')
    expect(verdict?.querySelector('.verdict-commande')?.textContent).toBe('npm test')
    expect(verdict?.querySelector('.verdict-code')?.textContent).toBe('exit 1')
    expect(verdict?.textContent).toBe('npm test → exit 1')
    expect(verdict?.className).toContain('st-failed')
  })
})

describe('le cadre est dessine par les jetons du theme, et par lui seul', () => {
  const css = readFileSync(join(ICI, 'anneau-activite.css'), 'utf8')

  it('n ecrit aucune couleur en dur (hors masques, ou seule l opacite compte)', () => {
    // Une declaration de masque peut tenir sur plusieurs lignes : on la retire entiere.
    const sansMasques = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(-webkit-)?mask(-composite)?\s*:[^;]*;/g, '')
    expect(sansMasques).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })

  it('allume le reflet et la lueur chaude quand ca tourne', () => {
    const i = css.indexOf('.cadre-anneau.is-live {')
    expect(i).toBeGreaterThan(-1)
    const regle = css.slice(i, css.indexOf('}', i))
    expect(regle).toMatch(/--chat-capsule-reflet-haut/)
    expect(regle).toMatch(/box-shadow:[^;]*--capsule-chaud/)
  })

  /**
   * L'ANCIENNE CARTE etait repeinte par sept feuilles de theme (fond, liseré, degrade par statut) :
   * chaque correction ecrite d'un cote etait ecrasee de l'autre. Le cadre n'a qu'une source.
   * Exception nommee : theme-holographique-clair.css, en cours de reprise par une autre
   * conversation, garde des regles `.activity-group` MORTES (aucun element ne porte plus cette
   * classe) — elles ne visent pas le cadre.
   */
  // Ce qui est interdit : une regle dont la CIBLE est le cadre (son fond, son bord). Une copie de
  // theme qui vise un element DANS le cadre (la pastille de duree, recolorée comme celles des
  // capsules) est legitime : elle suit le theme sans toucher au cadre.
  it('aucune feuille de theme ne repeint le cadre', () => {
    const assets = join(ICI, '..', 'assets')
    const cibleLeCadre = /\.(activity-anneau|cadre-anneau)[\w\-.[\]='"():]*\s*[,{]/
    for (const fichier of readdirSync(assets).filter((f) => f.endsWith('.css'))) {
      const feuille = readFileSync(join(assets, fichier), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(feuille, fichier).not.toMatch(cibleLeCadre)
    }
  })
})
