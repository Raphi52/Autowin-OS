import { describe, expect, it } from 'vitest'
import {
  conversationPretendueInaccessible,
  outilsFaussementAbsents
} from '../shared/outil-pretendu-absent'
import { parseScoutTable } from '../shared/scout-table'
import {
  exigeAgirPasAnnoncer,
  exigeCorrigerEtPoursuivre,
  exigeDireLEchec,
  exigeFaireLeGeste,
  exigePreuveAvantDePromettre,
  exigeUnChiffreVerifie
} from './chat-turn-messages'
import { ecritUneLecon } from './lecon-non-retenue'
import { plafonnerNotesScout } from './scout-plafond'

/**
 * LES GARDES QUI LISENT LE TEXTE LIBRE DE L'AGENT DOIVENT AUSSI LIRE L'ANGLAIS (conv-1197, 2026-10-28).
 *
 * Depuis la bascule anglaise (conv-1146), l'agent répond en anglais quand l'interface l'est. Les
 * repères imposés restent en français (`REPERES_GARDES_EN_FRANCAIS`), mais le TEXTE LIBRE, lui, est
 * en anglais : les gardes qui y cherchaient une tournure française ne voyaient plus rien. Deux effets
 * opposés, selon la garde :
 *  - elle se TAIT là où elle devait mordre (outil nié, plan annoncé, promesse, leçon non déposée,
 *    aveu de non-vérification du scout, geste rendu à l'utilisateur) ;
 *  - elle MORD à tort là où une tournure devait la désarmer (aveu d'échec, demande d'accord) : un
 *    agent honnête est relancé pour un aveu écrit en anglais.
 * Chaque cas anglais est suivi de son contre-exemple, pour que l'ajout ne fasse pas de faux positif.
 */

const CATALOGUE = ['edit_file', 'verify', 'orchestrate', 'read_file', 'conversation_read']

describe('outil prétendu absent — en anglais', () => {
  it('attrape la négation anglaise d’un outil du catalogue', () => {
    expect(
      outilsFaussementAbsents(
        "`edit_file` does not exist in this session's available catalog.",
        CATALOGUE
      )
    ).toEqual(['edit_file'])
    expect(outilsFaussementAbsents('`verify` is not available either.', CATALOGUE)).toEqual([
      'verify'
    ])
    expect(outilsFaussementAbsents("`verify` isn't available here.", CATALOGUE)).toEqual(['verify'])
    expect(outilsFaussementAbsents('`orchestrate` is unavailable.', CATALOGUE)).toEqual([
      'orchestrate'
    ])
  })

  it('CONTRE-EXEMPLE — « but » coupe le lien entre l’outil et la négation', () => {
    expect(
      outilsFaussementAbsents('I have `edit_file` but `git apply` is not available.', CATALOGUE)
    ).toEqual([])
  })

  it('lit un tableau de capacités coché « missing » ou « none »', () => {
    expect(outilsFaussementAbsents('| `edit_file` | missing |', CATALOGUE)).toEqual(['edit_file'])
    expect(outilsFaussementAbsents('| verify | none |', CATALOGUE)).toEqual(['verify'])
  })

  it('attrape « I can’t quote that conversation » quand conversation_read est là', () => {
    expect(conversationPretendueInaccessible("I can't quote that conversation.", CATALOGUE)).toBe(
      'conversation_read'
    )
    expect(
      conversationPretendueInaccessible(
        "The scout with 8 candidates only exists in my context through the frame's table.",
        CATALOGUE
      )
    ).toBe('conversation_read')
    expect(
      conversationPretendueInaccessible("I don't have access to the previous turns.", CATALOGUE)
    ).toBe('conversation_read')
  })

  it('CONTRE-EXEMPLES — un refus vrai, ou une négation citée, ne déclenche rien', () => {
    expect(conversationPretendueInaccessible("I don't have access to the server.", CATALOGUE)).toBe(
      null
    )
    expect(
      conversationPretendueInaccessible(
        'The check took my sentence "that I can\'t reread from inside" for a refusal to read a conversation.',
        CATALOGUE
      )
    ).toBe(null)
  })
})

describe('leçon écrite sans dépôt — en anglais', () => {
  it('reconnaît l’étiquette « Lesson: »', () => {
    expect(
      ecritUneLecon('Fixed.\n\n**Lesson**: when a step goes to a scheduled task, drop it.')
    ).toBe(true)
    expect(ecritUneLecon('- **Lesson learned:** read before writing.')).toBe(true)
    expect(ecritUneLecon('Lessons (for the next captures): check the size.')).toBe(true)
  })

  it('CONTRE-EXEMPLE — une simple mention du mot n’est pas une étiquette', () => {
    expect(ecritUneLecon('The two lessons you pasted back are already in the Brain.')).toBe(false)
  })
})

describe('plafond de preuve du scout — aveux en anglais', () => {
  const ENTETE = '| # | Score | Type | What | Why | How |\n|---|---|---|---|---|---|\n'
  const note = (pourquoi: string): number | undefined =>
    parseScoutTable(
      plafonnerNotesScout(`${ENTETE}| 1 | 80 | 🆕 new | X | ${pourquoi} | do it |\n`)
    )![0]!.score

  it('ramène à 50 une piste dont le Why avoue ne pas avoir vérifié', () => {
    for (const aveu of [
      "I haven't verified the caller",
      'I did not check the callers',
      'impact not verified',
      'unverified on disk',
      'the exact cause is not yet verified',
      'to be confirmed',
      'it is an inference from the name'
    ]) {
      expect(note(aveu), aveu).toBe(50)
    }
  })

  it('un chemin nommé lève le plafond, un chemin nié ne le lève pas', () => {
    expect(note('not verified for the UI, but checked in `gates/hooks.ts`')).toBe(80)
    expect(note("I haven't checked in `a.ts` or elsewhere")).toBe(50)
  })

  it('CONTRE-EXEMPLE — un constat sur le code n’est pas un aveu', () => {
    expect(note('the test checks X, not Y')).toBe(80)
  })
})

describe('gardes de clôture du chat — en anglais', () => {
  it('plan récité au futur sans action : mord', () => {
    expect(
      exigeAgirPasAnnoncer(
        'fix the checks that only read French',
        "I'll first identify the current behavior, then write a failing test.",
        false
      )
    ).toBe(true)
    expect(
      exigeAgirPasAnnoncer('Add a sort by date', "I'm going to start with the rail.", false)
    ).toBe(true)
  })

  it('CONTRE-EXEMPLES — une action faite, ou une question d’avis, ne mordent pas', () => {
    expect(exigeAgirPasAnnoncer('fix the checks', "I'll explain what changed.", true)).toBe(false)
    expect(
      exigeAgirPasAnnoncer('which option is best?', "I'd go with the second one.", false)
    ).toBe(false)
  })

  it('promesse d’un compte-rendu ultérieur : mord', () => {
    expect(
      exigePreuveAvantDePromettre("The run is started. I'll get back to you with the result.", true)
    ).toBe(true)
    expect(exigePreuveAvantDePromettre("I'll keep you posted.", true)).toBe(true)
    expect(
      exigePreuveAvantDePromettre("I'll send you the report as soon as the run finishes.", true)
    ).toBe(true)
  })

  it('CONTRE-EXEMPLE — un « as soon as » qui ne promet rien passe', () => {
    expect(
      exigePreuveAvantDePromettre('The cache is invalidated as soon as the file changes.', true)
    ).toBe(false)
  })

  it('aveu d’échec en anglais : ne relance pas un agent honnête', () => {
    expect(exigeDireLEchec(true, 'The edit failed: the target line moved.')).toBe(false)
    expect(exigeDireLEchec(true, "I couldn't apply the patch.")).toBe(false)
    expect(exigeDireLEchec(true, "It didn't work: the file is locked.")).toBe(false)
  })

  it('CONTRE-EXEMPLE — nier l’échec en anglais n’est pas l’avouer', () => {
    expect(exigeDireLEchec(true, '✅ Fait — all tests pass with no errors.')).toBe(true)
    expect(exigeDireLEchec(true, '✅ Fait — nothing failed.')).toBe(true)
  })

  it('mur réel dit en anglais : ne relance pas la reprise', () => {
    expect(exigeCorrigerEtPoursuivre(true, 'I need your approval to push to main.')).toBe(false)
    expect(exigeCorrigerEtPoursuivre(true, 'Should I delete the branch?')).toBe(false)
    expect(exigeCorrigerEtPoursuivre(true, "I can't reach the database from this machine.")).toBe(
      false
    )
  })

  it('CONTRE-EXEMPLE — un échec corrigeable reste relancé', () => {
    expect(exigeCorrigerEtPoursuivre(true, 'The patch failed because the line moved.')).toBe(true)
  })

  it('geste d’écran rendu à l’utilisateur : mord', () => {
    expect(exigeFaireLeGeste('To do:\n1. Go to Brave\n2. Enter the code CAP56FNHZ', true)).toBe(
      true
    )
    expect(exigeFaireLeGeste('All you have to do is enter the code CAP56FNHZ.', true)).toBe(true)
  })

  it('CONTRE-EXEMPLE — un mot de passe reste à l’utilisateur', () => {
    expect(exigeFaireLeGeste('To do:\n1. Enter your password', true)).toBe(false)
  })
})

describe('demande de compte — question posée en anglais', () => {
  const reponse = 'There are 42.'

  it('« how many », « count », « number of », « list », « total » : un compte sans lecture est relancé', () => {
    for (const question of [
      'How many test files are in src/main?',
      'Count the skills in the kit.',
      'What is the number of open runs?',
      'List the conversations from yesterday.',
      'Give me an inventory of the scripts.',
      'What is the total of lines in this file?'
    ]) {
      expect(exigeUnChiffreVerifie(question, reponse, false), question).toBe(true)
    }
  })

  it('une lecture faite désarme la relance', () => {
    expect(exigeUnChiffreVerifie('How many test files are there?', reponse, true)).toBe(false)
  })

  it('CONTRE-EXEMPLES — « count on », « count as », « a number of », « account » ne demandent aucun compte', () => {
    for (const question of [
      'Can I count on you to fix this today?',
      'Does a draft count as a deliverable?',
      'Fix a number of small bugs in the composer.',
      'Explain how the account settings work.',
      'How many is 2 + 2?'
    ]) {
      expect(exigeUnChiffreVerifie(question, 'Done.', false), question).toBe(false)
    }
  })
})
