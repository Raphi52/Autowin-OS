import { describe, expect, it } from 'vitest'
import {
  echecsDuRapport,
  noteDeDifferentiel,
  verdictDifferentiel,
  verifyTimeoutOutcome
} from './verify-command'

/**
 * CE FICHIER EST LA V2. La v1 a ete DEFAITE (revert `97f2e9dc`) apres qu'un panel de cinq juges
 * externes a PROUVE qu'elle publiait des regressions par cinq voies. Cause racine UNIQUE : elle
 * fondait une decision de PUBLICATION sur le parsing de la sortie HUMAINE du runner — plafonnee a
 * 4000 caracteres, falsifiable par un `console.log`, sans identite stable, sans la raison de l'echec.
 *
 * La v2 ne lit plus de texte : elle lit l'ARTEFACT STRUCTURE de vitest
 * (`--reporter=json --outputFile=<fichier>`). Chaque test ci-dessous EST un des defauts prouves, et
 * NOMME l'entree qui doit le faire echouer si la mesure est fausse.
 */
const SAUT = String.fromCharCode(10)

/** Fabrique un rapport vitest realiste. La FORME est celle mesuree sur une sortie reelle. */
function rapport(
  echecs: readonly { fichier: string; nom: string; raison: string }[],
  options: { passes?: readonly { fichier: string; nom: string; sortie?: string }[]; collecteKo?: string } = {}
): string {
  const parFichier = new Map<string, { nom: string; raison?: string; passe: boolean }[]>()
  for (const e of echecs) {
    const liste = parFichier.get(e.fichier) ?? []
    liste.push({ nom: e.nom, raison: e.raison, passe: false })
    parFichier.set(e.fichier, liste)
  }
  for (const p of options.passes ?? []) {
    const liste = parFichier.get(p.fichier) ?? []
    liste.push({ nom: p.nom, passe: true })
    parFichier.set(p.fichier, liste)
  }
  const testResults = [...parFichier].map(([fichier, tests]) => ({
    name: fichier,
    status: tests.some((t) => !t.passe) ? 'failed' : 'passed',
    message: '',
    assertionResults: tests.map((t) => ({
      ancestorTitles: [],
      title: t.nom,
      fullName: t.nom,
      status: t.passe ? 'passed' : 'failed',
      duration: 3,
      failureMessages: t.passe ? [] : [t.raison ?? 'AssertionError']
    }))
  }))
  if (options.collecteKo) {
    // Un fichier qui n'a pas pu etre COLLECTE : `failed`, aucun test, un message d'erreur.
    testResults.push({
      name: options.collecteKo,
      status: 'failed',
      message: 'Error: Transform failed with 1 error: Unterminated string literal',
      assertionResults: []
    })
  }
  return JSON.stringify({
    success: echecs.length === 0 && !options.collecteKo,
    numTotalTests: echecs.length + (options.passes?.length ?? 0),
    numFailedTests: echecs.length,
    numFailedTestSuites: testResults.filter((t) => t.status === 'failed').length,
    testResults
  })
}

const A = { fichier: 'src/a.test.ts', nom: 'suite A > rend 1', raison: 'AssertionError: expected 1 to be 2' }
const B = { fichier: 'src/b.test.ts', nom: 'suite B > rend 2', raison: 'AssertionError: expected 2 to be 3' }
const C = { fichier: 'src/c.test.ts', nom: 'suite C > rend 3', raison: 'AssertionError: expected 3 to be 4' }

describe('echecsDuRapport — l’identité vient de l’ARTEFACT, jamais du texte', () => {
  it('extrait un échec par assertion échouée, avec son fichier et sa raison', () => {
    const lu = echecsDuRapport(rapport([A, B]))
    expect(lu.concluant).toBe(true)
    expect(lu.echecs.size).toBe(2)
    expect([...lu.echecs].some((id) => id.includes('rend 1'))).toBe(true)
  })

  /*
   * LE VECTEUR D'ATTAQUE DE LA V1, ferme par construction. En v1, `echecsNommes` lisait toute ligne
   * ressemblant a ` FAIL  <nom> `, donc un `console.log` suffisait a fabriquer un echec et a faire
   * classer « preexistant » un test qui etait VERT. Contre-exemple EXECUTE par un juge : une
   * regression publiee en deux appels `edit_file`.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA MESURE EST FAUSSE : revenir a un parsing de texte.
   */
  it('IGNORE une ligne FAIL forgée par un test qui PASSE — un console.log ne fabrique plus un échec', () => {
    const forge = rapport([], {
      passes: [{ fichier: 'src/a.test.ts', nom: 'test bavard', sortie: ' FAIL  src/cible.test.ts > suite > cas' }]
    })
    // La chaine forgee est presente dans le rapport, mais hors de `assertionResults[].status`.
    const avecPollution = forge.replace('"message":""', '"message":" FAIL  src/cible.test.ts > suite > cas"')
    const lu = echecsDuRapport(avecPollution)
    expect(lu.echecs.size).toBe(0)
  })

  it('REFUSE un rapport ABSENT — c’est le cas du plafond de temps, qui n’écrit aucun fichier', () => {
    expect(echecsDuRapport(undefined).concluant).toBe(false)
    expect(echecsDuRapport('').concluant).toBe(false)
  })

  /*
   * LE PLAFOND DE TEMPS, avec sa VRAIE sortie. La v1 pretendait couvrir ce cas avec un fixture sans
   * sortie partielle — c'est-a-dire la seule variante que le produit ne peut PAS emettre des que la
   * suite a commence a echouer. `verifyTimeoutOutcome` CONCATENE les echecs deja imprimes au message
   * de plafond, donc la v1 y trouvait un ensemble d'echecs et publiait. Ce test lui donne la sortie
   * REELLE : elle ne doit produire AUCUN echec, parce qu'on ne lit plus de texte du tout.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : revenir a un parsing de la sortie du runner.
   */
  it('REFUSE la vraie sortie d’un plafond de temps, sortie partielle COMPRISE', () => {
    const partiel = [' FAIL  src/a.test.ts > suite A > rend 1', 'AssertionError: expected 1 to be 2'].join(SAUT)
    const coupee = verifyTimeoutOutcome('npm run test:unit', 600_000, partiel)
    expect(coupee.ok).toBe(false)
    // La sortie contient bien des lignes d'echec : c'est ce qui piegeait la v1.
    expect(coupee.output).toContain('FAIL')
    const lu = echecsDuRapport(coupee.output)
    expect(lu.concluant).toBe(false)
    expect(lu.echecs.size).toBe(0)
  })

  it('REFUSE un rapport illisible ou de forme inattendue (le format de vitest peut changer)', () => {
    expect(echecsDuRapport('pas du json').concluant).toBe(false)
    expect(echecsDuRapport('{"success":true}').concluant).toBe(false)
    expect(echecsDuRapport('[]').concluant).toBe(false)
  })

  /*
   * CONTROLE CROISE. Un rapport dont le compte annonce ne correspond pas aux echecs extraits est un
   * rapport qu'on n'a pas su lire — meme si chaque ligne lue est valide. Sans cette garde, une
   * evolution du format ferait silencieusement retrecir l'ensemble, et un echec NOUVEAU absent de
   * l'ensemble se lirait « rien de casse ». C'est la forme generale du defaut n°1 de la v1.
   */
  it('REFUSE quand le compte annoncé par vitest ne correspond pas aux échecs extraits', () => {
    const menteur = rapport([A, B]).replace('"numFailedTests":2', '"numFailedTests":5')
    expect(echecsDuRapport(menteur).concluant).toBe(false)
  })

  /*
   * UN FICHIER QUI NE COLLECTE PAS MASQUE TOUT CE QU'IL CONTIENT. Le juge securite l'a nomme : le
   * traiter comme « un rouge ecarte » laisse une seule erreur de syntaxe preexistante couvrir
   * N'IMPORTE QUELLE regression de ce fichier, en un seul appel. Il ne s'ecarte pas : il REFUSE.
   */
  it('REFUSE tout différentiel dès qu’un fichier a échoué à la COLLECTE', () => {
    const lu = echecsDuRapport(rapport([A], { collecteKo: 'src/casse.test.ts' }))
    expect(lu.concluant).toBe(false)
    expect(lu.raison ?? '').toContain('collecte')
  })
})

describe('verdictDifferentiel — ne refuser que les échecs NOUVEAUX', () => {
  const lu = (json: string | undefined): ReturnType<typeof echecsDuRapport> => echecsDuRapport(json)

  it('publie quand tous les rouges étaient DÉJÀ là', () => {
    const v = verdictDifferentiel(false, lu(rapport([A, B])), lu(rapport([A, B])))
    expect(v).toMatchObject({ concluant: true, publiable: true })
    expect(v.nouvelles).toHaveLength(0)
    expect(v.preexistants).toHaveLength(2)
  })

  it('publie quand un rouge préexistant a DISPARU — réparer n’est pas régresser', () => {
    expect(verdictDifferentiel(false, lu(rapport([A])), lu(rapport([A, B])))).toMatchObject({
      publiable: true
    })
  })

  it('REFUSE un échec nouveau, même noyé dans du bruit préexistant', () => {
    const v = verdictDifferentiel(false, lu(rapport([A, B, C])), lu(rapport([A, B])))
    expect(v.publiable).toBe(false)
    expect(v.nouvelles).toHaveLength(1)
  })

  /*
   * LE DEFAUT N°1 DE LA V1, dans sa forme generale : beaucoup de rouges preexistants. En v1 la
   * sortie etait plafonnee a 4000 c AVANT la comparaison, donc au-dela d'environ 23 echecs un echec
   * NOUVEAU sortait de la fenetre et l'edition etait publiee. Mesure par un juge : n=20 detecte,
   * n=30/40/60/80 publie. Le regime ou ca cassait est exactement celui que ce mecanisme sert.
   */
  it('REFUSE un échec nouveau parmi 60 rouges préexistants — plus aucune fenêtre de lecture', () => {
    const bruit = Array.from({ length: 60 }, (_, i) => ({
      fichier: `src/bruit-${i}.test.ts`,
      nom: `suite ${i} > cas`,
      raison: `AssertionError: expected ${i} to be 0`
    }))
    const v = verdictDifferentiel(false, lu(rapport([...bruit, C])), lu(rapport(bruit)))
    expect(v.concluant).toBe(true)
    expect(v.publiable).toBe(false)
    expect(v.nouvelles).toHaveLength(1)
  })

  /*
   * LE DEFAUT N°5 DE LA V1. Le NOM d'un test ne porte pas la RAISON de son echec : un test deja
   * rouge pour une cause A, qui echoue APRES pour la regression, avait un nom identique donc etait
   * classe « preexistant ». Contre-exemple EXECUTE par un juge : regression publiee.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : construire l'identite sur le seul nom.
   */
  it('REFUSE le MÊME test échouant pour une RAISON DIFFÉRENTE — le nom ne suffit pas', () => {
    const avant = rapport([{ ...A, raison: 'AssertionError: expected 1 to be 2' }])
    const apres = rapport([{ ...A, raison: 'AssertionError: expected 42 to be 1' }])
    const v = verdictDifferentiel(false, lu(apres), lu(avant))
    expect(v.publiable).toBe(false)
    expect(v.nouvelles).toHaveLength(1)
  })

  it('REFUSE sans baseline — « on ne sait pas » n’ouvre pas de porte', () => {
    expect(verdictDifferentiel(false, lu(rapport([A])), undefined)).toMatchObject({
      concluant: false,
      publiable: false
    })
  })

  it('REFUSE quand l’un des deux rapports est non concluant (plafond, format, collecte)', () => {
    expect(verdictDifferentiel(false, lu(undefined), lu(rapport([A])))).toMatchObject({
      publiable: false
    })
    expect(verdictDifferentiel(false, lu(rapport([A])), lu(undefined))).toMatchObject({
      publiable: false
    })
  })

  /*
   * INCOHERENCE : le runner dit ROUGE mais le rapport ne porte aucun echec. On ne sait pas ce qui
   * s'est passe (crash apres ecriture, echec hors test, runner introuvable) — donc on refuse.
   */
  it('REFUSE un rouge dont le rapport ne porte AUCUN échec', () => {
    expect(verdictDifferentiel(false, lu(rapport([])), lu(rapport([A])))).toMatchObject({
      concluant: false,
      publiable: false
    })
  })

  it('publie un VERT sans rien différencier, et sans exiger de baseline', () => {
    expect(verdictDifferentiel(true, lu(undefined), undefined)).toMatchObject({
      concluant: true,
      publiable: true
    })
  })

  it('accepte une baseline VERTE : la base était saine, donc tout échec est NOUVEAU', () => {
    const v = verdictDifferentiel(false, lu(rapport([A])), lu(rapport([])))
    expect(v).toMatchObject({ concluant: true, publiable: false })
    expect(v.nouvelles).toHaveLength(1)
  })
})

describe('noteDeDifferentiel', () => {
  it('NOMME les échecs écartés et refuse d’affirmer que la base est verte', () => {
    const v = verdictDifferentiel(false, echecsDuRapport(rapport([A])), echecsDuRapport(rapport([A])))
    const note = noteDeDifferentiel(v)
    expect(note).toContain('rend 1')
    // L'invariant REEL : la note ne doit jamais affirmer la verdeur de la base, elle doit la NIER.
    expect(note).toContain('n’atteste')
    expect(note).toContain('MASQUER')
  })

  it('reste bornée quand les préexistants sont nombreux', () => {
    const bruit = Array.from({ length: 40 }, (_, i) => ({
      fichier: `src/b-${i}.test.ts`,
      nom: `cas ${i}`,
      raison: 'AssertionError'
    }))
    const v = verdictDifferentiel(false, echecsDuRapport(rapport(bruit)), echecsDuRapport(rapport(bruit)))
    const note = noteDeDifferentiel(v)
    expect(note).toContain('40')
    expect(note.split(SAUT)[0].length).toBeLessThan(2_000)
  })
})
