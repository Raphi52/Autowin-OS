import { describe, expect, it } from 'vitest'
import type { ImportedModel } from '../modeles/models'
import type { RoleBinding } from '../profil/roles'
import {
  bindingAvecUltrathink,
  consommerUltrathinkTape,
  declarerUltrathinkTape,
  suivreLeTour,
  ultrathinkEnPleinTour
} from './ultrathink-du-tour'

const modele = (over: Partial<ImportedModel>): ImportedModel =>
  ({
    id: 'claude/opus-test',
    provider: 'claude',
    model: 'opus-test',
    label: 'Opus test',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium',
    ...over
  }) as ImportedModel

const liste = [
  modele({}),
  modele({
    id: 'codex/gpt-test',
    provider: 'codex',
    model: 'gpt-test',
    reasoningEfforts: ['low', 'medium', 'high']
  }),
  modele({ id: 'grok/grok-test', provider: 'grok', model: 'grok-test', reasoningEfforts: ['none'] })
]
const catalogue = (): ImportedModel[] => liste

describe('bindingAvecUltrathink — le réglage d’un tour ouvert par un mot tapé', () => {
  const chat: RoleBinding = { provider: 'claude', model: 'opus-test', reasoningEffort: 'medium' }

  it('sans mot tapé, rend le réglage tel quel sans lire le catalogue', () => {
    const jamaisLu = (): never => {
      throw new Error('catalogue lu sans mot tapé')
    }
    expect(bindingAvecUltrathink(chat, false, jamaisLu)).toBe(chat)
  })

  it('avec un mot tapé, monte ce tour à xhigh sans toucher au réglage reçu', () => {
    const tour = bindingAvecUltrathink(chat, true, catalogue)
    expect(tour).toEqual({ provider: 'claude', model: 'opus-test', reasoningEffort: 'xhigh' })
    expect(chat.reasoningEffort).toBe('medium')
  })

  it('garde un réglage déjà plus haut', () => {
    const max: RoleBinding = { ...chat, reasoningEffort: 'max' }
    expect(bindingAvecUltrathink(max, true, catalogue)).toBe(max)
  })

  it('prend le plus haut niveau du modèle quand il ne propose pas xhigh', () => {
    const codex: RoleBinding = { provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' }
    expect(bindingAvecUltrathink(codex, true, catalogue).reasoningEffort).toBe('high')
  })

  it('ne change rien pour un modèle sans réglage de réflexion', () => {
    const grok: RoleBinding = { provider: 'grok', model: 'grok-test' }
    expect(bindingAvecUltrathink(grok, true, catalogue)).toBe(grok)
  })

  it('Claude hors catalogue : xhigh, que le CLI accepte pour tous ses modèles', () => {
    const sansModele: RoleBinding = { provider: 'claude' }
    expect(bindingAvecUltrathink(sansModele, true, () => undefined).reasoningEffort).toBe('xhigh')
  })

  it('autre moteur hors catalogue : rien n’est déduit', () => {
    const inconnu: RoleBinding = { provider: 'codex', model: 'absent', reasoningEffort: 'low' }
    expect(bindingAvecUltrathink(inconnu, true, catalogue)).toBe(inconnu)
  })
})

describe('la déclaration de l’écran — seul un mot tapé à la main compte', () => {
  it('un message jamais déclaré (suite proposée, autre fil, tâche planifiée) ne compte pas', () => {
    expect(consommerUltrathinkTape('ultrathink corrige a.ts')).toBe(false)
  })

  it('un message déclaré compte une seule fois', () => {
    expect(declarerUltrathinkTape('ultrathink corrige b.ts')).toBe(true)
    expect(consommerUltrathinkTape('ultrathink corrige b.ts')).toBe(true)
    expect(consommerUltrathinkTape('ultrathink corrige b.ts')).toBe(false)
  })

  it('le texte déclaré se retrouve dans le message malgré le rognage et une suite ajoutée', () => {
    declarerUltrathinkTape('  ultrathink   corrige c.ts ')
    expect(consommerUltrathinkTape('ultrathink corrige c.ts\n\n[Pièce jointe : capture.png]')).toBe(
      true
    )
  })

  it('une déclaration ne sert pas à un autre texte', () => {
    declarerUltrathinkTape('ultrathink corrige d.ts')
    expect(consommerUltrathinkTape('ultrathink corrige e.ts')).toBe(false)
    expect(consommerUltrathinkTape('ultrathink corrige d.ts')).toBe(true)
  })

  it('une déclaration sans le mot est refusée : la parole de l’écran ne suffit pas', () => {
    expect(declarerUltrathinkTape('corrige f.ts')).toBe(false)
    expect(consommerUltrathinkTape('corrige f.ts')).toBe(false)
  })

  it('une déclaration vieille de plus de deux heures ne sert plus', () => {
    const hier = Date.now() - 3 * 60 * 60 * 1000
    declarerUltrathinkTape('ultrathink corrige g.ts', hier)
    expect(consommerUltrathinkTape('ultrathink corrige g.ts')).toBe(false)
  })
})

describe('ultrathinkEnPleinTour — un message envoyé pendant que le tour travaille', () => {
  const tourMoyen = (): RoleBinding => ({
    provider: 'claude',
    model: 'opus-test',
    reasoningEffort: 'medium'
  })

  it('mot tapé : le reste du tour monte à xhigh, et l’appel en cours est à couper', () => {
    const tour = tourMoyen()
    const fin = suivreLeTour('conv-a', tour, catalogue)
    declarerUltrathinkTape('ultrathink regarde aussi h.ts')
    expect(ultrathinkEnPleinTour('conv-a', 'ultrathink regarde aussi h.ts')).toBe(true)
    expect(tour.reasoningEffort).toBe('xhigh')
    fin()
  })

  it('jumeau : le même message non déclaré ne monte rien', () => {
    const tour = tourMoyen()
    const fin = suivreLeTour('conv-b', tour, catalogue)
    expect(ultrathinkEnPleinTour('conv-b', 'ultrathink regarde aussi h.ts')).toBe(false)
    expect(tour.reasoningEffort).toBe('medium')
    fin()
  })

  it('tour déjà à xhigh ou plus : rien à monter, rien à couper', () => {
    const tour: RoleBinding = { ...tourMoyen(), reasoningEffort: 'max' }
    const fin = suivreLeTour('conv-c', tour, catalogue)
    declarerUltrathinkTape('ultrathink regarde aussi i.ts')
    expect(ultrathinkEnPleinTour('conv-c', 'ultrathink regarde aussi i.ts')).toBe(false)
    expect(tour.reasoningEffort).toBe('max')
    fin()
  })

  it('tour fini : le suivi est levé, plus rien ne monte', () => {
    const tour = tourMoyen()
    suivreLeTour('conv-d', tour, catalogue)()
    declarerUltrathinkTape('ultrathink regarde aussi j.ts')
    expect(ultrathinkEnPleinTour('conv-d', 'ultrathink regarde aussi j.ts')).toBe(false)
    expect(tour.reasoningEffort).toBe('medium')
  })

  it('la fin d’un ancien tour ne lève pas le suivi du tour suivant du même fil', () => {
    const ancien = tourMoyen()
    const finAncien = suivreLeTour('conv-e', ancien, catalogue)
    const nouveau = tourMoyen()
    const finNouveau = suivreLeTour('conv-e', nouveau, catalogue)
    finAncien()
    declarerUltrathinkTape('ultrathink regarde aussi k.ts')
    expect(ultrathinkEnPleinTour('conv-e', 'ultrathink regarde aussi k.ts')).toBe(true)
    expect(nouveau.reasoningEffort).toBe('xhigh')
    finNouveau()
  })
})
