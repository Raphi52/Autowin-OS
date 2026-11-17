"""Fabrique le script Google Apps Script qui crée un Google Form depuis un questionnaire JSON (conv-1968) :
le même JSON que scripts/formulaire_pdf.py (PDF) et scripts/formulaire_excel.py (classeur de compilation).

Google Forms n'importe aucun fichier. On colle donc ce script dans un projet Apps Script
(https://script.google.com/home, « Nouveau projet »), on exécute `creerFormulaire`, le compte accepte l'accès
à Google Forms, et le journal d'exécution donne le lien à envoyer et le lien de modification.

Usage : python -I scripts/formulaire_google.py questionnaire.json sortie.gs
Sortie : une ligne JSON {sortie, questions, caracteres}.

Correspondance avec le PDF (même numérotation) :
  - identification -> réponses courtes (« Date » -> champ date) ;
  - question libre ou "liste" -> paragraphe (la liste devient « une par ligne » dans l'aide) ;
  - "parties" / "choix" -> un titre portant la question, puis un paragraphe par partie, un choix unique par
    choix et une réponse courte pour "champ".
Clé facultative "google" : {"titre": ..., "description": ..., "champsExclus": ["Date"]} remplace le titre et
le sous-titre du PDF, et retire des champs d'identification inutiles en ligne (Google horodate déjà chaque
réponse). Présentation propre au formulaire en ligne, sans effet sur le PDF : "titreIdentification" /
"noteIdentification" (titre de bloc avant l'identification), "titreQuestions" / "noteQuestions" (avant la
question 1), "messageFin" (affiché après l'envoi). Le thème (couleur, police, image) ne se règle pas par script :
il se choisit dans l'éditeur du formulaire, bouton « Personnaliser le thème ».
Formulaire déjà en ligne : "idFormulaire" (l'identifiant de son lien de modification), puis exécuter
`appliquerPresentation`, qui pose les titres et le message de fin sans recréer le formulaire ni changer son lien.
"""
import json
import os
import sys

MODELE = """// Crée le Google Form du questionnaire ci-dessous : exécuter creerFormulaire, puis lire le journal.
// Formulaire déjà créé (google.idFormulaire) : appliquerPresentation pose ses titres de bloc et son message de fin
// sans changer son lien.
// Généré par formulaire_google.py : modifier le questionnaire JSON et régénérer plutôt que retoucher ici.
var QUESTIONNAIRE = __QUESTIONNAIRE__;

function champsIdentite(q) {
  var exclus = ((q.google || {}).champsExclus || []).map(function (c) { return c.trim().toLowerCase(); });
  return ((q.identification || {}).champs || []).filter(function (champ) {
    return exclus.indexOf(champ.trim().toLowerCase()) < 0;
  });
}

function creerFormulaire() {
  var q = QUESTIONNAIRE, google = q.google || {};
  var form = FormApp.create(google.titre || q.titre);
  form.setDescription(google.description || q.sousTitre || '');
  if (google.messageFin) form.setConfirmationMessage(google.messageFin);
  var titreIdentite = google.titreIdentification || (q.identification || {}).titre;
  if (titreIdentite) form.addSectionHeaderItem().setTitle(titreIdentite).setHelpText(google.noteIdentification || '');
  champsIdentite(q).forEach(function (champ) {
    if (champ.trim().toLowerCase() === 'date') form.addDateItem().setTitle(champ);
    else form.addTextItem().setTitle(champ);
  });
  if (google.titreQuestions) form.addSectionHeaderItem().setTitle(google.titreQuestions).setHelpText(google.noteQuestions || '');
  var numero = 0;
  (q.sections || []).forEach(function (section) {
    if (section.titre) form.addSectionHeaderItem().setTitle(section.titre).setHelpText(section.note || '');
    (section.questions || []).forEach(function (question) {
      numero += 1;
      var titre = numero + '. ' + question.texte;
      var aide = question.aide || '';
      if (question.parties || question.choix) {
        form.addSectionHeaderItem().setTitle(titre).setHelpText(aide);
        (question.parties || []).forEach(function (partie) {
          form.addParagraphTextItem().setTitle(partie.libelle || titre);
        });
        (question.choix || []).forEach(function (choix) {
          form.addMultipleChoiceItem().setTitle(choix.libelle).setChoiceValues(choix.options);
        });
        if (question.champ) form.addTextItem().setTitle(question.champ);
        return;
      }
      if (question.liste) {
        var colonnes = (question.colonnes || []).map(function (c) { return c[0]; }).filter(Boolean);
        aide = [aide, 'Une par ligne, ' + question.liste + ' au plus' +
          (colonnes.length ? ' : ' + colonnes.join(', ') : '') + '.'].filter(Boolean).join(' ');
      }
      form.addParagraphTextItem().setTitle(titre).setHelpText(aide);
    });
  });
  Logger.log('Lien à envoyer : ' + form.getPublishedUrl());
  Logger.log('Lien pour modifier : ' + form.getEditUrl());
  return { envoyer: form.getPublishedUrl(), modifier: form.getEditUrl() };
}

function appliquerPresentation() {
  var google = QUESTIONNAIRE.google || {};
  if (!google.idFormulaire) throw new Error('Renseigner google.idFormulaire dans le questionnaire, puis régénérer.');
  var form = FormApp.openById(google.idFormulaire);
  var presents = form.getItems(FormApp.ItemType.SECTION_HEADER).map(function (i) { return i.getTitle(); });
  function poser(titre, note, avant) {
    if (!titre || presents.indexOf(titre) >= 0) return;
    form.addSectionHeaderItem().setTitle(titre).setHelpText(note || '');
    form.moveItem(form.getItems().length - 1, avant());
  }
  // Repère par la question 1 plutôt que par un nombre de champs : juste même si un titre est déjà posé.
  poser(google.titreQuestions, google.noteQuestions, function () {
    var titres = form.getItems().map(function (i) { return i.getTitle(); });
    for (var n = 0; n < titres.length; n++) if (titres[n].indexOf('1. ') === 0) return n;
    throw new Error('Question 1 introuvable dans le formulaire');
  });
  poser(google.titreIdentification, google.noteIdentification, function () { return 0; });
  if (google.messageFin) form.setConfirmationMessage(google.messageFin);
  Logger.log('Présentation appliquée : ' + form.getEditUrl());
}
"""


def generer(spec):
    # JSON compact : le script se colle d'un bloc dans l'éditeur, autant qu'il reste court.
    return MODELE.replace('__QUESTIONNAIRE__', json.dumps(spec, ensure_ascii=False, separators=(',', ':')))


def main(argv):
    if len(argv) != 3:
        print('Usage : python -I scripts/formulaire_google.py questionnaire.json sortie.gs', file=sys.stderr)
        return 2
    with open(argv[1], encoding='utf-8') as fh:
        spec = json.load(fh)
    code = generer(spec)
    with open(argv[2], 'w', encoding='utf-8', newline='') as fh:
        fh.write(code)
    questions = sum(len(section.get('questions', [])) for section in spec.get('sections', []))
    print(json.dumps({'sortie': os.path.abspath(argv[2]), 'questions': questions, 'caracteres': len(code)},
                     ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
