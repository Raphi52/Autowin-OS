/**
 * Le gestionnaire du terminal intégré (conv-1362, lot 3/3) : le VRAI gestionnaire, une fausse fabrique
 * à la place du module natif. L'essai avec un vrai terminal, dans Electron, vit hors de cette suite :
 * il n'est pas rejouable ici, le paquet n'est pas installé avant le redémarrage.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { arreterLesTravauxDuFil } from './arret-avant-suppression'
import {
  chargerNodePty,
  DELAI_SORTIE_APRES_ARRET_MS,
  environnementDuTerminal,
  fermerTerminauxAvantSortie,
  fermerTerminauxDuFil,
  GestionnaireTerminal,
  poserGestionnaireTerminal,
  type FabriquePty,
  type OptionsPty,
  type PtyLocal
} from './terminal-integre'
import { TAMPON_TERMINAL_MAX, type DonneesTerminal, type EtatTerminal } from '../shared/terminal'

const ESC = String.fromCharCode(27)
const TAILLE = { colonnes: 80, lignes: 24 }
const dossier = mkdtempSync(join(tmpdir(), 'terminal-integre-'))

afterAll(() => {
  rmSync(dossier, { recursive: true, force: true })
})

class FauxPty implements PtyLocal {
  static suivant = 1000
  readonly pid = (FauxPty.suivant += 1)
  readonly ecrit: string[] = []
  readonly tailles: Array<[number, number]> = []
  arrets = 0
  echecArret: Error | null = null
  private readonly surDonnees = new Set<(d: string) => void>()
  private readonly surFin = new Set<(f: { exitCode: number }) => void>()

  constructor(
    readonly fichier: string,
    readonly args: string[],
    readonly options: OptionsPty
  ) {}

  onData(rappel: (d: string) => void): { dispose(): void } {
    this.surDonnees.add(rappel)
    return { dispose: () => this.surDonnees.delete(rappel) }
  }
  onExit(rappel: (f: { exitCode: number }) => void): { dispose(): void } {
    this.surFin.add(rappel)
    return { dispose: () => this.surFin.delete(rappel) }
  }
  write(donnees: string): void {
    this.ecrit.push(donnees)
  }
  resize(colonnes: number, lignes: number): void {
    this.tailles.push([colonnes, lignes])
  }
  kill(): void {
    this.arrets += 1
    if (this.echecArret) throw this.echecArret
  }
  emettre(donnees: string): void {
    for (const rappel of this.surDonnees) rappel(donnees)
  }
  finir(exitCode: number): void {
    for (const rappel of this.surFin) rappel({ exitCode })
  }
}

function monter(options: { chargerFabrique?: () => FabriquePty; dossierDuFil?: string } = {}): {
  g: GestionnaireTerminal
  ptys: FauxPty[]
  donnees: DonneesTerminal[]
  etats: EtatTerminal[]
} {
  const ptys: FauxPty[] = []
  const fabrique: FabriquePty = (fichier, args, opts) => {
    const pty = new FauxPty(fichier, args, opts)
    ptys.push(pty)
    return pty
  }
  const g = new GestionnaireTerminal({
    chargerFabrique: options.chargerFabrique ?? (() => fabrique),
    dossierDuFil: () => options.dossierDuFil ?? dossier,
    environnement: () => ({ PATH: 'C:\\outils', MARQUE: 'oui' })
  })
  const donnees: DonneesTerminal[] = []
  const etats: EtatTerminal[] = []
  g.surDonnees((d) => donnees.push(d))
  g.surEtat((e) => etats.push(e))
  return { g, ptys, donnees, etats }
}

function ouvrir(g: GestionnaireTerminal, fil = 'conv-a'): string {
  const r = g.ouvrir(fil, TAILLE)
  if (!r.ok) throw new Error(r.raison)
  return r.terminal.id
}

describe('ouverture', () => {
  it('lance PowerShell dans le dossier du fil, à la taille et avec l’environnement demandés', () => {
    const { g, ptys } = monter()
    const r = g.ouvrir('conv-a', { colonnes: 120, lignes: 40 })
    expect(r).toMatchObject({
      ok: true,
      terminal: {
        conversationId: 'conv-a',
        numero: 1,
        dossier,
        colonnes: 120,
        lignes: 40,
        enCours: true
      }
    })
    expect(ptys).toHaveLength(1)
    expect(ptys[0].fichier).toBe('powershell.exe')
    expect(ptys[0].args).toEqual(['-NoLogo'])
    expect(ptys[0].options).toMatchObject({ cols: 120, rows: 40, cwd: dossier })
    expect(ptys[0].options.env).toMatchObject({ PATH: 'C:\\outils', MARQUE: 'oui' })
  })

  it('ouvre plusieurs terminaux par fil, numérotés dans leur fil', () => {
    const { g } = monter()
    ouvrir(g, 'conv-a')
    ouvrir(g, 'conv-a')
    ouvrir(g, 'conv-b')
    expect(g.etat('conv-a').terminaux.map((t) => t.numero)).toEqual([1, 2])
    expect(g.etat('conv-b').terminaux.map((t) => t.numero)).toEqual([1])
  })

  it('ne réutilise pas un numéro tant que le fil vit', () => {
    const { g } = monter()
    const premier = ouvrir(g)
    g.fermer(premier)
    ouvrir(g)
    expect(g.etat('conv-a').terminaux.map((t) => t.numero)).toEqual([2])
  })

  it('un dossier disparu est refusé en clair : le système, lui, sort sans rien dire (code 267)', () => {
    const { g, ptys } = monter({ dossierDuFil: join(dossier, 'absent') })
    const r = g.ouvrir('conv-a', TAILLE)
    expect(r).toEqual({
      ok: false,
      raison: `Dossier de travail introuvable : ${join(dossier, 'absent')}`
    })
    expect(ptys).toHaveLength(0)
  })

  it('un lancement qui échoue rend sa raison et ne laisse aucun terminal', () => {
    const { g } = monter({
      chargerFabrique: () => () => {
        throw new Error('File not found: powershell.exe')
      }
    })
    expect(g.ouvrir('conv-a', TAILLE)).toEqual({
      ok: false,
      raison: 'Ouverture du terminal impossible : File not found: powershell.exe'
    })
    expect(g.etat('conv-a').terminaux).toEqual([])
  })

  it('pousse l’état du fil à chaque ouverture', () => {
    const { g, etats } = monter()
    ouvrir(g)
    expect(etats.at(-1)).toMatchObject({ conversationId: 'conv-a', terminaux: [{ numero: 1 }] })
  })
})

describe('module natif indisponible', () => {
  it('rend la raison exacte, sans exception, et l’état la garde', () => {
    const { g, etats } = monter({
      chargerFabrique: () => {
        throw new Error("Cannot find module '@lydell/node-pty'")
      }
    })
    const attendu = "Terminal indisponible : Cannot find module '@lydell/node-pty'"
    expect(g.ouvrir('conv-a', TAILLE)).toEqual({ ok: false, raison: attendu })
    expect(g.etat('conv-a').indisponible).toBe(attendu)
    expect(etats.at(-1)?.indisponible).toBe(attendu)
  })

  it('ne charge rien avant la première ouverture', () => {
    const chargerFabrique = vi.fn<() => FabriquePty>()
    const { g } = monter({ chargerFabrique })
    expect(g.etat('conv-a')).toEqual({ conversationId: 'conv-a', terminaux: [] })
    expect(chargerFabrique).not.toHaveBeenCalled()
  })

  it('un échec n’est pas définitif : le paquet posé après coup se charge à l’ouverture suivante', () => {
    let present = false
    const fabrique: FabriquePty = (f, a, o) => new FauxPty(f, a, o)
    const { g } = monter({
      chargerFabrique: () => {
        if (!present) throw new Error('absent')
        return fabrique
      }
    })
    expect(g.ouvrir('conv-a', TAILLE).ok).toBe(false)
    present = true
    expect(g.ouvrir('conv-a', TAILLE).ok).toBe(true)
    expect(g.etat('conv-a').indisponible).toBeUndefined()
  })

  it('charge le module une seule fois', () => {
    const fabrique: FabriquePty = (f, a, o) => new FauxPty(f, a, o)
    const chargerFabrique = vi.fn(() => fabrique)
    const { g } = monter({ chargerFabrique })
    ouvrir(g)
    ouvrir(g)
    expect(chargerFabrique).toHaveBeenCalledTimes(1)
  })
})

describe('chargement de @lydell/node-pty', () => {
  it('passe par `require` à l’exécution et rend une fabrique', () => {
    const spawn = vi.fn(() => new FauxPty('', [], {} as OptionsPty))
    const requerir = vi.fn(() => ({ spawn }))
    const fabrique = chargerNodePty(requerir)
    expect(requerir).toHaveBeenCalledWith('@lydell/node-pty')
    const options = { name: 'xterm-256color', cols: 80, rows: 24, cwd: dossier, env: {} }
    fabrique('powershell.exe', ['-NoLogo'], options)
    expect(spawn).toHaveBeenCalledWith('powershell.exe', ['-NoLogo'], options)
  })

  it('laisse passer l’erreur de chargement, que le gestionnaire transforme en état', () => {
    const requerir = (): never => {
      throw new Error('NODE_MODULE_VERSION mismatch')
    }
    expect(() => chargerNodePty(requerir)).toThrow('NODE_MODULE_VERSION mismatch')
  })

  it('refuse un module sans `spawn` : mieux vaut le dire qu’échouer à la première frappe', () => {
    expect(() => chargerNodePty(() => ({}))).toThrow('spawn')
  })

  it('aucun import statique : un module natif cassé n’empêche jamais l’app de démarrer', () => {
    const fichiers = ['terminal-integre.ts', 'ipc/terminal.ts', 'arret-avant-suppression.ts']
    for (const fichier of fichiers) {
      const source = readFileSync(join(__dirname, fichier), 'utf8')
      expect(source).not.toMatch(/^\s*import\b[^\n]*node-pty/m)
      expect(source).not.toMatch(/^\s*(?:export|import)\s*\*?[^\n]*from\s+['"]@xterm/m)
    }
  })
})

describe('environnement du shell', () => {
  it('garde le PATH et les variables, retire les nôtres', () => {
    const env = environnementDuTerminal({
      PATH: 'C:\\outils',
      Path: 'C:\\outils2',
      CLAUDE_CONFIG_DIR: 'C:\\compte',
      GH_TOKEN_DU_POSTE: 'garde',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
      AUTOWIN_APP_DATA_ROOT: 'D:\\donnees',
      NODE_ENV_ELECTRON_VITE: 'development',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'session',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-cli'
    })
    expect(env).toEqual({
      PATH: 'C:\\outils',
      Path: 'C:\\outils2',
      CLAUDE_CONFIG_DIR: 'C:\\compte',
      GH_TOKEN_DU_POSTE: 'garde'
    })
  })

  it('ne reprend pas les réglages « sans invite » des agents : ce terminal est à l’utilisateur', () => {
    const env = environnementDuTerminal({ PATH: 'x' })
    expect(env.GIT_TERMINAL_PROMPT).toBeUndefined()
    expect(env.GCM_INTERACTIVE).toBeUndefined()
    expect(env.GIT_PAGER).toBeUndefined()
  })
})

describe('sortie et tampon', () => {
  it('relaie chaque morceau, numéroté, avec son terminal et son fil', () => {
    const { g, ptys, donnees } = monter()
    const id = ouvrir(g)
    ptys[0].emettre('un')
    ptys[0].emettre('deux')
    expect(donnees).toEqual([
      { terminalId: id, conversationId: 'conv-a', donnees: 'un', sequence: 1 },
      { terminalId: id, conversationId: 'conv-a', donnees: 'deux', sequence: 2 }
    ])
  })

  it('repasse le tampon brut et le numéro du dernier morceau, sans abonné comme avec', () => {
    const { g, ptys } = monter()
    const id = ouvrir(g)
    ptys[0].emettre(`${ESC}[31mrouge`)
    ptys[0].emettre(' fin')
    expect(g.tampon(id)).toEqual({
      terminalId: id,
      donnees: `${ESC}[31mrouge fin`,
      sequence: 2
    })
  })

  it('un terminal survit au changement de fil : aucun arrêt, tampon intact', () => {
    const { g, ptys } = monter()
    const id = ouvrir(g, 'conv-a')
    ptys[0].emettre('gardé')
    ouvrir(g, 'conv-b')
    expect(ptys[0].arrets).toBe(0)
    expect(g.tampon(id)?.donnees).toBe('gardé')
  })

  it('borne le tampon à 200 Ko en gardant la fin', () => {
    const { g, ptys } = monter()
    const id = ouvrir(g)
    const ligne = 'x'.repeat(1023) + '\n'
    for (let i = 0; i < 250; i += 1) ptys[0].emettre(ligne)
    ptys[0].emettre('la fin')
    const { donnees, sequence } = g.tampon(id)!
    expect(TAMPON_TERMINAL_MAX).toBe(204_800)
    expect(donnees.length).toBeLessThanOrEqual(TAMPON_TERMINAL_MAX)
    expect(donnees.endsWith('la fin')).toBe(true)
    expect(sequence).toBe(251)
  })

  it('coupe au début d’une ligne : le rejeu ne commence jamais au milieu d’une séquence', () => {
    const { g, ptys } = monter()
    const id = ouvrir(g)
    const ligne = `${ESC}[38;5;9m${'y'.repeat(989)}${ESC}[m\r\n`
    for (let i = 0; i < 300; i += 1) ptys[0].emettre(ligne)
    const { donnees } = g.tampon(id)!
    expect(donnees.startsWith(`${ESC}[38;5;9m`)).toBe(true)
  })

  it('un morceau sans saut de ligne plus grand que le tampon reste borné et ne coupe pas un caractère', () => {
    const { g, ptys } = monter()
    const id = ouvrir(g)
    ptys[0].emettre('😀'.repeat(TAMPON_TERMINAL_MAX))
    const { donnees } = g.tampon(id)!
    expect(donnees.length).toBeLessThanOrEqual(TAMPON_TERMINAL_MAX)
    expect(donnees.isWellFormed()).toBe(true)
  })

  it('un terminal inconnu n’a pas de tampon', () => {
    expect(monter().g.tampon('inconnu')).toBeNull()
  })
})

describe('écriture et redimensionnement', () => {
  it('transmet ce que l’utilisateur tape, tel quel', () => {
    const { g, ptys } = monter()
    const id = ouvrir(g)
    g.ecrire(id, 'dir\r')
    expect(ptys[0].ecrit).toEqual(['dir\r'])
  })

  it('redimensionne le terminal et met l’état à jour', () => {
    const { g, ptys, etats } = monter()
    const id = ouvrir(g)
    g.redimensionner(id, { colonnes: 100, lignes: 30 })
    expect(ptys[0].tailles).toEqual([[100, 30]])
    expect(g.etat('conv-a').terminaux[0]).toMatchObject({ colonnes: 100, lignes: 30 })
    expect(etats.at(-1)?.terminaux[0]).toMatchObject({ colonnes: 100, lignes: 30 })
  })

  it('ne redimensionne pas pour rien : le panneau rappelle la même taille à chaque rendu', () => {
    const { g, ptys } = monter()
    const id = ouvrir(g)
    g.redimensionner(id, TAILLE)
    expect(ptys[0].tailles).toEqual([])
  })

  it('n’atteint plus un shell fini, ni un terminal inconnu', () => {
    const { g, ptys } = monter()
    const id = ouvrir(g)
    ptys[0].finir(0)
    g.ecrire(id, 'trop tard')
    g.redimensionner(id, { colonnes: 100, lignes: 30 })
    g.ecrire('inconnu', 'x')
    g.redimensionner('inconnu', TAILLE)
    expect(ptys[0].ecrit).toEqual([])
    expect(ptys[0].tailles).toEqual([])
  })
})

describe('fin du shell', () => {
  it('garde le terminal lisible, avec son code de sortie', () => {
    const { g, ptys, etats } = monter()
    const id = ouvrir(g)
    ptys[0].emettre('au revoir')
    ptys[0].finir(3)
    expect(etats.at(-1)?.terminaux[0]).toMatchObject({ enCours: false, codeSortie: 3 })
    expect(g.tampon(id)?.donnees).toBe('au revoir')
    expect(g.lire('conv-a', { lignes: 10 })?.enCours).toBe(false)
  })

  it('n’appelle jamais `kill` sur un shell fini : sans effet, il lancerait un processus pour rien', () => {
    const { g, ptys } = monter()
    const id = ouvrir(g)
    ptys[0].finir(0)
    expect(ptys[0].arrets).toBe(0)
    g.fermer(id)
    expect(ptys[0].arrets).toBe(0)
    expect(g.etat('conv-a').terminaux).toEqual([])
  })
})

describe('fermeture', () => {
  it('arrête CE terminal par son processus et l’oublie', () => {
    const { g, ptys, etats } = monter()
    const id = ouvrir(g)
    const autre = ouvrir(g)
    g.fermer(id)
    expect(ptys[0].arrets).toBe(1)
    expect(ptys[1].arrets).toBe(0)
    expect(g.tampon(id)).toBeNull()
    expect(g.tampon(autre)).not.toBeNull()
    expect(etats.at(-1)?.terminaux.map((t) => t.id)).toEqual([autre])
  })

  it('ignore ce qui arrive après la fermeture', () => {
    const { g, ptys, donnees } = monter()
    const id = ouvrir(g)
    g.fermer(id)
    ptys[0].emettre('tardif')
    ptys[0].finir(0)
    expect(donnees).toEqual([])
    expect(g.fermer(id)).toBeUndefined()
    expect(ptys[0].arrets).toBe(1)
  })

  it('le fil fermé n’emporte que ses terminaux, et ses numéros repartent de 1', () => {
    const { g, ptys } = monter()
    ouvrir(g, 'conv-a')
    ouvrir(g, 'conv-b')
    ouvrir(g, 'conv-a')
    g.fermerFil('conv-a')
    expect(ptys.map((p) => p.arrets)).toEqual([1, 0, 1])
    expect(g.etat('conv-a').terminaux).toEqual([])
    expect(g.etat('conv-b').terminaux).toHaveLength(1)
    ouvrir(g, 'conv-a')
    expect(g.etat('conv-a').terminaux[0].numero).toBe(1)
  })

  it('la fermeture de l’app arrête tout, un par un, même si l’un d’eux résiste', () => {
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { g, ptys } = monter()
    ouvrir(g, 'conv-a')
    ouvrir(g, 'conv-b')
    ouvrir(g, 'conv-c')
    ptys[1].echecArret = new Error('accès refusé')
    g.fermerTout()
    expect(ptys.map((p) => p.arrets)).toEqual([1, 1, 1])
    expect(g.etat('conv-a').terminaux).toEqual([])
    expect(avertir).toHaveBeenCalledOnce()
    expect(avertir.mock.calls[0].join(' ')).toContain('accès refusé')
    avertir.mockRestore()
  })

  it('la fermeture de l’app est sans danger si elle repasse', () => {
    const { g, ptys } = monter()
    ouvrir(g)
    expect(g.fermerTout()).toBe(1)
    expect(g.fermerTout()).toBe(0)
    expect(ptys[0].arrets).toBe(1)
  })

  it('ne compte pas un shell déjà fini parmi ceux qu’elle arrête', () => {
    const { g, ptys } = monter()
    ouvrir(g)
    ptys[0].finir(0)
    expect(g.fermerTout()).toBe(0)
  })
})

describe('sortie d’Electron', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    poserGestionnaireTerminal(null)
  })
  afterEach(() => {
    vi.useRealTimers()
    poserGestionnaireTerminal(null)
  })

  it('arrête tout puis ne sort qu’au tour suivant : sortir dans le même tour fige Electron', () => {
    const { g, ptys } = monter()
    poserGestionnaireTerminal(g)
    ouvrir(g, 'conv-a')
    ouvrir(g, 'conv-b')
    const quitter = vi.fn()
    expect(fermerTerminauxAvantSortie(quitter)).toBe(true)
    expect(ptys.map((p) => p.arrets)).toEqual([1, 1])
    expect(quitter).not.toHaveBeenCalled()
    vi.advanceTimersByTime(DELAI_SORTIE_APRES_ARRET_MS)
    expect(quitter).toHaveBeenCalledOnce()
  })

  it('le second passage ne retient plus rien : `before-quit` peut aller au bout', () => {
    const { g } = monter()
    poserGestionnaireTerminal(g)
    ouvrir(g)
    const quitter = vi.fn()
    fermerTerminauxAvantSortie(quitter)
    expect(fermerTerminauxAvantSortie(quitter)).toBe(false)
    vi.advanceTimersByTime(DELAI_SORTIE_APRES_ARRET_MS)
    expect(quitter).toHaveBeenCalledOnce()
  })

  it('sans terminal en cours, la sortie n’est pas retenue', () => {
    const { g, ptys } = monter()
    poserGestionnaireTerminal(g)
    ouvrir(g)
    ptys[0].finir(0)
    const quitter = vi.fn()
    expect(fermerTerminauxAvantSortie(quitter)).toBe(false)
    vi.runAllTimers()
    expect(quitter).not.toHaveBeenCalled()
  })

  it('sans gestionnaire, la sortie n’est pas retenue', () => {
    expect(fermerTerminauxAvantSortie(() => undefined)).toBe(false)
  })
})

describe('suppression d’un fil', () => {
  const travaux = { couperLeRun: () => true }

  beforeEach(() => poserGestionnaireTerminal(null))

  it('les quatre chemins de suppression arrêtent ses terminaux', async () => {
    const { g, ptys } = monter()
    poserGestionnaireTerminal(g)
    ouvrir(g, 'conv-a')
    ouvrir(g, 'conv-b')
    await arreterLesTravauxDuFil('conv-a', travaux)
    expect(ptys.map((p) => p.arrets)).toEqual([1, 0])
  })

  it('y compris quand l’agent supprime le fil dans lequel il travaille', async () => {
    const { g, ptys } = monter()
    poserGestionnaireTerminal(g)
    ouvrir(g, 'conv-a')
    await arreterLesTravauxDuFil('conv-a', travaux, true)
    expect(ptys[0].arrets).toBe(1)
  })

  it('sans gestionnaire, rien ne casse et le module natif n’est pas chargé', () => {
    expect(() => fermerTerminauxDuFil('conv-a')).not.toThrow()
  })
})

describe('lecture par l’agent', () => {
  it('rend le texte nettoyé, les N dernières lignes, et le compte total', () => {
    const { g, ptys } = monter()
    ouvrir(g)
    ptys[0].emettre(`${ESC}[31mun${ESC}[0m\r\ndeux\r\ntrois\r\nquatre`)
    expect(g.lire('conv-a', { lignes: 2 })).toEqual({
      numero: 1,
      dossier,
      enCours: true,
      texte: 'trois\nquatre',
      lignesRendues: 2,
      lignesTotales: 4,
      autresTerminaux: []
    })
  })

  it('tient compte de la largeur du terminal au moment de la lecture', () => {
    const { g, ptys } = monter()
    const id = ouvrir(g)
    g.redimensionner(id, { colonnes: 10, lignes: 24 })
    ptys[0].emettre('a'.repeat(25))
    ptys[0].emettre('\r\nb')
    expect(g.lire('conv-a', { lignes: 5 })?.texte).toBe(`${'a'.repeat(25)}\nb`)
  })

  it('un fil ne lit jamais le terminal d’un autre, ni par défaut ni par numéro', () => {
    const { g, ptys } = monter()
    ouvrir(g, 'conv-b')
    ptys[0].emettre('secret de conv-b')
    expect(g.lire('conv-a', { lignes: 10 })).toBeNull()
    expect(g.lire('conv-a', { numero: 1, lignes: 10 })).toBeNull()
    ouvrir(g, 'conv-a')
    ptys[1].emettre('à moi')
    expect(g.lire('conv-a', { numero: 1, lignes: 10 })?.texte).toBe('à moi')
    expect(g.lire('conv-a', { lignes: 10 })?.texte).toBe('à moi')
    expect(g.lire('conv-a', { numero: 2, lignes: 10 })).toBeNull()
  })

  it('sans numéro, lit le terminal dont l’utilisateur s’est servi en dernier', () => {
    const { g, ptys } = monter()
    const premier = ouvrir(g)
    ouvrir(g)
    ptys[0].emettre('premier')
    ptys[1].emettre('second')
    expect(g.lire('conv-a', { lignes: 5 })?.numero).toBe(2)
    g.ecrire(premier, 'x')
    expect(g.lire('conv-a', { lignes: 5 })).toMatchObject({
      numero: 1,
      texte: 'premier',
      autresTerminaux: [2]
    })
  })

  it('masque ce qui ressemble à un secret : le texte part chez le modèle', () => {
    const { g, ptys } = monter()
    ouvrir(g)
    ptys[0].emettre('git clone https://moi:jeton123@exemple.fr/depot.git\r\ntoken=abc123')
    const texte = g.lire('conv-a', { lignes: 10 })?.texte
    expect(texte).toContain('https://moi:***@exemple.fr')
    expect(texte).toContain('token=***')
    expect(texte).not.toContain('jeton123')
    expect(texte).not.toContain('abc123')
  })

  it('un terminal vide rend un texte vide', () => {
    const { g } = monter()
    ouvrir(g)
    expect(g.lire('conv-a', { lignes: 5 })).toMatchObject({
      texte: '',
      lignesRendues: 0,
      lignesTotales: 0
    })
  })
})
