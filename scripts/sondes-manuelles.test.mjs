import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * UNE SONDE MARQUEE MANUELLE NE PEUT PAS ETRE BRANCHEE — ET C'EST LE CODE QUI LE TIENT.
 *
 * Le 2026-09-06, quatre sondes ont ete triees comme MANUELLES PAR NATURE, pour deux familles de
 * raisons : soit elles appellent un vrai pipeline (aucune fixture d'orchestration n'existe), soit
 * elles mesurent la QUALITE DU MODELE — un tour muet, l'exactitude d'une reponse — et une fixture
 * deterministe les rendrait vertes par construction, donc aveugles.
 *
 * Ecrire cette conclusion en commentaire ne protege de rien : le prochain passage relira la liste du
 * lanceur, pas les en-tetes. Cette garde fait du MARQUEUR un contrat verifiable : tant qu'une sonde
 * porte « MANUELLE PAR NATURE », elle ne peut pas entrer dans la file de `verifier-sondes-lecture`.
 * Pour l'y mettre, il faut d'abord RETIRER le marqueur — c'est-a-dire assumer et documenter que la
 * raison a disparu.
 */
const dossierScripts = join(process.cwd(), 'scripts')
const MARQUEUR = 'MANUELLE PAR NATURE'

/** Les sondes que le lanceur joue a chaque construction. */
function sondesDuLanceur() {
  const source = readFileSync(join(dossierScripts, 'verifier-sondes-lecture.mjs'), 'utf8')
  const bloc = source.slice(source.indexOf('const SONDES = ['), source.indexOf('\n]', source.indexOf('const SONDES = [')))
  return [...bloc.matchAll(/'([^']+\.mjs)'/g)].map((trouve) => trouve[1])
}

/** Les sondes qui se declarent manuelles dans leur propre en-tete. */
function sondesManuelles() {
  return readdirSync(dossierScripts)
    .filter((nom) => nom.startsWith('cdp-') && nom.endsWith('.mjs') && !nom.endsWith('.test.mjs'))
    .filter((nom) => readFileSync(join(dossierScripts, nom), 'utf8').includes(MARQUEUR))
}

describe('sondes manuelles', () => {
  it('aucune sonde marquee manuelle n est branchee sur la verification de construction', () => {
    const manuelles = new Set(sondesManuelles())
    const branchees = sondesDuLanceur().filter((nom) => manuelles.has(nom))
    expect(branchees).toEqual([])
  })

  /*
   * La garde doit avoir de la MATIERE : si plus aucune sonde ne porte le marqueur, elle passe au
   * vert sans rien verifier — le piege classique de l'echantillon vide.
   */
  it('le marqueur est reellement porte par des sondes', () => {
    /*
     * TROIS, ET NON PLUS QUATRE — le 2026-09-06, cdp-trois-conversations-proof a cesse d'etre
     * manuelle : elle joue desormais le scenario nominal de la fixture d'orchestration, gratuit et
     * deterministe. Son marqueur est donc RETIRE en connaissance de cause, ce qui est exactement la
     * porte prevue : « pour l'y mettre, il faut d'abord retirer le marqueur ».
     *
     * Ce compte n'est pas un objectif a tenir : c'est un garde-fou contre l'echantillon VIDE. Il
     * descend quand une sonde est reellement affranchie, jamais pour faire taire un rouge.
     */
    expect(sondesManuelles().length).toBeGreaterThanOrEqual(3)
  })

  /*
   * Symetrie : le lanceur doit citer des fichiers qui EXISTENT. Une sonde renommee ou retiree sans
   * mise a jour de la liste ferait echouer la construction sur un « fichier introuvable » — un
   * message qui n'aide personne.
   */
  it('toutes les sondes citees par le lanceur existent', () => {
    const presentes = new Set(readdirSync(dossierScripts))
    expect(sondesDuLanceur().filter((nom) => !presentes.has(nom))).toEqual([])
  })
})
