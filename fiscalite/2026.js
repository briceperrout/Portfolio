// =====================================================================
//  FISCALITÉ 2026 — source unique des barèmes, taux et plafonds réglementaires.
//  Millésime : loi de finances 2026 (19 février 2026), revenus 2025.
//  fiscal.js réexporte ces valeurs sous leurs noms historiques ; aucun module
//  ne doit recoder un barème, un plafond ou un taux réglementaire.
//  Mise à jour annuelle : copier ce fichier en 2027.js, changer l'import de
//  fiscal.js, relancer les tests. Données pures, aucun DOM.
// =====================================================================

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export const FISCALITE_2026 = deepFreeze({
  millesime: 2026,
  loiDeFinances: "LF 2026",
  revenus: 2025,
  verifieLe: "2026-11-17",

  ir: {
    // Barème progressif : [plafond de la tranche, taux %] — art. 197 CGI, tranches relevées de 0,9 % par la LF 2026
    bareme: [[11600, 0], [29579, 11], [84577, 30], [181917, 41], [Infinity, 45]],
    // Décote — art. 197 I-4 CGI : seuils en € d'impôt brut, taux en %
    decote: { seul: 897, couple: 1483, taux: 45.25 },
    // Avantage maximal par demi-part pour enfant — art. 197 I-2 CGI
    plafondDemiPart: 1807,
  },

  // Taux de prélèvement en % : source unique pour plan.js, evolution-fiscale.js et locatif.js
  prelevements: {
    IR_PFU: 12.8,           // part impôt sur le revenu du prélèvement forfaitaire unique — art. 200 A CGI
    PS_CAPITAL: 18.6,       // LFSS 2026 : dividendes, intérêts, plus-values, PEA
    PS_PATRIMOINE: 17.2,    // assurance-vie, revenus fonciers, plus-values immobilières
    IR_AV_8ANS: 7.5,        // assurance-vie de plus de 8 ans (après abattement) — art. 125-0 A CGI
    CSG_CRDS_ACTIVITE: 9.7, // CSG et CRDS sur l'abondement et l'épargne salariale
    IR_PV_IMMO: 19,         // impôt sur la plus-value immobilière des particuliers — art. 200 B CGI
    VERIFIE_LE: "2026-11-16",
  },

  // Assurance-vie, rachats — art. 125-0 A CGI, non indexé
  assuranceVie: {
    abattement: { seul: 4600, couple: 9200 },
    seuilPrimes: 150000, // primes nettes, non indexé
  },

  // Droits de mutation à titre gratuit (successions et donations) — barème inchangé par la LF 2026
  // Tranches : [plafond de la tranche, taux %].
  dmtg: {
    BAREME_LIGNE_DIRECTE: [[8072, 5], [12109, 10], [15932, 15], [552324, 20], [902838, 30], [1805677, 40], [Infinity, 45]], // art. 777 CGI
    ABATTEMENT_ENFANT: 100000,      // art. 779 I, par parent et par enfant
    RAPPEL_FISCAL_ANS: 15,          // art. 784
    CONCUBIN: { abattement: 1594, taux: 60 }, // art. 777 tableau III + 788 IV
    ABATTEMENT_RP: 20,              // % — art. 764 bis
    FORFAIT_FUNERAIRE: 1500,        // art. 775
    VERIFIE_LE: "2026-11-17",
  },
  avDeces: {
    ABATTEMENT_990I: 152500, SEUIL_990I: 700000, TAUX_990I: [20, 31.25], // art. 990 I, par bénéficiaire
    ABATTEMENT_757B: 30500,  // art. 757 B, global, sur les primes seulement
    AGE_PIVOT: 70,
    VERIFIE_LE: "2026-11-17",
  },
  // Art. 669 CGI : [âge de l'usufruitier strictement inférieur à, % de l'usufruit]
  baremeUsufruit: [[21, 90], [31, 80], [41, 70], [51, 60], [61, 50], [71, 40], [81, 30], [91, 20], [Infinity, 10]],
  // Revenus 2025 (IR 2026) : plancher par pensionné, plafond par foyer ; la LF 2026 (19/02/2026) a conservé l'abattement de 10 % — art. 158 CGI
  abattementPensions: { taux: 10, plancher: 454, plafond: 4439, VERIFIE_LE: "2026-11-17" },

  // INDÉPENDANTS — micro-entreprise, SASU, EURL à l'IS
  independants: {
    micro: {
      // cotisations : % du CA ; abattement : abattement forfaitaire de l'impôt ; vl : versement libératoire (% du CA)
      // BNC 25,6 % : taux 2026 SSI non réglementé ; CIPAV (23,2 %) hors périmètre ; contribution formation professionnelle non incluse
      bnc: { cotisations: 25.6, abattement: 34, vl: 2.2, seuil: 83600 },
      bicServices: { cotisations: 21.2, abattement: 50, vl: 1.7, seuil: 83600 },
      bicVente: { cotisations: 12.3, abattement: 71, vl: 1.0, seuil: 203100 },
      abattementMin: 305,
    },
    // Impôt sur les sociétés : 15 % jusqu'à 42 500 € de bénéfice (PME éligibles, art. 219 I-b du CGI), 25 % au-delà
    is: { tauxReduit: 15, plafondReduit: 42500, tauxNormal: 25 },
    // Président de SASU assimilé salarié (régime général, sans assurance chômage)
    sasu: { tauxSalarial: 22, tauxPatronal: 42, csgNonDeductible: 2.9, assietteCsg: 98.25 },
    // Gérant majoritaire d'EURL (TNS) : taux effectif simplifié sur la rémunération nette
    tns: { tauxSurNet: 45, csgNonDeductible: 2.9, abattementAssiette: 26 },
    // Frais professionnels forfaitaires de 10 % (plafond à vérifier chaque année) : salaires SASU et gérant EURL (art. 62)
    abattement10: { taux: 10, plafond: 14426 },
    // Dividendes d'EURL soumis aux cotisations TNS au-delà de 10 % du capital + primes d'émission + comptes courants d'associés
    seuilDividendesEURL: 10,
  },

  // Exit tax — art. 167 bis CGI
  exitTax: {
    SEUIL_TITRES: 800000,            // valeur globale des titres
    PART_BENEFICES: 50,              // ou participation ≥ 50 % des bénéfices sociaux d'une société
    ANNEES_RESIDENCE: 6,             // résidence fiscale en France au moins 6 des 10 dernières années
    FENETRE_ANNEES: 10,
    SEUIL_DEGREVEMENT_LONG: 2570000, // au-delà : dégrèvement après 5 ans, sinon 2 ans
    DEGREVEMENT_COURT: 2,
    DEGREVEMENT_LONG: 5,
    VERIFIE_LE: "2026-11-17",
  },

  // Plus-values sur valeurs mobilières (compte-titres) : une moins-value s'impute sur les plus-values de même nature de l'année,
  // puis se reporte sur les années suivantes — art. 150-0 D CGI
  plusValues: { reportMoinsValuesAns: 10, VERIFIE_LE: "2026-11-17" },

  // Marché : calendrier de règlement-livraison et jours fermés de la Bourse de Paris en fin d'année.
  // Une moins-value ne compte pour l'année que si l'ordre est exécuté assez tôt pour être réglé avant le 31/12.
  // Le passage au règlement T+1 est prévu dans l'UE en octobre 2027 : 2027.js devra en tenir compte (reglementJoursOuvres: 1).
  marche: {
    reglementJoursOuvres: 2,
    feriesBourseDecembre: ["12-25", "12-26"], // MM-JJ ; les samedis et dimanches sont fermés dans tous les cas
    VERIFIE_LE: "2026-11-17",
  },

  // Plafonds réglementaires en €
  plafonds: {
    livretA: 22950,  // Livret A, par personne — art. L221-1 Code monétaire et financier
    ldds: 12000,     // LDDS, par personne
    lep: 10000,      // LEP, par personne
    pea: 150000,     // PEA, versements — art. L221-30 Code monétaire et financier
    peaPme: 225000,  // plafond cumulé PEA + PEA-PME
    pass: 48060,     // plafond annuel de la Sécurité sociale 2026 (arrêté PASS 2026)
    passN1: 47100,   // PASS 2025, base du plafond PER 2026
    // Plafond de déduction PER 2026 — art. 163 quatercdecies CGI : 10 % du PASS N-1 (plancher), 10 % de 8 PASS N-1 (plafond) ; à revérifier chaque année
    per: { plafondMin: 4710, plafondMax: 37680 },
    // Abondement de l'employeur (épargne salariale), plafonds légaux 2026 (art. L3332-11 Code du travail)
    abondement: {
      perco: 7689.6, // 16 % du PASS
      pee: 3844.8,   // 8 % du PASS
    },
    // Prêt à taux zéro : plafond d'opération pour une personne, par zone — art. L31-10-1 CCH
    ptz: { plafondOperationUnePersonne: { A: 150000, B1: 135000, B2: 110000, C: 100000 } },
  },
});
