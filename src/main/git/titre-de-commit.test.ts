import { describe, expect, it } from 'vitest'
import { titreDeCommitAuto } from './titre-de-commit'

/**
 * Le titre d'un commit automatique dit ce qui a changé, au format `type(zone): phrase (conv-NNN)`.
 * Une demande elliptique (« vazy ») n'en dit rien : elle ne doit jamais devenir le titre.
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
   * Une réponse en anglais (réglage Settings · Interface) donne un « ✅ Fait » en anglais, chemin
   * `D:\…` compris. Le message de commit suit la règle du projet (AGENTS.md : français), pas la langue
   * de l'interface. ENTRÉE QUI DOIT FAIRE ÉCHOUER UN MAUVAIS CORRECTIF : la réponse anglaise
   * ci-dessous avec `langueDuCompteRendu: 'en'` — un titre encore tiré du « ✅ Fait » commence par
   * « Created ».
   */
  const COMPTE_RENDU_ANGLAIS = [
    '### ✅ Fait',
    '1. Created D:\\AutoWinOS\\src\\main\\git\\titre-bandeau-git.ts. It turns the git report into a status',
    '2. Added 4 tests'
  ].join('\n')

  it('réponse en anglais : le titre vient de la demande, jamais du « ✅ Fait » traduit', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1573',
        demande: 'le titre du bloc git doit dire si le push a réussi',
        compteRendu: COMPTE_RENDU_ANGLAIS,
        langueDuCompteRendu: 'en',
        fichiers: ['src/main/git/titre-bandeau-git.ts', 'src/main/git/titre-bandeau-git.test.ts']
      })
    ).toBe(
      'feat(titre-bandeau-git): le titre du bloc git doit dire si le push a réussi (conv-1573)'
    )
  })

  it('réponse en anglais et demande elliptique : le titre décrit les fichiers, en français', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1573',
        demande: 'vazy',
        compteRendu: COMPTE_RENDU_ANGLAIS,
        langueDuCompteRendu: 'en',
        fichiers: ['src/main/git/titre-bandeau-git.ts', 'src/main/git/titre-bandeau-git.test.ts']
      })
    ).toBe('feat(titre-bandeau-git): modifie titre-bandeau-git.ts et 1 fichier de test (conv-1573)')
  })

  // Jumeau accepté : la MÊME réponse, déclarée française, garde sa 1re action.
  it('réponse en français : le « ✅ Fait » reste la source, chemin absolu réduit au nom du fichier', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1573',
        demande: 'vazy',
        compteRendu:
          '### ✅ Fait\n1. Créé D:\\AutoWinOS\\src\\main\\git\\titre-bandeau-git.ts : un statut lisible',
        langueDuCompteRendu: 'fr',
        fichiers: ['src/main/git/titre-bandeau-git.ts']
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

/**
 * Trois tours de chat réels, sans bloc « ✅ Fait ». La demande tapée ne devient jamais le titre quand
 * c'est une relance ou un symptôme : le titre nomme alors les fichiers publiés. La réponse est neutre.
 */
describe('titre sans « ✅ Fait » : la relance et le symptôme ne deviennent pas le titre', () => {
  const REPONSE_SANS_FAIT =
    'Le test échoue pour la bonne raison. Je corrige la logique et je relance les tests.'

  it('relance « oui fais le » : le titre nomme les fichiers publiés', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1711',
        demande: 'oui fais le',
        compteRendu: REPONSE_SANS_FAIT,
        fichiers: [
          'src/renderer/src/components/ChatView.branche-copie-du-fil.test.tsx',
          'src/renderer/src/components/ChatView.tsx',
          'src/renderer/src/components/copie-du-fil-entete.test.ts',
          'src/renderer/src/components/copie-du-fil-entete.ts',
          'src/renderer/src/textes-ecrans/chat-fil.ts'
        ]
      })
    ).toBe('feat(ChatView): modifie ChatView.tsx, copie-du-fil-entete.ts, chat-fil.ts (conv-1711)')
  })

  it('symptôme « je vois encore… » : un bug signalé donne fix, et le titre nomme les fichiers', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1699',
        demande: 'je vois encore les tanukis de mes collegues leur /gc et /curation',
        compteRendu: REPONSE_SANS_FAIT,
        fichiers: [
          'skills/gc/SKILL.md',
          'src/main/ipc/chat.ts',
          'src/main/skills/skill-pipeline.test.ts',
          'src/main/skills/skill-pipeline.ts',
          'src/main/task-manager/chat-dispatch.test.ts',
          'src/main/task-manager/chat-dispatch.ts',
          'src/main/task-manager/curate-seed.test.ts',
          'src/main/task-manager/curate-seed.ts',
          'src/main/task-manager/gc-seed.test.ts',
          'src/main/task-manager/gc-seed.ts',
          'src/main/task-manager/menage-sur-cet-ordinateur.ts'
        ]
      })
    ).toBe('fix(SKILL): modifie SKILL.md, chat.ts, skill-pipeline.ts et 4 autres (conv-1699)')
  })

  it('symptôme « quand … devrait… » : même règle, le titre nomme les fichiers', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1719',
        demande: 'quand ca fait ca ca devrait remonter a la superconv',
        compteRendu: REPONSE_SANS_FAIT,
        fichiers: [
          'src/main/commands/catalogue.ts',
          'src/main/orchestration/plans-de-lots-app.ts',
          'src/main/orchestration/plans-de-lots-app.valider.test.ts',
          'src/shared/plan-de-lots.test.ts',
          'src/shared/plan-de-lots.ts'
        ]
      })
    ).toBe(
      'fix(catalogue): modifie catalogue.ts, plans-de-lots-app.ts, plan-de-lots.ts (conv-1719)'
    )
  })

  it('relance seule, sans fichier : le repli ne recopie pas la relance', () => {
    expect(titreDeCommitAuto({ id: 'conv-5', demande: 'oui', repli: 'travail du chat' })).toBe(
      'auto(conv-5): travail du chat'
    )
  })

  it('« ✅ Fait » réduit à une relance : le titre vient de la demande, puis des fichiers, jamais de « ok »', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-6',
        demande: 'oui fais le',
        compteRendu: '### ✅ Fait\n1. ok',
        fichiers: ['src/main/git/a.ts']
      })
    ).toBe('feat(a): modifie a.ts (conv-6)')
  })

  it('nature : découper ou renommer un module est un refactor', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-7',
        demande: 'découpe le module de titre en deux fichiers',
        fichiers: ['src/main/git/titre-de-commit.ts']
      })
    ).toBe('refactor(titre-de-commit): découpe le module de titre en deux fichiers (conv-7)')
  })
})

/**
 * fix-ok: cause mesurée — la liste fermée des relances laisse passer « vas-y, lance-le maintenant », et
 * le repli recopie « /build fais le » ainsi que les symptômes sans verbe de travail. La garde tient donc
 * sur une preuve positive : une demande ne devient titre que si elle nomme un changement.
 * Chaque refus a son jumeau accepté, plus bas.
 */
describe('relance et symptôme sous une autre forme : jamais en titre', () => {
  it.each([
    'vas-y, lance-le maintenant',
    'oui fais le ca marche',
    'allez, on continue et on pousse',
    'tu peux le lancer maintenant',
    'parfait, on valide'
  ])('avec un fichier, « %s » ne devient pas le titre : le titre nomme le fichier', (demande) => {
    expect(titreDeCommitAuto({ id: 'conv-1', demande, fichiers: ['src/main/git/a.ts'] })).toBe(
      'feat(a): modifie a.ts (conv-1)'
    )
  })

  it.each([
    '/build fais le',
    'vas-y, lance-le maintenant',
    'oui fais le ca marche',
    'je vois encore les tanukis de mes collegues',
    'je vois encore un doublon, il faut le corriger'
  ])('sans fichier, « %s » tombe sur le repli, jamais sur la phrase tapée', (demande) => {
    expect(titreDeCommitAuto({ id: 'conv-3', demande })).toBe('auto(conv-3): travail du chat')
  })

  it('jumeau accepté : « oui, ajoute … » garde la demande, sans l’interjection', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1',
        demande: 'oui, ajoute le bouton Exporter',
        fichiers: ['src/main/git/a.ts']
      })
    ).toBe('feat(a): ajoute le bouton Exporter (conv-1)')
  })

  it('jumeau accepté : « vas-y, corrige … » est une réparation, pas une relance', () => {
    expect(
      titreDeCommitAuto({
        id: 'conv-1',
        demande: 'vas-y, corrige le bouton Stop',
        fichiers: ['src/main/git/a.ts']
      })
    ).toBe('fix(a): corrige le bouton Stop (conv-1)')
  })
})
