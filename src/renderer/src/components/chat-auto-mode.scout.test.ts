import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto, dernierTourEstUnScout, lireCibleScout } from './chat-auto-mode'

/*
 * APRES UN SCOUT — un scout rend PLUSIEURS pistes. Sans regle, le maillon suivant du mode auto
 * repart sur le tableau entier : la boucle enchaine un tour PAYANT sur une cible que personne n'a
 * choisie. Cadrage du 2026-09-05 (conv-308, decision B incluant A) : la sortie d'un scout porte en
 * TETE une ligne `CIBLE:` ; l'absence de cible est une FIN de chaine ; une cible destructrice ne
 * part JAMAIS toute seule, elle demande l'accord de l'utilisateur.
 *
 * La porte se teste sur la FORME (une cible nommee existe), jamais sur la qualite du choix :
 * producteur et juge sont le meme modele, un critere de qualite auto-attribue ne prouve rien.
 */

const scout = (...lignes: string[]): string => lignes.join('\n')

describe('lireCibleScout — la ligne CIBLE:', () => {
  it('lit la cible posee en TETE de la sortie du scout', () => {
    expect(
      lireCibleScout(
        scout('CIBLE: durcir la porte anti-boucle', 'POURQUOI: 19,38 $ de tours perdus', '| autre piste |')
      )
    ).toEqual({ statut: 'cible', cible: 'durcir la porte anti-boucle' })
  })

  it('la JUSTIFICATION `— parce que ...` ne fait pas partie de la cible', () => {
    expect(lireCibleScout('CIBLE: durcir la porte — parce que 19,38 $ perdus')).toEqual({
      statut: 'cible',
      cible: 'durcir la porte'
    })
  })

  it('accepte les decorations de mise en forme autour de la ligne', () => {
    expect(lireCibleScout(scout('**CIBLE :** ranger les journaux', 'POURQUOI: bruit'))).toEqual({
      statut: 'cible',
      cible: 'ranger les journaux'
    })
  })

  it('CAS LIMITE — une ligne CIBLE: NOYEE au milieu du texte compte quand meme', () => {
    expect(lireCibleScout(scout('Voici mes pistes :', '', 'CIBLE: reprendre le cache'))).toEqual({
      statut: 'cible',
      cible: 'reprendre le cache'
    })
  })

  it('CAS LIMITE — la PREMIERE ligne CIBLE: fait foi, les suivantes sont ignorees', () => {
    expect(lireCibleScout(scout('CIBLE: la premiere', 'CIBLE: la seconde'))).toEqual({
      statut: 'cible',
      cible: 'la premiere'
    })
  })
})

describe('lireCibleScout — aucune cible = fin de run', () => {
  it('rend « aucune-cible » quand le scout n’ecrit AUCUNE ligne CIBLE:', () => {
    expect(lireCibleScout(scout('| piste | cout |', '| ranger | faible |'))).toEqual({
      statut: 'aucune-cible'
    })
  })

  it('rend « aucune-cible » quand le scout ecrit explicitement CIBLE: aucune', () => {
    expect(lireCibleScout('CIBLE: aucune')).toEqual({ statut: 'aucune-cible' })
    expect(lireCibleScout('CIBLE: rien')).toEqual({ statut: 'aucune-cible' })
  })

  it('« CIBLE: aucune — raison » compte comme aucune cible, justification comprise', () => {
    expect(lireCibleScout('CIBLE: aucune — rien de rentable a court terme')).toEqual({
      statut: 'aucune-cible'
    })
  })

  it('CAS LIMITE — une ligne CIBLE: VIDE ne vaut pas une cible', () => {
    expect(lireCibleScout(scout('CIBLE:', 'POURQUOI: je ne sais pas'))).toEqual({
      statut: 'aucune-cible'
    })
  })

  it('CAS LIMITE — un texte vide est une fin, pas une erreur', () => {
    expect(lireCibleScout('')).toEqual({ statut: 'aucune-cible' })
  })
})

describe('lireCibleScout — cible destructrice', () => {
  it('refuse de lancer tout seul une cible qui DETRUIT', () => {
    expect(lireCibleScout('CIBLE: supprimer les 6 396 dossiers de run accumules')).toEqual({
      statut: 'cible-destructrice',
      cible: 'supprimer les 6 396 dossiers de run accumules'
    })
  })

  it('couvre les formulations techniques les plus couteuses', () => {
    for (const cible of [
      'rm -rf out/',
      'git reset --hard origin/main',
      'faire un force push sur main',
      'DROP TABLE conversations',
      'ecraser le dossier de donnees utilisateur'
    ])
      expect(lireCibleScout(`CIBLE: ${cible}`).statut).toBe('cible-destructrice')
  })

  it('CAS LIMITE — « supprimer » dans une piste ECARTEE ne contamine pas la cible retenue', () => {
    expect(
      lireCibleScout(scout('CIBLE: documenter la porte anti-boucle', 'Ecartee : supprimer le cache'))
    ).toEqual({ statut: 'cible', cible: 'documenter la porte anti-boucle' })
  })
})

/*
 * ===========================================================================================
 * LA VRAIE PORTE — ce qui suit teste la DECISION D'ENVOI, pas l'etiquetage d'une chaine.
 *
 * Objection deja emise par le controle final sur le run precedent : `lireCibleScout` n'est
 * branchee NULLE PART, donc les tests ci-dessus decrivent une regle que le mode auto n'applique
 * pas. Ces tests-la echouent tant que `deciderRelanceAuto` ignore la ligne `CIBLE:` — c'est leur
 * role. Ils sont ROUGES pour cause de COMPORTEMENT ABSENT, pas de compilation.
 * ===========================================================================================
 */
const agent = (texte: string): Msg =>
  ({ role: 'assistant', content: texte, parts: [{ kind: 'text', text: texte }] }) as unknown as Msg
const humain = (texte: string): Msg => ({ role: 'user', content: texte }) as Msg

const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}

/** Un livrable de scout realiste : un tableau de pistes, et une cloture qui propose une suite. */
const SCOUT_AVEC_TABLEAU = [
  '| # | piste | cout |',
  '| 1 | durcir la porte anti-boucle | faible |',
  '| 2 | ranger les journaux | moyen |',
  '',
  '👉 Recommandé — enchaîne sur le tableau ci-dessus'
].join('\n')

describe('deciderRelanceAuto — apres un SCOUT, la ligne CIBLE: commande l’envoi', () => {
  it('1. `CIBLE: X — parce que Y` en tete : la suite PART, et son texte porte X', () => {
    const fil = [
      humain('scout sur le mode auto'),
      agent(
        [
          'CIBLE: durcir la porte anti-boucle — parce que 19,38 $ de tours ont ete perdus',
          '',
          SCOUT_AVEC_TABLEAU
        ].join('\n')
      )
    ]
    const decision = deciderRelanceAuto({ ...base, fil, tourEstUnScout: true })
    expect(decision.action).toBe('envoyer')
    expect(decision).toHaveProperty('texte', expect.stringContaining('durcir la porte anti-boucle'))
  })

  it('2. `CIBLE: aucune — raison` : la chaine s’ARRETE, avec une raison NOMMEE', () => {
    const fil = [
      humain('scout'),
      agent(['CIBLE: aucune — rien de rentable a court terme', '', SCOUT_AVEC_TABLEAU].join('\n'))
    ]
    const decision = deciderRelanceAuto({ ...base, fil, tourEstUnScout: true })
    expect(decision.action).toBe('arreter')
    expect(decision).toHaveProperty('raison', 'scout-sans-cible')
  })

  it('3. scout SANS ligne CIBLE: aucun enchainement a vide sur le tableau entier', () => {
    const fil = [humain('scout'), agent(SCOUT_AVEC_TABLEAU)]
    const decision = deciderRelanceAuto({ ...base, fil, tourEstUnScout: true })
    // Le defaut vecu : la rubrique « Recommandé » suffisait a lancer un tour PAYANT sans cible.
    expect(decision.action).not.toBe('envoyer')
    expect(decision).toHaveProperty('raison', 'scout-sans-cible')
  })

  it('4. cible DESTRUCTRICE : jamais d’envoi automatique, meme avec un prompt tout pret', () => {
    const fil = [
      humain('scout'),
      agent(
        [
          'CIBLE: supprimer les 6 396 dossiers de run accumules — parce que 12 Go',
          '',
          'AUTOWIN_PROMPT_V1: supprime les dossiers de run'
        ].join('\n')
      )
    ]
    const decision = deciderRelanceAuto({ ...base, fil, tourEstUnScout: true })
    expect(decision.action).not.toBe('envoyer')
    expect(decision).toHaveProperty('raison', 'cible-destructrice')
  })
})

describe('deciderRelanceAuto — NON-REGRESSION : hors scout, rien ne change', () => {
  const REPONSE_AVEC_SUITE = [
    '✅ Fait',
    '- un truc',
    '👉 Recommandé — passer en terrain',
    'AUTOWIN_PROMPT_V1: lance le terrain sur X'
  ].join('\n')

  it('un tour ORDINAIRE avec une suite part toujours, sans exiger de ligne CIBLE:', () => {
    const fil = [humain('go'), agent(REPONSE_AVEC_SUITE)]
    expect(deciderRelanceAuto({ ...base, fil })).toMatchObject({ action: 'envoyer' })
  })

  it('« Recommandé — rien » arrete toujours un fil d’arriere-plan', () => {
    expect(
      deciderRelanceAuto({ ...base, fil: [agent('👉 Recommandé — rien')] })
    ).toMatchObject({ action: 'arreter', raison: 'recommandation-rien' })
  })

  it('les garde-fous d’entree passent AVANT la lecture d’un scout', () => {
    const fil = [humain('scout'), agent(`CIBLE: une piste — parce que oui\n${SCOUT_AVEC_TABLEAU}`)]
    expect(deciderRelanceAuto({ ...base, fil, tourEstUnScout: true, occupe: true })).toEqual({
      action: 'attendre',
      raison: 'tour-en-cours'
    })
    expect(
      deciderRelanceAuto({ ...base, fil, tourEstUnScout: true, brouillonPresent: true })
    ).toEqual({ action: 'attendre', raison: 'brouillon' })
    expect(deciderRelanceAuto({ ...base, fil, tourEstUnScout: true, actif: false })).toEqual({
      action: 'attendre',
      raison: 'inactif'
    })
  })
})

/*
 * LE SIGNAL D'ENTREE — sans lui, la porte ci-dessus est branchee sur un champ que personne ne
 * remplit. `tourEstUnScout` se DERIVE du tour affiche : la derniere phase que le pipeline annonce.
 */
describe('dernierTourEstUnScout — d’ou vient le signal', () => {
  const tourPipeline = (...phases: string[]): Msg =>
    ({
      role: 'assistant',
      parts: [
        { kind: 'action', pipeline: phases.map((phase) => ({ phase })) },
        { kind: 'text', text: 'CIBLE: une piste' }
      ]
    }) as unknown as Msg

  it('un tour dont la DERNIERE phase est un scout', () => {
    expect(dernierTourEstUnScout([tourPipeline('scout')])).toBe(true)
  })

  it('un scout SUIVI d’un build n’est plus un tour de scout : le choix a deja ete fait', () => {
    expect(dernierTourEstUnScout([tourPipeline('scout', 'frame', 'build')])).toBe(false)
  })

  it('un tour sans pipeline annonce n’est pas un scout', () => {
    expect(dernierTourEstUnScout([agent('un texte quelconque')])).toBe(false)
    expect(dernierTourEstUnScout([])).toBe(false)
  })
})
