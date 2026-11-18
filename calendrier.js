// =====================================================================
//  CALENDRIER — échéances d'un profil (PEA 5 ans, assurance-vie 8 ans,
//  achat, âges clés, relevés de suivi) et échéances générales (taux des
//  livrets, revue annuelle, déclaration de revenus).
//  Les âges ne sont connus qu'en années : ces dates sont approximatives.
// =====================================================================
import { analyser, eur, profilRisque } from "./moteur.js";
import { dernierJourCession } from "./alertes.js";
import { MARCHE } from "./fiscal.js";

const debutMois = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const plusMois = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const depuisAAAAMM = (s) => { const [a, m] = s.split("-").map(Number); return new Date(a, (m || 1) - 1, 1); };

export function echeancesProfil(plan, profil, { releves = null, aujourdhui = new Date() } = {}) {
  const C = plan.calendrier ?? {};
  const maintenant = debutMois(aujourdhui);
  const fin = plusMois(maintenant, 12 * (C.horizonAnnees ?? 15));
  const res = analyser(plan, profil);
  const ev = [];
  const ajouter = (date, titre, detail, type, fiche = null, approx = false) => {
    if (date >= maintenant && date <= fin) ev.push({ date, titre, detail, type, fiche, approx });
  };
  const age = profil.age ?? 0;
  const dansAns = (n) => plusMois(maintenant, 12 * n);

  // PEA
  const bourse = (res.alloc.bourse ?? 0) > 0.5;
  const reco = plan.etablissements?.pea?.recommande;
  if (profil.pea?.ouvert && profil.pea.dateOuverture) {
    ajouter(plusMois(depuisAAAAMM(profil.pea.dateOuverture), 60), "PEA : 5 ans", "Gains exonérés d'impôt sur le revenu (prélèvements sociaux dus) ; retraits possibles sans clôturer le plan.", "fiscal", "pea");
  } else if (bourse && plan.enveloppes.pea) {
    ajouter(maintenant, "Ouvrir le PEA", `Le délai de 5 ans démarre à l'ouverture${reco ? ` ; établissement retenu : ${reco}` : ""}.`, "action", "pea");
  }
  const plafond = plan.enveloppes.pea?.plafond;
  if (plafond && bourse) {
    const verse = profil.pea?.ouvert ? profil.pea.versements ?? 0 : 0;
    const parMois = (profil.epargneMensuelle ?? 0) * ((res.alloc.bourse ?? 0) / (res.capital || 1));
    if (parMois > 1 && verse < plafond) {
      ajouter(plusMois(maintenant, Math.ceil((plafond - verse) / parMois)), "PEA : plafond de versements atteint", `Estimation au rythme actuel (environ ${eur(parMois)} par mois vers la bourse). L'épargne bourse passera ensuite sur le compte-titres.`, "projet", "cto", true);
    }
  }

  // PEA du conjoint
  const cj = profil.foyer?.actif ? profil.conjoint : null;
  if (cj?.pea?.ouvert && cj.pea.dateOuverture) ajouter(plusMois(depuisAAAAMM(cj.pea.dateOuverture), 60), `PEA de ${cj.prenom || "ton conjoint"} : 5 ans`, "Gains exonérés d'impôt sur le revenu ; retraits possibles sans clôturer le plan.", "fiscal", "pea");
  else if (cj && bourse && plan.enveloppes.pea) ajouter(maintenant, `Ouvrir un PEA au nom de ${cj.prenom || "ton conjoint"}`, "Double le plafond du foyer et fait courir son propre délai de 5 ans.", "action", "pea");

  // Livret Jeune : fermé au plus tard à la fin de l'année des 25 ans
  if ((profil.placements?.livretJeune ?? 0) > 0 && age <= 25) {
    ajouter(new Date(maintenant.getFullYear() + (25 - age), 11, 1), "Fin du Livret Jeune (25 ans)", "Le Livret Jeune est fermé au plus tard à la fin de l'année des 25 ans : placer l'argent sur le Livret A ou le LDDS.", "action", "livret-jeune", true);
  }

  // Compte-titres : dernier jour pour vendre et matérialiser une moins-value sur l'année (délai de règlement : MARCHE)
  if ((profil.placements?.cto ?? 0) > 0) {
    const jourDe = (an) => { const [a, m, j] = dernierJourCession(an).split("-").map(Number); return new Date(a, m - 1, j); };
    const aujourd = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());
    let limite = jourDe(aujourd.getFullYear());
    if (limite < aujourd) limite = jourDe(aujourd.getFullYear() + 1);
    // `ajouter` ne garde que les dates du mois courant ou après : on pousse directement (la date est toujours à venir)
    ev.push({ date: limite, titre: "Dernier jour de cession sur le CTO pour l'année", detail: `Pour qu'une moins-value latente compte sur l'année, l'ordre de vente doit être exécuté ce jour au plus tard (règlement à J+${MARCHE.reglementJoursOuvres} ouvrés). Utile seulement si des plus-values ont été ou seront réalisées ; le PEA n'est pas concerné.`, type: "fiscal", fiche: "cto", approx: false, jourPrecis: true });
  }

  // Assurance-vie
  const av = (profil.placements?.assuranceVie ?? 0) + (profil.placements?.assuranceVieUC ?? 0);
  if (av > 0 && profil.assuranceVie?.dateOuverture) {
    ajouter(plusMois(depuisAAAAMM(profil.assuranceVie.dateOuverture), 96), "Assurance-vie : 8 ans", "Abattement annuel de 4 600 € (9 200 € pour un couple) sur les gains retirés.", "fiscal", "assurance-vie");
  }

  // Résidence principale
  const a = res.achat;
  const pointAchat = a ? (a.imperatif && a.horizon ? a.horizon : a.choisi && !a.choisi.horsLimite ? a.choisi : a.ideal) : null;
  if (pointAchat) {
    const d = dansAns(pointAchat.annees);
    if (pointAchat.annees > 0) ajouter(plusMois(d, -9), "Préparer le dossier de prêt", "Comparer les banques ou passer par un courtier ; présenter des comptes sans découvert et une épargne régulière.", "projet", "residence", !a.imperatif);
    ajouter(d, a.imperatif ? "Achat de la résidence (date prévue)" : a.choisi && pointAchat === a.choisi ? `Achat de la résidence à l'âge choisi (${pointAchat.age} ans)` : `Âge idéal d'achat de la résidence (${pointAchat.age} ans)`,
      `Bien à ${eur(a.prix)} : apport nécessaire ${eur(pointAchat.apportRequis)}${pointAchat.pret ? `, prêt de ${eur(pointAchat.pret)}` : ""}.`, "projet", "residence", !a.imperatif);
  }

  // Âges clés (approximatifs : seul l'âge en années est connu)
  const debutPrudence = plan.age.ageDebut + (profilRisque(plan, profil).decalageAge ?? 0);
  if (age < debutPrudence) ajouter(dansAns(debutPrudence - age), `Vers ${debutPrudence} ans : début du passage vers la prudence`, `Chaque année, ${plan.age.pointsParAn.toLocaleString("fr-FR")} point(s) de la répartition passent des placements risqués vers l'assurance-vie et les obligations.`, "projet", null, true);
  const retraite = plan.hypotheses.ageRetraite;
  if (retraite && age < retraite) ajouter(dansAns(retraite - age), `Vers ${retraite} ans : retraite prévue`, "Fin de l'épargne mensuelle dans les projections.", "projet", null, true);
  if (age < 70) ajouter(dansAns(70 - age), "Vers 70 ans : versements en assurance-vie", "Les sommes versées après 70 ans ont un abattement successoral bien plus faible (30 500 € au total, au lieu de 152 500 € par bénéficiaire) : verser avant si possible.", "fiscal", "assurance-vie", true);

  // PER : versements à faire avant le 31 décembre ; fin de la déduction à 70 ans
  const per = res.per;
  if (per?.actif) {
    for (let i = 0; i < 12; i++) {
      const d = plusMois(maintenant, i);
      if (d.getMonth() === 11) ajouter(d, "PER : verser avant le 31 décembre", `Les versements de l'année sont déductibles des revenus de l'année : ${eur(per.annuel)} conseillés, soit environ ${eur(per.economie)} d'impôt en moins. Les plafonds non utilisés se reportent sur 5 ans.`, "fiscal", "per");
    }
  }
  if (((profil.placements?.per ?? 0) > 0 || per?.actif) && age < 70) ajouter(dansAns(70 - age), "Vers 70 ans : fin de la déduction des versements PER", "Depuis 2026, les versements faits à partir de 70 ans ne sont plus déductibles.", "fiscal", "per", true);

  // Relevé de suivi
  if (releves) {
    const der = releves[releves.length - 1];
    const prochain = der ? plusMois(depuisAAAAMM(der.date), C.frequenceReleveMois ?? 3) : maintenant;
    ajouter(prochain < maintenant ? maintenant : prochain, "Noter un relevé de suivi", "Mettre à jour le montant de chaque compte, puis noter le relevé dans l'onglet Suivi.", "suivi");
  }
  return ev;
}

export function echeancesGenerales(plan) {
  const C = plan.calendrier ?? {};
  const maintenant = debutMois(new Date());
  const ev = [];
  for (let i = 0; i < 12; i++) {
    const d = plusMois(maintenant, i), m = d.getMonth() + 1;
    if (m === 2 || m === 8) ev.push({ date: d, titre: "Nouveaux taux des livrets (le 1er)", detail: "Le taux du Livret A, du LDDS et du LEP est revu le 1er février et le 1er août : ajuster l'hypothèse du plan si besoin.", type: "marche", fiche: "livrets" });
    if (m === (C.moisRevue ?? 1)) ev.push({ date: d, titre: "Revue annuelle du plan", detail: "Vérifier la fiscalité après la loi de finances, les plafonds, les tarifs des courtiers, et mettre à jour les fiches mémo.", type: "suivi" });
    if (m === 4) ev.push({ date: d, titre: "Déclaration de revenus (printemps)", detail: "Déclarer les comptes ouverts à l'étranger (formulaire 3916, 3916-bis pour les plateformes crypto) et les ventes de crypto (2086). Dates exactes publiées chaque année.", type: "fiscal", fiche: "bitcoin", approx: true });
  }
  return ev;
}

// Export CSV au format accepté par Google Agenda et Outlook
export function versCSV(evenements) {
  const champ = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const date = (d, jourPrecis) => `${String(d.getMonth() + 1).padStart(2, "0")}/${jourPrecis ? String(d.getDate()).padStart(2, "0") : "01"}/${d.getFullYear()}`; // jour exact seulement pour les échéances datées au jour près
  const lignes = [["Subject", "Start Date", "All Day Event", "Description"].join(",")];
  for (const e of evenements) {
    const titre = e.qui ? `${e.titre} · ${e.qui}` : e.titre;
    lignes.push([champ(titre), date(e.date, e.jourPrecis), "True", champ(e.detail + (e.approx ? " (date approximative)" : ""))].join(","));
  }
  return lignes.join("\r\n");
}
