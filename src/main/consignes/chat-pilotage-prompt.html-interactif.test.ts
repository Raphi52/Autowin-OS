import { describe, expect, it } from 'vitest'
import { SKILL_MISE_EN_FORME, buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { chargerSkillPourLeModele } from '../commands/skill-charger-command'
import { FORME_PAGE_INTERACTIVE } from '../../shared/scene-3d'
import { VARIABLES_DU_THEME } from '../../renderer/src/components/page-interactive'

/**
 * UNE CAPACITE QUE LE PROMPT NE NOMME PAS RESTE MORTE. Le bloc ```html-interactif (pages dont les
 * scripts tournent, BlocHtmlInteractif.tsx) a ete branche le 2026-10-29 : sans ce
 * paragraphe, aucun agent ne l'ecrirait. Son DECLENCHEUR est servi a CHAQUE tour, pas seulement aux
 * tours visuels ; son mode d'emploi (isolement, boite a outils, apercu) vit dans la skill
 * mise-en-forme, que le modele charge avec `skill_charger` avant d'ecrire la page.
 */
describe('contrat des pages interactives dans le chat', () => {
  // Le texte que `skill_charger` rend au modele : la vraie route, pas une lecture du fichier.
  const detail = chargerSkillPourLeModele({ nom: SKILL_MISE_EN_FORME }).procedure

  it('apprend la fence, son isolement et ses limites, sans retirer html-render', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('```' + FORME_PAGE_INTERACTIVE)
    expect(prompt).toMatch(/PAGES INTERACTIVES/u)
    // Ce qui change le choix du modele : les scripts tournent, mais sans reseau.
    expect(prompt).toMatch(/TOURNENT, dans un cadre isole SANS reseau/u)
    expect(prompt).toMatch(/Garde html-render quand rien ne bouge/u)
    expect(prompt).toContain('```html-render')
    // Le detail part a la demande, et la consigne dit ou le prendre.
    expect(prompt).toContain(`\`skill_charger\` (${SKILL_MISE_EN_FORME})`)
    expect(prompt).not.toContain('html-interactif-apercu')
    expect(detail).toContain('```' + FORME_PAGE_INTERACTIVE)
    expect(detail).toMatch(/TOURNENT, dans un cadre isole SANS reseau/u)
    expect(detail).toMatch(/<script src>/u)
  })

  // Compatibilites de l'amorce : sans elles dans la consigne, le modele continue
  // d'eviter localStorage ou la copie, ou ecrit un confirm() que le fil refuse.
  it('annonce la boite a outils de graphiques, ses types et sa mise a jour', () => {
    expect(detail).toContain("autowin.graphique('#zone'")
    for (const type of ['barres', 'lignes', 'aires', 'secteurs', 'points']) {
      expect(detail).toContain(type)
    }
    expect(detail).toContain('maj({valeurs})')
    expect(detail).toContain('.aw-graphique-bulle')
  })

  it('dit ce qui marche dans la page et ce que le fil refuse', () => {
    expect(detail).toMatch(/localStorage \(survit au redemarrage de l'app\), formulaires/u)
    expect(detail).toMatch(/copie et lien http\(s\) APRES un clic/u)
    expect(detail).toContain('`aw-theme`')
    expect(detail).toMatch(/Ni confirm, ni prompt, ni telechargement/u)
  })

  // Boutons de choix : sans cette phrase, le modele ne sait pas qu'un choix dans une
  // page interactive remplit la saisie au lieu d'envoyer, ni qu'il peut composer ce message.
  it('dit que les boutons de choix remplissent la saisie sans envoyer', () => {
    expect(detail).toContain('<a href="#autowin-prompt">Libelle</a>')
    expect(detail).toMatch(/REMPLIT la saisie de l'utilisateur avec son libelle, sans l'envoyer/u)
    expect(detail).toContain('autowin.remplirSaisie(texte)')
  })

  // L'apercu n'existe pour l'agent que si la consigne le nomme, avec ses codes.
  it('nomme le script d apercu, son code 0 exige et ses codes de defaut', () => {
    expect(detail).toContain('node scripts/html-interactif-apercu.mjs <fichier>')
    expect(detail).toMatch(/code 0 exige ; 3 = erreur JavaScript \(clic compris\)/u)
    expect(detail).toMatch(/7 = fond peint/u)
  })

  // Banc : 4 modeles sur 6 ont ecrit un banc prive parce que l'apercu ne remplit aucun
  // champ. Sans ces phrases, l'option --scenario reste morte comme le bloc l'etait au depart.
  it('nomme les scenarios, leur code et leurs etapes, pour eviter un banc prive', () => {
    expect(detail).toContain('--scenario <fichier.json>')
    expect(detail).toMatch(/8 = scenario rouge/u)
    for (const verbe of ['remplir', 'choisir', 'cliquer', 'survoler', 'voir', 'pasVoir', 'demande'])
      expect(detail).toContain(`{"${verbe}":`)
    expect(detail).toContain('.autowin-tmp/<id du fil>/')
  })

  // Les couleurs nommees existent vraiment : une liste recopiee a la main derive sans bruit.
  it('ne nomme, pour un canvas, que des couleurs que la page recoit', () => {
    const phrase = /Pour un canvas([\s\S]*?)Avant de montrer/u.exec(detail)?.[1] ?? ''
    const noms = phrase.match(/--[\w-]+/gu) ?? []
    expect(noms.length).toBeGreaterThanOrEqual(8)
    for (const nom of noms) expect(VARIABLES_DU_THEME).toContain(nom)
  })
})
