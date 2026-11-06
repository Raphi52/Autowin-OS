import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DELAI_LISTE_MS,
  DELAI_REJEU_MS,
  REJEUX_MAX,
  environnementDuRejeu,
  objectionsDuJuge,
  rejouerTestsDuJuge,
  testsDuJuge,
  verdictAvecObjectionsPortees,
  type ExecuteurDuRejeu
} from './objections-juge'

/*
 * LE JUGE REJOUE SES PROPRES REPROCHES.
 *
 * Chaque cas dit l'ENTRÉE qui ferait échouer le test si la correction était fausse : c'est elle
 * qu'il faut réinjecter pour vérifier que ce garde-fou mord encore.
 */

const RACINE = 'D:/depot'

type Appel = { args: readonly string[]; racine: string; delaiMs: number }

/**
 * Faux vitest : `list` rend, comme le vrai, tout fichier dont le chemin CONTIENT un filtre
 * (mesuré : `vitest list --filesOnly juge.test.ts` → 11 fichiers), préfixé du projet `[unite]`.
 * `run` rend le code fixé pour sa liste de chemins, 1 par défaut.
 */
function fauxVitest(options: {
  existants: string[]
  codes?: Record<string, number | 'delai'>
  listeEnDelai?: boolean
}): { executer: ExecuteurDuRejeu; appels: Appel[] } {
  const appels: Appel[] = []
  const executer: ExecuteurDuRejeu = async (args, racine, delaiMs) => {
    appels.push({ args, racine, delaiMs })
    if (args[0] === 'list') {
      if (options.listeEnDelai) return { lancee: true, code: null, sortie: '', delaiDepasse: true }
      const filtres = args.filter((a) => !a.startsWith('-')).slice(1)
      const listes = options.existants.filter((f) => filtres.some((x) => f.includes(x)))
      return {
        lancee: true,
        code: 0,
        sortie: listes.map((f) => `[unite] ${f}`).join('\n'),
        delaiDepasse: false
      }
    }
    const code = options.codes?.[args.slice(1).join(' ')] ?? 1
    if (code === 'delai') return { lancee: true, code: null, sortie: '', delaiDepasse: true }
    return { lancee: true, code, sortie: '', delaiDepasse: false }
  }
  return { executer, appels }
}

const A = 'src/main/juge/a.test.ts'
const B = 'src/main/juge/b.test.ts'

function verdictMineur(suffixe: string, tete = 'VALIDE\nSCORE: 80'): string {
  return `${tete}\nOBJECTIONS:\n- MINEUR: le libellé est faux${suffixe}`
}

/** Le verdict bloque-t-il encore après le rejeu ? (même lecteur que l'orchestrateur, avant `lireVerdictJuge`) */
function bloque(texte: string): boolean {
  return /\bDEFAUT\s*:/i.test(verdictAvecObjectionsPortees(texte))
}

describe('C1 — reproche bloquant sans TEST:', () => {
  // Entrée qui ferait échouer : une correction qui lèverait aussi les reproches SANS test.
  it('rien ne change, aucune commande lancée, étiquette « non rejoué — aucune commande »', async () => {
    const { executer, appels } = fauxVitest({ existants: [A] })
    const texte = verdictMineur('')
    const r = await rejouerTestsDuJuge(texte, RACINE, executer)
    expect(r.texte).toBe(texte)
    expect(appels).toEqual([])
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['non rejoué — aucune commande'])
    expect(bloque(r.texte)).toBe(true)
  })
})

describe('C2 — commande qui échoue après une liste exacte', () => {
  // Entrée qui ferait échouer : `run` qui rend 1 lu comme un succès.
  it('le reproche est confirmé et reste bloquant ; liste exacte PUIS rejeu, dans la racine', async () => {
    const { executer, appels } = fauxVitest({ existants: [A], codes: { [A]: 1 } })
    const texte = verdictMineur(` | TEST: ${A} | npx vitest run ${A}`)
    const r = await rejouerTestsDuJuge(texte, RACINE, executer)
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['confirmé'])
    expect(r.texte).toBe(texte)
    expect(bloque(r.texte)).toBe(true)
    expect(appels.map((a) => a.args)).toEqual([
      ['list', '--filesOnly', A],
      ['run', A]
    ])
    expect(appels.every((a) => a.racine === RACINE)).toBe(true)
    expect(appels.map((a) => a.delaiMs)).toEqual([DELAI_LISTE_MS, DELAI_REJEU_MS])
  })
})

describe('C3 — commande qui passe déjà', () => {
  // Entrée qui ferait échouer : un `run` à 0 qui laisserait le reproche bloquant.
  it('VALIDE + MINEUR non reproduit : le reproche reste affiché en OK et ne bloque plus', async () => {
    const { executer } = fauxVitest({ existants: [A], codes: { [A]: 0 } })
    const texte = verdictMineur(` | TEST: ${A} | npx vitest run ${A}`)
    expect(bloque(texte)).toBe(true)
    const r = await rejouerTestsDuJuge(texte, RACINE, executer)
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['non reproduit'])
    expect(objectionsDuJuge(r.texte)).toEqual([])
    expect(bloque(r.texte)).toBe(false)
    expect(r.texte).toMatch(/- OK: non reproduit — .*le libellé est faux/)
    // Plus de test du juge à faire passer pour la réparation.
    expect(testsDuJuge(r.texte)).toEqual([])
  })

  it('un DEFAUT explicite du juge reste un refus : seul le reproche non reproduit est levé', async () => {
    const { executer } = fauxVitest({ existants: [A], codes: { [A]: 0 } })
    const texte = verdictMineur(` | TEST: ${A} | npx vitest run ${A}`, 'DEFAUT: libellé\nSCORE: 50')
    const r = await rejouerTestsDuJuge(texte, RACINE, executer)
    expect(objectionsDuJuge(r.texte)).toEqual([])
    expect(r.texte.startsWith('DEFAUT: libellé')).toBe(true)
  })

  // Entrée qui ferait échouer : une réécriture naïve qui retire le seul MAJEUR et rend ainsi
  // bloquante la puce nue (« non étiquetée = majeur » ne vaut que sans MAJEUR dans le verdict).
  it('lever le seul MAJEUR ne transforme pas une puce nue (un constat) en reproche', async () => {
    const { executer } = fauxVitest({ existants: [A], codes: { [A]: 0 } })
    const texte = `DEFAUT: x\nOBJECTIONS:\n- MAJEUR: le bouton manque | TEST: ${A} | npx vitest run ${A}\n- 54 sur 54 passent, code 0`
    expect(objectionsDuJuge(texte)).toHaveLength(1)
    const r = await rejouerTestsDuJuge(texte, RACINE, executer)
    expect(objectionsDuJuge(r.texte)).toEqual([])
    expect(r.texte).toContain('54 sur 54 passent, code 0')
  })

  it('les autres reproches gardent leur gravité et leur texte', async () => {
    const { executer } = fauxVitest({ existants: [A, B], codes: { [A]: 0, [B]: 1 } })
    const texte = [
      'VALIDE\nSCORE: 82\nOBJECTIONS:',
      `- MINEUR: premier | TEST: ${A} | npx vitest run ${A}`,
      `- MAJEUR: second | TEST: ${B} | npx vitest run ${B}`,
      '- MINEUR: troisième sans test',
      '- OK: constat vérifié'
    ].join('\n')
    const r = await rejouerTestsDuJuge(texte, RACINE, executer)
    expect(r.rejeux.map((x) => x.etiquette)).toEqual([
      'non reproduit',
      'confirmé',
      'non rejoué — aucune commande'
    ])
    expect(objectionsDuJuge(r.texte)).toEqual([
      `second | TEST: ${B} | npx vitest run ${B}`,
      'troisième sans test'
    ])
    expect(bloque(r.texte)).toBe(true)
  })

  it('un verdict déjà passant (VALIDE, puces nues seules) ne lance rien', async () => {
    const { executer, appels } = fauxVitest({ existants: [A], codes: { [A]: 0 } })
    const texte = `VALIDE\nOBJECTIONS:\n- vu | TEST: ${A} | npx vitest run ${A}`
    const r = await rejouerTestsDuJuge(texte, RACINE, executer)
    expect(appels).toEqual([])
    expect(r.texte).toBe(texte)
  })
})

describe('C4 — commande hors de la forme permise : jamais lancée', () => {
  // Chaque entrée ci-dessous ferait échouer le test si la forme admise était plus large que
  // `npx vitest run <chemins .test.ts|.test.mjs relatifs>`.
  const refusees = [
    'rm -rf src',
    `npx vitest run -u ${A}`,
    `npx vitest run --update ${A}`,
    'node scripts/retirer-conv-commentaires.mjs --appliquer src',
    'node scripts/couleurs-en-dur.mjs --baisser',
    'node ../../autre/x.mjs',
    'node -p 1',
    `npx vitest run src/main/../main/juge/a.test.ts ${A}`,
    `npx vitest run D:/depot/${A}`,
    `npx vitest run /depot/${A}`,
    'npx vitest run src/main/juge',
    `npx vitest run ${A}; rm -rf src`,
    `npx vitest run ${A} && rm -rf src`,
    `npx vitest run ${A} $(rm -rf src)`,
    `npx vitest run ${A} > sortie.txt`,
    `npx vitest run ${A} | rm -rf src`,
    `npx vitest run src/main/juge/*.test.ts`,
    `CI=1 npx vitest run ${A}`,
    `npx vitest ${A}`,
    `npx vitest run`
  ]
  for (const commande of refusees) {
    it(`refuse « ${commande} »`, async () => {
      const { executer, appels } = fauxVitest({ existants: [A], codes: { [A]: 0 } })
      const texte = verdictMineur(` | TEST: ${A} | ${commande}`)
      const r = await rejouerTestsDuJuge(texte, RACINE, executer)
      expect(appels).toEqual([])
      expect(r.rejeux.map((x) => x.etiquette)).toEqual(['non rejoué — commande refusée'])
      expect(bloque(r.texte)).toBe(true)
    })
  }

  // Le jumeau accepté, à la même borne : sans lui, un refus de TOUT passerait les cas ci-dessus.
  it('accepte la forme exacte, plusieurs chemins, `\\` et un TEST: absolu dans la racine', async () => {
    const { executer, appels } = fauxVitest({ existants: [A, B], codes: { [`${A} ${B}`]: 0 } })
    const texte = verdictMineur(
      ` | TEST: D:\\depot\\src\\main\\juge\\a.test.ts | npx vitest run src\\main\\juge\\a.test.ts ${B}`
    )
    const r = await rejouerTestsDuJuge(texte, RACINE, executer)
    expect(appels.map((a) => a.args)).toEqual([
      ['list', '--filesOnly', A, B],
      ['run', A, B]
    ])
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['non reproduit'])
  })

  it('accepte un test .test.mjs', async () => {
    const M = 'scripts/x.test.mjs'
    const { executer } = fauxVitest({ existants: [M], codes: { [M]: 1 } })
    const r = await rejouerTestsDuJuge(
      verdictMineur(` | TEST: ${M} | npx vitest run ${M}`),
      RACINE,
      executer
    )
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['confirmé'])
  })
})

describe('C5 — commande qui vise un autre fichier que celui du TEST:', () => {
  // Entrée qui ferait échouer : une validation qui ne relierait pas le TEST: à la commande.
  it('refusée sans être lancée', async () => {
    const { executer, appels } = fauxVitest({ existants: [A, B], codes: { [B]: 0 } })
    const r = await rejouerTestsDuJuge(
      verdictMineur(` | TEST: ${A} | npx vitest run ${B}`),
      RACINE,
      executer
    )
    expect(appels).toEqual([])
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['non rejoué — commande refusée'])
  })
})

describe('C6 — fichier du TEST: absent', () => {
  // Entrée qui ferait échouer : lancer `run` sur un fichier que `list` ne voit pas — vitest
  // sortirait en code 1 et le reproche serait « confirmé » sans rien avoir reproduit.
  it('liste vide : rien n’est lancé, étiquette « non rejoué — fichier absent »', async () => {
    const { executer, appels } = fauxVitest({ existants: [B] })
    const r = await rejouerTestsDuJuge(
      verdictMineur(` | TEST: ${A} | npx vitest run ${A}`),
      RACINE,
      executer
    )
    expect(appels.map((a) => a.args[0])).toEqual(['list'])
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['non rejoué — fichier absent'])
    expect(bloque(r.texte)).toBe(true)
  })
})

describe('C7 — chemin qui attrape d’autres fichiers', () => {
  // Entrée qui ferait échouer : `juge.test.ts`, valide en forme, mais qui attrape deux fichiers.
  it('liste plus large que les chemins cités : rien n’est lancé, « non rejoué — chemin ambigu »', async () => {
    const { executer, appels } = fauxVitest({
      existants: ['src/main/juge/memoire-juge.test.ts', 'src/main/gates/questions-juge.test.ts'],
      codes: { 'juge.test.ts': 0 }
    })
    const r = await rejouerTestsDuJuge(
      verdictMineur(' | TEST: juge.test.ts | npx vitest run juge.test.ts'),
      RACINE,
      executer
    )
    expect(appels.map((a) => a.args[0])).toEqual(['list'])
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['non rejoué — chemin ambigu'])
    expect(bloque(r.texte)).toBe(true)
  })
})

describe('C8 — commande qui ne rend pas la main', () => {
  // Entrée qui ferait échouer : un délai dépassé (code null) lu comme un code 0.
  it('rejeu coupé : le reproche reste bloquant, « non rejoué — délai dépassé »', async () => {
    const { executer } = fauxVitest({ existants: [A], codes: { [A]: 'delai' } })
    const r = await rejouerTestsDuJuge(
      verdictMineur(` | TEST: ${A} | npx vitest run ${A}`),
      RACINE,
      executer
    )
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['non rejoué — délai dépassé'])
    expect(bloque(r.texte)).toBe(true)
  })

  it('liste coupée : même étiquette, et le rejeu n’est pas lancé', async () => {
    const { executer, appels } = fauxVitest({ existants: [A], listeEnDelai: true })
    const r = await rejouerTestsDuJuge(
      verdictMineur(` | TEST: ${A} | npx vitest run ${A}`),
      RACINE,
      executer
    )
    expect(appels.map((a) => a.args[0])).toEqual(['list'])
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['non rejoué — délai dépassé'])
  })
})

describe('C9 — plusieurs TEST: sur un même reproche', () => {
  const deux = ` | TEST: ${A} | npx vitest run ${A} | TEST: ${B} | npx vitest run ${B}`

  // Entrée qui ferait échouer : le lecteur d'avant, qui ne gardait qu'un TEST: et collait le
  // second dans la commande du premier.
  it('les deux TEST: sont lus, chacun avec sa commande', () => {
    expect(testsDuJuge(verdictMineur(deux))).toEqual([
      { fichier: A, commande: `npx vitest run ${A}` },
      { fichier: B, commande: `npx vitest run ${B}` }
    ])
  })

  it('tous passent → non reproduit', async () => {
    const { executer, appels } = fauxVitest({ existants: [A, B], codes: { [A]: 0, [B]: 0 } })
    const r = await rejouerTestsDuJuge(verdictMineur(deux), RACINE, executer)
    expect(appels.filter((a) => a.args[0] === 'run')).toHaveLength(2)
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['non reproduit'])
    expect(bloque(r.texte)).toBe(false)
  })

  // Entrée qui ferait échouer : « non reproduit » dès que le PREMIER passe.
  it('un seul échoue → confirmé, et tous sont rejoués', async () => {
    const { executer, appels } = fauxVitest({ existants: [A, B], codes: { [A]: 0, [B]: 1 } })
    const r = await rejouerTestsDuJuge(verdictMineur(deux), RACINE, executer)
    expect(appels.filter((a) => a.args[0] === 'run')).toHaveLength(2)
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['confirmé'])
    expect(bloque(r.texte)).toBe(true)
  })

  it('un passe et l’autre est refusé → reste bloquant, étiquette du refus', async () => {
    const { executer } = fauxVitest({ existants: [A, B], codes: { [A]: 0 } })
    const r = await rejouerTestsDuJuge(
      verdictMineur(` | TEST: ${A} | npx vitest run ${A} | TEST: ${B} | rm -rf src`),
      RACINE,
      executer
    )
    expect(r.rejeux.map((x) => x.etiquette)).toEqual(['non rejoué — commande refusée'])
    expect(bloque(r.texte)).toBe(true)
  })
})

describe('bornes du rejeu', () => {
  it(`au-delà de ${REJEUX_MAX} TEST:, les suivants ne sont pas lancés et restent bloquants`, async () => {
    const fichiers = Array.from({ length: REJEUX_MAX + 2 }, (_, i) => `src/t${i}.test.ts`)
    const codes = Object.fromEntries(fichiers.map((f) => [f, 0]))
    const { executer, appels } = fauxVitest({ existants: fichiers, codes })
    const texte = `VALIDE\nOBJECTIONS:\n${fichiers.map((f, i) => `- MINEUR: o${i} | TEST: ${f} | npx vitest run ${f}`).join('\n')}`
    const r = await rejouerTestsDuJuge(texte, RACINE, executer)
    expect(appels.filter((a) => a.args[0] === 'run')).toHaveLength(REJEUX_MAX)
    expect(r.rejeux.slice(REJEUX_MAX).map((x) => x.etiquette)).toEqual([
      'non rejoué — trop de tests',
      'non rejoué — trop de tests'
    ])
    expect(objectionsDuJuge(r.texte)).toHaveLength(2)
  })

  // Entrée qui ferait échouer : un UPDATE_SNAPSHOT hérité, qui réécrit les instantanés même sous CI.
  it('l’environnement du rejeu force CI=1, le mode Node d’Electron, et retire UPDATE_SNAPSHOT', () => {
    const env = environnementDuRejeu({ UPDATE_SNAPSHOT: '1', CI: 'false', PATH: 'x' })
    expect(env.CI).toBe('1')
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env.UPDATE_SNAPSHOT).toBeUndefined()
    expect(env.PATH).toBe('x')
  })
})

describe('branchement dans le parcours du juge', () => {
  // Entrée qui ferait échouer : retirer l'appel de l'orchestrateur (le rejeu ne servirait à rien).
  it('le verdict est rejoué dans la copie du run AVANT d’être lu', () => {
    const src = readFileSync(
      join(__dirname, '..', 'orchestration', 'orchestrator-parcours-sequentiel.ts'),
      'utf8'
    )
    const rejeu = src.indexOf('await rejouerTestsDuJuge(verdict.text, workCwd)')
    const lecture = src.indexOf('lireVerdictJuge(verdictAvecObjectionsPortees(verdict.text))')
    expect(rejeu).toBeGreaterThan(0)
    expect(lecture).toBeGreaterThan(rejeu)
  })
})
