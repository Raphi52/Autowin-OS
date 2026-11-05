# Sculpture du PANDA GÉANT en feutrine (conv-1540, lot 1 du plan de conv-1537), d'après la description du plan : corps et
# tête blancs, oreilles rondes, taches des yeux, pattes et épaules noires, petite queue blanche ; gilet sans manches vert
# bambou ouvert sur un plastron blanc, deux boutons de bois.
# Copie de renard.py (conv-1448), elle-même copie de conv-1421/gen/d3/tanuki.py : MÊME squelette (OS), mêmes poids aux
# articulations, même semelle au sol — seules les formes et les couleurs changent. Toutes les poses du tanuki s'appliquent
# donc telles quelles, et les pieds tombent au même point d'ancrage.
# v3 (conv-1558, « bring the fox, panda and red panda up to v3 quality ») : mêmes formes et mêmes couleurs, grille FIN fois
# plus fine, et le canal G dit la matière au rendu (pelage et longueur du poil, feutre du visage, tissu, bois, perles).
# Usage : FIN=3 python -I panda-v3.py 1500000 b3d/panda-v3-hd.json   (fabriquer-atlas.sh avec ANIMAL=panda)
import base64, gzip, json, os, sys
import numpy as np
from skimage.measure import marching_cubes
import fast_simplification

CIBLE = int(sys.argv[1]) if len(sys.argv) > 1 else 3200    # sommets au total
SORTIE = sys.argv[2] if len(sys.argv) > 2 else 'b3d/panda-hd.json'
# v3 (conv-1558) : FIN affine la grille de chaque partie (3 pour l'atlas, avec 1 500 000 sommets), comme tanuki-v3.py.
FIN = float(os.environ.get('FIN', 1))
# Le canal G dit la MATIÈRE au rendu (sprite-atlas-v3.py) : G < .11 pelage, G y code la longueur du poil (1 - 8·G) ;
# .12 feutre ras (visage peint) ; .25 tissu tissé ; .5 mat (cuir, bois, traits) ; 1 perle (yeux, nez).
G_FEUTRE, G_TISSU, G_MAT, G_PERLE = .12, .25, .5, 1.0


def g_poil(f):
    """Longueur relative du poil (0,14 à 1) → valeur du canal G. Seule la queue prend 1 (G = 0) : queue-effilee.py la
    reconnaît à ce zéro."""
    return (1 - np.clip(f, .14, 1)) / 8


def cst(g):
    return lambda P: np.full(len(P), g)


def L(v):
    return np.sqrt((v * v).sum(-1))


def ell(P, c, r):
    c = np.array(c, float); r = np.array(r, float)
    k0 = L((P - c) / r); k1 = L((P - c) / (r * r))
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)


def cap(P, a, b, ra, rb=None):
    rb = ra if rb is None else rb
    a = np.array(a, float); b = np.array(b, float)
    pa = P - a; ba = b - a
    t = np.clip((pa * ba).sum(-1) / (ba * ba).sum(), 0, 1)
    return L(pa - t[..., None] * ba) - (ra + (rb - ra) * t)


def smin(a, b, k):
    h = np.clip(.5 + .5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def bosses(P, a=.0035):
    # La laine feutrée n'est jamais lisse : de petites bosses irrégulières, à la main.
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    return a * (np.sin(x * 61 + y * 23) * np.sin(y * 57 + z * 31) + .6 * np.sin(z * 83 + x * 37) * np.sin(y * 71 - x * 19))


def tache(P, f=38.0):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    n = np.sin(x * f + 1.3 * np.sin(y * f * .7)) * np.sin(y * f * 1.1 + 1.7 * np.sin(z * f * .8)) * np.sin(z * f * .9 + 1.1 * np.sin(x * f * .6))
    return n


def mel(a, b, t):
    t = np.clip(t, 0, 1)[..., None]
    return np.array(a) * (1 - t) + np.array(b) * t


C = dict(
    blanc=(.92, .91, .87), blancF=(.80, .79, .75), noir=(.035, .03, .03),
    # Le noir du pelage reste un anthracite : un noir pur effacerait tout le volume de la feutrine.
    noirP=(.05, .045, .05), noirC=(.10, .093, .095),
    vert=(.38, .60, .15), vertF=(.22, .40, .07), vertC=(.55, .73, .24),
    bois=(.52, .32, .14),
)


# --- Parties du panda : même squelette, mêmes articulations que le tanuki, autre bête et autre costume ------------------
def d_museau(P):
    # Le museau court et rond du panda, posé bas sur la face.
    return ell(P, (0, .662, .112), (.088, .062, .074))


def d_joue(P, s):
    # De bonnes joues rondes qui élargissent le bas de la face.
    return ell(P, (s * .098, .675, .045), (.088, .072, .09))


def d_tete(P):
    d = ell(P, (0, .73, 0), (.17, .152, .158))
    for s in (-1, 1):
        d = smin(d, d_joue(P, s), .04)
    d = smin(d, d_museau(P), .04)
    d = smin(d, ell(P, (0, .615, .0), (.105, .05, .1)), .04)   # sous le menton
    # Bosses deux fois plus douces que chez le renard : sur la laine blanche, les mêmes creux faisaient une boule cabossée
    # (témoin m90-2, conv-1540) ; le roux les cachait.
    return d + bosses(P, .0017)


def tache_oeil(P, s):
    # La tache noire autour de l'œil, en goutte penchée : du haut vers l'intérieur au bas vers l'extérieur.
    q = P[:, :2] - np.array([s * .086, .733])
    a = q @ np.array([s * .55, -.835])
    b = q @ np.array([.835, s * .55])
    return np.sqrt((a / .056) ** 2 + (b / (.036 + .25 * np.clip(a, 0, .04))) ** 2)


def c_tete(P):
    n = tache(P) * .5 + .5
    o = mel(C['blanc'], C['blancF'], n * .55)
    noir = mel(C['noirP'], C['noirC'], n)
    face = np.clip((P[:, 2] - .05) * 30, 0, 1)
    for s, (c, _) in zip((1, -1), YEUX):
        k = np.clip((1 - tache_oeil(P, s) + .04 * (n - .5)) * 14, 0, 1) * face
        o = mel(o, noir, k)
        # Un fin cerclage clair autour de la perle : sans lui, l'œil noir disparaît dans la tache noire.
        r = L((P - np.array(c)) / np.array([1, 1, 1.3]))
        o = mel(o, C['blancF'], np.clip(1 - np.abs(r - .031) * 160, 0, 1) * face)
    return o


def d_oreille(P, s):
    # L'oreille ronde et épaisse du panda, un peu aplatie d'avant en arrière, le creux tourné vers l'avant.
    # Le haut reste sous y ≈ 1,0 : plus haut, il sortirait de la case vue de dos (pinceau, marteau).
    d = ell(P, (s * .122, .872, -.028), (.06, .058, .034))
    d = smax(d, -ell(P, (s * .126, .874, .012), (.034, .034, .018)), .01)
    return d + bosses(P, .0022)


def c_oreille(s):
    def f(P):
        n = tache(P) * .5 + .5
        return mel(C['noirP'], C['noirC'], n)
    return f


def d_torse(P):
    d = ell(P, (0, .405, 0), (.152, .135, .125))
    d = smin(d, cap(P, (0, .42, -.005), (0, .56, -.012), .128, .098), .05)
    d = smin(d, ell(P, (0, .335, 0), (.162, .05, .138)), .03)    # basque du gilet
    return d + bosses(P)


def col(P):
    a = cap(P, (-.082, .587, .068), (.022, .452, .128), .016, .022)
    b = cap(P, (.082, .587, .068), (-.022, .452, .128), .016, .022)
    return np.minimum(a, b)


def d_torse2(P):
    return smin(d_torse(P), col(P), .012)


def tissu(P):
    n = tache(P, 46) * .5 + .5
    n2 = tache(P * 1.7 + 3, 58) * .5 + .5
    o = mel(C['vertF'], C['vert'], .35 + n * 1.1)
    return mel(o, C['vertC'], (n2 - .7) * 4)


def c_torse(P):
    o = tissu(P)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    # Le plastron blanc dans le V du gilet ouvert.
    v = (y - .452) * .56 - np.abs(x)
    n = tache(P * 2.3, 70)
    o = np.where(((v + .006 * n)[..., None] > 0) & (z[:, None] > .05), mel(C['blanc'], C['blancF'], n * .5 + .5), o)
    # Les emmanchures : le gilet n'a pas de manches, les épaules noires du panda passent dessous.
    e = (np.abs(x) - .128) * 90 + (y - .44) * 25
    o = mel(o, mel(C['noirP'], C['noirC'], n * .5 + .5), e)
    k = col(P)
    o = mel(o, C['vertF'], (.012 - k) * 240)                  # le liseré du gilet
    # Deux boutons de bois sous le V.
    for yb in (.414, .368):
        b = np.sqrt(x ** 2 + (y - yb) ** 2)
        o = mel(o, C['bois'], (.0135 - b) * 400 * (z > .08))
    return o


def d_ceinture(P):
    # L'ourlet du gilet, à la taille : il tient la jonction avec les jambes comme la ceinture du tanuki.
    q = np.sqrt((P[:, 0] / .166) ** 2 + (P[:, 2] / .141) ** 2) * .15
    d = np.sqrt((q - .15) ** 2 + ((P[:, 1] - .318) * .68) ** 2) - .024
    return d + bosses(P, .002)


def c_ceinture(P):
    return mel(tissu(P), C['vertF'], .55)


def pelage_noir(P):
    n = tache(P) * .5 + .5
    return mel(C['noirP'], C['noirC'], n)


def d_jambe(P, s):
    d = ell(P, (s * .087, .208, .0), (.112, .118, .118))
    d = smin(d, ell(P, (s * .03, .265, 0), (.11, .06, .115)), .03)
    d = smax(d, .092 - P[:, 1], .012)
    return d + bosses(P)


def c_jambe(P):
    return pelage_noir(P)


def d_chaussette(P, s):
    return cap(P, (s * .09, .118, 0), (s * .09, .048, .004), .05, .044) + bosses(P, .0015)


def d_pied(P, s):
    # Une patte noire, arrondie, posée à plat : la semelle touche le sol exactement comme celle du tanuki.
    d = ell(P, (s * .09, .036, .036), (.05, .036, .082))
    d = np.minimum(d, ell(P, (s * .09, .0135, .04), (.054, .0135, .094)))
    return d


def c_pied(s):
    def f(P):
        n = tache(P, 60) * .5 + .5
        return mel(C['noirP'], C['noirC'], n)
    return f


def d_manche(P, s):
    # Le bras noir, nu : le gilet n'a pas de manches. Un peu plus fin que la manche du renard, même chemin.
    d = cap(P, (s * .118, .535, -.005), (s * .178, .432, .0), .068, .078)
    d = smin(d, cap(P, (s * .178, .432, .0), (s * .226, .338, .012), .078, .086), .025)
    d = smax(d, ((P[:, 0] - s * .226) * s * .35 + (.325 - P[:, 1])), .012)
    return d + bosses(P)


def c_manche(s):
    def f(P):
        return pelage_noir(P)
    return f


def d_patte(P, s):
    d = cap(P, (s * .205, .365, .01), (s * .228, .315, .018), .04)
    return smin(d, ell(P, (s * .236, .295, .022), (.042, .046, .044)), .02) + bosses(P, .002)


def c_patte(s):
    def f(P):
        n = tache(P, 60) * .5 + .5
        return mel(C['noirP'], C['noirC'], n)
    return f


def d_queue(P):
    # La petite queue ronde et blanche du panda, en haut des cuisses : elle ne suit que le premier os de la queue.
    return ell(P, (0, .3, -.128), (.048, .046, .04)) + bosses(P, .003)


def c_queue(P):
    n = tache(P) * .5 + .5
    return mel(C['blanc'], C['blancF'], n * .6)


def uni(c):
    return lambda P: np.tile(np.array(c), (len(P), 1))


def perle(P, l):
    d = 1e9
    for c, r in l:
        d = np.minimum(d, ell(P, c, r))
    return d


YEUX = [((.079, .748, .1405), (.024, .025, .02)), ((-.079, .748, .1405), (.024, .025, .02))]
# La truffe, sur le haut du museau rond (la surface y est à z ≈ 0,177).
NEZ = [((0, .692, .181), (.03, .02, .018))]

PARTIES = [
    dict(n='tete', b=((-.26, .57, -.2), (.26, .9, .29)), d=d_tete, c=c_tete, pas=.0105, gl=0, part=.25),
    dict(n='oG', b=((.0, .77, -.1), (.23, 1.06, .05)), d=lambda P: d_oreille(P, 1), c=c_oreille(1), pas=.0075, gl=0, part=.045),
    dict(n='oD', b=((-.23, .77, -.1), (.0, 1.06, .05)), d=lambda P: d_oreille(P, -1), c=c_oreille(-1), pas=.0075, gl=0, part=.045),
    dict(n='yeux', b=((-.11, .71, .11), (.11, .78, .17)), d=lambda P: perle(P, YEUX), c=uni(C['noir']), pas=.0045, gl=1, part=.02),
    dict(n='nez', b=((-.05, .66, .15), (.05, .72, .21)), d=lambda P: perle(P, NEZ), c=uni(C['noir']), pas=.0045, gl=1, part=.012),
    dict(n='torse', b=((-.19, .25, -.16), (.19, .66, .17)), d=d_torse2, c=c_torse, pas=.0105, gl=0, part=.2),
    dict(n='ceinture', b=((-.19, .25, -.17), (.19, .37, .19)), d=d_ceinture, c=c_ceinture, pas=.0075, gl=0, part=.06),
    dict(n='jG', b=((-.04, .07, -.14), (.21, .34, .14)), d=lambda P: d_jambe(P, 1), c=c_jambe, pas=.0105, gl=0, part=.075),
    dict(n='jD', b=((-.21, .07, -.14), (.04, .34, .14)), d=lambda P: d_jambe(P, -1), c=c_jambe, pas=.0105, gl=0, part=.075),
    dict(n='cG', b=((.02, .03, -.07), (.16, .14, .07)), d=lambda P: d_chaussette(P, 1), c=c_pied(1), pas=.01, gl=0, part=.012),
    dict(n='cD', b=((-.16, .03, -.07), (-.02, .14, .07)), d=lambda P: d_chaussette(P, -1), c=c_pied(-1), pas=.01, gl=0, part=.012),
    dict(n='pG', b=((.02, -.01, -.08), (.16, .09, .15)), d=lambda P: d_pied(P, 1), c=c_pied(1), pas=.0055, gl=0, part=.028),
    dict(n='pD', b=((-.16, -.01, -.08), (-.02, .09, .15)), d=lambda P: d_pied(P, -1), c=c_pied(-1), pas=.0055, gl=0, part=.028),
    dict(n='mG', b=((.03, .3, -.13), (.34, .63, .14)), d=lambda P: d_manche(P, 1), c=c_manche(1), pas=.0095, gl=0, part=.05),
    dict(n='mD', b=((-.34, .3, -.13), (-.03, .63, .14)), d=lambda P: d_manche(P, -1), c=c_manche(-1), pas=.0095, gl=0, part=.05),
    dict(n='aG', b=((.14, .23, -.05), (.3, .4, .08)), d=lambda P: d_patte(P, 1), c=c_patte(1), pas=.0075, gl=0, part=.012),
    dict(n='aD', b=((-.3, .23, -.05), (-.14, .4, .08)), d=lambda P: d_patte(P, -1), c=c_patte(-1), pas=.0075, gl=0, part=.012),
    dict(n='queue', b=((-.08, .22, -.2), (.08, .38, -.06)), d=d_queue, c=c_queue, pas=.006, gl=0, part=.02),
]

OS = [('hanches', -1, 0, .3, 0), ('buste', 0, 0, .37, 0), ('tete', 1, 0, .6, 0), ('oG', 2, .095, .85, -.03), ('oD', 2, -.095, .85, -.03),
      ('epG', 1, .122, .535, 0), ('coG', 5, .178, .432, 0), ('epD', 1, -.122, .535, 0), ('coD', 7, -.178, .432, 0),
      ('cuG', 0, .087, .28, 0), ('tiG', 9, .09, .185, 0), ('piG', 10, .09, .068, 0), ('cuD', 0, -.087, .28, 0), ('tiD', 12, -.09, .185, 0), ('piD', 13, -.09, .068, 0),
      ('q1', 0, 0, .275, -.11), ('q2', 15, 0, .258, -.235), ('q3', 16, 0, .262, -.33)]
IO = {o[0]: i for i, o in enumerate(OS)}


def fondu(v, a, b):
    return np.clip((v - a) / (b - a), 0, 1)


def poids(n, P):
    N = len(P)
    a = np.zeros(N, int); b = np.zeros(N, int); w = np.ones(N)    # w = poids de a
    y = P[:, 1]

    def deux(ba, bb, t):
        a[:] = IO[ba]; b[:] = IO[bb]; w[:] = 1 - t

    if n in ('tete', 'yeux', 'nez', 'mo'):
        a[:] = b[:] = IO['tete']
    elif n in ('oG', 'oD'):
        deux('tete', n, fondu(y, .84, .885))
    elif n == 'torse':
        deux('hanches', 'buste', fondu(y, .35, .43))
    elif n == 'ceinture':
        a[:] = b[:] = IO['hanches']
    elif n in ('jG', 'jD'):
        s = n[1]
        # Le haut du pantalon reste à la taille, le bas suit le genou.
        t = fondu(y, .135, .2)
        a[:] = IO['ti' + s]; b[:] = IO['cu' + s]; w[:] = 1 - t
        hh = fondu(y, .25, .31)
        a[hh > 0] = IO['cu' + s]; b[hh > 0] = IO['hanches']; w[hh > 0] = 1 - hh[hh > 0]
    elif n in ('cG', 'cD'):
        s = n[1]
        deux('pi' + s, 'ti' + s, fondu(y, .06, .1))
    elif n in ('pG', 'pD'):
        a[:] = b[:] = IO['pi' + n[1]]
    elif n in ('mG', 'mD'):
        s = n[1]
        q = np.array([.178 if s == 'G' else -.178, .432, 0])
        v = np.array([.056 if s == 'G' else -.056, -.103, 0]); v /= np.linalg.norm(v)
        t = fondu(((P - q) * v).sum(-1), -.03, .03)
        a[:] = IO['ep' + s]; b[:] = IO['co' + s]; w[:] = 1 - t
        # L'épaule ne décolle pas du buste.
        h = fondu(y, .52, .565) * fondu(np.abs(P[:, 0]), .165, .1)
        o = h > 0
        b[o] = IO['buste']; a[o] = IO['ep' + s]; w[o] = 1 - h[o]
    elif n in ('aG', 'aD'):
        a[:] = b[:] = IO['co' + n[1]]
    elif n == 'queue':
        z = -P[:, 2]
        t1 = fondu(z, .19, .26); t2 = fondu(z, .3, .36)
        a[:] = IO['q1']; b[:] = IO['q2']; w[:] = 1 - t1
        o = t2 > 0
        a[o] = IO['q2']; b[o] = IO['q3']; w[o] = 1 - t2[o]
    return a, b, w


# --- Matières v3 du panda (conv-1558) : pelage noir et blanc, feutre du visage, tissu du gilet, boutons de bois -----
def g_tete(P):
    # Feutre ras sur les taches des yeux et le museau, là où les traits se lisent (leçon du tanuki v3) ; poil autour,
    # court sur le devant, plus long sur le crâne.
    c = c_tete(P)
    devant = P[:, 2] > .05
    museau = (P[:, 1] < .7) & (P[:, 2] > .12) & (np.abs(P[:, 0]) < .09)
    peint = devant & ((c.mean(1) < .25) | museau)
    return np.where(peint, G_FEUTRE, g_poil(np.where(P[:, 2] > .08, .35, .7)))


def g_torse(P):
    # Le plastron blanc et les épaules noires qui passent sous les emmanchures sont du pelage ; les deux boutons, du bois ;
    # le reste, le tissu du gilet.
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    v = (y - .452) * .56 - np.abs(x)
    n = tache(P * 2.3, 70)
    g = np.where((v + .006 * n > 0) & (z > .05), g_poil(.5), G_TISSU)
    g = np.where((np.abs(x) - .128) * 90 + (y - .44) * 25 > .5, g_poil(.5), g)
    for yb in (.414, .368):
        g = np.where((np.sqrt(x ** 2 + (y - yb) ** 2) < .0135) & (z > .08), G_MAT, g)
    return g


# Le gilet n'a pas de manches : les bras sont du pelage noir. Les pieds restent ras (poil sous la ligne de sol sinon).
MATIERE = dict(tete=g_tete, oG=cst(g_poil(.45)), oD=cst(g_poil(.45)), yeux=cst(G_PERLE), nez=cst(G_PERLE), torse=g_torse,
               ceinture=cst(G_TISSU), jG=cst(g_poil(.3)), jD=cst(g_poil(.3)), cG=cst(g_poil(.25)), cD=cst(g_poil(.25)),
               pG=cst(G_FEUTRE), pD=cst(G_FEUTRE), mG=cst(g_poil(.4)), mD=cst(g_poil(.4)), aG=cst(g_poil(.4)),
               aD=cst(g_poil(.4)), queue=cst(g_poil(1)))


def sculpte(p):
    (x0, y0, z0), (x1, y1, z1) = p['b']
    st = p['pas'] / FIN
    xs = np.arange(x0, x1, st); ys = np.arange(y0, y1, st); zs = np.arange(z0, z1, st)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    G = np.stack([X, Y, Z], -1)
    v = p['d'](G.reshape(-1, 3)).reshape(X.shape)
    V, F, _, _ = marching_cubes(v, 0, spacing=(st, st, st))
    V = V + np.array([x0, y0, z0])
    # Le sens des faces de marching_cubes convient déjà à un champ négatif dedans.
    but = max(40, int(CIBLE * p['part']))
    if len(V) > but:
        V, F = fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), target_count=but * 2)
    return V.astype(float), F


def normales(fd, P, e=.0035):
    n = np.zeros_like(P)
    for i in range(3):
        d = np.zeros(3); d[i] = e
        n[:, i] = fd(P + d) - fd(P - d)
    return n / np.maximum(L(n)[..., None], 1e-9)


def toutes(P):
    d = 1e9
    for p in PARTIES:
        d = np.minimum(d, p['d'](P))
    return d


def bouche():
    # Le sourire : de petits tubes sous la truffe, posés juste sur la surface du museau rond. Pas de moustaches.
    V, F = [], []

    def surf(x, y):
        k = 1 - (x / .088) ** 2 - ((y - .662) / .062) ** 2
        return .112 + .074 * np.sqrt(max(k, 0)) + .0012

    def tube(a, b, r):
        a = np.array(a, float); b = np.array(b, float)
        d = b - a; d /= np.linalg.norm(d)
        u = np.cross(d, [0, 1, 0.3]); u /= np.linalg.norm(u)
        w = np.cross(d, u)
        n0 = len(V)
        for c in (a, b):
            for k in range(3):
                t = k * 2 * np.pi / 3
                V.append(c + r * (np.cos(t) * u + np.sin(t) * w))
        for k in range(3):
            q = (k + 1) % 3
            F.extend([[n0 + k, n0 + q, n0 + 3 + q], [n0 + k, n0 + 3 + q, n0 + 3 + k]])

    def pt(x, y):
        return (x, y, surf(x, y))

    tube(pt(0, .675), pt(0, .652), .0034)
    for s in (-1, 1):
        tube(pt(0, .652), pt(s * .017, .646), .0034)
        tube(pt(s * .017, .646), pt(s * .03, .653), .0034)
    return np.array(V), np.array(F)


Vs, Ns, Cs, Gs, Fs, Ba, Bb, Bw = [], [], [], [], [], [], [], []
n0 = 0
for p in PARTIES:
    V, F = sculpte(p)
    N = normales(p['d'], V)
    c = p['c'](V)
    # Occlusion : la marionnette s'assombrit dans ses creux (col, sous le menton, entre les jambes).
    ao = np.zeros(len(V))
    for i, h in enumerate((.012, .026, .05, .08)):
        ao += np.clip((h - toutes(V + N * h)) / h, 0, 1) * (.5 ** i)
    ao = 1 - np.clip(ao * .55, 0, .72)
    c = np.clip(c, 0, 1) * ao[..., None]
    a, b, w = poids(p['n'], V)
    Vs.append(V); Ns.append(N); Cs.append(c); Gs.append(MATIERE[p['n']](V)); Fs.append(F + n0); Ba.append(a); Bb.append(b); Bw.append(w)
    n0 += len(V)
    print(p['n'], len(V), len(F))
V, F = bouche()
Vs.append(V)
n = V - V.mean(0)
Ns.append(n / L(n)[..., None]); Cs.append(np.tile(np.array(C['noir']), (len(V), 1))); Gs.append(np.full(len(V), G_MAT)); Fs.append(F + n0)
Ba.append(np.full(len(V), IO['tete'])); Bb.append(np.full(len(V), IO['tete'])); Bw.append(np.ones(len(V)))
V = np.vstack(Vs); N = np.vstack(Ns); Co = np.vstack(Cs); G = np.concatenate(Gs); F = np.vstack(Fs); Ba = np.concatenate(Ba); Bb = np.concatenate(Bb); Bw = np.concatenate(Bw)
print('total', len(V), 'sommets', len(F), 'triangles', V.min(0), V.max(0))

ech = 32000 / 1.1
pos = np.round(V * ech).astype(np.int16)
nor = np.round(N * 127).astype(np.int8)
col8 = np.round(np.clip(Co, 0, 1) * 255).astype(np.uint8)
# Plans séparés : la compression y gagne beaucoup.
buf = b''.join([pos[:, i].tobytes() for i in range(3)] + [nor[:, i].tobytes() for i in range(3)] + [col8[:, i].tobytes() for i in range(3)] +
               [np.uint8(np.round(G * 255)).tobytes(), np.uint8(Ba).tobytes(), np.uint8(Bb).tobytes(), np.uint8(np.round(Bw * 255)).tobytes()])
ind = F.reshape(-1).astype(np.int32)
I32 = len(V) > 65535   # v3 : au-delà de 65 535 sommets, index 32 bits (marionnette.js lit le drapeau i32)
dif = np.diff(ind, prepend=0).astype(np.int32 if I32 else np.int16)
buf2 = dif.tobytes()
z = gzip.compress(buf + buf2, 9, mtime=0)
meta = dict(nv=len(V), ni=len(ind), ech=ech, i32=I32, os=[dict(n=o[0], p=o[1], x=o[2], y=o[3], z=o[4]) for o in OS], d=base64.b64encode(z).decode())
with open(SORTIE, 'w', encoding='utf8', newline='') as f:
    json.dump(meta, f)
print('brut', len(buf) + len(buf2), 'gzip', len(z), 'base64', len(meta['d']))
