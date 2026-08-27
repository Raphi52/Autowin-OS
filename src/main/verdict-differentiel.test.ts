import { describe, expect, it } from 'vitest'
import { echecsNommes, noteDeDifferentiel, verdictDifferentiel } from './verify-command'

/**
 * Le differentiel decide de PUBLIER ou de REFUSER. Il n'a donc pas droit a une zone grise : tout ce
 * qu'il ne sait pas lire doit refuser, et tout echec nouveau doit refuser. Les tests ci-dessous sont
 * ecrits comme des SABOTAGES : chacun nomme l'entree qui le fait echouer si la mesure est fausse.
 *
 * Format lu, mesure sur une sortie reelle de vitest le 2026-08-27 :
 *   ` FAIL  src/main/x.test.ts > la suite > le test`
 */
const SAUT = String.fromCharCode(10)

const sortie = (...lignes: string[]): string => lignes.join(SAUT)

const A = ' FAIL  src/a.test.ts > suite A > rend 1'
const B = ' FAIL  src/b.test.ts > suite B > rend 2'
const C = ' FAIL  src/c.test.ts > suite C > rend 3'

describe('echecsNommes', () => {
  it('retient une ligne FAIL par test échoué, nom complet', () => {
    expect([...echecsNommes(sortie('RUN v3.2.7', A, 'Expected: 1', B))]).toEqual([
      'src/a.test.ts > suite A > rend 1',
      'src/b.test.ts > suite B > rend 2'
    ])
  })

  it('dépouille les séquences de couleur — sinon deux écritures du même échec ne se reconnaissent pas', () => {
    const colore = `[41m FAIL [49m src/a.test.ts > suite A > rend 1`
    expect(echecsNommes(colore).has('src/a.test.ts > suite A > rend 1')).toBe(true)
  })

  it('rend un ensemble VIDE sur une sortie qu’il ne sait pas lire — jamais un échec fantôme', () => {
    expect(echecsNommes(sortie('vitest: command not found')).size).toBe(0)
  })
})

describe('verdictDifferentiel — ce que l’ÉDITION a cassé', () => {
  it('publie quand tous les rouges étaient DÉJÀ là', () => {
    const verdict = verdictDifferentiel(
      { ok: false, output: sortie(A, B) },
      { ok: false, output: sortie(A, B) }
    )
    expect(verdict).toMatchObject({ concluant: true, publiable: true, nouvelles: [] })
    expect(verdict.preexistants).toHaveLength(2)
  })

  it('publie quand un rouge préexistant a DISPARU (une réparation n’est pas une régression)', () => {
    const verdict = verdictDifferentiel(
      { ok: false, output: sortie(A) },
      { ok: false, output: sortie(A, B) }
    )
    expect(verdict).toMatchObject({ publiable: true, nouvelles: [] })
  })

  it('REFUSE un échec nouveau, même noyé dans du bruit préexistant', () => {
    const verdict = verdictDifferentiel(
      { ok: false, output: sortie(A, B, C) },
      { ok: false, output: sortie(A, B) }
    )
    expect(verdict).toMatchObject({ concluant: true, publiable: false })
    expect(verdict.nouvelles).toEqual(['src/c.test.ts > suite C > rend 3'])
  })

  /*
   * LE TEST QUI JUSTIFIE DE COMPARER DES NOMS PLUTOT QUE DES COMPTEURS. Deux rouges avant, deux
   * rouges apres : un compteur conclurait « rien de nouveau » et publierait la regression.
   */
  it('REFUSE un échange à compteur constant — un réparé, un cassé', () => {
    const verdict = verdictDifferentiel(
      { ok: false, output: sortie(A, C) },
      { ok: false, output: sortie(A, B) }
    )
    expect(verdict.publiable).toBe(false)
    expect(verdict.nouvelles).toEqual(['src/c.test.ts > suite C > rend 3'])
  })

  it('REFUSE sans baseline — « on ne sait pas » n’ouvre pas de porte', () => {
    expect(verdictDifferentiel({ ok: false, output: sortie(A) }, undefined)).toMatchObject({
      concluant: false,
      publiable: false
    })
  })

  it('REFUSE une sortie rouge illisible (plafond, crash du runner, format changé)', () => {
    const plafond = 'vérification arrêtée après 600 s (plafond) — rien n’est prouvé'
    expect(
      verdictDifferentiel({ ok: false, output: plafond }, { ok: false, output: sortie(A) })
    ).toMatchObject({ concluant: false, publiable: false })
  })

  it('REFUSE quand la BASELINE est rouge mais illisible', () => {
    expect(
      verdictDifferentiel({ ok: false, output: sortie(A) }, { ok: false, output: 'crash' })
    ).toMatchObject({ concluant: false, publiable: false })
  })

  it('publie tout ce qui est vert sans rien différencier', () => {
    expect(verdictDifferentiel({ ok: true, output: '' }, undefined)).toMatchObject({
      concluant: true,
      publiable: true
    })
  })

  it('accepte une baseline VERTE : la base était saine, donc tout échec est nouveau', () => {
    const verdict = verdictDifferentiel({ ok: false, output: sortie(A) }, { ok: true, output: '' })
    expect(verdict).toMatchObject({ concluant: true, publiable: false })
    expect(verdict.nouvelles).toEqual(['src/a.test.ts > suite A > rend 1'])
  })
})

describe('noteDeDifferentiel', () => {
  it('NOMME les rouges écartés et son propre angle mort', () => {
    const note = noteDeDifferentiel(
      verdictDifferentiel({ ok: false, output: sortie(A) }, { ok: false, output: sortie(A) })
    )
    expect(note).toContain('src/a.test.ts > suite A > rend 1')
    expect(note).toContain('MASQUER')
    expect(note).not.toContain('la base est verte.')
  })
})
