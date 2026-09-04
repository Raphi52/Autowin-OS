import { describe, expect, it } from 'vitest'
import { restaurer } from './commands'
import {
  echecsDuRapport,
  noteDeDifferentiel,
  scriptVitestUnique,
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
  options: {
    passes?: readonly { fichier: string; nom: string; sortie?: string }[]
    collecteKo?: string
    hookCasse?: string
    suitesAnnoncees?: number
    /**
     * Fichiers COLLECTES par le runner. Vitest liste tout ce qu'il a collecte, pas seulement ce qui
     * echoue : un test repare reste present, en `passed`. Sans ce parametre le fixture fabriquait
     * des perimetres artificiellement divergents — le fixture menait le test, pas le code.
     */
    collectes?: readonly string[]
  } = {}
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
  for (const fichier of options.collectes ?? []) {
    if (!parFichier.has(fichier)) parFichier.set(fichier, [{ nom: 'cas vert', passe: true }])
  }
  const testResults = [...parFichier].map(([fichier, tests]) => ({
    name: fichier,
    status: tests.some((t) => !t.passe) ? 'failed' : 'passed',
    message: '',
    assertionResults: tests.map((t) => ({
      ancestorTitles: t.nom.includes(' > ') ? [t.nom.split(' > ')[0]] : [],
      title: t.nom.includes(' > ') ? t.nom.split(' > ').slice(1).join(' > ') : t.nom,
      fullName: t.nom,
      status: t.passe ? 'passed' : 'failed',
      duration: 3,
      failureMessages: t.passe
        ? []
        : [
            // MULTI-LIGNE, comme le vrai format : une raison puis une pile a chemins absolus. Le
            // fixture d'origine n'avait qu'UNE ligne, donc l'extraction ne prouvait rien.
            (t.raison ?? 'AssertionError') +
              ((t.raison ?? '').includes('at ')
                ? ''
                : `${SAUT}    at C:/bureau/${fichier}:7:11${SAUT}` +
                  `    at node_modules/vitest/dist/chunk-abc.js:120:9${SAUT}` +
                  `    at node_modules/tinypool/dist/index.js:41:2`)
          ]
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
  if (options.hookCasse) {
    /*
     * UNE SUITE EN ECHEC DONT LES TESTS PASSENT : le profil exact d'un `beforeAll`/`afterAll` qui
     * jette, MESURE sur une sortie reelle. `numFailedTests` ne le compte PAS — c'est tout le piege.
     */
    testResults.push({
      name: options.hookCasse,
      status: 'failed',
      message: 'Error: afterAll casse par edition',
      assertionResults: [
        {
          ancestorTitles: [],
          title: 'test qui passe',
          fullName: 'test qui passe',
          status: 'passed',
          duration: 2,
          failureMessages: []
        }
      ]
    })
  }
  const suitesEnEchec = testResults.filter((t) => t.status === 'failed').length
  /*
   * LE COMPTE VIENT DES TESTS REELLEMENT PRESENTS, jamais d'une arithmetique parallele.
   * Troisieme infidelite de fixture trouvee dans ce RUN : la version precedente additionnait
   * echecs + passes + hook, en OUBLIANT les fichiers `collectes` — elle annoncait donc
   * `numTotalTests: 0` sur un rapport contenant une assertion passee, ce qui declenchait a tort la
   * regle « une baseline a 0 test n'atteste rien ». Un fixture qui se contredit fait echouer des
   * tests justes, et c'est indiscernable d'un defaut de production.
   */
  const testsPresents = testResults.reduce((n, t) => n + t.assertionResults.length, 0)
  return JSON.stringify({
    success: echecs.length === 0 && !options.collecteKo && !options.hookCasse,
    numTotalTests: testsPresents,
    numFailedTests: echecs.length,
    numFailedTestSuites: options.suitesAnnoncees ?? suitesEnEchec,
    testResults
  })
}

/** Un rapport VERT qui n'a joue AUCUN test — la sortie reelle de `vitest related <fichier sans test>`. */
const RAPPORT_VIDE_VERT = JSON.stringify({
  success: true,
  numTotalTests: 0,
  numFailedTests: 0,
  numFailedTestSuites: 0,
  testResults: []
})

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
    // Le refus couvre desormais TOUT echec de niveau suite — collecte ET hook casse, meme cause :
    // une suite en echec dont aucune assertion n'echoue est un echec que le JSON ne compte pas.
    expect(lu.raison ?? '').toContain('niveau suite')
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
    expect(verdictDifferentiel(false, lu(rapport([A], { collectes: [B.fichier] })), lu(rapport([A, B])))).toMatchObject({
      publiable: true
    })
  })

  it('REFUSE un échec nouveau, même noyé dans du bruit préexistant', () => {
    const v = verdictDifferentiel(false, lu(rapport([A, B, C])), lu(rapport([A, B], { collectes: [C.fichier] })))
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
    const v = verdictDifferentiel(false, lu(rapport([...bruit, C])), lu(rapport(bruit, { collectes: [C.fichier] })))
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

  /*
   * REGLE SYMETRIQUE, TROUVEE PAR REPETITION. `vitest related` collecte parfois 0 test de facon
   * intermittente ; quand cela frappe la BASELINE, son ensemble d'echecs est vide, donc TOUS les
   * rouges de l'apres paraissent NOUVEAUX et le refus ACCUSE l'edition. Le refus etait juste par
   * accident, son motif etait faux — et un motif faux envoie corriger du code sain.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : traiter une baseline a 0 test comme une baseline valide.
   */
  it('REFUSE une baseline qui n’a joué AUCUN test, sans accuser l’édition', () => {
    const baselineVide = JSON.stringify({
      success: true,
      numTotalTests: 0,
      numFailedTests: 0,
      numFailedTestSuites: 0,
      testResults: []
    })
    const verdict = verdictDifferentiel(false, lu(rapport([A])), lu(baselineVide))
    expect(verdict.concluant).toBe(false)
    expect(verdict.publiable).toBe(false)
    // Le motif désigne la MESURE, jamais l'édition.
    expect(verdict.raison ?? '').toContain('baseline')
    expect(verdict.nouvelles).toHaveLength(0)
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
   * UN ROUGE SANS AUCUN TEST EN ECHEC N'ACCUSE PAS L'EDITION — il accuse la MACHINE.
   *
   * MESURE le 2026-09-04 (conv-233) : 676 tests passes, ZERO echec, edition refusee quand meme
   * parce que trois processus de test avaient ete tues par la memoire. Le refus etait indefendable
   * — aucune regression mesurable, et aucun rejeu ne pouvait lever la cause, qui est HORS des
   * tests. On publie donc en NOMMANT la limite.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : refuser de nouveau ce cas, ou publier sans dire que le
   * verdict n'atteste que les tests qui ont pu tourner.
   */
  it('PUBLIE un rouge dont le rapport ne porte AUCUN échec, en nommant la limite', () => {
    const v = verdictDifferentiel(false, lu(rapport([])), lu(rapport([A])))
    expect(v).toMatchObject({ concluant: true, publiable: true })
    expect(v.raison ?? '').toContain('hors des tests')
    expect(v.raison ?? '').toContain('qui ont pu tourner')
    // Le compte reste celui REELLEMENT joue : on ne maquille pas la mesure en la publiant.
    expect(v.testsJoues).toBe(lu(rapport([])).testsJoues)
    expect(v.nouvelles).toHaveLength(0)
  })

  it('publie un VERT sans rien différencier, et sans exiger de baseline', () => {
    expect(verdictDifferentiel(true, lu(undefined), undefined)).toMatchObject({
      concluant: true,
      publiable: true
    })
  })

  it('accepte une baseline VERTE : la base était saine, donc tout échec est NOUVEAU', () => {
    const v = verdictDifferentiel(false, lu(rapport([A])), lu(rapport([], { collectes: [A.fichier] })))
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

describe('les quatre défauts prouvés par le panel sur la v2', () => {
  const lu = (json: string | undefined): ReturnType<typeof echecsDuRapport> => echecsDuRapport(json)

  /*
   * MAJEUR 1 — FAUX VERT PROUVE PAR SONDE. Un `afterAll`/`beforeAll` qui jette rend la suite
   * `failed` avec des assertions qui PASSENT, et `numFailedTests` ne le compte pas. La v2 lisait donc
   * « 1 echec » (celui d'un autre fichier, preexistant), le retrouvait a l'identique dans la
   * baseline, et PUBLIAIT la regression avec « aucun echec nouveau ».
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : ne traiter comme echec de suite que le cas
   * `assertions.length === 0` (la garde de la v2), au lieu de « aucune assertion EN ECHEC ».
   */
  it('REFUSE un échec de niveau SUITE (hook cassé) que numFailedTests ne compte pas', () => {
    const rapportAvecHook = rapport([A], { hookCasse: 'src/hook.test.ts' })
    const relu = lu(rapportAvecHook)
    expect(relu.concluant).toBe(false)
    expect(relu.raison ?? '').toContain('niveau suite')
    // Et le differentiel refuse, au lieu de publier sur le seul echec preexistant.
    expect(verdictDifferentiel(false, relu, lu(rapport([A])))).toMatchObject({ publiable: false })
  })

  /*
   * MAJEUR 2 — FAUX REFUS PERMANENT PROUVE PAR SONDE. `echecs` etait un `Set` et le controle croise
   * le comparait a `numFailedTests`, un compte de TESTS. Deux tests de meme nom echouant a
   * l'identique (boucle `for` a titre statique) rendaient tout differentiel non concluant A JAMAIS.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : recomparer `numFailedTests` a la taille de l'ensemble
   * deduplique.
   */
  it('accepte DEUX échecs de même nom et même raison — le compte porte sur les TESTS', () => {
    const jumeaux = { fichier: 'src/j.test.ts', nom: 'meme nom', raison: 'AssertionError: expected 1 to be 2' }
    const relu = lu(rapport([jumeaux, jumeaux]))
    expect(relu.concluant).toBe(true)
    // Deux echecs restent DEUX : en voir un de plus qu'avant doit rester detectable.
    expect(relu.echecs.size).toBe(2)
    const verdict = verdictDifferentiel(false, relu, lu(rapport([jumeaux])))
    expect(verdict.publiable).toBe(false)
    expect(verdict.nouvelles).toHaveLength(1)
  })

  /*
   * MAJEUR 3 — SCRIPT CHAINE. `npm run X -- <drapeaux>` colle les arguments a la FIN de la chaine :
   * sur `vitest run && eslint .`, ils atterrissent sur eslint et fabriquent un FAUX ROUGE sur un
   * projet sain. Sonde npm reelle. Le `npm test` de ce depot a exactement cette forme.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : revenir a un booleen « le script contient vitest ».
   */
  it('n’ajoute des drapeaux QUE sur un lancement vitest unique, jamais sur une chaîne', () => {
    const avec = (corps: string) => (): Record<string, string> => ({ 'test:unit': corps })
    expect(scriptVitestUnique('/x', avec('vitest run'))).toBe(true)
    expect(scriptVitestUnique('/x', avec('vitest run --silent'))).toBe(true)
    expect(scriptVitestUnique('/x', avec('vitest run && eslint .'))).toBe(false)
    expect(scriptVitestUnique('/x', avec('npm run typecheck && vitest run'))).toBe(false)
    expect(scriptVitestUnique('/x', avec('vitest run; echo fini'))).toBe(false)
    expect(scriptVitestUnique('/x', avec('vitest run | tee log'))).toBe(false)
    expect(scriptVitestUnique('/x', avec('jest'))).toBe(false)
    expect(scriptVitestUnique('/x', () => null)).toBe(false)
  })

  /*
   * MAJEUR 4 — L'EMPREINTE NE DISCRIMINAIT PAS `toEqual` SUR OBJETS. Vitest ELIDE les valeurs
   * comparees (`expected { …(2) } to deeply equal { …(2) }`), donc deux causes differentes du meme
   * test partageaient la meme identite : le defaut n.4 de la v1 survivait pour la forme d'assertion
   * la plus courante. On adjoint la premiere frame de pile hors `node_modules`.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : retirer le lieu de l'empreinte.
   */
  it('REFUSE deux échecs au message IDENTIQUE mais à l’emplacement DIFFÉRENT', () => {
    const elide = (ligne: number): string =>
      [
        'AssertionError: expected { …(2) } to deeply equal { …(2) }',
        `    at src/sujet.test.ts:${ligne}:19`,
        '    at node_modules/vitest/dist/chunk.js:1:1'
      ].join(SAUT)
    const avant = rapport([{ fichier: 'src/sujet.test.ts', nom: 'contrat', raison: elide(12) }])
    const apres = rapport([{ fichier: 'src/sujet.test.ts', nom: 'contrat', raison: elide(31) }])
    const verdict = verdictDifferentiel(false, lu(apres), lu(avant))
    expect(verdict.publiable).toBe(false)
    expect(verdict.nouvelles).toHaveLength(1)
  })

  it('reste STABLE quand le message ET l’emplacement sont identiques', () => {
    const meme = [
      'AssertionError: expected { …(2) } to deeply equal { …(2) }',
      '    at src/sujet.test.ts:12:19'
    ].join(SAUT)
    const r = rapport([{ fichier: 'src/sujet.test.ts', nom: 'contrat', raison: meme }])
    expect(verdictDifferentiel(false, lu(r), lu(r))).toMatchObject({ publiable: true })
  })

  /*
   * MESURE HORS MODELE, LA PLUS RENTABLE DU LOT : `vitest related <fichier de code sans test
   * associe> --run` rend EXIT 0, `success: true`, `numTotalTests: 0`. Toute edition qu'aucun test
   * n'exerce etait publiee sous l'etiquette « verifie » — y compris l'edition de la CONFIGURATION de
   * vitest, premier maillon d'une chaine prouvee en deux appels. Ce refus coupe la chaine.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : rendre `publiable: true` sur tout `apresEstVert`.
   */
  it('REFUSE un exit 0 qui n’a joué AUCUN test', () => {
    const verdict = verdictDifferentiel(true, lu(RAPPORT_VIDE_VERT), undefined)
    expect(verdict.publiable).toBe(false)
    expect(verdict.testsJoues).toBe(0)
    expect(verdict.raison ?? '').toContain('aucun test')
  })

  it('publie un vert qui a JOUÉ des tests, et porte leur compte', () => {
    const vert = rapport([], { passes: [{ fichier: 'src/a.test.ts', nom: 'ok' }] })
    const verdict = verdictDifferentiel(true, lu(vert), undefined)
    expect(verdict).toMatchObject({ publiable: true, testsJoues: 1 })
  })

  /*
   * NUANCE ASSUMEE, explicitement testee pour qu'elle ne derive pas : quand AUCUN rapport n'existe
   * (projet qui ne teste pas avec vitest), le compte est INCONNU et le vert reste publiable. Refuser
   * ici casserait tout projet non-vitest. « On sait que rien n'a tourne » et « on ne sait pas » ne
   * sont pas la meme chose.
   */
  it('laisse publier un vert dont le compte est INCONNU (projet sans rapport)', () => {
    const verdict = verdictDifferentiel(true, lu(undefined), undefined)
    expect(verdict).toMatchObject({ publiable: true })
    expect(verdict.testsJoues).toBeUndefined()
  })

  /*
   * SANITE DES FICHIERS CITES. Ne FERME pas la fabrication du rapport (un faussaire peut citer un
   * vrai fichier), mais en releve le cout : le contre-exemple execute par le juge citait
   * « fantome.test.ts », qui n'existait pas dans le depot.
   */
  /*
   * FIDELITE DU FIXTURE — verrou pose apres un defaut REEL. Le fixture de ce fichier nomme ses
   * suites en chemin RELATIF ; vitest, lui, les nomme en chemin ABSOLU. La garde de sanite, ecrite
   * pour du relatif, declarait donc toute suite « introuvable » en production : faux refus total,
   * invisible pour les 32 tests unitaires et attrape par l'integration seulement.
   */
  it('lit une suite nommée en chemin ABSOLU, comme vitest le fait réellement', () => {
    const absolu = 'C:/bureau/src/sujet.test.ts'
    const relu = echecsDuRapport(
      rapport([{ fichier: absolu, nom: 'cas', raison: 'AssertionError: expected 1 to be 2' }]),
      (chemin) => chemin === absolu
    )
    expect(relu.concluant).toBe(true)
    expect([...relu.echecs][0]).toContain(absolu)
  })

  it('REFUSE un rapport qui cite une suite en échec INTROUVABLE dans le bureau', () => {
    const relu = echecsDuRapport(rapport([A]), (chemin) => chemin !== 'src/a.test.ts')
    expect(relu.concluant).toBe(false)
    expect(relu.raison ?? '').toContain('introuvable')
  })

  /*
   * PERIMETRES DIVERGENTS. Sur `vitest related`, une edition qui AJOUTE un import fait collecter a
   * l'APRES des fichiers que la baseline ne voyait pas — un rouge preexistant y devient « nouveau ».
   * Les etiquettes de commande sont identiques dans ce cas : seuls les rapports le disent.
   */
  it('REFUSE quand les deux mesures ne couvrent pas le même ensemble de fichiers', () => {
    const verdict = verdictDifferentiel(false, lu(rapport([A, B])), lu(rapport([A])))
    expect(verdict.concluant).toBe(false)
    expect(verdict.raison ?? '').toContain('même ensemble')
  })

  it('REFUSE un rapport dont le compte de SUITES en échec ne correspond pas', () => {
    const menteur = rapport([A], { suitesAnnoncees: 4 })
    const relu = lu(menteur)
    expect(relu.concluant).toBe(false)
    expect(relu.raison ?? '').toContain('suite(s) en échec')
  })
})

describe('noteDeDifferentiel — ne promet que ce qui est tenu', () => {
  it('porte le COMPTE de tests joués', () => {
    const r = rapport([A])
    const note = noteDeDifferentiel(verdictDifferentiel(false, echecsDuRapport(r), echecsDuRapport(r)))
    expect(note).toContain('test(s) réellement joué(s)')
  })

  /*
   * LA V2 AFFIRMAIT « un test deja rouge dont l'edition change la cause est compte comme nouveau ».
   * REFUTE par sonde pour les assertions sur objets. Une note qui surpromet desarme la vigilance
   * qu'elle pretend armer : elle doit desormais dire l'inverse.
   */
  it('n’affirme plus qu’un changement de cause est toujours détecté', () => {
    const r = rapport([A])
    const note = noteDeDifferentiel(verdictDifferentiel(false, echecsDuRapport(r), echecsDuRapport(r)))
    expect(note).not.toContain('est compté comme nouveau')
    expect(note).toContain('MASQUER')
    expect(note).toContain('élide')
  })
})

describe('restaurer — la restauration ne peut pas échouer en SILENCE', () => {
  /*
   * MECANISME QUE LE PANEL A SABOTE SANS FAIRE ROUGIR UN SEUL TEST : remplacer le `return false`
   * final par `return true` laissait les 7 tests d'integration verts. Le defaut qui passait : apres
   * la mesure de baseline, le fichier du bureau porte les octets D'AVANT ; si la reecriture des
   * octets d'APRES echoue, un `restaurer` muet laisse publier l'ANNULATION de l'edition — l'utilisateur
   * lit « edition appliquee et verifiee » alors que son travail a disparu.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : rendre `true` sans avoir ecrit.
   */
  it('rend vrai après UN échec transitoire, en réessayant une seule fois', () => {
    let appels = 0
    const ecrire = (): void => {
      appels += 1
      if (appels === 1) throw new Error('EBUSY')
    }
    expect(restaurer('C:/x', Buffer.from('a'), ecrire)).toBe(true)
    expect(appels).toBe(2)
  })

  it('rend FAUX quand l’écriture échoue durablement — et n’essaie pas indéfiniment', () => {
    let appels = 0
    const ecrire = (): void => {
      appels += 1
      throw new Error('EACCES')
    }
    expect(restaurer('C:/x', Buffer.from('a'), ecrire)).toBe(false)
    expect(appels).toBe(2)
  })

  it('écrit exactement les octets fournis, sans encodage', () => {
    const vus: Buffer[] = []
    const octets = Buffer.from([0x2f, 0x2f, 0xe9, 0x0d, 0x0a])
    expect(restaurer('C:/x', octets, (_c, contenu) => void vus.push(contenu))).toBe(true)
    // Les octets traversent a l'IDENTIQUE : un aller-retour en utf8 changerait `e9` en `efbfbd`.
    expect(vus[0].equals(octets)).toBe(true)
  })
})

describe('empreinteDeRaison — gardée contre les deux dérives opposées', () => {
  const lu = (json: string | undefined): ReturnType<typeof echecsDuRapport> => echecsDuRapport(json)
  const avecPile = (raison: string, frames: readonly string[]): string =>
    [raison, ...frames.map((f) => `    at ${f}`)].join(SAUT)

  /*
   * DERIVE 1 — EMBARQUER TOUTE LA PILE. Un juge a saboté `empreinteDeRaison` pour qu'elle rende le
   * message ENTIER : les 19 tests d'alors sont restés VERTS. Le défaut qui passait : un rouge
   * PRÉEXISTANT dont la pile de dépendances bouge change d'identité, est classé NOUVEAU, et une
   * édition SAINE est refusée — le faux refus que cette version existe pour supprimer.
   */
  it('IGNORE une pile de dépendances qui change entre deux exécutions', () => {
    const avant = rapport([
      { fichier: 'src/s.test.ts', nom: 'cas', raison: avecPile('AssertionError: x', ['src/s.test.ts:7:11', 'node_modules/vitest/a.js:1:1']) }
    ])
    const apres = rapport([
      { fichier: 'src/s.test.ts', nom: 'cas', raison: avecPile('AssertionError: x', ['src/s.test.ts:7:11', 'node_modules/vitest/b.js:999:9']) }
    ])
    expect(verdictDifferentiel(false, lu(apres), lu(avant))).toMatchObject({ publiable: true })
  })

  /*
   * DERIVE 2 — NE GARDER QUE LA PREMIERE LIGNE. C'est ce que faisait la v2, et le défaut n°4 du
   * panel : sur une assertion d'objet, vitest ÉLIDE les valeurs, donc deux causes distinctes
   * partagent la première ligne. Le LIEU les sépare.
   */
  it('SÉPARE deux causes dont la première ligne est identique mais le lieu différent', () => {
    const elide = 'AssertionError: expected { …(2) } to deeply equal { …(2) }'
    const avant = rapport([{ fichier: 'src/s.test.ts', nom: 'cas', raison: avecPile(elide, ['src/s.test.ts:12:19']) }])
    const apres = rapport([{ fichier: 'src/s.test.ts', nom: 'cas', raison: avecPile(elide, ['src/s.test.ts:44:19']) }])
    expect(verdictDifferentiel(false, lu(apres), lu(avant))).toMatchObject({ publiable: false })
  })
})
