// @vitest-environment node
/*
 * L'AMORCE EN MODE PAGE, JOUEE DANS LE VRAI CHROMIUM (conv-1304, 2026-10-30). Les compatibilites
 * de `amorce.js` (stockage, cookie, formulaire, alerte, copie, liens, numeros de ligne) n'existent
 * que dans un cadre isole reel : happy-dom n'a ni origine opaque ni bac a sable. Ce test passe donc
 * par `scripts/html-interactif-apercu.mjs`, qui monte la page comme le fil (meme page isolee, meme
 * politique, meme protocole compile depuis page-interactive.ts) dans l'Electron du depot, hors
 * ecran, la clique, et rend un rapport. Environ 3 s par banc.
 *
 * Banc d'origine : avant ces compatibilites, `motifs-courants.html` sortait en code 0 alors que six
 * gestes y echouaient sans bruit (SecurityError, « Blocked form submission », « Ignored call to
 * 'alert()' », NotAllowedError) — un faux vert de l'apercu, corrige dans le meme travail.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const BANCS = join(RACINE, 'src/renderer/scene-3d/bancs')
const sortie = mkdtempSync(join(tmpdir(), 'amorce-page-'))

interface Rapport {
  defauts: string[]
  largeurs: Array<{
    erreurs: Array<{ message: string; pendant: string }>
    avertissements: Array<{ message: string; pendant: string }>
    alertes: Array<{ message: string; pendant: string }>
    demandes: Array<{ demande: string; detail: string; accordee: boolean; pendant: string }>
    texteFinal: string
    console: string[]
    scenario?: {
      etapes: number
      reussies: number
      echec?: { numero: number; etape: string; raison: string; texteVu: string; png: string }
    }
  }>
}

function apercu(banc: string, scenario?: unknown[]): { code: number | null; rapport: Rapport } {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const fichierScenario = join(sortie, `scenario-${Date.now()}-${Math.random()}.json`)
  if (scenario) writeFileSync(fichierScenario, JSON.stringify(scenario))
  const resultat = spawnSync(
    process.execPath,
    [
      join(RACINE, 'scripts/html-interactif-apercu.mjs'),
      join(BANCS, banc),
      '--largeurs',
      '560',
      '--attente',
      '800',
      '--out',
      join(sortie, banc),
      ...(scenario ? ['--scenario', fichierScenario] : [])
    ],
    { cwd: RACINE, encoding: 'utf8', env, timeout: 60_000 }
  )
  return { code: resultat.status, rapport: JSON.parse(resultat.stdout) as Rapport }
}

afterAll(() => rmSync(sortie, { recursive: true, force: true }))

describe('amorce en mode page — gestes courants dans le vrai cadre isole', () => {
  it('fait marcher stockage, cookie, formulaire, alerte, copie, ancre et lien apres un clic', () => {
    const { code, rapport } = apercu('motifs-courants.html')
    expect(rapport.defauts).toEqual([])
    expect(code).toBe(0)
    const [r] = rapport.largeurs
    // Ce que la page AFFICHE apres les clics de l'apercu.
    expect(r.texteFinal).toContain('storage : ok 122')
    expect(r.texteFinal).toContain('session : ok')
    expect(r.texteFinal).toContain('cookie : ok [a=1]')
    expect(r.texteFinal).toContain('form : soumis 42')
    expect(r.texteFinal).toContain('alert : rendu undefined')
    expect(r.texteFinal).toContain('copie : ok')
    expect(r.texteFinal).toContain('css var : ok')
    // Moteur 3D a la demande : une page qui ne nomme pas THREE ne l'evalue pas.
    expect(r.texteFinal).toContain('moteur : undefined')
    expect(r.alertes.map((a) => a.message)).toEqual(['salut'])
    // Copie et lien DEMANDES au fil, accordes parce qu'ils suivent un vrai clic.
    const demande = (nom: string): { detail: string; accordee: boolean } | undefined =>
      r.demandes.find((d) => d.demande === nom)
    expect(demande('copier')).toMatchObject({ detail: 'valeur copiee', accordee: true })
    expect(demande('lien')).toMatchObject({ detail: 'https://example.com/doc', accordee: true })
    expect(demande('defiler')?.accordee).toBe(true)
    // Boutons de choix (conv-1304) : le libelle du lien, blancs reduits, puis le message compose
    // par la page — tous deux DEMANDES au fil pour sa saisie, apres un clic.
    expect(r.demandes.filter((d) => d.demande === 'prompt')).toEqual([
      expect.objectContaining({ detail: 'Affiner la 2 · Nuit', accordee: true }),
      expect.objectContaining({ detail: 'Mixer 1 + 3', accordee: true })
    ])
    // Aucun refus silencieux du navigateur.
    expect(r.console.filter((l) => /Blocked|Ignored call|SecurityError/u.test(l))).toEqual([])
  }, 60_000)

  it('dessine les 5 types de autowin.graphique, leur survol, leur mise a jour et leurs refus', () => {
    const { code, rapport } = apercu('graphiques.html', [
      { voir: 'Ventes' },
      { voir: "n'existe pas dans la page", dans: '#etat' },
      { survoler: '#barres svg', x: 0.97, y: 0.5 },
      { voir: 'oct', dans: '#barres .aw-graphique-bulle' },
      { voir: '210 €', dans: '#barres .aw-graphique-bulle' },
      { survoler: '#lignes svg', x: 0.5, y: 0.5 },
      { voir: '2025', dans: '#lignes .aw-graphique-bulle' },
      { survoler: '#secteurs svg', x: 0.6, y: 0.25 },
      { voir: '€', dans: '#secteurs .aw-graphique-bulle' },
      { cliquer: 'texte=Mettre à jour' },
      { voir: 'mis à jour', dans: '#etat' },
      { survoler: '#barres svg', x: 0.97, y: 0.5 },
      { voir: '1 000 €', dans: '#barres .aw-graphique-bulle' }
    ])
    expect(rapport.defauts).toEqual([])
    expect(code).toBe(0)
    const [r] = rapport.largeurs
    expect(r.scenario?.reussies).toBe(r.scenario?.etapes)
    // Le graphique se redessine quand sa colonne change : Chromium ne doit plus lever de boucle
    // de ResizeObserver, que le fil affichait comme un plantage.
    expect(r.erreurs).toEqual([])
  }, 60_000)

  it('evalue le moteur 3D avant les scripts d une page qui nomme THREE', () => {
    const { code, rapport } = apercu('avec-three.html')
    expect(rapport.defauts).toEqual([])
    expect(code).toBe(0)
    expect(rapport.largeurs[0].texteFinal).toContain('three : ok 3.74')
  }, 60_000)

  it('dit OU une page plante, et refuse copie et lien tentes sans clic', () => {
    const { code, rapport } = apercu('erreurs.html')
    expect(code).toBe(3)
    expect(rapport.defauts).toEqual(
      expect.arrayContaining(['erreur-javascript', 'avertissement-page', 'demande-sans-clic'])
    )
    const [r] = rapport.largeurs
    const messages = r.erreurs.map((e) => e.message)
    expect(messages).toContain(
      'onclick de <button> « Clic qui plante » : ReferenceError: inexistante is not defined'
    )
    expect(messages.some((m) => m.endsWith('(ligne 23 du bloc)'))).toBe(true)
    // Erreur au DEMARRAGE d'un script : une seule ligne, message + ligne du bloc, sans pile.
    expect(messages).toContain(
      "TypeError: Cannot set properties of null (setting 'total') (ligne 29 du bloc)"
    )
    expect(r.avertissements.map((a) => a.message).join('\n')).toMatch(/confirm\(\) n’existe pas/u)
    expect(r.demandes.filter((d) => !d.accordee).map((d) => d.demande)).toEqual(
      expect.arrayContaining(['copier', 'lien', 'prompt'])
    )
    // Le formulaire sans preventDefault ne tente aucune navigation.
    expect(r.console.filter((l) => /local resource|form-action|Blocked form/u.test(l))).toEqual([])
  }, 60_000)
})

/*
 * LES SCENARIOS, DANS LE VRAI CADRE (conv-1304). Sans eux, l'apercu ne remplit aucun champ : 4 modeles
 * sur 6 du banc conv-1309 a conv-1314 ont ecrit leur propre harnais. Le texte `200 006 €` passe par
 * toLocaleString('fr-FR') : une espace fine insecable que le scenario n'ecrit pas.
 */
describe('scenarios de l apercu — vraie souris et vrai clavier', () => {
  it('remplit texte, liste, date et curseur, valide, relit le resultat, copie', () => {
    const { code, rapport } = apercu('parcours.html', [
      { remplir: '#montant', valeur: '200000' },
      { choisir: '#type', valeur: 'Bonus' },
      { remplir: '#date', valeur: '2026-12-21' },
      { remplir: '#curseur', valeur: '3' },
      { cliquer: 'texte=Calculer' },
      { voir: '200 006 €', dans: '#resultat' },
      { voir: '2026-12-21', dans: '#date-vue' },
      { pasVoir: 'NaN' },
      { cliquer: '#copier' },
      { demande: 'copier', contient: '200 006' },
      // Entree au clavier dans un champ : le formulaire part, le champ prerempli est bien remplace.
      { remplir: '#montant', valeur: '7' },
      { touche: 'Enter' },
      { voir: '13 €', dans: '#resultat' }
    ])
    expect(rapport.largeurs[0].scenario?.echec).toBeUndefined()
    expect(rapport.defauts).toEqual([])
    expect(code).toBe(0)
    expect(rapport.largeurs[0].scenario).toMatchObject({ etapes: 13, reussies: 13 })
  }, 60_000)

  it('code 8 : nomme l etape, la raison, et ce que la page affichait', () => {
    const { code, rapport } = apercu('parcours.html', [
      { cliquer: 'texte=Calculer' },
      { voir: '999', dans: '#resultat' },
      { cliquer: '#copier' }
    ])
    expect(code).toBe(8)
    expect(rapport.defauts).toContain('scenario-rouge')
    expect(rapport.largeurs[0].scenario).toMatchObject({
      etapes: 3,
      reussies: 1,
      echec: { numero: 2, raison: 'texte absent de #resultat : 999' }
    })
    expect(rapport.largeurs[0].scenario?.echec?.texteVu).toContain('10 €')
  }, 60_000)

  it.each([
    ['cible absente', { cliquer: '#inexistante' }, /cible introuvable/u],
    ['cible sous un calque', { cliquer: '#couvert' }, /recouverte/u],
    ['option absente', { choisir: '#type', valeur: 'Inconnu' }, /option absente/u],
    ['aucune demande faite au fil', { demande: 'prompt' }, /aucune demande/u]
  ])(
    'refuse sans faux vert : %s',
    (_nom, etape, motif) => {
      const { code, rapport } = apercu('parcours.html', [etape])
      expect(code).toBe(8)
      expect(rapport.largeurs[0].scenario?.echec?.raison).toMatch(motif)
    },
    60_000
  )

  it('scenario mal ecrit : code 2, jamais un rouge de la page', () => {
    const { code, rapport } = apercu('parcours.html', [{ clique: '#ok' }])
    expect(code).toBe(2)
    expect(rapport.defauts).toEqual(['usage'])
  }, 60_000)
})
