import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { THEMES, baseDuTheme } from '../theme-mode'

/**
 * Theme « Nebuleuse de verre » (conv-124, 2026-10-09). Deux fichiers : les regles ecrites a la main
 * (theme-nebuleuse-verre.css) et la couche generee des couleurs en dur
 * (theme-nebuleuse-verre.genere.css, scripts/theme-nebuleuse-verre.mjs).
 *
 * Le risque qui compte : une regle NON confinee au theme repeindrait l'application de TOUS les
 * utilisateurs, quel que soit le theme choisi -- 500 regles generees, une seule suffit.
 */
const lire = (fichier: string): string => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const PREFIXE = ":root[data-theme='nebuleuse-verre']"
/** Le bloc propre a Nebuleuse de verre (conv-177), retire de la derivation doree. */
const BLOC_CHANFREIN = /\/\* CADRE-CHANFREIN:DEBUT[\s\S]*?\/\* CADRE-CHANFREIN:FIN \*\/\n/

function selecteursHorsTheme(css: string): string[] {
  const fautifs: string[] = []
  postcss.parse(css).walkRules((regle) => {
    if (
      regle.parent?.type === 'atrule' &&
      /keyframes/i.test((regle.parent as postcss.AtRule).name)
    ) {
      return
    }
    for (const selecteur of regle.selectors) {
      if (!selecteur.trim().startsWith(PREFIXE)) fautifs.push(selecteur)
    }
  })
  return fautifs
}

describe('theme Nebuleuse de verre', () => {
  it('est propose dans la liste des themes, en base sombre', () => {
    expect(THEMES.map((t) => t.id)).toContain('nebuleuse-verre')
    // Renomme a l affichage le 2026-10-10 (conv-212) : « le mode nebuleux appelle-le le mode
    // holographique ». L identifiant reste `nebuleuse-verre` : c est lui qui est memorise sur le
    // poste, le changer ferait retomber l utilisateur sur le theme sombre.
    expect(THEMES.find((t) => t.id === 'nebuleuse-verre')?.libelle).toBe('Holographique')
    expect(baseDuTheme('nebuleuse-verre')).toBe('sombre')
  })

  it('charge la couche generee AVANT les regles ecrites a la main', () => {
    const app = lire('../App.tsx')
    const genere = app.indexOf("import './assets/theme-nebuleuse-verre.genere.css'")
    const main = app.indexOf("import './assets/theme-nebuleuse-verre.css'")
    expect(genere).toBeGreaterThan(-1)
    expect(main).toBeGreaterThan(genere)
  })

  it('ne peint rien hors du theme : chaque selecteur porte le prefixe du theme', () => {
    expect(selecteursHorsTheme(lire('./theme-nebuleuse-verre.css'))).toEqual([])
    expect(selecteursHorsTheme(lire('./theme-nebuleuse-verre.genere.css'))).toEqual([])
  })

  /**
   * REGLE CHANGEE PAR L'UTILISATEUR (2026-10-10, conv-197, « je veux que tout soit du vert de la
   * fin du degrade actuel ») : les verts ne restent plus intacts, ils prennent TOUS le vert du
   * theme. Ce vert est #00ff55, « bien flashy » (meme fil, apres un premier essai en menthe
   * #4fd1a5). Le SENS reste verrouille : un vert ne devient jamais rose ni violet, et les jaunes
   * et ambres d'alerte ne sont toujours jamais des sorties.
   */
  it('garde le sens des couleurs d etat : jaunes intacts, verts tous au vert du theme', () => {
    const genere = lire('./theme-nebuleuse-verre.genere.css')
    expect(genere).not.toMatch(/rgba?\(\s*(53, 208, 127|250, 204, 21|240, 160, 32)\b/)
    const teinte = (r: number, v: number, b: number): { h: number; s: number } => {
      const [R, V, B] = [r / 255, v / 255, b / 255]
      const max = Math.max(R, V, B)
      const min = Math.min(R, V, B)
      const l = (max + min) / 2
      if (max === min) return { h: 0, s: 0 }
      const d = max - min
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      const h =
        max === R ? (V - B) / d + (V < B ? 6 : 0) : max === V ? (B - R) / d + 2 : (R - V) / d + 4
      return { h: h * 60, s }
    }
    const vertsHorsTheme: string[] = []
    for (const [brut, r, v, b] of genere.matchAll(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/g)) {
      const { h, s } = teinte(Number(r), Number(v), Number(b))
      if (h < 85 || h > 178 || s < 0.3) continue
      // Le vert du theme (#00ff55) est a 140 deg ; ses ombres pour les fonds fonces aussi.
      if (Math.abs(h - 140) > 3) vertsHorsTheme.push(brut)
    }
    expect(vertsHorsTheme).toEqual([])
    // Preuve que les verts des composants SONT transposes — une couche sans aucune sortie verte
    // passerait le controle ci-dessus : un vert franc (#34d399), un turquoise (#4fc8b8) et un vert
    // de texte (#5bb68f) ressortent tous au vert du theme.
    const valeurs = new Map<string, string>()
    postcss.parse(genere).walkDecls((decl) => {
      for (const selecteur of (decl.parent as postcss.Rule).selectors ?? []) {
        valeurs.set(`${selecteur.trim()} | ${decl.prop}`, decl.value)
      }
    })
    expect(valeurs.get(`${PREFIXE} .cpick-dot-g | background`)).toBe('rgb(0, 255, 85)')
    expect(valeurs.get(`${PREFIXE} .observatory-event.is-tool-call > i | color`)).toBe(
      'rgb(0, 255, 85)'
    )
    expect(valeurs.get(`${PREFIXE} .topology-slot > em | color`)).toBe('rgb(0, 255, 85)')
    // Les jetons d'etat ecrits a la main suivent le meme vert.
    const main = lire('./theme-nebuleuse-verre.css')
    expect(main).toContain('--ok: #00ff55;')
    expect(main).toContain('--quota-vert: #00ff55;')
    expect(main).not.toMatch(/#4fd1a5|79, 209, 165/i)
  })

  /**
   * REGLE DE L'UTILISATEUR (2026-10-09, conv-124) : « jamais de bouton a triple degrade ».
   * Un bouton -- envoi, onglet, element de menu actif, pastille, choix -- porte au plus DEUX
   * teintes. Les jetons de degrade du theme sont resolus avant de compter : un rose -> violet
   * -> or cache derriere une variable compte comme trois teintes.
   *
   * UNE EXCEPTION NOMMEE (conv-202, 2026-10-10) : le BORD des capsules du bloc ASK est un reflet
   * holographique en bandes bleu > rose > argent, choisi par l'utilisateur sur maquette apres
   * quatre tours (« Irisé mais holographique bleu rose argent », puis « go cadre c parfait »). Seul
   * ce calque passe : un `repeating-linear-gradient` peint en `border-box` sur `.askd-item`. Le
   * REMPLISSAGE de la capsule reste compte comme celui de tout bouton (deux teintes au plus).
   */
  it('ne donne a aucun bouton un degrade de plus de deux teintes', () => {
    const BOUTON =
      /btn|send|-tab\b|-tab[.:[\s]|tabs? |nav-item|toggle|tests-run|tests-add|askd-item|rail-toggle|panel-close/
    const fautifs: string[] = []
    const normaliser = (selecteur: string): string => selecteur.replace(/\s+/g, ' ').trim()
    const main = postcss.parse(lire('./theme-nebuleuse-verre.css'))
    const jetons = new Map<string, string>()
    main.walkDecls(/^--nv-/, (decl) => {
      jetons.set(decl.prop, decl.value)
    })
    // Le fichier ecrit a la main est importe APRES la couche generee : une regle generee dont
    // il reprend le MEME selecteur avec son propre fond ne s'affiche jamais. Seul le gagnant compte.
    const surcharges = new Set<string>()
    main.walkDecls(/^background/, (decl) => {
      const regle = decl.parent as postcss.Rule
      for (const selecteur of regle.selectors ?? []) surcharges.add(normaliser(selecteur))
    })
    for (const [fichier, racine] of [
      ['main', main],
      ['genere', postcss.parse(lire('./theme-nebuleuse-verre.genere.css'))]
    ] as const) {
      racine.walkRules((regle) => {
        if (!BOUTON.test(regle.selector)) return
        if (fichier === 'genere' && regle.selectors.every((s) => surcharges.has(normaliser(s)))) {
          return
        }
        regle.walkDecls(/^background/, (decl) => {
          let valeur = decl.value.replace(/var\((--nv-[\w-]+)\)/g, (m, nom) => jetons.get(nom) ?? m)
          if (/\.askd-item\b/.test(regle.selector)) {
            valeur = valeur.replace(
              /repeating-linear-gradient\((?:[^()]|\([^()]*\))*\)\s+border-box/g,
              'bord-holo-ask'
            )
          }
          for (const degrade of valeur.match(/linear-gradient\((?:[^()]|\([^()]*\))*\)/g) ?? []) {
            const teintes = degrade.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []
            if (teintes.length > 2) fautifs.push(`${regle.selector} -> ${degrade}`)
          }
        })
      })
    }
    expect(fautifs).toEqual([])
  })

  /**
   * REGLE DE L'UTILISATEUR (2026-10-10, conv-155) : le coin bas-droit pince « faisait sens pour la
   * bulle de chat mais pas pour les boutons et les highlights ». Seule la bulle de SES messages a
   * le droit d'avoir des coins inegaux ; un bouton ou un element selectionne a des coins reguliers.
   */
  it('reserve le coin pince aux bulles de message de l utilisateur', () => {
    const coinsInegaux: string[] = []
    for (const fichier of ['./theme-nebuleuse-verre.css', './theme-nebuleuse-verre.genere.css']) {
      postcss.parse(lire(fichier)).walkDecls(/^(border-radius|--nv-forme-toi)$/, (decl) => {
        // Une valeur calculee (`calc(var(--nv-rond) - 1px)`) est UN rayon, pas quatre coins.
        const coins = decl.value.includes('(')
          ? [decl.value]
          : decl.value.split('/')[0].trim().split(/\s+/)
        if (new Set(coins).size < 2) return
        const regle = decl.parent as postcss.Rule
        if (regle.selectors.every((s) => /\.msg\.user \.msg-body$/.test(s.trim()))) return
        // Seule autre exception, nommee : les deux BOUTS de la capsule du pied de liste. Ce n'est
        // pas un coin pince mais la moitie d'une capsule : la case survolee suit le bord arrondi
        // de la capsule (variante « 2 · Case pleine » choisie sur maquette le 2026-10-10).
        const boutDeCapsule =
          (/\.conv-foot > button:first-child$/.test(regle.selector.trim()) &&
            decl.value === '999px 0 0 999px') ||
          (/\.conv-foot > button:last-child$/.test(regle.selector.trim()) &&
            decl.value === '0 999px 999px 0')
        if (boutDeCapsule) return
        coinsInegaux.push(`${regle.selector} -> ${decl.value}`)
      })
    }
    expect(coinsInegaux).toEqual([])
  })

  /**
   * LA SAISIE SANS ROSE (2026-10-10, conv-155, variante « B · S'allume, rond » choisie sur
   * maquette) : bloc noir profond uni a bord or, bouton d'envoi ROND qui s'allume en or plein
   * quand le message peut partir, contour or eteint quand le champ est vide, aucune lueur.
   */
  it('donne a la saisie le noir a bord or et le bouton rond qui s allume en or', () => {
    const decls = (selecteur: string): Record<string, string> => {
      const valeurs: Record<string, string> = {}
      postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
        if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
        regle.walkDecls((d) => {
          valeurs[d.prop] = d.value
        })
      })
      return valeurs
    }
    const saisie = decls(`${PREFIXE} .cosmic-outline .composer`)
    expect(saisie['--nv-saisie-degrade']).toBe('linear-gradient(#09090a, #09090a)')
    // Le cadre or uni (conv-155) est remplace par le cadre « or qui coule vers le blanc » (conv-168).
    const saisieDetachee = decls(`${PREFIXE} .cosmic-outline .chat > .composer`)
    expect(saisieDetachee['--nv-saisie-bord']).toBe('transparent')
    expect(saisieDetachee['--nv-saisie-cadre']).toBe('var(--nv-cadre-coule)')
    const envoi = decls(`${PREFIXE} .cosmic-outline .composer-send`)
    expect(envoi['border-radius']).toBe('50%')
    expect([envoi.width, envoi.height]).toEqual(['38px', '38px'])
    expect(envoi['--nv-envoi-fond']).toBe('#d9ae52')
    expect(envoi['--nv-envoi-vide-fond']).toBe('transparent')
    expect(envoi['--nv-envoi-lueur']).toBe('none')
    // Plus aucun rose dans les regles de la saisie ecrites a la main.
    const saisieEtEnvoi = JSON.stringify([saisie, envoi])
    expect(saisieEtEnvoi).not.toMatch(/230, 60, 160|nv-degrade\b|nv-lueur-toi/)
  })

  it('allume le mode auto de la saisie en or, pas en rose', () => {
    let actif = ''
    postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
      if (regle.selector.trim() === `${PREFIXE} .composer-auto.actif`) actif = regle.toString()
    })
    expect(actif).toContain('rgba(212, 169, 79, 0.75)')
    expect(actif).not.toMatch(/251, 91, 171/)
  })

  /**
   * DEMANDE DE L'UTILISATEUR (2026-10-10, conv-157) : « ce bouton met le en dore » (pastille
   * « ↓ Dernier message », rose dans ce theme). La regle ecrite a la main doit couvrir les DEUX
   * pastilles (fil et mosaique, identiques par choix) et ne garder aucun rose.
   */
  it('peint la pastille « Dernier message » en or, dans le fil comme dans la mosaique', () => {
    const regles: postcss.Rule[] = []
    postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
      if (/chat-jump-latest|chat-mosaic-window-jump/.test(regle.selector)) regles.push(regle)
    })
    const selecteurs = regles.flatMap((r) => r.selectors.map((s) => s.replace(/\s+/g, ' ').trim()))
    expect(selecteurs).toEqual(
      expect.arrayContaining([
        `${PREFIXE} .cosmic-outline .chat-jump-latest`,
        `${PREFIXE} .chat-mosaic-window-jump`
      ])
    )
    const texte = regles.map((r) => r.toString()).join('\n')
    expect(texte).toContain('rgba(212, 169, 79, 0.6)')
    expect(texte).toContain('color: #e3ba55')
    expect(texte).not.toMatch(/255, 141, 198|255, 176, 216|230, 60, 160/)
  })

  /**
   * DEMANDE DE L'UTILISATEUR (2026-10-10, conv-157) : « met des borders degrade [...] sur les
   * elements du chat qui ont un cadre comme ca » (capture de la carte de fichier du fil), precise :
   * « ca doit etre les memes couleurs que mes messages dans le chat ». Le bord rose plein de la
   * couche generee laisse place a un calque au degrade EXACT des bulles de l'utilisateur, qui
   * garde les coins arrondis.
   */
  it('borde les cartes de fichier du fil en blanc, les bulles gardant leur degrade', () => {
    const decls = (selecteur: string): Record<string, string> => {
      const valeurs: Record<string, string> = {}
      postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
        if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
        regle.walkDecls((d) => {
          valeurs[d.prop] = d.value
        })
      })
      return valeurs
    }
    const carte = decls(`${PREFIXE} .artifact-preview`)
    expect(carte.border).toBe('0')
    expect(carte.position).toBe('relative')
    const bord = decls(`${PREFIXE} .artifact-preview::before`)
    // La bulle AFFICHEE vient de cosmic-outline.css (`.msg-bulle`, selecteur plus fort que la
    // regle `.msg.user .msg-body` du theme, qui est ecrasee) : c'est elle qu'on compare.
    let bulle = ''
    postcss.parse(lire('./cosmic-outline.css')).walkRules((regle) => {
      if (
        regle.selector.includes(":not([data-base='clair']):not([data-theme^='malvoyant-'])") &&
        /\.msg\.user \.msg-body\.msg-bulle$/.test(regle.selector.trim())
      ) {
        regle.walkDecls('background', (d) => {
          bulle = d.value
        })
      }
    })
    // Bleu en haut a gauche -> rose en bas a droite (« le bleu est a gauche et le rose a droite »).
    // Bleu et rose PLEINS (conv-182 : « le même bleu plein partout »), plus de 85 %.
    expect(bulle).toBe('linear-gradient(135deg, #3c6eeb, #e63ca0)')
    // Le CADRE de la carte est passe en BLANC (conv-161, 2026-10-10 : « ce cadre met le en blanc
    // aussi ca rendra mieux ») ; les bulles, elles, gardent leur degrade.
    expect(bord.background).toBe('#ffffff')
    // Les messages envoyes PENDANT un tour (DirectiveReceiptRow, sans `msg-bulle`) sont peints par
    // la regle du theme : meme sens que les bulles ordinaires (ils etaient rose -> bleu).
    expect(decls(`${PREFIXE} .msg.user .msg-body`).background).toBe(bulle)
    expect(bord['border-radius']).toBe('inherit')
    expect(bord['mask-composite']).toBe('exclude')
    expect(bord['pointer-events']).toBe('none')
  })

  // conv-169, 2026-10-10 : « plein de views ont un degrade or qui part du sommet, enleve-le ».
  // Le voile (--nv-voile-dore, 180deg or -> transparent) peignait le haut des vues, cartes, rail,
  // popovers et colonnes du chat. ENTREE QUI DOIT FAIRE ECHOUER CE TEST : remettre un fond
  // `linear-gradient(180deg, rgba(255, 206, 120, ...` ou le jeton lui-meme dans une regle.
  it('ne pose plus de voile or qui part du haut des panneaux', () => {
    for (const fichier of ['./theme-nebuleuse-verre.css', './theme-nebuleuse-doree.css']) {
      postcss.parse(lire(fichier)).walkDecls((d) => {
        if (!/^(background|background-image|--)/.test(d.prop)) return
        expect(d.value, `${fichier} ${d.prop}`).not.toMatch(/var\(--nv-voile-dore\)/)
        expect(d.value, `${fichier} ${d.prop}`).not.toMatch(
          /linear-gradient\(\s*(180deg|to bottom)\s*,\s*rgba\(255,\s*206,\s*120/
        )
      })
    }
  })

  /**
   * DEMANDE DE L'UTILISATEUR (2026-10-10, conv-168) : un cadre sur les cotes et en bas des
   * conteneurs, « or qui coule », puis « finalement fais un or qui coule vers le blanc et pareil
   * pour le prompt panel ». Un seul degrade (--nv-cadre-coule) : or en haut, blanc en bas, porte
   * par les quatre colonnes ET la saisie.
   */
  // Depuis conv-177, Nebuleuse de verre REMPLACE ce cadre par le chanfrein platine (bloc
  // CADRE-CHANFREIN, teste plus bas) ; l'or qui coule reste la BASE que Nebuleuse doree herite.
  it('garde en base, pour Nebuleuse doree, le cadre or qui coule vers le blanc', () => {
    const regles: postcss.Rule[] = []
    postcss
      .parse(lire('./theme-nebuleuse-verre.css').replace(BLOC_CHANFREIN, ''))
      .walkRules((regle) => {
        regles.push(regle)
      })
    const valeur = (selecteur: string, prop: string): string | undefined => {
      let trouvee: string | undefined
      for (const regle of regles) {
        if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) continue
        regle.walkDecls(prop, (d) => {
          trouvee = d.value
        })
      }
      return trouvee
    }
    const degrade = (valeur(PREFIXE, '--nv-cadre-coule') ?? '').replace(/\s+/g, ' ')
    expect(degrade).toMatch(/^linear-gradient\( 180deg, rgba\(227, 186, 85, 0\.85\),/)
    expect(degrade).toMatch(/rgba\(255, 255, 255, 0\.85\) \)$/)
    expect(degrade).not.toMatch(/230, 60, 160/)
    for (const cadre of [
      `${PREFIXE} .cosmic-outline :is(.conv-pane, .chat, .runs-pane)::before`,
      `${PREFIXE} .theme-serious .rail::before`
    ]) {
      expect(valeur(cadre, 'background'), cadre).toBe('var(--nv-cadre-coule)')
      expect(valeur(cadre, 'mask-composite'), cadre).toBe('exclude')
      expect(valeur(cadre, 'pointer-events'), cadre).toBe('none')
    }
    const saisie = `${PREFIXE} .cosmic-outline .chat > .composer`
    expect(valeur(saisie, '--nv-saisie-cadre')).toBe('var(--nv-cadre-coule)')
    expect(valeur(saisie, '--nv-saisie-boite')).toBe('padding-box')
    expect((valeur(saisie, 'background') ?? '').replace(/\s+/g, ' ')).toBe(
      'var(--nv-saisie-degrade) var(--nv-saisie-boite), var(--nv-saisie-cadre) border-box, rgba(8, 8, 8, 0.86)'
    )
  })

  /**
   * DEMANDE DE L'UTILISATEUR (2026-10-10, conv-173, maquettes « Fumé net ») : « Agent assorti
   * implémente c magnifique ». La ligne « Agent » devient une capsule de verre fumé à bord OR, qui
   * PALIT quand le tour est fini (classe `is-live` posée par ChatMessageRow tant qu'il tourne).
   * Entrée qui ferait échouer une copie fausse : un bord rose (la couleur des capsules) ou une
   * capsule qui reste allumée sur les vieux tours.
   */
  it('met la ligne Agent dans une capsule a bord or qui palit en fin de tour', () => {
    const decls = (selecteur: string): Record<string, string> => {
      const sortie: Record<string, string> = {}
      postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
        if (regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) {
          regle.walkDecls((d) => {
            sortie[d.prop] = d.value
          })
        }
      })
      return sortie
    }
    const allumee = decls(`${PREFIXE} .msg.assistant > .msg-meta`)
    expect(allumee['border']).toBe('1.5px solid rgba(227, 186, 85, 0.8)')
    expect(allumee['border-radius']).toBe('999px')
    expect(allumee['width']).toBe('fit-content')
    const eteinte = decls(`${PREFIXE} .msg.assistant > .msg-meta:not(.is-live)`)
    expect(eteinte['border-color']).toBe('rgba(227, 186, 85, 0.4)')
  })

  /**
   * FOND NOIR PUR (2026-10-10, conv-184). L'utilisateur a compare le fond « liseré · halo haut »
   * (conv-159) a un apercu tout noir et a tranche : « met le noir, oublie le rose et bleu, c'est
   * moche ». Entree qui ferait echouer une copie fausse : un halo ou un filet bleu/rose qui reste
   * (47, 139, 255 · 255, 79, 159 · #8ccaff · #ffa3cf), l'ancien noir bleute #07080b, le grain
   * anime laisse visible, ou le voile violet de body::after.
   */
  it('pose un fond noir pur, sans halo, filet, grain ni voile', () => {
    const decls = (selecteur: string): Record<string, string> => {
      const sortie: Record<string, string> = {}
      postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
        if (regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) {
          regle.walkDecls((d) => {
            sortie[d.prop] = d.value
          })
        }
      })
      return sortie
    }
    expect(decls(`${PREFIXE} body`).background).toBe('#000')
    expect(lire('./theme-nebuleuse-verre.css')).not.toMatch(
      /47, 139, 255|255, 79, 159|#8ccaff|#ffa3cf|#07080b/
    )
    expect(decls(`${PREFIXE} body::before`).display).toBe('none')
    const voile = decls(`${PREFIXE} body::after`)
    expect(voile.background).toBe('none')
    expect(voile['box-shadow']).toBe('none')
  })

  // conv-198 (2026-10-10) : « enlève le halo autour de ce que j'ai sélectionné ». L'onglet ouvert
  // du menu garde son dégradé, sans lueur autour — dans le verre et dans la dorée qui en dérive.
  it('ne met aucun halo autour de l onglet ouvert du menu', () => {
    for (const [fichier, theme] of [
      ['./theme-nebuleuse-verre.css', 'nebuleuse-verre'],
      ['./theme-nebuleuse-doree.css', 'nebuleuse-doree']
    ] as const) {
      const actif: Record<string, string> = {}
      postcss.parse(lire(fichier)).walkRules((regle) => {
        if (
          regle.selectors.some((s) => s.trim() === `:root[data-theme='${theme}'] .nav-item.active`)
        ) {
          regle.walkDecls((d) => {
            actif[d.prop] = d.value
          })
        }
      })
      expect(actif.background, fichier).toBe('var(--nv-degrade)')
      expect(actif['box-shadow'], fichier).toBe('none')
      expect(lire(fichier), fichier).not.toMatch(/nv-lueur-toi/)
    }
  })

  /**
   * AUCUN FLOU DE FOND (2026-10-10, conv-124). Un parent porteur d'un `backdrop-filter` devient le
   * repere des enfants `position: fixed` : la fenetre des quotas (ModelQuotaIndicator.tsx), ancree
   * sur la fenetre de l'app, se calculait depuis le bloc de saisie et disparaissait. Le theme
   * sombre d'origine met deja `--container-blur` a 0 pour la meme raison (ui-system.css).
   */
  it('ne pose aucun flou de fond qui decalerait les fenetres ancrees sur la fenetre', () => {
    const fautifs: string[] = []
    for (const fichier of ['./theme-nebuleuse-verre.css', './theme-nebuleuse-verre.genere.css']) {
      postcss.parse(lire(fichier)).walkDecls((decl) => {
        if (/backdrop-filter$/.test(decl.prop) && decl.value.trim() !== 'none') {
          fautifs.push(`${fichier} : ${decl.prop}: ${decl.value}`)
        }
        if (decl.prop === '--container-blur' && !/^0(px)?$/.test(decl.value.trim())) {
          fautifs.push(`${fichier} : --container-blur: ${decl.value}`)
        }
      })
    }
    expect(fautifs).toEqual([])
  })
})

/**
 * ENVOYER EN GEL FONDU BLEU-ROSE (2026-10-10, conv-200, /draft « le bouton pour envoyer des
 * messages une version bleu et violet comme le reste de mon theme » : tour 1 « E · Gel », tour 2
 * « implémente E4 »). La perle or d'Envoyer est remplacee par le degrade du theme -- #3c6eeb ->
 * #e63ca0, celui de « Nouveau fil » et de l'icone active du menu --, avion blanc, et un reflet
 * blanc qui s'efface SANS ligne jusqu'au milieu. L'etat se lit au reflet et a l'avion, jamais a la
 * couleur (conv-182 : le bleu reste plein) : survol = reflet plus fort, appui = reflet eteint sans
 * retrecir, rien a envoyer = reflet faible et avion a 50 %. ENTREES QUI DOIVENT FAIRE ECHOUER : la
 * perle or remise, une `opacity` ou un contour or sur le rond vide, une lueur coloree, ou le gel
 * qui fuit dans Nebuleuse doree (elle garde son or, conv-155).
 */
describe('Envoyer en gel fondu bleu-rose', () => {
  const ENVOI = `${PREFIXE} .cosmic-outline .composer-send:not(.is-resume):not(.is-stop):not(:disabled)`
  const VIDE = `${PREFIXE} .cosmic-outline .composer-send:not(.is-resume):not(.is-stop):disabled`
  const GEL =
    /^linear-gradient\(180deg, rgba\(255, 255, 255, (0?\.\d+)\), rgba\(255, 255, 255, 0\) (\d+)%\),\s*linear-gradient\(135deg, #3c6eeb, #e63ca0\)$/
  const derniere = (selecteur: string): Record<string, string> => {
    const valeurs: Record<string, string> = {}
    postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
      if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
      regle.walkDecls((d) => {
        valeurs[d.prop] = d.value
      })
    })
    return valeurs
  }
  /** Force du reflet blanc d'un fond en gel ; NaN si le fond n'est pas le gel fondu bleu-rose. */
  const reflet = (fond: string | undefined): number => {
    const m = (fond ?? '').match(GEL)
    return m ? Number(m[1]) : Number.NaN
  }

  it('peint le rond pret du degrade du theme, avion blanc, reflet fondu sans ligne', () => {
    const pret = derniere(ENVOI)
    expect(pret.background).toMatch(GEL)
    expect(reflet(pret.background)).toBe(0.4)
    expect(pret.color).toBe('#ffffff')
    expect(pret['border-color']).toBe('transparent')
    expect(pret['background-origin']).toBe('border-box')
    expect(pret['box-shadow']).toBe('0 2px 3px rgba(0, 0, 0, 0.6)')
  })

  it('marque le survol et l appui par le reflet seul, sans retrecir', () => {
    const pret = reflet(derniere(ENVOI).background)
    const survol = derniere(`${ENVOI}:hover`)
    const appui = derniere(`${ENVOI}:active`)
    expect(reflet(survol.background)).toBeGreaterThan(pret)
    expect(reflet(appui.background)).toBeLessThan(pret)
    expect(appui.transform).toBe('none')
    expect(appui['box-shadow']).toBe('0 1px 1px rgba(0, 0, 0, 0.6)')
  })

  it('garde le meme degrade plein quand il n y a rien a envoyer', () => {
    const vide = derniere(VIDE)
    expect(reflet(vide.background)).toBeLessThan(reflet(derniere(ENVOI).background))
    expect(vide.opacity).toBe('1')
    expect(vide.color).toBe('rgba(255, 255, 255, 0.5)')
    expect(vide['border-color']).toBe('transparent')
    expect(vide['box-shadow']).toBe('none')
  })

  it('laisse a Nebuleuse doree son or : le gel n y passe pas', async () => {
    const { genererMainDoree } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    expect(genererMainDoree()).not.toMatch(
      /rgba\(255, 255, 255, 0\.4\), rgba\(255, 255, 255, 0\) 60%/
    )
  })
})

/**
 * STOP EN PERLE (2026-10-10, variante « C4 · Perle » choisie sur maquette : « PERLE implémente ») :
 * un dome radial et un reflet ovale net en haut ; au survol le reflet s'avive, a l'appui il
 * s'eteint et l'ombre se raccourcit, sans retrecissement. Aucune lueur (ombres noires seulement),
 * deux teintes par degrade (conv-124). Envoyer avait la meme perle en or jusqu'au gel bleu-rose
 * (conv-200, ci-dessus). Nebuleuse doree, derivee de ce fichier, garde sa pastille (conv-155) : le
 * bloc RELIEF-PERLE n'y passe pas.
 */
describe('Stop en perle', () => {
  const STOP = `${PREFIXE} .composer-input-row > .composer-stop:not(:disabled)`
  const derniere = (selecteur: string): Record<string, string> => {
    const valeurs: Record<string, string> = {}
    postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
      if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
      regle.walkDecls((d) => {
        valeurs[d.prop] = d.value
      })
    })
    return valeurs
  }
  const REFLET =
    /^radial-gradient\(ellipse 52% 28% at 50% 19%, rgba\([^)]*\), rgba\([^)]*\)\),\s*radial-gradient\(circle at 50% 42%, #[0-9a-f]{6}, #[0-9a-f]{6} 80%\)$/

  it('pose un dome a reflet ovale sur Stop, au repos comme au survol', () => {
    for (const etat of [STOP, `${STOP}:hover`]) {
      const r = derniere(etat)
      expect(r.background, etat).toMatch(REFLET)
      expect(r['background-origin'], etat).toBe('border-box')
      expect(r['border-color'], etat).toBe('transparent')
    }
    expect(derniere(STOP).background).toContain('#e8352c, #a51812')
  })

  it("eteint le reflet a l'appui, sans retrecir le bouton", () => {
    const appui = derniere(`${STOP}:active`)
    expect(appui.background).toMatch(
      /^radial-gradient\(circle at 50% 55%, #[0-9a-f]{6}, #[0-9a-f]{6} 80%\)$/
    )
    expect(appui.transform).toBe('none')
    expect(appui['box-shadow']).toBe('0 1px 1px rgba(0, 0, 0, 0.6)')
  })

  it('ne met aucune lueur : seules des ombres noires', () => {
    expect(derniere(STOP)['box-shadow']).toBe('0 2px 3px rgba(0, 0, 0, 0.6)')
  })

  it('laisse a Nebuleuse doree sa pastille : le bloc RELIEF-PERLE ne passe pas', async () => {
    const { genererMainDoree } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    const source = lire('./theme-nebuleuse-verre.css')
    expect(source).toMatch(/RELIEF-PERLE:DEBUT[\s\S]*RELIEF-PERLE:FIN/)
    expect(genererMainDoree()).not.toMatch(/RELIEF-PERLE:(DEBUT|FIN)|ellipse 52% 28%/)
  })
})

/**
 * DEMANDE DE L'UTILISATEUR (2026-10-10, conv-177, /draft « des Border de container styles ») :
 * « j'adore le 3 » (Chanfrein), « Platine », puis « coins seuls implemente ». Coins haut gauche et
 * bas droit coupes a 14 px, seuls les pans coupes allumes (blanc / argent), cotes a 7 %, sur la
 * liste, le fil, le panneau de droite, le menu et la saisie. Entrees qui feraient echouer une copie
 * fausse : un cadre encore dore, une coupe posee sur le fil ou la saisie (elle rognerait leurs
 * menus), une jauge de contexte dont la decoupe d'occupation serait ecrasee, ou le bloc qui fuit
 * dans Nebuleuse doree.
 */
describe('Cadre chanfrein platine, coins seuls', () => {
  const derniere = (selecteur: string): Record<string, string> => {
    const valeurs: Record<string, string> = {}
    postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
      if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
      regle.walkDecls((d) => {
        valeurs[d.prop] = d.value.replace(/\s+/g, ' ')
      })
    })
    return valeurs
  }

  it('coupe le haut gauche et le bas droit a 14 px, pans blanc et argent, cotes a 7 %', () => {
    const racine = derniere(PREFIXE)
    expect(racine['--nv-chanfrein']).toBe('14px')
    expect(racine['--nv-chanfrein-pan']).toBe('14px')
    expect(racine['--nv-chanfrein-haut']).toBe('#ffffff')
    expect(racine['--nv-chanfrein-bas']).toBe('#c9d4e6')
    expect(racine['--nv-chanfrein-cotes']).toBe('rgba(255, 255, 255, 0.07)')
    expect(racine['--nv-chanfrein-forme']).toBe(
      'polygon( var(--nv-chanfrein) 0, 100% 0, 100% calc(100% - var(--nv-chanfrein)), calc(100% - var(--nv-chanfrein)) 100%, 0 100%, 0 var(--nv-chanfrein) )'
    )
  })

  it('garde un trait d 1 px sur la diagonale : un anneau evenodd rentre de 0,414 px', () => {
    const anneau = derniere(PREFIXE)['--nv-chanfrein-anneau']
    expect(anneau).toMatch(/^polygon\( evenodd,/)
    expect(anneau).toContain('calc(var(--nv-chanfrein) + 0.414px) 1px')
    expect(anneau).toContain('calc(100% - var(--nv-chanfrein) - 0.414px) calc(100% - 1px)')
  })

  it('coupe la liste, le panneau de droite, le panneau du fil et le menu, et en fait le cadre', () => {
    // Liste, panneau de droite et menu : coupes sur leur boite INTERIEURE, la ou commence leur
    // cadre (un bord transparent d'1 px les entoure). Coupes sur la boite exterieure, ils
    // laissaient 1 px de fond sombre hors du trait (capture du 2026-10-10).
    const panneaux: Array<[string, string]> = [
      [
        `${PREFIXE} .cosmic-outline :is(.conv-pane, .runs-pane)`,
        'var(--nv-chanfrein-forme) padding-box'
      ],
      [`${PREFIXE} .cosmic-outline .chat::after`, 'var(--nv-chanfrein-forme)'],
      [`${PREFIXE} .theme-serious .rail`, 'var(--nv-chanfrein-forme-menu) padding-box']
    ]
    for (const [panneau, coupe] of panneaux) {
      const r = derniere(panneau)
      expect(r['clip-path'], panneau).toBe(coupe)
      expect(r['border-radius'], panneau).toBe('0')
      expect(r['box-shadow'], panneau).toBe('none')
    }
    // L'encart flottant de mise a jour sort a DROITE du menu replie : la forme lui laisse la place.
    expect(derniere(PREFIXE)['--nv-chanfrein-forme-menu']).toContain('calc(100% + 400px) 0')
    for (const cadre of [
      `${PREFIXE} .cosmic-outline :is(.conv-pane, .chat, .runs-pane)::before`,
      `${PREFIXE} .theme-serious .rail::before`
    ]) {
      const r = derniere(cadre)
      expect(r['clip-path'], cadre).toBe('var(--nv-chanfrein-anneau)')
      expect(r.background, cadre).toBe('var(--nv-chanfrein-trait)')
      expect(r.mask, cadre).toBe('none')
    }
  })

  it('ne coupe ni le fil ni la saisie, dont des menus debordent : la saisie peint ses coins', () => {
    expect(derniere(`${PREFIXE} .cosmic-outline .chat`)['clip-path']).toBeUndefined()
    const saisie = derniere(`${PREFIXE} .cosmic-outline .chat > .composer`)
    expect(saisie['clip-path']).toBeUndefined()
    expect(saisie['border-radius']).toBe('0')
    // conv-191 : le satin est celui de la PAGE (`fixed`), pose sur toute la boite de la saisie. Ses
    // coins restent coupes par 6 calques a 135 deg : le cache noir des deux triangles, les deux traits
    // de la diagonale redessines par-dessus le satin, puis (sous le bord) pan blanc, pan argent, cotes.
    expect(saisie.background.match(/linear-gradient\( 135deg,/g)).toHaveLength(6)
    expect(saisie.background).toMatch(
      /^linear-gradient\( 135deg, #000 calc\(var\(--nv-chanfrein-a\) - 0\.4px\), transparent calc\(var\(--nv-chanfrein-a\) - 0\.4px\), transparent calc\(100% - var\(--nv-chanfrein-a\) \+ 0\.4px\), #000 calc\(100% - var\(--nv-chanfrein-a\) \+ 0\.4px\) \) padding-box, linear-gradient\( 135deg, transparent calc\(var\(--nv-chanfrein-a\) - 0\.4px\), var\(--nv-chanfrein-haut\)/
    )
    expect(saisie.background).toContain(
      'var(--nv-chanfrein-bas) calc(100% - var(--nv-chanfrein-a) - 0.4px), transparent calc(100% - var(--nv-chanfrein-a) + 0.4px) ) right bottom / var(--nv-chanfrein-pans) var(--nv-chanfrein-pans) no-repeat padding-box'
    )
    expect(saisie.background).toContain('var(--nv-satin) fixed padding-box')
    expect(saisie.background).not.toMatch(/227, 186, 85|nv-cadre-coule/)
  })

  it('fait partir la jauge de contexte apres le pan blanc, sans toucher a sa decoupe d occupation', () => {
    for (const calque of ['::after', '::before']) {
      const r = derniere(
        `${PREFIXE} .cosmic-outline .chat > .composer[data-context-level]${calque}`
      )
      // Le remplissage garde la decoupe d'occupation de ChatView.css : un clip-path pose ici
      // l'ecraserait (une premiere version montrait un point dore a 0 %).
      expect(r['clip-path'], calque).toBeUndefined()
      expect(r.mask, calque).toMatch(
        /^linear-gradient\( 90deg, transparent calc\(var\(--nv-chanfrein-pans\) - 0\.5px\), #000 calc\(var\(--nv-chanfrein-pans\) \+ 0\.5px\) \), linear-gradient\(#000 0 0\) content-box, linear-gradient\(#000 0 0\)$/
      )
      expect(r['mask-composite'], calque).toBe('intersect, exclude')
    }
  })

  it('donne au cadre de page des autres vues les coins coupes et le trait du Chat (conv-211)', () => {
    // « faut aligner toutes les autres views » : `.view-page` (les huit vues hors Chat et Accueil)
    // est coupe comme la liste des fils, sans filet or ni reflet dore.
    const cadre = derniere(`${PREFIXE} .view-page`)
    expect(cadre['clip-path']).toBe('var(--nv-chanfrein-forme)')
    expect(cadre['border-radius']).toBe('0')
    expect(cadre['box-shadow']).toBe('none')
    // Trait PEINT en tete du fond (un `::before` absolu defilerait avec Task Manager sous 820 px),
    // puis la lumiere et le satin de la page.
    expect(cadre.background).toMatch(/^var\(--nv-chanfrein-trait-fond\), radial-gradient\(/)
    expect(cadre.background).toMatch(/var\(--nv-satin\) fixed$/)
    expect(cadre.background).not.toMatch(/lisere-haut|surface-panel/)
    // Le trait : la diagonale a 50 % du carre de 14 px, puis 14 px de pan le long des deux bords,
    // en blanc en haut a gauche et en argent en bas a droite ; les cotes a 7 % sur les quatre bords.
    const trait = derniere(PREFIXE)['--nv-chanfrein-trait-fond']
    expect(trait.match(/linear-gradient\( 135deg,/g)).toHaveLength(2)
    expect(trait).toContain(
      'var(--nv-chanfrein-haut) calc(50% + 0.6px), transparent calc(50% + 1.4px) ) left top / var(--nv-chanfrein) var(--nv-chanfrein) no-repeat'
    )
    expect(trait).toContain(
      'transparent calc(50% - 1.4px), var(--nv-chanfrein-bas) calc(50% - 0.6px)'
    )
    expect(trait).toContain('left top / var(--nv-chanfrein-pans) 1px no-repeat')
    expect(trait).toContain('right bottom / 1px var(--nv-chanfrein-pans) no-repeat')
    expect(trait.match(/var\(--nv-chanfrein-cotes\), var\(--nv-chanfrein-cotes\)/g)).toHaveLength(4)
  })

  it('coupe aussi les tuiles et la plaque du titre de l Accueil, trait cale sur leur bord', () => {
    const accueil = derniere(`${PREFIXE} :is(.home-tile__panel, .home-view__masthead)`)
    expect(accueil['clip-path']).toBe('var(--nv-chanfrein-forme)')
    expect(accueil['border-color']).toBe('transparent')
    expect(accueil['border-radius']).toBe('0')
    // Bord d'1 px : les calques partent de la boite exterieure, sinon le trait tombe 1 px dedans.
    expect(accueil['background-origin']).toBe('border-box')
    expect(accueil['backdrop-filter']).toBe('none')
    expect(accueil.background).toMatch(/^var\(--nv-chanfrein-trait-fond\), radial-gradient\(/)
    // La tuile tenue et la tuile au clavier se disent encore : par leur bord.
    expect(derniere(`${PREFIXE} .home-tile[data-held='true'] .home-tile__panel`)['border-color']).toBe(
      'var(--line-strong)'
    )
    expect(derniere(`${PREFIXE} .home-tile:focus-visible .home-tile__panel`)['border-color']).toBe(
      'var(--cyan)'
    )
  })

  it('laisse a Nebuleuse doree son cadre or qui coule : le bloc CADRE-CHANFREIN ne passe pas', async () => {
    const { genererMainDoree } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    expect(lire('./theme-nebuleuse-verre.css')).toMatch(BLOC_CHANFREIN)
    expect(genererMainDoree()).not.toMatch(/CADRE-CHANFREIN|--nv-chanfrein/)
  })
})

/**
 * PIED DE LISTE (2026-10-10, /draft, tour 2 : « le 3 comme apparence par defaut et le 2 au
 * survol, en gros au survol ca laisse qu'un bouton allume » ; tour 1 : « ils doivent pas
 * s'allumer », puis « texte blanc et liseré bleu et rose au survol »). Au repos, la CAPSULE
 * entiere porte un liseré bleu -> rose ; au survol, ce liseré redevient gris et SEULE la case
 * survolee porte le sien, jusqu'au bord de la capsule. Texte blanc, AUCUN fond qui s'allume :
 * ni au survol, ni quand un reglage quitte sa valeur par defaut.
 */
describe('Pied de liste : une capsule a liseré, une seule case au survol', () => {
  const PIED = `${PREFIXE} .conv-foot`
  const LISERE = 'linear-gradient(90deg, #3c6eeb, #e63ca0)'
  const regles = (): postcss.Rule[] => {
    const toutes: postcss.Rule[] = []
    postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((r) => {
      toutes.push(r)
    })
    return toutes
  }
  const decls = (selecteur: string): Record<string, string> => {
    const valeurs: Record<string, string> = {}
    for (const r of regles()) {
      if (!r.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) continue
      r.walkDecls((d) => {
        valeurs[d.prop] = d.value
      })
    }
    return valeurs
  }
  const anneau = (r: Record<string, string>): void => {
    expect(r.content).toBe("''")
    expect(r.position).toBe('absolute')
    expect(r['pointer-events']).toBe('none')
    expect(r['mask-composite']).toBe('exclude')
  }

  it('borde la capsule entiere du liseré bleu -> rose au repos', () => {
    const avant = decls(`${PIED}::before`)
    anneau(avant)
    expect(avant.background).toBe(LISERE)
    expect(decls(PIED).position).toBe('relative')
  })

  it('au survol, rend la capsule grise et ne borde que la case survolee', () => {
    expect(decls(`${PIED}:has(> button:hover)::before`).background).toBe('#2a2733')
    const caseSurvolee = decls(`${PIED} > button:hover::before`)
    expect(caseSurvolee.display).toBe('block')
    expect(decls(`${PIED} > button::before`).display).toBe('none')
    anneau(decls(`${PIED} > button::before`))
    expect(decls(`${PIED} > button::before`).background).toBe(LISERE)
    // La case suit le bord de la capsule : bouts arrondis aux extremites.
    expect(decls(`${PIED} > button:first-child`)['border-radius']).toBe('999px 0 0 999px')
    expect(decls(`${PIED} > button:last-child`)['border-radius']).toBe('0 999px 999px 0')
  })

  it('ecrit en blanc et n allume aucun fond, ni au survol ni pour un reglage change', () => {
    expect(decls(`${PIED} > button`).color).toBe('#ffffff')
    const fonds: string[] = []
    for (const r of regles()) {
      if (!r.selectors.some((s) => s.includes('.conv-foot >') && !s.includes('::'))) continue
      r.walkDecls(/^background/, (d) => {
        if (d.value !== 'transparent') fonds.push(`${r.selector} -> ${d.value}`)
      })
    }
    expect(fonds).toEqual([])
    // La couche generee voile la case Mosaique de rose avec un selecteur plus precis que
    // `.conv-foot > button` : la feuille ecrite a la main doit l'eteindre explicitement.
    expect(lire('./theme-nebuleuse-verre.genere.css')).toMatch(
      /\.conv-view-toggle\[aria-checked='true'\] \{\s*background:/
    )
    expect(decls(`${PIED} > .conv-view-toggle[aria-checked='true']`).background).toBe('transparent')
  })
})

/**
 * LES BANDEAUX DU HAUT DU CHAT EN PERLE D'OR (conv-179, 2026-10-10 : « les bandeaux en haut de chat
 * font pas dore ils font orange », puis « inspire-toi du bouton Perle envoyer »). ChatView.css les
 * peint en var(--warn) : l'or dans le theme par defaut, l'ambre #ffb547 ici -- mesure dans l'app
 * vivante, rgb(255, 181, 71). Le bandeau prend l'or de la perle d'Envoyer ; le jeton --warn du
 * theme reste l'ambre des ETATS (interrompu, refuse).
 */
describe('bandeaux du haut du chat en perle d or', () => {
  const BANDEAU = `${PREFIXE} .chat-workflow-notice`
  const NON_PUBLIE = `${PREFIXE} .chat-travail-non-publie`
  const decls = (css: string, selecteur: string): Record<string, string> => {
    const valeurs: Record<string, string> = {}
    postcss.parse(css).walkRules((regle) => {
      if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
      regle.walkDecls((d) => {
        valeurs[d.prop] = d.value
      })
    })
    return valeurs
  }

  it('prend l or de la perle, son reflet et son ombre noire courte', () => {
    const b = decls(lire('./theme-nebuleuse-verre.css'), BANDEAU)
    expect(b['--warn']).toBe('#e2b65a')
    expect(b.color).toBe('#e9c069')
    expect(b.border).toBe('1px solid rgba(226, 182, 90, 0.55)')
    expect(b.background).toMatch(
      /^radial-gradient\(ellipse [^)]*rgba\(255, 255, 255, [\d.]+\), rgba\(255, 255, 255, 0\)\),\s*linear-gradient\(180deg, rgba\(226, 182, 90, [\d.]+\), rgba\(162, 115, 38, [\d.]+\)\)$/
    )
    expect(b['box-shadow']).toBe('0 2px 3px rgba(0, 0, 0, 0.6)')
  })

  it('garde l ambre comme couleur d etat du theme', () => {
    expect(lire('./theme-nebuleuse-verre.css')).toContain('--warn: #ffb547;')
  })

  it('borde le bandeau « travail non publie » d or, texte inchange', () => {
    const n = decls(lire('./theme-nebuleuse-verre.css'), NON_PUBLIE)
    expect(n['border-left']).toBe('2px solid rgba(226, 182, 90, 0.85)')
    expect(n.color).toBe('rgba(232, 226, 214, 0.92)')
    expect(decls(lire('./theme-nebuleuse-verre.css'), `${NON_PUBLIE} button`).border).toBe(
      '1px solid rgba(226, 182, 90, 0.45)'
    )
    expect(
      decls(
        lire('./theme-nebuleuse-verre.css'),
        `${NON_PUBLIE} button.chat-travail-non-publie__fermer`
      )['border-color']
    ).toBe('transparent')
  })

  it('passe aussi dans Nebuleuse doree, a l identique', async () => {
    const { genererMainDoree } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    const derivee = genererMainDoree()
    const dore = decls(derivee, BANDEAU.replace('nebuleuse-verre', 'nebuleuse-doree'))
    expect(dore).toEqual(decls(lire('./theme-nebuleuse-verre.css'), BANDEAU))
  })
})

/**
 * ONGLETS DU PANNEAU DE DROITE EN LISERE (conv-180, 2026-10-10 : « remplace la capsule par un
 * liseré et enlève le liseré rose en dessous, du coup la capsule ça va pas bien avec le border
 * très angulaire »). Sous le cadre a coins coupes, l'onglet actif est souligne d'un trait de 2 px
 * bleu -> rose, sans pastille ; le filet rose sous la barre disparait. Le reglage vit DANS le bloc
 * CADRE-CHANFREIN : la doree, a coins arrondis, garde sa pastille.
 */
describe('Onglets du panneau de droite : un liseré au lieu de la capsule', () => {
  const ONGLETS = `${PREFIXE} .cosmic-outline .runs-pane`
  const dansLeBloc = (selecteur: string): Record<string, string> => {
    const bloc = lire('./theme-nebuleuse-verre.css').match(BLOC_CHANFREIN)?.[0] ?? ''
    const valeurs: Record<string, string> = {}
    postcss.parse(bloc).walkRules((regle) => {
      if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
      regle.walkDecls((d) => {
        valeurs[d.prop] = d.value
      })
    })
    return valeurs
  }

  it('souligne l onglet actif d un trait bleu -> rose de 2 px, sans pastille ni lueur', () => {
    const actif = dansLeBloc(`${ONGLETS} .workflow-section-tab.is-active`)
    expect(actif['border-radius']).toBe('0')
    expect(actif['box-shadow']).toBe('none')
    expect(actif['background-size']).toBe('100% 2px')
    expect(actif['background-position']).toBe('center bottom')
    expect(actif['background-image']).toBe('linear-gradient(90deg, #3c6eeb, #e63ca0)')
    expect(dansLeBloc(`${ONGLETS} .workflow-section-tab:hover`)['border-radius']).toBe('0')
  })

  it('retire le filet rose sous la barre d onglets', () => {
    expect(dansLeBloc(`${ONGLETS} .workflow-panel-head`)['border-image']).toBe('none')
  })

  it('laisse a Nebuleuse doree sa pastille : rien de ce reglage ne passe dans la derivation', async () => {
    const { genererMainDoree } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    expect(genererMainDoree()).not.toContain('.runs-pane .workflow-section-tab')
  })
})

/**
 * PIED DE LISTE : UN SEUL TRAIT EN HAUT (conv-190, 2026-10-10 : « dans ce bloc de buttons en fait
 * laisse qu'un liseré top », sur la capsule a coins coupes posee par conv-188). Sous le cadre
 * coupe, le pied n'a plus ni cotes, ni bas, ni coins coupes, ni filets entre les cases : un trait
 * d'1 px en haut, bleu -> rose au repos. Au survol, ce trait redevient gris (regle de base du pied)
 * et seule la portion au-dessus de la case survolee reprend le bleu -> rose. Le reglage vit DANS le
 * bloc du chanfrein : Nebuleuse doree garde sa capsule entiere.
 */
describe('Pied de liste sous le cadre coupe : un seul trait en haut', () => {
  const PIED = `${PREFIXE} .cosmic-outline .conv-pane .conv-foot`
  const dansLeBloc = (selecteur: string): Record<string, string> => {
    const bloc = lire('./theme-nebuleuse-verre.css').match(BLOC_CHANFREIN)?.[0] ?? ''
    const valeurs: Record<string, string> = {}
    postcss.parse(bloc).walkRules((regle) => {
      if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
      regle.walkDecls((d) => {
        valeurs[d.prop] = d.value.replace(/\s+/g, ' ')
      })
    })
    return valeurs
  }

  it('retire la forme du pied : ni coins coupes ni bouts ronds', () => {
    const pied = dansLeBloc(PIED)
    expect(pied['border-radius']).toBe('0')
    expect(pied['clip-path']).toBe('none')
    for (const bout of ['first-child', 'last-child']) {
      expect(dansLeBloc(`${PIED} > button:${bout}`)['border-radius'], bout).toBe('0')
    }
  })

  it('reduit le liseré du pied et celui de la case survolee a une bande d 1 px collee en haut', () => {
    for (const couche of [`${PIED}::before`, `${PIED} > button::before`]) {
      const trait = dansLeBloc(couche)
      expect(trait.inset, couche).toBe('0 0 auto')
      expect(trait.height, couche).toBe('1px')
      expect(trait.padding, couche).toBe('0')
      expect(trait.mask, couche).toBe('none')
      expect(trait['clip-path'], couche).toBe('none')
    }
  })

  it('efface les filets verticaux entre les cases', () => {
    expect(dansLeBloc(`${PIED} > button:not(:first-child)`)['border-left']).toBe('0')
  })

  it('ne laisse aucun reste de la coupe : plus de polygone dans le pied', () => {
    const bloc = lire('./theme-nebuleuse-verre.css').match(BLOC_CHANFREIN)?.[0] ?? ''
    expect(bloc).not.toContain('--nv-pied-coupe')
  })

  it('laisse a Nebuleuse doree sa capsule entiere : le trait seul ne passe pas dans la derivation', async () => {
    const { genererMainDoree } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    expect(genererMainDoree()).not.toContain('.cosmic-outline .conv-pane .conv-foot')
  })
})

/**
 * UN SEUL BLEU DANS LES DEGRADES (conv-182, 2026-10-10). L'utilisateur : « j'ai l'impression que tu
 * utilises jamais le meme bleu pour les degrades », puis « Le meme bleu plein partout — le repos
 * s'attenue autrement (texte, reflet), pas la couleur ». Mesure dans l'app : un seul #3c6eeb, mais
 * peint a 100 %, 85 % (degrade signature, bulles), 55 % (bord des capsules au repos) et 45 % (rond
 * d'icone au repos) -- quatre bleus a l'ecran. ENTREE QUI DOIT FAIRE ECHOUER CE TEST : remettre
 * `rgba(60, 110, 235, 0.85)` dans un degrade, un `color-mix(... --capsule-froid N%, transparent)`
 * dans un degrade, ou une `opacity` sur le calque du bord des capsules ou de l'oeil.
 */
describe('Degrades : un seul bleu, toujours plein', () => {
  const fichiers = [
    './theme-nebuleuse-verre.css',
    './cosmic-outline.css',
    '../components/ChatView.css',
    '../components/UpdateBanner.css'
  ]

  it('ne dilue jamais le bleu dans un degrade', () => {
    const dilues: string[] = []
    for (const fichier of fichiers) {
      postcss.parse(lire(fichier)).walkDecls((d) => {
        if (!/gradient\(/.test(d.value)) return
        const bleuTransparent = /rgba\(\s*60,\s*110,\s*235,\s*0?\.\d+\s*\)/.test(d.value)
        const froidMelange = /color-mix\([^)]*--capsule-froid\)\s*\d+%\s*,\s*transparent/.test(
          d.value
        )
        if (bleuTransparent || froidMelange) dilues.push(`${fichier} ${d.prop}: ${d.value}`)
      })
    }
    expect(dilues).toEqual([])
  })

  it('n’eteint pas le bord degrade des capsules ni de l’oeil au repos', () => {
    const eteints: string[] = []
    for (const fichier of ['../components/ChatView.css', '../components/UpdateBanner.css']) {
      postcss.parse(lire(fichier)).walkRules((regle) => {
        const bord = regle.selectors.some((s) =>
          /(\.thinking-capsule|\.rail-update-who)[^,]*::before\s*$/.test(s.trim())
        )
        if (!bord) return
        regle.walkDecls('opacity', (d) => {
          eteints.push(`${fichier} ${regle.selector} opacity: ${d.value}`)
        })
      })
    }
    expect(eteints).toEqual([])
  })

  it('marque le survol du bouton d’accent par le reflet, pas par un bleu plus vif', () => {
    const racine: Record<string, string> = {}
    postcss.parse(lire('./theme-nebuleuse-verre.css')).walkDecls((d) => {
      if (d.prop.startsWith('--nv-degrade')) racine[d.prop] = d.value.replace(/\s+/g, ' ').trim()
    })
    expect(racine['--nv-degrade']).toBe('linear-gradient(135deg, #3c6eeb, #e63ca0)')
    expect(racine['--nv-degrade-survol']).toMatch(/^radial-gradient\(/)
    expect(racine['--nv-degrade-survol']).toContain('linear-gradient(135deg, #3c6eeb, #e63ca0)')
  })
})
