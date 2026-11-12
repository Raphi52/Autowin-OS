// @vitest-environment happy-dom
/**
 * Le cadre « grand, deux lignes » de la barre d'activite (2026-10-12, /draft : « grand 2 lignes »,
 * « Pleine largeur », « couleur sur l'exception », puis « Rond de verre »).
 *
 * Ce que ces tests verrouillent :
 *  - le ROND DE VERRE porte le nombre et la COULEUR du verdict du groupe (vert, rouge, ambre) — un
 *    groupe « avec erreur » ne peut pas avoir un rond vert (le faux vert refuse depuis le 2026-08-26
 *    sur l'en-tete) ;
 *  - le VERDICT se lit en deux cases (commande, code) sans perdre son texte ;
 *  - la LEGENDE ne colore que l'exception et ne fond jamais un echec dans des reussites voisines ;
 *  - le cadre n'ecrit AUCUNE couleur en dur et aucune feuille de theme ne le repeint : c'est ce qui
 *    le rend juste dans tous les themes (le defaut de l'ancienne carte, repeinte par sept feuilles) ;
 *  - la VAGUE traverse chaque bloc encadre, par la carte graphique seule, en un seul passage pour
 *    tout le fil (Actions d'abord, puis Raisonnement).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LegendeDesOutils, VagueDuCadre } from './anneau-activite'
import {
  ANIMATIONS_D_ATTERRISSAGE,
  ANIMATIONS_DE_VAGUE,
  caleSurLHorlogeCommune,
  casesDuVerdict,
  exceptionDuGroupe,
  groupesDeLegende,
  verdictDuRond
} from './anneau-activite-calcul'
import { AssistantActivityGroup } from './ChatView.parts'
import { ThinkingBlock } from './ThinkingBlock'

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

  /** Le corps d'une regle de anneau-activite.css, sans ses commentaires. */
  function regleDe(selecteur: string): string {
    const debut = css.indexOf(`${selecteur} {`)
    expect(debut, selecteur).toBeGreaterThan(-1)
    return css.slice(debut, css.indexOf('\n}', debut)).replace(/\/\*[\s\S]*?\*\//g, '')
  }
  /** Les couches de `background:`, coupees aux virgules de premier niveau. */
  function couchesDuFond(regle: string): { valeur: string; couches: string[] } {
    const fond = regle.slice(regle.indexOf('background:') + 'background:'.length)
    const valeur = fond.slice(0, fond.indexOf(';'))
    const couches: string[] = []
    let profondeur = 0
    let courante = ''
    for (const c of valeur) {
      if (c === '(') profondeur++
      if (c === ')') profondeur--
      if (c === ',' && profondeur === 0) {
        couches.push(courante.trim())
        courante = ''
      } else courante += c
    }
    couches.push(courante.trim())
    return { valeur, couches }
  }
  // Une ellipse posee sur l'eclat, dont la largeur est un % du bloc : en pixels fixes, le spectre
  // couvrait tout le bord d'un bloc etroit et l'anneau redevenait arc-en-ciel. Un % SEUL : Chromium
  // refuse `min()`/`calc()` melant px et % dans cette taille et jette tout le `background`.
  const SUR_L_ECLAT = /^radial-gradient\(\s*\d+% \d+px at [^,]*var\(--chrome-x\)[^,]*,/

  /**
   * ANNEAU HOLOGRAPHIQUE : un seul dessin pour le bord de tous les blocs encadres du fil, copie de
   * l'anneau d'un bouton de verre choisi par l'utilisateur : un metal sombre, un point blanc, le
   * spectre serre autour de ce blanc, et le meme reflet en miroir en bas.
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : retirer un bloc de la liste, ecrire une couleur en dur,
   * etaler le spectre le long du metal (l'arc-en-ciel tout autour, refuse), revenir au chrome clair a
   * frange de 2 px (refuse aussi), redonner au bas un reflet different de celui du haut (« celui
   * d'en dessous est tout pourri »), ou animer le calque (il serait repeint a chaque image).
   */
  it('pose l anneau holographique sur chaque bloc encadre, a partir des jetons du theme', () => {
    const regle = regleDe(':is(.cadre-anneau, .look-decode-block, .bloc-3d)::before')
    const { valeur, couches } = couchesDuFond(regle)
    expect(regle).toMatch(/\bpadding: 3px;/)
    expect(valeur).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)

    // Le metal reste SOMBRE : du noir et des gris, le spectre n'y entre qu'en teinte du noir.
    const metal = couches.filter((c) => c.startsWith('linear-gradient('))
    expect(metal).toHaveLength(1)
    for (const jeton of ['noir', 'sombre', 'moyen'])
      expect(metal[0]).toContain(`var(--chrome-${jeton})`)
    const teintes = [
      ...metal[0]!.matchAll(
        /color-mix\(in srgb, var\(--prisme-\w+\) (\d+)%, var\(--chrome-noir\)\)/g
      )
    ]
    for (const t of teintes) expect(Number(t[1])).toBeLessThanOrEqual(30)
    expect(
      metal[0]!.replace(/color-mix\(in srgb, var\(--prisme-\w+\) \d+%, var\(--chrome-noir\)\)/g, '')
    ).not.toContain('--prisme-')

    // Deux points blancs sur la position de l'eclat (en haut, et l'oppose en bas).
    const blancs = couches.filter(
      (c) =>
        SUR_L_ECLAT.test(c) &&
        /,\s*(var\(--chrome-eclat\)|color-mix\(in srgb, var\(--chrome-eclat\))/.test(c)
    )
    expect(blancs).toHaveLength(2)
    // Le spectre entier, mais seulement en anneaux autour de ces points : transparent au centre.
    const spectres = couches.filter((c) => c.includes('--prisme-') && !c.startsWith('linear'))
    expect(spectres).toHaveLength(2)
    for (const s of spectres)
      expect(s).toMatch(new RegExp(`${SUR_L_ECLAT.source}\\s*transparent \\d+%`))
    for (const jeton of ['jaune', 'or', 'rouge', 'magenta', 'bleu', 'cyan', 'vert'])
      expect(spectres.join('\n')).toContain(`var(--prisme-${jeton})`)
    // Le bas est le MIROIR du haut : meme dessin, seule la position change.
    const auHaut = (c: string): string =>
      c.replace(/\s+/g, ' ').replace('at calc(100% - var(--chrome-x)) 100%', 'at var(--chrome-x) 0')
    expect(auHaut(blancs[1]!)).toBe(auHaut(blancs[0]!))
    expect(auHaut(spectres[1]!)).toBe(auHaut(spectres[0]!))
    expect(blancs[1]).toContain('at calc(100% - var(--chrome-x)) 100%')
    expect(regle).not.toMatch(/animation/)
  })

  // Le halo deborde en hauteur seulement : un calque qui depasse sur les cotes elargit la zone
  // defilable du fil (barre horizontale possible). Eteint en clair : sur fond blanc il ne restait
  // qu'une tache beige. ENTREE QUI DOIT FAIRE ECHOUER : un `inset` qui deborde a gauche ou a droite,
  // une couleur en dur, un halo qui ne suit pas l'eclat, un halo du bas different de celui du haut,
  // ou un halo rallume en clair.
  it('fait deborder la lumiere de l eclat en halo, sans elargir le fil', () => {
    const regle = regleDe(':is(.cadre-anneau, .look-decode-block)::after')
    const { valeur, couches } = couchesDuFond(regle)
    expect(regle).toMatch(/\binset: -\d+px 0;/)
    expect(regle).toMatch(/\bz-index: -2;/)
    expect(regle).toMatch(/\bpointer-events: none;/)
    expect(valeur).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    expect(couches.length).toBeGreaterThan(0)
    for (const c of couches) expect(c).toMatch(SUR_L_ECLAT)
    expect(couches).toHaveLength(2)
    for (const c of couches) expect(c).toContain('var(--chrome-halo)')
    expect(couches[1]!.replace(/\s+/g, ' ')).toBe(
      couches[0]!
        .replace(/\s+/g, ' ')
        .replace('at var(--chrome-x) 10px', 'at calc(100% - var(--chrome-x)) calc(100% - 10px)')
    )
    const modes = readFileSync(join(ICI, '..', 'assets', 'theme-modes.css'), 'utf8')
    expect(modes).toMatch(/--chrome-halo:\s*transparent;/)
  })

  it('donne aux tranches de la pile d images le meme metal que le bord', () => {
    const pile = readFileSync(join(ICI, 'ArtifactPreview.css'), 'utf8')
    const debut = pile.indexOf('.artifact-pile__tranches > span {')
    expect(debut).toBeGreaterThan(-1)
    const regle = pile.slice(debut, pile.indexOf('\n}', debut))
    for (const jeton of ['eclat', 'clair', 'moyen', 'sombre'])
      expect(regle).toContain(`var(--chrome-${jeton})`)
    expect(regle).not.toMatch(/--capsule-|--prisme-/)
  })

  /** Les etapes d'un `@keyframes` : pourcentage -> declarations. */
  function etapesDe(nom: string): Map<number, string> {
    const debut = css.indexOf(`@keyframes ${nom} {`)
    expect(debut, nom).toBeGreaterThan(-1)
    const corps = css.slice(debut, css.indexOf('\n}', debut))
    const etapes = new Map<number, string>()
    for (const m of corps.matchAll(/((?:\d+(?:\.\d+)?%,?\s*)+)\{([^}]*)\}/g)) {
      for (const p of m[1]!.split(',')) etapes.set(Number.parseFloat(p), m[2]!.trim())
    }
    return etapes
  }
  /** Debut et fin du passage (en % du cycle) : le dernier repos a droite, la premiere arrivee a gauche. */
  function passageDe(nom: string): { debut: number; fin: number } {
    const etapes = [...etapesDe(nom)].sort((a, b) => a[0] - b[0])
    const aDroite = etapes.filter(([, d]) => d.includes('translateX(100%)')).map(([p]) => p)
    const aGauche = etapes.filter(([, d]) => d.includes('translateX(-200px)')).map(([p]) => p)
    return { debut: Math.max(...aDroite), fin: Math.min(...aGauche) }
  }

  /**
   * LA VAGUE (« une vague qui traverse l'input ») : une bande de lumiere glisse sur l'anneau, de
   * droite a gauche. ENTREE QUI DOIT FAIRE ECHOUER : une vague animee autrement que par `transform`
   * (un degrade ou une propriete enregistree serait repeint a chaque image, le cout de l'ancienne
   * lave), une animation d'eclat revenue sur l'anneau, ou une couleur en dur dans la bande.
   */
  it('fait glisser la vague par transform seul, et n anime rien d autre sur l anneau', () => {
    const noms = [...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]!)
    const vagues = noms.filter((n) => n.startsWith('cadre-vague'))
    expect(vagues.sort()).toEqual(['cadre-vague-droite', 'cadre-vague-gauche', 'cadre-vague-plein'])
    for (const nom of vagues)
      for (const declarations of etapesDe(nom).values())
        expect(declarations, nom).toMatch(/^transform: translateX\([^)]*\);$/)
    // Seuls la vague et l'atterrissage du verdict animent quelque chose dans ce fichier.
    for (const n of noms) expect([...vagues, ...ANIMATIONS_D_ATTERRISSAGE], n).toContain(n)
    expect(css).not.toMatch(/@property/)
    const onde = regleDe('.cadre-vague__onde::before')
    expect(onde).toMatch(/animation: cadre-vague-plein 6s linear infinite;/)
    expect(couchesDuFond(onde).valeur).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    expect(onde).toContain('var(--chrome-eclat) 48% 52%')
    // Clippee : la bande en attente a droite elargirait la zone defilable du fil.
    expect(regleDe('.cadre-vague')).toMatch(/\boverflow: clip;/)
    // L'arrondi par variable : `inherit` lit l'arrondi nul de l'emplacement cache d'un `<details>`,
    // et la vague debordait de l'anneau en equerre. Chaque bloc encadre declare le sien.
    expect(regleDe('.cadre-vague')).toMatch(/\bborder-radius: var\(--cadre-rayon\);/)
    for (const [feuille, rayon] of [
      ['anneau-activite.css', '16px'],
      ['LookDecodeBlock.css', '10px'],
      ['Bloc3D.css', '10px']
    ] as const) {
      const texte = readFileSync(join(ICI, feuille), 'utf8')
      expect(texte, feuille).toContain(`--cadre-rayon: ${rayon};`)
      expect(texte, feuille).toContain('border-radius: var(--cadre-rayon);')
    }
  })

  /**
   * « quand ya un groupement de 3 comme ca ca doit faire une vague qui traverse d'abord action puis
   * raisonnement » : un SEUL passage pour la rangee, a vitesse constante, et les blocs pleine largeur
   * dessous traverses dans le meme temps. ENTREE QUI DOIT FAIRE ECHOUER : Raisonnement traverse avant
   * Actions, une moitie plus rapide que l'autre (la bande sauterait d'un bloc a l'autre), ou un
   * passage hors de l'horloge commune.
   */
  it('traverse Actions puis Raisonnement, d un seul passage a vitesse constante', () => {
    const plein = passageDe('cadre-vague-plein')
    const droite = passageDe('cadre-vague-droite')
    const gauche = passageDe('cadre-vague-gauche')
    expect(droite.debut).toBe(plein.debut)
    expect(gauche.fin).toBe(plein.fin)
    expect(gauche.debut).toBeGreaterThan(droite.debut)
    expect(gauche.debut).toBeLessThan(droite.fin)
    // Vitesse : distance parcourue / duree. Bloc plein de 720 px, deux moities de 356 px (8 px
    // d'ecart), bande de 200 px.
    const vitesse = (largeur: number, p: { debut: number; fin: number }): number =>
      (largeur + 200) / (p.fin - p.debut)
    expect(vitesse(356, droite)).toBeCloseTo(vitesse(720, plein), 0)
    expect(vitesse(356, gauche)).toBeCloseTo(vitesse(720, plein), 0)
    // Actions est le SECOND bloc de la rangee, Raisonnement le premier quand il n'est pas seul.
    const plat = css.replace(/\s+/g, ' ')
    const rang = (bloc: string, passage: string): string =>
      `.tour-blocs-rang > .cadre-anneau${bloc} > summary > .cadre-vague > .cadre-vague__onde::before { animation-name: ${passage}; }`
    expect(plat).toContain(rang(':nth-child(2)', 'cadre-vague-droite'))
    expect(plat).toContain(rang(':first-child:not(:only-child)', 'cadre-vague-gauche'))
    // Ces trois passages, et eux seuls, suivent l'horloge commune.
    expect([...ANIMATIONS_DE_VAGUE].sort()).toEqual([
      'cadre-vague-droite',
      'cadre-vague-gauche',
      'cadre-vague-plein'
    ])
  })

  /**
   * « les animations sur les blocs dans le chat doivent etre en fonction de la ou je regarde, pas
   * juste les dernieres » : la vague passe sur TOUS les tours, et animations-hors-champ.ts met en
   * pause ce qui sort de l'ecran. Ce module observe l'element qui porte l'animation : c'est donc le
   * `::before` d'un calque FIXE pose sur le cadre qui bouge, jamais le calque lui-meme. ENTREE QUI
   * DOIT FAIRE ECHOUER : figer la vague des tours anciens, ou animer le calque `.cadre-vague__onde`
   * (rogne et pousse hors du cadre entre deux passages, il serait juge hors champ et ne repartirait
   * plus).
   */
  it('anime la vague sur tous les tours, depuis un calque qui reste sur le cadre', () => {
    expect(css).not.toMatch(/:has\(~ \.msg\.assistant\.msg--rail\)[^{]*cadre-vague/)
    expect(css).not.toMatch(/cadre-vague[^{]*\{[^}]*animation: none/)
    const calque = regleDe('.cadre-vague__onde')
    expect(calque).toMatch(/\binset: 0;/)
    expect(calque).not.toMatch(/transform|animation/)
    for (const m of css.matchAll(/([^{}]+)\{[^{}]*animation(?:-name)?:\s*cadre-vague[^{}]*\}/g))
      expect(m[1]!.trim()).toMatch(/\.cadre-vague__onde::before$/)
  })

  /**
   * L'ANCIENNE CARTE etait repeinte par sept feuilles de theme (fond, liseré, degrade par statut) :
   * chaque correction ecrite d'un cote etait ecrasee de l'autre. Le cadre n'a qu'une source.
   * Exception nommee : theme-holographique-clair.css, en cours de reprise par une autre
   * conversation, garde des regles `.activity-group` MORTES (aucun element ne porte plus cette
   * classe) — elles ne visent pas le cadre.
   * Les TRANCHES de la pile d'images prolongent ce bord sous la carte de devant : un theme qui les
   * repeint (la lave rose et bleu de Nebuleuse) les detache du chrome.
   */
  // Ce qui est interdit : une regle dont la CIBLE est le cadre (son fond, son bord). Une copie de
  // theme qui vise un element DANS le cadre (la pastille de duree, recolorée comme celles des
  // capsules) est legitime : elle suit le theme sans toucher au cadre.
  it('aucune feuille de theme ne repeint le cadre ni les tranches de la pile', () => {
    const assets = join(ICI, '..', 'assets')
    const cibleLeCadre = /\.(activity-anneau|cadre-anneau)[\w\-.[\]='"():]*\s*[,{]/
    for (const fichier of readdirSync(assets).filter((f) => f.endsWith('.css'))) {
      const feuille = readFileSync(join(assets, fichier), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(feuille, fichier).not.toMatch(cibleLeCadre)
      expect(feuille, fichier).not.toMatch(/\.artifact-pile__tranche/)
    }
  })

  // Le metal et le spectre ont leur valeur claire, choisie a l'oeil, dans theme-modes.css. La couche
  // generee du theme clair prenait le noir du metal pour un fond d'encre et le passait en nacre :
  // l'anneau disparaissait sur le blanc. ENTREE QUI DOIT FAIRE ECHOUER : retirer l'exception
  // `CLAIR_JETONS_ANNEAU` de scripts/theme-nebuleuse-verre.mjs puis regenerer.
  it('la couche generee du theme clair ne transpose pas les couleurs de l anneau', () => {
    const couche = readFileSync(
      join(ICI, '..', 'assets', 'theme-holographique-clair.genere.css'),
      'utf8'
    )
    expect(couche).not.toMatch(/--(chrome|prisme)-[\w-]+\s*:/)
  })
})

describe('la vague du cadre — un passage commun a tous les blocs', () => {
  /** Une animation factice, comme celles que rend `getAnimations()`. */
  function animation(
    nom: string,
    startTime: number | null
  ): { animationName: string; startTime: number | null } {
    return { animationName: nom, startTime }
  }

  // ENTREE QUI DOIT FAIRE ECHOUER : caler une autre animation (l'atterrissage du verdict partirait au
  // milieu de sa course), laisser un passage de vague sur sa propre horloge, ou oublier l'animation
  // du `::before` (seule l'option `subtree` la rend).
  it('cale les passages de vague sur l origine du document, et eux seuls', () => {
    const vague = animation('cadre-vague-gauche', 1234)
    const atterrissage = animation('anneau-reflet', 500)
    const dejaCalee = animation('cadre-vague-plein', 0)
    const element = {
      getAnimations: (options?: { subtree?: boolean }) =>
        options?.subtree ? [vague, atterrissage, dejaCalee] : []
    }
    expect(caleSurLHorlogeCommune(element as unknown as Element)).toBe(1)
    expect(vague.startTime).toBe(0)
    expect(atterrissage.startTime).toBe(500)
  })

  it('ne cale rien hors d un vrai navigateur', () => {
    expect(caleSurLHorlogeCommune({} as Element)).toBe(0)
  })

  it('pose la bande dans un calque cache aux lecteurs d ecran', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(VagueDuCadre)))
    const vague = host.querySelector('.cadre-vague')
    expect(vague?.getAttribute('aria-hidden')).toBe('true')
    expect(vague?.querySelector(':scope > .cadre-vague__onde')).not.toBeNull()
    expect(vague?.textContent).toBe('')
    act(() => root.unmount())
    host.remove()
  })

  // Chaque bloc encadre du fil porte la vague. Un `<details>` replie n'affiche que son `<summary>` :
  // la vague y est le premier enfant. ENTREE QUI DOIT FAIRE ECHOUER : un nouveau bloc encadre sans
  // `<VagueDuCadre />`, ou une vague posee hors du `summary` d'un bloc repliable.
  it('est posee dans chaque bloc encadre du fil', () => {
    const racine = /className=\{?[`'"][^`'"]*\b(cadre-anneau|look-decode-block|bloc-3d)\b(?![-_])/g
    const fichiers = readdirSync(ICI).filter(
      (f) => f.endsWith('.tsx') && !f.includes('.test.') && f !== 'anneau-activite.tsx'
    )
    const porteurs: Record<string, number> = {}
    for (const f of fichiers) {
      const source = readFileSync(join(ICI, f), 'utf8')
      const cadres = [...source.matchAll(racine)].length
      if (cadres === 0) continue
      porteurs[f] = cadres
      expect(source.split('<VagueDuCadre />').length - 1, f).toBe(cadres)
    }
    expect(Object.keys(porteurs).sort()).toEqual([
      'ArtifactPile.tsx',
      'ArtifactPreview.tsx',
      'Bloc3D.tsx',
      'ChatView.parts.tsx',
      'LookDecodeBlock.tsx',
      'ThinkingBlock.tsx'
    ])
  })

  it('est rendue dans le summary d un bloc replie (Raisonnement)', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(ThinkingBlock, { text: 'je pese', done: false })))
    const bloc = host.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')!
    expect(bloc.open).toBe(false)
    expect(bloc.querySelector(':scope > summary > .cadre-vague:first-child')).not.toBeNull()
    act(() => root.unmount())
    host.remove()
  })
})
