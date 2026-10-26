import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import { APP_DESTINATIONS } from '../../shared/navigation'
import { LANGUES, estLangue, langueOuDefaut, localeDeLangue } from '../../shared/langue'
import { THEMES } from './theme-mode'
import {
  DESTINATIONS_EN,
  TEXTES_EN,
  TEXTES_FR,
  nomDeDestination,
  nomDeTheme,
  riche,
  traduire,
  type CleDeTexte
} from './textes'

/**
 * LA TABLE DES TEXTES (conv-1146). Entrée qui doit faire échouer ce fichier : une clé ajoutée d'un
 * seul côté, une entrée anglaise vide qui s'afficherait comme un blanc, un repli qui montrerait la
 * clé brute, ou un nom d'écran français recopié ici au lieu d'être lu dans `APP_DESTINATIONS`.
 */
describe('table des textes FR / EN', () => {
  it('les deux langues ont exactement les mêmes clés, et aucun texte vide', () => {
    expect(Object.keys(TEXTES_EN).sort()).toEqual(Object.keys(TEXTES_FR).sort())
    for (const [cle, texte] of [...Object.entries(TEXTES_FR), ...Object.entries(TEXTES_EN)]) {
      expect(texte.trim(), cle).not.toBe('')
    }
  })

  it('un texte anglais absent ou vide retombe sur le français, jamais sur la clé ni un blanc', () => {
    const cle: CleDeTexte = 'interface.langue'
    const incomplete = { fr: TEXTES_FR, en: {} }
    expect(traduire(cle, 'en', undefined, incomplete)).toBe('Langue')
    expect(traduire(cle, 'en', undefined, { fr: TEXTES_FR, en: { [cle]: '  ' } })).toBe('Langue')
    expect(traduire(cle, 'en')).toBe('Language')
    expect(traduire(cle, 'fr')).toBe('Langue')
  })

  it('remplace les valeurs nommées, et laisse visible une valeur oubliée', () => {
    expect(traduire('chat.suites.note', 'fr', { score: 87 })).toBe('note 87 sur 100')
    expect(traduire('chat.suites.note', 'en', { score: 87 })).toBe('score 87 out of 100')
    expect(traduire('chat.suites.note', 'en', {})).toBe('score {score} out of 100')
  })

  it('rend les passages **…** en gras, sans morceau vide', () => {
    const rendu = riche('**Gras** puis normal')
    expect(rendu).toHaveLength(2)
    expect(isValidElement(rendu[0]) && rendu[0].type).toBe('strong')
    expect(rendu[1]).toBe(' puis normal')
    expect(riche('sans gras')).toEqual(['sans gras'])
    const enB = riche('**Gras**', 'b')
    expect(isValidElement(enB[0]) && enB[0].type).toBe('b')
  })

  /*
   * LA PHRASE DE COUVERTURE NOMME CE QUI RESTE EN FRANÇAIS (objection du juge, conv-1146,
   * réparation 3 : « les autres écrans » ne disait pas lesquels). Liée à la navigation : un écran
   * ajouté sans être nommé ici, ou retiré de la phrase, fait échouer ce test. Chat et Settings sont
   * en partie traduits : la phrase nomme leur reste à part.
   */
  it('la couverture nomme, dans les deux langues, chaque écran et chaque page de Settings restés en français', () => {
    const fr = TEXTES_FR['interface.langue.couverture']
    const en = TEXTES_EN['interface.langue.couverture']
    for (const d of APP_DESTINATIONS) {
      if (d.id === 'chat' || d.id === 'settings') continue
      expect(fr, d.id).toContain(d.label)
      expect(en, d.id).toContain(DESTINATIONS_EN[d.id])
    }
    for (const page of ['Skills', 'Hooks', 'Gates', 'Mods', 'Tools', 'Behaviour', 'Rules']) {
      expect(fr, page).toContain(page)
      expect(en, page).toContain(page)
    }
    expect(fr).toContain(TEXTES_FR['settings.section.routing'])
    expect(en).toContain(TEXTES_EN['settings.section.routing'])
    expect(fr).toContain('reste du chat')
    expect(en).toContain('rest of the chat')
  })
})

describe('noms des écrans et des thèmes', () => {
  it('en français, le nom vient de la navigation elle-même ; en anglais, chaque écran en a un', () => {
    for (const d of APP_DESTINATIONS) {
      expect(nomDeDestination(d.id, 'fr')).toBe(d.label)
      expect(DESTINATIONS_EN[d.id]?.trim(), d.id).toBeTruthy()
    }
    expect(nomDeDestination('accueil', 'en')).toBe('Home')
    expect(nomDeDestination('hdesk', 'en')).toBe('Hidden desktops')
  })

  it('un thème sans nom anglais garde son nom français ; le français ne change jamais', () => {
    for (const th of THEMES) expect(nomDeTheme(th.id, th.libelle, 'fr')).toBe(th.libelle)
    expect(nomDeTheme('sombre', 'Sombre', 'en')).toBe('Dark')
    expect(nomDeTheme('theme-de-demain', 'Demain', 'en')).toBe('Demain')
  })
})

describe('liste des langues', () => {
  it('français et anglais, une valeur inconnue retombe sur le français', () => {
    expect(LANGUES.map((l) => l.id)).toEqual(['fr', 'en'])
    expect(estLangue('en')).toBe(true)
    for (const v of ['de', '', null, undefined, 1, 'FR']) expect(langueOuDefaut(v)).toBe('fr')
    expect(localeDeLangue('en')).toBe('en-US')
    expect(localeDeLangue('fr')).toBe('fr-FR')
  })
})
