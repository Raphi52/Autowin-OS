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
  tableDeTextes,
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
   * LA PHRASE DE COUVERTURE DIT CE QUI EST TRADUIT ET NOMME CE QUI RESTE EN FRANÇAIS (objection du
   * juge, conv-1146, réparation 3 : « les autres écrans » ne disait pas lesquels). Depuis le bilan de
   * conv-1170 (2026-10-27), chaque écran a sa table : la partie « traduit » doit citer chaque écran
   * de la navigation — un écran ajouté sans y être nommé fait échouer ce test —, et la partie « reste »
   * les restes réels, dont les messages de `shared/watchdog-regex.ts` et du plan de lots.
   */
  it('la couverture cite chaque écran comme traduit et nomme ce qui reste en français, dans les deux langues', () => {
    const [traduitFr, resteFr] = TEXTES_FR['interface.langue.couverture'].split('**Restent en français')
    const [traduitEn, resteEn] = TEXTES_EN['interface.langue.couverture'].split('**Still in French')
    expect(resteFr, 'partie « reste » en français').toBeTruthy()
    expect(resteEn, 'partie « reste » en anglais').toBeTruthy()
    for (const d of APP_DESTINATIONS) {
      expect(traduitFr, d.id).toContain(d.label)
      expect(traduitEn, d.id).toContain(DESTINATIONS_EN[d.id])
    }
    expect(traduitFr).toContain(TEXTES_FR['settings.section.routing'])
    expect(traduitEn).toContain(TEXTES_EN['settings.section.routing'])
    for (const [fr, en] of [
      ['plan de lots', 'lot plan'],
      ['règle de réveil', 'wake-up rule'],
      ['agent', 'agent'],
      ['Jarvis', 'Jarvis'],
      ['heure des messages', 'time of chat messages']
    ]) {
      expect(resteFr, fr).toContain(fr)
      expect(resteEn, en).toContain(en)
    }
  })
})

/*
 * LES TABLES DES ÉCRANS (`tableDeTextes`, conv-1170). Entrée qui doit faire échouer ce bloc : une
 * table d'écran qui ne suit pas les règles de la table principale (repli sur le français, `{nom}`
 * remplacé), ou un type qui accepte une table anglaise à qui il manque une clé, ou qui en a une de trop.
 */
describe('tableDeTextes — une table par groupe d’écrans', () => {
  const FR = { 'ecran.titre': 'Titre', 'ecran.compte': '{n} fils sur {total}' } as const

  it('rend l’anglais, retombe sur le français pour un anglais vide, et remplace les valeurs', () => {
    const { traduire: t } = tableDeTextes(FR, { 'ecran.titre': 'Title', 'ecran.compte': ' ' })
    expect(t('ecran.titre', 'en')).toBe('Title')
    expect(t('ecran.titre', 'fr')).toBe('Titre')
    expect(t('ecran.compte', 'en', { n: 3, total: 7 })).toBe('3 fils sur 7')
    expect(t('ecran.compte', 'fr', { n: 3 })).toBe('3 fils sur {total}')

    const complete = tableDeTextes(FR, {
      'ecran.titre': 'Title',
      'ecran.compte': '{n} threads out of {total}'
    })
    expect(complete.traduire('ecran.compte', 'en', { n: 3, total: 7 })).toBe('3 threads out of 7')
  })

  it('le type refuse une clé anglaise manquante ou en trop, même passée par une variable', () => {
    const manquante = { 'ecran.titre': 'Title' }
    const enTrop = { 'ecran.titre': 'Title', 'ecran.compte': '{n} of {total}', 'ecran.autre': 'x' }
    // @ts-expect-error -- 'ecran.compte' manque côté anglais
    const sansCle = tableDeTextes(FR, manquante)
    // @ts-expect-error -- 'ecran.autre' n'existe pas côté français
    const avecCleEnTrop = tableDeTextes(FR, enTrop)
    // À l'exécution, la règle tient quand même : le français prend le relais.
    expect(sansCle.traduire('ecran.compte', 'en')).toBe('{n} fils sur {total}')
    expect(avecCleEnTrop.traduire('ecran.titre', 'en')).toBe('Title')
  })

  it('la table principale passe par la même règle : son français ne change pas', () => {
    for (const cle of Object.keys(TEXTES_FR) as CleDeTexte[]) {
      expect(traduire(cle, 'fr')).toBe(TEXTES_FR[cle])
      expect(traduire(cle, 'en')).toBe(TEXTES_EN[cle])
    }
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
