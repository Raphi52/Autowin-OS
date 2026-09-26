import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { skillRoots } from './native-registry'
import { verifyTimeoutMs } from './verify-command'

/**
 * TROIS CLIQUETS SUR LE KIT, portes ici parce qu'ils ne tournaient PLUS nulle part.
 *
 * Constat du 2026-09-12, mesure en lancant le script : `skills/remake/verify-remake.ps1` resout son
 * kit depuis `$env:USERPROFILE\.claude` (ligne 18). Ce dossier ne contient ni `skills/`, ni `hooks/`
 * sur cette machine, et `stop-gate.ps1` n'existe NULLE PART dans le depot — le stop-gate vit en
 * TypeScript (`src/main/gates/stopgate.ts`). Le script echouait donc sur « fichier absent » avant sa
 * premiere assertion : un garde-fou qui ne mord jamais valide tout.
 *
 * Ce fichier porte la part VERIFIABLE dans ce depot : les regles presentes dans le corps de la
 * skill, les mecaniques canoniques qui ne doivent pas y etre re-derivees, le plafond de volume, et
 * les renvois croises entre skills. Ce qui n'est PAS porte, et pourquoi : toutes les assertions qui
 * rejouaient le hook PowerShell (whitelist `$replayWhitelist`, `Test-MeaningfulProof`,
 * `GATE_REPLAY_TIMEOUT_MS`) — ce hook n'existe pas ici, donc les rejouer serait inventer un oracle.
 */
const RACINE = skillRoots()[0]
const lire = (id: string): string =>
  readFileSync(join(RACINE, id, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n')

/** CORPS = frontmatter exclu : une regle citee seulement dans le selecteur ne compte pas. */
function corps(texte: string): string {
  const fin = texte.indexOf('\n---', 4)
  expect(fin, 'frontmatter introuvable').toBeGreaterThan(0)
  return texte.slice(fin)
}

/** La description du frontmatter, repliee sur une ligne (vide si absente). */
function descriptionDe(texte: string): string {
  const m = /^---\n([\s\S]*?)\n---/.exec(texte)
  if (!m) return ''
  const lignes = m[1].split('\n')
  const i = lignes.findIndex((l) => /^description:/.test(l))
  if (i < 0) return ''
  let j = i + 1
  while (j < lignes.length && !/^[a-zA-Z_-]+:/.test(lignes[j])) j++
  return [lignes[i].replace(/^description:\s*>?-?\s*/, ''), ...lignes.slice(i + 1, j)]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Prose = le fichier SANS blocs de code, sans accents graves et sans citations de declencheurs. */
function prose(texte: string): string {
  return texte
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/«[^»]*»/g, ' ')
    .replace(/"[^"\n]*"/g, ' ')
    .replace(/\bfor[a-zA-Zçéèêà]+/g, ' ')
}

const IDS = readdirSync(RACINE).filter((d) => existsSync(join(RACINE, d, 'SKILL.md')))

describe('cliquet remake — les regles de surete sont DANS le corps de la skill', () => {
  const remake = corps(lire('remake'))

  /* Les regles que les deux audits de remake ont fait inscrire. Une disparition silencieuse de
     l'une d'elles est exactement ce que le script PowerShell devait empecher. */
  const REGLES: Array<[string, string]> = [
    ['forme rejouable recommandee (script)', 'signal.ps1'],
    ['forme alternative (prefix)', 'npm test --prefix'],
    ['les DEUX contraintes du controle', 'DEUX contraintes indépendantes'],
    ['armement distinct du rouge', 'étape 3 prouve que le contrôle est armé'],
    ['preuve d armement', 'REJEU signal-cmd ECHOUE'],
    ['regime minimum impose', 'MINIMUM sur le parent'],
    ['etape 0 declaree ecrivante', "étape 0 n'est PAS en lecture seule"],
    ['attribution PAR FICHIER, co-sale', 'co-sale'],
    ['operation tierce en cours', 'index.lock'],
    ['ecrivains vivants avant sabotage', 'Inventorie les écrivains vivants'],
    ['trace avant la cassure', 'Écris la trace AVANT la cassure'],
    ['restauration par commande', 'git checkout -- <file>'],
    ['checkpoint bloquant apres restauration', 'point de contrôle bloquant'],
    ['handle verifie sur le CONTENU', 'git show --stat <hash>'],
    ['nettoyage borne, prune interdit', 'jamais `git worktree prune`'],
    ['historique partage non reecrit', 'commit de 0.a reste'],
    ['commits etrangers avant revert', "Cherche d'abord les commits étrangers"],
    ['revert nomme et abort', 'git revert --abort'],
    ['rollback de donnees re-sonde', 'la restauration est INTERDITE'],
    ['copie hors git avec exclusions', "énumérant ce qu'elle EXCLUT"],
    ['copies par partition apres etape 2', "par partition, après l'étape 2"],
    ['rejeus du controle dans le tally', 'un rejeu du contrôle par RUN'],
    ['terrain compte dans le tally', 'N `terrain` if armed'],
    ['bracket d agents du regime', "fourchette d'agents"],
    ['fourchette pour l indecidable', 'FOURCHETTE avec sa borne haute'],
    ['timeout distingue d une regression', 'Est-ce seulement un rouge ?'],
    ['bisection par partition', 'Bissecte par PARTITION'],
    ['dispatch : perimetre gradue', 'Il est GRADUÉ'],
    ['exclusion draft', "ALLURE d'un écran (→ `draft`)"],
    ['flaky hors signal-cmd', 'Signal instable'],
    ['variante attestable a la cloture', 'attestation FRAÎCHE'],
    ['cap : releve = perimetre gele', 'PAS une option autonome'],
    ['taille assumee et justifiee', "long EXPRÈS, et il n'est pas scindé"]
  ]

  for (const [nom, motif] of REGLES) {
    it(`porte la regle « ${nom} »`, () => {
      expect(remake.includes(motif), `motif absent : ${motif}`).toBe(true)
    })
  }

  it('ne re-derive PAS une mecanique canonique du moteur', () => {
    for (const interdit of [
      'runs\\<session_id>',
      'le contrôle d’arrêt bloque une décision portant moins',
      'Chaque enfant se termine `green` avec sa preuve'
    ]) {
      expect(remake.includes(interdit), `re-derivation a retirer : ${interdit}`).toBe(false)
    }
  })

  it('n ecrit le contrat de dispatch QU UNE fois', () => {
    expect(remake.split('chemin absolu du RUN enfant').length - 1).toBe(1)
  })

  /* CLIQUET de volume : ce n'est pas un objectif de reduction, il interdit la croissance
     SILENCIEUSE. Le relever exige de dire pourquoi, ici meme. */
  it('reste sous son plafond de lignes assume', () => {
    expect(lire('remake').split('\n').length).toBeLessThanOrEqual(460)
  })
})

describe('cliquet remake — les renvois vers les skills voisines resolvent', () => {
  it('frame enchaine bien sur terrain, et remake desarme cet enchainement', () => {
    expect(corps(lire('frame'))).toContain('Passe la main à `terrain`')
    expect(corps(lire('remake'))).toContain("N'enchaîne PAS sur `terrain`")
  })

  it('frame exige toujours les trois sections que remake cite', () => {
    const frame = corps(lire('frame'))
    for (const section of ['## Besoin', '## Contraintes', '## Confiance']) {
      expect(frame).toContain(section)
    }
  })

  it('remake renvoie aux chapitres du moteur qui existent', () => {
    const remake = corps(lire('remake')).toLowerCase()
    const engine = readFileSync(join(RACINE, '_engine', 'ENGINE.md'), 'utf8')
    for (const ch of ['ch.1', 'ch.3', 'ch.4']) expect(remake).toContain(ch)
    for (const ch of ['## Ch.1', '## Ch.3', '## Ch.4']) expect(engine).toContain(ch)
  })

  it('le plafond de verification cite par remake est CELUI que l app applique', () => {
    // Defaut mesure le 2026-09-12 : la skill annoncait « 120 s » et « rend 124 », heritage du hook
    // PowerShell disparu. L'app arrete a 600 000 ms et rend exitCode: null (verify-command.ts:75).
    expect(verifyTimeoutMs({} as NodeJS.ProcessEnv)).toBe(600_000)
    const remake = corps(lire('remake'))
    expect(remake).toContain('600 000 ms')
    expect(remake).not.toContain('120 s')
    expect(remake).not.toContain('rend 124')
  })
})

describe('cliquet kit — marge de description sur TOUTES les skills', () => {
  /*
   * La garde precedente ne couvrait que SIX noms ecrits en dur : une skill hors liste pouvait
   * regrimper jusqu'au plafond dur de 1024 sans que rien ne le dise. Elle porte desormais sur
   * l'integralite du kit, decouvert sur disque.
   */
  const MARGE = 950

  it('decouvre bien le kit (sinon l assertion suivante ne prouve rien)', () => {
    expect(IDS.length).toBeGreaterThanOrEqual(15)
  })

  /*
   * FRONTIERES — porte depuis `native-registry.description-plafond.test.ts` en meme temps que la
   * marge, et ELARGI a tout le kit : une description sans clause « ne pas utiliser pour » fait
   * choisir la skill pour un travail qu'elle ne sait pas faire (la regle que `graft` impose a
   * l'ecriture d'une skill). DETTE mesuree le 2026-09-12 : quatre descriptions n'en portent pas —
   * leur clause vit dans le CORPS, donc le routeur ne la voit pas. Elles sont NOMMEES ici plutot
   * que reecrites sans demande, et la liste ne peut que RETRECIR (test suivant).
   */
  const DETTE_FRONTIERE = ['clean', 'curate', 'heal', 'residus']
  const CLAUSE = /PAS pour|NE PAS utiliser|Ne pas utiliser|NE PAS l'utiliser|PAS l'utiliser/u

  it('chaque description hors dette dit ce pour quoi elle ne doit PAS servir', () => {
    const sansFrontiere = IDS.filter(
      (id) => !DETTE_FRONTIERE.includes(id) && !CLAUSE.test(descriptionDe(lire(id)))
    )
    expect(sansFrontiere).toEqual([])
  })

  it('la dette ne contient que des descriptions reellement encore sans clause', () => {
    const gueries = DETTE_FRONTIERE.filter((id) => CLAUSE.test(descriptionDe(lire(id))))
    expect(gueries).toEqual([])
  })

  it('aucune description ne depasse la marge', () => {
    const trop = IDS.map((id) => ({ id, taille: descriptionDe(lire(id)).length })).filter(
      (s) => s.taille === 0 || s.taille > MARGE
    )
    expect(trop).toEqual([])
  })
})

describe('cliquet kit — une skill ne melange pas deux langues', () => {
  /*
   * Le kit a ete traduit en francais le 2026-09-12. Sans garde, une edition future reintroduit de
   * l'anglais et l'agent doit traduire ses consignes a chaque tour. On ne compte QUE la prose : les
   * blocs de code, les chemins et les DECLENCHEURS entre guillemets restent libres — ce sont les
   * phrases que l'utilisateur tape, les traduire casserait le routage.
   */
  const MOTS_EN = /\b(the|with|that|which|should|would|must|when|every|never|from)\b/gi

  for (const id of IDS) {
    it(`la prose de « ${id} » est en francais`, () => {
      const trouves = prose(lire(id)).match(MOTS_EN) ?? []
      expect(trouves, `${id} : ${trouves.join(', ')}`).toEqual([])
    })
  }
})
