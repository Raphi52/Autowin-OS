#!/usr/bin/env node
/**
 * L'ESSAI DE BOUT EN BOUT DU VILLAGE COMMUN (plan « Village commun », conv-1429, lot 5).
 *
 * Pourquoi : les lots 1 à 4 ont chacun leurs tests, mais aucun ne joue la chaîne entière — un poste
 * qui PUBLIE, un autre qui RELIT — sur un vrai dossier. Cet essai la joue avec le code réel, chargé
 * depuis `src/` (esbuild) : registre de la vue (`agents-quartier.ts`) → canaux du processus principal
 * (`ipc/quartier-presence.ts`) → filtre et écriture (`quartier-presence.ts`) → `presence.json` sur un
 * dossier de Board TEMPORAIRE → relecture d'un autre poste (`quartier-presence-collegues.ts`) →
 * agents prêts pour la scène (`agents-collegues.ts`).
 *
 * Critères (cadrage `grill/agent-hq-japon-town.md`, D-9, D6, D-10) :
 *  1. titre filtré : ni chemin, ni mail, ni long numéro, sur le fichier ET dans la vue du collègue ;
 *  2. fil privé : son tanuki part, sans titre ;
 *  3. interrupteur coupé : aucun agent vu, le fichier reste (jamais de suppression), et il revient ;
 *  4. fichier de plus de 3 min ignoré (un témoin de 2 min, lui, est vu) ;
 *  5. fichier piégé écarté (trop gros, JSON cassé, format inconnu, daté dans le futur, champs piégés,
 *     usurpation d'un autre poste) ;
 *  6. couleur stable tirée du poste, sans redistribution entre présents (décision du chef, 2026-11-02).
 *
 * Ce qui n'est PAS joué ici : Electron. Son `ipcMain` devient un carnet de canaux et la garde d'origine
 * (qui lit la frame Electron) laisse passer ; le réglage `reglage` de la publication est recopié de
 * `src/main/index.ts`. Le délai de 5 s entre deux écritures est mis à 0 (il est couvert par
 * `quartier-presence.test.ts`) ; celui de 4 s entre deux relectures est gardé, l'essai l'attend.
 *
 * Usage : node scripts/village-commun-essai.mjs [--garder] [--mutant <nom>]
 *   --garder : ne supprime pas le dossier temporaire ;
 *   --mutant : casse UNE règle dans le code chargé (jamais dans `src/`), pour prouver que l'essai sait
 *              rougir : filtre, prive, coupe, perime, piege, couleur (voir `MUTANTS`).
 *
 * Autre mode : node scripts/village-commun-essai.mjs --partage-reel [--donnees <dossier>]
 *   LECTURE SEULE du vrai partage réglé dans `board-dossier.json` (défaut : `.autowin-data/autowin-os`) :
 *   le `presence.json` de ce poste existe-t-il, de quand date-t-il, combien d'agents, ses titres sont-ils
 *   propres ; et ce que ce poste voit des collègues. Rien n'y est écrit. Ajouté parce que l'app qui
 *   tournait pendant le lot 5 précédait le lot 1 : ce contrôle se rejoue après son redémarrage.
 *
 * Code de sortie : 0 tout passe · 1 au moins un contrôle rouge · 2 l'essai n'a pas pu tourner.
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GARDER = process.argv.includes('--garder')
const MUTANT = (() => {
  const i = process.argv.indexOf('--mutant')
  return i >= 0 ? process.argv[i + 1] : null
})()

/**
 * Un mutant = une règle cassée dans le code chargé, celle que garde un critère. Si l'essai reste vert
 * face à son mutant, ce critère ne prouve rien.
 */
const MUTANTS = {
  filtre: [
    'src/main/mascotte/quartier-presence-filtre.ts',
    '  return couper(t, max)',
    "  return String(brut ?? '')"
  ],
  prive: [
    'src/main/mascotte/quartier-presence.ts',
    "const titre = a.prive ? '' : filtrerTitre(a.titre)",
    'const titre = filtrerTitre(a.titre)'
  ],
  coupe: ['src/main/mascotte/quartier-presence.ts', 'if (!reglage.partager)', 'if (false)'],
  perime: [
    'src/main/mascotte/quartier-presence-collegues.ts',
    'if (Math.abs(a - lu.enregistreA) > PRESENCE_PERIMEE_MS) continue',
    ''
  ],
  piege: [
    'src/main/mascotte/quartier-presence-collegues.ts',
    'if (!id || id.length > ID_MAX) return null',
    'if (!id) return null'
  ],
  couleur: [
    'src/renderer/src/quartier/agents-collegues.ts',
    'const couleur = couleurDuPoste(poste)',
    'const couleur = PALETTE_COLLEGUES[parPersonne.length % PALETTE_COLLEGUES.length]'
  ]
}

/** Applique le mutant demandé au chargement de son fichier ; un motif introuvable arrête l'essai. */
function pluginMutant(nom) {
  const m = MUTANTS[nom]
  if (!m) throw new Error(`Mutant inconnu : ${nom} (connus : ${Object.keys(MUTANTS).join(', ')})`)
  const [relatif, avant, apres] = m
  const cible = resolve(RACINE, relatif).toLowerCase()
  return {
    name: 'mutant',
    setup(b) {
      b.onLoad({ filter: /\.ts$/ }, (args) => {
        if (resolve(args.path).toLowerCase() !== cible) return undefined
        const source = readFileSync(args.path, 'utf8')
        if (!source.includes(avant)) throw new Error(`Mutant ${nom} : motif absent de ${relatif}`)
        return { contents: source.replace(avant, apres), loader: 'ts' }
      })
    }
  }
}

const ENTREE = `
export { registerQuartierPresenceIpc } from './src/main/ipc/quartier-presence.ts'
export { creerPublicationDeLaPresence } from './src/main/mascotte/quartier-presence.ts'
export { creerDossierDuBoard, sousDossierDuPoste } from './src/main/board/board-dossier.ts'
export { creerLecteurDePresence } from './src/main/mascotte/quartier-presence-collegues.ts'
export * as presence from './src/shared/quartier-presence.ts'
export { appliquerResumes, agentAPublier } from './src/renderer/src/quartier/agents-quartier.ts'
export {
  agentsDesCollegues,
  couleurDuPoste,
  PALETTE_COLLEGUES,
  COLLEGUES_AGENTS_MAX
} from './src/renderer/src/quartier/agents-collegues.ts'
`

/** Electron n'existe pas sous Node : on garde les canaux tels quels, sans la fenêtre qui les appelle. */
const SANS_ELECTRON = {
  name: 'sans-electron',
  setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'essai' }))
    b.onResolve({ filter: /(^|[\\/])ipc-senders$/ }, () => ({
      path: 'ipc-senders',
      namespace: 'essai'
    }))
    b.onLoad({ filter: /^electron$/, namespace: 'essai' }, () => ({
      contents:
        'export const ipcMain = { handle: (canal, fn) => globalThis.__canauxEssai.set(canal, fn) }',
      loader: 'js'
    }))
    b.onLoad({ filter: /^ipc-senders$/, namespace: 'essai' }, () => ({
      contents: 'export function assertTrustedRendererSender() {}',
      loader: 'js'
    }))
  }
}

async function chargerLeCode(dossierEssai) {
  const sortie = await build({
    stdin: {
      contents: ENTREE,
      resolveDir: RACINE,
      sourcefile: 'village-commun-entree.mjs',
      loader: 'js'
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    logLevel: 'silent',
    plugins: [SANS_ELECTRON, ...(MUTANT ? [pluginMutant(MUTANT)] : [])]
  })
  const fichier = join(dossierEssai, 'village-commun-code.mjs')
  await writeFile(fichier, sortie.outputFiles[0].text, 'utf8')
  return import(pathToFileURL(fichier).href)
}

// ———————————————————————————————————————————————————————————————— les contrôles

const resultats = []
function controler(critere, controle, ok, detail = '') {
  resultats.push({ critere, controle, ok: Boolean(ok), detail })
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

// ———————————————————————————————————————————————————————————————— un poste

/** Un poste comme dans `src/main/index.ts` : son réglage du Board, sa publication, ses canaux. */
async function monterPoste(m, { board, racine, compte, nom }) {
  await mkdir(racine, { recursive: true })
  await writeFile(
    join(racine, 'board-dossier.json'),
    `${JSON.stringify({ dossier: board, nom }, null, 2)}\n`,
    'utf8'
  )
  const dossierDuBoard = m.creerDossierDuBoard({ racine, utilisateur: compte })
  const poste = m.sousDossierDuPoste(compte)
  // Recopié de `src/main/index.ts` (appel de `registerQuartierPresenceIpc`).
  const publication = m.creerPublicationDeLaPresence({
    poste,
    reglage: () => {
      const etat = dossierDuBoard.etat()
      return {
        dossier: etat.dossier,
        nom: dossierDuBoard.nomDuPoste().nom,
        partager: etat.partagerPresence !== false
      }
    },
    delaiMs: 0,
    battementMs: 60 * 60_000
  })
  globalThis.__canauxEssai = new Map()
  m.registerQuartierPresenceIpc({ dossierDuBoard, publication })
  const canaux = globalThis.__canauxEssai
  let derniereLecture = Number.NEGATIVE_INFINITY
  const appeler = (canal, ...args) => {
    const fn = canaux.get(canal)
    if (!fn) throw new Error(`Canal absent : ${canal}`)
    return fn({}, ...args)
  }
  return {
    poste,
    racine,
    publication,
    appeler,
    fichier: join(board, poste, m.presence.FICHIER_PRESENCE),
    /** Ce que la vue enverrait : les résumés de fils passent par le vrai registre des tanukis. */
    async publierDepuisLaVue(resumes) {
      const carte = m.appliquerResumes(new Map(), resumes, Date.now())
      await appeler('os:quartier-presence:agents', [...carte.values()].map(m.agentAPublier))
      await publication.attendre()
    },
    /** Ce que verrait l'Accueil de ce poste : relecture du partage, puis agents prêts pour la scène. */
    async voir() {
      // La relecture garde 4 s entre deux passages : l'essai attend comme l'Accueil attendrait.
      const reste = derniereLecture + m.presence.PRESENCE_DELAI_RELECTURE_MS + 150 - Date.now()
      if (reste > 0) await attendre(reste)
      const presences = await appeler('os:quartier-presence:collegues')
      derniereLecture = Date.now()
      return { presences, agents: m.agentsDesCollegues(presences, Date.now()) }
    }
  }
}

async function lireJson(fichier) {
  const texte = await readFile(fichier, 'utf8')
  return { texte, json: JSON.parse(texte) }
}

// ———————————————————————————————————————————————————————————————— les données de l'essai

const MORCEAUX_SENSIBLES = [
  'Projets',
  'Client X',
  'rapport',
  '.pdf',
  'prenom.nom',
  'exemple.fr',
  '@',
  '123 456',
  '789 012',
  'serveur',
  'intranet',
  'https',
  'confidentiel',
  'Dupont'
]

const FORMES_SENSIBLES = [
  ['chemin à lettre de lecteur', /[A-Za-z]:[\\/]/],
  ['barre oblique inverse (chemin Windows ou UNC)', /\\/],
  ['adresse mail', /\S+@\S+\.\S+/],
  ['adresse web', /https?:\/\/|www\./i],
  ['nombre de 6 chiffres et plus', /\d(?:[ .\u00a0\u202f]?\d){5,}/]
]

function resumesDuPosteA() {
  const a = Date.now()
  const fil = (id, title, prive = false) => ({
    id,
    title,
    updatedAt: a,
    hasStreamingTurn: true,
    ...(prive ? { prive: true } : {})
  })
  return [
    fil('conv-1', 'Corriger D:\\Projets\\Client X\\rapport final.pdf avant envoi'),
    fil('conv-2', 'Répondre à prenom.nom@exemple.fr sur le dossier 123 456 789 012'),
    fil('conv-3', 'Contrat confidentiel de la société Dupont', true),
    fil(
      'conv-4',
      'Lire \\\\serveur\\partage\\Projets IA\\Board et https://intranet.exemple.fr/p?id=42'
    ),
    fil('conv-5', `Analyse ${'très '.repeat(60)}longue`),
    fil('conv-6', 'Préparer la démo /build du quartier')
  ]
}

const iso = (ms) => new Date(ms).toISOString()
const agentValide = (id, titre) => ({
  id,
  titre,
  phase: 'travail',
  metier: 'lire',
  depuis: iso(Date.now() - 30_000)
})
const presenceValide = (poste, nom, agents, enregistreA = Date.now()) => ({
  format: 'autowin-presence/1',
  poste,
  nom,
  enregistreA: iso(enregistreA),
  agents
})

/** Les autres postes du partage, écrits à la main : un témoin, un périmé, et des fichiers piégés. */
async function semerLesAutresPostes(board) {
  const ecrire = async (poste, contenu) => {
    await mkdir(join(board, poste), { recursive: true })
    await writeFile(
      join(board, poste, 'presence.json'),
      typeof contenu === 'string' ? contenu : JSON.stringify(contenu, null, 2),
      'utf8'
    )
  }
  const a = Date.now()
  await ecrire(
    'denis.temoin',
    presenceValide(
      'denis.temoin',
      'Denis Roux',
      [agentValide('conv-7', 'Relire le plan')],
      a - 2 * 60_000
    )
  )
  await ecrire(
    'chloe.perime',
    presenceValide(
      'chloe.perime',
      'Chloé Petit',
      [agentValide('conv-8', 'Poste éteint')],
      a - (3 * 60_000 + 15_000)
    )
  )
  await ecrire(
    'piege-gros',
    presenceValide('piege-gros', 'Gros', [agentValide('conv-9', 'x'.repeat(20_000))])
  )
  await ecrire('piege-json', '{ "format": "autowin-presence/1", "agents": [ ')
  await ecrire('piege-format', {
    ...presenceValide('piege-format', 'Format', []),
    format: 'autre/9'
  })
  await ecrire(
    'piege-futur',
    presenceValide(
      'piege-futur',
      'Futur',
      [agentValide('conv-10', 'Jamais vieux')],
      a + 60 * 60_000
    )
  )
  await ecrire(
    'piege-usurpe',
    presenceValide('alice.martin', 'Faux Alice', [agentValide('conv-1', 'Je suis Alice')])
  )
  await ecrire(
    'piege-champs',
    presenceValide(`Eve${'\u0000'}${'e'.repeat(500)}`, `Eve${'\u202e'}${'e'.repeat(500)}`, [
      { ...agentValide(`conv-${'a'.repeat(500)}`, 'Identifiant trop long') },
      { ...agentValide('conv-11', 'Phase inventée'), phase: 'rm -rf /' },
      {
        ...agentValide('conv-12', '<img src=x onerror=alert(1)>\u202eabc'),
        metier: '<script>alert(1)</script>'
      },
      { ...agentValide('conv-13', 'x'), titre: { piege: true } },
      ...Array.from({ length: 40 }, (_, i) => agentValide(`conv-${100 + i}`, `Agent ${i}`))
    ])
  )
  // Un `presence.json` qui est un dossier : ni lu, ni erreur.
  await mkdir(join(board, 'piege-dossier', 'presence.json'), { recursive: true })
}

// ———————————————————————————————————————————————————————————————— l'essai

async function jouer(m, dossierEssai) {
  const board = join(dossierEssai, 'board')
  await mkdir(board, { recursive: true })
  const { couleurDuPoste, PALETTE_COLLEGUES, COLLEGUES_AGENTS_MAX } = m
  const P = m.presence

  const A = await monterPoste(m, {
    board,
    racine: join(dossierEssai, 'userData-A'),
    compte: 'alice.martin',
    nom: 'Alice Martin'
  })
  const B = await monterPoste(m, {
    board,
    racine: join(dossierEssai, 'userData-B'),
    compte: 'bruno.durand',
    nom: 'Bruno Durand'
  })
  await semerLesAutresPostes(board)

  // ——— A publie (lot 1, lot 3), B publie aussi un agent : il ne doit pas se voir lui-même.
  await A.publierDepuisLaVue(resumesDuPosteA())
  await B.publierDepuisLaVue([
    { id: 'conv-20', title: 'Mon propre fil', updatedAt: Date.now(), hasStreamingTurn: true }
  ])

  const fichierA = await lireJson(A.fichier)
  const agentsFichierA = fichierA.json.agents
  const etatA = await A.appeler('os:quartier-presence:etat')

  // 1. Titre filtré — sur le fichier écrit par A.
  const C1 = '1. Titre filtré'
  controler(
    C1,
    'presence.json de A écrit au format autowin-presence/1',
    fichierA.json.format === P.FORMAT_PRESENCE
  )
  controler(
    C1,
    'A publie ses 6 tanukis',
    agentsFichierA.length === 6,
    `${agentsFichierA.length} agents`
  )
  controler(
    C1,
    "l'état de A dit sa dernière écriture, sans erreur",
    etatA.dernier && !etatA.erreur,
    JSON.stringify(etatA.dernier ?? etatA.erreur)
  )
  for (const morceau of MORCEAUX_SENSIBLES)
    controler(C1, `fichier de A sans « ${morceau} »`, !fichierA.texte.includes(morceau))
  const titresA = agentsFichierA.map((a) => a.titre).filter((t) => typeof t === 'string')
  for (const [nomForme, forme] of FORMES_SENSIBLES)
    controler(
      C1,
      `aucun titre écrit avec ${nomForme}`,
      !titresA.some((t) => forme.test(t)),
      titresA.filter((t) => forme.test(t)).join(' | ')
    )
  controler(
    C1,
    'tout titre écrit ≤ 80 caractères',
    titresA.every((t) => Array.from(t).length <= P.PRESENCE_TITRE_MAX),
    titresA.map((t) => Array.from(t).length).join(',')
  )
  const titre6 = agentsFichierA.find((a) => a.id === 'conv-6')?.titre ?? ''
  controler(
    C1,
    'le filtre garde le reste du titre (« Préparer la démo /build »)',
    titre6.includes('Préparer la démo /build'),
    titre6
  )
  controler(
    C1,
    'titre du chemin réduit sans fuite',
    (agentsFichierA.find((a) => a.id === 'conv-1')?.titre ?? '') === 'Corriger … avant envoi',
    agentsFichierA.find((a) => a.id === 'conv-1')?.titre
  )
  const tailleA = (await stat(A.fichier)).size
  controler(C1, 'fichier de A < 16 Ko', tailleA < P.PRESENCE_TAILLE_MAX, `${tailleA} octets`)
  const restesA = (await readdir(join(board, A.poste))).filter((f) => f !== 'presence.json')
  controler(C1, 'écriture atomique : aucun reste .tmp', restesA.length === 0, restesA.join(', '))

  // B relit.
  const vue1 = await B.voir()
  const deA1 = vue1.agents.filter((a) => a.collegue.poste === A.poste)
  controler(C1, 'B voit les 6 tanukis de A', deA1.length === 6, `${deA1.length} vus`)
  const titresVusParB = deA1.map((a) => a.titre)
  for (const [nomForme, forme] of FORMES_SENSIBLES)
    controler(
      C1,
      `aucun titre vu par B avec ${nomForme}`,
      !titresVusParB.some((t) => forme.test(t))
    )
  controler(
    C1,
    'aucun morceau sensible dans ce que B voit',
    !MORCEAUX_SENSIBLES.some((s) => JSON.stringify(deA1).includes(s))
  )

  // 2. Fil privé.
  const C2 = '2. Fil privé sans titre'
  const priveFichier = agentsFichierA.find((a) => a.id === 'conv-3')
  controler(C2, 'le tanuki du fil privé est publié', Boolean(priveFichier))
  controler(
    C2,
    'il est écrit SANS clé titre',
    priveFichier && !('titre' in priveFichier),
    JSON.stringify(priveFichier)
  )
  controler(
    C2,
    'son titre brut n’est nulle part dans le fichier',
    !/Contrat|confidentiel|Dupont/.test(fichierA.texte)
  )
  const priveVu = deA1.find((a) => a.collegue.idFil === 'conv-3')
  controler(
    C2,
    'B voit son tanuki, titre vide',
    priveVu && priveVu.titre === '',
    JSON.stringify(priveVu?.titre)
  )

  // 4. Périmé.
  const C4 = '4. Fichier de plus de 3 min ignoré'
  const postesVus1 = vue1.presences.collegues.map((c) => c.poste)
  controler(
    C4,
    'chloe.perime (3 min 15 s) ignoré',
    !postesVus1.includes('chloe.perime'),
    postesVus1.join(', ')
  )
  controler(C4, 'témoin denis.temoin (2 min) vu', postesVus1.includes('denis.temoin'))
  controler(
    C4,
    'un fichier périmé n’est pas une erreur',
    !(vue1.presences.erreur ?? '').includes('chloe')
  )

  // 5. Piégés.
  const C5 = '5. Fichier piégé écarté'
  const erreur1 = vue1.presences.erreur ?? ''
  for (const piege of ['piege-gros', 'piege-json', 'piege-format'])
    controler(
      C5,
      `${piege} écarté et signalé`,
      !postesVus1.includes(piege) && erreur1.includes(piege),
      erreur1
    )
  controler(C5, 'piege-futur (daté dans 1 h) ignoré', !postesVus1.includes('piege-futur'))
  controler(
    C5,
    'piege-dossier (presence.json est un dossier) ignoré sans erreur',
    !postesVus1.includes('piege-dossier') && !erreur1.includes('piege-dossier')
  )
  controler(C5, 'B ne se relit pas lui-même', !postesVus1.includes(B.poste))
  const usurpe = vue1.agents.filter((a) => a.collegue.poste === 'piege-usurpe')
  controler(
    C5,
    'usurpation : le poste est le sous-dossier, pas la valeur écrite',
    usurpe.length === 1 && usurpe[0].id.startsWith('collegue:piege-usurpe:'),
    usurpe.map((a) => a.id).join(',')
  )
  controler(
    C5,
    'usurpation : rien ne se mêle aux tanukis de A',
    !deA1.some((a) => a.titre.includes('Je suis Alice')) &&
      deA1.every((a) => a.collegue.prenom === 'Alice')
  )
  const champs = vue1.presences.collegues.find((c) => c.poste === 'piege-champs')
  controler(C5, 'piege-champs relu (en-tête valide)', Boolean(champs))
  if (champs) {
    controler(
      C5,
      'identifiant de 500 caractères écarté',
      !champs.agents.some((a) => a.id.length > 80)
    )
    controler(C5, 'phase inventée écartée', !champs.agents.some((a) => a.id === 'conv-11'))
    const c12 = champs.agents.find((a) => a.id === 'conv-12')
    controler(
      C5,
      'métier inconnu ramené à null',
      c12 && c12.metier === null,
      JSON.stringify(c12?.metier)
    )
    controler(
      C5,
      'marque de sens d’écriture retirée du titre',
      c12 && !c12.titre.includes('\u202e'),
      JSON.stringify(c12?.titre)
    )
    controler(
      C5,
      'titre qui n’est pas du texte : agent sans titre',
      champs.agents.some((a) => a.id === 'conv-13' && !('titre' in a))
    )
    controler(
      C5,
      '15 agents au plus par collègue',
      champs.agents.length <= P.PRESENCE_AGENTS_MAX,
      `${champs.agents.length}`
    )
    controler(
      C5,
      'nom borné à 80, sans invisible',
      champs.nom.length <= 80 && !champs.nom.includes('\u202e'),
      `${champs.nom.length} car.`
    )
  }
  controler(
    C5,
    `scène : ${COLLEGUES_AGENTS_MAX} agents de collègues au plus`,
    vue1.agents.length <= COLLEGUES_AGENTS_MAX,
    `${vue1.agents.length}`
  )

  // 6. Couleur (décision du chef : stable, tirée du poste, sans redistribution).
  const C6 = '6. Couleur stable, tirée du poste'
  const couleurA1 = deA1[0]?.collegue.couleur
  controler(
    C6,
    'couleur de A = couleurDuPoste(« alice.martin »)',
    couleurA1 === couleurDuPoste(A.poste),
    couleurA1
  )
  controler(
    C6,
    'couleur prise dans la palette fixe de 8',
    PALETTE_COLLEGUES.length === 8 && PALETTE_COLLEGUES.includes(couleurA1)
  )
  controler(
    C6,
    'tous les tanukis de A ont la même couleur',
    deA1.every((a) => a.collegue.couleur === couleurA1)
  )
  controler(
    C6,
    'la casse du compte ne change pas la couleur',
    couleurDuPoste('ALICE.MARTIN') === couleurA1
  )
  const seule = m.agentsDesCollegues(
    { collegues: vue1.presences.collegues.filter((c) => c.poste === A.poste) },
    Date.now()
  )
  controler(
    C6,
    'pas de redistribution : A seul présent garde sa couleur',
    seule.length > 0 && seule.every((a) => a.collegue.couleur === couleurA1)
  )
  controler(
    C6,
    'usurpation : couleur du sous-dossier, pas de alice.martin',
    usurpe[0]?.collegue.couleur === couleurDuPoste('piege-usurpe')
  )

  // 3. Interrupteur coupé (D6) : par le vrai canal, qui écrit le réglage puis prévient la publication.
  const C3 = '3. Interrupteur coupé = aucun agent vu'
  const etatCoupe = await A.appeler('os:quartier-presence:partager', false)
  await A.publication.attendre()
  const reglageA = JSON.parse(await readFile(join(A.racine, 'board-dossier.json'), 'utf8'))
  controler(
    C3,
    'le canal range partagerPresence:false dans board-dossier.json',
    reglageA.partagerPresence === false && etatCoupe.partagerPresence === false
  )
  const coupe = await lireJson(A.fichier)
  controler(C3, 'presence.json de A gardé (jamais supprimé)', Boolean(coupe.json))
  controler(
    C3,
    'il dit coupe:true, agents vides',
    coupe.json.coupe === true && coupe.json.agents.length === 0,
    JSON.stringify({ coupe: coupe.json.coupe, agents: coupe.json.agents.length })
  )
  // Les tanukis de A continuent de bouger : la vue renvoie un instantané.
  await A.publierDepuisLaVue(resumesDuPosteA())
  const apres = await lireJson(A.fichier)
  controler(
    C3,
    'un nouvel instantané de la vue ne publie rien',
    apres.json.coupe === true && apres.json.agents.length === 0
  )
  const vue2 = await B.voir()
  controler(C3, 'B ne voit plus A', !vue2.presences.collegues.some((c) => c.poste === A.poste))
  controler(
    C3,
    'B voit 0 tanuki de A',
    vue2.agents.filter((a) => a.collegue.poste === A.poste).length === 0
  )
  // Rétabli : A revient, avec la même couleur.
  await A.appeler('os:quartier-presence:partager', true)
  await A.publication.attendre()
  const retabli = await lireJson(A.fichier)
  controler(
    C3,
    'rétabli : A republie ses 6 tanukis',
    !retabli.json.coupe && retabli.json.agents.length === 6
  )
  const vue3 = await B.voir()
  const deA3 = vue3.agents.filter((a) => a.collegue.poste === A.poste)
  controler(C3, 'rétabli : B revoit A', deA3.length === 6, `${deA3.length}`)
  controler(
    C6,
    'même couleur après coupure et retour',
    deA3.length > 0 && deA3.every((a) => a.collegue.couleur === couleurA1)
  )

  // Un troisième poste voit A de la même couleur que B : la couleur ne dépend pas du lecteur.
  const E = await monterPoste(m, {
    board,
    racine: join(dossierEssai, 'userData-E'),
    compte: 'eric.tiers',
    nom: 'Éric Tiers'
  })
  const vueE = await E.voir()
  const deAvuParE = vueE.agents.filter((a) => a.collegue.poste === A.poste)
  controler(
    C6,
    'un 3e poste voit A de la même couleur',
    deAvuParE.length > 0 && deAvuParE.every((a) => a.collegue.couleur === couleurA1)
  )
  const vueA = await A.voir()
  controler(
    C6,
    'A voit B de la couleur de « bruno.durand »',
    vueA.agents.some(
      (a) => a.collegue.poste === B.poste && a.collegue.couleur === couleurDuPoste(B.poste)
    )
  )
  controler(
    C5,
    'A ne se relit pas lui-même',
    !vueA.presences.collegues.some((c) => c.poste === A.poste)
  )

  for (const p of [A, B, E]) p.publication.arreter()
}

// ———————————————————————————————————————————————————————————————— le rapport

function rapporter() {
  const criteres = [...new Set(resultats.map((r) => r.critere))].sort()
  let rouges = 0
  for (const c of criteres) {
    const siens = resultats.filter((r) => r.critere === c)
    const ko = siens.filter((r) => !r.ok)
    rouges += ko.length
    console.log(
      `${ko.length ? '✗ ROUGE' : '✓ VERT '}  ${c} — ${siens.length - ko.length}/${siens.length} contrôles`
    )
    for (const r of siens)
      console.log(
        `    ${r.ok ? '✓' : '✗'} ${r.controle}${!r.ok && r.detail ? `  [${r.detail}]` : ''}`
      )
  }
  const verts = criteres.filter((c) => resultats.every((r) => r.critere !== c || r.ok)).length
  const libelle = PARTAGE_REEL
    ? 'PARTAGE RÉEL'
    : `ESSAI VILLAGE COMMUN${MUTANT ? ` (mutant ${MUTANT})` : ''}`
  console.log(
    `\n${libelle} : ${rouges ? 'ROUGE' : 'VERT'} — ${verts}/${criteres.length} critères, ${resultats.length - rouges}/${resultats.length} contrôles`
  )
  // Aucun contrôle joué n'est pas un vert : rien n'a été prouvé.
  return rouges === 0 && resultats.length > 0
}

// ———————————————————————————————————————————————————————————————— le vrai partage, en lecture seule

const PARTAGE_REEL = process.argv.includes('--partage-reel')
const DONNEES = (() => {
  const i = process.argv.indexOf('--donnees')
  return i >= 0 ? resolve(process.argv[i + 1]) : join(RACINE, '.autowin-data', 'autowin-os')
})()

// Bâtie depuis des codes numériques : écrits en échappements, ces caractères se perdaient à l'édition.
const INVISIBLES = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x2028, 0x202e],
    [0x2060, 0x2069],
    [0xfeff, 0xfeff]
  ]
    .map(([de, a]) => `${String.fromCharCode(de)}-${String.fromCharCode(a)}`)
    .join('')}]`,
  'g'
)

/** Une valeur lue sur le partage, prête pour la console : texte, sans invisible, coupée à `max`. */
function affichable(v, max) {
  if (v === undefined || v === null) return ''
  const t = String(typeof v === 'object' ? JSON.stringify(v) : v).replace(INVISIBLES, '')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Un `presence.json` du vrai partage, relu sans rien écrire ; `null` s'il n'existe pas. */
async function lirePresenceReelle(fichier) {
  try {
    const s = await stat(fichier)
    if (!s.isFile()) return null
    // Un fichier énorme sur le partage n'est pas lu : il est déjà rouge par sa taille.
    if (s.size > 1024 * 1024)
      return { taille: s.size, json: null, illisible: 'plus de 1 Mo, non lu' }
    const texte = await readFile(fichier, 'utf8')
    // Le fichier d'un collègue est une donnée : cassé, il se signale en rouge, il n'arrête pas la lecture.
    let json = null
    try {
      json = JSON.parse(texte)
    } catch (erreur) {
      return { taille: s.size, texte, json: null, illisible: String(erreur?.message ?? erreur) }
    }
    return { taille: s.size, texte, json }
  } catch (e) {
    if (e?.code === 'ENOENT') return null
    throw e
  }
}

async function lirePartageReel(m) {
  const P = m.presence
  const reglage = JSON.parse(await readFile(join(DONNEES, 'board-dossier.json'), 'utf8'))
  const dossier = typeof reglage.dossier === 'string' ? reglage.dossier : null
  if (!dossier) throw new Error(`Aucun dossier du Board réglé dans ${DONNEES}`)
  const poste = m.sousDossierDuPoste(process.env.USERNAME || userInfo().username)
  const coupeIci = reglage.partagerPresence === false
  console.log(`Partage : ${dossier}`)
  console.log(`Ce poste : ${poste} · interrupteur ${coupeIci ? 'COUPÉ' : 'actif'}\n`)
  const a = Date.now()
  const sous = (await readdir(dossier, { withFileTypes: true })).filter((e) => e.isDirectory())
  for (const { name } of sous) {
    const C = name === poste ? 'A. presence.json de ce poste' : `B. presence.json de ${name}`
    const lu = await lirePresenceReelle(join(dossier, name, P.FICHIER_PRESENCE))
    if (!lu) {
      console.log(`${name} : aucun presence.json`)
      if (name === poste) controler(C, 'le fichier existe', false, 'absent du partage')
      continue
    }
    const { json } = lu
    if (!json || typeof json !== 'object') {
      console.log(`${name} : presence.json illisible`)
      controler(C, 'JSON lisible', false, lu.illisible ?? 'pas un objet')
      continue
    }
    const agents = Array.isArray(json.agents) ? json.agents : []
    const age = Math.round((a - Date.parse(json.enregistreA)) / 1000)
    console.log(
      `${name} : écrit le ${affichable(json.enregistreA, 40)} (il y a ${age} s), ${agents.length} agent(s)${json.coupe ? ', partage coupé' : ''}, ${lu.taille} octets`
    )
    // Le contenu d'un collègue est une donnée non sûre : affiché borné, sans caractère invisible.
    for (const ag of agents.slice(0, P.PRESENCE_AGENTS_MAX))
      console.log(
        `    ${affichable(ag?.id, 40)} · ${affichable(ag?.phase, 20)} · ${affichable(ag?.metier, 20) || '—'} · ${typeof ag?.titre === 'string' ? affichable(ag.titre, P.PRESENCE_TITRE_MAX) : '(sans titre)'}`
      )
    if (agents.length > P.PRESENCE_AGENTS_MAX)
      console.log(`    … ${agents.length - P.PRESENCE_AGENTS_MAX} agent(s) de plus, non affichés`)
    controler(C, 'le fichier existe', true)
    controler(C, 'format autowin-presence/1', json.format === P.FORMAT_PRESENCE)
    // Daté dans le futur au-delà de la marge : aussi suspect qu'un fichier périmé (même règle que le lecteur).
    controler(
      C,
      'moins de 3 min : le poste publie',
      Number.isFinite(age) && Math.abs(age) * 1000 <= P.PRESENCE_PERIMEE_MS,
      `${age} s`
    )
    controler(C, '15 agents au plus', agents.length <= P.PRESENCE_AGENTS_MAX, `${agents.length}`)
    controler(C, 'moins de 16 Ko', lu.taille < P.PRESENCE_TAILLE_MAX, `${lu.taille}`)
    const titres = agents.map((ag) => ag.titre).filter((t) => typeof t === 'string')
    for (const [nomForme, forme] of FORMES_SENSIBLES)
      controler(
        C,
        `aucun titre avec ${nomForme}`,
        !titres.some((t) => forme.test(t)),
        titres.filter((t) => forme.test(t)).join(' | ')
      )
    controler(
      C,
      'tout titre ≤ 80 caractères',
      titres.every((t) => Array.from(t).length <= P.PRESENCE_TITRE_MAX)
    )
    if (name === poste && coupeIci)
      controler(C, 'interrupteur coupé : aucun agent', json.coupe === true && agents.length === 0)
  }
  if (!sous.some((e) => e.name === poste))
    controler('A. presence.json de ce poste', 'le sous-dossier du poste existe', false, poste)
  // Ce que l'Accueil de ce poste verrait des collègues, par le vrai lecteur (sans écriture).
  const vue = await m.creerLecteurDePresence({ ou: () => ({ dossier, poste }) }).lire()
  console.log(
    `\nVu depuis ce poste : ${vue.collegues.length} collègue(s) présent(s)${vue.collegues.map((c) => ` · ${c.prenom} (${c.agents.length} agents)`).join('')}${vue.erreur ? ` — ${vue.erreur}` : ''}\n`
  )
}

async function principal() {
  const dossierEssai = await mkdtemp(join(tmpdir(), 'village-commun-essai-'))
  try {
    const m = await chargerLeCode(dossierEssai)
    if (PARTAGE_REEL) await lirePartageReel(m)
    else await jouer(m, dossierEssai)
    return rapporter() ? 0 : 1
  } finally {
    if (GARDER) console.log(`Dossier de l'essai gardé : ${dossierEssai}`)
    else await rm(dossierEssai, { recursive: true, force: true })
  }
}

principal().then(
  (code) => process.exit(code),
  (erreur) => {
    console.error("L'essai n'a pas pu tourner :", erreur instanceof Error ? erreur.stack : erreur)
    process.exit(2)
  }
)
