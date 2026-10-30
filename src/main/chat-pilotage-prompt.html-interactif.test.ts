import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { FORME_PAGE_INTERACTIVE } from '../shared/scene-3d'
import { VARIABLES_DU_THEME } from '../renderer/src/components/page-interactive'

/**
 * UNE CAPACITE QUE LE PROMPT NE NOMME PAS RESTE MORTE. Le bloc ```html-interactif (pages dont les
 * scripts tournent, BlocHtmlInteractif.tsx) a ete branche le 2026-10-29 (conv-1292) : sans ce
 * paragraphe, aucun agent ne l'ecrirait. Servi a CHAQUE tour, pas seulement aux tours visuels.
 */
describe('contrat des pages interactives dans le chat', () => {
  it('apprend la fence, son isolement et ses limites, sans retirer html-render', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('```' + FORME_PAGE_INTERACTIVE)
    expect(prompt).toMatch(/PAGES INTERACTIVES/u)
    // Ce qui change le choix du modele : les scripts tournent, mais sans reseau.
    expect(prompt).toMatch(/TOURNENT, dans un cadre isole SANS reseau/u)
    expect(prompt).toMatch(/<script src>/u)
    expect(prompt).toMatch(/Garde html-render quand rien ne bouge/u)
    expect(prompt).toContain('```html-render')
  })

  // Compatibilites de l'amorce (conv-1304) : sans elles dans la consigne, le modele continue
  // d'eviter localStorage ou la copie, ou ecrit un confirm() que le fil refuse.
  it('annonce la boite a outils de graphiques, ses types et sa mise a jour', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain("autowin.graphique('#zone'")
    for (const type of ['barres', 'lignes', 'aires', 'secteurs', 'points']) {
      expect(prompt).toContain(type)
    }
    expect(prompt).toContain('maj({valeurs})')
    expect(prompt).toContain('.aw-graphique-bulle')
  })

  it('dit ce qui marche dans la page et ce que le fil refuse', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/localStorage \(survit au redemarrage de l'app\), formulaires/u)
    expect(prompt).toMatch(/copie et lien http\(s\) APRES un clic/u)
    expect(prompt).toContain('`aw-theme`')
    expect(prompt).toMatch(/Ni confirm, ni prompt, ni telechargement/u)
  })

  // Boutons de choix (conv-1304) : sans cette phrase, le modele ne sait pas qu'un choix dans une
  // page interactive remplit la saisie au lieu d'envoyer, ni qu'il peut composer ce message.
  it('dit que les boutons de choix remplissent la saisie sans envoyer', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('<a href="#autowin-prompt">Libelle</a>')
    expect(prompt).toMatch(/REMPLIT la saisie de l'utilisateur avec son libelle, sans l'envoyer/u)
    expect(prompt).toContain('autowin.remplirSaisie(texte)')
  })

  // L'apercu (conv-1292) n'existe pour l'agent que si la consigne le nomme, avec ses codes.
  it('nomme le script d apercu, son code 0 exige et ses codes de defaut', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('node scripts/html-interactif-apercu.mjs <fichier>')
    expect(prompt).toMatch(/code 0 exige ; 3 = erreur JavaScript \(clic compris\)/u)
    expect(prompt).toMatch(/7 = fond peint/u)
  })

  // Banc conv-1304 : 4 modeles sur 6 ont ecrit un banc prive parce que l'apercu ne remplit aucun
  // champ. Sans ces phrases, l'option --scenario reste morte comme le bloc l'etait au depart.
  it('nomme les scenarios, leur code et leurs etapes, pour eviter un banc prive', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('--scenario <fichier.json>')
    expect(prompt).toMatch(/8 = scenario rouge/u)
    for (const verbe of ['remplir', 'choisir', 'cliquer', 'survoler', 'voir', 'pasVoir', 'demande'])
      expect(prompt).toContain(`{"${verbe}":`)
    expect(prompt).toContain('.autowin-tmp/<id du fil>/')
  })

  // Les couleurs nommees existent vraiment : une liste recopiee a la main derive sans bruit.
  it('ne nomme, pour un canvas, que des couleurs que la page recoit', () => {
    const prompt = buildChatPilotagePrompt([])
    const phrase = /Pour un canvas([\s\S]*?)Avant de montrer/u.exec(prompt)?.[1] ?? ''
    const noms = phrase.match(/--[\w-]+/gu) ?? []
    expect(noms.length).toBeGreaterThanOrEqual(8)
    for (const nom of noms) expect(VARIABLES_DU_THEME).toContain(nom)
  })
})
