import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseScoutTable } from '../shared/scout-table'
import { lecteurAncrageDepuisDisque, plafonnerNotesScout, type EtatAncrage } from './scout-plafond'

const ENTETE = '| # | Score | Type | What | Why | How |\n|---|---|---|---|---|---|\n'

function lecteur(etats: Record<string, EtatAncrage>) {
  return (chemin: string, ligne: number): EtatAncrage =>
    etats[`${chemin}:${ligne}`] ?? 'incontrolable'
}

describe('plafond de preuve appliqué en code sur la sortie du scout', () => {
  /*
   * Le plafond n'existait qu'en texte (`phase-briefs.ts`, bloc PLAFOND DE PREUVE). Relu le 30/09 dans
   * les traces : conv-812 note 72 une piste dont le Pourquoi dit « Sous réserve : je n'ai cherché que
   * les minuteurs », conv-775 note 60 une piste dont le Pourquoi dit « la cause exacte n'est pas
   * vérifiée ». Les deux lignes réelles sont rejouées plus bas, telles quelles.
   */
  it('ramène à 50 une piste dont le Pourquoi avoue ne pas avoir vérifié, et retrie', () => {
    const texte =
      ENTETE +
      "| 1 | 72 | 🔧 fix | Cache périmé | je n'ai pas vérifié l'appelant | cache.ts:10 |\n" +
      '| 2 | 64 | 🔧 fix | Tri instable | ouvert, la ligne trie en place | tri.ts:4 |\n'
    const sortie = plafonnerNotesScout(texte)
    const lignes = parseScoutTable(sortie)!
    expect(lignes.map((l) => [l.num, l.score])).toEqual([
      ['2', 64],
      ['1', 50]
    ])
    // La raison est dite, sous le tableau.
    expect(sortie).toMatch(/ramenée à 50/u)
    expect(sortie).toMatch(/pas vérifié/u)
  })

  it('reconnaît « non vérifié » et « pas encore vérifié »', () => {
    for (const aveu of ['impact non vérifié', 'pas encore vérifié sur le disque']) {
      const sortie = plafonnerNotesScout(`${ENTETE}| 1 | 80 | 🆕 new | X | ${aveu} | a faire |\n`)
      expect(parseScoutTable(sortie)![0]!.score, aveu).toBe(50)
    }
  })

  it('rattrape les aveux RÉELS de conv-812 et conv-775, recopiés de leurs traces', () => {
    // Recopiées des traces `runs/conv-812/…mue82xnq-workspace` et `runs/conv-775/…mucgijeo-workspace`.
    const conv812 =
      "| 1 | 72 | 🆕 feature | Relevé mémoire/processeur par processus (principal, fenêtre, workers) | Les gels de la boucle sont mesurés (`event-loop-stalls.ts:69`, `gel-main.ts:338`), mais je n'ai vu aucun relevé de mémoire ni de processeur. Sous réserve : je n'ai cherché que les minuteurs, pas `app.getAppMetrics` dans tout le dépôt. | 1er pas : appeler `app.getAppMetrics()` toutes les 60 s dans `gel-main.ts` (déjà un minuteur), l'écrire dans le même journal et l'afficher dans `PerfLagPanel`. C'est fait quand on peut lire un chiffre en Mo et en % par type de processus. |\n"
    const conv775 =
      "| 2 | 60 | 🔧 fix | `src/main/dashboards/runs.ts:66-80` : un statut `unknown` reste affiché tel quel | `status` démarre à `'unknown'`. Il n'est remplacé que par une ligne `status:` placée avant le premier `## ` et présente dans `STATUSES`. Les 8 runs sont `unknown` + bloqués. Je n'ai pas lu leurs RUN.md : la cause exacte n'est pas vérifiée (en-tête absent ? valeur hors liste ?). Score plafonné pour cette raison. | Ouvrir un RUN.md clash-royale et comparer son en-tête au parseur. Ensuite, soit accepter la valeur trouvée, soit rendre « statut illisible » visible dans le tableau de bord. |\n"
    for (const [nom, ligne] of [
      ['conv-812', conv812],
      ['conv-775', conv775]
    ] as const) {
      expect(parseScoutTable(plafonnerNotesScout(ENTETE + ligne))![0]!.score, nom).toBe(50)
    }
  })

  it('un Pourquoi qui se dit DÉDUCTIF est plafonné, comme le dit la consigne', () => {
    // Formulation relevée dans conv-775 (piste 3) et conv-812 (piste 4), notées 45 : ici portée à 70.
    const texte = `${ENTETE}| 1 | 70 | 🆕 feature | Archiver les runs bloqués | C'est une déduction : je n'ai pas mesuré leur âge. | archiver |
`
    expect(parseScoutTable(plafonnerNotesScout(texte))![0]!.score).toBe(50)
  })

  it('ne touche pas un Pourquoi qui décrit le défaut sans avouer de doute', () => {
    // « le test vérifie SKILL.md, pas la consigne » : un constat, pas un aveu.
    const texte = `${ENTETE}| 1 | 88 | 🔧 fix | Consigne amputée | le test vérifie SKILL.md, pas la consigne | a.ts:3 |\n`
    expect(plafonnerNotesScout(texte)).toBe(texte)
  })

  it('garde la note quand le Pourquoi NOMME ses chemins fermés, comme le dit la consigne (règle 4)', () => {
    // Piste 4 du vrai scout du 30/09 (demande de conv-382), recopiée de artifacts/scout-reel-382-resultat.md.
    // Son « Non vérifié » porte sur un point annexe ; l'absence qu'elle affirme est « vérifié[e] dans
    // `gates/hooks.ts`, `orchestrator.ts` et `hooks/` ». La garde la ramenait de 70 à 50.
    const conv382 =
      "| 4 | 70 | 🔧 fix | Empêcher un agent de BUILD d'affaiblir le test qui le juge | `verify-replay-hook.ts:19` rejoue la vérification dans le dossier de l'agent, donc sur des tests qu'il a pu modifier. Aucune détection de `.skip`/`.only` ni d'assertion supprimée : vérifié dans `gates/hooks.ts` (qui lit déjà le diff à `:128-133`), `orchestrator.ts` et `hooks/`. L'interdiction n'existe qu'en texte (`constitution.ts:52`). Non vérifié : le juge, qui lui est un modèle, peut parfois le repérer. | Dans `gates/hooks.ts`, bloquer le passage au vert si le diff d'un `*.test.*` retire des `expect` ou ajoute `skip`/`only`. C'est fait quand un test simulé où le build ajoute `it.skip` est bien refusé. |\n"
    expect(parseScoutTable(plafonnerNotesScout(ENTETE + conv382))![0]!.score).toBe(70)
  })

  it('un chemin NIÉ n est pas un chemin fermé : « je n ai pas vérifié dans a.ts » reste plafonné', () => {
    for (const aveu of [
      "je n'ai pas vérifié dans `a.ts` ni ailleurs",
      "C'est une déduction : pas encore cherché dans `src/main/`",
      'non vérifié dans `b.ts`'
    ]) {
      const sortie = plafonnerNotesScout(`${ENTETE}| 1 | 80 | 🆕 new | X | ${aveu} | a faire |\n`)
      expect(parseScoutTable(sortie)![0]!.score, aveu).toBe(50)
    }
  })

  it('une note déjà à 50 ou moins ne bouge pas ; un texte sans tableau non plus', () => {
    const bas = `${ENTETE}| 1 | 45 | 🔧 fix | X | non vérifié | a.ts:3 |\n`
    expect(plafonnerNotesScout(bas)).toBe(bas)
    expect(plafonnerNotesScout('rien ici, non vérifié')).toBe('rien ici, non vérifié')
  })

  /*
   * conv-602 : la piste n°1, notée 88, était fausse — son ancrage `Program.cs:300-304` dit lui-même
   * que la classe citée a disparu (relevé par le run suivant, dans sa trace). Mais un
   * commentaire cité n'est PAS toujours faux : la piste 1 de conv-890 (vraie) citait
   * `orchestrator.ts:1371`, un commentaire qui documente une décision, avec `phase-briefs.ts:18-27`,
   * du code. Le plafond ne mord donc que si AUCUN ancrage contrôlable d'un correctif ne tombe sur du
   * code vivant.
   */
  it('plafonne un correctif dont aucun ancrage ne tombe sur du code vivant', () => {
    const cas: Array<[EtatAncrage, RegExp]> = [
      ['commentaire', /commentaire/u],
      ['vide', /ligne vide/u],
      ['hors-fichier', /après la fin/u],
      ['absent', /introuvable/u]
    ]
    for (const [etat, raison] of cas) {
      const texte = `${ENTETE}| 1 | 88 | 🔧 fix | Garde null | manque | Program.cs:300 |\n`
      const sortie = plafonnerNotesScout(texte, lecteur({ 'Program.cs:300': etat }))
      expect(parseScoutTable(sortie)![0]!.score, etat).toBe(50)
      expect(sortie, etat).toMatch(raison)
    }
  })

  it('garde la note quand un des ancrages tombe sur du code', () => {
    const texte = `${ENTETE}| 1 | 88 | 🔧 fix | Consigne | voir o.ts:1371 | p.ts:18-27 |\n`
    const sortie = plafonnerNotesScout(
      texte,
      lecteur({ 'o.ts:1371': 'commentaire', 'p.ts:18': 'code' })
    )
    expect(sortie).toBe(texte)
  })

  it('lit aussi l’ancrage porté par la colonne What (vrai scout du 30/09, piste 4)', () => {
    // Le scout réel rejoué le 30/09 sur la demande de conv-812 mettait son code dans What
    // (`conversations-disk.ts:512`) et citait dans Why une ligne du fichier CONSTRUIT
    // (`index.js:45784`, ignoré par git, donc lu « introuvable ») : sans What, la piste tombait à 50.
    const texte = `${ENTETE}| 4 | 66 | 🔧 fix | Démarrage : lu de façon synchrone (\`conversations-disk.ts:512\`) | La ligne \`index.js:45784\` du fichier construit apparaît dans le gel | Chargement asynchrone |\n`
    const sortie = plafonnerNotesScout(
      texte,
      lecteur({ 'conversations-disk.ts:512': 'code', 'index.js:45784': 'absent' })
    )
    expect(sortie).toBe(texte)
  })

  it('un nom de méthode suivi d un numéro n est pas un fichier (sortie réelle conv-607)', () => {
    const texte = `${ENTETE}| 1 | 88 | 🔧 fix | X | manque | Economie.sauver:170, voir a.lua:3. |\n`
    const vus: string[] = []
    plafonnerNotesScout(texte, (chemin, ligne) => {
      vus.push(`${chemin}:${ligne}`)
      return 'code'
    })
    expect(vus).toEqual(['a.lua:3'])
  })

  it('un ancrage incontrôlable (hors du dossier, nom ambigu) ne plafonne rien', () => {
    const texte = `${ENTETE}| 1 | 88 | 🔧 fix | X | manque | ailleurs.ts:9 |\n`
    expect(plafonnerNotesScout(texte, lecteur({}))).toBe(texte)
  })

  it('une nouveauté sans code existant n est pas plafonnée pour son ancrage', () => {
    const texte = `${ENTETE}| 1 | 80 | 🆕 new | X | valeur | brancher dans os.ts:566 |\n`
    expect(plafonnerNotesScout(texte, lecteur({ 'os.ts:566': 'commentaire' }))).toBe(texte)
  })

  it('le tableau de la skill (colonne Note, Comment) est plafonné pareil', () => {
    const texte =
      '| # | Note | Type | Quoi | Pourquoi | Comment |\n|---|---|---|---|---|---|\n' +
      '| 1 | 90 | 🔧 correctif | X | non vérifié | a.ts:3 |\n'
    expect(parseScoutTable(plafonnerNotesScout(texte))![0]!.score).toBe(50)
  })
})

function dossier(avecGit: boolean): string {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-plafond-'))
  mkdirSync(join(racine, 'src', 'profond'), { recursive: true })
  writeFileSync(
    join(racine, 'src', 'a.ts'),
    'const x = 1\n// ancien défaut réparé\n\n  * suite de doc\n'
  )
  writeFileSync(join(racine, 'src', 'profond', 'Program.cs'), 'int y = 2;\n')
  if (avecGit) execFileSync('git', ['init', '-q'], { cwd: racine, windowsHide: true })
  return racine
}

describe('lecture réelle des ancrages sur le disque', () => {
  const lire = lecteurAncrageDepuisDisque(dossier(true))

  it('distingue code, commentaire, ligne vide, fin de fichier et fichier absent', () => {
    expect(lire('src/a.ts', 1)).toBe('code')
    expect(lire('src/a.ts', 2)).toBe('commentaire')
    expect(lire('src/a.ts', 3)).toBe('vide')
    expect(lire('src/a.ts', 4)).toBe('commentaire')
    expect(lire('src/a.ts', 40)).toBe('hors-fichier')
    expect(lire('src/absent.ts', 1)).toBe('absent')
  })

  it('un chemin qui sort du dossier de travail est incontrôlable', () => {
    expect(lire('../../etc/passwd', 1)).toBe('incontrolable')
    expect(lire('C:/Windows/win.ini', 1)).toBe('incontrolable')
  })

  it('un nom nu se résout par la liste des fichiers du dépôt (conv-602 : `Program.cs:300`)', () => {
    expect(lire('Program.cs', 1)).toBe('code')
    expect(lire('profond/Program.cs', 1)).toBe('code')
    expect(lire('Inconnu.cs', 1)).toBe('absent')
  })

  it('sans dépôt git, un nom qui n est pas à la racine reste incontrôlable', () => {
    const sansGit = lecteurAncrageDepuisDisque(dossier(false))
    expect(sansGit('src/a.ts', 2)).toBe('commentaire')
    expect(sansGit('Program.cs', 1)).toBe('incontrolable')
  })
})
