import { describe, expect, it } from 'vitest'
import { titreDeCommitAuto } from './titre-de-commit'

/**
 * TITRES DE COMMIT AUTOMATIQUES (conv-1069, candidat 6 du scout). Le 2026-10-22, 125 des 400
 * derniers commits étaient `auto(conv-N): <100 premiers caractères de la demande>` — par exemple
 * `auto(conv-1075): vazy`, qui ne dit rien de ce qui a changé. AGENTS.md exige
 * `type(zone): phrase (conv-NNN)`.
 *
 * L'entrée qui ferait échouer ces tests si la correction était fausse : la demande ELLIPTIQUE
 * « vazy » avec un compte rendu « ✅ Fait » — un titre encore tiré de la demande rend « vazy ».
 */
const COMPTE_RENDU = [
  'Le gel venait de la relecture complète du journal.',
  '',
  '### ✅ Fait',
  '1. **Corrigé** le gel de `journal-saisie.ts` : lecture par la fin du fichier',
  '2. Ajouté 6 tests',
  '',
  '📍 Maintenant : vert'
].join('\n')

describe('titreDeCommitAuto', () => {
  it('prend la 1re action de « ✅ Fait », pas la demande elliptique', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1075',
        demande: 'vazy',
        compteRendu: COMPTE_RENDU,
        fichiers: ['src/main/store/journal-saisie.ts', 'src/main/store/journal-saisie.test.ts']
      })
    ).toBe(
      'fix(journal-saisie): Corrigé le gel de journal-saisie.ts : lecture par la fin du fichier (conv-1075)'
    )
  })

  /**
   * Réponses en anglais depuis conv-1172 (27/10, réglage Settings · Interface) : 18 des 424
   * derniers commits commençaient par « Added/Created/Wrote… », chemin `D:\…` compris — par exemple
   * `feat(annonce-commit-local): Created D:\AutoWinOS\src\main\titre-bandeau-git.ts. It turns the git…`
   * (conv-1573). Le message de commit suit la règle du projet (AGENTS.md : français), pas la langue
   * de l'interface (conv-1581). ENTRÉE QUI DOIT FAIRE ÉCHOUER UN MAUVAIS CORRECTIF : la réponse
   * anglaise ci-dessous avec `langueDuCompteRendu: 'en'` — un titre encore tiré du « ✅ Fait »
   * commence par « Created ».
   */
  const COMPTE_RENDU_ANGLAIS = [
    '### ✅ Fait',
    '1. Created D:\\AutoWinOS\\src\\main\\titre-bandeau-git.ts. It turns the git report into a status',
    '2. Added 4 tests'
  ].join('\n')

  it('réponse en anglais : le titre vient de la demande, jamais du « ✅ Fait » traduit', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1573',
        demande: 'le titre du bloc git doit dire si le push a réussi',
        compteRendu: COMPTE_RENDU_ANGLAIS,
        langueDuCompteRendu: 'en',
        fichiers: ['src/main/titre-bandeau-git.ts', 'src/main/titre-bandeau-git.test.ts']
      })
    ).toBe('feat(titre-bandeau-git): le titre du bloc git doit dire si le push a réussi (conv-1573)')
  })

  it('réponse en anglais et demande elliptique : le titre décrit les fichiers, en français', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1573',
        demande: 'vazy',
        compteRendu: COMPTE_RENDU_ANGLAIS,
        langueDuCompteRendu: 'en',
        fichiers: ['src/main/titre-bandeau-git.ts', 'src/main/titre-bandeau-git.test.ts']
      })
    ).toBe('feat(titre-bandeau-git): modifie titre-bandeau-git.ts et 1 fichier de test (conv-1573)')
  })

  // Jumeau accepté : la MÊME réponse, déclarée française, garde sa 1re action (conv-1069).
  it('réponse en français : le « ✅ Fait » reste la source, chemin absolu réduit au nom du fichier', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1573',
        demande: 'vazy',
        compteRendu: '### ✅ Fait\n1. Créé D:\\AutoWinOS\\src\\main\\titre-bandeau-git.ts : un statut lisible',
        langueDuCompteRendu: 'fr',
        fichiers: ['src/main/titre-bandeau-git.ts']
      })
    ).toBe('feat(titre-bandeau-git): Créé titre-bandeau-git.ts : un statut lisible (conv-1573)')
  })

  it('lit le DERNIER bloc « ✅ Fait » quand la réponse en porte plusieurs', () => {
    const deux = `### ✅ Fait\n1. ancienne action\n\n### ✅ Fait\n1. ajoute le bouton Exporter\n`
    expect(titreDeCommitAuto({ id: 'conv-9', demande: 'go', compteRendu: deux })).toBe(
      'feat(chat): ajoute le bouton Exporter (conv-9)'
    )
  })

  it('sans « ✅ Fait », prend la 1re ligne d’une vraie demande', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1068',
        demande: 'enleve le bord blanc dans les coins\net garde le reste',
        fichiers: ['src/renderer/src/components/ChatComposer.tsx']
      })
    ).toBe('feat(ChatComposer): enleve le bord blanc dans les coins (conv-1068)')
  })

  it('REPLI : demande elliptique et aucun « ✅ Fait » → l’ancien format, rien d’inventé', () => {
    expect(titreDeCommitAuto({ id: 'conv-1062', demande: 'corriges tout' })).toBe(
      'auto(conv-1062): corriges tout'
    )
    expect(titreDeCommitAuto({ id: 'run-1', demande: '  ', repli: 'travail agent' })).toBe(
      'auto(run-1): travail agent'
    )
  })

  it('borne la phrase à 72 caractères, sur une limite de mot', () => {
    const longue = `ajoute ${'une très longue description '.repeat(10)}`
    const titre = titreDeCommitAuto({ id: 'conv-1', demande: longue })
    const phrase = titre.replace(/^feat\(chat\): /, '').replace(/ \(conv-1\)$/, '')
    expect(phrase.length).toBeLessThanOrEqual(72)
    expect(phrase.endsWith('…')).toBe(true)
    expect(phrase).not.toMatch(/\s…$/)
  })

  it('type : test si seuls des tests partent, docs si seuls des .md, fix sur un verbe de réparation', () => {
    const base = { id: 'conv-2', demande: 'ajoute la couverture du parseur' }
    expect(titreDeCommitAuto({ ...base, fichiers: ['src/a.test.ts'] })).toMatch(/^test\(a\): /)
    expect(titreDeCommitAuto({ ...base, fichiers: ['docs/guide.md'] })).toMatch(/^docs\(guide\): /)
    expect(titreDeCommitAuto({ id: 'conv-2', demande: 'répare le bouton Stop' })).toMatch(/^fix\(/)
  })

  it('zone : dossier commun de plusieurs fichiers, sinon le 1er fichier, sinon la commande slash', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-3',
        demande: 'ajoute la reprise',
        fichiers: ['src/main/runs/a.ts', 'src/main/runs/b.ts']
      })
    ).toMatch(/^feat\(runs\): /)
    expect(
      titreDeCommitAuto({
        id: 'conv-3',
        demande: 'ajoute la reprise',
        fichiers: ['src/main/dashboards/runs.ts', 'src/shared/run-blocked.ts']
      })
    ).toMatch(/^feat\(runs\): /)
    expect(
      titreDeCommitAuto({
        id: 'run-3e2',
        demande: '/scout comment améliorer ce graph',
        zoneParDefaut: 'agent'
      })
    ).toBe('feat(scout): comment améliorer ce graph (run-3e2)')
  })
})
