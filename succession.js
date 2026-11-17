// =====================================================================
// Simulateur successoral — module pur (aucun DOM, aucun accès au niveau de lecture)
// Droits de succession et de donation, assurance-vie (990 I / 757 B), options du
// conjoint survivant, donation en nue-propriété. Barèmes centralisés dans fiscal.js.
//
// Entrée normalisée (tout champ manquant reçoit une valeur sûre : 0, [], false, "auto") :
// {
//   annee, ageDefunt,
//   situation: "seul" | "mariage" | "pacs" | "concubin",
//   regime: "communaute_legale" | "separation" | "communaute_universelle",  // mariage uniquement
//   ageConjoint,                // conjoint ou partenaire
//   enfants, enfantsNonCommuns, // enfantsNonCommuns <= enfants
//   optionConjoint: "auto" | "quart_pp" | "usufruit" | "quart_pp_usufruit" | "quotite_disponible",
//   donationDernierVivant: bool,
//   testament: bool,            // pacs/concubin : lègue la quotité disponible au partenaire
//   enfantMineurAuFoyer: bool,  // abattement RP hors couple marié/pacsé
//   actifs: [{ libelle, valeur, nature: "commun" | "propre", rp: bool }], // hors AV/PER ; "propre" = au défunt
//   dettes: [{ libelle, montant, nature: "commun" | "propre" }],          // déjà nettes d'assurance emprunteur
//   assuranceVie: { avant70: capital, apres70Primes: primes },
//   per: { valeur },
//   clauseAV: "conjoint_puis_enfants" | "enfants",
//   donations: [{ annee, montant }],  // par enfant, de ce parent
//   patrimoineConjoint: { propre }    // biens propres du conjoint/partenaire (2e décès)
// }
// Toutes les fonctions sont déterministes et ne mutent jamais leurs arguments.
// =====================================================================
import { DMTG, AV_DECES, BAREME_USUFRUIT, PRELEVEMENTS } from "./fiscal.js";

const cts = (x) => Math.round(x * 100) / 100;
const ANNEE_REF = 2026; // année par défaut du rappel fiscal quand l'entrée n'en fournit pas
const OPTIONS_CONJOINT = Object.freeze(["quart_pp", "usufruit", "quart_pp_usufruit", "quotite_disponible"]);

// ==== Briques fiscales ================================================

// Impôt progressif sur un montant cumulé, pour un barème [[plafond, taux %], ...]
function impotCumule(montant, bareme) {
  let impot = 0, bas = 0;
  for (const [plafond, taux] of bareme) {
    if (montant <= bas) break;
    impot += (Math.min(montant, plafond) - bas) * taux / 100;
    bas = plafond;
  }
  return impot;
}

// Art. 784 : les donations rappelées (dejaTaxe) consomment les tranches basses du barème.
export function droitsBareme(base, dejaTaxe = 0, bareme = DMTG.BAREME_LIGNE_DIRECTE) {
  const b = Number(base) || 0;
  if (b <= 0) return 0;
  const d = Math.max(0, Number(dejaTaxe) || 0);
  return cts(impotCumule(d + b, bareme) - impotCumule(d, bareme));
}

// Art. 669 CGI : valeur de l'usufruit et de la nue-propriété (en %) selon l'âge de l'usufruitier.
export function valeurUsufruit(age) {
  const a = Number(age) || 0;
  const [, us] = BAREME_USUFRUIT.find(([plafond]) => a < plafond);
  return { usufruit: us, nuePropriete: 100 - us };
}

// Donations reçues par UN enfant de CE parent et encore rappelées (moins de 15 ans).
export function rappelFiscal(donations = [], annee = ANNEE_REF) {
  const rappele = (donations || [])
    .filter((d) => annee - Number(d.annee) < DMTG.RAPPEL_FISCAL_ANS)
    .reduce((s, d) => s + (Number(d.montant) || 0), 0);
  return {
    rappele,
    abattement: Math.max(0, DMTG.ABATTEMENT_ENFANT - rappele),
    dejaTaxe: Math.max(0, rappele - DMTG.ABATTEMENT_ENFANT),
  };
}

// Droits dus par un enfant sur sa part (valeur taxable, nue-propriété déjà valorisée le cas échéant).
export function droitsEnfant(part, { donations = [], annee } = {}) {
  const p = Math.max(0, Number(part) || 0);
  const rappel = rappelFiscal(donations, annee ?? ANNEE_REF);
  const abattement = Math.min(p, rappel.abattement);
  const base = p - abattement;
  return { abattement, base, droits: droitsBareme(base, rappel.dejaTaxe) };
}

// Concubin : abattement 1 594 €, taux de 60 %.
export function droitsConcubin(part) {
  return cts(Math.max(0, (Number(part) || 0) - DMTG.CONCUBIN.abattement) * DMTG.CONCUBIN.taux / 100);
}

// Art. 990 I : capital décès d'une assurance-vie (primes avant 70 ans), par bénéficiaire.
export function droitsAV990I(capital, lien) {
  if (lien === "conjoint" || lien === "pacs") return 0;
  const taxable = Math.max(0, (Number(capital) || 0) - AV_DECES.ABATTEMENT_990I);
  const [t1, t2] = AV_DECES.TAUX_990I;
  const tranche1 = Math.min(taxable, AV_DECES.SEUIL_990I);
  const tranche2 = Math.max(0, taxable - AV_DECES.SEUIL_990I);
  return cts(tranche1 * t1 / 100 + tranche2 * t2 / 100);
}

// Réserve héréditaire des descendants (fraction de la masse) ; quotité disponible = 1 - réserve.
export function reserveHereditaire(enfants) {
  const n = Math.max(0, Math.floor(Number(enfants) || 0));
  if (n === 0) return 0;
  if (n === 1) return 1 / 2;
  if (n === 2) return 2 / 3;
  return 3 / 4;
}

// ==== Normalisation de l'entrée =======================================
function normaliser(entree = {}) {
  const e = entree || {};
  const enfants = Math.max(0, Math.floor(Number(e.enfants) || 0));
  const situation = ["seul", "mariage", "pacs", "concubin"].includes(e.situation) ? e.situation : "seul";
  const ageDefunt = Number(e.ageDefunt) || 0;
  return {
    annee: Number.isFinite(Number(e.annee)) && e.annee != null ? Number(e.annee) : ANNEE_REF,
    ageDefunt,
    situation,
    regime: situation === "mariage" && ["separation", "communaute_universelle"].includes(e.regime) ? e.regime : "communaute_legale",
    ageConjoint: Number(e.ageConjoint) || ageDefunt || 60,
    enfants,
    enfantsNonCommuns: Math.min(enfants, Math.max(0, Math.floor(Number(e.enfantsNonCommuns) || 0))),
    optionConjoint: e.optionConjoint || "auto",
    donationDernierVivant: !!e.donationDernierVivant,
    testament: !!e.testament,
    enfantMineurAuFoyer: !!e.enfantMineurAuFoyer,
    actifs: (e.actifs || []).map((a) => ({ libelle: a.libelle || "", valeur: Number(a.valeur) || 0, nature: a.nature === "propre" ? "propre" : "commun", rp: !!a.rp })),
    dettes: (e.dettes || []).map((d) => ({ libelle: d.libelle || "", montant: Number(d.montant) || 0, nature: d.nature === "propre" ? "propre" : "commun" })),
    avant70: Math.max(0, Number(e.assuranceVie?.avant70) || 0),
    apres70Primes: Math.max(0, Number(e.assuranceVie?.apres70Primes) || 0),
    per: Math.max(0, Number(e.per?.valeur) || 0),
    clauseAV: e.clauseAV === "enfants" ? "enfants" : "conjoint_puis_enfants",
    donations: (e.donations || []).map((d) => ({ annee: Number(d.annee), montant: Number(d.montant) || 0 })),
    patrimoineConjointPropre: Math.max(0, Number(e.patrimoineConjoint?.propre) || 0),
  };
}

// ==== Masse successorale ==============================================
// Part du défunt dans un bien : "propre" = 100 % ; "commun" = 50 % (communauté ou indivision 50/50).
const fraction = (nature) => (nature === "propre" ? 1 : 0.5);

function masseDe(e) {
  let actifBrut = 0, partRP = 0, communNet = 0;
  for (const a of e.actifs) {
    const f = fraction(a.nature);
    actifBrut += a.valeur * f;
    if (a.rp) partRP += a.valeur * f;
    if (a.nature === "commun") communNet += a.valeur * 0.5;
  }
  let passif = 0;
  for (const d of e.dettes) {
    passif += d.montant * fraction(d.nature);
    if (d.nature === "commun") communNet -= d.montant * 0.5;
  }
  const rpAdmise = e.situation === "mariage" || e.situation === "pacs" || e.enfantMineurAuFoyer;
  const abattementRP = rpAdmise ? partRP * DMTG.ABATTEMENT_RP / 100 : 0;
  const masseNette = Math.max(0, actifBrut - abattementRP - passif - DMTG.FORFAIT_FUNERAIRE);
  return {
    actifBrut: cts(actifBrut),
    abattementRP: cts(abattementRP),
    passif: cts(passif),
    forfaitFuneraire: DMTG.FORFAIT_FUNERAIRE,
    masseNette: cts(masseNette),
    partCommuneConjoint: cts(Math.max(0, communNet)),
    attributionIntegrale: e.situation === "mariage" && e.regime === "communaute_universelle",
  };
}

export function masseSuccessorale(entree) {
  return masseDe(normaliser(entree));
}

// ==== Dévolution ======================================================
export function optionsPossibles(entree) {
  const e = normaliser(entree);
  if (e.situation !== "mariage" || e.regime === "communaute_universelle" || e.enfants === 0) return [];
  const liste = ["quart_pp"];
  if (e.enfantsNonCommuns === 0 || e.donationDernierVivant) liste.push("usufruit");
  if (e.donationDernierVivant) liste.push("quart_pp_usufruit", "quotite_disponible");
  return liste;
}

// Répartition de la masse nette M : valeurs fiscales reçues par le partenaire et par l'ensemble des enfants.
function devolution(e, M, option, hypotheses, horsPerimetre) {
  const n = e.enfants;
  const res = { partenaire: null, enfantsTotal: 0, enfantsDetenus: "pp" };
  const partenaire = (lien, detenus, recu, pp) => ({ lien, droitsDetenus: detenus, recu: cts(recu), pp: cts(pp) });
  if (e.situation === "mariage") {
    if (e.regime === "communaute_universelle") {
      res.partenaire = partenaire("conjoint", "pp", M, M);
      hypotheses.push("Communauté universelle avec clause d'attribution intégrale : le conjoint reçoit toute la communauté hors succession, les enfants ne reçoivent rien au premier décès.");
    } else if (n === 0) {
      res.partenaire = partenaire("conjoint", "pp", M, M);
      hypotheses.push("Mariage sans enfant : le conjoint reçoit tout ; les droits des éventuels ascendants (réserve d'un quart) sont hors périmètre.");
    } else {
      const us = valeurUsufruit(e.ageConjoint);
      const QD = 1 - reserveHereditaire(n);
      if (option === "usufruit") {
        res.partenaire = partenaire("conjoint", "us", M * us.usufruit / 100, 0);
        res.enfantsTotal = M * us.nuePropriete / 100;
        res.enfantsDetenus = "np";
      } else if (option === "quart_pp_usufruit") {
        res.partenaire = partenaire("conjoint", "pp+us", M / 4 + 0.75 * M * us.usufruit / 100, M / 4);
        res.enfantsTotal = 0.75 * M * us.nuePropriete / 100;
        res.enfantsDetenus = "np";
      } else if (option === "quotite_disponible") {
        res.partenaire = partenaire("conjoint", "pp", M * QD, M * QD);
        res.enfantsTotal = M * (1 - QD);
      } else {
        res.partenaire = partenaire("conjoint", "pp", M / 4, M / 4);
        res.enfantsTotal = 0.75 * M;
      }
    }
  } else if (e.situation === "pacs" || e.situation === "concubin") {
    const QD = n === 0 ? 1 : 1 - reserveHereditaire(n);
    const legs = e.testament ? M * QD : 0;
    res.partenaire = partenaire(e.situation === "pacs" ? "pacs" : "concubin", "pp", legs, legs);
    res.enfantsTotal = M - legs;
    if (!e.testament) hypotheses.push("Sans testament, le partenaire ne reçoit rien de la succession (pas de vocation successorale).");
    if (n === 0 && !e.testament) horsPerimetre.push("Sans enfant ni testament : succession aux ascendants, frères et sœurs (hors périmètre).");
  } else {
    res.enfantsTotal = n > 0 ? M : 0;
    if (n === 0) hypotheses.push("Sans enfant ni conjoint : la succession revient aux ascendants, frères et sœurs (hors périmètre).");
  }
  return res;
}

// ==== Assurance-vie et PER ============================================
// Bénéficiaires et parts de capital (990 I) et de primes (757 B).
function repartirAV(e, hypotheses) {
  const pivot = AV_DECES.AGE_PIVOT;
  const capital990 = e.avant70 + (e.ageDefunt < pivot ? e.per : 0);
  const primes757 = e.apres70Primes + (e.ageDefunt >= pivot ? e.per : 0);
  if (e.per > 0) hypotheses.push(e.ageDefunt < pivot
    ? "PER au décès avant 70 ans : valeur traitée comme un capital décès soumis à l'article 990 I."
    : "PER au décès à partir de 70 ans : valeur entière traitée comme des primes soumises à l'article 757 B (approximation prudente).");
  const partenaireBenef = e.clauseAV === "conjoint_puis_enfants" && e.situation !== "seul";
  let benef = [];
  if (capital990 + primes757 > 0) {
    if (partenaireBenef) benef = [{ id: e.situation === "mariage" ? "conjoint" : "partenaire", lien: e.situation === "mariage" ? "conjoint" : e.situation, part: 1 }];
    else if (e.enfants > 0) benef = Array.from({ length: e.enfants }, (_, i) => ({ id: `enfant${i + 1}`, lien: "enfant", part: 1 / e.enfants }));
    else hypotheses.push("Assurance-vie sans bénéficiaire modélisé (ni partenaire ni enfant) : hors périmètre.");
  }
  const exoneres = (b) => b.lien === "conjoint" || b.lien === "pacs";
  const primesNonExonerees = benef.filter((b) => !exoneres(b)).reduce((s, b) => s + primes757 * b.part, 0);
  if (primes757 > 0) hypotheses.push("Abattement 757 B de 30 500 € réparti au prorata des primes entre bénéficiaires non exonérés.");
  const parts = {};
  for (const b of benef) {
    const capital = capital990 * b.part;
    const primes = primes757 * b.part;
    const abattement757 = exoneres(b) || primesNonExonerees <= 0 ? 0 : AV_DECES.ABATTEMENT_757B * primes / primesNonExonerees;
    parts[b.id] = {
      lien: b.lien, capital, primes,
      droits990: droitsAV990I(capital, b.lien),
      base757: exoneres(b) ? 0 : Math.max(0, primes - abattement757),
    };
  }
  return { parts, transmis: Object.values(parts).reduce((s, p) => s + p.capital + p.primes, 0) };
}

// ==== Simulation (option explicite, jamais "auto") =====================
function simulerAvecOption(e, option) {
  const hypotheses = [], horsPerimetre = [
    "Frères, sœurs et neveux",
    "Pacte Dutreil",
    "Démembrement de clause bénéficiaire",
    "Quasi-usufruit",
    "Action en retranchement",
    "Successions internationales",
    "Contrats d'assurance-vie antérieurs à 1991",
    "Droits des enfants non communs au décès du beau-parent",
  ];
  const masse = masseDe(e);
  const M = masse.masseNette;
  const dev = devolution(e, M, option, hypotheses, horsPerimetre);
  const av = repartirAV(e, hypotheses);
  const rappelOpts = { donations: e.donations, annee: e.annee };
  const heritiers = [];

  if (dev.partenaire) {
    const p = dev.partenaire;
    const id = e.situation === "mariage" ? "conjoint" : "partenaire";
    const a = av.parts[id] || { capital: 0, primes: 0, droits990: 0, base757: 0 };
    let droitsSuccession = 0, droitsAV = 0, abattement = 0, baseTaxable = 0;
    if (p.lien === "concubin") {
      droitsSuccession = droitsConcubin(p.recu);
      droitsAV = a.droits990 + droitsConcubin(p.recu + a.base757) - droitsSuccession;
      abattement = Math.min(p.recu + a.base757, DMTG.CONCUBIN.abattement);
      baseTaxable = Math.max(0, p.recu + a.base757 - DMTG.CONCUBIN.abattement);
    }
    if (p.recu > 0 || a.capital + a.primes > 0 || p.lien !== "concubin") {
      const droitsTotal = cts(droitsSuccession + droitsAV);
      heritiers.push({
        id, lien: p.lien, droitsDetenus: p.droitsDetenus,
        recuSuccession: p.recu, avHorsSuccession: cts(a.capital + a.primes), base757B: cts(a.base757),
        abattement: cts(abattement), baseTaxable: cts(baseTaxable),
        droitsSuccession: cts(droitsSuccession), droitsAV: cts(droitsAV), droitsTotal,
        net: cts(p.recu + a.capital + a.primes - droitsTotal),
      });
    }
  }

  if (e.enfants > 0) {
    const part = dev.enfantsTotal / e.enfants;
    for (let i = 1; i <= e.enfants; i++) {
      const id = `enfant${i}`;
      const a = av.parts[id] || { capital: 0, primes: 0, droits990: 0, base757: 0 };
      const seul = droitsEnfant(part, rappelOpts);
      const total = droitsEnfant(part + a.base757, rappelOpts);
      const droitsAV = a.droits990 + total.droits - seul.droits;
      const droitsTotal = cts(seul.droits + droitsAV);
      heritiers.push({
        id, lien: "enfant", droitsDetenus: dev.enfantsDetenus,
        recuSuccession: cts(part), avHorsSuccession: cts(a.capital + a.primes), base757B: cts(a.base757),
        abattement: cts(total.abattement), baseTaxable: cts(total.base),
        droitsSuccession: cts(seul.droits), droitsAV: cts(droitsAV), droitsTotal,
        net: cts(part + a.capital + a.primes - droitsTotal),
      });
    }
  }

  const totalDroits = cts(heritiers.reduce((s, h) => s + h.droitsTotal, 0));
  const netTransmis = cts(heritiers.reduce((s, h) => s + h.net, 0));
  const denominateur = M + av.transmis;
  const tauxEffectif = denominateur > 0 ? Math.round(totalDroits / denominateur * 1000) / 10 : 0; // en %
  const resultat = {
    masse,
    optionRetenue: masse.attributionIntegrale ? "attribution_integrale" : (e.situation === "mariage" && e.enfants > 0 ? option : "aucune"),
    optionsPossibles: optionsPossibles(e),
    heritiers, totalDroits, netTransmis, tauxEffectif, hypotheses, horsPerimetre,
  };
  return { resultat, ppConjoint: dev.partenaire ? dev.partenaire.pp : 0, usufruitConjoint: dev.partenaire ? dev.partenaire.recu - dev.partenaire.pp : 0 };
}

export function simulerSuccession(entree) {
  const e = normaliser(entree);
  const possibles = optionsPossibles(e);
  const preAvis = [];
  let option = e.optionConjoint;
  if (possibles.length > 0) {
    if (option === "auto") {
      // Meilleure option réelle (la ligne « communauté universelle » est un changement de régime, pas une option)
      const meilleure = comparerOptionsConjoint(e).find((l) => OPTIONS_CONJOINT.includes(l.option));
      option = meilleure ? meilleure.option : "quart_pp";
    } else if (!possibles.includes(option)) {
      preAvis.push(`Option « ${option} » impossible dans cette situation : repli sur le quart en pleine propriété.`);
      option = "quart_pp";
    }
  }
  const { resultat } = simulerAvecOption(e, option);
  return { ...resultat, hypotheses: [...preAvis, ...resultat.hypotheses] };
}

// ==== Comparaison des options du conjoint (1er + 2e décès) ============
function evaluerOption(e, option) {
  const cu = option === "communaute_universelle";
  const e1 = cu ? { ...e, regime: "communaute_universelle" } : e;
  const { resultat: r, ppConjoint, usufruitConjoint } = simulerAvecOption(e1, cu ? "quart_pp" : option);
  const enfantsH = r.heritiers.filter((h) => h.lien === "enfant");
  const conjoint = r.heritiers.find((h) => h.lien === "conjoint");
  const droits1 = cts(enfantsH.reduce((s, h) => s + h.droitsTotal, 0));
  // 2e décès à valeurs constantes : l'usufruit s'éteint sans droits (art. 1133), pas de donation rappelée
  const patrimoine2 = Math.max(0, e.patrimoineConjointPropre + r.masse.partCommuneConjoint + ppConjoint + (conjoint ? conjoint.avHorsSuccession : 0) - DMTG.FORFAIT_FUNERAIRE);
  const communs = e.enfants - e.enfantsNonCommuns;
  const droits2 = communs > 0 ? cts(communs * droitsEnfant(patrimoine2 / communs).droits) : 0;
  const net1 = enfantsH.reduce((s, h) => s + h.net, 0);
  return {
    option,
    droits1erDeces: droits1,
    droits2eDeces: droits2,
    total: cts(droits1 + droits2),
    // l'usufruit du conjoint s'éteint au 2e décès : sa valeur revient aux enfants en pleine propriété
    netEnfants: cts(net1 + usufruitConjoint + (communs > 0 ? patrimoine2 - droits2 : 0)),
  };
}

export function comparerOptionsConjoint(entree) {
  const e = normaliser(entree);
  if (e.situation !== "mariage" || e.enfants === 0) return [];
  const lignes = optionsPossibles(e).map((o) => evaluerOption(e, o));
  lignes.push(evaluerOption(e, "communaute_universelle")); // changement de régime (clause d'attribution intégrale)
  return lignes.sort((a, b) => a.total - b.total);
}

// ==== Donation en nue-propriété =======================================
export function calendrierAbattements(age, annee, ageMax = 90) {
  const lignes = [];
  for (let k = 0; Number(age) + k * DMTG.RAPPEL_FISCAL_ANS <= ageMax; k++) {
    const a = Number(age) + k * DMTG.RAPPEL_FISCAL_ANS;
    lignes.push({ annee: annee + k * DMTG.RAPPEL_FISCAL_ANS, age: a, abattementParEnfant: DMTG.ABATTEMENT_ENFANT, nuePropriete: valeurUsufruit(a).nuePropriete });
  }
  return lignes;
}

export function simulerDonationNP({ valeur, ageDonateur, enfants, donations = [], annee, croissance = 0, anneesAvantDeces = 0 } = {}) {
  const n = Math.max(1, Math.floor(Number(enfants) || 1));
  const v = Math.max(0, Number(valeur) || 0);
  const an = annee ?? ANNEE_REF;
  const np = valeurUsufruit(ageDonateur).nuePropriete;
  const partNP = v * np / 100 / n;
  const droitsDonation = cts(n * droitsEnfant(partNP, { donations, annee: an }).droits);
  const valeurDeces = v * Math.pow(1 + (Number(croissance) || 0), Number(anneesAvantDeces) || 0);
  const droitsSansDonation = cts(n * droitsEnfant(valeurDeces / n, { donations, annee: an + (Number(anneesAvantDeces) || 0) }).droits);
  return {
    nuePropriete: np,
    valeurNP: cts(partNP * n),
    droitsDonation,
    droitsSansDonation,
    economie: cts(droitsSansDonation - droitsDonation),
    calendrier: calendrierAbattements(ageDonateur, an),
  };
}

// ==== Adaptateur : profil de l'application -> entrée normalisée =======
// Libellés des lignes de placements reprises comme actifs du défunt (assurance-vie et PER sont traités à part).
const LIBELLES_PLACEMENTS = Object.freeze({
  livretA: "Livret A", ldds: "LDDS", lep: "LEP", livretJeune: "Livret Jeune", livretBancaire: "Livret bancaire", pel: "PEL",
  pea: "PEA", cto: "Compte-titres", scpi: "SCPI", orPhysique: "Or physique", plateformeCrypto: "Crypto (plateforme)", coldWallet: "Crypto (cold wallet)", epargneSalariale: "Épargne salariale",
});
const COMPTES_HORS_ACTIFS = Object.freeze(["assuranceVie", "assuranceVieUC", "per"]);

// Sémantique retenue (profil de l'application) :
//  - foyer : « seul » si foyer.actif est faux, « concubin » si foyer.statut vaut "concubin", sinon marié (même règle que situationDe d'app.js) ;
//  - logement.valeur = valeur du logement ENTIER, logement.part = % détenu par l'utilisateur : on retient valeur × part ;
//    logement.creditRestant = capital restant dû pour sa part (déjà proportionné, pas de nouvelle quote-part) ;
//  - placements.* : tout ce que le profil déclare (épargne du couple quand il est marié) = actifs du défunt ;
//    assuranceVieUC est ajoutée à l'assurance-vie (même contrat, même régime fiscal au décès) ;
//  - conjoint.pea.versements : seule valeur connue des actifs propres du conjoint (proxy des sommes placées) ;
//  - mariage hors séparation de biens : tout est « commun » (RP, placements, PEA du conjoint), sauf succession.biensPropres
//    (héritages, donations reçues) transférés vers une ligne « propre » ; sinon les biens de l'utilisateur sont « propre »
//    (sa quote-part, ou son compte) et ceux du conjoint vont dans patrimoineConjoint.propre.
export function entreeDepuisProfil(profil, annee = 2026) {
  const p = profil ?? {}, s = p.succession ?? {};
  const euros = (x) => Math.max(0, Number(x) || 0);
  const foyerActif = !!p.foyer?.actif;
  const unionPacs = s.union === "pacs";
  const situation = !foyerActif ? "seul" : p.foyer?.statut === "concubin" ? "concubin" : unionPacs ? "pacs" : "mariage";
  const regime = situation === "mariage" && ["separation", "communaute_universelle"].includes(s.regime) ? s.regime : "communaute_legale";
  const commun = situation === "mariage" && regime !== "separation";
  const natureBiens = commun ? "commun" : "propre";

  const actifs = [];
  const logement = p.logement ?? {};
  if (p.proprietaire) {
    const part = Number(logement.part) > 0 ? Math.min(100, Number(logement.part)) : 100;
    const valeur = euros(logement.valeur) * part / 100;
    if (valeur > 0) actifs.push({ libelle: "Logement", valeur, nature: natureBiens, rp: (logement.usage ?? "rp") === "rp" });
  }
  for (const [cle, v] of Object.entries(p.placements ?? {})) {
    if (COMPTES_HORS_ACTIFS.includes(cle) || euros(v) <= 0) continue;
    actifs.push({ libelle: LIBELLES_PLACEMENTS[cle] ?? cle, valeur: euros(v), nature: natureBiens, rp: false });
  }
  const peaConjoint = foyerActif && p.conjoint?.pea?.ouvert ? euros(p.conjoint.pea.versements) : 0;
  let propreConjoint = 0;
  if (peaConjoint > 0) {
    if (commun) actifs.push({ libelle: "PEA du conjoint", valeur: peaConjoint, nature: "commun", rp: false });
    else propreConjoint = peaConjoint;
  }
  // Biens propres déclarés : prélevés sur les lignes communes non-RP, dans l'ordre, dans la limite du disponible
  if (commun) {
    let reste = euros(s.biensPropres), transfere = 0;
    for (const a of actifs) {
      if (reste <= 0) break;
      if (a.nature !== "commun" || a.rp) continue;
      const pris = Math.min(a.valeur, reste);
      a.valeur -= pris; reste -= pris; transfere += pris;
    }
    if (transfere > 0) actifs.push({ libelle: "Biens propres déclarés", valeur: transfere, nature: "propre", rp: false });
  }

  const dettes = [];
  const credit = p.proprietaire ? euros(logement.creditRestant) : 0;
  const quotite = Math.min(100, Math.max(0, s.quotiteAssuranceEmprunteur == null ? 100 : Number(s.quotiteAssuranceEmprunteur) || 0));
  if (credit > 0) dettes.push({ libelle: "Crédit immobilier restant dû", montant: credit * (1 - quotite / 100), nature: natureBiens });

  const valeurAV = euros(p.placements?.assuranceVie) + euros(p.placements?.assuranceVieUC);
  const apres70 = euros(p.assuranceVie?.versementsApres70);
  const d = s.donationAnterieure ?? {};
  const donations = euros(d.montantParEnfant) > 0 && Number.isFinite(Number(d.annee)) && d.annee != null && d.annee !== ""
    ? [{ annee: Number(d.annee), montant: euros(d.montantParEnfant) }] : [];
  return {
    annee,
    ageDefunt: Number(p.age) || 0,
    situation,
    regime,
    ageConjoint: foyerActif ? Number(p.conjoint?.age) || 0 : 0,
    enfants: Math.max(0, Math.round(Number(p.enfants) || 0)),
    enfantsNonCommuns: Math.max(0, Math.round(Number(s.enfantsNonCommuns) || 0)),
    optionConjoint: s.optionConjoint || "auto",
    donationDernierVivant: !!s.donationDernierVivant,
    testament: !!s.testament,
    enfantMineurAuFoyer: !!s.enfantMineurAuFoyer,
    actifs,
    dettes,
    assuranceVie: { avant70: Math.max(0, valeurAV - apres70), apres70Primes: apres70 },
    per: { valeur: euros(p.placements?.per) },
    clauseAV: s.clauseAV === "enfants" ? "enfants" : "conjoint_puis_enfants",
    donations,
    patrimoineConjoint: { propre: propreConjoint },
  };
}

// ==== Droits de succession sur le registre final d'une décumulation ===
// Le registre (pension.js : livrets, PEA, CTO, AV avant/après 70 ans, PER, autres) est celui du dernier exercice simulé.
// Hypothèses :
//  - les lignes financières sont reprises au registre, nettes des prélèvements sociaux dus au décès (PEA : PS sur les gains ;
//    AV : PS du patrimoine sur les gains), comme le fait impotsAuDeces de pension.js, pour ne pas les compter deux fois ;
//  - le registre ne suit pas l'immobilier : le logement du profil est conservé à valeur constante, son crédit est supposé remboursé ;
//  - l'AV après 70 ans est traitée avec ses primes (art. 757 B) ; ses gains rejoignent l'AV d'avant 70 ans (art. 990 I), hypothèse prudente ;
//  - `echelle` ramène les valeurs du registre en euros constants (1 / déflateur) : les barèmes ne sont pas indexés ;
//  - la nature commun/propre, la dévolution et le rappel fiscal viennent de entreeDepuisProfil (aucune logique dupliquée) ;
//    l'âge du conjoint est décalé comme celui du défunt.
// Retour : droits sur toute la succession (`totalDroits`) et part attribuable aux placements (`droitsPlacements`, différence avec
// la même succession sans placements : la résidence principale n'est pas imputée aux placements).
export function droitsSurRegistre(profil, registre, { annee = 2026, ageDefunt, echelle = 1, prelevements = PRELEVEMENTS } = {}) {
  const p = profil ?? {}, reg = registre ?? {};
  const nb = (x) => Math.max(0, Number(x) || 0);
  const k = Number(echelle) > 0 ? Number(echelle) : 1;
  const ageFinal = Number(ageDefunt) > 0 ? Number(ageDefunt) : Number(p.agePrincipal ?? p.age) || 0;
  const decalage = ageFinal - (Number(p.agePrincipal ?? p.age) || 0);
  const psPEA = nb(prelevements?.PS_CAPITAL) / 100, psAV = nb(prelevements?.PS_PATRIMOINE) / 100;
  const netAV = (c = {}) => nb(c.valeur) - Math.max(0, nb(c.valeur) - nb(c.primes)) * psAV;
  const placements = {};
  const ajouter = (cle, v) => { if (v > 0) placements[cle] = (placements[cle] ?? 0) + v * k; };
  ajouter("livretBancaire", nb(reg.livrets?.valeur));
  ajouter("pea", nb(reg.pea?.valeur) - Math.max(0, nb(reg.pea?.valeur) - nb(reg.pea?.versements)) * psPEA);
  ajouter("cto", nb(reg.cto?.valeur));
  ajouter("per", nb(reg.per?.valeur));
  for (const a of Array.isArray(reg.autres) ? reg.autres : []) ajouter(String(a.id ?? "autre"), nb(a.valeur));
  const av70 = netAV(reg.av?.apres70), avAvant = netAV(reg.av?.avant70);
  ajouter("assuranceVie", av70 + avAvant);
  const profilFinal = (pl, apres70) => ({
    ...p,
    age: ageFinal,
    conjoint: p.conjoint ? { ...p.conjoint, age: (Number(p.conjoint.age) || ageFinal) + decalage } : p.conjoint,
    placements: pl,
    assuranceVie: { ...(p.assuranceVie ?? {}), versementsApres70: apres70 },
    logement: { ...(p.logement ?? {}), creditRestant: 0 },
  });
  const primes70 = Math.min(nb(reg.av?.apres70?.primes) * k, placements.assuranceVie ?? 0);
  const avecPlacements = simulerSuccession(entreeDepuisProfil(profilFinal(placements, primes70), annee));
  const sansPlacements = simulerSuccession(entreeDepuisProfil(profilFinal({}, 0), annee));
  return {
    totalDroits: avecPlacements.totalDroits,
    netTransmis: avecPlacements.netTransmis,
    tauxEffectif: avecPlacements.tauxEffectif,
    optionRetenue: avecPlacements.optionRetenue,
    droitsPlacements: cts(Math.max(0, avecPlacements.totalDroits - sansPlacements.totalDroits)),
  };
}
