import { describe, expect, it } from 'vitest'
import { construireAutoriteProd } from './prod-guard'
import { CoffreAutorisationProd, definirPhrase } from './prod-passphrase'
import { PorteProd } from './prod-gate'

/**
 * LE POINT DE PASSAGE — le premier module de la chaîne qui REFUSE réellement.
 *
 * Le test central est celui-ci : un geste sur une base de PRODUCTION, sans jeton valide, est refusé.
 * Tout le reste décrit les façons de le contourner, et vérifie qu'aucune ne marche.
 */
const PHRASE = 'phrase-de-passe-de-reference'
const EMPREINTE = definirPhrase(PHRASE, 1_000)

const AUTORITE = construireAutoriteProd([
  { nature: 'base', nom: 'RIG_AMIENS', classe: 'prod', motif: 'greffe exploité' },
  { nature: 'base', nom: 'RIG_MAQUETTE', classe: 'non-prod' }
])

function porte(options: { phraseDefinie?: boolean } = {}) {
  const coffre = new CoffreAutorisationProd(EMPREINTE)
  return {
    coffre,
    porte: new PorteProd({
      autorite: () => AUTORITE,
      coffre: () => coffre,
      phraseDefinie: () => true,
      niveau: () => (options.phraseDefinie === false ? 'aucun' : 'phrase')
    })
  }
}

/** Obtient un vrai jeton, comme l'écran de saisie le ferait. */
function jetonPour(coffre: CoffreAutorisationProd, cible: string, operation: string): string {
  const ouverture = coffre.ouvrir(PHRASE, { cible, operation })
  if (!ouverture.accorde) throw new Error('ouverture attendue')
  return ouverture.jeton.valeur
}

describe('refus d’un geste de production', () => {
  /** LE test demandé : production + aucun jeton = refus. */
  it('REFUSE un geste sur une base de production quand aucun jeton n’est présenté', () => {
    const verdict = porte().porte.verifier({
      nature: 'base',
      nom: 'RIG_AMIENS',
      operation: 'sql-write'
    })
    expect(verdict.autorise).toBe(false)
    if (verdict.autorise) return
    expect(verdict.motif).toContain('greffe exploité')
    expect(verdict.demande).toEqual({
      cible: 'base:RIG_AMIENS',
      operation: 'sql-write',
      raison: expect.stringContaining('Production déclarée')
    })
  })

  it('REFUSE un jeton inventé', () => {
    const verdict = porte().porte.verifier({
      nature: 'base',
      nom: 'RIG_AMIENS',
      operation: 'sql-write',
      jeton: 'jeton-invente'
    })
    expect(verdict.autorise).toBe(false)
  })

  /** L'absence d'information n'est pas une permission : une base non déclarée est traitée en prod. */
  it('REFUSE une base non déclarée, faute de savoir ce qu’elle est', () => {
    const verdict = porte().porte.verifier({
      nature: 'base',
      nom: 'RIG_JAMAIS_VUE',
      operation: 'sql-write'
    })
    expect(verdict.autorise).toBe(false)
    if (verdict.autorise) return
    expect(verdict.motif).toContain('non déclarée')
  })

  it('REFUSE un jeton obtenu pour une AUTRE cible', () => {
    const { coffre, porte: p } = porte()
    const jeton = jetonPour(coffre, 'base:RIG_LILLE', 'sql-write')
    const verdict = p.verifier({
      nature: 'base',
      nom: 'RIG_AMIENS',
      operation: 'sql-write',
      jeton
    })
    expect(verdict.autorise).toBe(false)
  })

  it('REFUSE un jeton obtenu pour une AUTRE opération', () => {
    const { coffre, porte: p } = porte()
    const jeton = jetonPour(coffre, 'base:RIG_AMIENS', 'sql-read')
    const verdict = p.verifier({
      nature: 'base',
      nom: 'RIG_AMIENS',
      operation: 'sql-write',
      jeton
    })
    expect(verdict.autorise).toBe(false)
  })
})

describe('ce qui passe', () => {
  it('laisse passer un geste sur une base déclarée hors production, sans rien demander', () => {
    const verdict = porte().porte.verifier({
      nature: 'base',
      nom: 'RIG_MAQUETTE',
      operation: 'sql-write'
    })
    expect(verdict).toEqual({ autorise: true })
  })

  it('laisse passer un geste de production muni du bon jeton', () => {
    const { coffre, porte: p } = porte()
    const jeton = jetonPour(coffre, 'base:RIG_AMIENS', 'sql-write')
    expect(
      p.verifier({ nature: 'base', nom: 'RIG_AMIENS', operation: 'sql-write', jeton })
    ).toEqual({ autorise: true })
  })

  /** Le jeton est à usage unique : le second geste identique doit repasser par la saisie. */
  it('ne laisse pas REJOUER le même jeton', () => {
    const { coffre, porte: p } = porte()
    const jeton = jetonPour(coffre, 'base:RIG_AMIENS', 'sql-write')
    const geste = { nature: 'base', nom: 'RIG_AMIENS', operation: 'sql-write', jeton } as const
    expect(p.verifier(geste).autorise).toBe(true)
    expect(p.verifier(geste).autorise).toBe(false)
  })

  /** Un jeton présenté de travers est brûlé : on ne peut pas tâtonner sans coût. */
  it('brûle le jeton même quand il a été présenté pour la mauvaise cible', () => {
    const { coffre, porte: p } = porte()
    const jeton = jetonPour(coffre, 'base:RIG_AMIENS', 'sql-write')
    p.verifier({ nature: 'base', nom: 'RIG_AUTRE', operation: 'sql-write', jeton })
    expect(
      p.verifier({ nature: 'base', nom: 'RIG_AMIENS', operation: 'sql-write', jeton }).autorise
    ).toBe(false)
  })
})

describe('l’interrupteur', () => {
  /**
   * Tant qu'aucune phrase n'est définie, la porte DORT : sans cela, brancher ce module rendrait
   * `sql_query` inutilisable du jour au lendemain, puisque aucune base n'est encore déclarée.
   */
  it('laisse tout passer tant qu’aucune phrase n’est définie', () => {
    const { porte: p } = porte({ phraseDefinie: false })
    expect(p.verifier({ nature: 'base', nom: 'RIG_AMIENS', operation: 'sql-write' })).toEqual({
      autorise: true
    })
    expect(p.verifier({ nature: 'base', nom: 'RIG_JAMAIS_VUE', operation: 'sql-write' })).toEqual({
      autorise: true
    })
  })

  /** L'état ne doit JAMAIS laisser croire qu'une protection est active alors qu'elle dort. */
  it('dit en clair si la protection tourne ou dort', () => {
    expect(porte().porte.etat().active).toBe(true)
    const dormante = porte({ phraseDefinie: false }).porte.etat()
    expect(dormante.active).toBe(false)
    expect(dormante.raison).toContain('sans rien demander')
  })
})

/**
 * LE NIVEAU « CONFIRMATION » — le besoin réel : toute requête sur une base de production ouvre une
 * fenêtre « voulez-vous continuer ? ». Aucune phrase n'est demandée, et c'est assumé : ce niveau
 * protège du geste INVOLONTAIRE, pas de quelqu'un assis au clavier.
 */
describe('niveau confirmation', () => {
  function porte(niveau: 'aucun' | 'confirmation' | 'phrase') {
    const coffre = new CoffreAutorisationProd(definirPhrase('phrase-de-passe-longue'))
    return new PorteProd({
      autorite: () =>
        construireAutoriteProd([
          { nature: 'base', nom: 'BASE_PROD', classe: 'prod', motif: 'base de production' },
          { nature: 'base', nom: 'BASE_TEST', classe: 'non-prod' }
        ]),
      coffre: () => coffre,
      phraseDefinie: () => true,
      niveau: () => niveau
    })
  }

  it('REFUSE tant que l’utilisateur n’a pas confirmé, et dit quoi demander', () => {
    const verdict = porte('confirmation').verifier({
      nature: 'base',
      nom: 'BASE_PROD',
      operation: 'sql-read'
    })
    expect(verdict.autorise).toBe(false)
    if (verdict.autorise) return
    expect(verdict.motif).toContain('Confirmation requise')
    expect(verdict.niveau).toBe('confirmation')
    expect(verdict.demande.cible).toBe('base:BASE_PROD')
  })

  it('LAISSE PASSER après confirmation — sans aucune phrase', () => {
    const verdict = porte('confirmation').verifier({
      nature: 'base',
      nom: 'BASE_PROD',
      operation: 'sql-read',
      confirme: true
    })
    expect(verdict.autorise).toBe(true)
  })

  it('ne demande RIEN sur une base déclarée non-prod', () => {
    const verdict = porte('confirmation').verifier({
      nature: 'base',
      nom: 'BASE_TEST',
      operation: 'sql-read'
    })
    expect(verdict.autorise).toBe(true)
  })

  it('traite une base NON DÉCLARÉE comme de la production', () => {
    const verdict = porte('confirmation').verifier({
      nature: 'base',
      nom: 'BASE_INCONNUE',
      operation: 'sql-read'
    })
    expect(verdict.autorise).toBe(false)
  })

  it('n’accepte PAS une simple confirmation quand le niveau exige la phrase', () => {
    const verdict = porte('phrase').verifier({
      nature: 'base',
      nom: 'BASE_PROD',
      operation: 'sql-read',
      confirme: true
    })
    expect(verdict.autorise).toBe(false)
    if (verdict.autorise) return
    expect(verdict.niveau).toBe('phrase')
  })

  it('laisse tout passer au niveau « aucun » — désactivation choisie, jamais subie', () => {
    const verdict = porte('aucun').verifier({
      nature: 'base',
      nom: 'BASE_PROD',
      operation: 'sql-read'
    })
    expect(verdict.autorise).toBe(true)
  })

  it('dit son état en clair pour chaque niveau', () => {
    expect(porte('confirmation').etat()).toMatchObject({ active: true, niveau: 'confirmation' })
    expect(porte('phrase').etat()).toMatchObject({ active: true, niveau: 'phrase' })
    expect(porte('aucun').etat()).toMatchObject({ active: false, niveau: 'aucun' })
  })
})
