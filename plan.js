// =====================================================================
//  MON PLAN — la seule source des recommandations
// ---------------------------------------------------------------------
//  Le moteur (moteur.js) n'a aucune opinion financière : il applique
//  uniquement ce qui est écrit ici.
//
//  Conventions :
//   - pourcentages = % du CAPITAL TOTAL (apport compris) ; 10 = 10 %
//   - montants en euros
//   - "PROPOSITION" = valeur que j'ai mise pour que le modèle tourne,
//     à remplacer par la tienne.
// =====================================================================

import { PRELEVEMENTS, PFU } from "./fiscal.js";

const AV_8ANS = Math.round((PRELEVEMENTS.IR_AV_8ANS + PRELEVEMENTS.PS_PATRIMOINE) * 10) / 10; // 24,7 %

export const PLAN = {
  version: 9,
  misAJourLe: "2026-11-11",

  // -------------------------------------------------------------------
  // 1. CLASSES D'ACTIFS
  //    L'ordre compte : c'est l'ordre dans lequel les enveloppes se
  //    remplissent (la sécurité passe avant l'apport, etc.).
  // -------------------------------------------------------------------
  classes: {
    securite: { libelle: "Épargne de sécurité",          risque: "nul" },
    projet:   { libelle: "Apport protégé",               risque: "nul" },
    prudent:  { libelle: "Assurance-vie & obligations",  risque: "faible" },
    bourse:   { libelle: "Bourse (actions)",             risque: "élevé" },
    or:       { libelle: "Or physique",                  risque: "moyen" },
    bitcoin:  { libelle: "Bitcoin",                      risque: "très élevé" },
    scpi:     { libelle: "Immobilier (SCPI)",            risque: "moyen" },
  },

  // -------------------------------------------------------------------
  // 2. ÉPARGNE DE SÉCURITÉ
  //    montant = le PLUS GRAND de (minimum, % du capital, mois de dépenses),
  //    puis limité par le plafond.
  //    → Ton plan : 10 k€ à 30 k€ de capital, 10 % à 100 k€.
  //      "max(10 000 €, 10 %)" donne exactement ces deux points.
  // -------------------------------------------------------------------
  securite: {
    minimum: 10000,
    pourcentCapital: 10,
    plafondPourcentCapital: 50,   // la sécurité ne dépasse jamais 50 % du capital (même sous le minimum)
    moisDepenses: null,   // ex. 6 → au moins 6 mois de dépenses ; null = ignoré
    plafond: null,        // ex. 40000 → la sécurité ne dépasse jamais 40 k€ ; null = sans plafond
    // Revenus irréguliers : au moins N mois de dépenses selon la situation professionnelle
    moisDepensesSelonStatut: { independant: 6, precaire: 4 },  // PROPOSITION
  },

  // -------------------------------------------------------------------
  // 2 bis. PROFILS DE RISQUE
  //    Chaque proche choisit le sien. « dynamique » = le plan tel qu'il est
  //    écrit ; les deux autres l'adoucissent :
  //    partPrudente   : % du capital placé d'emblée en assurance-vie & obligations
  //    decalageAge    : années ajoutées à l'âge de départ du passage à la prudence
  //    multiplicateurs: coefficient appliqué aux % des paliers (1 = inchangé)
  // -------------------------------------------------------------------
  profilsRisque: {
    defaut: "dynamique",
    prudent:   { libelle: "Prudent",   partPrudente: 30, decalageAge: -10, multiplicateurs: { bitcoin: 0.2, or: 1, scpi: 1 } },  // PROPOSITION
    equilibre: { libelle: "Équilibré", partPrudente: 15, decalageAge: -5,  multiplicateurs: { bitcoin: 0.5, or: 1, scpi: 1 } },  // PROPOSITION
    dynamique: { libelle: "Dynamique", partPrudente: 0,  decalageAge: 0,   multiplicateurs: { bitcoin: 1,   or: 1, scpi: 1 } },  // ton plan
  },

  // -------------------------------------------------------------------
  // 3. PALIERS DE CAPITAL
  //    % du capital total pour chaque classe. La "classeReste" reçoit
  //    tout ce qui n'est pas attribué (après la sécurité).
  //    Transition progressive : entre deux paliers, interpolation
  //    linéaire selon le capital. Sous le 1er palier → 1er palier ;
  //    au-dessus du dernier → dernier palier.
  // -------------------------------------------------------------------
  classeReste: "bourse",
  paliers: [
    { capital: 30000,  cibles: { bitcoin: 10, or: 0,  scpi: 0  } },  // ton plan
    { capital: 100000, cibles: { bitcoin: 10, or: 10, scpi: 0  } },  // ton plan
    { capital: 300000, cibles: { bitcoin: 10, or: 10, scpi: 10 } },  // ton plan
  ],

  // -------------------------------------------------------------------
  // 4. AJUSTEMENT SELON L'ÂGE
  //    À partir de ageDebut, chaque année on bascule pointsParAn points
  //    de % des classes risquées vers "prudent" (assurance-vie &
  //    obligations), sans dépasser maxPoints au total.
  //    vitesseRelative : comment l'effort se répartit entre classes
  //    risquées (au prorata du montant détenu × vitesse). 2 = deux fois
  //    plus vite.
  // -------------------------------------------------------------------
  age: {
    ageDebut: 45,          // PROPOSITION
    pointsParAn: 1.5,      // PROPOSITION → à 65 ans : 30 points basculés
    maxPoints: 40,         // PROPOSITION
    vitesseRelative: { bitcoin: 2, bourse: 1 },  // PROPOSITION : le bitcoin se réduit plus vite
  },

  // -------------------------------------------------------------------
  // 5. PROTECTION DE L'APPORT
  //    Les % des paliers s'appliquent au capital apport compris ; la part
  //    à protéger est ensuite PRÉLEVÉE sur les classes risquées (dans
  //    l'ordre donné) et placée dans la classe "projet".
  // -------------------------------------------------------------------
  apport: {
    protection: [                                // part de l'apport à sécuriser
      { horizonMaxAnnees: 2,    part: 100 },  // achat dans 2 ans ou moins
      { horizonMaxAnnees: 5,    part: 50 },   // validé
      { horizonMaxAnnees: null, part: 0 },    // null = au-delà : l'apport reste investi
    ],
    prelevementSur: ["bourse", "bitcoin", "or", "scpi", "prudent"],
    // Achat IMPÉRATIF de la résidence principale dans les N ans : la part
    // de l'apport qui ne viendra pas de l'épargne future est protégée à ce %.
    horizonImperatifMax: 5,
    partSiImperatif: 100,   // PROPOSITION
  },

  // -------------------------------------------------------------------
  // 5 bis. RÉÉQUILIBRAGE DES PLACEMENTS EXISTANTS
  //    L'épargne du mois comble d'abord les manques. Les excédents sont
  //    déplacés progressivement, sur dureeMois. Les écarts inférieurs à la
  //    tolérance sont ignorés (pas d'aller-retour pour quelques euros).
  // -------------------------------------------------------------------
  // Frais de référence (contrat + supports, % par an) déjà compris dans les rendements du plan ;
  // des frais plus élevés saisis dans « Mon profil » sont retirés en plus du rendement
  fraisReference: { assuranceVie: 0.7, per: 0.7, bourse: 0.2 },

  reequilibrage: {
    dureeMois: 12,              // PROPOSITION
    dureeMaxMois: 60,           // PROPOSITION : en automatique, on ne déplace pas chaque mois plus que l'épargne du mois, sur 5 ans au plus
    toleranceEuros: 500,        // PROPOSITION
    sansRetraitAvantAnnees: { pea: 5 },  // un retrait avant 5 ans clôture le PEA (le PER, lui, est bloqué jusqu'à la retraite)
    // true : l'excédent d'un fonds euros passe en unités de compte DANS le
    // même contrat (et inversement), sans impôt et sans perdre l'ancienneté,
    // plutôt qu'un rachat imposable vers le PEA.
    arbitrageInterne: true,     // PROPOSITION
    // Comptes qu'on ne vend jamais : l'excédent est gardé, on arrête simplement d'en acheter
    jamaisVendre: ["orPhysique"],
    // Comptes où chaque vente coûte des frais (courtage, plateforme) : on vend en une fois par an,
    // et pas du tout pour un petit excédent (l'épargne du mois rééquilibre à la place)
    venteGroupee: ["pea", "cto", "plateformeCrypto", "coldWallet", "scpi"],
    venteMinimum: 1000,         // PROPOSITION : en dessous, pas de vente
    venteUniqueJusqua: 5000,    // PROPOSITION : jusqu'à ce montant, tout est vendu en une seule fois
  },

  // -------------------------------------------------------------------
  // 6. ENVELOPPES ET ORDRE DE REMPLISSAGE
  //    plafond = plafond de versements (null = aucun).
  //    Les enveloppes sont partagées : si la sécurité occupe déjà le
  //    Livret A, l'apport passe à l'enveloppe suivante.
  //    ⚠ Plafonds à revérifier lors de la rédaction des fiches.
  // -------------------------------------------------------------------
  enveloppes: {
    livretA:          { libelle: "Livret A",                          plafond: 22950,  fiche: "livret-a", parPersonne: true },
    ldds:             { libelle: "LDDS",                              plafond: 12000,  fiche: "ldds", parPersonne: true },
    lep:              { libelle: "LEP (livret d'épargne populaire)",  plafond: 10000,  fiche: "lep", parPersonne: true, condition: "eligibleLEP" },
    livretJeune:      { libelle: "Livret Jeune (12 à 25 ans)",        plafond: 1600,   fiche: "livret-jeune", parPersonne: true, condition: "jeune" },  // taux libre, jamais sous celui du Livret A, sans impôt  // sous conditions de revenus
    livretBancaire:   { libelle: "Livret bancaire fiscalisé (super livret)", plafond: null, fiche: "livret-bancaire" },  // livret d'épargne classique d'une banque, intérêts imposés
    pel:              { libelle: "PEL (plan d'épargne logement)",     plafond: 61200,  fiche: "pel", parPersonne: true, nouveauxVersements: false },  // un retrait clôture le PEL : on garde l'existant
    assuranceVie:     { libelle: "Assurance-vie (fonds euros)",       plafond: null,   fiche: "assurance-vie", arbitrageDepuis: "assuranceVieUC" },
    assuranceVieUC:   { libelle: "Assurance-vie (unités de compte)",  plafond: null,   fiche: "assurance-vie", arbitrageDepuis: "assuranceVie" },
    pea:              { libelle: "PEA",                               plafond: 150000, fiche: "pea", parPersonne: true },
    cto:              { libelle: "Compte-titres (CTO)",               plafond: null,   fiche: "cto" },
    orPhysique:       { libelle: "Or physique (pièces / lingots)",    plafond: null,   fiche: "or" },
    plateformeCrypto: { libelle: "Plateforme crypto agréée",          plafond: null,   fiche: "bitcoin" },
    coldWallet:       { libelle: "Portefeuille matériel (cold wallet)", plafond: null, fiche: "bitcoin", transfertDepuis: "plateformeCrypto" },  // on transfère ses bitcoins, on ne les vend pas
    scpi:             { libelle: "SCPI",                              plafond: null,   fiche: "scpi" },
    per:              { libelle: "PER (plan d'épargne retraite)",     plafond: null,   fiche: "per" },
    epargneSalariale: { libelle: "Épargne salariale (PEE, PER d'entreprise)", plafond: null, fiche: "epargne-salariale", nouveauxVersements: false },  // alimentée seulement pour toucher l'abondement
  },

  // Une entrée = un id d'enveloppe, ou { id, max } pour limiter le montant
  // de CETTE classe dans cette enveloppe.
  // L'argent DÉJÀ placé sur une enveloppe autorisée y reste en priorité
  // (pas de transfert inutile) ; l'argent neuf suit l'ordre de la liste.
  remplissage: {
    securite: ["lep", "livretJeune", "livretA", "ldds", "livretBancaire"],
    projet:   ["lep", "livretJeune", "livretA", "ldds", "pel", "livretBancaire", "assuranceVie"],  // PEL : seulement l'existant ; assurance-vie : fonds euros
    prudent:  ["assuranceVie"],
    bourse:   ["pea", "cto", "assuranceVieUC", "epargneSalariale", "per"],  // l'AV en unités de compte existante est conservée, l'argent neuf va au PEA puis au CTO
    or:       ["orPhysique"],
    bitcoin:  [{ id: "plateformeCrypto", max: 5000 }, "coldWallet"],  // au-delà de 5 k€ de bitcoin, on sort sur un cold wallet
    scpi:     ["scpi"],
  },

  // Ce qu'on achète avec la part bourse (PEA, compte-titres, AV en unités de compte, PER)
  investissementBourse: [
    { nom: "ETF S&P 500", part: 70, exemples: "Amundi PEA S&P 500 (FR0011871128) ou BNP Paribas Easy S&P 500 (FR0011550185)", devises: { "Dollar (USD)": 100 } },  // ton plan
    { nom: "ETF STOXX Europe 600", part: 30, exemples: "BNP Paribas Easy STOXX Europe 600 (FR0011550193)", devises: { "Euro (EUR)": 51, "Livre (GBP)": 23, "Franc suisse (CHF)": 15, "Autres (SEK, DKK, NOK)": 11 } },  // ton plan : poids par pays, environ
  ],

  // LEP : réservé aux revenus modestes (revenu fiscal de référence 2026)
  lep: { seuilRFR1Part: 23028, seuilRFRCouple: 35326 },

  // -------------------------------------------------------------------
  // 6 quinquies. RÉSIDENCE FISCALE HORS DE FRANCE
  //    Les comptes réservés aux résidents français ne reçoivent plus d'argent
  //    neuf (un compte existant est conservé). Les gains sont imposés dans le
  //    pays de résidence : taux moyen approximatif, à vérifier sur place.
  // -------------------------------------------------------------------
  residence: {
    reserveesFrance: ["pea", "per", "lep", "livretJeune", "livretA", "ldds", "pel"],
    pays: {
      FR: { libelle: "France" },
      BE: { libelle: "Belgique",    impotGains: 10,   equivalents: "épargne-pension (3e pilier), compte d'épargne réglementé belge" },
      CH: { libelle: "Suisse",      impotGains: 0,    equivalents: "3e pilier A (déductible) ; plus-values privées exonérées, mais impôt sur la fortune cantonal" },
      LU: { libelle: "Luxembourg",  impotGains: 0,    equivalents: "prévoyance-vieillesse (art. 111bis) ; plus-values sur actions détenues plus de 6 mois exonérées" },
      DE: { libelle: "Allemagne",   impotGains: 26.4, equivalents: "abattement annuel de 1 000 € sur les revenus du capital" },
      ES: { libelle: "Espagne",     impotGains: 23,   equivalents: "plan de pensiones ; barème de l'épargne de 19 à 30 %" },
      PT: { libelle: "Portugal",    impotGains: 28,   equivalents: "PPR (plano poupança reforma)" },
      GB: { libelle: "Royaume-Uni", impotGains: 24,   equivalents: "ISA (20 000 £ par an, gains exonérés), pension (SIPP)" },
      CA: { libelle: "Canada",      impotGains: 20,   equivalents: "CELI (gains exonérés) et REER (déductible)" },
      AUTRE: { libelle: "Autre pays", impotGains: 25, equivalents: "" },
    },
  },

  // Répartition interne de la classe "prudent" (dans l'assurance-vie)
  repartitionPrudent: { fondsEuros: 60, obligations: 40 },  // PROPOSITION

  // -------------------------------------------------------------------
  // 6 quater. FOYER (couple)
  //    Les montants saisis sont ceux du foyer. Les plafonds « par personne »
  //    (Livret A, LDDS, PEA) sont doublés, les salaires additionnés pour le
  //    crédit, et l'âge du plus âgé limite la durée du prêt.
  // -------------------------------------------------------------------
  foyer: {
    ageReference: "moyenne",   // PROPOSITION : "moyenne" des deux âges, ou "plus-age"
  },

  // -------------------------------------------------------------------
  // 6 ter. PER (plan d'épargne retraite)
  //    Versements déductibles du revenu imposable : intéressant quand la
  //    tranche marginale d'imposition (TMI) est élevée. Le PER prend une
  //    part de l'épargne destinée à la bourse (argent bloqué jusqu'à la
  //    retraite, sauf achat de la résidence principale).
  // -------------------------------------------------------------------
  // Abondement de l'employeur (épargne salariale), plafonds légaux 2026
  abondement: {
    plafondPERCollectif: 7689.6,  // 16 % du PASS
    plafondPEE: 3844.8,           // 8 % du PASS
    tauxMax: 300,                 // au plus 3 fois le versement du salarié
    prelevements: PRELEVEMENTS.CSG_CRDS_ACTIVITE,            // CSG et CRDS sur l'abondement (pas d'impôt sur le revenu)
  },

  per: {
    tmiMin: 30,                                   // PROPOSITION : PER conseillé à partir de 30 %
    partEpargneSelonTMI: { 30: 15, 41: 25, 45: 30 },  // PROPOSITION : % de l'épargne mensuelle versé sur le PER
    plafondMin: 4710,                             // plancher de déduction 2026 (10 % du PASS 2025)
    plafondMax: 37680,                            // plafond 2026 (10 % de 8 PASS 2025) ; à revérifier chaque année
    tmiRetraite: 11,                              // PROPOSITION : TMI supposée à la sortie (imposition des versements)
    reinvestirEconomie: true,                     // l'économie d'impôt est réépargnée
  },

  // -------------------------------------------------------------------
  // 6 bis. ÉTABLISSEMENTS
  //    Où ouvrir, garder ou transférer chaque enveloppe.
  // -------------------------------------------------------------------
  etablissements: {
    pea: {
      recommande: "Trade Republic",                              // ton choix
      aConserver: ["Trade Republic", "BoursoBank", "Fortuneo"],  // un PEA ici reste où il est
      choix: ["Trade Republic", "BoursoBank", "Fortuneo", "Bourse Direct", "Saxo", "XTB", "Autre courtier en ligne", "Banque traditionnelle"],
    },
    per: { recommande: "Linxea Spirit PER" },                 // PROPOSITION : PER en ligne en gestion libre
    assuranceVie: {
      recommande: "Linxea Spirit 2",                             // PROPOSITION : contrat en ligne en gestion libre
      choix: ["Contrat en ligne (gestion libre)", "Banque en ligne", "Gestion pilotée en ligne", "Banque traditionnelle", "Assureur ou mutuelle"],
      aConserver: ["Contrat en ligne (gestion libre)", "Banque en ligne"],
    },
  },

  // -------------------------------------------------------------------
  // 7. ÉPARGNE MENSUELLE
  //    On complète d'abord les priorités, puis on comble les écarts à la
  //    cible au prorata. Pas besoin de vendre pour se rééquilibrer.
  // -------------------------------------------------------------------
  flux: {
    priorites: ["securite", "projet"],
    // Réserves d'achat : l'argent destiné à ces classes s'accumule sur un
    // livret, avec l'épargne de précaution, jusqu'au seuil ; puis on achète.
    seuilsAchat: { or: 1000, scpi: 1000 },  // PROPOSITION : or par pièce / petit lingot, SCPI par lot de parts
  },

  // -------------------------------------------------------------------
  // 8. HYPOTHÈSES DE PROJECTION (utilisées par la vue "Trajectoire")
  //    Rendements annuels nets de frais, en %. Ce sont des hypothèses,
  //    pas des promesses.
  // -------------------------------------------------------------------
  hypotheses: {
    // Rendement annuel moyen, en %. Bourse, or, bitcoin, SCPI : bruts
    // (avant impôts, la fiscalité sera appliquée par enveloppe à la sortie).
    // Livrets et assurance-vie : nets.
    rendements: {
      securite: 2, projet: 2, prudent: 2.5, bourse: 8, or: 6, bitcoin: 10, scpi: 4,
    },
    // Volatilité annuelle (écart-type, en %) : donne la largeur de
    // l'éventail pessimiste / optimiste dans la projection.
    volatilites: {       // PROPOSITION
      securite: 0, projet: 0, prudent: 1, bourse: 16, or: 15, bitcoin: 60, scpi: 5,
    },
    // Corrélations entre classes dans les tirages au hasard : "dynamiques" (deux régimes, normal et crise : en crise,
    // bourse, bitcoin et SCPI chutent ensemble) ou "independantes" (chaque classe tirée séparément).
    correlations: "dynamiques",
    // Frais payés à l'entrée, en % de chaque versement
    fraisEntree: { scpi: 10 },  // PROPOSITION : frais de souscription SCPI courants : 8 à 12 %
    inflation: 2,
    hausseSalaireParAn: 1.5,
    epargneSuitLeSalaire: true,
    ageFinProjection: 70,
    ageRetraite: 64,               // PROPOSITION : l'épargne mensuelle s'arrête à cet âge
    valorisationImmobiliere: 2,    // PROPOSITION : % par an, comme l'inflation (valeur stable en euros d'aujourd'hui)
    simulations: 500,              // nombre de scénarios tirés au hasard pour l'éventail
  },

  // -------------------------------------------------------------------
  // 8 bis. FISCALITÉ À LA SORTIE (règles 2026, à revérifier chaque année)
  //    % prélevé sur les GAINS si l'on vendait tout. Flat tax 31,4 %
  //    (12,8 % d'impôt + 18,6 % de prélèvements sociaux) ; PEA de plus de
  //    5 ans : 18,6 % ; assurance-vie de plus de 8 ans : 7,5 % + 17,2 %
  //    (hors abattement annuel de 4 600 € / 9 200 €) ; livrets réglementés
  //    exonérés ; SCPI : tranche marginale d'impôt + 17,2 % (ici TMI 30 %).
  // -------------------------------------------------------------------
  // -------------------------------------------------------------------
  // BITCOIN : quand acheter
  //   On n'achète que si le cours est au moins « baisseMinPourAcheter » %
  //   sous son record ; sinon l'argent prévu attend sur le livret.
  // -------------------------------------------------------------------
  bitcoin: {
    recordDollars: 126000,        // record historique en dollars, 6 octobre 2025 (à mettre à jour après un nouveau record)
    dateRecord: "2025-10-06",
    baisseMinPourAcheter: 30,     // n'acheter que 30 % ou plus sous le record
  },

  // -------------------------------------------------------------------
  // ÉVOLUTION DE CARRIÈRE
  //   Hausse du salaire AU-DESSUS de l'inflation, par tranche d'âge :
  //   phases = [[jusqu'à cet âge, % par an en plus de l'inflation], ...]
  // -------------------------------------------------------------------
  carrieres: {
    defaut: "progressive",
    stable:      { libelle: "Stable : le salaire suit seulement l'inflation", phases: [[99, 0]] },
    progressive: { libelle: "Progressive : +1 % par an de plus que l'inflation jusqu'à 50 ans", phases: [[50, 1], [99, 0]] },        // PROPOSITION
    forte:       { libelle: "Forte (cadre, métier qualifié) : +2,5 % par an jusqu'à 45 ans, puis +1 % jusqu'à 55 ans", phases: [[45, 2.5], [55, 1], [99, 0]] },  // PROPOSITION
  },

  // -------------------------------------------------------------------
  // RETRAITE PUBLIQUE (estimation simplifiée, salarié du privé)
  //   Base (Assurance retraite) : salaire annuel moyen des 25 meilleures
  //   années (plafonné au PASS) × taux × trimestres / trimestres requis.
  //   Complémentaire Agirc-Arrco : points = salaire brut × taux / prix
  //   d'achat ; pension = points × valeur du point.
  // -------------------------------------------------------------------
  retraitePublique: {
    surcoteParTrimestre: 1.25,     // % de pension en plus par trimestre travaillé après l'âge légal au-delà de la durée requise
    majorationTroisEnfants: 10,    // % en plus (base et Agirc-Arrco) pour au moins 3 enfants
    ageLegal: 64,                 // nés à partir de 1969 (réforme 2023, suspendue jusqu'en 2028 pour les nés de 1964 à 1968)
    trimestresRequis: 172,        // nés à partir de 1966
    ageTauxPlein: 67,             // taux plein automatique
    tauxPlein: 50,
    decoteParTrimestre: 0.625,    // points de taux en moins par trimestre manquant (20 trimestres au plus)
    pass: 48060,                  // plafond annuel de la Sécurité sociale 2026
    agircPrixAchat: 20.1877,      // € par point, 2026
    agircValeurPoint: 1.4587,     // € par point, depuis le 1er novembre 2026 (1,4386 € avant)
    agircTauxT1: 6.2, agircTauxT2: 17,
    netSurBrutSalaire: 78,        // salaire net ≈ 78 % du brut (salarié du privé)
    netSurBrutPension: 90,        // pension nette ≈ 90 % de la brute (CSG, CRDS, CASA)
    ageDebutCarriere: 22,
    // Indépendants (SSI) : validation des trimestres et complémentaire RCI
    independants: {
      smicHoraire: 12.02, heuresParTrimestre: 150, // 1 803 € de revenu par trimestre validé en 2026
      assietteMinRetraitePct: 11.5,                // % du PASS : cotisation minimale retraite de base des TNS hors micro
      rciTauxT1: 7, rciTauxT2: 8, rciPlafondPASS: 4,
      rciValeurAchat: 21.532, rciValeurPoint: 1.335, // valeurs RCI 2025 (circulaire Cnav 2024-36), à revaloriser
      verifieLe: "2026-11-16",
    },
  },

  // -------------------------------------------------------------------
  // GARANTIES EN CAS DE FAILLITE (pour les alertes)
  // -------------------------------------------------------------------
  garanties: { depotsParBanque: 100000, assuranceParAssureur: 70000 },

  // -------------------------------------------------------------------
  // RETRAITE PAR CAPITALISATION
  //   À partir de hypotheses.ageRetraite, on se verse un revenu mensuel
  //   (en euros d'aujourd'hui, donc relevé chaque année de l'inflation)
  //   pris sur les placements, pendant dureeAnnees. Retraite publique
  //   comptée à 0 € par prudence, sauf si le proche indique un montant.
  // -------------------------------------------------------------------
  retraite: {
    dureeAnnees: 30,              // de 64 à 94 ans
    revenuMensuelDefaut: 2000,    // en euros d'aujourd'hui
    pensionDefaut: 0,             // retraite publique comptée par défaut
  },

  fiscalite: {
    verifieeLe: "2026-11-11",
    gains: {
      livretA: 0, ldds: 0, lep: 0, livretJeune: 0, livretBancaire: PFU, pel: PFU,
      assuranceVie: AV_8ANS, assuranceVieUC: AV_8ANS,
      pea: PRELEVEMENTS.PS_CAPITAL, cto: PFU,
      plateformeCrypto: PFU, coldWallet: PFU,
      scpi: 30 + PRELEVEMENTS.PS_PATRIMOINE /* TMI 30 % supposée */, per: PFU,
    },
    // Or : le moins cher des deux régimes
    or: { taxeForfaitaire: 11.5, plusValue: 37.6, abattementParAnApres2Ans: 5 },
  },

  // -------------------------------------------------------------------
  // 8 ter. CALENDRIER ET SUIVI
  // -------------------------------------------------------------------
  calendrier: {
    moisRevue: 1,              // revue annuelle du plan en janvier (après la loi de finances)
    frequenceReleveMois: 3,    // un relevé de suivi tous les 3 mois
    horizonAnnees: 15,         // échéances affichées sur 15 ans
  },

  // -------------------------------------------------------------------
  // 9. ACHAT DE LA RÉSIDENCE PRINCIPALE (vue "Immobilier")
  //    Âge idéal = 1er âge où : apport dispo (sans toucher à la sécurité)
  //    ≥ apport requis + frais de notaire, mensualité ≤ endettement max,
  //    et fin du prêt ≤ ageMaxFinPret.
  // -------------------------------------------------------------------
  achatRP: {
    tauxEndettementMax: 35,                  // règle HCSF, assurance comprise, crédits en cours inclus
    dureeMaxAnnees: 25,
    tauxCredit: 3.5,                         // taux moyen d'octobre 2026 : 3,49 % (Observatoire Crédit Logement/CSA), à mettre à jour
    tauxAssuranceEmprunteur: 0.3,            // PROPOSITION
    apportMinPourcentCout: 10,               // apport minimum = max(frais de notaire, 10 % du coût total)
    // Apport disponible = livrets au-dessus de l'épargne de sécurité,
    // + la part de l'épargne mensuelle mise de côté pour l'achat.
    enveloppesApport: ["lep", "livretJeune", "livretA", "ldds", "livretBancaire", "pel"],
    partEpargneVersApport: 100,              // PROPOSITION
    fraisNotairePourcent: { ancien: 8, neuf: 2.5 },
    ageMaxFinPret: 65,                       // PROPOSITION
    // Charges du propriétaire occupant (absentes quand on loue) : taxe foncière, copropriété, entretien
    chargesProprietaire: {
      taxeFonciereMoisDeLoyer: 1,            // PROPOSITION : taxe foncière ≈ 1 mois de loyer de marché
      rendementLocatifBrutDefaut: 4,         // PROPOSITION : % du prix, loyer de marché si inconnu
      coproNonRecuperableM2An: 15,           // PROPOSITION : €/m²/an, appartement seulement
      surfaceDefaut: 60,                     // m², si la surface n'est pas saisie
      entretienPctValeur: { appartement: 0.8, maison: 1.0 }, // PROPOSITION : % de la valeur du bien par an
    },
    fraisReventePct: 5,                      // agence et diagnostics, à déduire de la valeur de revente (comparaison acheter / louer)
    fraisGarantiePctPret: 1.0,               // caution ou hypothèque, part non restituée (% du prêt)
    fraisDossier: 1000,                      // frais de dossier bancaire (€)
    // Prêt à taux zéro (PTZ) : décret 2025-299, barèmes à vérifier sur anil.org
    ptz: {
      verifieLe: "2026-11-16",
      quotites: { collectifNeuf: [50, 40, 40, 20], individuelNeuf: [30, 20, 20, 10], ancienTravaux: [50, 40, 40, 20] }, // % du coût, tranches 1 à 4
      zonesAncien: ["B2", "C"],
      travauxMinPctCout: 25,
      tranches: [ // durée du différé (ans) et du remboursement (ans), par tranche de revenus 1 à 4
        { differe: 10, remboursement: 15 },
        { differe: 8, remboursement: 12 },
        { differe: 2, remboursement: 13 },
        { differe: 0, remboursement: 10 },
      ],
      plafondOperationUnePersonne: { A: 150000, B1: 135000, B2: 110000, C: 100000 },
      coefficientsFoyer: [1, 1.5, 1.8, 2.1, 2.4], // 1 à 5 personnes et plus
    },
  },
};
