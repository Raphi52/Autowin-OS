import { describe, expect, it } from 'vitest'
import type { ContenuNotification, NotificationAffichable } from './notification-fin-de-tour'
import {
  actionDuFragment,
  couleursDeCarte,
  creerPileDePopups,
  disposerPopups,
  hauteurDePopup,
  htmlDePopup,
  LARGEUR_POPUP,
  PALETTE_HOLOGRAPHIQUE,
  paletteDeCarte,
  type ActionPopup,
  type PaletteCarte,
  type Rect
} from './notification-popup'

/**
 * POPUP « VERRE NACRÉ » (conv-1066, 2026-10-22) : la fin d'un tour s'affiche dans une carte au
 * thème d'Autowin en bas à droite, au lieu de la bulle Windows (non stylable). Direction 3 de la
 * maquette /draft du fil conv-1066 : cadre irisé, pastille « A », faits dans un encart, première
 * suite en bouton dégradé.
 */

const PRETE: ContenuNotification = {
  title: 'Corriger le test ChatComposer — réponse prête',
  body: 'Test ChatComposer.test.tsx repassé au vert (exit 0)\nTypage npm run typecheck : 0 erreur',
  suites: ['Lance la suite complète du chat', 'Ajoute un test pour le brouillon vide'],
  fil: 'Corriger le test ChatComposer',
  issue: 'prete'
}

const ECHEC: ContenuNotification = {
  title: 'Migration du journal — le tour a échoué',
  body: 'Le modèle est surchargé (529)',
  fil: 'Migration du journal',
  issue: 'echec'
}

describe('htmlDePopup — ce que la carte affiche', () => {
  it('reprend la maquette : titre du fil, état + heure, les deux faits, les deux suites', () => {
    const html = htmlDePopup(PRETE, '14:32')
    expect(html).toContain('Corriger le test ChatComposer</span>')
    expect(html).toContain('Réponse prête · 14:32')
    expect(html).toContain('Test ChatComposer.test.tsx repassé au vert (exit 0)')
    expect(html).toContain('Typage npm run typecheck : 0 erreur')
    expect(html).toContain('href="#suite-0"')
    expect(html).toContain('href="#suite-1"')
    expect(html).toContain('Lance la suite complète du chat')
    // Les couleurs du thème Nébuleuse de verre (--violet, --rose) : c'est « le thème actuel ».
    expect(html).toContain('#3c6eeb')
    expect(html).toContain('#e63ca0')
  })

  it('un clic sur la carte ouvre le fil, la croix ferme', () => {
    const html = htmlDePopup(PRETE, '14:32')
    expect(html).toContain('href="#ouvrir"')
    expect(html).toContain('href="#fermer"')
  })

  // Entrée qui ferait échouer ce test si l'échappement manquait : un titre de fil qui porte du HTML.
  // Le titre vient de l'utilisateur ou du modèle ; sans échappement, il s'exécuterait dans la carte.
  it('ÉCHAPPE le texte : un titre de fil en HTML reste du texte', () => {
    const html = htmlDePopup({ ...PRETE, fil: '<img src=x onerror=alert(1)>' }, '14:32')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  // Entrée piégée : un guillemet dans une suite casserait l'attribut `title` du bouton.
  it('ÉCHAPPE les attributs : un guillemet dans une suite ne sort pas de son attribut', () => {
    const html = htmlDePopup({ ...PRETE, suites: ['Dis "oui" onmouseover=x'] }, '14:32')
    expect(html).toContain('title="Dis &quot;oui&quot; onmouseover=x"')
    expect(html).not.toContain('"oui"')
  })

  it('aucun script possible : la page interdit tout script par sa politique de contenu', () => {
    const html = htmlDePopup(PRETE, '14:32')
    expect(html).toMatch(
      /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">/u
    )
    expect(html).not.toMatch(/<script/iu)
  })

  it('le libellé d’un bouton est coupé comme sur la bulle, la suite entière reste en infobulle', () => {
    const longue = 'Relance la suite complète du chat puis vérifie la capture du composer en sombre'
    const html = htmlDePopup({ ...PRETE, suites: [longue] }, '14:32')
    expect(html).toContain('Relance la suite complète du chat puis…')
    expect(html).toContain(`title="${longue}"`)
  })

  it('ÉCHEC : dit « Le tour a échoué », sans bouton de suite', () => {
    const html = htmlDePopup(ECHEC, '09:05')
    expect(html).toContain('Le tour a échoué · 09:05')
    expect(html).toContain('class="carte echec"')
    expect(html).not.toContain('#suite-')
  })

  // Jumeau accepté : même contenu réussi, mais sans suite — la carte ne garde pas de rangée vide.
  it('réponse sans suite : pas de rangée de boutons', () => {
    const html = htmlDePopup({ ...PRETE, suites: undefined }, '14:32')
    expect(html).not.toContain('class="suites"')
  })
})

describe('hauteurDePopup — la fenêtre fait exactement la taille de la carte', () => {
  // Une fenêtre plus haute que la carte avalerait les clics d'une bande transparente du bureau ;
  // plus basse, elle couperait les boutons. Chaque bloc a donc une hauteur fixe en pixels.
  it('deux faits + deux suites = 159 px (maquette)', () => {
    expect(hauteurDePopup(PRETE)).toBe(159)
  })

  it('un seul fait, sans suite = 101 px', () => {
    expect(hauteurDePopup(ECHEC)).toBe(101)
  })

  it('un corps de plus de deux lignes reste à deux lignes (la carte n’en affiche pas plus)', () => {
    expect(hauteurDePopup({ ...PRETE, body: 'a\nb\nc\nd' })).toBe(159)
  })
})

describe('actionDuFragment — ce que le clic a demandé', () => {
  it('lit le fragment de l’adresse de la page', () => {
    expect(actionDuFragment('data:text/html;charset=utf-8,x#ouvrir')).toEqual({ type: 'ouvrir' })
    expect(actionDuFragment('data:text/html;charset=utf-8,x#fermer')).toEqual({ type: 'fermer' })
    expect(actionDuFragment('data:text/html;charset=utf-8,x#suite-1')).toEqual({
      type: 'suite',
      index: 1
    })
  })

  it('un fragment inconnu ou absent ne déclenche rien', () => {
    expect(actionDuFragment('data:text/html;charset=utf-8,x')).toBeNull()
    expect(actionDuFragment('data:text/html;charset=utf-8,x#suite-x')).toBeNull()
    expect(actionDuFragment('data:text/html;charset=utf-8,x#autre')).toBeNull()
  })
})

describe('disposerPopups — en bas à droite de la zone de travail, la plus récente en bas', () => {
  const ZONE: Rect = { x: 0, y: 0, width: 1920, height: 1032 }

  it('une popup : collée au coin bas-droit, à 12 px des bords', () => {
    expect(disposerPopups(ZONE, [159])).toEqual([
      { x: 1920 - 12 - LARGEUR_POPUP, y: 1032 - 12 - 159, width: LARGEUR_POPUP, height: 159 }
    ])
  })

  it('deux popups : la plus récente (rang 0) en bas, l’autre au-dessus, 8 px entre elles', () => {
    const [recente, ancienne] = disposerPopups(ZONE, [101, 159])
    expect(recente.y).toBe(1032 - 12 - 101)
    expect(ancienne.y).toBe(recente.y - 8 - 159)
  })

  // Entrée qui ferait échouer ce test si la zone n'était pas lue en entier : un écran principal
  // décalé (barre des tâches en haut, ou écran à droite d'un autre).
  it('respecte l’origine de la zone (écran décalé, barre des tâches en haut)', () => {
    const [r] = disposerPopups({ x: 1920, y: 48, width: 1280, height: 976 }, [159])
    expect(r).toEqual({
      x: 1920 + 1280 - 12 - LARGEUR_POPUP,
      y: 48 + 976 - 12 - 159,
      width: LARGEUR_POPUP,
      height: 159
    })
  })
})

/** Fausse bulle Windows : le secours d'une carte dont la page ne se charge pas. */
type BulleDeTest = {
  contenu: ContenuNotification
  montree: boolean
  fermee: boolean
  cliquer: () => void
  presser: (rang: number) => void
}

function bulleDeTest(bulles: BulleDeTest[]) {
  return (contenu: ContenuNotification): NotificationAffichable => {
    const clics: Array<() => void> = []
    const actions: Array<(d: { actionIndex?: number }) => void> = []
    const b: BulleDeTest = {
      contenu,
      montree: false,
      fermee: false,
      cliquer: () => clics.forEach((e) => e()),
      presser: (rang) => actions.forEach((e) => e({ actionIndex: rang }))
    }
    bulles.push(b)
    return {
      show: () => {
        b.montree = true
      },
      close: () => {
        b.fermee = true
      },
      on: ((evenement: 'click' | 'action', e: (d: { actionIndex?: number }) => void) => {
        if (evenement === 'click') clics.push(e as () => void)
        else actions.push(e)
      }) as NotificationAffichable['on']
    }
  }
}

/** Fausse fenêtre : garde ses placements et laisse le test cliquer à la place de l'utilisateur. */
function pileDeTest(
  zone: Rect = { x: 0, y: 0, width: 1920, height: 1032 },
  bulles: BulleDeTest[] = []
) {
  const fenetres: Array<{
    html: string
    rects: Rect[]
    affichee: boolean
    fermee: boolean
    cliquer: (a: ActionPopup) => void
    fermerDeLExterieur: () => void
    /** La page de la carte n'a pas pu se charger (`loadFile` rejeté). */
    echouer: (erreur: unknown) => void
  }> = []
  const pile = creerPileDePopups({
    zone: () => zone,
    heure: () => '14:32',
    secours: bulleDeTest(bulles),
    ouvrirFenetre: ({ html, rect, surAction, surFermee, surEchec }) => {
      const f = {
        html,
        rects: [rect],
        affichee: false,
        fermee: false,
        cliquer: surAction,
        fermerDeLExterieur: surFermee,
        echouer: surEchec
      }
      fenetres.push(f)
      return {
        placer: (r) => f.rects.push(r),
        afficher: () => {
          f.affichee = true
        },
        fermer: () => {
          f.fermee = true
          surFermee()
        }
      }
    }
  })
  return { pile, fenetres }
}

describe('creerPileDePopups — le contrat d’une notification, tenu par une carte', () => {
  it('show() ouvre et affiche la carte à sa place', () => {
    const { pile, fenetres } = pileDeTest()
    pile.fabriquer(PRETE).show()
    expect(fenetres).toHaveLength(1)
    expect(fenetres[0].affichee).toBe(true)
    expect(fenetres[0].rects[0]).toEqual(
      disposerPopups({ x: 0, y: 0, width: 1920, height: 1032 }, [159])[0]
    )
  })

  it('clic sur la carte = « click » (ouvre le fil), puis la carte se ferme', () => {
    const { pile, fenetres } = pileDeTest()
    const n = pile.fabriquer(PRETE)
    const clics: string[] = []
    n.on('click', () => clics.push('ouvrir'))
    n.show()
    fenetres[0].cliquer({ type: 'ouvrir' })
    expect(clics).toEqual(['ouvrir'])
    expect(fenetres[0].fermee).toBe(true)
  })

  it('bouton de suite = « action » avec son rang, puis la carte se ferme', () => {
    const { pile, fenetres } = pileDeTest()
    const n = pile.fabriquer(PRETE)
    const rangs: Array<number | undefined> = []
    n.on('action', (d) => rangs.push(d.actionIndex))
    n.show()
    fenetres[0].cliquer({ type: 'suite', index: 1 })
    expect(rangs).toEqual([1])
    expect(fenetres[0].fermee).toBe(true)
  })

  // Jumeau refusé du clic : la croix ferme SANS ouvrir le fil ni envoyer de suite.
  it('la croix ferme sans rien déclencher', () => {
    const { pile, fenetres } = pileDeTest()
    const n = pile.fabriquer(PRETE)
    const evenements: string[] = []
    n.on('click', () => evenements.push('click'))
    n.on('action', () => evenements.push('action'))
    n.show()
    fenetres[0].cliquer({ type: 'fermer' })
    expect(evenements).toEqual([])
    expect(fenetres[0].fermee).toBe(true)
  })

  it('close() après une fermeture par la croix ne casse rien (le notifieur remplace par fil)', () => {
    const { pile, fenetres } = pileDeTest()
    const n = pile.fabriquer(PRETE)
    n.show()
    fenetres[0].cliquer({ type: 'fermer' })
    expect(() => n.close()).not.toThrow()
  })

  it('une carte qui part : les autres redescendent à leur place', () => {
    const { pile, fenetres } = pileDeTest()
    const a = pile.fabriquer(PRETE)
    a.show()
    pile.fabriquer(ECHEC).show()
    // a est montée au-dessus de la nouvelle ; la nouvelle ferme → a redescend dans le coin.
    const zone = { x: 0, y: 0, width: 1920, height: 1032 }
    expect(fenetres[0].rects.at(-1)).toEqual(disposerPopups(zone, [101, 159])[1])
    fenetres[1].cliquer({ type: 'fermer' })
    expect(fenetres[0].rects.at(-1)).toEqual(disposerPopups(zone, [159])[0])
  })

  it('au-delà de 4 cartes, la plus ancienne se ferme', () => {
    const { pile, fenetres } = pileDeTest()
    for (let i = 0; i < 5; i += 1) pile.fabriquer(PRETE).show()
    expect(fenetres.map((f) => f.fermee)).toEqual([true, false, false, false, false])
  })

  it('une zone trop basse pour la pile ferme les plus anciennes au lieu de sortir de l’écran', () => {
    const { pile, fenetres } = pileDeTest({ x: 0, y: 0, width: 1280, height: 400 })
    for (let i = 0; i < 3; i += 1) pile.fabriquer(PRETE).show()
    // 12 + 159 + 8 + 159 = 338 tient dans 400 ; une troisième carte n'y tient plus.
    expect(fenetres.map((f) => f.fermee)).toEqual([true, false, false])
  })

  it('toutFermer() ferme toutes les cartes (Autowin est de nouveau regardé)', () => {
    const { pile, fenetres } = pileDeTest()
    pile.fabriquer(PRETE).show()
    pile.fabriquer(ECHEC).show()
    pile.toutFermer()
    expect(fenetres.map((f) => f.fermee)).toEqual([true, true])
  })
})

describe('la vraie fenêtre de la carte', () => {
  // Mesuré le 2026-10-22 dans le bureau caché (conv-1066) : une page chargée en `data:` reçoit le
  // clic mais ne suit JAMAIS son lien `#ouvrir` ; chargée depuis un fichier, elle émet
  // `did-navigate-in-page`. Entrée qui ferait échouer ce test : revenir à `loadURL('data:…')`,
  // qui rendrait la carte entière inerte (ni ouvrir le fil, ni suite, ni croix).
  it('charge sa page depuis un FICHIER, jamais depuis une adresse data:', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(
      join(process.cwd(), 'src', 'main', 'notification-popup-fenetre.ts'),
      'utf8'
    )
    expect(source).toMatch(/win\.loadFile\(fichier\)/u)
    expect(source).not.toMatch(/loadURL\(\s*`data:/u)
  })
})

describe('creerPileDePopups — la bulle Windows reste le secours', () => {
  // `index.ts` passe à la bulle Windows quand `fabriquer` JETTE. Entrée qui ferait échouer ce test :
  // une fenêtre créée seulement à `show()` — l'erreur partirait alors dans le filet du notifieur,
  // qui l'avale, et l'utilisateur n'aurait NI carte NI bulle.
  it('une fenêtre impossible à créer fait jeter `fabriquer`, pas `show`', () => {
    const pile = creerPileDePopups({
      zone: () => ({ x: 0, y: 0, width: 1920, height: 1032 }),
      heure: () => '14:32',
      secours: bulleDeTest([]),
      ouvrirFenetre: () => {
        throw new Error('fenêtre impossible')
      }
    })
    expect(() => pile.fabriquer(PRETE)).toThrow('fenêtre impossible')
  })

  // Jumeau accepté : une carte fabriquée mais jamais montrée se ferme sans rien laisser derrière.
  it('close() avant show() ferme la fenêtre préparée, sans l’afficher', () => {
    const { pile, fenetres } = pileDeTest()
    const n = pile.fabriquer(PRETE)
    n.close()
    n.show()
    expect(fenetres[0].fermee).toBe(true)
    expect(fenetres[0].affichee).toBe(false)
  })
})

describe('creerPileDePopups — une page qui ne se charge pas laisse la place à la bulle Windows', () => {
  // `loadFile` est ASYNCHRONE : quand il échoue, `fabriquer` a déjà rendu la carte au notifieur, et
  // le secours de `index.ts` (sur un `fabriquer` qui jette) ne joue plus. Sans relais, l'utilisateur
  // n'a NI carte NI bulle (défaut relevé au nettoyage, conv-1066). Entrée qui ferait échouer ce
  // test si la correction était fausse : un échec de chargement APRÈS `show()`, sur une carte dont
  // le notifieur écoute déjà le clic et les boutons.
  it('après show() : la carte part, la bulle s’affiche avec les mêmes gestes', () => {
    const bulles: BulleDeTest[] = []
    const { pile, fenetres } = pileDeTest(undefined, bulles)
    const n = pile.fabriquer(PRETE)
    const evenements: string[] = []
    n.on('click', () => evenements.push('ouvrir'))
    n.on('action', (d) => evenements.push(`suite ${d.actionIndex}`))
    n.show()
    fenetres[0].echouer(new Error('ERR_FILE_NOT_FOUND'))
    expect(fenetres[0].fermee).toBe(true)
    expect(bulles).toHaveLength(1)
    expect(bulles[0].contenu).toBe(PRETE)
    expect(bulles[0].montree).toBe(true)
    bulles[0].cliquer()
    bulles[0].presser(1)
    expect(evenements).toEqual(['ouvrir', 'suite 1'])
    // Le notifieur remplace par fil : son `close()` doit fermer la bulle, plus la carte.
    n.close()
    expect(bulles[0].fermee).toBe(true)
  })

  it('les autres cartes redescendent à la place de celle qui a échoué', () => {
    const { pile, fenetres } = pileDeTest()
    pile.fabriquer(PRETE).show()
    pile.fabriquer(ECHEC).show()
    fenetres[1].echouer(new Error('ERR_FAILED'))
    const zone = { x: 0, y: 0, width: 1920, height: 1032 }
    expect(fenetres[0].rects.at(-1)).toEqual(disposerPopups(zone, [159])[0])
  })

  // Jumeau : un échec AVANT show() prépare la bulle, mais c'est show() qui l'affiche.
  it('avant show() : la bulle attend show() pour s’afficher', () => {
    const bulles: BulleDeTest[] = []
    const { pile, fenetres } = pileDeTest(undefined, bulles)
    const n = pile.fabriquer(PRETE)
    fenetres[0].echouer(new Error('ERR_FILE_NOT_FOUND'))
    expect(bulles.map((b) => b.montree)).toEqual([false])
    n.show()
    expect(bulles.map((b) => b.montree)).toEqual([true])
    expect(fenetres[0].affichee).toBe(false)
  })

  // Jumeau refusé : fermer une carte en cours de chargement fait aussi rejeter `loadFile`
  // (ERR_ABORTED). Ce n'est pas un échec : aucune bulle ne doit surgir d'une carte déjà fermée.
  it('une carte déjà fermée dont le chargement échoue ensuite n’ouvre aucune bulle', () => {
    const bulles: BulleDeTest[] = []
    const { pile, fenetres } = pileDeTest(undefined, bulles)
    const n = pile.fabriquer(PRETE)
    n.show()
    n.close()
    fenetres[0].echouer(new Error('ERR_ABORTED'))
    expect(bulles).toHaveLength(0)
  })

  it('une bulle elle-même impossible ne fait rien tomber', () => {
    const fenetres: Array<{ echouer: (e: unknown) => void; fermee: boolean }> = []
    const pile = creerPileDePopups({
      zone: () => ({ x: 0, y: 0, width: 1920, height: 1032 }),
      heure: () => '14:32',
      secours: () => {
        throw new Error('Notifications non supportees')
      },
      ouvrirFenetre: ({ surEchec }) => {
        const f = { echouer: surEchec, fermee: false }
        fenetres.push(f)
        return { placer: () => {}, afficher: () => {}, fermer: () => (f.fermee = true) }
      }
    })
    const n = pile.fabriquer(PRETE)
    n.show()
    expect(() => fenetres[0].echouer(new Error('ERR_FAILED'))).not.toThrow()
    expect(fenetres[0].fermee).toBe(true)
    expect(() => n.close()).not.toThrow()
  })
})

/*
 * LA CARTE SUIT LE THÈME CHOISI (conv-1090, 2026-10-22) : « fais suivre à la carte de fin de tour
 * le thème choisi dans Réglages · Interface (aujourd'hui figée sur les couleurs d'Holographique) ».
 * La page envoie les jetons CALCULÉS du thème appliqué (theme-mode.ts) ; la carte se peint avec.
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CES CAS : remettre une couleur d'Holographique en dur dans la page,
 * accepter autre chose qu'un `#rrggbb` (la valeur finit dans du CSS), ou garder le blanc déclaré
 * sur un accent vert vif (Machine à écrire : texte illisible).
 */
describe('la carte prend les couleurs du thème choisi', () => {
  /** Ninja Claude, lu dans theme-ninja-claude.css (anthracite, terracotta). */
  const NINJA: PaletteCarte = {
    fond: '#262624',
    texte: '#faf9f5',
    texteDoux: '#c2c0b6',
    accent: '#d97757',
    accent2: '#a8a59b',
    accent3: '#d97757',
    surAccent: '#ffffff',
    erreur: '#dd5e55'
  }
  /** Vanilla Claude, base CLAIRE (theme-vanilla-claude.css). */
  const VANILLA: PaletteCarte = {
    fond: '#faf9f5',
    texte: '#141413',
    texteDoux: '#3d3d3a',
    accent: '#c96442',
    accent2: '#6b6a64',
    accent3: '#a9502f',
    surAccent: '#ffffff',
    erreur: '#b23a34'
  }
  /** Machine à écrire (theme-modes.css) : vert phosphore, `--on-accent` hérité blanc. */
  const MACHINE: PaletteCarte = {
    fond: '#000000',
    texte: '#33ff33',
    texteDoux: '#22c922',
    accent: '#33ff33',
    accent2: '#99ff33',
    accent3: '#33ff33',
    surAccent: '#ffffff',
    erreur: '#ff4040'
  }
  const luminance = (hex: string): number => {
    const canal = (i: number): number => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5)
  }

  it('sans palette reçue, la carte reste celle validée : Holographique', () => {
    expect(htmlDePopup(PRETE, '14:32')).toBe(htmlDePopup(PRETE, '14:32', PALETTE_HOLOGRAPHIQUE))
    expect(PALETTE_HOLOGRAPHIQUE).toMatchObject({ accent: '#e63ca0', accent2: '#3c6eeb' })
  })

  it('une palette reçue repeint TOUTE la carte : plus aucune couleur d’Holographique', () => {
    const html = htmlDePopup(PRETE, '14:32', NINJA)
    expect(html).toContain('#d97757')
    expect(html).toContain('#a8a59b')
    for (const holo of ['#3c6eeb', '#e63ca0', '#ff8cc8', '#ece8f7', '#262628', '#1c1c1e'])
      expect(html, holo).not.toContain(holo)
  })

  it('le fond de la carte vient du fond du thème : thème clair = carte claire', () => {
    expect(luminance(couleursDeCarte(VANILLA).carteBas)).toBeGreaterThan(0.7)
    expect(luminance(couleursDeCarte(NINJA).carteBas)).toBeLessThan(0.05)
  })

  it('Holographique dérivé des jetons reste fidèle à la maquette validée', () => {
    const c = couleursDeCarte(PALETTE_HOLOGRAPHIQUE)
    // Maquette : carte #262628 → #1c1c1e, sous-titre #a49fb6, bouton second #2f2f33.
    expect(c.carteHaut).toBe('#272729')
    expect(c.carteBas).toBe('#1c1c1d')
    expect(c.secondFond).toBe('#303032')
    expect(c.surAccent).toBe('#ffffff')
  })

  it('le texte du bouton reste lisible sur l’accent : vert vif + blanc déclaré → noir', () => {
    expect(couleursDeCarte(MACHINE).surAccent).toBe('#000000')
    // Le libellé est posé au MILIEU du dégradé --violet → --accent : c'est là qu'il doit se lire.
    for (const palette of [PALETTE_HOLOGRAPHIQUE, NINJA, VANILLA, MACHINE]) {
      const c = couleursDeCarte(palette)
      const [a, b] = [luminance(c.surAccent), luminance(c.milieuDuDegrade)]
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(3)
    }
  })

  it('n’accepte que huit couleurs #rrggbb : tout le reste est refusé en bloc', () => {
    expect(paletteDeCarte({ ...NINJA, accent: '#D97757' })).toEqual(NINJA)
    expect(paletteDeCarte({ ...NINJA, accent: 'red' })).toBeNull()
    expect(paletteDeCarte({ ...NINJA, accent: '#fff;}body{display:none' })).toBeNull()
    const { erreur: _absente, ...incomplete } = NINJA
    expect(paletteDeCarte(incomplete)).toBeNull()
    expect(paletteDeCarte('nebuleuse-verre')).toBeNull()
    expect(paletteDeCarte(null)).toBeNull()
  })
})
