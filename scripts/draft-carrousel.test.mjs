// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareChatHtml } from '../src/renderer/src/components/chat-html-inline'
import { promptsDesBoutons } from '../src/renderer/src/components/bouton-prompt-html'
import {
  blocDuCarrousel,
  carrouselDraft,
  TRANSITION,
  verifierPropositions
} from './draft-carrousel.mjs'

/*
 * Le carrousel de /draft (conv-302, 2026-10-17) : vignettes dessous, « Tout voir » en grille,
 * transition « pile de cartes ». Il n'a de valeur que s'il survit au filtre du fil
 * (chat-html-inline.ts) : une balise retirée ou une règle `display:none` refusée, et l'utilisateur
 * reçoit une page figée ou des propositions qui se superposent.
 */

const RACINE = join(process.cwd(), '/')

const propositions = (n = 6) => ({
  titre: '/draft · barre de saisie · tour 1',
  intro: 'Six <b>barres de saisie</b>.',
  css: '.ex-b{display:block;padding:8px;border-radius:8px}',
  propositions: Array.from({ length: n }, (_, i) => ({
    nom: `Variante ${i + 1}`,
    resume: `ce qui change ${i + 1}`,
    html: `<span class="ex-b ex-${i + 1}">Écris ton message…</span>`
  }))
})

/** Compte des balises d'un fragment, par nom. */
function compter(racine) {
  const n = {}
  for (const el of racine.querySelectorAll('*')) n[el.localName] = (n[el.localName] ?? 0) + 1
  return n
}

describe('carrousel /draft : ce que le fil affiche', () => {
  it('passe le filtre du fil sans perdre une seule balise', () => {
    const source = carrouselDraft(propositions())
    const avant = compter(new DOMParser().parseFromString(source, 'text/html').body)
    const conteneur = document.createElement('div')
    conteneur.innerHTML = prepareChatHtml(source).html
    const apres = compter(conteneur)
    const retirees = Object.entries(avant).filter(([balise, n]) => (apres[balise] ?? 0) < n)
    expect(retirees).toEqual([])
    // 6 propositions + l'interrupteur « Tout voir » + le Mixer (son interrupteur et ses 6 cases)
    expect(apres.input).toBe(14)
  })

  it('garde la transition « pile de cartes » et le masquage du mode grille après assainissement', () => {
    const { html } = prepareChatHtml(carrouselDraft(propositions()))
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''
    // Hors champ AVANT la courante : reculée, assombrie, découpée à la FIN de la transition.
    expect(css).toMatch(
      /\.dkc-sl\{[^}]*transform:scale\(\.9\)[^}]*clip-path:inset\(0 0 0 100%\)[^}]*clip-path 0s linear 0\.45s/
    )
    // Hors champ APRÈS la courante : à droite, prête à se poser par-dessus.
    expect(css).toMatch(/dkp3:checked~\.dkc-stg \.dkc-s3~\.dkc-sl\{transform:translateX\(102%\)/)
    expect(css).toContain(TRANSITION.courbe)
    // « Tout voir » cache la scène et les flèches : règles acceptées car une case les rouvre.
    expect(css).toMatch(/dkall:checked~\.dkc-stg\{display:none\}/)
    expect(css).toMatch(/dkall:checked~\.dkc-nav\{display:none\}/)
  })

  it('pose une flèche de chaque CÔTÉ de la proposition, grisée au premier et au dernier rang', () => {
    const conteneur = document.createElement('div')
    conteneur.innerHTML = carrouselDraft(propositions(4))
    // 2026-10-17 : « des flèches à gauche et à droite du draft, pas juste un ptit truc de pagination
    // en haut à droite » — une colonne de part et d'autre de la piste, dans la scène.
    const scene = conteneur.querySelector('.dkc-stg')
    const [gauche, piste, droite] = scene.children
    expect([gauche.className, piste.className, droite.className]).toEqual([
      'dkc-cote',
      'dkc-trk',
      'dkc-cote'
    ])
    const pour = (cote, rang) => cote.querySelector(`.dkc-fc${rang}`)
    expect(pour(gauche, 1).className).toContain('dkc-off')
    expect(pour(droite, 1).getAttribute('for')).toBe('dkp2')
    expect(pour(gauche, 4).getAttribute('for')).toBe('dkp3')
    expect(pour(droite, 4).className).toContain('dkc-off')
    // En haut ne reste que le compteur, sans ses anciennes petites flèches.
    expect(conteneur.querySelector('.dkc-q4').textContent).toBe('4 / 4')
    expect(conteneur.querySelectorAll('.dkc-nav label')).toHaveLength(0)
  })

  it('les flèches de côté survivent au filtre du fil : seule la paire du rang coché se montre', () => {
    const source = carrouselDraft(propositions())
    const { html } = prepareChatHtml(source)
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''
    expect(css).toMatch(/\.dkc-fc\{display:none/)
    expect(css).toMatch(/dkp3:checked~\.dkc-stg \.dkc-fc3\{display:inline-flex\}/)
    expect(css).toMatch(/dkall:not\(:checked\)~\.dkc-stg\{display:grid\}/)
    const conteneur = document.createElement('div')
    conteneur.innerHTML = html
    expect(conteneur.querySelectorAll('.dkc-stg svg path')).toHaveLength(12)
  })

  it('chaque carte porte le fond du carrousel : celle qui se pose CACHE celle du dessous', () => {
    // Sans fond, la carte qui arrivait laissait lire l'ancienne au travers pendant toute la
    // transition (constat utilisateur 2026-10-17 : « y'a les 2 superposés pendant une seconde »).
    const { html } = prepareChatHtml(carrouselDraft(propositions()))
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''
    expect(css).toMatch(
      /\.dkc-sl\{[^}]*background-image:linear-gradient\(var\(--dk-plaque\),var\(--dk-plaque\)\)/
    )
    // La piste découpe la carte qui sort à droite, pas la scène (les flèches resteraient coupées).
    expect(css).toMatch(/\.dkc-trk\{[^}]*overflow:hidden/)
  })

  it('recopie chaque maquette dans sa vignette, ses id renommés pour ne pas exister en double', () => {
    const spec = propositions(2)
    spec.propositions[0].html =
      '<svg viewBox="0 0 4 4"><linearGradient id="g"><stop offset="0" stop-color="#3c6eeb"/></linearGradient><rect width="4" height="4" fill="url(#g)"/></svg>'
    const bloc = carrouselDraft(spec)
    expect(bloc.match(/id="g"/g)).toHaveLength(1)
    expect(bloc.match(/id="g-v"/g)).toHaveLength(1)
    expect(bloc).toContain('fill="url(#g-v)"')
    expect(bloc.match(/class="dkc-th dkc-t\d"/g)).toHaveLength(2)
  })

  it('refuse une maquette qui piloterait le carrousel ou embarquerait son style', () => {
    const spec = propositions(3)
    spec.propositions[1].html = '<input type="radio" id="x"><label for="x">x</label>'
    spec.propositions[2].html = '<style>.a{}</style>'
    const erreurs = verifierPropositions(spec)
    expect(erreurs.join(' ')).toMatch(/proposition 2 .*<input>/)
    expect(erreurs.join(' ')).toMatch(/proposition 3 .*<style>/)
    expect(() => carrouselDraft(spec)).toThrow(/proposition 2/)
    expect(
      verifierPropositions({ titre: 't', propositions: [propositions(1).propositions[0]] })
    ).toEqual(['« propositions » : de 2 à 10 attendues'])
  })

  it('échappe le texte des noms et livre un bloc clôturé prêt à recopier', () => {
    const spec = propositions(2)
    spec.propositions[0].nom = 'A <b>&</b> B'
    const bloc = blocDuCarrousel(spec)
    expect(bloc.startsWith('```html-render\n')).toBe(true)
    expect(bloc.trimEnd().endsWith('```')).toBe(true)
    expect(bloc).toContain('A &lt;b&gt;&amp;&lt;/b&gt; B')
  })

  it('porte ses boutons de choix : ils passent le filtre et suivent la proposition affichée', () => {
    const source = carrouselDraft(propositions())
    const { html } = prepareChatHtml(source)
    const conteneur = document.createElement('div')
    conteneur.innerHTML = html
    const boutons = [...conteneur.querySelectorAll('a[href="#autowin-prompt"]')]
    // 2 par proposition, 2 par mélange précalculé (57 = 2^6 − 6 − 1 mélanges) et « Aucune »
    expect(boutons).toHaveLength(6 * 2 + 57 * 2 + 1)
    const ceuxDeLa3 = [...conteneur.querySelectorAll('.dkc-a3 a')].map((a) => a.textContent)
    expect(ceuxDeLa3).toEqual(['Affiner la 3 · Variante 3', 'Implémenter la 3 · Variante 3'])
    expect(boutons.at(-1)?.textContent).toBe('Aucune : propose 6 autres directions')
    // Seuls les boutons de la proposition cochée se montrent : la règle qui les rouvre survit.
    expect(/<style>([\s\S]*?)<\/style>/.exec(html)?.[1]).toMatch(
      /dkp3:checked~\.dkc-act \.dkc-a3\{display:inline-flex\}/
    )
    // Le fil relit dans la source exactement les libellés que le clic enverra (verrou durable).
    expect(promptsDesBoutons(source)).toEqual(boutons.map((a) => a.textContent))
  })

  it('accepte des libellés de boutons sur mesure, et refuse une liste invalide', () => {
    const spec = { ...propositions(2), boutons: ['Garder la {n} ({nom})'], boutonsFixes: [] }
    const conteneur = document.createElement('div')
    conteneur.innerHTML = carrouselDraft(spec)
    expect([...conteneur.querySelectorAll('.dkc-ac a')].map((a) => a.textContent)).toEqual([
      'Garder la 1 (Variante 1)',
      'Garder la 2 (Variante 2)'
    ])
    expect(verifierPropositions({ ...propositions(2), boutons: 'Garder' }).join(' ')).toMatch(
      /boutons/
    )
  })

  /*
   * BOUTON MIXER (conv-321, 2026-10-17 : « ajoute un bouton mixer pour choisir plusieurs éléments
   * d'un draft en affinage »). Le fil n'exécute aucun script et envoie le TEXTE du lien cliqué
   * (bouton-prompt-html.ts) : un bouton ne peut donc pas assembler son message à partir des cases
   * cochées. Chaque mélange est un lien PRÉCALCULÉ, montré seulement quand les cases cochées sont
   * exactement les siennes — ce qui part reste ce qui est écrit sur le bouton.
   */
  describe('bouton Mixer', () => {
    const monter = (spec) => {
      const conteneur = document.createElement('div')
      conteneur.innerHTML = prepareChatHtml(carrouselDraft(spec)).html
      return conteneur
    }
    const feuille = (spec) =>
      /<style>([\s\S]*?)<\/style>/.exec(prepareChatHtml(carrouselDraft(spec)).html)?.[1] ?? ''

    it('ajoute un interrupteur Mixer et une case par proposition, qui passent le filtre', () => {
      // Le filtre PRÉFIXE `id` et `for` par le domaine du bloc : on les reconnaît à leur fin.
      const conteneur = monter(propositions())
      const interrupteur = conteneur.querySelector('input[type="checkbox"][id$="dkmix"]')
      expect(interrupteur).not.toBeNull()
      expect(conteneur.querySelector(`label[for="${interrupteur.id}"]`)?.textContent).toContain(
        'Mixer'
      )
      const cases = [...conteneur.querySelectorAll('label.dkc-mc')]
      expect(cases.map((l) => l.getAttribute('for').replace(/^.*-(?=dkm\d$)/, ''))).toEqual([
        'dkm1',
        'dkm2',
        'dkm3',
        'dkm4',
        'dkm5',
        'dkm6'
      ])
      expect(cases[2].textContent).toContain('Variante 3')
      for (const label of cases)
        expect(
          conteneur.querySelector(`input[type="checkbox"][id="${label.getAttribute('for')}"]`)
        ).not.toBeNull()
    })

    it('précalcule « Mixer » et « Implémenter » par mélange d’au moins 2, nommant EXACTEMENT ses cases', () => {
      // conv-321, 2026-10-18 : « ajoute un second bouton “Implémenter 2 + 6” à côté de “Mixer 2 + 6” ».
      // Les deux liens d'un mélange partagent un même groupe : ses classes `dkc-yK` décident pour eux.
      const conteneur = monter(propositions())
      const groupes = [...conteneur.querySelectorAll('.dkc-mxa > :not(.dkc-mxh)')]
      expect(groupes).toHaveLength(57)
      for (const groupe of groupes) {
        const cochees = [...groupe.classList]
          .filter((c) => /^dkc-y\d+$/.test(c))
          .map((c) => Number(c.slice(5)))
        expect(cochees.length).toBeGreaterThanOrEqual(2)
        const liste = cochees.join(' + ')
        const liens = [...groupe.children]
        expect(liens.map((a) => a.getAttribute('href'))).toEqual([
          '#autowin-prompt',
          '#autowin-prompt'
        ])
        expect(liens.map((a) => a.textContent)).toEqual([`Mixer ${liste}`, `Implémenter ${liste}`])
      }
      const libelles = [...conteneur.querySelectorAll('.dkc-mxa a')].map((a) => a.textContent)
      expect(libelles).toHaveLength(114)
      expect(libelles).toContain('Implémenter 2 + 6')
      // Moins de 2 cases : une consigne, jamais un lien qu'on pourrait envoyer.
      const consignes = [...conteneur.querySelectorAll('.dkc-mxa > .dkc-mxh')]
      expect(consignes).toHaveLength(7)
      expect(consignes.every((c) => !c.querySelector('a') && !c.closest('a'))).toBe(true)
    })

    it('« Mixer » reste le bouton principal, « Implémenter » le secondaire, comme Affiner / Implémenter', () => {
      const css = feuille(propositions())
      // Le gel dégradé ne va qu'au PREMIER lien d'un mélange.
      expect(css).toMatch(/\.dkc-mxa a:first-child\{background-image:radial-gradient/)
      expect(css).not.toMatch(/\.dkc-mxa a\{background-image:radial-gradient/)
      // Les deux ont la forme de bouton commune (`.dkc-bt`).
      expect(css).toMatch(/\.dkc-mxa a\{display:inline-flex/)
    })

    it('ses règles d’affichage survivent au filtre : le mode Mixer remplace les boutons de la proposition', () => {
      const css = feuille(propositions())
      expect(css).toMatch(/\.dkc-mxa\{display:none/)
      expect(css).toMatch(/dkmix:checked~\.dkc-act \.dkc-mxa>\*\{display:inline-flex\}/)
      // Une case décochée cache les mélanges qui la nomment, une case cochée ceux qui l'ignorent.
      expect(css).toMatch(/dkm3:not\(:checked\)~\.dkc-act \.dkc-mxa>\.dkc-y3[^{]*\{display:none\}/)
      expect(css).toMatch(/dkm3:checked~\.dkc-act \.dkc-mxa>\*:not\(\.dkc-y3\)\{display:none\}/)
      expect(css).toMatch(/dkmix:checked~\.dkc-act span\.dkc-ac\{display:none\}/)
      // Les cases n'apparaissent qu'en mode Mixer ; cochée = la case qui suit son champ s'allume.
      expect(css).toMatch(/\.dkc-mc\{display:none/)
      expect(css).toMatch(/dkmix:checked~\.dkc-mc\{display:flex\}/)
      expect(css).toMatch(/\.dkc-car>input:checked\+\.dkc-mc\{/)
      // La coche n'existe qu'une fois la case cochée. Le filtre RETIRE `opacity:0` (texte caché) :
      // une coche masquée ainsi s'affichait dans les 6 cases vides (capture du 2026-10-17).
      expect(css).toMatch(/\.dkc-ck svg\{display:none/)
      expect(css).toMatch(/\.dkc-car>input:checked\+\.dkc-mc \.dkc-ck svg\{display:block\}/)
      const conteneur = monter(propositions())
      for (const label of conteneur.querySelectorAll('label.dkc-mc'))
        expect(label.previousElementSibling?.id).toBe(label.getAttribute('for'))
    })

    it('le fil reconnaît un mélange envoyé : le bloc se ferme durablement', () => {
      const source = carrouselDraft(propositions(3))
      expect(promptsDesBoutons(source)).toEqual(
        expect.arrayContaining([
          'Mixer 1 + 2',
          'Mixer 1 + 3',
          'Mixer 2 + 3',
          'Mixer 1 + 2 + 3',
          'Implémenter 1 + 3',
          'Implémenter 1 + 2 + 3'
        ])
      )
    })

    it('reste absent au-delà de 6 propositions ou sur demande, et refuse un mixer impossible', () => {
      expect(monter(propositions()).querySelector('[id$="dkmix"]')).not.toBeNull()
      expect(monter(propositions(7)).querySelector('[id$="dkmix"]')).toBeNull()
      expect(monter({ ...propositions(), mixer: false }).querySelector('[id$="dkmix"]')).toBeNull()
      expect(monter({ ...propositions(), mixer: false }).querySelectorAll('input')).toHaveLength(7)
      expect(verifierPropositions({ ...propositions(7), mixer: true }).join(' ')).toMatch(/mixer/)
      expect(verifierPropositions({ ...propositions(), mixer: 'oui' }).join(' ')).toMatch(/mixer/)
    })
  })

  it('la procédure /draft présente ses propositions avec ce carrousel, et ses boutons au lieu d’un ask', () => {
    const skill = readFileSync(`${RACINE}skills/draft/SKILL.md`, 'utf8')
    expect(skill).toContain('node scripts/draft-carrousel.mjs')
    expect(skill).toContain('ne pose PAS de bloc `ask`')
    // Le message « Mixer 1 + 3 + 6 » n'a de sens pour le modèle que si la procédure le définit.
    expect(skill).toContain('« Mixer 1 + 3 + 6 »')
    expect(skill).toContain('« Implémenter 1 + 3 + 6 »')
  })
})
