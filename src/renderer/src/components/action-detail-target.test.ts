import { describe, expect, it } from 'vitest'
import { hasConsultableRun, localActionDetails } from './action-detail-target'

/**
 * Constate en usage reel : « 1 action terminee · 1 action en cours — edit_file · verify », clic sur le
 * bloc -> RIEN. Seule une orchestration produit une carte dans Workflows ; les commandes locales n'en
 * creent aucune, donc le scroll visait un element inexistant.
 */
describe('hasConsultableRun — ne promet Workflows que s’il y a un run', () => {
  it('FAUX pour les commandes locales (le cas du bug)', () => {
    expect(hasConsultableRun([{ name: 'edit_file' }, { name: 'verify' }])).toBe(false)
    expect(hasConsultableRun([{ name: 'brain_query' }])).toBe(false)
    expect(hasConsultableRun([])).toBe(false)
  })

  it('VRAI pour une orchestration', () => {
    expect(hasConsultableRun([{ name: 'orchestrate' }])).toBe(true)
    // Groupe mixte : un seul run suffit a rendre Workflows pertinent.
    expect(hasConsultableRun([{ name: 'edit_file' }, { name: 'orchestrate' }])).toBe(true)
  })

  it('VRAI si l’action porte une reference de run, quel que soit son nom', () => {
    expect(hasConsultableRun([{ name: 'autre', data: { runPath: 'C:/runs/x/RUN.md' } }])).toBe(true)
    expect(hasConsultableRun([{ name: 'autre', data: { runId: 'r-1' } }])).toBe(true)
    expect(hasConsultableRun([{ name: 'autre', data: { runPath: 42 } }])).toBe(false)
  })
})

describe('localActionDetails — ce qui s’affiche SUR PLACE faute de run', () => {
  it('montre le DIFF d’une edition', () => {
    const [detail] = localActionDetails([
      { name: 'edit_file', ok: true, data: { allowed: true, diff: '- a\n+ b' } }
    ])
    expect(detail).toMatchObject({ name: 'edit_file', ok: true })
    expect(detail.text).toContain('+ b')
  })

  it('une verification qui PASSE ne montre que son verdict', () => {
    // La sortie d'un succes est du bruit : des milliers de lignes d'outil, tronquees a leur queue,
    // sous un « exit 0 » qui disait deja tout. Personne ne les lit.
    const [detail] = localActionDetails([
      { name: 'verify', ok: true, data: { allowed: true, exitCode: 0, output: '1 test pass' } }
    ])
    expect(detail.text).toBe('exit 0')
  })

  it('une verification qui ECHOUE montre sa sortie — c’est la qu’on la lit', () => {
    const [detail] = localActionDetails([
      { name: 'verify', ok: true, data: { allowed: true, exitCode: 1, output: 'assertion failed' } }
    ])
    expect(detail.text).toContain('exit 1')
    expect(detail.text).toContain('assertion failed')
  })

  it('un REFUS montre sa raison, et est marque non-ok', () => {
    const [detail] = localActionDetails([
      { name: 'edit_file', data: { allowed: false, reason: 'chemin hors du workspace' } }
    ])
    expect(detail.ok).toBe(false)
    expect(detail.text).toBe('chemin hors du workspace')
  })

  it('la raison PRIME sur le reste (c’est l’info la plus utile)', () => {
    const [detail] = localActionDetails([
      { name: 'verify', data: { allowed: false, reason: 'aucun script test', output: 'bruit' } }
    ])
    expect(detail.text).toBe('aucun script test')
  })

  it('ignore ce qui n’a rien a lire (pas de ligne vide dans le fil)', () => {
    expect(
      localActionDetails([
        { name: 'x' },
        { name: 'y', data: {} },
        { name: 'z', data: { output: '  ' } }
      ])
    ).toEqual([])
  })

  it('exit code SEUL suffit (une verification sans sortie reste informative)', () => {
    expect(localActionDetails([{ name: 'verify', data: { exitCode: 1 } }])[0].text).toBe('exit 1')
  })
})

/** Contrat de CABLAGE : le bloc ne doit plus promettre Workflows quand il n'y a rien a y voir. */
describe('cablage du bloc d’activite', () => {
  const parts = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    return fs.readFileSync(path.join(__dirname, 'ChatView.parts.tsx'), 'utf8')
  }

  it('le clic est INERTE sans run consultable (au lieu de scroller vers rien)', () => {
    const source = parts()
    expect(source).toContain('hasConsultableRun(actions)')
    expect(source).toContain('if (!runConsultable) return')
  })

  it('la fleche « ouvrir » ne s’affiche que s’il y a vraiment un run', () => {
    // Assertion sur l'INTENTION, pas sur l'indentation : la fleche a ete imbriquee dans le ternaire
    // du depliage (le clic principal deplie le pourquoi), donc `{runConsultable && (` litteral n'y
    // est plus. La garde, elle, doit rester.
    expect(parts()).toContain('runConsultable && (')
  })

  it('le bouton d’ouverture du run n’existe que s’il y a un run à ouvrir', () => {
    expect(parts()).toContain('why.length > 0 && runConsultable && (')
  })

  it('le detail local est rendu dans le fil', () => {
    const source = parts()
    expect(source).toContain('localActionDetails(actions)')
    expect(source).toContain('activity-local-details')
  })
})

/**
 * DEFAUT VECU le 2026-08-18 : « 1 action avec erreur — graphify » dans le fil, et RIEN de plus.
 *
 * Une commande qui echoue rend `{ ok: false, error: <message> }` (`commands.ts:1120`). Or
 * `localActionDetails` ne lisait que `reason`, `diff`, `output`/`exitCode` et `knowledge` : sans
 * texte trouve, l'action etait purement IGNOREE. L'utilisateur voyait donc l'echec sans jamais
 * pouvoir savoir pourquoi — la seule information qui compte quand quelque chose casse.
 */
describe('localActionDetails — la cause d un echec doit se lire dans le fil', () => {
  it("expose le message d'erreur d'une commande qui a echoue", () => {
    const details = localActionDetails([
      { name: 'graphify', ok: false, data: { ok: false, error: 'graphify: binaire introuvable' } }
    ])
    expect(details).toHaveLength(1)
    expect(details[0].text).toContain('binaire introuvable')
    expect(details[0].ok).toBe(false)
  })

  it('un refus explicite garde la priorite sur le message brut', () => {
    const details = localActionDetails([
      {
        name: 'graphify',
        ok: false,
        data: { allowed: false, reason: 'chemin hors du workspace', error: 'EACCES' }
      }
    ])
    expect(details[0].text).toBe('chemin hors du workspace')
  })

  it("une action qui reussit sans rien a raconter reste silencieuse", () => {
    expect(localActionDetails([{ name: 'graphify', ok: true, data: { ok: true } }])).toHaveLength(0)
  })
})

/**
 * DEFAUT VECU le 2026-08-19 : « 1 action avec erreur — edit_file », et toujours rien au clic.
 *
 * Le correctif de la veille exposait `data.error` — en SUPPOSANT que `data` est un objet. Or un
 * `edit_file` en echec rend une CHAINE, verifiee dans les messages reels (conv-1308, conv-1326) :
 *   "Le bureau edit_file a ete conserve : publication automatique incomplete"
 * `asRecord()` rend alors `undefined`, et `if (!data) continue` SAUTE l'action. La cause etait la,
 * entiere, et se faisait jeter parce que le lecteur ne connaissait qu'une seule forme.
 *
 * Les sorties reelles atteignent 187 000 caracteres (une suite de tests entiere) : on borne, sinon
 * le fil devient illisible — c'est la lecon deja apprise sur `output` quand exitCode vaut 0.
 */
describe('localActionDetails — un data en CHAINE porte aussi la cause', () => {
  it('expose le message quand data est une chaine, forme reelle de edit_file', () => {
    const details = localActionDetails([
      {
        name: 'edit_file',
        ok: false,
        data: 'Le bureau edit_file a ete conserve : publication automatique incomplete'
      }
    ])
    expect(details).toHaveLength(1)
    expect(details[0].text).toContain('publication automatique incomplete')
    expect(details[0].ok).toBe(false)
  })

  it('borne une sortie enorme au lieu de noyer le fil', () => {
    const details = localActionDetails([
      { name: 'edit_file', ok: false, data: `Verification echouee : ${'x'.repeat(200_000)}` }
    ])
    expect(details).toHaveLength(1)
    expect(details[0].text.length).toBeLessThan(4_000)
    expect(details[0].text).toContain('Verification echouee')
  })

  it('une chaine vide ne fabrique pas une ligne vide', () => {
    expect(localActionDetails([{ name: 'edit_file', ok: false, data: '   ' }])).toHaveLength(0)
  })
})

/**
 * RETOUR UTILISATEUR du 2026-08-19 : « c'est pas super clair a comprendre pour moi ».
 *
 * Le correctif precedent exposait bien la cause — mais BRUTE : 3000 caracteres de sortie vitest avec
 * les codes ANSI du terminal. L'utilisateur voyait enfin quelque chose, sans pouvoir le lire.
 *
 * Dans ce pavé, trois choses portent l'information : la premiere ligne (LA cause), les tests qui
 * echouent, et l'erreur reelle. Tout le reste — couleurs, tests verts, compteurs de duree — est du
 * bruit qui ENTERRE le signal. Montrer trop equivaut a ne rien montrer.
 */
describe('localActionDetails — la sortie brute devient lisible', () => {
  const SORTIE_REELLE = [
    'Vérification du bureau échouée (npm run test:unit) : …[tronqué — 185347 caractères omis]',
    '\u001b[31m   \u001b[31m×\u001b[31m appendBoundedArchive — cout de rotation borne\u001b[39m\u001b[32m 112\u001b[39m',
    'OK   — un refus déclaré est un ÉCHEC malgré `completed`',
    'OK   — le motif nomme le refus',
    ' \u001b[32m✓\u001b[39m scripts/cdp-verdict-collection.test.mjs \u001b[2m(1 test)\u001b[22m',
    '\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m src/main/activity/brain-trace-spool.test.ts',
    '\u001b[31m\u001b[1mTypeError\u001b[22m: appendBoundedArchive is not a function\u001b[39m',
    '\u001b[2m      Tests \u001b[22m \u001b[31m2 failed\u001b[39m | \u001b[32m6852 passed\u001b[39m'
  ].join('\n')

  const detail = (): string =>
    localActionDetails([{ name: 'edit_file', ok: false, data: SORTIE_REELLE }])[0].text

  it('ne montre plus AUCUN code de couleur du terminal', () => {
    // eslint-disable-next-line no-control-regex
    expect(detail()).not.toMatch(/\u001b\[/)
  })

  it('garde la CAUSE, en tete', () => {
    expect(detail().split('\n')[0]).toContain('Vérification du bureau échouée')
  })

  it("garde l'erreur reelle et le test fautif", () => {
    const texte = detail()
    expect(texte).toContain('appendBoundedArchive is not a function')
    expect(texte).toContain('brain-trace-spool.test.ts')
  })

  it('jette le bruit : les lignes VERTES et les compteurs de reussite', () => {
    const texte = detail()
    expect(texte).not.toContain('cdp-verdict-collection')
    expect(texte).not.toContain('un refus déclaré est un ÉCHEC')
  })

  it('tient en quelques lignes, pas en pavé', () => {
    expect(detail().split('\n').length).toBeLessThanOrEqual(8)
  })
})
