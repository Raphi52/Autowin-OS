import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cibleDeVerification } from './verify-command'

/**
 * LE DÉFAUT, vécu le 2026-08-25. Un agent de chat devait prouver UN fichier de test. Il ne pouvait
 * pas : `verify` ne prend AUCUN argument et rejoue la suite entière, plafonnée à 600 s — qu'elle
 * dépasse. Ses quatre tentatives ont toutes échoué, dont trois sur « This command requires
 * approval », parce que le chat n'a pas de Bash. Faute de pouvoir exécuter, il a diagnostiqué par
 * lecture statique et affirmé un défaut « certain » que l'exécution a ensuite réfuté.
 *
 * POURQUOI ON NE LUI DONNE PAS BASH, et ce n'est pas de la frilosité : la voie
 * `--allowedTools "Bash(npm test)"` a été TESTÉE sur le vrai binaire et INVALIDÉE — le pattern ne
 * restreint rien, `echo BONJOUR` passait, avec et sans bypassPermissions (mesure notée dans
 * `commands.ts`). Autoriser « Bash mais seulement npm test » n'existe pas : c'est Bash tout court.
 *
 * CE QU'ON LUI DONNE À LA PLACE : le droit de NOMMER une cible. La frontière ne bouge pas — Autowin
 * choisit l'argv, `shell: false`, arguments séparés, donc aucune interpolation possible. Le modèle ne
 * fournit qu'un chemin, et ce chemin doit franchir toutes les gardes ci-dessous.
 */

const bac = (): string => {
  const parent = mkdtempSync(join(tmpdir(), 'cible-'))
  const racine = join(parent, 'depot')
  mkdirSync(join(racine, 'src', 'main'), { recursive: true })
  mkdirSync(join(racine, '.git'), { recursive: true })
  writeFileSync(join(racine, 'src', 'main', 'chose.test.ts'), '// test', 'utf8')
  writeFileSync(join(racine, 'src', 'main', 'chose.ts'), '// source', 'utf8')
  writeFileSync(join(racine, '.git', 'config.test.ts'), '// piege', 'utf8')
  /*
   * UN VOISIN HORS DU DEPOT, qui EXISTE et porte un nom de test.
   *
   * Sans lui, le test de remontee de chemin passait POUR LA MAUVAISE RAISON : `../x.test.ts` etait
   * refuse par la garde d'EXISTENCE, pas par la garde de remontee. Mesure du 2026-08-25 : en
   * retirant la garde `..`, les 13 tests restaient verts — le sabotage ne prouvait rien. Une cible
   * qui existe VRAIMENT hors du depot est la seule entree qui discrimine.
   */
  mkdirSync(join(parent, 'voisin'), { recursive: true })
  writeFileSync(join(parent, 'voisin', 'secret.test.ts'), '// hors depot', 'utf8')
  return racine
}

describe('la cible d’une vérification ciblée', () => {
  it('accepte un fichier de test du dépôt', () => {
    const racine = bac()

    expect(cibleDeVerification('src/main/chose.test.ts', racine)).toEqual({
      ok: true,
      chemin: 'src/main/chose.test.ts'
    })
  })

  it('normalise les séparateurs Windows', () => {
    const racine = bac()

    expect(cibleDeVerification('src\\main\\chose.test.ts', racine)).toEqual({
      ok: true,
      chemin: 'src/main/chose.test.ts'
    })
  })

  it('REFUSE une remontée de chemin, même vers un fichier qui EXISTE', () => {
    // La garde qui compte le plus : sans elle, le modèle désigne n'importe quel fichier du disque.
    // La cible visée existe réellement et porte un nom de test — c'est ce qui rend ce test
    // discriminant, là où un chemin inexistant serait refusé par la garde d'existence.
    const racine = bac()

    expect(cibleDeVerification('../voisin/secret.test.ts', racine).ok).toBe(false)
    expect(cibleDeVerification('src/../../voisin/secret.test.ts', racine).ok).toBe(false)
  })

  it('REFUSE un chemin absolu', () => {
    const racine = bac()

    expect(cibleDeVerification('C:/Windows/x.test.ts', racine).ok).toBe(false)
    expect(cibleDeVerification('/etc/x.test.ts', racine).ok).toBe(false)
  })

  it('REFUSE `.git`, même quand le fichier y ressemble à un test', () => {
    // L'entrée piégeuse : un nom qui franchirait la garde « c'est un test » tout en visant le dépôt.
    const racine = bac()

    expect(cibleDeVerification('.git/config.test.ts', racine).ok).toBe(false)
  })

  it('ACCEPTE un fichier source, en le marquant à vérifier PAR PORTÉE', () => {
    /*
     * CETTE ASSERTION DISAIT L'INVERSE, et elle encodait mon erreur.
     *
     * Elle exigeait le refus de tout fichier non-test. Vécu le 2026-08-25 sur conv-1404 : un agent
     * qui venait d'éditer un fichier source a demandé à le vérifier, s'est fait refuser, et le run a
     * échoué en laissant son bureau conservé. Refuser le cas le plus naturel — vérifier ce qu'on
     * vient de changer — était un faux refus.
     *
     * La bonne réponse était de ROUTER vers `vitest related`, qui existait déjà. Les gardes qui
     * protègent (remontée, absolu, `.git`, joker, absent) sont testées à part et restent des refus.
     */
    const racine = bac()

    expect(cibleDeVerification('src/main/chose.ts', racine)).toEqual({
      ok: true,
      chemin: 'src/main/chose.ts',
      parPortee: true
    })
  })

  it('REFUSE un fichier absent, au lieu de lancer une suite vide qui rendrait « vert »', () => {
    // Un fichier inexistant fait sortir vitest en ERREUR (« No test files found »), mais compter sur
    // ce hasard serait fragile : on refuse ici, avec un motif lisible.
    const racine = bac()

    expect(cibleDeVerification('src/main/jamais-ecrit.test.ts', racine).ok).toBe(false)
  })

  it('REFUSE un joker — une cible est UN fichier, pas un motif', () => {
    const racine = bac()

    expect(cibleDeVerification('src/**/*.test.ts', racine).ok).toBe(false)
  })

  it('rend un MOTIF lisible sur chaque refus', () => {
    // Un refus muet renverrait le modèle à la devinette, et c'est exactement ce qui a produit le
    // diagnostic statique erroné.
    const racine = bac()

    for (const mauvais of ['../voisin/secret.test.ts', 'C:/Windows/x.ts', 'src/main/absent.test.ts']) {
      const verdict = cibleDeVerification(mauvais, racine)
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.raison.length).toBeGreaterThan(10)
    }
  })
})

/**
 * LE CÂBLAGE — une garde pure que personne n'appelle ne garde rien.
 *
 * Mesuré après branchement : `npm run test:unit -- src/main/cible-de-verification.test.ts` rend
 * exit 0 en **258 ms**, contre une suite entière qui dépassait le plafond de 600 s.
 */
describe('le chat peut réellement nommer une cible', () => {
  const source = readFileSync(join(__dirname, 'commands.ts'), 'utf8')

  it('la commande `verify` DÉCLARE l’argument, sinon le modèle ne peut pas le passer', () => {
    // Un argument non déclaré n'atteint jamais le gestionnaire : la capacité serait invisible.
    expect(source).toMatch(/name: 'verify'[\s\S]{0,1600}?cible:/)
  })

  it('la cible traverse le dispatch jusqu’à l’exécution', () => {
    expect(source).toMatch(/case 'verify':[\s\S]{0,200}?a\.cible/)
    expect(source).toContain('cibleDeVerification(cible, decision.cwd)')
  })

  it('une cible REFUSÉE n’exécute rien, et rend son motif', () => {
    // Le bord qui compte : sur refus, on ne doit surtout pas retomber sur la suite complète — ce
    // serait transformer une erreur d'argument en 600 s de calcul.
    expect(source).toMatch(/cible refusée : \$\{verdict\.raison\}/)
  })

  it('l’argv est construit ICI, argument par argument — jamais une chaîne interpolée', () => {
    expect(source).toContain("argv = [...argv, '--', verdict.chemin]")
  })
})

/**
 * UN FICHIER SOURCE EST UNE CIBLE LÉGITIME — vécu le 2026-08-25 sur conv-1404.
 *
 * Un agent venait d'éditer `chat-pilotage-prompt.ts` et a demandé à vérifier CE fichier. Mon garde
 * l'a refusé : « la cible doit être un fichier de test ». C'était le cas le plus naturel qui soit —
 * on vérifie ce qu'on vient de changer — et le refus ne disait pas quoi faire à la place. Le run a
 * donc échoué, et son bureau `edit_file` est resté conservé, publication incomplète.
 *
 * Le mécanisme manquant existait DÉJÀ : `decideRelatedVerify` lance `vitest related <fichier> --run`,
 * c'est-à-dire les tests qui IMPORTENT le fichier édité. Mon garde n'avait pas à refuser, il avait à
 * ROUTER. Refuser une cible valide parce qu'on n'a pas pensé à son cas est un faux refus, et un faux
 * refus coûte un run entier.
 */
describe('une cible source est routée, pas refusée', () => {
  it('accepte un fichier SOURCE du dépôt, et le dit routable', () => {
    const racine = bac()

    expect(cibleDeVerification('src/main/chose.ts', racine)).toEqual({
      ok: true,
      chemin: 'src/main/chose.ts',
      parPortee: true
    })
  })

  it('un fichier de TEST reste joué directement, sans passer par la portée', () => {
    const racine = bac()

    expect(cibleDeVerification('src/main/chose.test.ts', racine)).toEqual({
      ok: true,
      chemin: 'src/main/chose.test.ts'
    })
  })

  it('les refus qui PROTÈGENT restent des refus', () => {
    // Élargir aux sources ne doit pas ouvrir la porte à autre chose : ce sont les gardes qui
    // empêchent de désigner n'importe quoi sur le disque.
    const racine = bac()

    expect(cibleDeVerification('../voisin/secret.test.ts', racine).ok).toBe(false)
    expect(cibleDeVerification('C:/Windows/x.ts', racine).ok).toBe(false)
    expect(cibleDeVerification('.git/config', racine).ok).toBe(false)
    expect(cibleDeVerification('src/**/*.ts', racine).ok).toBe(false)
    expect(cibleDeVerification('src/main/jamais-ecrit.ts', racine).ok).toBe(false)
  })
})

describe('le routage est réellement branché', () => {
  const source = readFileSync(join(__dirname, 'commands.ts'), 'utf8')

  it('une cible marquée `parPortee` passe par la vérification de portée', () => {
    expect(source).toMatch(/verdict\.parPortee[\s\S]{0,400}?runRelatedVerifyAt\(decision\.cwd, \[verdict\.chemin\]\)/)
  })

  it('une portée indéterminable retombe sur la suite, elle ne rend pas un refus', () => {
    // Un refus ici recréerait le faux refus de conv-1404 par une autre porte.
    expect(source).toMatch(/if \(parPortee\.allowed\) return parPortee/)
  })

  it('un fichier de test continue de se jouer directement', () => {
    expect(source).toContain("argv = [...argv, '--', verdict.chemin]")
  })
})
