"""Tests de scripts/formulaire_pdf.py (conv-1968) : un questionnaire JSON devient un formulaire PDF A4 à champs."""
import json
import os
import sys
import tempfile
import unittest

import pymupdf

sys.path.insert(0, os.path.dirname(__file__))
from formulaire_pdf import (  # noqa: E402
    HAUTEUR, LARGEUR, MARGE_BAS, MARGE_D, MARGE_G, charger_polices, construire, couper, main)

SPEC = {
    'titre': 'Entretien test',
    'piedDePage': 'Pied',
    'identification': {'titre': 'Personne', 'champs': ['Nom', 'Prénom', 'Poste']},
    'sections': [{'titre': 'Section', 'questions': [
        {'texte': 'Qu’aimez-vous dans l’outil ?', 'lignes': 3},
        {'texte': 'Cinq tâches', 'liste': 5, 'colonnes': [['Tâche', 0.72], ['Fréquence : combien de fois (jour / semaine)', 0.28]]},
        {'texte': 'IA', 'parties': [{'libelle': 'Aide', 'lignes': 2}, {'libelle': 'Jamais', 'lignes': 2}]},
        {'texte': 'Suite', 'choix': [{'libelle': 'Rappel', 'options': ['Oui', 'Non']}], 'champ': 'Contact'},
    ]}],
}


def champs(doc):
    return [(i, w) for i, page in enumerate(doc) for w in page.widgets()]


class FormulairePdf(unittest.TestCase):
    def test_chaque_cadre_est_un_champ_remplissable_au_nom_unique(self):
        trouves = champs(construire(SPEC))
        noms = [w.field_name for _, w in trouves]
        self.assertEqual(len(noms), len(set(noms)))
        textes = [w for _, w in trouves if w.field_type == pymupdf.PDF_WIDGET_TYPE_TEXT]
        cases = [w for _, w in trouves if w.field_type == pymupdf.PDF_WIDGET_TYPE_CHECKBOX]
        # 3 champs d'identité + 1 zone libre + 5 lignes x 2 colonnes + 2 parties + 1 contact
        self.assertEqual(len(textes), 3 + 1 + 10 + 2 + 1)
        self.assertEqual(len(cases), 2)

    def test_le_texte_accentue_reste_lisible_et_le_point_d_interrogation_colle(self):
        texte = construire(SPEC)[0].get_text()
        for attendu in ('Entretien test', 'Prénom', 'Fréquence', 'Pied'):
            self.assertIn(attendu, texte)
        # Relu tel qu'écrit : apostrophe, tiret et insécable intacts (Arial embarquée les relisait de travers).
        self.assertIn('Qu’aimez-vous dans l’outil ?', texte)
        self.assertIn('Pied · page 1 / ', texte)

    def test_aucun_texte_ne_deborde_des_marges(self):
        # Un en-tête de colonne trop long débordait de la marge droite (grille d'entretien, conv-1968).
        for page in construire(SPEC):
            for bloc in page.get_text('dict')['blocks']:
                for ligne in bloc.get('lines', []):
                    for morceau in ligne['spans']:
                        self.assertGreaterEqual(morceau['bbox'][0], MARGE_G - 0.5, morceau['text'])
                        self.assertLessEqual(morceau['bbox'][2], LARGEUR - MARGE_D + 0.5, morceau['text'])

    def test_une_espace_insecable_ne_coupe_jamais_la_ligne(self):
        police = charger_polices()['normal']
        largeur = police.text_length('aaa bbb', fontsize=10)
        lignes = couper('aaa bbb ?', police, 10, largeur)
        self.assertEqual(lignes, ['aaa', 'bbb ?'])

    def test_une_question_ne_se_coupe_jamais_entre_deux_pages(self):
        lettres = 'ABCDEFGHIJKL'
        spec = {'titre': 'Long', 'sections': [{'titre': 'S', 'questions': [
            {'texte': f'Sujet {c}', 'lignes': 8} for c in lettres]}]}
        doc = construire(spec)
        self.assertGreater(len(doc), 1)
        trouves = champs(doc)
        for i, w in trouves:
            self.assertLessEqual(w.rect.y1, HAUTEUR - MARGE_BAS + 0.5, w.field_name)
        for k, c in enumerate(lettres, start=1):
            page_texte = next(i for i, page in enumerate(doc) if page.search_for(f'Sujet {c}'))
            page_cadre = next(i for i, w in trouves if w.field_name == f'Q{k}')
            self.assertEqual(page_texte, page_cadre, f'Sujet {c}')

    def test_une_question_plus_haute_qu_une_page_est_refusee(self):
        spec = {'titre': 'Trop', 'sections': [{'titre': 'S', 'questions': [{'texte': 'X', 'lignes': 60}]}]}
        with self.assertRaises(ValueError):
            construire(spec)

    def test_questions_a_cote_cadres_alignes_et_identification_en_colonnes(self):
        spec = {'titre': 'Cote', 'densite': 'compacte',
                'identification': {'colonnes': 4, 'champs': ['A', 'B', 'C', 'D', 'E']},
                'sections': [{'questions': [
                    {'texte': 'Une question assez longue pour passer sur deux lignes dans une demi-colonne',
                     'lignes': 2},
                    {'texte': 'Courte', 'lignes': 3, 'aCote': True},
                    {'texte': 'Parties', 'partiesCote': True,
                     'parties': [{'libelle': 'Oui', 'lignes': 2}, {'libelle': 'Non', 'lignes': 4}]}]}]}
        doc = construire(spec)
        cadres = {w.field_name: w.rect for _, w in champs(doc)}
        self.assertEqual({round(cadres[n].y0) for n in 'ABCD'}, {round(cadres['A'].y0)})
        self.assertGreater(cadres['E'].y0, cadres['A'].y1)
        self.assertGreater(cadres['Q2'].x0, cadres['Q1'].x1)
        self.assertAlmostEqual(cadres['Q1'].y1, cadres['Q2'].y1, places=1)
        self.assertAlmostEqual(cadres['Q1'].y0, cadres['Q2'].y0, places=1)   # question longue ou courte
        self.assertAlmostEqual(cadres['Q3_Oui'].y0, cadres['Q3_Non'].y0, places=1)
        self.assertAlmostEqual(cadres['Q3_Oui'].y1, cadres['Q3_Non'].y1, places=1)
        self.assertGreater(cadres['Q3_Non'].x0, cadres['Q3_Oui'].x1)

    def test_une_page_remplit_la_page_au_prorata_des_lignes(self):
        spec = {'titre': 'Une page', 'unePage': True, 'densite': 'compacte', 'sections': [{'questions': [
            {'texte': 'Grande', 'lignes': 6}, {'texte': 'Petite', 'lignes': 2},
            {'texte': 'Liste', 'liste': 2}]}]}
        doc = construire(spec)
        self.assertEqual(len(doc), 1)
        cadres = {w.field_name: w.rect for _, w in champs(doc)}
        bas = max(r.y1 for r in cadres.values())
        self.assertGreater(bas, HAUTEUR - MARGE_BAS - 40)          # la page est remplie
        self.assertGreater(cadres['Q1'].height, 2.5 * cadres['Q2'].height)
        self.assertLess(cadres['Q3_ligne_1'].height, 20)          # une liste ne s'étire pas

    def test_une_page_qui_deborde_est_refusee(self):
        spec = {'titre': 'Trop', 'unePage': True, 'sections': [{'questions': [
            {'texte': f'Sujet {k}', 'lignes': 8} for k in range(12)]}]}
        with self.assertRaisesRegex(ValueError, 'unePage'):
            construire(spec)

    def test_une_densite_inconnue_est_refusee(self):
        with self.assertRaisesRegex(ValueError, 'densite'):
            construire({'titre': 'X', 'densite': 'serree'})

    def test_la_ligne_de_commande_ecrit_le_pdf(self):
        with tempfile.TemporaryDirectory() as dossier:
            source = os.path.join(dossier, 'spec.json')
            sortie = os.path.join(dossier, 'sortie.pdf')
            with open(source, 'w', encoding='utf-8') as fh:
                json.dump(SPEC, fh, ensure_ascii=False)
            self.assertEqual(main(['formulaire_pdf.py', source, sortie]), 0)
            with pymupdf.open(sortie) as doc:
                self.assertEqual(len(champs(doc)), 19)


if __name__ == '__main__':
    unittest.main()
