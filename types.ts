
export interface GeneInfo {
  symbol: string;
  name: string;
  entrez_id: string;
  uniprot_id: string | null;
}

export interface OrthologInfo {
  id: string; // SGD ID or Symbol
  symbol: string;
  score: number;
  tiedSymbols?: string[];
}

export interface SequenceRecord {
  id: string;
  description: string;
  seq: string;
}

export interface AlignmentResult {
  humanSeqAligned: string;
  yeastSeqAligned: string;
  score: number;
  percentIdentity?: number;
  percentSimilarity?: number;
}

export interface Variant {
  hgvs: string;
  proteinChange: string;
  residue: number;
  targetAA: string;
  refAA: string;
  conservedStatus: 'Identical' | 'Similar' | 'Mismatch' | 'Gap' | 'N/A';
  yeastAA: string;
  yeastPos: string;
  amScore: number | null; // AlphaMissense Score
  clinVarId?: string;
  clinVarVariantId?: string | number;
  gnomadFreq?: number | null;
  gnomadLink?: string | null;
  gnomadLinkV4?: string | null;
  gnomadDetails?: {
    source: 'exome' | 'genome' | 'dbnsfp';
    version: string;
    af: number;
    ac?: number;
    an?: number;
    exomeAf?: number | null;
    genomeAf?: number | null;
    exomeAc?: number | null;
    exomeAn?: number | null;
    genomeAc?: number | null;
    genomeAn?: number | null;
  } | null;
  localHomologyScore?: number;
  clinicalSignificance?: string;
  clinVarStars?: number; // 0 to 4 gold stars
  reviewStatus?: string;
  clinVarSubmitters?: number; // Number of ClinVar submitter entries
}

export type StudyType = 'classic' | 'high-throughput' | 'both' | 'unspecified';

export interface ProteinDomain {
  id: string;
  name: string;
  type: string;
  start: number;
  end: number;
  color?: string;
  source?: 'human' | 'yeast';
}

export type PtmCategory = 
  | 'Phosphorylation' 
  | 'Acetylation' 
  | 'Methylation' 
  | 'Ubiquitination' 
  | 'SUMOylation'
  | 'Glycosylation' 
  | 'Disulfide' 
  | 'Lipidation' 
  | 'Other';

export interface ProteinPtm {
  id: string;
  type: string;
  category: PtmCategory;
  description: string;
  start: number;
  end: number;
  aminoAcid?: string;
  badge: string;
  color: string;
  source?: 'human' | 'yeast';
  evidenceCount?: number;
}

export type FunctionalSiteCategory = 
  | 'ACTIVE_SITE'       // Active / Catalytic sites (UniProt ACT_SITE)
  | 'BINDING_SITE'      // Ligand, substrate, cofactor binding (UniProt BINDING)
  | 'METAL_BINDING'     // Metal coordination sites (UniProt METAL)
  | 'SLIM_MOTIF'        // Short Linear Motifs: NLS, NES, degron, motif (UniProt MOTIF)
  | 'OTHER_SITE';       // Other functional sites (UniProt SITE)

export interface FunctionalSite {
  id: string;
  category: FunctionalSiteCategory;
  type: string;
  label: string;
  name: string;
  description: string;
  ligand?: string;
  start: number;
  end: number;
  aminoAcid?: string;
  color: string;
  source?: 'human' | 'yeast';
  evidenceCount?: number;
}

export interface BioGridInteraction {
  partner: string;
  partnerUniProt?: string;
  count: number;
  experimentalSystems: string[];
  pubmedIds: string[];
  hasStructure?: boolean;
}

export interface InterfacePartnerDetail {
  partnerSymbol: string;
  partnerUniProt?: string;
  partnerFullName?: string;
  pdbIds: string[];
  isHomomer?: boolean;
  isNucleicAcid?: boolean;
  bioGridCount?: number;
  bioGridExps?: string[];
}

export interface InterfaceResidue {
  residue: number; // 1-based residue coordinate on target protein
  aminoAcid?: string;
  partnerSymbol?: string; // Partner Gene Symbol (e.g. 'MDM2', 'EP300', 'Homomer (Self)')
  partnerUniProt?: string;
  partnerFullName?: string;
  pdbIds?: string[];
  isHomomer?: boolean;
  isNucleicAcid?: boolean;
  bioGridCount?: number;
  bioGridExps?: string[];
  partners?: InterfacePartnerDetail[];
}

export interface ProteinInterfacePartner {
  partnerSymbol: string;
  partnerUniProt?: string;
  partnerFullName?: string;
  residueCount: number;
  residues: number[];
  pdbIds: string[];
  bioGridCount: number;
  bioGridExps: string[];
  isHomomer?: boolean;
  isNucleicAcid?: boolean;
}

export interface ProteinInterfaceData {
  symbol: string;
  uniprotId: string;
  partners: BioGridInteraction[];
  interfacePartners: ProteinInterfacePartner[];
  interfaceResidues: InterfaceResidue[];
  allInterfaceResidueIndices: number[];
}

export interface PhenotypeReference {
  citation: string;
  pubmed_id?: string;
  studyType: 'classic' | 'high-throughput';
  experimentType?: string;
  allele?: string;
  condition?: string;
}

export interface Phenotype {
  phenotype: string;
  category?: string;
  studyType?: StudyType;
  studyTypeLabel?: string;
  studyTypeDescription?: string;
  experimentType?: string;
  reference?: string;
  pubmed_id?: string;
  mutant_type?: string;
  note?: string;
  hasClassic?: boolean;
  hasHighThroughput?: boolean;
  allReferences?: PhenotypeReference[];
}

export interface PipelineState {
  step: 'idle' | 'searching' | 'aligning' | 'variants' | 'analyzing' | 'complete' | 'error';
  error?: string;
  logs: string[];
}

export interface AdvancedSettings {
  // CRISPR & Oligo
  crispr: {
    disruptionPriority: 'PAM' | 'SEED' | 'BOTH';
    seedLength: number;
    minSeedMutations: number;
    maxSeedMutations: number;
    pamConstraint: 'NGG' | 'NNGRRT' | 'TTTV' | 'NG';
    guideLength: number;
    minDoenchScore: number;
    repairTemplateLength: number;
    repairAsymmetry: 'CENTERED' | 'UPSTREAM_SKEW' | 'DOWNSTREAM_SKEW';
    primerSizeMin: number;
    primerSizeMax: number;
    targetPrimerProdSize?: number;
    primerTmMin: number;
    primerTmMax: number;
    forceGcClamp: boolean;
    cloningType?: 'pML104' | 'NoClo';
    nocloHomologyLength?: number;
    nocloIntegratedRepair?: boolean;
  };
  
  // Alignment
  alignment: {
    matrix: 'BLOSUM62' | 'BLOSUM45' | 'PAM250';
    gapOpen: number;
    gapExtend: number;
    algorithm: 'GLOBAL' | 'LOCAL';
  };

  // Variants & Orthology
  filtering: {
    allowMismatches: boolean;
    excludeGaps: boolean;
    clinVarSignificance: ('VUS' | 'PATHOGENIC' | 'LIKELY_PATHOGENIC' | 'BENIGN' | 'LIKELY_BENIGN' | 'CONFLICTING' | 'DISCORDANT')[];
    minClinVarStars: number;
    minDioptScore: number;
    minPercentIdentity: number;
    minPercentSimilarity: number;
    minLocalHomology: number;
    paralogHandling: 'BEST_SCORE' | 'ALL';
    multiVariantSelection: boolean;
  };

  // AI
  ai: {
    labResources: string[]; // e.g., 'Microscopy', 'Plate Reader'
    assayPreference: string; // Changed from enum to string to allow manual input
    safetyLevel: 'STANDARD' | 'CLASSROOM_SAFE';
  };

  // Structure
  structure: {
    defaultRepresentation: 'cartoon' | 'stick' | 'surface';
    colorScheme: 'chain' | 'secondary' | 'conservation';
    superpositionMethod: 'pruned_core' | 'kabsch_global' | 'conserved_anchors' | 'tm_weighted' | 'sequence' | 'structure';
  };
}

// --- CRISPR Types ---

export interface Cas9Site {
  position: number;
  sequence: string; // The full match including PAM
  strand: 'forward' | 'reverse';
  context30?: string; // 4bp + 20bp + PAM + 3bp for scoring
}

export interface VerificationPrimers {
  forward: string;
  reverse: string;
  productSize: number;
  forwardTm: number;
  reverseTm: number;
  forwardStart: number;
  reverseStart: number;
}

export interface RepairResult {
  site: Cas9Site;
  cloningOligoA: string;
  cloningOligoB: string;
  repairTemplate: string; // The mutated homology arm
  guideSeqWithPam: string; // N20NGG format (5'->3')
  score?: number; // Efficiency Score (0-100)
  
  // Deletion Control Fields
  deletionRepairTemplate: string;
  deletionDnaDisplay: string; // Original sequence with dashes where PAM was
  deletionProtein: string; // Translated protein of the deletion mutant

  originalRegion: string;
  homologyStart: number;
  mutationPosition: number; // Nucleotide index relative to start of gene
  aaChangeStatus: 'success' | 'warning';
  aaChangesCount: number;
  dnaAlignment: AlignmentData;
  aaAlignment: AlignmentData;
  strategy: 'PAM_DISRUPTED_BY_TARGET' | 'PAM_SILENT' | 'SEED_SILENT';
  silentMutationCount: number;
  
  verificationPrimers?: VerificationPrimers;
  variant?: Variant;

  isIntegratedNoClo?: boolean;
  integratedOligoA?: string;
  integratedOligoB?: string;
  integratedDeletionOligoA?: string;
  integratedDeletionOligoB?: string;
}

export interface AlignmentData {
  original: string;
  modified: string;
  matchString: string; // String of '|' and ' '
}

export interface CodonTable {
  [key: string]: string[];
}

export interface CodingExon {
  start: number; // String index (inclusive)
  end: number;   // String index (exclusive)
  cumLengthBefore: number; // Cumulative coding bases before this exon
}

// --- Discordant Variants Types ---

export type DiscordanceType = 'BENIGN_AM_PATHOGENIC' | 'PATHOGENIC_AM_BENIGN' | 'RECURRENT_BENIGN';

export interface DiscordantVariant {
  id: string;
  gene: string;
  hgvsProtein: string;
  hgvsCdna?: string;
  rsid?: string;
  clinVarVariantId?: number | string;
  clinVarSignificance: string;
  clinVarStars: number;
  clinVarReviewStatus: string;
  clinVarSubmissions?: number;
  clinVarSubmitters?: number;
  amScore: number;
  amClass: 'Likely Benign' | 'Likely Pathogenic' | 'Ambiguous';
  discordanceType: DiscordanceType;
  discordanceDelta: number;
  diseaseOrCondition: string;
  gnomadAf?: number | null;
  gnomadExomeAf?: number | null;
  gnomadGenomeAf?: number | null;
  gnomadCategory?: 'COMMON' | 'LOW_FREQUENCY' | 'RARE' | 'ULTRA_RARE';
  gnomadLink?: string | null;
  gnomadLinkV4?: string | null;
  gnomadExomeAc?: number | null;
  gnomadExomeAn?: number | null;
  gnomadGenomeAc?: number | null;
  gnomadGenomeAn?: number | null;
  yeastOrtholog?: {
    symbol: string;
    dioptScore: number;
  } | null;
  residue?: number;
  refAA?: string;
  targetAA?: string;
  uniprotId?: string;
  geneVariantCount?: number;
}

export interface DiscordantSearchResult {
  total: number;
  rawTotalEstimate?: number;
  returned: number;
  page: number;
  pageSize: number;
  benignAmPathCount: number;
  pathogenicAmBenignCount: number;
  recurrentBenignCount?: number;
  genesCount: number;
  variants: DiscordantVariant[];
}

