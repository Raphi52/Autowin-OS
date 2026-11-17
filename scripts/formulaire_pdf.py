"""Fabrique un formulaire PDF A4 qui se remplit à l'écran (champs) ou à la main (cadres imprimés) (conv-1968).

Né d'une grille d'entretien utilisateurs (refonte d'un logiciel) : le questionnaire vit dans un JSON et le PDF
se régénère quand une question change, au lieu de refaire la mise en page à la main.
La même grille donne le classeur de compilation des réponses : scripts/formulaire_excel.py.

Usage : python -I scripts/formulaire_pdf.py questionnaire.json sortie.pdf
Sortie : une ligne JSON {sortie, pages, champs}.

Questionnaire JSON (seul "titre" est obligatoire) :
{
  "titre": "...", "sousTitre": "...", "consigne": "...", "piedDePage": "...",
  "densite": "normale" | "compacte",          # compacte : texte et espacements resserrés
  "unePage": true,                            # tout sur une page : refusé si ça déborde, sinon les cadres
                                              # s'étirent pour remplir la page, au prorata de leurs "lignes"
  "identification": {"titre": "(facultatif)", "colonnes": 2, "champs": ["Nom", "Prénom", "Poste"]},
  "sections": [{"titre": "(facultatif)", "note": "(facultatif)", "questions": [
    {"texte": "...", "aide": "en italique", "lignes": 4},                           # cadre libre
    {"texte": "...", "liste": 5, "colonnes": [["Tâche", 0.7], ["Fréquence", 0.3]]}, # lignes numérotées
    {"texte": "...", "parties": [{"libelle": "...", "lignes": 3}], "partiesCote": true},  # cadres titrés
    {"texte": "...", "choix": [{"libelle": "...", "options": ["Oui", "Non"]}], "champ": "Contact"},
    {"texte": "...", "aCote": true}           # se pose à droite de la question précédente, cadres alignés
  ]}]
}
Les questions sont numérotées en continu d'une section à l'autre ; une rangée de questions ne se coupe jamais
entre deux pages, et une section part avec sa première rangée. Les espaces insécables (avant « ? » ou « : »)
ne coupent jamais une ligne.
"""
import json
import os
import re
import sys
import unicodedata

import pymupdf

LARGEUR, HAUTEUR = pymupdf.paper_size('a4')
MARGE_G = MARGE_D = 48
MARGE_HAUT = 46
MARGE_BAS = 58
ENCRE = (0.13, 0.15, 0.19)
ACCENT = (0.10, 0.29, 0.52)
DISCRET = (0.42, 0.45, 0.50)
CADRE = (0.62, 0.65, 0.70)
INTERLIGNE = 1.32

# Tailles de police et espacements, en points. « ligne » = hauteur d'une ligne d'écriture dans un cadre.
DENSITES = {
    'normale': dict(titre=20, sousTitre=11, consigne=9, section=12, question=10.5, aide=9, libelle=9, choix=10,
                    saisie=10, ligne=18, champ=22, rangee_liste=20, pas_liste=24, pas_choix=19, retrait=20,
                    ecart_colonnes=16, avant_filet=8, apres_entete=16, apres_section=10, apres_champ=9,
                    apres_identite=8, avant_zone=5, apres_cadre=6, apres_question=14),
    'compacte': dict(titre=15, sousTitre=9.5, consigne=8, section=10.5, question=9.5, aide=8, libelle=8, choix=9,
                     saisie=9, ligne=13, champ=17, rangee_liste=15, pas_liste=18, pas_choix=15, retrait=16,
                     ecart_colonnes=14, avant_filet=5, apres_entete=9, apres_section=6, apres_champ=5,
                     apres_identite=4, avant_zone=3, apres_cadre=4, apres_question=7),
}

# Helvetica intégrée à PyMuPDF, et non Arial de Windows : avec Arial embarquée, le texte du PDF se relisait
# faux (espace -> insécable, tiret -> tiret conditionnel, « · » -> U+A78F, glyphes partagés), ce qui cassait la
# recherche et le copier-coller. Helvetica relit juste, accents compris, et ne dépend pas du poste.
POLICES = {'normal': 'helv', 'gras': 'hebo', 'italique': 'heit'}


def charger_polices():
    return {cle: pymupdf.Font(nom) for cle, nom in POLICES.items()}


def couper(texte, police, taille, largeur):
    """Coupe aux seules espaces ordinaires : str.split() sans argument couperait aussi aux insécables."""
    lignes, courante = [], ''
    for mot in texte.split(' '):
        if not mot:
            continue
        essai = f'{courante} {mot}' if courante else mot
        if courante and police.text_length(essai, fontsize=taille) > largeur:
            lignes.append(courante)
            courante = mot
        else:
            courante = essai
    if courante:
        lignes.append(courante)
    return lignes or ['']


def grouper_en_rangees(questions):
    rangees = []
    for q in questions:
        if q.get('aCote') and rangees:
            rangees[-1].append(q)
        else:
            rangees.append([q])
    return rangees


def poids_etirement(q):
    """Combien la question prend de la place libre d'une page « unePage » : ses lignes d'écriture étirables."""
    if 'liste' in q or 'choix' in q:
        return 0
    if 'parties' in q:
        lignes = [partie.get('lignes', 3) for partie in q['parties']]
        return max(lignes) if q.get('partiesCote') else lignes[-1]
    return q.get('lignes', 4)


class Formulaire:
    def __init__(self, spec, supplements=None):
        densite = spec.get('densite', 'normale')
        if densite not in DENSITES:
            raise ValueError(f'densite inconnue : {densite!r} (attendu : {", ".join(DENSITES)})')
        self.spec = spec
        self.m = DENSITES[densite]
        self.supplements = supplements or {}   # hauteur ajoutée à chaque rangée, par rang (unePage)
        self.poids_rangees = []
        self.doc = pymupdf.open()
        self.polices = charger_polices()
        self.page = None
        self.y = 0.0
        self.hauteur_pages_finies = 0.0
        self.noms = {}

    # --- mise en page -------------------------------------------------------------------------------
    def nouvelle_page(self):
        if self.page is not None:
            self.hauteur_pages_finies += self.y - MARGE_HAUT
        self.page = self.doc.new_page(width=LARGEUR, height=HAUTEUR)
        self.y = MARGE_HAUT

    def hauteur_contenu(self):
        """Hauteur posée depuis le haut de la première page, sans les blancs laissés en bas des pages."""
        return self.hauteur_pages_finies + self.y - MARGE_HAUT

    def reserver(self, hauteur):
        if hauteur > HAUTEUR - MARGE_HAUT - MARGE_BAS:
            raise ValueError(f'bloc de {hauteur:.0f} pt plus haut qu\'une page : réduis ses "lignes"')
        if self.page is None or self.y + hauteur > HAUTEUR - MARGE_BAS:
            self.nouvelle_page()

    def ecrire(self, x, y, lignes, police, taille, couleur, interligne=INTERLIGNE):
        ecrivain = pymupdf.TextWriter(self.page.rect)
        for i, ligne in enumerate(lignes):
            ecrivain.append((x, y + taille * (0.82 + i * interligne)), ligne, font=self.polices[police],
                            fontsize=taille)
        ecrivain.write_text(self.page, color=couleur)

    def nom_champ(self, libelle):
        base = unicodedata.normalize('NFKD', libelle).encode('ascii', 'ignore').decode()
        base = re.sub(r'[^A-Za-z0-9]+', '_', base).strip('_')[:40] or 'champ'
        rang = self.noms.get(base, 0) + 1
        self.noms[base] = rang
        return base if rang == 1 else f'{base}_{rang}'

    def colonnes(self, nombre):
        ecart = self.m['ecart_colonnes']
        large = (LARGEUR - MARGE_G - MARGE_D - ecart * (nombre - 1)) / nombre
        return [(MARGE_G + i * (large + ecart), MARGE_G + i * (large + ecart) + large) for i in range(nombre)]

    # --- champs -------------------------------------------------------------------------------------
    def champ_texte(self, rect, nom, infobulle, multiligne):
        # Le cadre est dessiné sur la page (il s'imprime vide) ; le champ, transparent, se pose dessus.
        self.page.draw_rect(rect, color=CADRE, width=0.7)
        champ = pymupdf.Widget()
        champ.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        champ.field_name = self.nom_champ(nom)
        champ.field_label = infobulle
        champ.rect = rect
        champ.text_font = 'Helv'
        champ.text_fontsize = self.m['saisie']
        champ.text_color = ENCRE
        champ.border_width = 0
        champ.border_color = None
        champ.fill_color = None
        if multiligne:
            champ.field_flags |= pymupdf.PDF_TX_FIELD_IS_MULTILINE
        self.page.add_widget(champ)

    def case(self, x, y, nom, infobulle):
        rect = pymupdf.Rect(x, y, x + 10, y + 10)
        self.page.draw_rect(rect, color=DISCRET, width=0.8)
        champ = pymupdf.Widget()
        champ.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX
        champ.field_name = self.nom_champ(nom)
        champ.field_label = infobulle
        champ.rect = rect
        champ.border_width = 0
        champ.border_color = None
        champ.fill_color = None
        champ.text_color = ENCRE
        champ.field_value = False
        self.page.add_widget(champ)

    # --- blocs --------------------------------------------------------------------------------------
    def entete(self):
        m = self.m
        self.nouvelle_page()
        largeur = LARGEUR - MARGE_G - MARGE_D
        for cle, police, couleur, interligne in (('titre', 'gras', ACCENT, 1.2), ('sousTitre', 'normal', DISCRET, INTERLIGNE),
                                                 ('consigne', 'italique', DISCRET, INTERLIGNE)):
            if not self.spec.get(cle):
                continue
            taille = m[cle]
            lignes = couper(self.spec[cle], self.polices[police], taille, largeur)
            if cle != 'titre':
                self.y += taille * 0.35
            self.ecrire(MARGE_G, self.y, lignes, police, taille, couleur, interligne)
            self.y += taille * interligne * len(lignes)
        self.y += m['avant_filet']
        self.page.draw_line((MARGE_G, self.y), (LARGEUR - MARGE_D, self.y), color=ACCENT, width=1.2)
        self.y += m['apres_entete']

    def titre_section(self, titre, note, hauteur_suivante):
        taille = self.m['section']
        self.reserver(taille * INTERLIGNE + 3 + self.m['apres_section'] + hauteur_suivante)
        self.ecrire(MARGE_G, self.y, [titre], 'gras', taille, ACCENT)
        if note:
            decalage = self.polices['gras'].text_length(titre, fontsize=taille) + 6
            self.ecrire(MARGE_G + decalage, self.y + taille * 0.2, [note], 'italique', self.m['aide'], DISCRET)
        self.y += taille * INTERLIGNE + 3
        self.page.draw_line((MARGE_G, self.y), (LARGEUR - MARGE_D, self.y), color=CADRE, width=0.5)
        self.y += self.m['apres_section']

    def identification(self, bloc):
        m = self.m
        champs = bloc.get('champs', [])
        nombre = max(1, int(bloc.get('colonnes', 2)))
        rangee = m['libelle'] * INTERLIGNE + 3 + m['champ'] + m['apres_champ']
        if bloc.get('titre'):
            self.titre_section(bloc['titre'], bloc.get('note'), rangee)
        for debut in range(0, len(champs), nombre):
            self.reserver(rangee)
            for libelle, (x0, x1) in zip(champs[debut:debut + nombre], self.colonnes(nombre)):
                self.ecrire(x0, self.y, [libelle], 'gras', m['libelle'], DISCRET)
                haut = self.y + m['libelle'] * INTERLIGNE + 3
                self.champ_texte(pymupdf.Rect(x0, haut, x1, haut + m['champ']), libelle, libelle, False)
            self.y += rangee
        self.y += m['apres_identite']

    def hauteur_entete_rangee(self, questions):
        return max(self.entete_question(q, x0 + self.m['retrait'], x1, None, None, dessiner=False)
                   for q, (x0, x1) in zip(questions, self.colonnes(len(questions))))

    def hauteur_rangee(self, questions, numeros):
        entete = self.hauteur_entete_rangee(questions)
        return max(self.question(q, n, x0, x1, dessiner=False, entete=entete)
                   for q, n, (x0, x1) in zip(questions, numeros, self.colonnes(len(questions))))

    def rangee(self, questions, numeros):
        """Pose côte à côte les questions d'une rangée : leurs cadres commencent et finissent à la même hauteur,
        quelle que soit la longueur de chaque question."""
        supplement = self.supplements.get(len(self.poids_rangees), 0.0)
        self.poids_rangees.append(max(poids_etirement(q) for q in questions))
        entete = self.hauteur_entete_rangee(questions)
        hauteur = self.hauteur_rangee(questions, numeros)
        self.reserver(hauteur + supplement)
        for q, n, (x0, x1) in zip(questions, numeros, self.colonnes(len(questions))):
            naturelle = self.question(q, n, x0, x1, dessiner=False, entete=entete)
            self.question(q, n, x0, x1, dessiner=True, entete=entete, etirement=hauteur - naturelle + supplement)
        self.y += hauteur + supplement

    def entete_question(self, q, x, x1, numero, x0, dessiner):
        """Pose le texte et l'aide de la question à self.y ; rend la hauteur jusqu'au début de ses cadres."""
        m = self.m
        largeur = x1 - x
        y = self.y
        lignes = couper(q['texte'], self.polices['gras'], m['question'], largeur)
        if dessiner:
            self.ecrire(x0, y, [f'{numero}.'], 'gras', m['question'], ACCENT)
            self.ecrire(x, y, lignes, 'gras', m['question'], ENCRE)
        y += m['question'] * INTERLIGNE * len(lignes)
        if q.get('aide'):
            aide = couper(q['aide'], self.polices['italique'], m['aide'], largeur)
            if dessiner:
                self.ecrire(x, y + 1, aide, 'italique', m['aide'], DISCRET)
            y += 1 + m['aide'] * INTERLIGNE * len(aide)
        return y + m['avant_zone'] - self.y

    def question(self, q, numero, x0, x1, dessiner, entete=None, etirement=0.0):
        """Pose la question à self.y entre x0 et x1 et rend sa hauteur naturelle ; dessiner=False ne fait que
        mesurer. `entete` fixe où commencent ses cadres (alignés sur la rangée) ; `etirement` allonge son
        dernier cadre libre (les listes et les cases ne s'étirent pas)."""
        m = self.m
        x = x0 + m['retrait']
        largeur = x1 - x
        prefixe = f'Q{numero}'
        propre = self.entete_question(q, x, x1, numero, x0, dessiner)
        y = self.y + max(propre, entete or 0.0)
        if 'liste' in q:
            y = self.zone_liste(q, prefixe, x, largeur, y, dessiner)
        elif 'choix' in q:
            y = self.zone_choix(q, prefixe, x, largeur, y, dessiner)
        elif 'parties' in q:
            y = self.zone_parties(q, prefixe, x, largeur, y, dessiner, etirement)
        else:
            y = self.zone_libre(None, q.get('lignes', 4), prefixe, q['texte'], x, largeur, y, dessiner, etirement)
        return y - self.y + m['apres_question']

    def zone_libre(self, libelle, lignes, nom, infobulle, x, largeur, y, dessiner, etirement=0.0):
        m = self.m
        if libelle:
            if dessiner:
                self.ecrire(x, y, [libelle], 'gras', m['libelle'], DISCRET)
            y += m['libelle'] * INTERLIGNE + 2
        hauteur = lignes * m['ligne'] + 6 + etirement
        if dessiner:
            self.champ_texte(pymupdf.Rect(x, y, x + largeur, y + hauteur), nom, infobulle,
                             hauteur >= 2 * m['ligne'])
        return y + hauteur + m['apres_cadre']

    def zone_parties(self, q, prefixe, x, largeur, y, dessiner, etirement):
        parties = q['parties']
        if not q.get('partiesCote'):
            for rang, partie in enumerate(parties):
                y = self.zone_libre(partie.get('libelle'), partie.get('lignes', 3),
                                    f"{prefixe} {partie.get('libelle', '')}", q['texte'], x, largeur, y, dessiner,
                                    etirement if rang == len(parties) - 1 else 0.0)
            return y
        # Côte à côte : mêmes lignes pour toutes, et les libellés sur une même ligne, pour aligner les cadres.
        ecart = self.m['ecart_colonnes']
        large = (largeur - ecart * (len(parties) - 1)) / len(parties)
        lignes = max(partie.get('lignes', 3) for partie in parties)
        if any(partie.get('libelle') for partie in parties):
            if dessiner:
                for rang, partie in enumerate(parties):
                    if partie.get('libelle'):
                        self.ecrire(x + rang * (large + ecart), y, [partie['libelle']], 'gras', self.m['libelle'],
                                    DISCRET)
            y += self.m['libelle'] * INTERLIGNE + 2
        fin = y
        for rang, partie in enumerate(parties):
            fin = self.zone_libre(None, lignes, f"{prefixe} {partie.get('libelle', '')}",
                                  f"{q['texte']} ({partie.get('libelle', rang + 1)})", x + rang * (large + ecart),
                                  large, y, dessiner, etirement)
        return fin

    def zone_liste(self, q, prefixe, x, largeur, y, dessiner):
        m = self.m
        colonnes = q.get('colonnes') or [[None, 1]]
        total = sum(part for _, part in colonnes)
        numero, ecart = 14, 8
        utile = largeur - numero
        # Chaque en-tête passe à la ligne dans la largeur de SA colonne, au lieu de déborder sur la marge.
        entetes = [couper(libelle, self.polices['gras'], m['libelle'], utile * part / total - ecart) if libelle else []
                   for libelle, part in colonnes]
        hauteur_entete = max(len(lignes) for lignes in entetes)
        if hauteur_entete:
            if dessiner:
                cx = x + numero
                for lignes, (_, part) in zip(entetes, colonnes):
                    self.ecrire(cx, y, lignes, 'gras', m['libelle'], DISCRET)
                    cx += utile * part / total
            y += m['libelle'] * INTERLIGNE * hauteur_entete + 2
        for rang in range(1, int(q['liste']) + 1):
            if dessiner:
                self.ecrire(x, y + (m['rangee_liste'] - m['libelle']) / 2, [str(rang)], 'normal', m['libelle'],
                            DISCRET)
                cx = x + numero
                for i, (libelle, part) in enumerate(colonnes):
                    large = utile * part / total - (0 if i == len(colonnes) - 1 else ecart)
                    self.champ_texte(pymupdf.Rect(cx, y, cx + large, y + m['rangee_liste']),
                                     f"{prefixe} {libelle or 'ligne'} {rang}", f"{q['texte']} ({rang})", False)
                    cx += utile * part / total
            y += m['pas_liste']
        return y + 2

    def zone_choix(self, q, prefixe, x, largeur, y, dessiner):
        taille = self.m['choix']
        police = self.polices['normal']
        debut_options = x + max(police.text_length(c['libelle'], fontsize=taille) for c in q['choix']) + 16
        for choix in q['choix']:
            if dessiner:
                self.ecrire(x, y, [choix['libelle']], 'normal', taille, ENCRE)
                ox = debut_options
                for option in choix['options']:
                    self.case(ox, y + taille * 0.82 - 7.7, f"{prefixe} {choix['libelle']} {option}",
                              f"{choix['libelle']} : {option}")
                    self.ecrire(ox + 14, y, [option], 'normal', taille, ENCRE)
                    ox += 14 + police.text_length(option, fontsize=taille) + 18
            y += self.m['pas_choix']
        if q.get('champ'):
            y = self.zone_libre(q['champ'], 1, f"{prefixe} {q['champ']}", q['champ'], x, largeur, y + 3, dessiner)
        return y

    def pieds_de_page(self):
        total = len(self.doc)
        police = self.polices['normal']
        for rang, page in enumerate(self.doc, start=1):
            texte = ' · '.join(filter(None, [self.spec.get('piedDePage'), f'page {rang} / {total}']))
            ecrivain = pymupdf.TextWriter(page.rect)
            x = (LARGEUR - police.text_length(texte, fontsize=8)) / 2
            ecrivain.append((x, HAUTEUR - 28), texte, font=police, fontsize=8)
            ecrivain.write_text(page, color=DISCRET)


def mettre_en_page(spec, supplements=None):
    formulaire = Formulaire(spec, supplements)
    formulaire.entete()
    if spec.get('identification'):
        formulaire.identification(spec['identification'])
    numero = 0
    for section in spec.get('sections', []):
        rangees = grouper_en_rangees(section.get('questions', []))
        if section.get('titre'):
            premiere = 0.0
            if rangees:
                premiere = formulaire.hauteur_rangee(rangees[0], range(numero + 1, numero + 1 + len(rangees[0])))
                premiere += formulaire.supplements.get(len(formulaire.poids_rangees), 0.0)
            formulaire.titre_section(section['titre'], section.get('note'), premiere)
        for rangee in rangees:
            formulaire.rangee(rangee, list(range(numero + 1, numero + 1 + len(rangee))))
            numero += len(rangee)
    return formulaire


def construire(spec):
    formulaire = mettre_en_page(spec)
    if spec.get('unePage'):
        pages = len(formulaire.doc)
        if pages > 1:
            depasse = formulaire.hauteur_contenu() - (HAUTEUR - MARGE_HAUT - MARGE_BAS)
            ligne = formulaire.m['ligne']
            formulaire.doc.close()
            raise ValueError(f'"unePage" demandé mais le questionnaire tient sur {pages} pages (environ '
                             f'{max(depasse, 0):.0f} pt de trop, soit {max(depasse, 0) / ligne:.1f} lignes '
                             'd\'écriture) : réduis les "lignes", passe "densite" à "compacte" ou mets des '
                             'questions "aCote"')
        # La place libre en bas de page va aux cadres, au prorata de leurs lignes ; 0,5 pt de marge évite
        # qu'un arrondi pousse la dernière rangée sur une deuxième page.
        libre = HAUTEUR - MARGE_BAS - formulaire.y - 0.5
        poids = formulaire.poids_rangees
        if libre > 0 and sum(poids):
            supplements = {rang: libre * p / sum(poids) for rang, p in enumerate(poids) if p}
            formulaire.doc.close()
            formulaire = mettre_en_page(spec, supplements)
    formulaire.pieds_de_page()
    formulaire.doc.subset_fonts()
    return formulaire.doc


def main(argv):
    if len(argv) != 3:
        print('Usage : python -I scripts/formulaire_pdf.py questionnaire.json sortie.pdf', file=sys.stderr)
        return 2
    with open(argv[1], encoding='utf-8') as fh:
        spec = json.load(fh)
    doc = construire(spec)
    champs = sum(1 for page in doc for _ in page.widgets())
    pages = len(doc)
    doc.save(argv[2], garbage=3, deflate=True)
    doc.close()
    print(json.dumps({'sortie': os.path.abspath(argv[2]), 'pages': pages, 'champs': champs}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
