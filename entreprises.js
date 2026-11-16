// =====================================================================
//  EXEMPLES D'ABONDEMENT DANS DE GRANDES ENTREPRISES
//  Barèmes trouvés dans des accords, des documents d'entreprise ou des
//  documents syndicaux publics (vérifiés le 12 novembre 2026). Ils changent
//  souvent (renégociés tous les 1 à 3 ans) et peuvent varier d'une filiale à
//  l'autre : ce sont des ordres de grandeur, pas des engagements.
//  profil : valeurs pour « Mon profil » (taux effectif = abondement maximum ÷
//  versement nécessaire, pour les barèmes par tranches).
// =====================================================================

export const ENTREPRISES = [
  {
    nom: "Vinci", secteur: "Construction, autoroutes",
    plans: "PEG (actions Vinci, plan Castor) et PER d'entreprise",
    bareme: "200 % sur les premiers euros versés, puis 100 %, investis en actions Vinci",
    max: 3500, total: "3 900 € (cadres) à 4 100 € (ouvriers, ETAM) par an en cumulant les deux plans",
    verser: null, annee: "2025",
    note: "L'abondement est investi en actions de l'entreprise : très généreux, mais concentré sur une seule société.",
    fiabilite: "Document de l'entreprise",
    sources: [["Vinci – livret épargne groupe 2025", "https://castor.vinci.com/wp-content/uploads/2024/12/bat-livret-epargne-groupe-2025_web.pdf"]],
    profil: null,
  },
  {
    nom: "Thales", secteur: "Défense, aéronautique",
    plans: "PER d'entreprise (PERCO)",
    bareme: "Jusqu'à 150 % des versements volontaires",
    max: 2350, verser: 1567, annee: "non daté",
    note: "Chiffre d'un document syndical non daté : à vérifier dans l'accord en vigueur.",
    fiabilite: "Document syndical (CFDT), à vérifier",
    sources: [["CFDT Thales – questions-réponses épargne salariale", "https://storage.canalblog.com/96/82/869240/68711562.pdf"]],
    profil: { acces: "per", taux: 150, plafond: 2350 },
  },
  {
    nom: "Covéa (MAAF, MMA, GMF)", secteur: "Assurance",
    plans: "PEG et PER d'entreprise",
    bareme: "PEG : 800 à 1 200 € maximum selon trois critères (réduit en cas d'absences) ; PER d'entreprise : 1 000 à 1 100 € maximum",
    max: 2300, verser: null, annee: "2025 à 2027",
    note: "Résultat de négociation résumé par un syndicat ; abondements exceptionnels possibles si les résultats sont exceptionnels.",
    fiabilite: "Document syndical (CFTC)",
    sources: [["CFTC Covéa – négociation intéressement, participation et abondements 2025-2027", "https://cftc-covea-france.fr/wp-content/uploads/2025/06/NEGO-PIPP-18-JUIN.pdf"]],
    profil: null,
  },
  {
    nom: "La Poste", secteur: "Services, banque",
    plans: "PEG et PER d'entreprise",
    bareme: "PEG : paliers dégressifs (environ 110 %, puis 80 %, puis 50 %), jusqu'à 1 500 € par an ; PER d'entreprise : jusqu'à 1 700 € par an",
    max: 3200, verser: null, annee: "2026",
    note: "Chiffres d'un site spécialisé, pas de l'accord lui-même : à vérifier auprès des RH.",
    fiabilite: "Site spécialisé, à vérifier",
    sources: [["Signal Alpha – plan d'épargne salariale La Poste", "https://signal-alpha.fr/plan-epargne-salariale-la-poste/"]],
    profil: null,
  },
  {
    nom: "GRDF (groupe Engie)", secteur: "Énergie",
    plans: "PEG et PER d'entreprise (plafonds cumulés)",
    bareme: "Intéressement placé : 100 % jusqu'à 1 100 € ; participation placée : 50 % jusqu'à 700 € (350 € max) ; versements volontaires sur le PEG : 40 % jusqu'à 800 € (320 € max)",
    max: 1770, verser: null, annee: "2024 à 2028",
    note: "L'essentiel de l'abondement porte sur l'intéressement placé : le placer plutôt que le recevoir rapporte jusqu'à 1 100 € de plus.",
    fiabilite: "Document syndical (CGT)",
    sources: [["CGT GRDF – fiche pratique abondement 2024-2028", "https://csec-grdf.fnme-cgt.fr/wp-content/uploads/2024/03/Fiche-Pratique-Abondement.pdf"]],
    profil: { acces: "les2", plan: "pee", taux: 100, plafond: 1100, surInteressement: true },
  },
  {
    nom: "Safran", secteur: "Aéronautique, défense",
    plans: "PER d'entreprise",
    bareme: "100 % sur les 500 premiers euros versés, puis 50 % de 500 à 1 500 €",
    max: 1000, verser: 1500, annee: "2024 à 2026",
    note: "Seniors (deux dernières années avant la retraite) : 150 %, jusqu'à 1 800 €. Les versements volontaires et la participation placée sont abondés, pas l'intéressement.",
    fiabilite: "Accord officiel",
    sources: [["Safran – avenant n° 21 à l'accord PER collectif", "https://cfecgc-safran.fr/wp-content/uploads/2026/09/2026-04-30_Avenant21_PER_Collectif_Safran.pdf"]],
    profil: { acces: "per", taux: 66.67, plafond: 1000 },
  },
  {
    nom: "Airbus", secteur: "Aéronautique",
    plans: "PER d'entreprise (PERCOL)",
    bareme: "80 % des versements volontaires",
    max: 600, verser: 750, annee: "2025",
    note: "Jours de compte épargne-temps transférés : 40 % d'abondement en plus. Offres d'actions réservées aux salariés (ESOP) avec actions offertes en plus.",
    fiabilite: "Document syndical (FO)",
    sources: [["FO Airbus – épargne salariale 2025", "https://www.fo-airbus-operations-toulouse.fr/actus/i/88675068/article-n-1550"]],
    profil: { acces: "per", taux: 80, plafond: 600 },
  },
];

// Offres d'actions réservées aux salariés (actionnariat) : une autre forme d'argent offert
export const OFFRES_ACTIONS = [
  ["Renault Group", "2025", "3 actions offertes à tous les salariés, plus jusqu'à 3 actions offertes à ceux qui en achètent", ["Renault Group – Shareplan 2025", "https://renaulutionshareplan.renaultgroup.com/fr/wp-content/uploads/sites/3/2025/04/Renault_Shareplan_Flyer_20250319_FR.pdf"]],
  ["Michelin", "2026", "1 action offerte pour 1 achetée de 1 à 5 actions, puis 1 pour 5 achetées de 6 à 55 : jusqu'à 15 actions offertes", ["Option Finance – plan d'actionnariat Michelin 2026", "https://www.optionfinance.fr/info-financiere-en-continu/d/2026-09-07-michelin-lance-son-plan-dactionnariat-salarie.html"]],
  ["TotalEnergies", "2025", "Augmentation de capital réservée aux salariés à prix réduit ; plus de 80 % des salariés en France sont actionnaires", ["Business Wire – TotalEnergies, augmentation de capital salariés 2025", "https://www.businesswire.com/news/home/20250609323452/fr"]],
];

// Intéressement et participation réellement versés (montants moyens par salarié en France,
// sauf mention contraire). Ils varient fortement d'une année à l'autre avec les résultats.
export const PRIMES = [
  { nom: "TotalEnergies", annee: "versé en 2026", montant: 10136, texte: "Environ 10 136 € en moyenne (intéressement, participation et autres dispositifs du socle social commun, environ 15 000 salariés), plus une prime de partage de la valeur (avance de 1 000 € en octobre 2026)", source: ["Option Finance – TotalEnergies et ses salariés (octobre 2026)", "https://www.optionfinance.fr/info-financiere-en-continu/d/2026-10-28-totalenergies-renforce-son-partenariat-avec-chevron-et-soccupe-de-ses-salaries.html"] },
  { nom: "Dassault Aviation", annee: "au titre de 2024", montant: null, texte: "Environ 4 mois de salaire en moyenne (près de 300 M€ de participation et d'intéressement) ; 13 % du résultat reversé aux salariés", source: ["Eres – défense et partage de la valeur", "https://www.eres-group.com/actualites/secteur-de-la-defense-lautre-front-celui-du-partage-de-la-valeur/"] },
  { nom: "EDF", annee: "au titre de 2025, versé en 2026", montant: 3950, texte: "Intéressement moyen de 3 950 € (hors participation) ; environ 3 220 € proposés pour 2026", source: ["FO Énergie – intéressement EDF SA 2025", "https://www.fnem-fo.org/wp-content/uploads/2026/03/2026_03_04_EDF_SA_Interessement_2025.pdf"] },
  { nom: "Thales", annee: "au titre de 2025", montant: 3608, texte: "Participation + intéressement : 3 608 € en moyenne, contre 3 867 € l'année précédente", source: ["CFDT Thales – info rapide mars 2026", "https://cfdt-thales.com/media/thales-dis/2026/InfoRapide-20260326-P-I-PPV-PVCO.pdf"] },
  { nom: "Renault Group", annee: "versé en 2026", montant: 2800, texte: "Intéressement groupe : 1 150 € + 73,96 € par tranche de 100 € de salaire brut mensuel (environ 2 500 à 3 000 € pour un salaire moyen), plus un intéressement local d'au moins 1 000 €", source: ["Les Voitures – Renault 2026, ce que touchent les salariés", "https://lesvoitures.fr/prix-renault-2026-salaries/"] },
  { nom: "Hermès", annee: "début 2026", montant: 3000, texte: "Prime de 3 000 € versée à tous les salariés du groupe (4 500 € l'année précédente), en plus de la participation et de l'intéressement en France : 328 M€ distribués au total", source: ["Luxury Tribune – Hermès en 2025", "https://www.luxurytribune.com/hermes-en-nette-hausse-en-2025-avec-16-milliards-deuros-de-chiffre-daffaires"] },
  { nom: "Orange", annee: "2024 puis 2026", montant: 2400, texte: "Intéressement moyen d'environ 2 400 € en 2024 ; forte baisse en 2026 (environ 1 750 € de moins pour 50 000 € de salaire annuel, selon un syndicat)", source: ["CGT FAPT – quel partage de la valeur à Orange en 2026", "https://cgt-fapt.fr/document/6kRmAD8D6ysmS4r3qXGybQ/quel-partage-de-la-valeur-a-orange-en-2026.pdf"] },
  { nom: "Airbus", annee: "versé en 2025", montant: 2057, texte: "Participation moyenne d'environ 2 057 €, deux fois moins que l'année précédente (chiffre syndical, filiale hélicoptères)", source: ["CFE-CGC – tract participation 2025", "https://cfecgc-applicopters.fr/wp-content/uploads/Tract-Entente-Participation-2025-.pdf"] },
  { nom: "Safran", annee: "ordre de grandeur", montant: null, texte: "Intéressement de 0,5 à 2 mois de salaire selon les objectifs atteints ; participation pouvant atteindre 1,5 à 2 mois pour les plus bas salaires (estimation non officielle)", source: ["Bulletins Paie – Safran, salaires et primes", "https://bulletinspaie.com/est-ce-que-safran-paye-bien-salaires-primes/"] },
  { nom: "Stellantis", annee: "2026", montant: 0, texte: "Ni intéressement ni participation en France en 2026, après une perte de 22,3 milliards d'euros en 2025 ; au moins 4 300 € avaient été versés en 2023", source: ["L'argus – pertes record de Stellantis et salariés", "https://www.largus.fr/pros/actualite-automobile/pertes-record-de-stellantis-quel-impact-pour-les-actionnaires-et-les-salaries-30045778.html"] },
];
