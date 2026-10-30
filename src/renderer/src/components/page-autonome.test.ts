// @vitest-environment happy-dom
/*
 * « ENREGISTRER EN .HTML » (conv-1304) — ce que le fichier emporte. Verrouille surtout ce qui ne se
 * voit pas a l'oeil : le fichier reste hors ligne, et sa politique passe AVANT tout script (une
 * politique posee apres n'arrete pas ce qui a deja tourne). Le rendu du fichier dans un vrai
 * navigateur est joue par amorce.page.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { POLITIQUE_PAGE_AUTONOME, pageAutonome, pageUtiliseGraphiques } from './page-autonome'
import { nomFichierDePage, titreDePage, extraitDeLErreur } from './page-interactive'

const theme = {
  variables: { '--text': '#fff', '--bg-0': '#101014', '--gold-clair': '#e0b85c' },
  colorScheme: 'dark'
}
const enregistrer = (html: string, ressources = { moteur: '', graphiques: '' }): string =>
  pageAutonome({ html, style: '.aw-ok{color:var(--ok)}', theme, titre: 'Ma page', ressources })

const relire = (fichier: string): Document => new DOMParser().parseFromString(fichier, 'text/html')

describe('pageAutonome', () => {
  it('garde le fichier hors ligne : la politique passe avant le premier script', () => {
    const fichier = enregistrer('<script>fetch("https://exemple.test")</script>')
    const politique = fichier.indexOf('Content-Security-Policy')
    expect(politique).toBeGreaterThan(0)
    expect(politique).toBeLessThan(fichier.indexOf('<script'))
    expect(POLITIQUE_PAGE_AUTONOME).toContain("connect-src 'none'")
    expect(POLITIQUE_PAGE_AUTONOME).toContain("default-src 'none'")
  })

  it('emporte la feuille de base et le theme du moment, fond compris', () => {
    const fichier = enregistrer('<p>x</p>')
    expect(fichier).toContain('.aw-ok{color:var(--ok)}')
    expect(fichier).toContain('--gold-clair:#e0b85c')
    expect(fichier).toContain('background:#101014')
    expect(fichier).toContain('color-scheme:dark')
    expect(relire(fichier).documentElement.getAttribute('data-mode')).toBe('page')
  })

  it('retire ce qui ferait sortir la page : base, feuille externe, redirection', () => {
    const doc = relire(
      enregistrer(
        '<base href="https://x.test/"><link rel="stylesheet" href="https://x.test/a.css">' +
          '<meta http-equiv="refresh" content="0;url=https://x.test/"><p>x</p>'
      )
    )
    expect(doc.querySelector('base')).toBeNull()
    expect(doc.querySelector('link')).toBeNull()
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull()
  })

  it('n emporte le moteur et la boite a outils que si la page s en sert', () => {
    const ressources = { moteur: 'window.MOTEUR=1', graphiques: '(()=>()=>1)();' }
    const sans = enregistrer('<p>x</p>', { moteur: '', graphiques: ressources.graphiques })
    expect(sans).not.toContain('autowin.graphique =')
    const avec = enregistrer('<script>autowin.graphique("#z", {})</script>', ressources)
    expect(avec).toContain('autowin.graphique = (()=>()=>1)();')
    expect(avec).toContain('window.MOTEUR=1')
    // Le moteur et la boite a outils tournent AVANT les scripts de la page.
    expect(avec.indexOf('window.MOTEUR=1')).toBeLessThan(avec.indexOf('autowin.graphique("#z"'))
  })

  it('garde le titre de la page, ou lui en donne un', () => {
    expect(relire(enregistrer('<p>x</p>')).title).toBe('Ma page')
    expect(relire(enregistrer('<title>Le mien</title><p>x</p>')).title).toBe('Le mien')
  })

  it('reconnait un appel a la boite a outils, pas un mot voisin', () => {
    expect(pageUtiliseGraphiques('autowin.graphique("#a", {})')).toBe(true)
    expect(pageUtiliseGraphiques('autowin . graphique("#a", {})')).toBe(true)
    expect(pageUtiliseGraphiques('<p>graphique</p>')).toBe(false)
  })
})

describe('le nom d une page', () => {
  it('prend le titre, puis un intertitre, puis un kicker, sans lire le code', () => {
    expect(titreDePage('<title>Budget</title><h1>Autre</h1>')).toBe('Budget')
    expect(titreDePage('<p>x</p><h2>Mon <b>épargne</b></h2>')).toBe('Mon épargne')
    expect(titreDePage('<div class="aw-kicker">Ventes 2026</div>')).toBe('Ventes 2026')
    expect(titreDePage('<script>const t = "<h1>piège</h1>"</script><p>x</p>')).toBe('')
  })

  it('propose un nom de fichier que Windows accepte', () => {
    expect(nomFichierDePage('<h1>Épargne : 15 ans / 2,5 %</h1>')).toBe('Épargne-15-ans-2-5.html')
    expect(nomFichierDePage('<p>sans titre</p>')).toBe('page-interactive.html')
  })
})

describe('extraitDeLErreur', () => {
  const html = 'un\n  deux = 2\ntrois'

  it('retrouve la ligne de code designee par l erreur', () => {
    expect(extraitDeLErreur(html, 'Boum (ligne 2 du bloc)')).toEqual({
      ligne: 2,
      code: 'deux = 2'
    })
  })

  it('ne devine rien sans numero de ligne, ni au-dela du bloc', () => {
    expect(extraitDeLErreur(html, 'Boum')).toBeNull()
    expect(extraitDeLErreur(html, 'Boum (ligne 99 du bloc)')).toBeNull()
  })
})
