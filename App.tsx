
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Dna, Activity, Zap, FileText, AlertCircle, PlayCircle, Key, Settings, ExternalLink, Info, List, ArrowRight, Sparkles, Filter, FlaskConical, Copy, Download, HelpCircle, ChevronDown, Mail, Shuffle, BookOpen, X, Printer, Loader2, FilePlus, PenTool, Sliders, ChevronLeft, ChevronRight, Sun, Moon, RefreshCw, Link2, Star, Users, Check, Scale, Network, Target, Layers } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { GeneInfo, OrthologInfo, Variant, Phenotype, PipelineState, AlignmentResult, RepairResult, Cas9Site, AdvancedSettings, ProteinDomain, ProteinPtm, FunctionalSite, ProteinInterfaceData } from './types';
import { getHumanGeneInfo, getOrtholog, fetchSequence, fetchClinVarVariants, fetchYeastPhenotypes, searchGenes, searchGenesByAi, fetchYeastGeneSequence, getSgdId, fetchProteinDomains, fetchProteinPtms, fetchFunctionalSites, fetchProteinInterfaces, fetchGnomadV4GeneVariants, GnomadV4Variant } from './services/api';
import { alignSequences, parseProteinChange, isSimilarAA, AA_MAP, calculateLocalHomology } from './utils/alignment';
import { findCas9Sites, generateRepairTemplates, reverseComplement, getMutationIndex } from './utils/crispr';
import { generateExperimentalPlan } from './services/geminiService';
import { AlignmentView } from './components/AlignmentView';
import { StructureViewer, StructureViewerHandle } from './components/StructureViewer';
import { DiscordantVariantsExplorer } from './components/DiscordantVariantsExplorer';
import rareDiseasesTsv from './data/RareDiseases_BestYeastHomologs_DIOPT5plus62026.tsv?raw';

const RARE_DISEASE_GENES = rareDiseasesTsv
  .split('\n')
  .slice(1) // skip header
  .filter(line => line.trim())
  .map(line => {
    const [Rare_Disease, Human_Gene, Best_Yeast_Gene, DIOPT_Score] = line.split('\t');
    return {
      h: Human_Gene?.trim(),
      y: Best_Yeast_Gene?.trim(),
      d: Rare_Disease?.trim(),
      score: parseInt(DIOPT_Score?.trim() || '0', 10)
    };
  })
  .filter(g => g.h && g.y && g.d);

// Helper to render colored REF DNA with PAM
const renderRefDna = (seq: string, site: Cas9Site, homologyStart: number) => {
  const pamStartRel = site.position - homologyStart;
  let pamStart = -1;
  let pamEnd = -1;

  if (site.strand === 'forward') {
    pamStart = pamStartRel + 20;
    pamEnd = pamStart + 3;
  } else {
    pamStart = pamStartRel;
    pamEnd = pamStart + 3;
  }

  return (
    <span>
      {seq.split('').map((char, i) => {
         const isPam = i >= pamStart && i < pamEnd;
         return isPam ? <span key={i} className="text-purple-600 dark:text-purple-400 font-bold">{char}</span> : char;
      })}
    </span>
  );
};

// Helper to render ALT sequence with differences highlighted
const renderAltSeq = (ref: string, alt: string) => {
   return (
     <span>
       {alt.split('').map((char, i) => {
         // Safe access to ref
         const refChar = ref[i] || '';
         const isDiff = char !== refChar;
         return isDiff ? <span key={i} className="text-red-600 dark:text-red-400 font-bold">{char}</span> : char;
       })}
     </span>
   );
};

// New Helper to render Guide Sequence with PAM Highlight
const renderGuideWithPam = (guideSeqWithPam: string) => {
    // Last 3 chars are PAM (usually)
    const pamLen = 3; 
    const guide = guideSeqWithPam.substring(0, guideSeqWithPam.length - pamLen);
    const pam = guideSeqWithPam.substring(guideSeqWithPam.length - pamLen);
    return (
        <span>
            {guide}
            <span className="text-purple-600 dark:text-purple-400 font-bold">{pam}</span>
        </span>
    );
};

// ClinVar Review Status & Star Rating Helpers
export const getClinVarStarsFromStatus = (status?: string | string[]): number => {
  const rawStatus = Array.isArray(status) ? status[0] : status;
  if (!rawStatus) return 0;
  const s = rawStatus.toLowerCase().trim();
  if (s.includes('no assertion') || s.includes('no criteria') || s.includes('no classification')) {
    return 0;
  }
  if (s.includes('practice guideline')) return 4;
  if (s.includes('expert panel')) return 3;
  if (s.includes('multiple submitters')) return 2;
  if (s.includes('single submitter') || s.includes('criteria provided') || s.includes('conflicting')) return 1;
  return 0;
};

const renderStarRating = (stars: number = 0, reviewStatus?: string) => {
  return (
    <div className="flex items-center gap-0.5" title={reviewStatus ? `${stars}★ - ${reviewStatus}` : `${stars} Gold Star${stars === 1 ? '' : 's'}`}>
      {[1, 2, 3, 4].map((starIdx) => (
        <Star
          key={starIdx}
          className={`w-3 h-3 ${
            starIdx <= stars
              ? 'fill-amber-400 text-amber-500'
              : 'text-slate-300 dark:text-slate-600'
          }`}
        />
      ))}
      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 ml-1">
        {stars > 0 ? `${stars}★` : '0★'}
      </span>
    </div>
  );
};

export interface GnomadDetails {
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
}

// Helper to extract gnomAD Allele Frequency and link from MyVariant.info hit
export const extractGnomadData = (
  hit: any,
  gnomadV4Map?: Map<string, GnomadV4Variant>
): { 
  freq: number | null; 
  link: string | null; 
  linkV4: string | null;
  details: GnomadDetails | null;
} => {
  const clin = hit?.clinvar;
  const rawChrom = clin?.chrom || (hit?._id?.startsWith('chr') ? hit._id.match(/chr([0-9XYM]+)/i)?.[1] : null);
  const chrom = rawChrom ? String(rawChrom).replace(/^chr/i, '') : null;
  const ref = clin?.ref;
  const alt = clin?.alt;
  const hg38Start = clin?.hg38?.start || hit?.hg38?.start;
  const hg19Start = clin?.hg19?.start || hit?.hg19?.start;

  // 1. PRIMARY PREFERENCE: Official gnomAD v4 (GRCh38)
  if (gnomadV4Map && hg38Start && ref && alt) {
    const v4Hit = gnomadV4Map.get(`${hg38Start}-${ref}-${alt}`) 
      || (chrom ? gnomadV4Map.get(`${chrom}-${hg38Start}-${ref}-${alt}`) : null);
    if (v4Hit) {
      const exAf = v4Hit.exome?.af ?? null;
      const genAf = v4Hit.genome?.af ?? null;
      const primaryAf = exAf !== null ? exAf : (genAf !== null ? genAf : (v4Hit.joint ? v4Hit.joint.ac / v4Hit.joint.an : null));
      const v4Link = `https://gnomad.broadinstitute.org/variant/${v4Hit.variant_id}?dataset=gnomad_r4`;
      
      return {
        freq: primaryAf,
        link: v4Link,
        linkV4: v4Link,
        details: {
          source: v4Hit.exome ? 'exome' : (v4Hit.genome ? 'genome' : 'joint' as any),
          version: 'v4',
          af: primaryAf ?? 0,
          ac: v4Hit.exome?.ac ?? v4Hit.genome?.ac ?? v4Hit.joint?.ac,
          an: v4Hit.exome?.an ?? v4Hit.genome?.an ?? v4Hit.joint?.an,
          exomeAf: exAf,
          genomeAf: genAf,
          exomeAc: v4Hit.exome?.ac ?? null,
          exomeAn: v4Hit.exome?.an ?? null,
          genomeAc: v4Hit.genome?.ac ?? null,
          genomeAn: v4Hit.genome?.an ?? null,
        }
      };
    }
  }

  // 2. FALLBACK: gnomAD v2.1.1 (from MyVariant.info)
  let freq: number | null = null;
  let source: 'exome' | 'genome' | 'dbnsfp' = 'exome';
  let ac: number | undefined = undefined;
  let an: number | undefined = undefined;

  const ex = hit?.gnomad_exome;
  let exomeAf: number | null = null;
  let exomeAc: number | null = null;
  let exomeAn: number | null = null;
  if (ex) {
    if (typeof ex.af === 'number') exomeAf = ex.af;
    else if (typeof ex.af?.af === 'number') exomeAf = ex.af.af;
    else if (typeof ex.af === 'string') exomeAf = parseFloat(ex.af);
    else if (typeof ex.af?.af === 'string') exomeAf = parseFloat(ex.af.af);

    if (typeof ex.ac === 'number') exomeAc = ex.ac;
    else if (typeof ex.ac?.ac === 'number') exomeAc = ex.ac.ac;
    
    if (typeof ex.an === 'number') exomeAn = ex.an;
    else if (typeof ex.an?.an === 'number') exomeAn = ex.an.an;
  }

  const gen = hit?.gnomad_genome;
  let genomeAf: number | null = null;
  let genomeAc: number | null = null;
  let genomeAn: number | null = null;
  if (gen) {
    if (typeof gen.af === 'number') genomeAf = gen.af;
    else if (typeof gen.af?.af === 'number') genomeAf = gen.af.af;
    else if (typeof gen.af === 'string') genomeAf = parseFloat(gen.af);
    else if (typeof gen.af?.af === 'string') genomeAf = parseFloat(gen.af.af);

    if (typeof gen.ac === 'number') genomeAc = gen.ac;
    else if (typeof gen.ac?.ac === 'number') genomeAc = gen.ac.ac;

    if (typeof gen.an === 'number') genomeAn = gen.an;
    else if (typeof gen.an?.an === 'number') genomeAn = gen.an.an;
  }

  if (exomeAf !== null && !isNaN(exomeAf)) {
    freq = exomeAf;
    source = 'exome';
    ac = exomeAc ?? undefined;
    an = exomeAn ?? undefined;
  } else if (genomeAf !== null && !isNaN(genomeAf)) {
    freq = genomeAf;
    source = 'genome';
    ac = genomeAc ?? undefined;
    an = genomeAn ?? undefined;
  } else {
    const db = Array.isArray(hit?.dbnsfp) ? hit.dbnsfp[0] : hit?.dbnsfp;
    if (db?.gnomad_exomes?.af) {
      const v = Array.isArray(db.gnomad_exomes.af) ? db.gnomad_exomes.af[0] : db.gnomad_exomes.af;
      if (typeof v === 'number') freq = v;
      else if (typeof v === 'string') freq = parseFloat(v);
      if (freq !== null && !isNaN(freq)) source = 'dbnsfp';
    } else if (db?.gnomad_genomes?.af) {
      const v = Array.isArray(db.gnomad_genomes.af) ? db.gnomad_genomes.af[0] : db.gnomad_genomes.af;
      if (typeof v === 'number') freq = v;
      else if (typeof v === 'string') freq = parseFloat(v);
      if (freq !== null && !isNaN(freq)) source = 'dbnsfp';
    }
  }
  if (freq !== null && isNaN(freq)) freq = null;

  let details: GnomadDetails | null = null;
  if (freq !== null) {
    details = {
      source,
      version: 'v2.1.1',
      af: freq,
      ac,
      an,
      exomeAf,
      genomeAf,
      exomeAc,
      exomeAn,
      genomeAc,
      genomeAn,
    };
  }

  let link: string | null = null;
  let linkV4: string | null = null;

  // gnomAD v4 link (GRCh38)
  if (chrom && hg38Start && ref && alt) {
    linkV4 = `https://gnomad.broadinstitute.org/variant/${chrom}-${hg38Start}-${ref}-${alt}?dataset=gnomad_r4`;
  }

  // Primary link: points directly to gnomAD v2.1.1 where the displayed frequency and counts reside
  if (chrom && hg19Start && ref && alt) {
    link = `https://gnomad.broadinstitute.org/variant/${chrom}-${hg19Start}-${ref}-${alt}?dataset=gnomad_r2_1`;
  } else if (ex?.chrom && ex?.pos && ex?.ref && ex?.alt) {
    const exChrom = String(ex.chrom).replace(/^chr/i, '');
    link = `https://gnomad.broadinstitute.org/variant/${exChrom}-${ex.pos}-${ex.ref}-${ex.alt}?dataset=gnomad_r2_1`;
  } else if (gen?.chrom && gen?.pos && gen?.ref && gen?.alt) {
    const genChrom = String(gen.chrom).replace(/^chr/i, '');
    link = `https://gnomad.broadinstitute.org/variant/${genChrom}-${gen.pos}-${gen.ref}-${gen.alt}?dataset=gnomad_r2_1`;
  } else if (hit?._id && typeof hit._id === 'string' && hit._id.startsWith('chr')) {
    const m = hit._id.match(/chr([0-9XYM]+):g\.(\d+)([A-Z]+)>([A-Z]+)/i);
    if (m) {
      link = `https://gnomad.broadinstitute.org/variant/${m[1]}-${m[2]}-${m[3]}-${m[4]}?dataset=gnomad_r2_1`;
    }
  } else if (linkV4) {
    link = linkV4;
  }

  // Fallback search by rsID if no coordinate variant link could be formed
  if (!link) {
    const rs = clin?.rsid || (Array.isArray(hit?.dbsnp?.rsid) ? hit.dbsnp.rsid[0] : hit?.dbsnp?.rsid);
    if (rs) {
      const rsClean = String(rs).startsWith('rs') ? rs : `rs${rs}`;
      link = `https://gnomad.broadinstitute.org/search?q=${encodeURIComponent(rsClean)}`;
    }
  }

  return { freq, link, linkV4, details };
};

interface SearchResult {
    symbol: string;
    name: string;
    entrez_id: string;
    dioptScore?: number;
    mappedOrtholog?: string; // Symbol of the ortholog (Human or Yeast depending on direction)
    diseaseName?: string; // Specific rare disease name
    tiedOrthologs?: string[];
}

// Default Settings
const DEFAULT_SETTINGS: AdvancedSettings = {
    crispr: {
        disruptionPriority: 'BOTH',
        seedLength: 10,
        minSeedMutations: 2,
        maxSeedMutations: 5,
        pamConstraint: 'NGG',
        guideLength: 20,
        minDoenchScore: 0,
        repairTemplateLength: 80,
        repairAsymmetry: 'CENTERED',
        primerSizeMin: 450,
        primerSizeMax: 900,
        targetPrimerProdSize: 500,
        primerTmMin: 53,
        primerTmMax: 62,
        forceGcClamp: false,
        cloningType: 'pML104',
        nocloHomologyLength: 100,
        nocloIntegratedRepair: false
    },
    alignment: {
        matrix: 'BLOSUM62',
        gapOpen: -10,
        gapExtend: -1,
        algorithm: 'GLOBAL'
    },
    filtering: {
        allowMismatches: false,
        excludeGaps: true,
        clinVarSignificance: ['VUS', 'CONFLICTING'],
        minClinVarStars: 0,
        minDioptScore: 5,
        minPercentIdentity: 10,
        minPercentSimilarity: 20,
        minLocalHomology: 35,
        paralogHandling: 'BEST_SCORE',
        multiVariantSelection: false
    },
    ai: {
        labResources: [],
        assayPreference: 'ANY',
        safetyLevel: 'CLASSROOM_SAFE'
    },
    structure: {
        defaultRepresentation: 'cartoon',
        colorScheme: 'chain',
        superpositionMethod: 'pruned_core'
    }
};

export const App: React.FC = () => {
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(false);

  // UI Mode
  const [inputMode, setInputMode] = useState<'manual' | 'rare' | 'topic' | 'discordant'>('rare');
  
  // Input State
  const [geneInput, setGeneInput] = useState('');
  const [topicInput, setTopicInput] = useState('');
  const [searchSpecies, setSearchSpecies] = useState<'human' | 'yeast'>('human');
  const [useAiSearch, setUseAiSearch] = useState(false);
  
  // Manual Mode State
  const [manualSearchSpecies, setManualSearchSpecies] = useState<'human' | 'yeast' | 'dual'>('human');
  const [dualYeastInput, setDualYeastInput] = useState(''); // Used only in dual mode
  
  // Manual Mutation State
  const [manualVariantEnabled, setManualVariantEnabled] = useState(false);
  const [manualResidue, setManualResidue] = useState<string>('');
  const [manualNumberingSpecies, setManualNumberingSpecies] = useState<'human' | 'yeast'>('human');
  const [manualTargetAA, setManualTargetAA] = useState<string>('');

  // Advanced Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AdvancedSettings>(DEFAULT_SETTINGS);

  const [topicResults, setTopicResults] = useState<SearchResult[]>([]);
  const [selectedDiseaseName, setSelectedDiseaseName] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isFilteringOrthologs, setIsFilteringOrthologs] = useState(false);
  const [showRareList, setShowRareList] = useState(false);
  
  const [minScore, setMinScore] = useState(0.0);
  const [maxScore, setMaxScore] = useState(1.0);
  const [repairLength, setRepairLength] = useState(75);
  const [isAboutVisible, setIsAboutVisible] = useState(true);
  const [isLogCollapsed, setIsLogCollapsed] = useState(false);

  // Pipeline Data State
  const [state, setState] = useState<PipelineState>({ step: 'idle', logs: [] });
  const [geneInfo, setGeneInfo] = useState<GeneInfo | null>(null);
  const [ortholog, setOrtholog] = useState<OrthologInfo | null>(null);
  const [alignment, setAlignment] = useState<AlignmentResult | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [phenotypes, setPhenotypes] = useState<Phenotype[]>([]);
  const [aiPlan, setAiPlan] = useState<string>('');
  
  // State for Yeast identifiers
  const [yeastUniProtId, setYeastUniProtId] = useState<string | null>(null);
  const [yeastSgdId, setYeastSgdId] = useState<string | null>(null);
  const [proteinDomains, setProteinDomains] = useState<ProteinDomain[]>([]);
  const [proteinPtms, setProteinPtms] = useState<ProteinPtm[]>([]);
  const [functionalSites, setFunctionalSites] = useState<FunctionalSite[]>([]);
  const [proteinInterfaces, setProteinInterfaces] = useState<ProteinInterfaceData | null>(null);

  // Selection State
  const [selectedVariantIndices, setSelectedVariantIndices] = useState<number[]>([]);
  const [selectedPhenotype, setSelectedPhenotype] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [copiedRefKey, setCopiedRefKey] = useState<string | null>(null);
  const [phenotypeStudyFilter, setPhenotypeStudyFilter] = useState<'all' | 'classic' | 'high-throughput'>('all');
  const [visibleVariantsCount, setVisibleVariantsCount] = useState(10);
  const [variantSortBy, setVariantSortBy] = useState<'residue' | 'amScore' | 'localHomology' | 'stars' | 'submitters' | 'gnomad' | 'annotations'>('localHomology');
  const [variantSortDirection, setVariantSortDirection] = useState<'asc' | 'desc'>('desc');
  const [isAnnotationsLoading, setIsAnnotationsLoading] = useState(false);

  // Dedicated helper to fetch protein domains, PTMs, functional sites, and interfaces
  const loadProteinAnnotations = async (targetGeneInfo: GeneInfo) => {
    if (!targetGeneInfo?.uniprot_id && !targetGeneInfo?.symbol) return;
    const idToQuery = targetGeneInfo.uniprot_id || targetGeneInfo.symbol;
    const symFallback = targetGeneInfo.symbol || undefined;

    setIsAnnotationsLoading(true);
    try {
      const [domsRes, ptmsRes, sitesRes, intfRes] = await Promise.allSettled([
        fetchProteinDomains(idToQuery, 'human', symFallback),
        fetchProteinPtms(idToQuery, 'human', symFallback),
        fetchFunctionalSites(idToQuery, 'human', symFallback),
        fetchProteinInterfaces(targetGeneInfo.symbol, targetGeneInfo.uniprot_id)
      ]);

      if (domsRes.status === 'fulfilled') setProteinDomains(domsRes.value || []);
      if (ptmsRes.status === 'fulfilled') setProteinPtms(ptmsRes.value || []);
      if (sitesRes.status === 'fulfilled') setFunctionalSites(sitesRes.value || []);
      if (intfRes.status === 'fulfilled') setProteinInterfaces(intfRes.value || null);
    } catch (e) {
      console.warn("Error loading protein annotations:", e);
    } finally {
      setIsAnnotationsLoading(false);
    }
  };

  // Memoized residue annotations map for fast lookup in filtered variants table
  const residueAnnotationsMap = useMemo(() => {
    const map = new Map<number, {
      ptms: { category: string; description: string; color: string; badge: string }[];
      sites: { category: string; label: string; name: string; description: string; ligand?: string; color: string }[];
      interfaces: { partnerSymbol: string; fullName?: string; bioGridCount: number; pdbIds: string[] }[];
      domains: { name: string; color: string }[];
    }>();

    // 1. PTMs
    (proteinPtms || []).forEach(p => {
      const start = Number(p.start);
      const end = Number(p.end || p.start);
      if (isNaN(start)) return;
      for (let r = start; r <= (isNaN(end) ? start : end); r++) {
        const entry = map.get(r) || { ptms: [], sites: [], interfaces: [], domains: [] };
        entry.ptms.push({
          category: p.category,
          description: p.description,
          color: p.color,
          badge: p.badge
        });
        map.set(r, entry);
      }
    });

    // 2. Functional Sites & Motifs
    (functionalSites || []).forEach(s => {
      const start = Number(s.start);
      const end = Number(s.end || s.start);
      if (isNaN(start)) return;
      for (let r = start; r <= (isNaN(end) ? start : end); r++) {
        const entry = map.get(r) || { ptms: [], sites: [], interfaces: [], domains: [] };
        entry.sites.push({
          category: s.category,
          label: s.label,
          name: s.name,
          description: s.description,
          ligand: s.ligand,
          color: s.color
        });
        map.set(r, entry);
      }
    });

    // 3. 3D Structural Interfaces (BioGRID & PDBe-KB)
    (proteinInterfaces?.interfaceResidues || []).forEach(ir => {
      const resNum = Number(ir.residue);
      if (isNaN(resNum) || resNum <= 0) return;
      const entry = map.get(resNum) || { ptms: [], sites: [], interfaces: [], domains: [] };
      const partners = ir.partners || [];
      if (partners.length > 0) {
        partners.forEach(p => {
          if (!entry.interfaces.some(existing => existing.partnerSymbol === p.partnerSymbol)) {
            entry.interfaces.push({
              partnerSymbol: p.partnerSymbol,
              fullName: p.partnerFullName,
              bioGridCount: p.bioGridCount || 0,
              pdbIds: p.pdbIds || []
            });
          }
        });
      } else if (ir.partnerSymbol) {
        if (!entry.interfaces.some(existing => existing.partnerSymbol === ir.partnerSymbol)) {
          entry.interfaces.push({
            partnerSymbol: ir.partnerSymbol,
            fullName: ir.partnerFullName,
            bioGridCount: ir.bioGridCount || 0,
            pdbIds: ir.pdbIds || []
          });
        }
      }
      map.set(resNum, entry);
    });

    // 4. Domains
    (proteinDomains || []).forEach(d => {
      const start = Number(d.start);
      const end = Number(d.end || d.start);
      if (isNaN(start)) return;
      for (let r = start; r <= (isNaN(end) ? start : end); r++) {
        const entry = map.get(r) || { ptms: [], sites: [], interfaces: [], domains: [] };
        if (!entry.domains.some(existing => existing.name === d.name)) {
          entry.domains.push({
            name: d.name,
            color: d.color
          });
        }
        map.set(r, entry);
      }
    });

    return map;
  }, [proteinPtms, functionalSites, proteinInterfaces, proteinDomains]);

  // Memoized 1-to-1 residue alignment map (human pos <-> yeast pos) for 3D structure homology projection
  const alignmentMap = useMemo(() => {
    if (!alignment?.humanSeqAligned || !alignment?.yeastSeqAligned) return undefined;
    const map = new Map<number, number>();
    const hSeq = alignment.humanSeqAligned;
    const ySeq = alignment.yeastSeqAligned;
    let hRes = 0;
    let yRes = 0;
    for (let i = 0; i < hSeq.length; i++) {
      const hChar = hSeq[i];
      const yChar = ySeq[i];
      if (hChar !== '-') hRes++;
      if (yChar !== '-') yRes++;
      if (hChar !== '-' && yChar !== '-') {
        map.set(hRes, yRes);
      }
    }
    return map;
  }, [alignment]);

  const sortedAndMappedVariants = useMemo(() => {
     const mapped = variants.map((v, i) => ({ v, originalIndex: i }));
     mapped.sort((a, b) => {
         if (variantSortBy === 'residue') {
             return variantSortDirection === 'asc' ? a.v.residue - b.v.residue : b.v.residue - a.v.residue;
         } else if (variantSortBy === 'amScore') {
             const scoreA = a.v.amScore ?? -1;
             const scoreB = b.v.amScore ?? -1;
             return variantSortDirection === 'asc' ? scoreA - scoreB : scoreB - scoreA;
         } else if (variantSortBy === 'localHomology') {
             const scoreA = a.v.localHomologyScore ?? -1;
             const scoreB = b.v.localHomologyScore ?? -1;
             return variantSortDirection === 'asc' ? scoreA - scoreB : scoreB - scoreA;
         } else if (variantSortBy === 'gnomad') {
             const freqA = a.v.gnomadFreq !== null && a.v.gnomadFreq !== undefined ? a.v.gnomadFreq : -1;
             const freqB = b.v.gnomadFreq !== null && b.v.gnomadFreq !== undefined ? b.v.gnomadFreq : -1;
             return variantSortDirection === 'asc' ? freqA - freqB : freqB - freqA;
         } else if (variantSortBy === 'stars') {
             const starsA = a.v.clinVarStars ?? 0;
             const starsB = b.v.clinVarStars ?? 0;
             return variantSortDirection === 'asc' ? starsA - starsB : starsB - starsA;
         } else if (variantSortBy === 'submitters') {
             const subA = a.v.clinVarSubmitters ?? 0;
             const subB = b.v.clinVarSubmitters ?? 0;
             return variantSortDirection === 'asc' ? subA - subB : subB - subA;
         } else if (variantSortBy === 'annotations') {
             const annotA = residueAnnotationsMap.get(Number(a.v.residue));
             const annotB = residueAnnotationsMap.get(Number(b.v.residue));
             const countA = (annotA?.ptms.length || 0) * 10 + (annotA?.sites.length || 0) * 10 + (annotA?.interfaces.length || 0) * 5 + (annotA?.domains.length || 0);
             const countB = (annotB?.ptms.length || 0) * 10 + (annotB?.sites.length || 0) * 10 + (annotB?.interfaces.length || 0) * 5 + (annotB?.domains.length || 0);
             return variantSortDirection === 'asc' ? countA - countB : countB - countA;
         }
         return 0;
     });
     return mapped;
  }, [variants, variantSortBy, variantSortDirection, residueAnnotationsMap]);
  
  // AI Generation State
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);

  const [includeControls, setIncludeControls] = useState(false);
  const [numBenignControls, setNumBenignControls] = useState(1);
  const [numPathogenicControls, setNumPathogenicControls] = useState(1);
  const [isYeastOnlyMode, setIsYeastOnlyMode] = useState(false);
  const [controlCrisprResults, setControlCrisprResults] = useState<{
    benign: { variant: Variant, results: RepairResult[] }[],
    pathogenic: { variant: Variant, results: RepairResult[] }[]
  }>({ benign: [], pathogenic: [] });

  // CRISPR State
  const [isGeneratingCrispr, setIsGeneratingCrispr] = useState(false);
  const [crisprResults, setCrisprResults] = useState<RepairResult[]>([]);
  const [selectedCrisprIndicesObj, setSelectedCrisprIndicesObj] = useState<Record<string, number>>({});

  const crisprGroups = useMemo(() => {
     const groups: { variantKey: string, results: RepairResult[] }[] = [];
     const map = new Map<string, RepairResult[]>();
     crisprResults.forEach(r => {
         const key = r.variant ? r.variant.proteinChange : 'Default';
         if (!map.has(key)) {
             const arr: RepairResult[] = [];
             map.set(key, arr);
             groups.push({ variantKey: key, results: arr });
         }
         map.get(key)!.push(r);
     });
     return groups;
  }, [crisprResults]);

  // Easter Egg State
  const [showEasterEgg, setShowEasterEgg] = useState(false);

  // Refs
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const variantsTableRef = useRef<HTMLDivElement>(null);
  const structureViewerRef = useRef<StructureViewerHandle>(null);

  // Dark Mode Effect
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.logs, state.error]);

  // Sync repair length setting with state
  useEffect(() => {
      setRepairLength(settings.crispr.repairTemplateLength);
  }, [settings.crispr.repairTemplateLength]);

  // Easter Egg Timer Logic
  useEffect(() => {
    let appearTimer: ReturnType<typeof setTimeout>;
    let disappearTimer: ReturnType<typeof setTimeout>;

    if (showSettings) {
        // 1. Wait 1 minute (60,000ms) while settings is open
        appearTimer = setTimeout(() => {
            setShowEasterEgg(true);
            
            // 2. Show for 10 seconds (10,000ms) then hide
            disappearTimer = setTimeout(() => {
                setShowEasterEgg(false);
            }, 10000);
        }, 60000);
    } else {
        setShowEasterEgg(false);
    }

    return () => {
        clearTimeout(appearTimer);
        clearTimeout(disappearTimer);
    };
  }, [showSettings]);

  const addLog = (msg: string) => {
    setState(prev => ({ ...prev, logs: [...prev.logs, msg] }));
  };

  const handleError = (msg: string) => {
    setState(prev => ({ ...prev, step: 'error', error: msg, logs: [...prev.logs, `Error: ${msg}`] }));
  };

  const handleSearch = async () => {
    if (inputMode === 'manual') return;

    // Automatically remove leading and trailing spaces from text input
    const cleanTopic = topicInput.trim();
    if (cleanTopic !== topicInput) {
        setTopicInput(cleanTopic);
    }

    // For topic search, we require input. For rare, empty input is allowed (random mode).
    if (inputMode === 'topic' && !cleanTopic) return;
    
    setIsSearching(true);
    setTopicResults([]);
    setHasSearched(false);
    setShowRareList(false); // Close list if searching

    try {
      if (inputMode === 'rare') {
          // Rare Disease Logic
          let candidates = [];
          
          if (!cleanTopic) {
              // Random Batch: Pick 5 random pairs
              candidates = [...RARE_DISEASE_GENES].sort(() => 0.5 - Math.random()).slice(0, 5);
          } else {
              // Search within local data
              const lower = cleanTopic.toLowerCase();
              candidates = RARE_DISEASE_GENES.filter(g => 
                  g.h.toLowerCase().includes(lower) || 
                  g.y.toLowerCase().includes(lower) || 
                  g.d.toLowerCase().includes(lower)
              );
              // Limit to top 20 to avoid API spam if search is too broad
              candidates = candidates.slice(0, 20);
          }
          
          let aggregatedResults: SearchResult[] = [];
          
          // Hydrate candidates with Entrez IDs
          for (const pair of candidates) {
              try {
                  // Search for the human gene to get Entrez ID
                  const results = await searchGenes(pair.h, 'human');
                  
                  // Enrich result name with the specific yeast ortholog and Disease Name
                  const enriched = results.map(r => ({
                      ...r,
                      diseaseName: pair.d,
                      mappedOrtholog: pair.y 
                  }));
                  
                  // Only take the best match for the specific gene symbol we looked up
                  const exactMatch = enriched.find(r => r.symbol === pair.h) || enriched[0];
                  
                  if (exactMatch) {
                      aggregatedResults.push(exactMatch);
                  }
              } catch (e) {
                  console.warn(`Failed to search for ${pair.h}`, e);
              }
          }
          
          // Deduplicate based on entrez_id
          const seen = new Set();
          const uniqueResults = aggregatedResults.filter(r => {
              const duplicate = seen.has(r.entrez_id);
              seen.add(r.entrez_id);
              return !duplicate;
          });

          setTopicResults(uniqueResults);
          setHasSearched(true);

      } else {
          // Standard Topic Search Logic
          let results;
          if (useAiSearch) {
              results = await searchGenesByAi(cleanTopic, searchSpecies);
          } else {
              results = await searchGenes(cleanTopic, searchSpecies);
          }
          setTopicResults(results);
          setHasSearched(true);
      }
    } catch (e) {
      console.error(e);
      handleError("Search failed. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleFilterOrthologs = async () => {
    if (topicResults.length === 0) return;
    setIsFilteringOrthologs(true);
    
    // Determine direction for logging and API call
    const direction = searchSpecies === 'human' ? 'yeast orthologs' : 'human orthologs';
    const sourceTax = searchSpecies === 'human' ? '9606' : '4932'; // 9606=Human, 4932=Yeast
    const targetTax = searchSpecies === 'human' ? '4932' : '9606';

    addLog(`Checking ${topicResults.length} genes for ${direction} (this may take a a few minutes, please be patient)...`);

    const validGenes: SearchResult[] = [];
    const BATCH_SIZE = 5;

    try {
        for (let i = 0; i < topicResults.length; i += BATCH_SIZE) {
            const batch = topicResults.slice(i, i + BATCH_SIZE);
            
            // Run batch in parallel
            await Promise.all(batch.map(async (gene) => {
                // If we already have a mapped ortholog (e.g. from Rare Disease mode), skip check or just confirm
                if (gene.mappedOrtholog) {
                    validGenes.push(gene);
                    return;
                }

                try {
                    // Pass gene.symbol for fallback support
                    const orth = await getOrtholog(gene.entrez_id, sourceTax, targetTax, gene.symbol);
                    if (orth) {
                        // Check Min DIOPT Score from settings
                        if (orth.score >= settings.filtering.minDioptScore) {
                            validGenes.push({ 
                                ...gene, 
                                dioptScore: orth.score,
                                mappedOrtholog: orth.symbol,
                                tiedOrthologs: orth.tiedSymbols
                            });
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to check ortholog for ${gene.symbol}`, e);
                }
            }));
            
            // Small delay to be gentle on APIs
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Sort by DIOPT score descending
        validGenes.sort((a, b) => (b.dioptScore || 0) - (a.dioptScore || 0));

        setTopicResults(validGenes);
        addLog(`Filter complete. Retained ${validGenes.length} genes with orthologs.`);
    } catch (e) {
        handleError("Error filtering orthologs.");
    } finally {
        setIsFilteringOrthologs(false);
    }
  };

  const handleResultClick = async (gene: SearchResult) => {
      if (searchSpecies === 'yeast') {
          // Case 1: We already found the ortholog during filtering
          if (gene.mappedOrtholog) {
              await runPipeline(gene.mappedOrtholog);
              return;
          }

          // Case 2: User clicked without filtering (or filter didn't run yet)
          addLog(`Resolving Human ortholog for Yeast gene ${gene.symbol}...`);
          try {
             // Look up Yeast(4932) -> Human(9606)
             const orth = await getOrtholog(gene.entrez_id, '4932', '9606', gene.symbol);
             if (orth) {
                 await runPipeline(orth.symbol);
             } else {
                 handleError(`No Human ortholog found for Yeast gene ${gene.symbol}. Cannot run pipeline.`);
             }
          } catch (e) {
              handleError("Error resolving ortholog.");
          }
      } else {
          // Case 3: Human mode, just run directly
          await runPipeline(gene.entrez_id);
      }
  };

  const handleDiscordantDeepDive = (geneSymbol: string, hgvs?: string, variantObj?: any) => {
    setInputMode('manual');
    setManualSearchSpecies('human');
    setGeneInput(geneSymbol);
    setShowRareList(false);
    addLog(`Deep-diving from Discordant Explorer into human gene: ${geneSymbol}${hgvs ? ` (${hgvs})` : ''}...`);
    setTimeout(() => {
      runPipeline(geneSymbol, hgvs, variantObj);
    }, 80);
  };

  const runPipeline = async (identifier?: string, targetHgvs?: string, targetVariantObj?: any) => {
    // Automatically remove leading and trailing spaces from gene inputs
    const trimmedGeneInput = geneInput.trim();
    if (trimmedGeneInput !== geneInput) {
        setGeneInput(trimmedGeneInput);
    }
    const trimmedDualYeastInput = dualYeastInput.trim();
    if (trimmedDualYeastInput !== dualYeastInput) {
        setDualYeastInput(trimmedDualYeastInput);
    }

    // Reset state
    setState({ step: 'searching', logs: [] });
    setGeneInfo(null);
    setOrtholog(null);
    setAlignment(null);
    setVariants([]);
    setPhenotypes([]);
    setAiPlan('');
    setCrisprResults([]);
    setSelectedCrisprIndicesObj({});
    setSelectedVariantIndices([]);
    setSelectedPhenotype(null);
    setVisibleVariantsCount(10);
    setYeastUniProtId(null);
    setYeastSgdId(null);
    setProteinDomains([]);
    setProteinPtms([]);
    setFunctionalSites([]);
    setProteinInterfaces(null);
    setIsAnnotationsLoading(false);
    
    // If identifier is missing, it's a manual run, so we clear selected disease context
    if (!identifier) {
        setSelectedDiseaseName(null);
    }
    
    // Determine input
    const rawInput = identifier !== undefined ? identifier : trimmedGeneInput;
    const inputTerm = (typeof rawInput === 'string' ? rawInput.trim() : rawInput) || '';
    if (!inputTerm) {
        handleError("Please enter a gene symbol.");
        return;
    }

    try {
      addLog(`Starting pipeline...`);
      
      let gInfo: GeneInfo | null = null;
      let orth: OrthologInfo | null = null;
      let yeastOnlyMode = false;

      // Determine if this is an external direct human gene run (e.g. from topic search or discordant deep-dive)
      const isExternalCall = !!identifier && inputMode !== 'manual';

      if (manualSearchSpecies === 'dual' && !isExternalCall) {
           // Dual Input Mode (Manual Human + Manual Yeast)
           if (!trimmedDualYeastInput) {
               throw new Error("Please enter both Human and Yeast gene symbols for Dual Input mode.");
           }

           addLog(`Dual Mode: Validating ${inputTerm} (Human) and ${trimmedDualYeastInput} (Yeast)...`);
           
           // 1. Fetch Human Info
           gInfo = await getHumanGeneInfo(inputTerm);
           addLog(`Identified Human Gene: ${gInfo.symbol} (ID: ${gInfo.entrez_id})`);

           // 2. Fetch Yeast Info
           const yeastHits = await searchGenes(trimmedDualYeastInput, 'yeast');
           if (yeastHits.length === 0) throw new Error(`Yeast gene '${trimmedDualYeastInput}' not found in MyGene.info or YeastMine.`);
           const upperDual = trimmedDualYeastInput.toUpperCase();
           const bestYeast = yeastHits.find((h: any) => 
               h.symbol?.toUpperCase() === upperDual || 
               h.locus_tag?.toUpperCase() === upperDual
           ) || yeastHits[0];

           // 3. Construct Ortholog Object manually (Skipping DIOPT)
           orth = {
               id: bestYeast.entrez_id,
               symbol: bestYeast.symbol,
               score: 100 // Synthetic high score since user manually selected it
           };
           addLog(`Identified Yeast Gene: ${orth.symbol} (ID: ${orth.id})`);
           addLog(`> Orthology search skipped. Using manual pair: ${gInfo.symbol} <-> ${orth.symbol}`);

      } else if (manualSearchSpecies === 'yeast' && !isExternalCall) {
          // Manual Entry mode set to Yeast
          addLog(`Searching for Yeast gene: ${inputTerm}...`);
          const yeastHits = await searchGenes(inputTerm, 'yeast');
          if (yeastHits.length === 0) throw new Error(`Yeast gene '${inputTerm}' not found in MyGene.info or YeastMine.`);
          
          const upperInput = inputTerm.toUpperCase();
          const bestYeast = yeastHits.find((h: any) => 
              h.symbol?.toUpperCase() === upperInput || 
              h.locus_tag?.toUpperCase() === upperInput
          ) || yeastHits[0];

          addLog(`Found Yeast Gene: ${bestYeast.symbol} (ID: ${bestYeast.entrez_id})`);
          
          addLog(`Finding Human ortholog for ${bestYeast.symbol}...`);
          // Get Human Ortholog (Yeast -> Human)
          const humanOrth = await getOrtholog(bestYeast.entrez_id, '4932', '9606', bestYeast.symbol);
          
          if (humanOrth) {
              addLog(`Mapped to Human Gene: ${humanOrth.symbol} (DIOPT Score: ${humanOrth.score})`);
              // Now fetch official Human Gene Info
              gInfo = await getHumanGeneInfo(humanOrth.symbol);
              
              const confirmOrth = await getOrtholog(gInfo.entrez_id, '9606', '4932', gInfo.symbol);
              orth = {
                  id: bestYeast.entrez_id,
                  symbol: bestYeast.symbol,
                  score: (confirmOrth && confirmOrth.symbol.toUpperCase() === bestYeast.symbol.toUpperCase()) ? confirmOrth.score : humanOrth.score,
                  tiedSymbols: confirmOrth?.tiedSymbols
              };
          } else {
              // No Human Ortholog found
              
              // DIOPT Health Check (Yeast -> Human flow)
              addLog("No Human ortholog found. Verifying DIOPT status...");
              // Pass symbol "VMA2" for local fallback check
              const healthCheck = await getOrtholog("852424", '4932', '9606', "VMA2"); 
              if (healthCheck) {
                  addLog("Orthology Service: OPERATIONAL (Control Yeast VMA2 mapped successfully).");
              } else {
                  addLog("Orthology Service: OFFLINE (Control Yeast VMA2 map failed).");
                  throw new Error("Orthology lookup API appears to be down or unreachable.");
              }

              if (manualVariantEnabled) {
                  // Bypass mode enabled
                  yeastOnlyMode = true;
                  addLog("No Human ortholog found. Proceeding in Yeast-Only mode for manual variant analysis.");
                  
                  // Construct dummy Human Info so pipeline continues
                  gInfo = {
                      symbol: "N/A",
                      name: "No Human Ortholog",
                      entrez_id: "0",
                      uniprot_id: null 
                  };
                  
                  orth = {
                      id: bestYeast.entrez_id,
                      symbol: bestYeast.symbol,
                      score: 0
                  };
              } else {
                  throw new Error(`No Human ortholog found for Yeast gene '${bestYeast.symbol}'. Enable 'Manual Mutation Entry' to proceed with Yeast-only analysis.`);
              }
          }

      } else {
          // Default Human Mode (or external direct identifier passed)
          addLog(`Searching for human gene: ${inputTerm}...`);
          try {
              gInfo = await getHumanGeneInfo(inputTerm);
              
              // Sync UI if we used a direct identifier
              if (identifier) setGeneInput(gInfo.symbol);
              
              addLog(`Found: ${gInfo.symbol} (ID: ${gInfo.entrez_id}) (UniProt: ${gInfo.uniprot_id || 'N/A'})`);
              
              addLog(`Searching DIOPT for ortholog (ID: ${gInfo.entrez_id})...`);
              // Pass symbol for fallback
              orth = await getOrtholog(gInfo.entrez_id, '9606', '4932', gInfo.symbol);
          } catch (humanErr: any) {
              // If not found in human database, check if user provided a Yeast gene or ORF!
              addLog(`Human gene '${inputTerm}' not found in MyGene.info. Checking if '${inputTerm}' is a Yeast gene or ORF...`);
              const yeastHits = await searchGenes(inputTerm, 'yeast');
              const upperInput = inputTerm.toUpperCase();
              const bestYeast = yeastHits.find((h: any) => 
                  h.symbol?.toUpperCase() === upperInput || 
                  h.locus_tag?.toUpperCase() === upperInput
              ) || (yeastHits.length > 0 ? yeastHits[0] : null);

              if (bestYeast) {
                  addLog(`Identified '${inputTerm}' as Yeast Gene: ${bestYeast.symbol} (ID: ${bestYeast.entrez_id}). Auto-switching to Yeast -> Human ortholog mapping...`);
                  setManualSearchSpecies('yeast');
                  setManualNumberingSpecies('yeast');
                  setGeneInput(bestYeast.symbol);

                  addLog(`Finding Human ortholog for ${bestYeast.symbol}...`);
                  const humanOrth = await getOrtholog(bestYeast.entrez_id, '4932', '9606', bestYeast.symbol);

                  if (humanOrth) {
                      addLog(`Mapped to Human Gene: ${humanOrth.symbol} (DIOPT Score: ${humanOrth.score})`);
                      gInfo = await getHumanGeneInfo(humanOrth.symbol);
                      const confirmOrth = await getOrtholog(gInfo.entrez_id, '9606', '4932', gInfo.symbol);
                      orth = {
                          id: bestYeast.entrez_id,
                          symbol: bestYeast.symbol,
                          score: (confirmOrth && confirmOrth.symbol.toUpperCase() === bestYeast.symbol.toUpperCase()) ? confirmOrth.score : humanOrth.score,
                          tiedSymbols: confirmOrth?.tiedSymbols
                      };
                  } else {
                      if (manualVariantEnabled) {
                          yeastOnlyMode = true;
                          addLog("No Human ortholog found. Proceeding in Yeast-Only mode for manual variant analysis.");
                          gInfo = {
                              symbol: "N/A",
                              name: "No Human Ortholog",
                              entrez_id: "0",
                              uniprot_id: null 
                          };
                          orth = {
                              id: bestYeast.entrez_id,
                              symbol: bestYeast.symbol,
                              score: 0
                          };
                      } else {
                          throw new Error(`Yeast gene '${bestYeast.symbol}' identified, but no Human ortholog was found in DIOPT. Enable 'Manual Mutation Entry' to proceed with Yeast-only analysis.`);
                      }
                  }
              } else {
                  // Neither human nor yeast found
                  throw new Error(`Gene '${inputTerm}' not found in MyGene.info (searched Human and Yeast databases).`);
              }
          }
      }

      setGeneInfo(gInfo);
      
      // Fetch protein domains, PTMs, functional sites, and interfaces for sequence alignment and overlays
      if (gInfo?.uniprot_id || gInfo?.symbol) {
        loadProteinAnnotations(gInfo);
      }
      
      if (!gInfo?.uniprot_id && !yeastOnlyMode) {
          throw new Error("No UniProt ID found for human gene.");
      }

      if (!orth) {
        // DIOPT Health Check (Human -> Yeast flow)
        addLog("No Yeast ortholog found. Verifying DIOPT status...");
        // Pass symbol for fallback
        const healthCheck = await getOrtholog("525", "9606", "4932", "ATP6V1B1"); 
        if (healthCheck) {
             addLog("Orthology Service: OPERATIONAL (Control Human ATP6V1B1 mapped successfully).");
             throw new Error("No Yeast ortholog found.");
        } else {
             addLog("Orthology Service: OFFLINE (Control Human ATP6V1B1 map failed).");
             throw new Error("Orthology lookup API appears to be down. Please try again later.");
        }
      }

      // Check DIOPT Score against Settings
      if (!yeastOnlyMode && orth.score < settings.filtering.minDioptScore) {
          throw new Error(`Ortholog DIOPT Score (${orth.score}) is below minimum setting (${settings.filtering.minDioptScore}). Analysis stopped.`);
      }

      setOrtholog(orth);
      
      if (!yeastOnlyMode) {
          addLog(`Ortholog pair: ${gInfo!.symbol} <-> ${orth.symbol} (Score: ${orth.score})`);
          if (orth.tiedSymbols && orth.tiedSymbols.length > 0) {
              addLog(`💡 Multiple equally scored orthologs found (${[orth.symbol, ...orth.tiedSymbols].join(', ')}). Automatically selected ${orth.symbol}.`);
          }
      } else {
          addLog(`Target Yeast Gene: ${orth.symbol}`);
          if (orth.tiedSymbols && orth.tiedSymbols.length > 0) {
              addLog(`💡 Multiple equally scored orthologs found (${[orth.symbol, ...orth.tiedSymbols].join(', ')}). Automatically selected ${orth.symbol}.`);
          }
      }

      // --- Resolve SGD ID for Links and Phenotypes ---
      let validSgdId = null;
      try {
          validSgdId = await getSgdId(orth.symbol);
          if (validSgdId) {
              setYeastSgdId(validSgdId);
              // addLog(`Resolved Alliance/SGD ID: ${validSgdId}`);
          }
      } catch (e) {
          console.warn("Failed to resolve SGD ID", e);
      }

      // 3. Sequences
      addLog("Fetching sequences...");
      
      let humanSeqRecord = { seq: "" };
      if (!yeastOnlyMode && gInfo?.uniprot_id) {
          humanSeqRecord = await fetchSequence(gInfo.uniprot_id);
      }
      
      const yeastSeqRecord = await fetchSequence(orth.id, true); // true for yeast logic
      
      // Attempt to extract Yeast UniProt ID
      const yHeader = yeastSeqRecord.description || "";
      const yMatch = yHeader.match(/>(?:sp|tr)\|([A-Z0-9]+)\|/);
      if (yMatch) {
          setYeastUniProtId(yMatch[1]);
      }

      // 4. Alignment
      let alignRes;
      
      if (yeastOnlyMode) {
          addLog("Skipping alignment (Yeast-Only mode)...");
          // Create a dummy alignment where human is all gaps
          alignRes = {
              aligned1: "-".repeat(yeastSeqRecord.seq.length),
              aligned2: yeastSeqRecord.seq
          };
          setAlignment({
              humanSeqAligned: alignRes.aligned1,
              yeastSeqAligned: alignRes.aligned2,
              score: 0,
              percentIdentity: 0,
              percentSimilarity: 0
          });
      } else {
          addLog(`Aligning sequences (${settings.alignment.algorithm})...`);
          alignRes = alignSequences(humanSeqRecord.seq, yeastSeqRecord.seq, settings.alignment);
          
          // Calculate Stats
          let identityCount = 0;
          let similarityCount = 0;
          let totalAligned = 0;
          for (let i = 0; i < alignRes.aligned1.length; i++) {
            const c1 = alignRes.aligned1[i];
            const c2 = alignRes.aligned2[i];
            if (c1 !== '-' || c2 !== '-') {
               totalAligned++;
               if (c1 !== '-' && c2 !== '-') {
                   if (c1 === c2) {
                       identityCount++;
                       similarityCount++;
                   } else if (isSimilarAA(c1, c2)) {
                       similarityCount++;
                   }
               }
            }
          }
          const pIdentity = (identityCount / totalAligned) * 100;
          const pSimilarity = (similarityCount / totalAligned) * 100;

          // Check Conservation Thresholds
          if (pIdentity < settings.filtering.minPercentIdentity) {
              throw new Error(`Protein Identity (${pIdentity.toFixed(1)}%) is below minimum setting (${settings.filtering.minPercentIdentity}%). Analysis stopped.`);
          }
          if (pSimilarity < settings.filtering.minPercentSimilarity) {
              throw new Error(`Protein Similarity (${pSimilarity.toFixed(1)}%) is below minimum setting (${settings.filtering.minPercentSimilarity}%). Analysis stopped.`);
          }

          setAlignment({
              humanSeqAligned: alignRes.aligned1,
              yeastSeqAligned: alignRes.aligned2,
              score: 0,
              percentIdentity: pIdentity,
              percentSimilarity: pSimilarity
          });
          addLog("Alignment complete.");
      }

      // 5. Variants (ClinVar + AlphaMissense)
      const parsedVariants: Variant[] = [];

      // -- Manual Mutation Logic --
      if (manualVariantEnabled && manualResidue && manualTargetAA) {
          try {
              const resNum = parseInt(manualResidue);
              if (!isNaN(resNum)) {
                  const isHumanNum = manualNumberingSpecies === 'human';
                  
                  // In yeastOnly mode, force yeast numbering logic regardless of toggle state to avoid errors, 
                  // or ensure user set it correctly. Since we auto-toggle, assumes 'yeast'.
                  const effectiveSpecies = yeastOnlyMode ? 'yeast' : manualNumberingSpecies; 
                  
                  const seqToCount = (effectiveSpecies === 'human') ? alignRes.aligned1 : alignRes.aligned2;
                  
                  let currentCount = 0;
                  let alignIndex = -1;
                  
                  for(let i=0; i<seqToCount.length; i++) {
                      if(seqToCount[i] !== '-') {
                          currentCount++;
                          if(currentCount === resNum) {
                              alignIndex = i;
                              break;
                          }
                      }
                  }

                  if (alignIndex !== -1) {
                      const hChar = alignRes.aligned1[alignIndex];
                      const yChar = alignRes.aligned2[alignIndex];
                      
                      // Calculate positions
                      let hPos = 0; 
                      let yPos = 0;
                      for(let k=0; k<=alignIndex; k++) {
                          if (alignRes.aligned1[k] !== '-') hPos++;
                          if (alignRes.aligned2[k] !== '-') yPos++;
                      }

                      let status: Variant['conservedStatus'] = 'N/A';
                      if (hChar === yChar) status = 'Identical';
                      else if (isSimilarAA(hChar, yChar)) status = 'Similar';
                      else if (yChar === '-') status = 'Gap';
                      else status = 'Mismatch';
                      
                      // In yeast-only mode, status is conceptually N/A or "Yeast Only"
                      if (yeastOnlyMode) status = 'N/A';

                      // Calculate Local Homology for Manual Variant
                      const localScore = calculateLocalHomology(alignRes.aligned1, alignRes.aligned2, alignIndex);

                      parsedVariants.push({
                          hgvs: `Manual: ${effectiveSpecies === 'human' ? 'Human' : 'Yeast'} p.${(effectiveSpecies === 'human' ? hChar : yChar)}${resNum}${manualTargetAA.toUpperCase()}`,
                          proteinChange: `${(effectiveSpecies === 'human' ? hChar : yChar)}${resNum}${manualTargetAA.toUpperCase()}`,
                          residue: hPos, // This is Human Pos. In yeastOnly, this will be 0.
                          refAA: hChar,
                          targetAA: manualTargetAA.toUpperCase(),
                          conservedStatus: status,
                          yeastAA: yChar,
                          yeastPos: yPos.toString(),
                          amScore: null,
                          clinVarId: undefined,
                          clinVarVariantId: undefined,
                          localHomologyScore: localScore,
                          clinicalSignificance: 'N/A',
                          clinVarStars: 0,
                          reviewStatus: 'Manual Entry'
                      });
                      addLog(`Added manual variant at Human pos ${hPos} / Yeast pos ${yPos} (Loc. Homology: ${localScore}%)`);
                  } else {
                      addLog("Manual variant residue out of bounds.");
                  }
              }
          } catch (e) {
              addLog("Error processing manual variant.");
          }
      }

      if (!yeastOnlyMode) {
          // Prepare Significance Filter
          const sigTerms: string[] = [];
          const sigs = settings.filtering.clinVarSignificance.length > 0 
              ? settings.filtering.clinVarSignificance 
              : ['VUS', 'CONFLICTING'];
          
          if (sigs.includes('VUS')) sigTerms.push('Uncertain significance');
          if (sigs.includes('PATHOGENIC')) {
              sigTerms.push('Pathogenic');
          }
          if (sigs.includes('LIKELY_PATHOGENIC')) {
              sigTerms.push('Likely pathogenic');
          }
          if (sigs.includes('BENIGN')) {
              sigTerms.push('Benign');
          }
          if (sigs.includes('LIKELY_BENIGN')) {
              sigTerms.push('Likely benign');
          }
          if (sigs.includes('CONFLICTING')) {
              sigTerms.push('Conflicting interpretations of pathogenicity');
          }
          if (sigs.includes('DISCORDANT')) {
              sigTerms.push('Pathogenic', 'Likely pathogenic', 'Benign', 'Likely benign');
          }

          const sigLabels: string[] = [];
          if (sigs.includes('PATHOGENIC')) sigLabels.push('Pathogenic');
          if (sigs.includes('LIKELY_PATHOGENIC')) sigLabels.push('Likely Pathogenic');
          if (sigs.includes('BENIGN')) sigLabels.push('Benign');
          if (sigs.includes('LIKELY_BENIGN')) sigLabels.push('Likely Benign');
          if (sigs.includes('VUS')) sigLabels.push('VUS');
          if (sigs.includes('CONFLICTING')) sigLabels.push('Conflicting');
          if (sigs.includes('DISCORDANT')) sigLabels.push('Discordant (ClinVar ⇄ AM)');
          const sigDescription = sigLabels.length > 0 ? sigLabels.join(', ') : 'VUS';

          const starsDescription = settings.filtering.minClinVarStars > 0 ? ` (≥ ${settings.filtering.minClinVarStars}★)` : '';
          addLog(`Fetching ClinVar variants [${sigDescription}]${starsDescription} & AlphaMissense data...`);

          const rawHits = await fetchClinVarVariants(gInfo!.symbol, sigTerms, {
              excludeUncertain: !sigs.includes('VUS'),
              excludeConflicting: !sigs.includes('CONFLICTING'),
              minStars: settings.filtering.minClinVarStars
          });
          addLog(`Found ${rawHits.length} raw hits. Parsing and applying strict significance filters...`);

          for (const hit of rawHits) {
             // Handle ClinVar structure (array vs obj)
             let clinVarEntry = hit.clinvar;
             if (Array.isArray(clinVarEntry)) clinVarEntry = clinVarEntry[0];
             
             const pChange = clinVarEntry?.hgvs?.protein;
             const pChangeStr = Array.isArray(pChange) ? pChange[0] : pChange;

             if (pChangeStr && pChangeStr.includes('p.')) {
                const parsed = parseProteinChange(pChangeStr);
                if (parsed) {
                    // Check Conservation
                    // Map parsed.res (1-based) to alignment index
                    let currentResCount = 0;
                    let alignIndex = -1;
                    for (let i = 0; i < alignRes.aligned1.length; i++) {
                        if (alignRes.aligned1[i] !== '-') {
                            currentResCount++;
                            if (currentResCount === parsed.res) {
                                alignIndex = i;
                                break;
                            }
                        }
                    }
                    
                    let status: Variant['conservedStatus'] = 'N/A';
                    let yeastAA = '-';
                    let yeastPos = '-';
                    let localScore = 0;

                    if (alignIndex !== -1) {
                        const hChar = alignRes.aligned1[alignIndex];
                        const yChar = alignRes.aligned2[alignIndex];
                        
                        // Calculate Local Homology Score
                        localScore = calculateLocalHomology(alignRes.aligned1, alignRes.aligned2, alignIndex);

                        if (yChar === '-') {
                            status = 'Gap';
                        } else {
                            // Calculate Yeast Pos
                            let yCount = 0;
                            for(let k=0; k<=alignIndex; k++) {
                                if (alignRes.aligned2[k] !== '-') yCount++;
                            }
                            yeastAA = yChar;
                            yeastPos = yCount.toString();

                            if (hChar === yChar) status = 'Identical';
                            else if (isSimilarAA(hChar, yChar)) status = 'Similar';
                            else status = 'Mismatch';
                        }
                    }
                    
                    // AlphaMissense Score from dbNSFP
                    let amScore: number | null = null;
                    const dbnsfpEntry = Array.isArray(hit.dbnsfp) ? hit.dbnsfp[0] : hit.dbnsfp;
                    if (dbnsfpEntry?.alphamissense?.score) {
                        const rawScore = dbnsfpEntry.alphamissense.score;
                        amScore = parseFloat(Array.isArray(rawScore) ? rawScore[0] : rawScore);
                    }

                    // Filtering Logic based on Advanced Settings
                    // 1. Conservation
                    let keep = false;
                    if (status === 'Identical' || status === 'Similar') keep = true;
                    if (settings.filtering.allowMismatches && status === 'Mismatch') keep = true;
                    if (settings.filtering.excludeGaps && status === 'Gap') keep = false;

                    // 1.1 Local Homology Filter
                    if (localScore < settings.filtering.minLocalHomology) keep = false;

                    // 1.2 AlphaMissense Score Filter
                    // If user is at default [0.0, 1.0], allow variants even if AlphaMissense score is absent
                    // If user set a custom score range, enforce that amScore must be within [minScore, maxScore]
                    const isDefaultScoreRange = minScore <= 0.0 && maxScore >= 1.0;
                    const passesScore = isDefaultScoreRange ? true : (amScore !== null && amScore >= minScore && amScore <= maxScore);
                    if (!passesScore) keep = false;

                    if (keep) {
                        let cleanName = pChangeStr;
                        const hgvsMatch = cleanName.match(/p\.([A-Z][a-z]{2}\d+[A-Z][a-z]{2})/);
                        
                        if (hgvsMatch) {
                            cleanName = hgvsMatch[1];
                        } else {
                            if (cleanName.includes(':')) {
                                cleanName = cleanName.split(':')[1];
                            }
                            cleanName = cleanName.replace('p.', '');
                        }

                                // 2. ClinVar Significance Classification across ALL RCV submissions
                                let rcvs = clinVarEntry.rcv;
                                let rcvList: any[] = [];
                                if (rcvs) {
                                    rcvList = Array.isArray(rcvs) ? rcvs : [rcvs];
                                }

                                const allSigTerms: string[] = [];
                                for (const rcv of rcvList) {
                                    if (rcv?.clinical_significance) {
                                        if (Array.isArray(rcv.clinical_significance)) {
                                            rcv.clinical_significance.forEach((s: any) => allSigTerms.push(String(s).toLowerCase().trim()));
                                        } else {
                                            allSigTerms.push(String(rcv.clinical_significance).toLowerCase().trim());
                                        }
                                    }
                                }

                                const hasUncertain = allSigTerms.some(s => s.includes('uncertain'));
                                const hasConflictingTerm = allSigTerms.some(s => s.includes('conflicting'));
                                const hasConflictingReview = rcvList.some((r: any) => String(r?.review_status || '').toLowerCase().includes('conflicting'));
                                const hasPathogenicAssertion = allSigTerms.some(s => s.includes('pathogenic'));
                                const hasBenignAssertion = allSigTerms.some(s => s.includes('benign'));

                                // Conflicting designation check:
                                // 1. Explicit conflicting term in clinical significance
                                // 2. Review status indicating conflicting interpretations
                                // 3. Both Pathogenic/Likely Pathogenic AND Benign/Likely Benign submissions
                                // 4. Discordant assertions between Uncertain significance and Pathogenic/Benign submissions
                                const isConflicted = hasConflictingTerm || 
                                                     hasConflictingReview || 
                                                     (hasPathogenicAssertion && hasBenignAssertion) ||
                                                     (hasUncertain && (hasPathogenicAssertion || hasBenignAssertion));

                                // STRICT RULE: If user did NOT select CONFLICTING, any variant with conflicting interpretations must NOT be retrieved.
                                // This ensures that searching for VUS alone strictly omits all conflicting variants.
                                if (!sigs.includes('CONFLICTING') && isConflicted) {
                                    continue;
                                }

                                // STRICT RULE: If user did NOT select VUS, any variant with uncertain significance must NOT be retrieved
                                if (!sigs.includes('VUS') && hasUncertain) {
                                    continue;
                                }

                                const hasExactPathogenic = allSigTerms.some(s => (s === 'pathogenic' || s.startsWith('pathogenic') || s === 'pathogenic/likely pathogenic') && !s.startsWith('likely pathogenic'));
                                const hasLikelyPathogenic = allSigTerms.some(s => s.includes('likely pathogenic'));

                                const hasExactBenign = allSigTerms.some(s => (s === 'benign' || s.startsWith('benign') || s === 'benign/likely benign') && !s.startsWith('likely benign'));
                                const hasLikelyBenign = allSigTerms.some(s => s.includes('likely benign'));

                                // Categorize primary variant significance
                                let variantType = 'Unknown';
                                if (isConflicted) {
                                    variantType = 'Conflicting';
                                } else if (hasExactPathogenic && sigs.includes('PATHOGENIC')) {
                                    variantType = 'Pathogenic';
                                } else if (hasLikelyPathogenic && sigs.includes('LIKELY_PATHOGENIC')) {
                                    variantType = 'Likely Pathogenic';
                                } else if (hasExactPathogenic) {
                                    variantType = 'Pathogenic';
                                } else if (hasLikelyPathogenic) {
                                    variantType = 'Likely Pathogenic';
                                } else if (hasExactBenign && sigs.includes('BENIGN')) {
                                    variantType = 'Benign';
                                } else if (hasLikelyBenign && sigs.includes('LIKELY_BENIGN')) {
                                    variantType = 'Likely Benign';
                                } else if (hasExactBenign) {
                                    variantType = 'Benign';
                                } else if (hasLikelyBenign) {
                                    variantType = 'Likely Benign';
                                } else if (hasUncertain) {
                                    variantType = 'VUS';
                                }

                                // Post-filter against user's selected allowed significance categories
                                let isAllowed = false;
                                if (sigs.includes('PATHOGENIC') && variantType === 'Pathogenic') {
                                    isAllowed = true;
                                }
                                if (sigs.includes('LIKELY_PATHOGENIC') && variantType === 'Likely Pathogenic') {
                                    isAllowed = true;
                                }
                                if (sigs.includes('BENIGN') && variantType === 'Benign') {
                                    isAllowed = true;
                                }
                                if (sigs.includes('LIKELY_BENIGN') && variantType === 'Likely Benign') {
                                    isAllowed = true;
                                }
                                if (sigs.includes('VUS') && variantType === 'VUS') {
                                    isAllowed = true;
                                }
                                if (sigs.includes('CONFLICTING') && variantType === 'Conflicting') {
                                    isAllowed = true;
                                }
                                if (sigs.includes('DISCORDANT')) {
                                    const isBenignVar = (variantType === 'Benign' || variantType === 'Likely Benign');
                                    const isPathogenicVar = (variantType === 'Pathogenic' || variantType === 'Likely Pathogenic');
                                    if (isBenignVar && amScore !== null && amScore >= 0.56) {
                                        isAllowed = true;
                                    } else if (isPathogenicVar && amScore !== null && amScore <= 0.34) {
                                        isAllowed = true;
                                    }
                                }

                                if (!isAllowed) {
                                    continue;
                                }

                                // 3. ClinVar Review Status and Gold Stars Calculation
                                let maxStars = 0;
                                for (const rcv of rcvList) {
                                    const stars = getClinVarStarsFromStatus(rcv?.review_status);
                                    if (stars > maxStars) {
                                        maxStars = stars;
                                    }
                                }

                                // STRICT RULE: Enforce minimum ClinVar Gold Stars if configured
                                if (settings.filtering.minClinVarStars > 0 && maxStars < settings.filtering.minClinVarStars) {
                                    continue;
                                }

                                // Match primary accession for the corresponding significance
                                const primaryRcv = rcvList.find((r: any) => {
                                    const s = String(r?.clinical_significance || '').toLowerCase();
                                    if (variantType === 'Pathogenic' && s.includes('pathogenic') && !s.includes('likely')) return true;
                                    if (variantType === 'Likely Pathogenic' && s.includes('likely pathogenic')) return true;
                                    if (variantType === 'Benign' && s.includes('benign') && !s.includes('likely')) return true;
                                    if (variantType === 'Likely Benign' && s.includes('likely benign')) return true;
                                    if (variantType === 'VUS' && s.includes('uncertain')) return true;
                                    return false;
                                }) || rcvList[0];

                                const clinVarAccession = primaryRcv?.accession || clinVarEntry.rcv?.[0]?.accession || clinVarEntry.rcv?.accession;
                                const primaryReviewStatus = primaryRcv?.review_status || rcvList[0]?.review_status || '';

                                // Calculate ClinVar submitter entries count across RCV submissions
                                let totalSubmitters = 0;
                                for (const rcv of rcvList) {
                                    if (typeof rcv?.number_submitters === 'number') {
                                        totalSubmitters += rcv.number_submitters;
                                    } else if (rcv) {
                                        totalSubmitters += 1;
                                    }
                                }
                                if (totalSubmitters === 0 && rcvList.length > 0) {
                                    totalSubmitters = rcvList.length;
                                }

                                const gnomadData = extractGnomadData(hit);

                                parsedVariants.push({
                                    hgvs: pChangeStr,
                                    proteinChange: cleanName,
                                    residue: parsed.res,
                                    refAA: parsed.ref,
                                    targetAA: parsed.target,
                                    conservedStatus: status,
                                    yeastAA,
                                    yeastPos,
                                    amScore,
                                    clinVarId: clinVarAccession,
                                    clinVarVariantId: clinVarEntry.variant_id,
                                    gnomadFreq: gnomadData.freq,
                                    gnomadLink: gnomadData.link,
                                    gnomadLinkV4: gnomadData.linkV4,
                                    gnomadDetails: gnomadData.details,
                                    localHomologyScore: localScore,
                                    clinicalSignificance: variantType,
                                    clinVarStars: maxStars,
                                    reviewStatus: primaryReviewStatus,
                                    clinVarSubmitters: totalSubmitters > 0 ? totalSubmitters : undefined
                                });
                            }
                }
             }
          }
      }
      
      // Sort variants: Manual first, then Local Homology Score Descending, then residue position
      parsedVariants.sort((a, b) => {
          const aIsManual = a.hgvs.startsWith('Manual:');
          const bIsManual = b.hgvs.startsWith('Manual:');
          if (aIsManual && !bIsManual) return -1;
          if (!aIsManual && bIsManual) return 1;
          
          // Primary Sort: Local Homology Score (High to Low)
          const scoreA = a.localHomologyScore ?? -1;
          const scoreB = b.localHomologyScore ?? -1;
          if (scoreA !== scoreB) return scoreB - scoreA;

          return a.residue - b.residue;
      });

      // Check if targetHgvs was passed from Discordant Explorer to auto-select
      let selectedIndex = -1;
      if (targetHgvs) {
        const cleanTarget = targetHgvs.replace(/^p\./, '').trim().toLowerCase();
        
        // 1. Try finding by full or partial HGVS string or ClinVar variant ID
        selectedIndex = parsedVariants.findIndex(v => {
          const vHgvs = (v.hgvs || '').replace(/^p\./, '').trim().toLowerCase();
          const vProt = (v.proteinChange || '').replace(/^p\./, '').trim().toLowerCase();
          if (vHgvs === cleanTarget || vProt === cleanTarget) return true;
          if (vHgvs.includes(cleanTarget) || cleanTarget.includes(vHgvs)) return true;
          if (targetVariantObj?.clinVarVariantId && v.clinVarVariantId && String(v.clinVarVariantId) === String(targetVariantObj.clinVarVariantId)) return true;
          return false;
        });

        // 2. If not found, match by residue number from targetHgvs (e.g. Ser503Cys -> 503)
        if (selectedIndex === -1) {
          const m = cleanTarget.match(/([a-z]+)(\d+)([a-z]+)/);
          if (m) {
            const resNum = parseInt(m[2], 10);
            selectedIndex = parsedVariants.findIndex(v => v.residue === resNum);
          }
        }

        // 3. If still not in parsedVariants (filtered out by ClinVar significance or page limits),
        // synthesize the variant directly from targetVariantObj and alignment so it's guaranteed present!
        if (selectedIndex === -1 && alignRes) {
          try {
            const pChange = targetVariantObj?.hgvsProtein || targetHgvs;
            const parsed = parseProteinChange(pChange);
            if (parsed) {
              let currentResCount = 0;
              let alignIndex = -1;
              for (let i = 0; i < alignRes.humanSeqAligned.length; i++) {
                if (alignRes.humanSeqAligned[i] !== '-') currentResCount++;
                if (currentResCount === parsed.res) {
                  alignIndex = i;
                  break;
                }
              }

              let yeastAA = 'N/A';
              let yeastPos = 'N/A';
              let conservedStatus: 'Identical' | 'Similar' | 'Mismatch' | 'Gap' | 'N/A' = 'N/A';

              if (alignIndex !== -1) {
                yeastAA = alignRes.yeastSeqAligned[alignIndex];
                if (yeastAA !== '-') {
                  let yCount = 0;
                  for (let i = 0; i <= alignIndex; i++) {
                    if (alignRes.yeastSeqAligned[i] !== '-') yCount++;
                  }
                  yeastPos = yCount.toString();
                  if (yeastAA === parsed.ref) conservedStatus = 'Identical';
                  else if (isSimilarAA(parsed.ref, yeastAA)) conservedStatus = 'Similar';
                  else conservedStatus = 'Mismatch';
                } else {
                  yeastPos = 'Gap';
                  conservedStatus = 'Gap';
                }
              }

              const synthesizedVar: Variant = {
                hgvs: pChange,
                proteinChange: pChange,
                residue: parsed.res,
                refAA: parsed.ref,
                targetAA: parsed.target,
                conservedStatus,
                yeastAA,
                yeastPos,
                amScore: targetVariantObj?.amScore ?? null,
                clinVarVariantId: targetVariantObj?.clinVarVariantId,
                clinVarId: targetVariantObj?.clinVarVariantId ? `VCV${targetVariantObj.clinVarVariantId}` : undefined,
                gnomadFreq: targetVariantObj?.gnomadAf ?? null,
                gnomadLink: targetVariantObj?.gnomadLink ?? null,
                gnomadLinkV4: targetVariantObj?.gnomadLinkV4 ?? null,
                gnomadDetails: targetVariantObj?.gnomadAf ? {
                  source: (targetVariantObj?.gnomadExomeAf ? 'exome' : 'genome') as 'exome' | 'genome',
                  version: 'v2.1.1',
                  af: targetVariantObj.gnomadAf,
                  ac: targetVariantObj.gnomadExomeAc ?? targetVariantObj.gnomadGenomeAc ?? undefined,
                  an: targetVariantObj.gnomadExomeAn ?? targetVariantObj.gnomadGenomeAn ?? undefined,
                  exomeAf: targetVariantObj.gnomadExomeAf,
                  genomeAf: targetVariantObj.gnomadGenomeAf,
                  exomeAc: targetVariantObj.gnomadExomeAc,
                  exomeAn: targetVariantObj.gnomadExomeAn,
                  genomeAc: targetVariantObj.gnomadGenomeAc,
                  genomeAn: targetVariantObj.gnomadGenomeAn,
                } : null,
                clinicalSignificance: targetVariantObj?.clinVarSignificance || 'Discordant',
                clinVarStars: targetVariantObj?.clinVarStars || 0,
                reviewStatus: targetVariantObj?.clinVarReviewStatus || 'criteria provided',
                clinVarSubmitters: targetVariantObj?.clinVarSubmissions || 1,
                localHomologyScore: 1.0
              };

              parsedVariants.unshift(synthesizedVar);
              selectedIndex = 0;
            }
          } catch (e) {
            console.warn("Could not synthesize target variant:", e);
          }
        }
      }

      setVariants(parsedVariants);
      setIsYeastOnlyMode(yeastOnlyMode);
      
      // Auto-select target variant from Discordant Explorer or manual variant
      if (selectedIndex !== -1) {
        setSelectedVariantIndices([selectedIndex]);
        setVisibleVariantsCount(Math.max(10, selectedIndex + 5));
        addLog(`Target variant ${targetHgvs} auto-selected for analysis.`);
        setTimeout(() => {
          variantsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 350);
      } else if (parsedVariants.length > 0 && parsedVariants[0].hgvs.startsWith('Manual:')) {
        setSelectedVariantIndices([0]);
      }

      addLog(`Analysis complete. Found ${parsedVariants.length} variants.`);

      // 6. Phenotypes
      addLog("Fetching Yeast phenotypes...");
      // Prefer SGD ID if resolved, otherwise default to whatever ID we have (usually Entrez)
      const phenoId = validSgdId || orth.id;
      const phenos = await fetchYeastPhenotypes(phenoId, orth.symbol);
      setPhenotypes(phenos);
      
      setState(prev => ({ ...prev, step: 'complete' }));
      addLog("Pipeline finished. Ready for variant selection and AI Plan generation.");

    } catch (err) {
      handleError((err as Error).message);
    }
  };

  const toggleVariantSelection = (index: number) => {
      if (settings.filtering.multiVariantSelection) {
          if (selectedVariantIndices.includes(index)) {
              setSelectedVariantIndices(selectedVariantIndices.filter(i => i !== index));
          } else {
              setSelectedVariantIndices([...selectedVariantIndices, index]);
          }
      } else {
          if (selectedVariantIndices.includes(index)) {
              setSelectedVariantIndices([]);
          } else {
              setSelectedVariantIndices([index]);
          }
      }
      // Reset dependent data
      setCrisprResults([]);
      setAiPlan('');
      setSelectedCrisprIndicesObj({});
  };

  const handleResidueClick = (residue: number) => {
      const sortedIndex = sortedAndMappedVariants.findIndex(obj => obj.v.residue === residue);
      const originalIndex = sortedIndex !== -1 ? sortedAndMappedVariants[sortedIndex].originalIndex : -1;
      if (sortedIndex !== -1) {
          // Ensure visible if it's outside current count
          if (sortedIndex >= visibleVariantsCount) {
             setVisibleVariantsCount(Math.min(variants.length, sortedIndex + 15));
          }
          
          setSelectedVariantIndices(settings.filtering.multiVariantSelection ? [...selectedVariantIndices.filter(i => i !== originalIndex), originalIndex] : [originalIndex]);
          setCrisprResults([]);
          setAiPlan('');
          setSelectedCrisprIndicesObj({});
          
          // Scroll removed to prevent focus jump
      }
  };

  const togglePhenotypeSelection = (pheno: string) => {
    if (selectedPhenotype === pheno) {
        setSelectedPhenotype(null);
    } else {
        setSelectedPhenotype(pheno);
    }
    // Reset AI Plan to force regeneration with new context
    setAiPlan('');
  };

  const handleGeneratePlan = async () => {
    if (!geneInfo || !ortholog) return;
    
    setIsGeneratingAI(true);
    setAiPlan(''); // Start clean
    addLog("Generating AI Experimental Plan...");
    
    const selectedVariants = selectedVariantIndices.map(i => variants[i]);

    // Capture Structure Image
    let structureImage: string | null = null;
    if (structureViewerRef.current) {
        try {
            await structureViewerRef.current.ensureOverlayEnabled();
            const rawImage = structureViewerRef.current.captureImage();
            if (rawImage) {
                // Resize image to prevent "Error in input stream" due to large payload
                structureImage = await new Promise<string>((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const MAX_WIDTH = 384;
                        const MAX_HEIGHT = 384;
                        let width = img.width;
                        let height = img.height;

                        if (width > height) {
                            if (width > MAX_WIDTH) {
                                height *= MAX_WIDTH / width;
                                width = MAX_WIDTH;
                            }
                        } else {
                            if (height > MAX_HEIGHT) {
                                width *= MAX_HEIGHT / height;
                                height = MAX_HEIGHT;
                            }
                        }
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.drawImage(img, 0, 0, width, height);
                            // Use JPEG for smaller payload size
                            resolve(canvas.toDataURL('image/jpeg', 0.4));
                        } else {
                            resolve(rawImage);
                        }
                    };
                    img.onerror = () => resolve(rawImage);
                    img.src = rawImage;
                });
            }
        } catch (e) {
            console.warn("Failed to capture structure image", e);
        }
    }

    try {
      await generateExperimentalPlan(
          geneInfo.symbol, 
          ortholog.symbol, 
          phenotypes, 
          variants, 
          (text) => setAiPlan(text), // Update state on chunk
          selectedVariants, 
          selectedPhenotype,
          settings.ai,
          // New Argument: Conservation Metrics
          {
            dioptScore: ortholog.score,
            percentIdentity: alignment?.percentIdentity,
            percentSimilarity: alignment?.percentSimilarity
          },
          structureImage
      );
      addLog("AI Plan generated successfully.");
    } catch (err) {
      const errMsg = (err as Error).message || String(err);
      addLog(`Error generating AI plan: ${errMsg}`);
      setAiPlan(prev => {
        const prefix = prev.trim() ? prev + '\n\n---\n\n' : '';
        return prefix + `### ⚠️ AI Plan Generation Interrupted\n\n${errMsg}`;
      });
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleGenerateCrispr = async () => {
    if (!ortholog || selectedVariantIndices.length === 0) return;
    
    setIsGeneratingCrispr(true);
    setCrisprResults([]);
    setControlCrisprResults({ benign: [], pathogenic: [] });
    setSelectedCrisprIndicesObj({});
    addLog(`Fetching Yeast Genomic DNA for ${ortholog.symbol}...`);

    try {
        const { sequence: dnaSeq, codingExons, source } = await fetchYeastGeneSequence(ortholog.symbol);
        if (source === 'Alliance Genome (AllianceMine)') {
            addLog(`Fetched Yeast Genomic DNA for ${ortholog.symbol} from Alliance of Genome Resources (AllianceMine backup).`);
        } else {
            addLog(`Fetched Yeast Genomic DNA for ${ortholog.symbol} from Ensembl.`);
        }
        
        addLog("Scanning for Cas9 sites and designing repair templates...");
        
        let allTemplates: RepairResult[] = [];
        
        for (const variantIdx of selectedVariantIndices) {
            const selectedVariant = variants[variantIdx];
            const yeastPos = parseInt(selectedVariant.yeastPos);
            
            if (isNaN(yeastPos)) {
                addLog(`Warning: Invalid Yeast Position for variant ${selectedVariant.proteinChange}. Skipping.`);
                continue;
            }

            const mutationIndex = getMutationIndex(codingExons, yeastPos);
            const cas9Sites = findCas9Sites(dnaSeq, mutationIndex, settings.crispr);
            let templates = generateRepairTemplates(
                dnaSeq, 
                cas9Sites, 
                mutationIndex, 
                selectedVariant.targetAA, 
                repairLength,
                settings.crispr
            );
            
            // Tag with variant info
            templates = templates.map(t => ({ ...t, variant: selectedVariant }));
            allTemplates = allTemplates.concat(templates);
        }

        if (allTemplates.length === 0) {
            addLog("No valid CRISPR repair templates found for selected variants.");
        } else {
            setCrisprResults(allTemplates);
            addLog(`Found ${allTemplates.length} total CRISPR primer designs.`);
        }

        if (includeControls && alignment && !isYeastOnlyMode) {
            addLog("Fetching control variants from ClinVar...");
            try {
                const sigTerms = ['Pathogenic', 'Likely pathogenic', 'Benign', 'Likely benign'];
                const rawHits = await fetchClinVarVariants(geneInfo?.symbol || '', sigTerms, {
                    excludeUncertain: true,
                    excludeConflicting: true
                });
                
                const getClinVarStars = (reviewStatus: string | string[]): number => {
                    return getClinVarStarsFromStatus(reviewStatus);
                };

                const getControlPriority = (hit: any, type: 'benign' | 'pathogenic'): number => {
                    let rcvs = hit.clinvar?.rcv;
                    if (!rcvs) return 999;
                    if (!Array.isArray(rcvs)) rcvs = [rcvs];
                    
                    // Reject any variant with uncertain or conflicting interpretations
                    for (const rcv of rcvs) {
                        const sig = String(rcv?.clinical_significance || '').toLowerCase();
                        if (sig.includes('uncertain') || sig.includes('conflicting')) return 999;
                    }

                    let bestPriority = 999;
                    for (const rcv of rcvs) {
                        const sig = rcv.clinical_significance || '';
                        const sigLower = Array.isArray(sig) ? sig[0].toLowerCase() : sig.toLowerCase();
                        
                        const isExact = type === 'benign' 
                            ? (sigLower === 'benign' || sigLower === 'benign/likely benign')
                            : (sigLower === 'pathogenic' || sigLower === 'pathogenic/likely pathogenic');
                        const isLikely = type === 'benign' 
                            ? sigLower === 'likely benign' 
                            : sigLower === 'likely pathogenic';
                            
                        if (!isExact && !isLikely) continue;
                        
                        const reviewStatus = rcv.review_status || '';
                        const stars = getClinVarStars(reviewStatus);
                        
                        let priority = 999;
                        if (stars >= 3 && isExact) priority = 1;
                        else if (stars === 2 && isExact) priority = 2;
                        else if (stars >= 3 && isLikely) priority = 3;
                        else if (stars === 1 && isExact) priority = 4;
                        else if (stars === 2 && isLikely) priority = 5;
                        else if (stars === 1 && isLikely) priority = 6;
                        else if (stars === 0 && isExact) priority = 7;
                        else if (stars === 0 && isLikely) priority = 8;
                        
                        if (priority < bestPriority) bestPriority = priority;
                    }
                    return bestPriority;
                };

                const findControls = (type: 'benign' | 'pathogenic', count: number) => {
                    const candidates = rawHits.map(hit => ({ hit, priority: getControlPriority(hit, type) }))
                                              .filter(c => c.priority < 999)
                                              .sort((a, b) => a.priority - b.priority);
                                              
                    const extractVariant = (hit: any) => {
                        let clinVarEntry = hit.clinvar;
                        if (Array.isArray(clinVarEntry)) clinVarEntry = clinVarEntry[0];
                        const pChange = clinVarEntry?.hgvs?.protein;
                        const pChangeStr = Array.isArray(pChange) ? pChange[0] : pChange;
                        if (pChangeStr && pChangeStr.includes('p.')) {
                            const parsed = parseProteinChange(pChangeStr);
                            if (parsed) {
                                let currentResCount = 0;
                                let alignIndex = -1;
                                for (let i = 0; i < alignment.humanSeqAligned.length; i++) {
                                    if (alignment.humanSeqAligned[i] !== '-') currentResCount++;
                                    if (currentResCount === parsed.res) { alignIndex = i; break; }
                                }
                                if (alignIndex !== -1) {
                                    const yeastAA = alignment.yeastSeqAligned[alignIndex];
                                    if (yeastAA !== '-') {
                                        let yeastResCount = 0;
                                        for (let i = 0; i <= alignIndex; i++) {
                                            if (alignment.yeastSeqAligned[i] !== '-') yeastResCount++;
                                        }
                                        let status: Variant['conservedStatus'] = 'Mismatch';
                                        if (parsed.ref === yeastAA) status = 'Identical';
                                        else if (isSimilarAA(parsed.ref, yeastAA)) status = 'Similar';
                                        
                                        if ((status === 'Identical' || status === 'Similar') && parsed.target !== yeastAA) {
                                            let cleanName = pChangeStr;
                                            const hgvsMatch = cleanName.match(/p\.([A-Z][a-z]{2}\d+[A-Z][a-z]{2})/);
                                            if (hgvsMatch) cleanName = hgvsMatch[1];
                                            else {
                                                if (cleanName.includes(':')) cleanName = cleanName.split(':')[1];
                                                cleanName = cleanName.replace('p.', '');
                                            }
                                            const rcvObj = clinVarEntry.rcv?.[0] || clinVarEntry.rcv;
                                            const stars = getClinVarStarsFromStatus(rcvObj?.review_status);
                                            const rcvs = Array.isArray(clinVarEntry.rcv) ? clinVarEntry.rcv : (clinVarEntry.rcv ? [clinVarEntry.rcv] : []);
                                            let subCount = 0;
                                            for (const r of rcvs) {
                                                if (typeof r?.number_submitters === 'number') subCount += r.number_submitters;
                                                else if (r) subCount += 1;
                                            }
                                            if (subCount === 0 && rcvs.length > 0) subCount = rcvs.length;

                                            const ctrlGnomad = extractGnomadData(hit);

                                            return {
                                                variant: {
                                                    hgvs: pChangeStr,
                                                    proteinChange: cleanName,
                                                    residue: parsed.res,
                                                    refAA: parsed.ref,
                                                    targetAA: parsed.target,
                                                    conservedStatus: status,
                                                    yeastAA,
                                                    yeastPos: yeastResCount.toString(),
                                                    amScore: null,
                                                    clinVarId: rcvObj?.accession,
                                                    clinVarVariantId: clinVarEntry.variant_id,
                                                    gnomadFreq: ctrlGnomad.freq,
                                                    gnomadLink: ctrlGnomad.link,
                                                    gnomadLinkV4: ctrlGnomad.linkV4,
                                                    gnomadDetails: ctrlGnomad.details,
                                                    clinVarStars: stars,
                                                    reviewStatus: rcvObj?.review_status || '',
                                                    clinicalSignificance: type === 'benign' ? 'Benign' : 'Pathogenic',
                                                    clinVarSubmitters: subCount > 0 ? subCount : undefined
                                                },
                                                yeastPos: yeastResCount
                                            };
                                        }
                                    }
                                }
                            }
                        }
                        return null;
                    };

                    const found = [];
                    const seen = new Set<string>();
                    
                    for (const { hit } of candidates) {
                        if (found.length >= count) break;
                        const res = extractVariant(hit);
                        if (res && !seen.has(res.variant.hgvs)) {
                            seen.add(res.variant.hgvs);
                            found.push(res);
                        }
                    }
                    return found;
                };

                const benignControls = findControls('benign', numBenignControls);
                const pathogenicControls = findControls('pathogenic', numPathogenicControls);

                const newControlResults: {
                  benign: { variant: Variant, results: RepairResult[] }[],
                  pathogenic: { variant: Variant, results: RepairResult[] }[]
                } = { benign: [], pathogenic: [] };

                for (const benignControl of benignControls) {
                    const mutIndex = getMutationIndex(codingExons, benignControl.yeastPos);
                    const cSites = findCas9Sites(dnaSeq, mutIndex, settings.crispr);
                    const tmpls = generateRepairTemplates(dnaSeq, cSites, mutIndex, benignControl.variant.targetAA, repairLength, settings.crispr);
                    if (tmpls.length > 0) newControlResults.benign.push({ variant: benignControl.variant, results: tmpls });
                }
                for (const pathogenicControl of pathogenicControls) {
                    const mutIndex = getMutationIndex(codingExons, pathogenicControl.yeastPos);
                    const cSites = findCas9Sites(dnaSeq, mutIndex, settings.crispr);
                    const tmpls = generateRepairTemplates(dnaSeq, cSites, mutIndex, pathogenicControl.variant.targetAA, repairLength, settings.crispr);
                    if (tmpls.length > 0) newControlResults.pathogenic.push({ variant: pathogenicControl.variant, results: tmpls });
                }
                
                setControlCrisprResults(newControlResults);
                addLog(`Found ${newControlResults.benign.length} benign and ${newControlResults.pathogenic.length} pathogenic controls.`);
            } catch (e) {
                addLog(`Error fetching controls: ${(e as Error).message}`);
            }
        }
    } catch (e) {
        addLog(`CRISPR Design Error: ${(e as Error).message}`);
    } finally {
        setIsGeneratingCrispr(false);
    }
  };

  const handleResetCrispr = () => {
      setCrisprResults([]);
      setSelectedCrisprIndicesObj({});
  };

  const handleExportOligosCSV = () => {
      const rows = [
          ['Name', 'Sequence', 'Variant', 'Type', 'Description']
      ];

      crisprGroups.forEach(group => {
          const localIndex = selectedCrisprIndicesObj[group.variantKey] || 0;
          const result = group.results[localIndex];
          
          if (!result) return;
          
          const prefix = `${group.variantKey}_D${localIndex + 1}`;
          
          rows.push([`${prefix}_sgRNA_Target`, result.site.sequence, group.variantKey, 'sgRNA', 'Guide Target Sequence (20nt)']);
          rows.push([`${prefix}_sgRNA_w_PAM`, result.guideSeqWithPam, group.variantKey, 'sgRNA', 'Guide + PAM Sequence']);
          if (settings.crispr.cloningType === 'NoClo') {
              rows.push([`${prefix}_Target_dsDNA`, result.cloningOligoA, group.variantKey, 'dsDNA', 'Target dsDNA']);
          } else {
              rows.push([`${prefix}_Guide_F`, result.cloningOligoA, group.variantKey, 'Oligo', 'Cloning Oligo A (Forward)']);
              rows.push([`${prefix}_Guide_R`, result.cloningOligoB, group.variantKey, 'Oligo', 'Cloning Oligo B (Reverse)']);
          }
          rows.push([`${prefix}_Repair`, result.repairTemplate, group.variantKey, 'Repair Template', 'Mutant Repair Template']);
          rows.push([`${prefix}_Repair_Del`, result.deletionRepairTemplate, group.variantKey, 'Repair Template', 'Deletion Control Repair Template']);
          
          if (result.verificationPrimers) {
              rows.push([`${prefix}_Verify_F`, result.verificationPrimers.forward, group.variantKey, 'Primer', 'Verification Forward Primer']);
              rows.push([`${prefix}_Verify_R`, result.verificationPrimers.reverse, group.variantKey, 'Primer', 'Verification Reverse Primer']);
          }
      });

      const csvContent = rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `oligos_${ortholog?.symbol || 'export'}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could add toast notification here
  };
  
  const handleShowMore = () => {
    setVisibleVariantsCount(prev => Math.min(prev + 20, variants.length));
  };

  const getScoreColor = (score: number) => {
    if (score >= 60) return "bg-green-100 text-green-800 border-green-200";
    if (score >= 40) return "bg-yellow-100 text-yellow-800 border-yellow-200";
    return "bg-red-100 text-red-800 border-red-200";
  };

  const renderCrisprResult = (currentCrispr: RepairResult, isControl: boolean = false) => {
      const mutIndex = currentCrispr.mutationPosition - currentCrispr.homologyStart;
      const tLen = currentCrispr.repairTemplate.length;
      
      // Mutation Distances
      const distStart = mutIndex;
      const distEnd = tLen - (mutIndex + 3); // 3bp for codon
      
      // PAM Distances
      const siteSeqLen = currentCrispr.site.sequence.length;
      const siteStartInHomology = currentCrispr.site.position - currentCrispr.homologyStart;
      let pamIndex = -1;
      
      if (currentCrispr.site.strand === 'forward') {
           pamIndex = siteStartInHomology + (siteSeqLen - 3);
      } else {
           pamIndex = siteStartInHomology;
      }
      
      const pamDistStart = pamIndex;
      const pamDistEnd = tLen - (pamIndex + 3);

      const EDGE_THRESHOLD = 15;
      const isMutEdge = distStart < EDGE_THRESHOLD || distEnd < EDGE_THRESHOLD;
      const isPamEdge = pamDistStart < EDGE_THRESHOLD || pamDistEnd < EDGE_THRESHOLD;
      const isEdge = isMutEdge || isPamEdge;

      return (
      <div className="space-y-6 text-sm text-slate-700 dark:text-slate-300">
          {/* Variant Info */}
          {currentCrispr.variant && !isControl && (
             <div className="text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                 Design for Variant: {currentCrispr.variant.proteinChange} (Human) → {currentCrispr.variant.yeastAA}{currentCrispr.variant.yeastPos}{currentCrispr.variant.targetAA} (Yeast)
             </div>
          )}

          {/* Stats Header for current guide */}
          <div className="flex flex-wrap gap-4 text-[8px] uppercase font-bold text-emerald-700 dark:text-emerald-300/80 mb-2 items-center">
              {currentCrispr.score !== undefined ? (
                  <div className="text-[12px] font-bold">Doench Score: {currentCrispr.score}</div>
              ) : (
                  <div className="text-[11px] font-semibold text-slate-400 dark:text-slate-500" title={settings.crispr.pamConstraint !== 'NGG' || settings.crispr.guideLength !== 20 ? "Doench 2014 Rule Set 1 scoring is defined specifically for 20nt SpCas9 (NGG) guides." : "Guide is located too close to sequence terminus (<4bp) to extract 30bp context."}>
                      Doench Score: <span className="font-normal italic">N/A ({settings.crispr.pamConstraint !== 'NGG' ? settings.crispr.pamConstraint : `${settings.crispr.guideLength}nt`})</span>
                  </div>
              )}
          </div>

          {isEdge && !isControl && (
              <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200 animate-pulse">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                      <strong className="block mb-1">Warning: Critical regions near oligo edge ({'<'}15bp).</strong> 
                      <ul className="list-disc pl-4 space-y-0.5 mb-1">
                          {isMutEdge && <li>Target Mutation is <strong>{distStart < EDGE_THRESHOLD ? `${distStart}bp from start` : `${distEnd}bp from end`}</strong>.</li>}
                          {isPamEdge && <li>PAM Site is <strong>{pamDistStart < EDGE_THRESHOLD ? `${pamDistStart}bp from start` : `${pamDistEnd}bp from end`}</strong>.</li>}
                      </ul>
                      <div>Homology efficiency decreases near ends. Consider <button onClick={handleResetCrispr} className="underline hover:text-blue-600 font-bold">resetting</button> and increasing Template Length.</div>
                  </div>
              </div>
          )}

          {/* Guide Seq */}
          <div className="bg-white/60 dark:bg-slate-900/60 p-3 rounded border border-emerald-200 dark:border-emerald-800">
              <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                      <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase">Guide ({settings.crispr.pamConstraint})</div>
                      {currentCrispr.score !== undefined ? (
                          <a 
                              href="https://www.nature.com/articles/nbt.3026" 
                              target="_blank" rel="noopener noreferrer"
                              title="Doench 2014 Efficiency Score (0-100)"
                              className={`text-[10px] px-1.5 rounded border ${getScoreColor(currentCrispr.score)}`}
                          >
                              Score: {currentCrispr.score}
                          </a>
                      ) : (
                          <span 
                              className="text-[10px] px-1.5 rounded border border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800"
                              title={settings.crispr.pamConstraint !== 'NGG' || settings.crispr.guideLength !== 20 ? "Doench 2014 Rule Set 1 scoring is modeled specifically for 20nt SpCas9 NGG targets." : "Guide is located too close to sequence terminus (<4bp) for 30bp context."}
                          >
                              Score: N/A
                          </span>
                      )}
                  </div>
                  <div className="flex gap-1">
                      <button 
                          onClick={() => copyToClipboard(currentCrispr.guideSeqWithPam)}
                          className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900 rounded text-emerald-600 dark:text-emerald-400" title="Copy Guide"
                      >
                          <Copy className="w-3 h-3" />
                      </button>
                      <button 
                          onClick={() => copyToClipboard(reverseComplement(currentCrispr.guideSeqWithPam))}
                          className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900 rounded text-emerald-600 dark:text-emerald-400 text-[10px] font-bold" title="Copy Reverse Complement"
                      >
                          RC
                      </button>
                  </div>
              </div>
              <div className="font-mono text-slate-800 dark:text-slate-200 break-all">
                  {renderGuideWithPam(currentCrispr.guideSeqWithPam)}
              </div>
          </div>

          {/* Repair Templates */}
          <div className="space-y-3">
              <div className="relative group">
                  <div className="flex justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase mb-1">
                      Genomic Repair Template (Variant)
                      <button onClick={() => copyToClipboard(currentCrispr.repairTemplate)} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200"><Copy className="w-3 h-3"/></button>
                  </div>
                  <div className="font-mono text-xs text-slate-600 dark:text-slate-400 bg-white/60 dark:bg-slate-900/60 p-2 rounded break-all border border-emerald-200 dark:border-emerald-800">
                      {currentCrispr.repairTemplate}
                  </div>
              </div>
              <div className="relative group">
                  <div className="flex justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase mb-1">
                      Repair Template (Deletion Control)
                      <button onClick={() => copyToClipboard(currentCrispr.deletionRepairTemplate)} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200"><Copy className="w-3 h-3"/></button>
                  </div>
                  <div className="font-mono text-xs text-slate-600 dark:text-slate-400 bg-white/60 dark:bg-slate-900/60 p-2 rounded break-all border border-emerald-200 dark:border-emerald-800">
                      {currentCrispr.deletionRepairTemplate}
                  </div>
              </div>
          </div>

          {/* Verification */}
          <div className="grid grid-cols-1 gap-4">
              <div>
                  <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-1">
                      VERIFICATION (DNA)
                      {!isControl && <span>. Suggested: Select <span className="text-yellow-600 dark:text-brown-400">design</span> that centers <span className="text-red-600 dark:text-red-400">mutations</span> & <span className="text-blue-600 dark:text-blue-400">reset</span> to change template size if mutations near end</span>}
                  </div>
                  <div className="bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 p-2 rounded font-mono text-[10px] overflow-x-auto whitespace-pre border border-slate-200 dark:border-slate-800">
                      <div className="flex"><span className="w-8 text-slate-400 dark:text-slate-500">REF:</span>{renderRefDna(currentCrispr.dnaAlignment.original, currentCrispr.site, currentCrispr.homologyStart)}</div>
                      <div className="flex"><span className="w-8 text-slate-400 dark:text-slate-500">VAR:</span>{renderAltSeq(currentCrispr.dnaAlignment.original, currentCrispr.dnaAlignment.modified)}</div>
                      <div className="flex"><span className="w-8 text-slate-400 dark:text-slate-500">DEL:</span>{renderAltSeq(currentCrispr.dnaAlignment.original, currentCrispr.deletionDnaDisplay)}</div>
                  </div>
              </div>
              <div>
                  <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase mb-1">Verification (Protein)</div>
                  <div className="bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 p-2 rounded font-mono text-[10px] overflow-x-auto whitespace-pre border border-slate-200 dark:border-slate-800">
                      <div className="flex"><span className="w-8 text-slate-400 dark:text-slate-500">REF:</span><span>{currentCrispr.aaAlignment.original}</span></div>
                      <div className="flex"><span className="w-8 text-slate-400 dark:text-slate-500">VAR:</span>{renderAltSeq(currentCrispr.aaAlignment.original, currentCrispr.aaAlignment.modified)}</div>
                      <div className="flex"><span className="w-8 text-slate-400 dark:text-slate-500">DEL:</span>{renderAltSeq(currentCrispr.aaAlignment.original, currentCrispr.deletionProtein.substring(0, currentCrispr.aaAlignment.original.length))}</div>
                  </div>
              </div>
          </div>
          
          {/* Cloning Oligos */}
          <div className="space-y-3 pt-2 border-t border-emerald-200 dark:border-emerald-800">
              {currentCrispr.isIntegratedNoClo ? (
                  <div className="p-3 bg-emerald-50/80 dark:bg-emerald-950/40 rounded-lg border border-emerald-300 dark:border-emerald-700/80 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="text-xs font-black text-emerald-800 dark:text-emerald-200 uppercase tracking-wide flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                              NoClo All-in-One: Integrated Repair Template + sgRNA
                          </span>
                          <span className="text-[10px] font-mono font-bold bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-700">
                              {currentCrispr.cloningOligoA.length} nt
                          </span>
                      </div>
                      
                      {/* Architecture Legend */}
                      <div className="text-[10px] flex flex-wrap gap-1.5 font-mono pt-0.5 pb-1">
                          <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">5' Homology (100bp)</span>
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 font-bold">100nt Repair Donor</span>
                          <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800">tRNA/Ribozyme Linker (155bp)</span>
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800 font-bold">sgRNA (20bp)</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">3' Terminator (100bp)</span>
                      </div>

                      <div className="relative group pt-1">
                           <div className="flex justify-between text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase">
                              <span>Target dsDNA (All-in-One Integrated) <span className="normal-case text-[10px] text-slate-500 font-normal">({currentCrispr.cloningOligoA.length} bp)</span></span>
                              <button onClick={() => copyToClipboard(currentCrispr.cloningOligoA)} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200 flex items-center gap-1 text-[11px] font-bold"><Copy className="w-3 h-3"/> Copy</button>
                           </div>
                           <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all bg-white dark:bg-slate-900 p-2 rounded border border-emerald-200 dark:border-emerald-800 mt-1 select-all">{currentCrispr.cloningOligoA}</div>
                      </div>

                      {/* Deletion Control Integrated Oligo */}
                      {currentCrispr.integratedDeletionOligoA && (
                          <div className="pt-2 border-t border-emerald-200/60 dark:border-emerald-800/60 mt-2">
                              <div className="flex justify-between text-xs font-bold text-slate-600 dark:text-slate-400 uppercase">
                                  <span>Deletion Control Target dsDNA (All-in-One Integrated) <span className="normal-case text-[10px] text-slate-500 font-normal">({currentCrispr.integratedDeletionOligoA.length} bp)</span></span>
                                  <button onClick={() => copyToClipboard(currentCrispr.integratedDeletionOligoA!)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 text-[11px] font-bold"><Copy className="w-3 h-3"/> Copy</button>
                              </div>
                              <div className="font-mono text-[11px] text-slate-600 dark:text-slate-400 break-all bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800 mt-1 select-all">{currentCrispr.integratedDeletionOligoA}</div>
                          </div>
                      )}
                  </div>
              ) : settings.crispr.cloningType === 'NoClo' ? (
                  <div className="relative group">
                       <div className="flex justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                          <span>Target dsDNA <span className="normal-case text-[10px] text-slate-500 font-normal">({currentCrispr.cloningOligoA.length} bp)</span></span>
                          <button onClick={() => copyToClipboard(currentCrispr.cloningOligoA)} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200 flex items-center gap-1 text-[11px] font-bold"><Copy className="w-3 h-3"/> Copy</button>
                       </div>
                       <div className="font-mono text-xs text-slate-700 dark:text-slate-300 break-all bg-white dark:bg-slate-900 p-2 rounded border border-emerald-200 dark:border-emerald-800 mt-1 select-all">{currentCrispr.cloningOligoA}</div>
                  </div>
              ) : (
                  <>
                      <div className="relative group">
                           <div className="flex justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                              <span>Cloning Oligo A (Forward) <span className="normal-case text-[10px] text-slate-500 font-normal">({currentCrispr.cloningOligoA.length} nt)</span></span>
                              <button onClick={() => copyToClipboard(currentCrispr.cloningOligoA)} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200"><Copy className="w-3 h-3"/></button>
                           </div>
                           <div className="font-mono text-xs text-slate-600 dark:text-slate-400 break-all">{currentCrispr.cloningOligoA}</div>
                      </div>
                      <div className="relative group">
                           <div className="flex justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                              <span>Cloning Oligo B (Reverse) <span className="normal-case text-[10px] text-slate-500 font-normal">({currentCrispr.cloningOligoB.length} nt)</span></span>
                              <button onClick={() => copyToClipboard(currentCrispr.cloningOligoB)} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200"><Copy className="w-3 h-3"/></button>
                           </div>
                           <div className="font-mono text-xs text-slate-600 dark:text-slate-400 break-all">{currentCrispr.cloningOligoB}</div>
                      </div>
                  </>
              )}
          </div>

          {/* Verification Primers */}
          {currentCrispr.verificationPrimers && (
              <div className="space-y-2 pt-2 border-t border-emerald-200 dark:border-emerald-800">
                  <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase mb-1">PCR Verification Primers (Product: {currentCrispr.verificationPrimers.productSize}bp)</div>
                  <div className="relative group">
                       <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase">
                          Forward (Tm: {currentCrispr.verificationPrimers.forwardTm}°C)
                          <button onClick={() => copyToClipboard(currentCrispr.verificationPrimers!.forward)} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200"><Copy className="w-3 h-3"/></button>
                       </div>
                       <div className="font-mono text-xs text-slate-600 dark:text-slate-400 break-all bg-white/60 dark:bg-slate-900/60 p-1.5 rounded border border-emerald-200 dark:border-emerald-800">
                          {currentCrispr.verificationPrimers.forward}
                       </div>
                  </div>
                  <div className="relative group">
                       <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase">
                          Reverse (Tm: {currentCrispr.verificationPrimers.reverseTm}°C)
                          <button onClick={() => copyToClipboard(currentCrispr.verificationPrimers!.reverse)} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200"><Copy className="w-3 h-3"/></button>
                       </div>
                       <div className="font-mono text-xs text-slate-600 dark:text-slate-400 break-all bg-white/60 dark:bg-slate-900/60 p-1.5 rounded border border-emerald-200 dark:border-emerald-800">
                          {currentCrispr.verificationPrimers.reverse}
                       </div>
                  </div>
              </div>
          )}
      </div>
      );
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 transition-colors duration-300">
      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 sticky top-0 z-50 print:hidden transition-colors duration-300">
        <div className="w-full max-w-[98%] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-2 rounded-lg relative overflow-hidden group">
                 {/* Custom Budding Yeast + DNA Icon Composite */}
                 <div className="relative w-6 h-6">
                     {/* Mother Cell */}
                     <div className="absolute inset-0 border-2 border-white rounded-full"></div>
                     {/* Bud */}
                     <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full border-2 border-emerald-600"></div>
                     {/* DNA Helix (Simplified inside) */}
                     <Dna className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white" />
                 </div>
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 dark:from-emerald-400 dark:to-teal-400 bg-clip-text text-transparent">
              BUDDY
            </h1>
          </div>
          <div className="flex items-center gap-4">
              <button 
                onClick={() => setShowSettings(true)}
                className="text-sm font-medium text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400 flex items-center gap-1 transition-colors"
              >
                  <Sliders className="w-4 h-4" />
                  Advanced Settings
              </button>
              
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block"></div>

              {/* Theme Toggle Button */}
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
                title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              
              <div className="text-sm text-slate-500 font-medium hidden sm:block ml-2">
                Bioinformatic Utility for Diagnostic Discovery in Yeast
              </div>
          </div>
        </div>
      </header>

      {/* Advanced Settings Modal - Dark Mode */}
      {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
              <div className="bg-white dark:bg-slate-950 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-200 dark:border-slate-800 transition-colors duration-300">
                  <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900">
                      <div className="flex items-center gap-3">
                          <div className="bg-emerald-100 dark:bg-emerald-900/30 p-2 rounded-lg">
                              <Settings className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                          </div>
                          <div>
                              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Advanced Settings</h2>
                              <p className="text-xs text-slate-500 dark:text-slate-400">Fine-tune the pipeline parameters for expert analysis.</p>
                          </div>
                      </div>
                      <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors">
                          <X className="w-6 h-6" />
                      </button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-200">
                      {/* CRISPR Settings */}
                      <section>
                          <h3 className="text-sm font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-wider mb-4 border-b border-slate-200 dark:border-slate-800 pb-2">CRISPR & Oligo Design</h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">PAM Constraint</label>
                                  <select 
                                    value={settings.crispr.pamConstraint}
                                    onChange={(e) => setSettings({...settings, crispr: {...settings.crispr, pamConstraint: e.target.value as any}})}
                                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                  >
                                      <option value="NGG">SpCas9 (NGG)</option>
                                      <option value="TTTV">Cas12a/Cpf1 (TTTV) *not yet implimented*</option>
                                  </select>
                              </div>
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Disruption Priority</label>
                                  <select 
                                    value={settings.crispr.disruptionPriority}
                                    onChange={(e) => setSettings({...settings, crispr: {...settings.crispr, disruptionPriority: e.target.value as any}})}
                                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                  >
                                      <option value="PAM">PAM Disruption Only</option>
                                      <option value="SEED">Seed Region Only</option>
                                      <option value="BOTH">Try PAM, then Seed</option>
                                  </select>
                              </div>
                              {/* Removed Repair Template Asymmetry Option */}
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Guide Length (nt)</label>
                                  <input 
                                    type="number" min="18" max="24"
                                    value={settings.crispr.guideLength}
                                    onChange={(e) => setSettings({...settings, crispr: {...settings.crispr, guideLength: parseInt(e.target.value)}})}
                                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                  />
                              </div>
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Seed Length (bp)</label>
                                  <input 
                                    type="number" min="5" max="15"
                                    value={settings.crispr.seedLength}
                                    onChange={(e) => setSettings({...settings, crispr: {...settings.crispr, seedLength: parseInt(e.target.value)}})}
                                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                  />
                              </div>
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Min Seed Mutations</label>
                                  <input 
                                    type="number" min="1" max="5"
                                    value={settings.crispr.minSeedMutations}
                                    onChange={(e) => setSettings({...settings, crispr: {...settings.crispr, minSeedMutations: parseInt(e.target.value)}})}
                                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                  />
                              </div>
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Cloning Strategy</label>
                                  <select 
                                    value={settings.crispr.cloningType || 'pML104'}
                                    onChange={(e) => setSettings({...settings, crispr: {...settings.crispr, cloningType: e.target.value as any}})}
                                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                  >
                                      <option value="pML104">pML104 (Standard Vector)</option>
                                      <option value="NoClo">NoClo (In Vivo Homology)</option>
                                  </select>
                              </div>
                              {settings.crispr.cloningType === 'NoClo' && (
                                  <div className="md:col-span-3 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
                                      <div className="flex justify-between items-center">
                                          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">NoClo Homology Length (bp per end)</label>
                                          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-700">
                                              {settings.crispr.nocloHomologyLength ?? 100} bp
                                          </span>
                                      </div>
                                      <input 
                                        type="range" min="20" max="100" step="1"
                                        value={settings.crispr.nocloHomologyLength ?? 100}
                                        onChange={(e) => setSettings({...settings, crispr: {...settings.crispr, nocloHomologyLength: parseInt(e.target.value)}})}
                                        className="w-full accent-emerald-600 dark:accent-emerald-400"
                                      />
                                      <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                          <span>20 bp</span>
                                          <span>Default: 100 bp (up to 100 bp on both 5' and 3' ends)</span>
                                          <span>100 bp</span>
                                      </div>

                                      {/* Integrated Repair Template Option */}
                                      <div className="pt-2 border-t border-slate-200 dark:border-slate-700/60">
                                          <label className="flex items-start gap-2.5 cursor-pointer">
                                              <input 
                                                  type="checkbox"
                                                  checked={Boolean(settings.crispr.nocloIntegratedRepair)}
                                                  onChange={(e) => setSettings({
                                                      ...settings, 
                                                      crispr: { ...settings.crispr, nocloIntegratedRepair: e.target.checked }
                                                  })}
                                                  className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                              />
                                              <div>
                                                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                                                      Integrate Repair Template onto Same Sequence (All-in-One NoClo)
                                                  </span>
                                                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5 leading-snug">
                                                      Synthesizes a single ~475nt fragment: 100bp 5' upstream homology + 100nt repair template + 155bp tRNA/ribozyme linker + 20bp sgRNA + 100bp 3' terminator.
                                                  </span>
                                              </div>
                                          </label>
                                      </div>
                                  </div>
                              )}
                          </div>
                      </section>

                      {/* Alignment Settings */}
                      <section>
                          <h3 className="text-sm font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-wider mb-4 border-b border-slate-200 dark:border-slate-800 pb-2">Sequence Alignment</h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Algorithm</label>
                                  <select 
                                    value={settings.alignment.algorithm}
                                    onChange={(e) => setSettings({...settings, alignment: {...settings.alignment, algorithm: e.target.value as any}})}
                                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                  >
                                      <option value="GLOBAL">Global (Needleman-Wunsch)</option>
                                      <option value="LOCAL">Local (Smith-Waterman)</option>
                                  </select>
                              </div>
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Scoring Matrix</label>
                                  <select 
                                    value={settings.alignment.matrix}
                                    onChange={(e) => setSettings({...settings, alignment: {...settings.alignment, matrix: e.target.value as any}})}
                                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                  >
                                      <option value="BLOSUM62">BLOSUM62 (Standard)</option>
                                      <option value="BLOSUM45">BLOSUM45 (Divergent)</option>
                                      <option value="PAM250">PAM250 (Very Divergent)</option>
                                  </select>
                              </div>
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Gap Penalties (Open/Extend)</label>
                                  <div className="flex gap-2">
                                      <input 
                                        type="number" 
                                        value={settings.alignment.gapOpen}
                                        onChange={(e) => setSettings({...settings, alignment: {...settings.alignment, gapOpen: parseInt(e.target.value)}})}
                                        className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500" title="Gap Open"
                                      />
                                      <input 
                                        type="number" 
                                        value={settings.alignment.gapExtend}
                                        onChange={(e) => setSettings({...settings, alignment: {...settings.alignment, gapExtend: parseInt(e.target.value)}})}
                                        className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500" title="Gap Extend"
                                      />
                                  </div>
                              </div>
                          </div>
                      </section>

                      {/* Filtering & Orthology */}
                      <section>
                          <h3 className="text-sm font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-wider mb-4 border-b border-slate-200 dark:border-slate-800 pb-2">Filtering & Orthology</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                              <div>
                                  <div className="flex items-center justify-between mb-2">
                                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">ClinVar Significance</label>
                                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">Strict Filtering</span>
                                  </div>

                                  {/* Quick Presets */}
                                  <div className="flex flex-wrap gap-1 mb-2">
                                      <button 
                                          type="button" 
                                          onClick={() => setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: ['PATHOGENIC', 'LIKELY_PATHOGENIC']}})}
                                          className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                                              settings.filtering.clinVarSignificance.includes('PATHOGENIC') && settings.filtering.clinVarSignificance.includes('LIKELY_PATHOGENIC') && settings.filtering.clinVarSignificance.length === 2
                                                  ? 'bg-red-600 text-white font-bold'
                                                  : 'bg-red-100 hover:bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                                          }`}
                                      >
                                          Pathogenic (Both)
                                      </button>
                                      <button 
                                          type="button" 
                                          onClick={() => setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: ['PATHOGENIC']}})}
                                          className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                                              settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('PATHOGENIC')
                                                  ? 'bg-red-700 text-white font-bold'
                                                  : 'bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400 border border-red-200 dark:border-red-800'
                                          }`}
                                      >
                                          Pathogenic Only
                                      </button>
                                      <button 
                                          type="button" 
                                          onClick={() => setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: ['LIKELY_PATHOGENIC']}})}
                                          className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                                              settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('LIKELY_PATHOGENIC')
                                                  ? 'bg-orange-600 text-white font-bold'
                                                  : 'bg-orange-100 hover:bg-orange-200 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300'
                                          }`}
                                      >
                                          Likely Path. Only
                                      </button>
                                      <button 
                                          type="button" 
                                          onClick={() => setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: ['BENIGN', 'LIKELY_BENIGN']}})}
                                          className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                                              settings.filtering.clinVarSignificance.includes('BENIGN') && settings.filtering.clinVarSignificance.includes('LIKELY_BENIGN') && settings.filtering.clinVarSignificance.length === 2
                                                  ? 'bg-emerald-600 text-white font-bold'
                                                  : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                                          }`}
                                      >
                                          Benign (Both)
                                      </button>
                                      <button 
                                          type="button" 
                                          onClick={() => setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: ['BENIGN']}})}
                                          className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                                              settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('BENIGN')
                                                  ? 'bg-emerald-700 text-white font-bold'
                                                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                                          }`}
                                      >
                                          Benign Only
                                      </button>
                                      <button 
                                          type="button" 
                                          onClick={() => setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: ['LIKELY_BENIGN']}})}
                                          className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                                              settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('LIKELY_BENIGN')
                                                  ? 'bg-teal-600 text-white font-bold'
                                                  : 'bg-teal-100 hover:bg-teal-200 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300'
                                          }`}
                                      >
                                          Likely Benign Only
                                      </button>
                                      <button 
                                          type="button" 
                                          onClick={() => setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: ['VUS']}})}
                                          className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                                              settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('VUS')
                                                  ? 'bg-amber-600 text-white font-bold'
                                                  : 'bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                          }`}
                                      >
                                          VUS Only
                                      </button>
                                      <button 
                                          type="button" 
                                          onClick={() => setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: ['CONFLICTING']}})}
                                          className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                                              settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('CONFLICTING')
                                                  ? 'bg-purple-600 text-white font-bold'
                                                  : 'bg-purple-100 hover:bg-purple-200 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
                                          }`}
                                      >
                                          Conflicting Only
                                      </button>
                                      <button 
                                          type="button" 
                                          onClick={() => setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: ['PATHOGENIC', 'LIKELY_PATHOGENIC', 'BENIGN', 'LIKELY_BENIGN', 'VUS', 'CONFLICTING']}})}
                                          className="px-2 py-0.5 text-[10px] rounded font-medium bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-700 dark:text-slate-300 transition-colors"
                                      >
                                          All
                                      </button>
                                  </div>

                                  <div className="flex flex-col gap-2 p-2 border border-slate-300 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900">
                                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                          <input 
                                            type="checkbox" 
                                            checked={settings.filtering.clinVarSignificance.includes('PATHOGENIC')}
                                            onChange={(e) => {
                                                const newSigs = e.target.checked 
                                                    ? [...settings.filtering.clinVarSignificance, 'PATHOGENIC' as const]
                                                    : settings.filtering.clinVarSignificance.filter(s => s !== 'PATHOGENIC');
                                                setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: newSigs}});
                                            }}
                                            className="rounded text-red-500 focus:ring-red-500 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                                          />
                                          <span className="font-semibold text-red-600 dark:text-red-400">Pathogenic</span>
                                      </label>
                                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                          <input 
                                            type="checkbox" 
                                            checked={settings.filtering.clinVarSignificance.includes('LIKELY_PATHOGENIC')}
                                            onChange={(e) => {
                                                const newSigs = e.target.checked 
                                                    ? [...settings.filtering.clinVarSignificance, 'LIKELY_PATHOGENIC' as const]
                                                    : settings.filtering.clinVarSignificance.filter(s => s !== 'LIKELY_PATHOGENIC');
                                                setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: newSigs}});
                                            }}
                                            className="rounded text-orange-500 focus:ring-orange-500 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                                          />
                                          <span className="font-semibold text-orange-600 dark:text-orange-400">Likely Pathogenic</span>
                                      </label>
                                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                          <input 
                                            type="checkbox" 
                                            checked={settings.filtering.clinVarSignificance.includes('BENIGN')}
                                            onChange={(e) => {
                                                const newSigs = e.target.checked 
                                                    ? [...settings.filtering.clinVarSignificance, 'BENIGN' as const]
                                                    : settings.filtering.clinVarSignificance.filter(s => s !== 'BENIGN');
                                                setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: newSigs}});
                                            }}
                                            className="rounded text-green-500 focus:ring-green-500 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                                          />
                                          <span className="font-semibold text-green-600 dark:text-green-400">Benign</span>
                                      </label>
                                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                          <input 
                                            type="checkbox" 
                                            checked={settings.filtering.clinVarSignificance.includes('LIKELY_BENIGN')}
                                            onChange={(e) => {
                                                const newSigs = e.target.checked 
                                                    ? [...settings.filtering.clinVarSignificance, 'LIKELY_BENIGN' as const]
                                                    : settings.filtering.clinVarSignificance.filter(s => s !== 'LIKELY_BENIGN');
                                                setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: newSigs}});
                                            }}
                                            className="rounded text-teal-500 focus:ring-teal-500 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                                          />
                                          <span className="font-semibold text-teal-600 dark:text-teal-400">Likely Benign</span>
                                      </label>
                                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                          <input 
                                            type="checkbox" 
                                            checked={settings.filtering.clinVarSignificance.includes('VUS')}
                                            onChange={(e) => {
                                                const newSigs = e.target.checked 
                                                    ? [...settings.filtering.clinVarSignificance, 'VUS' as const]
                                                    : settings.filtering.clinVarSignificance.filter(s => s !== 'VUS');
                                                setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: newSigs}});
                                            }}
                                            className="rounded text-amber-500 focus:ring-amber-500 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                                          />
                                          <span className="font-semibold text-amber-600 dark:text-amber-400">Uncertain Significance (VUS)</span>
                                      </label>
                                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                          <input 
                                            type="checkbox" 
                                            checked={settings.filtering.clinVarSignificance.includes('CONFLICTING')}
                                            onChange={(e) => {
                                                const newSigs = e.target.checked 
                                                    ? [...settings.filtering.clinVarSignificance, 'CONFLICTING' as const]
                                                    : settings.filtering.clinVarSignificance.filter(s => s !== 'CONFLICTING');
                                                setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: newSigs}});
                                            }}
                                            className="rounded text-purple-500 focus:ring-purple-500 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                                          />
                                          <span className="font-semibold text-purple-600 dark:text-purple-400">Conflicting interpretations</span>
                                      </label>
                                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                          <input 
                                            type="checkbox" 
                                            checked={settings.filtering.clinVarSignificance.includes('DISCORDANT')}
                                            onChange={(e) => {
                                                const newSigs = e.target.checked 
                                                    ? [...settings.filtering.clinVarSignificance, 'DISCORDANT' as const]
                                                    : settings.filtering.clinVarSignificance.filter(s => s !== 'DISCORDANT');
                                                setSettings({...settings, filtering: {...settings.filtering, clinVarSignificance: newSigs}});
                                            }}
                                            className="rounded text-amber-500 focus:ring-amber-500 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                                          />
                                          <span className="font-semibold text-amber-600 dark:text-amber-400">⚡ Discordant (Benign w/ AM ≥ 0.56, Pathogenic w/ AM ≤ 0.34)</span>
                                      </label>
                                  </div>
                                  <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                      <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                                          * Default settings include both VUS and Conflicting variants. Discordant queries cross-check ClinVar designations against AlphaMissense scores.
                                      </p>
                                      <button
                                          type="button"
                                          onClick={() => {
                                              setShowSettings(false);
                                              setInputMode('discordant');
                                          }}
                                          className="px-2 py-1 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 text-xs font-semibold rounded shrink-0 flex items-center gap-1 transition-colors self-start"
                                      >
                                          <Scale className="w-3 h-3" />
                                          Open Discordant Variants Explorer
                                      </button>
                                  </div>
                              </div>

                              {/* ClinVar Review Status / Gold Stars */}
                              <div className="mt-4 p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-lg">
                                  <div className="flex items-center justify-between mb-2">
                                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                          <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
                                          <span>ClinVar Review Status (Gold Stars)</span>
                                      </label>
                                      <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                          {settings.filtering.minClinVarStars === 0 && "Any (0+ Stars)"}
                                          {settings.filtering.minClinVarStars === 1 && "≥ 1 Star (Criteria Provided)"}
                                          {settings.filtering.minClinVarStars === 2 && "≥ 2 Stars (Multiple Submitters)"}
                                          {settings.filtering.minClinVarStars === 3 && "≥ 3 Stars (Expert Panel)"}
                                          {settings.filtering.minClinVarStars === 4 && "4 Stars (Practice Guideline)"}
                                      </span>
                                  </div>

                                  <div className="grid grid-cols-5 gap-1 mb-2">
                                      {[
                                          { stars: 0, label: "0+ ★", sub: "All" },
                                          { stars: 1, label: "1+ ★", sub: "Single" },
                                          { stars: 2, label: "2+ ★", sub: "Multiple" },
                                          { stars: 3, label: "3+ ★", sub: "Panel" },
                                          { stars: 4, label: "4 ★", sub: "Guide" },
                                      ].map((item) => (
                                          <button
                                              key={item.stars}
                                              type="button"
                                              onClick={() => setSettings({
                                                  ...settings,
                                                  filtering: { ...settings.filtering, minClinVarStars: item.stars }
                                              })}
                                              className={`py-1.5 px-1 rounded text-center transition-all border ${
                                                  settings.filtering.minClinVarStars === item.stars
                                                      ? "bg-amber-500 text-white border-amber-600 font-bold shadow-sm"
                                                      : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-amber-400"
                                              }`}
                                          >
                                              <div className="text-xs font-bold">{item.label}</div>
                                              <div className={`text-[9px] truncate ${settings.filtering.minClinVarStars === item.stars ? "text-amber-100" : "text-slate-400"}`}>
                                                  {item.sub}
                                              </div>
                                          </button>
                                      ))}
                                  </div>

                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 space-y-1 bg-white/70 dark:bg-slate-900/80 p-2.5 rounded border border-slate-200 dark:border-slate-800">
                                      <div className="flex items-center gap-1">
                                          <span className="font-semibold text-slate-700 dark:text-slate-300">4 Stars:</span>
                                          <span>Practice guideline (e.g., ACMG)</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                          <span className="font-semibold text-slate-700 dark:text-slate-300">3 Stars:</span>
                                          <span>Reviewed by expert panel (e.g., ClinGen)</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                          <span className="font-semibold text-slate-700 dark:text-slate-300">2 Stars:</span>
                                          <span>Criteria provided, multiple submitters, no conflicts</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                          <span className="font-semibold text-slate-700 dark:text-slate-300">1 Star:</span>
                                          <span>Criteria provided, single submitter</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                          <span className="font-semibold text-slate-700 dark:text-slate-300">0 Stars:</span>
                                          <span>No assertion criteria provided / unreviewed</span>
                                      </div>
                                  </div>

                                  {/* Note regarding VUS and Gold Stars */}
                                  <div className="mt-2.5 text-[11px] text-amber-800 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-900/30 p-2.5 rounded-lg border border-amber-300/70 dark:border-amber-700/60 flex items-start gap-2">
                                      <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                      <div className="leading-relaxed">
                                          <span className="font-bold text-amber-900 dark:text-amber-200">Note: </span>
                                          ClinVar Gold Star review tiers (0–4★) evaluate evidence curation for <span className="font-medium">Pathogenic</span>, <span className="font-medium">Likely Pathogenic</span>, <span className="font-medium">Benign</span>, and <span className="font-medium">Likely Benign</span> variants. <span className="font-semibold underline decoration-amber-500/50">Gold stars are not relevant for Variants of Uncertain Significance (VUS)</span>, as VUS assertions inherently lack conclusive diagnostic assertions and do not receive multi-star expert panel or guideline classifications.
                                      </div>
                                  </div>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <div>
                                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Min DIOPT Score</label>
                                      <input 
                                        type="number" min="0" max="15"
                                        value={settings.filtering.minDioptScore}
                                        onChange={(e) => setSettings({...settings, filtering: {...settings.filtering, minDioptScore: parseInt(e.target.value)}})}
                                        className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                      />
                                  </div>
                                  <div>
                                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Min % Identity</label>
                                      <input 
                                        type="number" min="0" max="100"
                                        value={settings.filtering.minPercentIdentity}
                                        onChange={(e) => setSettings({...settings, filtering: {...settings.filtering, minPercentIdentity: parseFloat(e.target.value)}})}
                                        className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                      />
                                  </div>
                                  <div>
                                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Min % Similarity</label>
                                      <input 
                                        type="number" min="0" max="100"
                                        value={settings.filtering.minPercentSimilarity}
                                        onChange={(e) => setSettings({...settings, filtering: {...settings.filtering, minPercentSimilarity: parseFloat(e.target.value)}})}
                                        className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                      />
                                  </div>
                                  <div>
                                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Min Local Homology (%)</label>
                                      <input 
                                        type="number" min="0" max="100"
                                        value={settings.filtering.minLocalHomology}
                                        onChange={(e) => setSettings({...settings, filtering: {...settings.filtering, minLocalHomology: parseInt(e.target.value)}})}
                                        className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                      />
                                  </div>
                              </div>
                              <div className="mt-4">
                                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                      <input 
                                        type="checkbox" 
                                        checked={settings.filtering.multiVariantSelection}
                                        onChange={(e) => setSettings({...settings, filtering: {...settings.filtering, multiVariantSelection: e.target.checked}})}
                                        className="rounded text-emerald-500 focus:ring-emerald-500 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                                      />
                                      Enable Multi-Variant Selection
                                  </label>
                              </div>
                          </div>
                      </section>

                      {/* AI & Experimental Plan */}
                      <section>
                          <h3 className="text-sm font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-wider mb-4 border-b border-slate-200 dark:border-slate-800 pb-2">AI Context & Safety</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Assay Preference</label>
                                  <div className="relative">
                                      <input 
                                        type="text"
                                        list="assay-options"
                                        value={settings.ai.assayPreference}
                                        onChange={(e) => setSettings({...settings, ai: {...settings.ai, assayPreference: e.target.value}})}
                                        className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                        placeholder="e.g. Growth, Western, or type custom..."
                                      />
                                      <datalist id="assay-options">
                                          <option value="ANY">AI Decides (Best Fit)</option>
                                          <option value="GROWTH">Growth / Spot Assays</option>
                                          <option value="WESTERN">Western Blotting</option>
                                          <option value="MICROSCOPY">Microscopy / Localization</option>
                                      </datalist>
                                  </div>
                              </div>
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Safety Level / Enviornment </label>
                                  <select 
                                    value={settings.ai.safetyLevel}
                                    onChange={(e) => setSettings({...settings, ai: {...settings.ai, safetyLevel: e.target.value as any}})}
                                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                  >
                                      <option value="STANDARD">Standard Research Lab</option>
                                      <option value="CLASSROOM_SAFE">Classroom/Safe (Simple assays / No Toxic Reagents)</option>
                                  </select>
                              </div>
                              <div className="md:col-span-2">
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Available Equipment (Optional)</label>
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 bg-slate-100 dark:bg-slate-900/50 p-3 rounded border border-slate-200 dark:border-slate-700">
                                      {[
                                          'OD600 Reader / Spectrophotometer',
                                          'Microplate Reader',
                                          'Microscope (no fluorescence)',
                                          'Fluorescence Microscope',
                                          'Tetrad Microdissection Microscope',
                                          'Flow Cytometer',
                                          'Mass Spectrometer',
                                          'qPCR Machine',
                                          'Western Blotting Apparatus',
                                          'HPLC',
                                          'Enzyme Assays'
                                      ].map(item => (
                                          <label key={item} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer hover:text-emerald-600 dark:hover:text-white transition-colors">
                                              <input
                                                  type="checkbox"
                                                  checked={settings.ai.labResources.includes(item)}
                                                  onChange={(e) => {
                                                      const newResources = e.target.checked
                                                          ? [...settings.ai.labResources, item]
                                                          : settings.ai.labResources.filter(r => r !== item);
                                                      setSettings({...settings, ai: {...settings.ai, labResources: newResources}});
                                                  }}
                                                  className="rounded text-emerald-500 focus:ring-emerald-500 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 cursor-pointer"
                                              />
                                              {item}
                                          </label>
                                      ))}
                                  </div>
                              </div>
                          </div>
                      </section>

                      {/* 3D Structure Settings - Minimal Now */}
                      <section>
                          <h3 className="text-sm font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-wider mb-4 border-b border-slate-200 dark:border-slate-800 pb-2">Structure Visualization</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div>
                                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Superposition Method</label>
                                  <select 
                                    value={settings.structure.superpositionMethod}
                                    onChange={(e) => setSettings({...settings, structure: {...settings.structure, superpositionMethod: e.target.value as any}})}
                                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                                  >
                                      <option value="pruned_core">Pruned Core (Outlier Rejection - Default)</option>
                                      <option value="kabsch_global">Global Kabsch (Full-Length Least-Squares)</option>
                                      <option value="conserved_anchors">Conserved Homology Anchors</option>
                                      <option value="tm_weighted">TM-Weighted (Distance-Decayed Soft Weighting)</option>
                                  </select>
                                  <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                      Algorithm used to calculate 3D rotation and translation when superimposing human and yeast structures in overlay mode.
                                  </p>
                              </div>
                          </div>
                      </section>
                  </div>

                  <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-end gap-3">
                      <button 
                        onClick={() => setSettings(DEFAULT_SETTINGS)}
                        className="px-4 py-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
                      >
                          Reset to Defaults
                      </button>
                      <button 
                        onClick={() => setShowSettings(false)}
                        className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-bold shadow-sm hover:bg-emerald-700 transition-all border border-emerald-500"
                      >
                          Save & Close
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Easter Egg - 'Buddy' Icon */}
      {showEasterEgg && (
          <div className="fixed bottom-4 left-4 z-[110] animate-bounce transition-all duration-500">
              <div className="relative w-24 h-24 bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center shadow-2xl border-2 border-emerald-400 overflow-hidden group cursor-pointer" onClick={() => setShowEasterEgg(false)} title="You found Buddy!">
                  {/* Uses a composite emoji icon: Peanut (budding yeast) Elf (buddy) and DNA". 
                      Could replace this with <img src="buddy_egg.png" /> later. */}
                  <div className="text-6xl absolute select-none animate-pulse">🥜</div>
                  <div className="text-4xl absolute -top-1 left-2 select-none z-10">🧝</div>
                  <div className="text-2xl absolute bottom-2 right-4 select-none z-20 rotate-45">🧬</div>
              </div>
          </div>
      )}

      <main className="w-full max-w-[98%] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 flex-grow pb-20">
        
        {/* Intro / About Box */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden animate-fade-in print:hidden shadow-sm">
             <button 
                onClick={() => setIsAboutVisible(!isAboutVisible)}
                className="w-full p-4 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
             >
                 <div className="flex gap-4 items-center">
                    <Info className="w-6 h-6 text-emerald-500 shrink-0" />
                    <h3 className="font-bold text-slate-800 dark:text-slate-200 text-base">Instructions</h3>
                 </div>
                 <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${isAboutVisible ? 'rotate-180' : ''}`} />
             </button>

             {isAboutVisible && (
                 <div className="p-6 text-sm text-slate-600 dark:text-slate-300 prose prose-sm max-w-none prose-slate dark:prose-invert prose-h4:font-bold prose-h4:text-emerald-600 dark:prose-h4:text-emerald-400 prose-ul:pl-5">
                    <h4>BUDDY is a bioinformatics platform that streamlines the use of yeast to test for functional impacts of human variants of unknown significance (VUS).</h4>
                    <p>
                      
                    </p>
                    
                    <h4>How to Run Analysis</h4>
                    <ul>
                        <li><strong>Manual Input:</strong> Enter a Human Gene Name and optionally set the AlphaMissense score range, Run.</li>
                        <li><strong>Rare Diseases:</strong> Explore VUS in conserved rare disease genes (retrieved from raresource.nih.gov/genes and filtered for DIOPT 5 or higher on 6/2026). </li>
                        <li><strong>Search By Topic :</strong> Search keywords and then refine human gene results using the 'Filter Orthologs' button.</li>
                    </ul>
                    <h4>Next Steps: Experimental Validation</h4>
                    <ul>
                        <li><strong>CRISPR Oligo Design:</strong> Select a variant and click "Generate Oligos" to view your design options. The tool generates both the sgRNA (to guide Cas9 to the cut site) and the repair template (to introduce your mutation via homologous recombination). Oligos are generated for our NoClo approach or cloning into pML104 or similar plasmids (<a href="https://pubmed.ncbi.nlm.nih.gov/26305040/" target="_blank" rel="noopener noreferrer">Laughery et al., 2015</a>).</li>
                        <li><strong>PCR Verification Primers:</strong> The pipeline automatically designs flanking primers to amplify the edited genomic region, allowing you to sequence the PCR product and confirm the CRISPR mutation.</li>
                        <li><strong>Phenotypes:</strong> Phenotypic data is retrieved from the Saccharomyces Genome Database (SGD). These phenotypes are typically observed in null mutants (gene knockouts) or other characterized mutant alleles, providing a baseline for what to expect if your introduced VUS causes a loss of function.</li>
                        <li><strong>AI-Assisted Experimental Plan:</strong> The AI evaluates the selected variant along with other available information including the structure overlay and phenotypes to design a suggested lab protocol to evaluate the impact of the VUS.</li>
                    </ul>
                    <h4>Interpreting Scores & Homology</h4>
                    <p><strong>DIOPT Score Guide:</strong></p>
                    <ul>
                    <li><strong>DIOPT (DRSC Integrative Ortholog Prediction Tool):</strong> This score indicates the confidence of the ortholog mapping between human and yeast. It ranges from 0 to 16, representing the number of orthology prediction algorithms that agree on the mapping. A higher score means stronger evidence for orthology. A local database of human/yeast pairs with DIOPT greater than 2 is used to identify orthologs. </li>
                    </ul>
                    <p><strong>AlphaMissense (AM) Score Guide:</strong></p>
                    <ul>
                    <li><strong>  <button onClick={() => { setMinScore(0.35); setMaxScore(0.55); }} className="px-2 py-1 text-[10px] bg-yellow-100 dark:bg-yellow-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-yellow-800 dark:text-yellow-300 rounded font-medium border border-yellow-300 dark:border-yellow-700 transition-colors shadow-sm">Ambiguous (0.35-0.55)</button>:</strong> Use this range to study variants where the AI prediction is uncertain.</li>
                    <li><strong>  <button onClick={() => { setMinScore(0.55); setMaxScore(1.0); }} className="px-2 py-1 text-[10px] bg-red-100 dark:bg-red-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-red-800 dark:text-red-300 rounded font-medium border border-red-300 dark:border-red-700 transition-colors shadow-sm">Likely Pathogenic (0.55-1.0)</button>:</strong> Use this range to find mutations with a high probability of being detrimental.</li>
                    </ul>
                    <p><strong>Local Homology Score Guide:</strong> </p> 
                    <ul>
                        <li> Calculated as percentage of identical or similar aligned amino acids within a 13-residue window centered on the variant.</li>
                        <li> Set a minimum for this value and other parameters in the Advanced Settings.</li> 
                    </ul>
                     <p><strong>3D Structure Viewer:</strong> </p> 
                     <ul>
                        <li> After selecting a variant, select 'overlay' within the Structure Viewer to analyze yeast and human structures, and then when the experimental plan is generated, computer vision will analyze the spatial overlap in a 2D rendering (of the current structure view) combing geometric pattern recognition with biochemical knowledge to evaluate variant residue position and structural conservation.</li>
                    </ul>
                    <h4>Other info:</h4>
                    <ul>
                    <li> 💡 Tip: Click on any Variant Name (ClinVar), Rare Disease (NIH), or AM Score (AlphaMissense) to open an external database entry.</li>
                    <li> 🪳 Known bugs: Firefox may timeout with AI Experiment Plan generation, until resolved, if it errors, please try Chrome/Edge or Safari.</li>
                    <li> ✉️ For support, feature requests, bug reports, data sharing, or any other inquiries please <a href="mailto:buddy@wasko.org">email</a>.</li>
                    </ul>
                 </div>
             )}
        </div>

        {/* Controls */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 print:hidden transition-colors duration-300">
          {/* ... (Existing controls code) ... */}
          <div className="flex gap-6 mb-6 border-b border-slate-200 dark:border-slate-700 pb-2 overflow-x-auto">
             <button 
                onClick={() => { setInputMode('manual'); setShowRareList(false); }}
                className={`pb-2 text-sm font-medium transition-colors whitespace-nowrap ${inputMode === 'manual' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
             >
                Manual Input
             </button>
             <button 
                onClick={() => {
                    setInputMode('rare');
                    setTopicInput('');
                    setTopicResults([]);
                    setHasSearched(false);
                }}
                className={`pb-2 text-sm font-medium transition-colors whitespace-nowrap ${inputMode === 'rare' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
             >
                Rare Diseases
             </button>
             <button 
                onClick={() => {
                    setInputMode('topic');
                    setTopicInput('');
                    setTopicResults([]);
                    setHasSearched(false);
                    setShowRareList(false);
                }}
                className={`pb-2 text-sm font-medium transition-colors whitespace-nowrap ${inputMode === 'topic' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
             >
                Search by Topic
             </button>
             <button 
                onClick={() => {
                    setInputMode('discordant');
                    setShowRareList(false);
                }}
                className={`pb-2 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${inputMode === 'discordant' ? 'text-amber-600 dark:text-amber-400 border-b-2 border-amber-500 font-bold' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
             >
                <Scale className="w-4 h-4" />
                Discordant Variants
             </button>
          </div>

          {inputMode === 'manual' && (
            <div className="space-y-6">
                {/* Input Species Switch */}
                <div className="flex justify-center mb-2">
                    <div className="bg-slate-100 dark:bg-slate-900 p-1 rounded-lg flex text-xs font-semibold">
                        <button 
                            onClick={() => { 
                                setManualSearchSpecies('human'); 
                                setGeneInput(''); 
                                setManualNumberingSpecies('human');
                            }}
                            className={`px-4 py-1.5 rounded-md transition-all ${manualSearchSpecies === 'human' ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                        >
                            Human Gene Input
                        </button>
                        <button 
                            onClick={() => { 
                                setManualSearchSpecies('yeast'); 
                                setGeneInput(''); 
                                setManualNumberingSpecies('yeast');
                            }}
                            className={`px-4 py-1.5 rounded-md transition-all ${manualSearchSpecies === 'yeast' ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                        >
                            Yeast Gene Input
                        </button>
                        <button 
                            onClick={() => { 
                                setManualSearchSpecies('dual'); 
                                setGeneInput(''); 
                                setDualYeastInput('');
                                setManualNumberingSpecies('human');
                            }}
                            className={`px-4 py-1.5 rounded-md transition-all flex items-center gap-1 ${manualSearchSpecies === 'dual' ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                        >
                            <Link2 className="w-3 h-3" />
                            Dual Input (Skip Orthology)
                        </button>
                    </div>
                </div>

                <div className={`grid gap-6 items-end ${manualSearchSpecies === 'dual' ? 'grid-cols-1 md:grid-cols-5' : 'grid-cols-1 md:grid-cols-4'}`}>
                    
                    {manualSearchSpecies === 'dual' ? (
                        <>
                            <div className="md:col-span-1">
                                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                    Human Gene Symbol
                                </label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
                                    <input
                                        type="text"
                                        value={geneInput}
                                        onChange={(e) => setGeneInput(e.target.value.toUpperCase())}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                const trimmed = geneInput.trim();
                                                if (trimmed !== geneInput) setGeneInput(trimmed);
                                                runPipeline();
                                            }
                                        }}
                                        className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                                        placeholder="e.g. ATP6V1B1"
                                    />
                                </div>
                            </div>
                            <div className="md:col-span-1">
                                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                    Yeast Gene Symbol
                                </label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
                                    <input
                                        type="text"
                                        value={dualYeastInput}
                                        onChange={(e) => setDualYeastInput(e.target.value.toUpperCase())}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                const trimmedDual = dualYeastInput.trim();
                                                if (trimmedDual !== dualYeastInput) setDualYeastInput(trimmedDual);
                                                runPipeline();
                                            }
                                        }}
                                        className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                                        placeholder="e.g. VMA2"
                                    />
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="md:col-span-1">
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                {manualSearchSpecies === 'human' ? 'Human Gene Symbol' : 'Yeast Gene (Name/ORF)'}
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
                                <input
                                    type="text"
                                    value={geneInput}
                                    onChange={(e) => setGeneInput(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const trimmed = geneInput.trim();
                                            if (trimmed !== geneInput) setGeneInput(trimmed);
                                            runPipeline();
                                        }
                                    }}
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                                    placeholder={manualSearchSpecies === 'human' ? "e.g. ATP6V1B1" : "e.g. VMA2 or YBR127C"}
                                />
                            </div>
                        </div>
                    )}
                    
                    <div className="md:col-span-1">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                        Min AlphaMissense
                    </label>
                    <input
                        type="number" step="0.01" min="0" max="1" value={minScore}
                        onChange={(e) => setMinScore(parseFloat(e.target.value))}
                        className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    />
                    </div>

                    <div className="md:col-span-1">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                        Max AlphaMissense
                    </label>
                    <input
                        type="number" step="0.01" min="0" max="1" value={maxScore}
                        onChange={(e) => setMaxScore(parseFloat(e.target.value))}
                        className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    />
                    </div>

                    <div className="md:col-span-1">
                        <button
                        onClick={() => {
                            const trimmedGene = geneInput.trim();
                            const trimmedDual = dualYeastInput.trim();
                            if (trimmedGene !== geneInput) setGeneInput(trimmedGene);
                            if (trimmedDual !== dualYeastInput) setDualYeastInput(trimmedDual);
                            runPipeline();
                        }}
                        disabled={state.step === 'searching' || state.step === 'aligning'}
                        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-medium transition-all shadow-sm hover:shadow-md h-[42px]"
                        >
                        {state.step === 'searching' || state.step === 'aligning' ? <Dna className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                        Run Analysis
                        </button>
                    </div>
                </div>

                {/* ClinVar Variant Significance Focus */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-200 dark:border-slate-700/80">
                    <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                            ClinVar Variant Focus:
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">
                            (Select which significance categories to pull)
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        <button
                            type="button"
                            onClick={() => setSettings({
                                ...settings, 
                                filtering: { ...settings.filtering, clinVarSignificance: ['PATHOGENIC'] }
                            })}
                            className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all shadow-sm ${
                                settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('PATHOGENIC')
                                    ? 'bg-red-700 text-white shadow-red-500/20 font-bold'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:border-red-400'
                            }`}
                        >
                            ● Pathogenic
                        </button>
                        <button
                            type="button"
                            onClick={() => setSettings({
                                ...settings, 
                                filtering: { ...settings.filtering, clinVarSignificance: ['LIKELY_PATHOGENIC'] }
                            })}
                            className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all shadow-sm ${
                                settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('LIKELY_PATHOGENIC')
                                    ? 'bg-orange-600 text-white shadow-orange-500/20 font-bold'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:border-orange-400'
                            }`}
                        >
                            ● Likely Pathogenic
                        </button>
                        <button
                            type="button"
                            onClick={() => setSettings({
                                ...settings, 
                                filtering: { ...settings.filtering, clinVarSignificance: ['BENIGN'] }
                            })}
                            className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all shadow-sm ${
                                settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('BENIGN')
                                    ? 'bg-emerald-700 text-white shadow-emerald-500/20 font-bold'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:border-emerald-400'
                            }`}
                        >
                            ● Benign
                        </button>
                        <button
                            type="button"
                            onClick={() => setSettings({
                                ...settings, 
                                filtering: { ...settings.filtering, clinVarSignificance: ['LIKELY_BENIGN'] }
                            })}
                            className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all shadow-sm ${
                                settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('LIKELY_BENIGN')
                                    ? 'bg-teal-600 text-white shadow-teal-500/20 font-bold'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:border-teal-400'
                            }`}
                        >
                            ● Likely Benign
                        </button>
                        <button
                            type="button"
                            onClick={() => setSettings({
                                ...settings, 
                                filtering: { ...settings.filtering, clinVarSignificance: ['VUS', 'CONFLICTING'] }
                            })}
                            className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all shadow-sm ${
                                settings.filtering.clinVarSignificance.length === 2 && settings.filtering.clinVarSignificance.includes('VUS') && settings.filtering.clinVarSignificance.includes('CONFLICTING')
                                    ? 'bg-amber-600 text-white shadow-amber-500/20 font-bold'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:border-amber-400'
                            }`}
                            title="Both VUS and Conflicting interpretations (Default)"
                        >
                            ● VUS + Conflicting (Default)
                        </button>
                        <button
                            type="button"
                            onClick={() => setSettings({
                                ...settings, 
                                filtering: { ...settings.filtering, clinVarSignificance: ['VUS'] }
                            })}
                            className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all shadow-sm ${
                                settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('VUS')
                                    ? 'bg-amber-700 text-white shadow-amber-500/20 font-bold'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:border-amber-400'
                            }`}
                            title="Pure VUS (strictly omits conflicting variants)"
                        >
                            ● VUS Only
                        </button>
                        <button
                            type="button"
                            onClick={() => setSettings({
                                ...settings, 
                                filtering: { ...settings.filtering, clinVarSignificance: ['CONFLICTING'] }
                            })}
                            className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all shadow-sm ${
                                settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('CONFLICTING')
                                    ? 'bg-purple-600 text-white shadow-purple-500/20 font-bold'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:border-purple-400'
                            }`}
                            title="Variants with conflicting interpretations only"
                        >
                            ● Conflicting Only
                        </button>
                        <button
                            type="button"
                            onClick={() => setSettings({
                                ...settings, 
                                filtering: { ...settings.filtering, clinVarSignificance: ['DISCORDANT'] }
                            })}
                            className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all shadow-sm flex items-center gap-1 ${
                                settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('DISCORDANT')
                                    ? 'bg-amber-600 text-white shadow-amber-500/20 font-bold'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:border-amber-400'
                            }`}
                            title="Search for discordant variants: Benign with AM score ≥ 0.56, or Pathogenic with AM score ≤ 0.34"
                        >
                            <Scale className="w-3 h-3" />
                            ⚡ Discordant
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowSettings(true)}
                            className="px-2.5 py-1 text-xs rounded-md font-medium text-slate-600 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 border border-dashed border-slate-300 dark:border-slate-600 flex items-center gap-1"
                        >
                            <Sliders className="w-3 h-3" />
                            Advanced Options
                        </button>
                    </div>

                    {/* ClinVar Review Stars (Gold Stars) */}
                    <div className="w-full flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-200 dark:border-slate-700/80 mt-1">
                        <div className="flex items-center gap-1.5">
                            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                ClinVar Review Stars:
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">
                                (Minimum review status tier • Not relevant for VUS)
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            {[
                                { stars: 0, label: "All Stars (0+)", tip: "Include all variants regardless of review criteria" },
                                { stars: 1, label: "1+ ⭐", tip: "Criteria provided, single submitter or higher" },
                                { stars: 2, label: "2+ ⭐⭐", tip: "Multiple submitters, no conflicts or higher" },
                                { stars: 3, label: "3+ ⭐⭐⭐", tip: "Reviewed by expert panel or higher" },
                                { stars: 4, label: "4 ⭐⭐⭐⭐", tip: "Practice guideline only" },
                            ].map((item) => (
                                <button
                                    key={item.stars}
                                    type="button"
                                    onClick={() => setSettings({
                                        ...settings, 
                                        filtering: { ...settings.filtering, minClinVarStars: item.stars }
                                    })}
                                    title={item.tip}
                                    className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all shadow-sm ${
                                        settings.filtering.minClinVarStars === item.stars
                                            ? "bg-amber-500 text-white shadow-amber-500/25 font-bold"
                                            : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:border-amber-400 hover:text-amber-600 dark:hover:text-amber-400"
                                    }`}
                                >
                                    {item.label}
                                </button>
                            ))}
                            {settings.filtering.minClinVarStars > 0 && (
                                <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 ml-1">
                                    [Filtering ≥ {settings.filtering.minClinVarStars}★]
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Manual Mutation Entry Toggle */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2 mb-3">
                        <div 
                            onClick={() => setManualVariantEnabled(!manualVariantEnabled)}
                            className={`w-10 h-5 rounded-full flex items-center px-1 cursor-pointer transition-colors ${manualVariantEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                        >
                            <div className={`w-3.5 h-3.5 bg-white rounded-full transition-transform ${manualVariantEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Enable Manual Mutation Entry</span>
                    </div>

                    {manualVariantEnabled && (
                        <div className="bg-slate-100 dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-wrap gap-4 items-end animate-fade-in">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                    Residue Number
                                </label>
                                <input
                                    type="number"
                                    value={manualResidue}
                                    onChange={(e) => setManualResidue(e.target.value)}
                                    className="w-24 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-sm focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
                                    placeholder="123"
                                />
                            </div>
                            
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                    Numbering Based On
                                </label>
                                <div className="flex bg-white dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-600 overflow-hidden">
                                    <button 
                                        onClick={() => setManualNumberingSpecies('human')}
                                        className={`px-3 py-1.5 text-xs font-medium ${manualNumberingSpecies === 'human' ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                                    >
                                        Human
                                    </button>
                                    <div className="w-px bg-slate-200 dark:bg-slate-600"></div>
                                    <button 
                                        onClick={() => setManualNumberingSpecies('yeast')}
                                        className={`px-3 py-1.5 text-xs font-medium ${manualNumberingSpecies === 'yeast' ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                                    >
                                        Yeast
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                    Target Amino Acid
                                </label>
                                <input
                                    type="text"
                                    maxLength={1}
                                    value={manualTargetAA}
                                    onChange={(e) => setManualTargetAA(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                                    className="w-24 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-sm focus:ring-2 focus:ring-emerald-500 uppercase font-mono text-slate-900 dark:text-white"
                                    placeholder="P (1 letter code)"
                                />
                            </div>
                            
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-500 italic pb-2">
                                <PenTool className="w-3 h-3 inline mr-1" />
                                Custom variant will be added to the list.
                            </div>
                        </div>
                    )}
                </div>
            </div>
          )}

          {(inputMode === 'rare' || inputMode === 'topic') && (
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-3 relative">
                        {inputMode === 'topic' && (
                            <div className="flex gap-2 mb-3 items-center justify-between">
                                 <div className="flex gap-2">
                                    <button onClick={() => { setSearchSpecies('human'); setTopicResults([]); setHasSearched(false); }} className={`px-3 py-1 text-xs font-medium rounded-full transition-colors border ${searchSpecies === 'human' ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>Human Genes</button>
                                    <button onClick={() => { setSearchSpecies('yeast'); setTopicResults([]); setHasSearched(false); }} className={`px-3 py-1 text-xs font-medium rounded-full transition-colors border ${searchSpecies === 'yeast' ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>Yeast Genes</button>
                                 </div>
                                 <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={useAiSearch} 
                                        onChange={(e) => setUseAiSearch(e.target.checked)}
                                        className="rounded text-emerald-500 focus:ring-emerald-500 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                                    />
                                    <Sparkles className="w-3 h-3 text-purple-500" />
                                    AI-Enhanced Search (Slower)
                                 </label>
                            </div>
                        )}

                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                            {inputMode === 'rare' ? 'Rare Disease Associated Genes (Conserved in Yeast)' : (searchSpecies === 'human' ? 'Search Topic / Keyword (Human)' : 'Search Topic / Keyword (Yeast)')}
                        </label>
                        <Search className="absolute left-3 top-[4.5rem] md:top-[2.4rem] h-4 w-4 text-slate-400 dark:text-slate-500 mt-0.5" style={{ top: inputMode === 'topic' ? '4.5rem' : '2.4rem' }} />
                        <input
                            type="text"
                            value={topicInput}
                            onChange={(e) => setTopicInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-emerald-500"
                            placeholder={inputMode === 'rare' ? "Search specific disease or gene... (leave blank for random discovery)" : "e.g. Cancer, Mitochondria, Deafness"}
                        />
                    </div>
                    <div className="flex items-end gap-2">
                         <button
                            onClick={handleSearch}
                            disabled={isSearching}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
                         >
                            {isSearching ? (
                                <>
                                    <Dna className="w-4 h-4 animate-spin text-yellow-300" />
                                    Searching...
                                </>
                            ) : (
                                <>
                                    {inputMode === 'rare' && !topicInput ? <Shuffle className="w-4 h-4 text-white" /> : <Sparkles className="w-4 h-4 text-yellow-300" />}
                                    {inputMode === 'rare' && !topicInput ? 'Random' : 'Find Genes'}
                                </>
                            )}
                         </button>
                         
                         {inputMode === 'topic' ? (
                             <button
                                 onClick={handleFilterOrthologs}
                                 disabled={isFilteringOrthologs || topicResults.length === 0}
                                 className="flex-1 bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-1 shadow-sm"
                             >
                                 {isFilteringOrthologs ? <Dna className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
                                 Filter Orthologs
                             </button>
                         ) : (
                             <button
                                 onClick={() => setShowRareList(!showRareList)}
                                 className={`flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-all ${showRareList ? 'bg-slate-200 dark:bg-slate-600 shadow-inner' : ''}`}
                             >
                                 {showRareList ? <X className="w-4 h-4" /> : <List className="w-4 h-4" />}
                                 {showRareList ? 'Close List' : 'Full List'}
                             </button>
                         )}
                    </div>
                </div>
                
                {/* Filter Inputs for Topic/Rare Mode */}
                <div className="grid grid-cols-2 gap-4 max-w-md">
                     <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Min AlphaMissense</label>
                        <input type="number" step="0.01" min="0" max="1" value={minScore} onChange={(e) => setMinScore(parseFloat(e.target.value))} className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500" />
                     </div>
                     <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Max AlphaMissense</label>
                        <input type="number" step="0.01" min="0" max="1" value={maxScore} onChange={(e) => setMaxScore(parseFloat(e.target.value))} className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500" />
                     </div>
                </div>

                {/* Rare Disease Full List View */}
                {inputMode === 'rare' && showRareList && (
                    <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-800 shadow-sm animate-fade-in">
                        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <BookOpen className="w-4 h-4 text-emerald-500" />
                                All Curated Rare Diseases ({RARE_DISEASE_GENES.length})
                            </h3>
                            <span className="text-xs text-slate-500 dark:text-slate-400">Click a row to analyze</span>
                        </div>
                        <div className="max-h-[300px] overflow-y-auto">
                            <table className="w-full text-sm text-left text-slate-600 dark:text-slate-300">
                                <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="px-4 py-2 font-medium">Human Gene</th>
                                        <th className="px-4 py-2 font-medium">Yeast Ortholog</th>
                                        <th className="px-4 py-2 font-medium">Disease</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                    {RARE_DISEASE_GENES.filter(g => 
                                        !topicInput || 
                                        g.h.toLowerCase().includes(topicInput.toLowerCase()) || 
                                        g.y.toLowerCase().includes(topicInput.toLowerCase()) || 
                                        g.d.toLowerCase().includes(topicInput.toLowerCase())
                                    ).map((g, i) => (
                                        <tr 
                                            key={i} 
                                            onClick={() => {
                                                setTopicInput(g.h);
                                                setShowRareList(false);
                                                setTopicInput(g.h);
                                            }}
                                            className="hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors"
                                        >
                                            <td className="px-4 py-2 font-bold text-slate-800 dark:text-slate-100">{g.h}</td>
                                            <td className="px-4 py-2 font-mono text-emerald-600 dark:text-emerald-400">{g.y}</td>
                                            <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                                                <a 
                                                    href={`https://raresource.nih.gov/diseases/filter/${encodeURIComponent(g.d)}/`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="hover:text-emerald-500 hover:underline"
                                                >
                                                    {g.d}
                                                </a>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {hasSearched && topicResults.length === 0 && !showRareList && (
                     <div className="mt-4 p-4 border border-yellow-300 dark:border-yellow-800 bg-yellow-100 dark:bg-yellow-900/20 rounded-lg text-yellow-800 dark:text-yellow-200 text-sm flex items-center gap-2">
                         <AlertCircle className="w-4 h-4" />
                         No genes found. Try a different term or check your spelling.
                     </div>
                )}

                {topicResults.length > 0 && !showRareList && (
                    <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-lg max-h-60 overflow-y-auto bg-white dark:bg-slate-900">
                        {topicResults.map((gene) => (
                            <div 
                                key={gene.entrez_id}
                                onClick={() => handleResultClick(gene)}
                                className="px-4 py-3 border-b last:border-0 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer flex justify-between items-center group"
                            >
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-slate-800 dark:text-slate-200">{gene.symbol}</span>
                                        {gene.diseaseName && (
                                            <a
                                                href={`https://raresource.nih.gov/diseases/filter/${encodeURIComponent(gene.diseaseName)}/`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-400 border border-teal-200 dark:border-teal-800 uppercase tracking-wide text-wrap max-w-[400px] hover:bg-teal-200 dark:hover:bg-teal-800 hover:underline" 
                                                title={`View ${gene.diseaseName} on GARD`}
                                            >
                                                {gene.diseaseName}
                                            </a>
                                        )}
                                    </div>
                                    <span className="text-slate-500 text-sm ml-2 block truncate max-w-md">{gene.name}</span>
                                </div>
                                <div className="flex items-center gap-4">
                                    {gene.dioptScore !== undefined && (
                                        <div className="flex items-center gap-2">
                                            {gene.mappedOrtholog && (
                                                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                                                    {searchSpecies === 'human' ? 'Yeast:' : 'Human:'} <strong>{gene.mappedOrtholog}</strong>
                                                    {gene.tiedOrthologs && gene.tiedOrthologs.length > 0 && (
                                                        <span className="ml-1 text-emerald-600 dark:text-emerald-400 cursor-help" title={`Equally scored alternatives: ${gene.tiedOrthologs.join(', ')}`}>
                                                            (+{gene.tiedOrthologs.length} ties)
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                            <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
                                                DIOPT: {gene.dioptScore}
                                            </span>
                                        </div>
                                    )}
                                    <ArrowRight className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-emerald-500" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
          )}

          {inputMode === 'discordant' && (
            <div className="pt-2">
              <DiscordantVariantsExplorer 
                onSelectGeneVariant={handleDiscordantDeepDive}
                isDarkMode={isDarkMode}
              />
            </div>
          )}
        </div>

        {/* Status Logs - Floating Terminal */}
        <div className="sticky top-20 z-40 mb-6 transition-all duration-300">
            <div className={`bg-slate-100 dark:bg-slate-950 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-all duration-300 ${isLogCollapsed ? 'h-10 opacity-90' : 'max-h-60'}`}>
                 <div 
                    className="flex items-center justify-between px-4 py-2 bg-slate-200/50 dark:bg-slate-900/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                    onClick={() => setIsLogCollapsed(!isLogCollapsed)}
                 >
                     <div className="flex items-center gap-3">
                        <div className={`p-1 rounded-md ${state.step === 'error' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30'}`}>
                             {state.step !== 'idle' && state.step !== 'complete' && state.step !== 'error' ? (
                                <Dna className="w-3.5 h-3.5 text-emerald-500 animate-spin" />
                             ) : (
                                <Activity className={`w-3.5 h-3.5 ${state.step === 'error' ? 'text-red-500' : 'text-emerald-500'}`} />
                             )}
                        </div>
                         <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                            Status Terminal
                         </span>
                         {isLogCollapsed && state.logs.length > 0 && (
                             <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-[300px] hidden sm:inline-block border-l border-slate-300 dark:border-slate-700 pl-3">
                                 Last: {state.logs[state.logs.length - 1]}
                             </span>
                         )}
                     </div>
                     <div className="flex items-center gap-2">
                         <span className="text-[10px] font-mono text-slate-400 bg-slate-200 dark:bg-slate-800 px-1.5 rounded hidden sm:inline-block">
                             {state.logs.length} lines
                         </span>
                         <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-300 ${isLogCollapsed ? '' : 'rotate-180'}`} />
                     </div>
                 </div>
                 
                 <div ref={logsContainerRef} className={`p-4 font-mono text-xs overflow-y-auto bg-slate-50 dark:bg-[#0b1120] scroll-smooth ${isLogCollapsed ? 'hidden' : 'block flex-grow'}`}>
                      {state.logs.length === 0 && <span className="text-slate-400 dark:text-slate-600 italic">Ready to start...</span>}
                      {state.logs.map((log, i) => (
                        <div key={i} className={`mb-1.5 break-words leading-relaxed flex gap-2 ${log.includes('Error') ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                          <span className="opacity-30 text-slate-500 select-none shrink-0 font-light">[{new Date().toLocaleTimeString()}]</span>
                          <span>{log}</span>
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                 </div>
            </div>
        </div>

        {/* ... (Rest of the component remains the same: geneInfo display, etc.) ... */}
        {geneInfo && ortholog && (
          <div className="grid grid-cols-1 min-[1801px]:grid-cols-2 gap-8 animate-fade-in">
            {/* Left Column: Data & Viz */}
            <div className="space-y-8 min-w-0">
              
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <a 
                    href={geneInfo.uniprot_id ? `https://www.uniprot.org/uniprotkb/${geneInfo.uniprot_id}/entry` : '#'} 
                    target="_blank" rel="noopener noreferrer"
                    className={`bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-emerald-500 transition-all block relative ${!geneInfo.uniprot_id ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <ExternalLink className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute top-4 right-4" />
                  <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide font-semibold mb-1">Human Gene</div>
                  <div className="text-xl font-bold text-slate-900 dark:text-slate-100">{geneInfo.symbol}</div>
                  <div className="text-sm text-slate-500 dark:text-slate-400 truncate">{geneInfo.name}</div>
                  <div className="mt-2 text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 inline-block px-2 py-1 rounded">
                    Entrez: {geneInfo.entrez_id}
                  </div>
                </a>

                <a 
                    href={yeastSgdId ? `https://www.alliancegenome.org/gene/${yeastSgdId}` : `https://www.alliancegenome.org/gene/NCBI_Gene:${ortholog.id}`}
                    target="_blank" rel="noopener noreferrer"
                    className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-emerald-500 transition-all block relative"
                >
                  <ExternalLink className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute top-4 right-4" />
                  <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide font-semibold mb-1">Yeast Ortholog</div>
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{ortholog.symbol}</div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">DIOPT Score: {ortholog.score}</div>
                  <div className="mt-2 text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 inline-block px-2 py-1 rounded">
                    ID: {ortholog.id} {yeastSgdId ? `(${yeastSgdId})` : ''}
                  </div>
                </a>
              </div>

              {/* Alignment Stats */}
              {alignment && (
                <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-4">
                     <div className="flex gap-8 items-center justify-around">
                         <div className="text-center">
                             <div className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">Percent Identity</div>
                             <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-500">{alignment.percentIdentity?.toFixed(1)}%</div>
                         </div>
                         <div className="w-px h-10 bg-slate-200 dark:bg-slate-700"></div>
                         <div className="text-center">
                             <div className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">Percent Similarity</div>
                             <div className="text-2xl font-bold text-teal-600 dark:text-teal-500">{alignment.percentSimilarity?.toFixed(1)}%</div>
                         </div>
                     </div>
                     
                     {/* Low Conservation Warning */}
                     {((ortholog.score <= 2) || (alignment.percentSimilarity !== undefined && alignment.percentSimilarity < 33)) && (
                        <div className="flex items-center gap-2 justify-center p-2 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 font-bold text-sm animate-pulse">
                            <AlertCircle className="w-4 h-4" />
                            Warning: Potential Low Conservation
                        </div>
                     )}
                </div>
              )}

              {/* Alignment View */}
              {alignment && (
                <AlignmentView 
                    humanSeq={alignment.humanSeqAligned}
                    yeastSeq={alignment.yeastSeqAligned}
                    variants={variants}
                    humanName={geneInfo.symbol}
                    yeastName={ortholog.symbol}
                    selectedResidues={selectedVariantIndices.map(idx => variants[idx].residue)}
                    onResidueClick={handleResidueClick}
                    humanUniProtId={geneInfo.uniprot_id}
                    yeastUniProtId={yeastUniProtId}
                    proteinDomains={proteinDomains}
                    proteinPtms={proteinPtms}
                    functionalSites={functionalSites}
                    proteinInterfaces={proteinInterfaces}
                />
              )}

              {/* 3D Structure Viewer  */}
              {(geneInfo.uniprot_id || yeastUniProtId) && (
                  <StructureViewer 
                      ref={structureViewerRef}
                      humanUniprot={geneInfo.uniprot_id}
                      yeastUniprot={yeastUniProtId}
                      initialSpecies={manualSearchSpecies === 'yeast' ? 'yeast' : 'human'}
                      customHighlights={selectedVariantIndices.length > 0 ? selectedVariantIndices.map(idx => ({
                          residue: variants[idx].residue,
                          color: '#ef4444' // Red highlight for mutation
                      })) : []}
                      highlightsBySpecies={selectedVariantIndices.length > 0 ? {
                          human: selectedVariantIndices.map(idx => ({ residue: variants[idx].residue, color: '#a855f7' })), // Purple
                          yeast: selectedVariantIndices.map(idx => ({ residue: parseInt(variants[idx].yeastPos) || 0, color: '#ef4444' })) // Red
                      } : undefined}
                      settings={settings.structure}
                      proteinDomains={proteinDomains}
                      functionalSites={functionalSites}
                      proteinPtms={proteinPtms}
                      proteinInterfaces={proteinInterfaces}
                      alignmentMap={alignmentMap}
                  />
              )}

              {/* Filtered Variants Table */}
              <div ref={variantsTableRef} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden scroll-mt-24">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center flex-wrap gap-2">
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <List className="w-4 h-4" />
                    Filtered Variants ({variants.length})
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                        settings.filtering.clinVarSignificance.includes('PATHOGENIC') && !settings.filtering.clinVarSignificance.includes('LIKELY_PATHOGENIC') && settings.filtering.clinVarSignificance.length === 1
                            ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800' :
                        settings.filtering.clinVarSignificance.includes('LIKELY_PATHOGENIC') && !settings.filtering.clinVarSignificance.includes('PATHOGENIC') && settings.filtering.clinVarSignificance.length === 1
                            ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-800' :
                        settings.filtering.clinVarSignificance.includes('BENIGN') && !settings.filtering.clinVarSignificance.includes('LIKELY_BENIGN') && settings.filtering.clinVarSignificance.length === 1
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' :
                        settings.filtering.clinVarSignificance.includes('LIKELY_BENIGN') && !settings.filtering.clinVarSignificance.includes('BENIGN') && settings.filtering.clinVarSignificance.length === 1
                            ? 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border-teal-200 dark:border-teal-800' :
                        settings.filtering.clinVarSignificance.includes('CONFLICTING') && settings.filtering.clinVarSignificance.length === 1
                            ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800' :
                        settings.filtering.clinVarSignificance.length === 2 && settings.filtering.clinVarSignificance.includes('VUS') && settings.filtering.clinVarSignificance.includes('CONFLICTING')
                            ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300 dark:border-amber-700' :
                        settings.filtering.clinVarSignificance.includes('VUS') && settings.filtering.clinVarSignificance.length === 1
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800' :
                        'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}>
                        ● {
                            settings.filtering.clinVarSignificance.length === 2 && settings.filtering.clinVarSignificance.includes('VUS') && settings.filtering.clinVarSignificance.includes('CONFLICTING') ? 'VUS + Conflicting (Default)' :
                            settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('PATHOGENIC') ? 'Pathogenic Only' :
                            settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('LIKELY_PATHOGENIC') ? 'Likely Pathogenic Only' :
                            settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('BENIGN') ? 'Benign Only' :
                            settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('LIKELY_BENIGN') ? 'Likely Benign Only' :
                            settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('CONFLICTING') ? 'Conflicting Only' :
                            settings.filtering.clinVarSignificance.length === 1 && settings.filtering.clinVarSignificance.includes('VUS') ? 'VUS Only (Conflicting Omitted)' :
                            settings.filtering.clinVarSignificance.map(s => {
                                if (s === 'PATHOGENIC') return 'Path';
                                if (s === 'LIKELY_PATHOGENIC') return 'Likely Path';
                                if (s === 'BENIGN') return 'Benign';
                                if (s === 'LIKELY_BENIGN') return 'Likely Benign';
                                if (s === 'CONFLICTING') return 'Conflicting';
                                return 'VUS';
                            }).join(' + ')
                        } {!settings.filtering.clinVarSignificance.includes('CONFLICTING') && settings.filtering.clinVarSignificance.length > 1 ? '(Conflicting Excluded)' : ''}
                    </span>
                    <span className="text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-full">
                      {settings.filtering.excludeGaps ? 'Showing Conserved Only' : 'Showing All'}
                    </span>
                    {settings.filtering.minClinVarStars > 0 && (
                      <span className="text-xs font-semibold bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-2 py-1 rounded-full flex items-center gap-1 border border-amber-200 dark:border-amber-800">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
                        ≥ {settings.filtering.minClinVarStars} Gold Star{settings.filtering.minClinVarStars > 1 ? "s" : ""}
                        <button
                          type="button"
                          onClick={() => setSettings({
                            ...settings,
                            filtering: { ...settings.filtering, minClinVarStars: 0 }
                          })}
                          className="ml-1 hover:text-red-500 font-bold"
                          title="Clear gold stars filter"
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Instructional Text */}
                <div className="px-6 py-2 bg-slate-50 dark:bg-slate-900 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 italic">
                    Click the Variant to see more detail. Click the AlphaMissense (AM) score to see more detail including the protein structure.
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left text-slate-600 dark:text-slate-300">
                    <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-medium w-12">Select</th>
                        <th className="px-3 py-2 font-small">Variant</th>
                        <th className="px-3 py-2 font-small w-10">Ref</th>
                        <th className="px-3 py-2 font-small w-10">Var</th>
                        <th className="px-3 py-2 font-small">Status</th>
                        <th className="px-3 py-2 font-small w-10">Yeast AA</th>
                        <th className="px-3 py-2 font-small w-16 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 flex items-center justify-between" onClick={() => { setVariantSortBy('residue'); setVariantSortDirection(variantSortBy === 'residue' && variantSortDirection === 'asc' ? 'desc' : 'asc'); }}>
                            Yeast Pos
                            {variantSortBy === 'residue' && (
                                <span className="text-emerald-500 ml-1">{variantSortDirection === 'asc' ? '↑' : '↓'}</span>
                            )}
                        </th>
                        <th className="px-2.5 py-2 font-small cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800" onClick={() => { setVariantSortBy('amScore'); setVariantSortDirection(variantSortBy === 'amScore' && variantSortDirection === 'asc' ? 'desc' : 'asc'); }}>
                            <div className="flex items-center justify-between gap-1 leading-tight">
                                <div>
                                    <div>AM</div>
                                    <div>Score</div>
                                </div>
                                {variantSortBy === 'amScore' && (
                                    <span className="text-emerald-500 ml-0.5">{variantSortDirection === 'asc' ? '↑' : '↓'}</span>
                                )}
                            </div>
                        </th>
                        <th className="px-2.5 py-2 font-small cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800" onClick={() => { setVariantSortBy('localHomology'); setVariantSortDirection(variantSortBy === 'localHomology' && variantSortDirection === 'asc' ? 'desc' : 'asc'); }}>
                            <div className="flex items-center justify-between gap-1 leading-tight">
                                <div>
                                    <div>Local</div>
                                    <div>Homology</div>
                                </div>
                                {variantSortBy === 'localHomology' && (
                                    <span className="text-emerald-500 ml-0.5">{variantSortDirection === 'asc' ? '↑' : '↓'}</span>
                                )}
                            </div>
                        </th>
                        <th className="px-2.5 py-2 font-small leading-tight">
                            <div>Variant</div>
                            <div>Type</div>
                        </th>
                        <th 
                            className="px-3 py-3 font-small whitespace-nowrap cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800"
                            onClick={() => {
                                setVariantSortBy('annotations');
                                setVariantSortDirection(variantSortBy === 'annotations' && variantSortDirection === 'asc' ? 'desc' : 'asc');
                            }}
                            title="Functional sites, post-translational modifications (PTMs), short linear motifs, and 3D structural protein-protein/nucleic acid contact interfaces (Click to sort)"
                        >
                            <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1.5">
                                    <span>Sites / PTM / Interface</span>
                                    {isAnnotationsLoading && (
                                        <span className="flex items-center text-[10px] text-emerald-500 font-normal animate-pulse">
                                            <RefreshCw className="w-2.5 h-2.5 animate-spin mr-0.5" /> loading...
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1">
                                    {variantSortBy === 'annotations' && (
                                        <span className="text-emerald-500">{variantSortDirection === 'asc' ? '↑' : '↓'}</span>
                                    )}
                                    {geneInfo && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                loadProteinAnnotations(geneInfo);
                                            }}
                                            className="p-0.5 text-slate-400 hover:text-emerald-500 rounded transition-colors"
                                            title="Reload Sites, PTMs, and Interfaces annotations from UniProt, BioGRID, and PDBe-KB"
                                        >
                                            <RefreshCw className={`w-3 h-3 ${isAnnotationsLoading ? 'animate-spin text-emerald-500' : ''}`} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </th>
                        <th 
                            className="px-2.5 py-2 font-small cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800"
                            onClick={() => {
                                setVariantSortBy('gnomad');
                                setVariantSortDirection(variantSortBy === 'gnomad' && variantSortDirection === 'asc' ? 'desc' : 'asc');
                            }}
                            title="gnomAD Population Allele Frequency (exomes & genomes)"
                        >
                            <div className="flex items-center justify-between gap-1 leading-tight">
                                <div>
                                    <div>gnomAD</div>
                                    <div>Freq</div>
                                </div>
                                {variantSortBy === 'gnomad' && (
                                    <span className="text-emerald-500 ml-0.5">{variantSortDirection === 'asc' ? '↑' : '↓'}</span>
                                )}
                            </div>
                        </th>
                        <th 
                            className="px-2.5 py-2 font-small cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800" 
                            onClick={() => { 
                                setVariantSortBy("stars"); 
                                setVariantSortDirection(variantSortBy === "stars" && variantSortDirection === "asc" ? "desc" : "asc"); 
                            }}
                        >
                            <div className="flex items-center justify-between gap-1 leading-tight">
                                <div>
                                    <div>ClinVar</div>
                                    <div className="flex items-center gap-1">
                                        <Star className="w-3 h-3 text-amber-500 fill-amber-400" />
                                        <span>Stars</span>
                                    </div>
                                </div>
                                {variantSortBy === "stars" && (
                                    <span className="text-emerald-500 ml-0.5">{variantSortDirection === "asc" ? "↑" : "↓"}</span>
                                )}
                            </div>
                        </th>
                        <th 
                            className="px-3 py-3 font-small whitespace-nowrap cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800" 
                            onClick={() => { 
                                setVariantSortBy("submitters"); 
                                setVariantSortDirection(variantSortBy === "submitters" && variantSortDirection === "asc" ? "desc" : "asc"); 
                            }}
                            title="Number of ClinVar submitters and clinical submissions"
                        >
                            <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1">
                                    <Users className="w-3.5 h-3.5 text-slate-500" />
                                    <span>Submitters</span>
                                </div>
                                {variantSortBy === "submitters" && (
                                    <span className="text-emerald-500 ml-1">{variantSortDirection === "asc" ? "↑" : "↓"}</span>
                                )}
                            </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {sortedAndMappedVariants.slice(0, visibleVariantsCount).map(({ v, originalIndex }) => (
                        <tr 
                            key={originalIndex} 
                            id={`variant-row-${originalIndex}`}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer ${selectedVariantIndices.includes(originalIndex) ? 'bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50' : ''}`}
                            onClick={() => toggleVariantSelection(originalIndex)}
                        >
                          <td className="px-3 py-3 text-center">
                              <input 
                                type="checkbox" 
                                checked={selectedVariantIndices.includes(originalIndex)}
                                onChange={() => toggleVariantSelection(originalIndex)}
                                className="rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600"
                              />
                          </td>
                          <td className="px-3 py-3 font-medium text-emerald-600 dark:text-emerald-400 group relative">
                             {v.clinVarVariantId ? (
                                 <a 
                                    href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${v.clinVarVariantId}/`} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                    title={v.hgvs} // Tooltip for full name
                                 >
                                    {v.proteinChange}
                                    <ExternalLink className="w-3 h-3" />
                                 </a>
                             ) : v.proteinChange}
                          </td>
                          <td className="px-3 py-3 font-mono font-bold text-slate-800 dark:text-slate-100">{v.refAA}</td>
                          <td className="px-3 py-3 font-mono font-bold text-slate-800 dark:text-slate-100">{v.targetAA}</td>
                          <td className="px-3 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              v.conservedStatus === 'Identical' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' :
                              v.conservedStatus === 'Similar' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                              v.conservedStatus === 'Gap' ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400' :
                              'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                            }`}>
                              {v.conservedStatus}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-slate-800 dark:text-slate-100 font-mono font-bold">
                             {v.yeastAA}
                          </td>
                          <td className="px-3 py-3 text-slate-500 dark:text-slate-400 text-xs">
                             {v.yeastPos}
                          </td>
                          <td className="px-3 py-3 text-slate-800 dark:text-slate-100 whitespace-nowrap">
                             {v.amScore !== null ? (
                                 <a 
                                    href={`https://alphamissense.hegelab.org/hotspot?uid=${geneInfo.uniprot_id}&resi=${v.residue}`}
                                    target="_blank" rel="noopener noreferrer"
                                    className="text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
                                    onClick={(e) => e.stopPropagation()}
                                 >
                                    {v.amScore.toFixed(3)}
                                 </a>
                             ) : <span className="text-slate-400 dark:text-slate-500 italic">N/A</span>}
                          </td>
                          <td className="px-3 py-3 text-center">
                              {v.localHomologyScore !== undefined ? (
                                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                                      v.localHomologyScore > 75 ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' :
                                      v.localHomologyScore >= 35 ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300' :
                                      'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                                  }`}>
                                      {v.localHomologyScore}%
                                  </span>
                              ) : <span className="text-slate-400 dark:text-slate-500">-</span>}
                          </td>
                          <td className="px-3 py-3 text-slate-800 dark:text-slate-100 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                  v.clinicalSignificance === 'Pathogenic' ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border border-red-200 dark:border-red-800' :
                                  v.clinicalSignificance === 'Likely Pathogenic' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border border-orange-200 dark:border-orange-800' :
                                  v.clinicalSignificance === 'Benign' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' :
                                  v.clinicalSignificance === 'Likely Benign' ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 border border-teal-200 dark:border-teal-800' :
                                  v.clinicalSignificance === 'VUS' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800' :
                                  v.clinicalSignificance === 'Conflicting' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800' :
                                  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}>
                                  {v.clinicalSignificance || 'N/A'}
                              </span>
                          </td>
                          <td className="px-3 py-3">
                              {(() => {
                                  const annot = residueAnnotationsMap.get(Number(v.residue));
                                  if (!annot || (annot.ptms.length === 0 && annot.sites.length === 0 && annot.interfaces.length === 0 && annot.domains.length === 0)) {
                                      if (isAnnotationsLoading) {
                                          return <span className="text-slate-400 dark:text-slate-500 text-xs italic animate-pulse">loading...</span>;
                                      }
                                      return <span className="text-slate-400 dark:text-slate-500 text-xs italic">-</span>;
                                  }

                                  const getPtmLabel = (cat: string) => {
                                      switch (cat.toLowerCase()) {
                                          case 'phosphorylation': return 'Phosphorylated';
                                          case 'acetylation': return 'Acetylated';
                                          case 'methylation': return 'Methylated';
                                          case 'ubiquitination': return 'Ubiquitinated';
                                          case 'sumoylation': return 'SUMOylated';
                                          case 'glycosylation': return 'Glycosylated';
                                          case 'disulfide': return 'Disulfide Bond';
                                          case 'lipidation': return 'Lipidated';
                                          default: return cat;
                                      }
                                  };

                                  return (
                                      <div className="flex flex-wrap gap-1 max-w-[280px] items-center">
                                          {/* PTMs */}
                                          {annot.ptms.map((ptm, idx) => (
                                              <span
                                                  key={`ptm-${idx}`}
                                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
                                                  title={`PTM: ${ptm.category} at residue ${v.residue}${ptm.description ? ` (${ptm.description})` : ''}`}
                                              >
                                                  <Sparkles className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                                                  <span>{getPtmLabel(ptm.category)}</span>
                                              </span>
                                          ))}

                                          {/* Functional Sites & Motifs */}
                                          {annot.sites.map((site, idx) => {
                                              let label = site.name;
                                              if (site.category === 'ACTIVE_SITE') label = 'Active Site';
                                              else if (site.category === 'METAL_BINDING') label = site.ligand ? `Metal (${site.ligand})` : 'Metal Binding';
                                              else if (site.category === 'BINDING_SITE') label = site.ligand ? `Binding (${site.ligand})` : 'Binding Site';
                                              else if (site.category === 'SLIM_MOTIF') label = `${site.label || 'SLiM'} Motif`;

                                              return (
                                                  <span
                                                      key={`site-${idx}`}
                                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-300 dark:border-purple-700"
                                                      title={`${site.name} (${site.category}): ${site.description}${site.ligand ? ` [Ligand: ${site.ligand}]` : ''}`}
                                                  >
                                                      <Target className="w-3 h-3 text-purple-600 dark:text-purple-400 shrink-0" />
                                                      <span>{label}</span>
                                                  </span>
                                              );
                                          })}

                                          {/* 3D Contact Interfaces */}
                                          {annot.interfaces.map((intf, idx) => {
                                              const partnerText = intf.partnerSymbol === 'Homomer (Self)'
                                                  ? 'Homomer Interface'
                                                  : intf.partnerSymbol === 'DNA' || intf.partnerSymbol === 'RNA'
                                                  ? `${intf.partnerSymbol} Interface`
                                                  : `${intf.partnerSymbol} Interaction`;

                                              const tooltip = `3D Contact Interface: ${partnerText}${intf.fullName ? ` (${intf.fullName})` : ''}${intf.bioGridCount > 0 ? ` • ${intf.bioGridCount} BioGRID reports` : ''}${intf.pdbIds.length > 0 ? ` • PDB: ${intf.pdbIds.slice(0, 4).join(', ')}` : ''}`;

                                              return (
                                                  <span
                                                      key={`intf-${idx}`}
                                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border border-sky-300 dark:border-sky-700"
                                                      title={tooltip}
                                                  >
                                                      <Network className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />
                                                      <span>{partnerText}</span>
                                                      {intf.bioGridCount > 0 && (
                                                          <span className="text-[9px] px-1 py-0.2 rounded bg-sky-200 dark:bg-sky-900 text-sky-800 dark:text-sky-200 font-mono">
                                                              {intf.bioGridCount} BG
                                                          </span>
                                                      )}
                                                  </span>
                                              );
                                          })}

                                          {/* Protein Domain (shown as secondary if no PTM/site/intf) */}
                                          {annot.ptms.length === 0 && annot.sites.length === 0 && annot.interfaces.length === 0 && annot.domains.length > 0 && (
                                              <span
                                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                                                  title={`Domain: ${annot.domains[0].name}`}
                                              >
                                                  <Layers className="w-3 h-3 text-indigo-500 shrink-0" />
                                                  <span className="truncate max-w-[140px]">{annot.domains[0].name}</span>
                                              </span>
                                          )}
                                      </div>
                                  );
                              })()}
                          </td>
                          <td className="px-2.5 py-2.5 whitespace-nowrap">
                              {v.gnomadFreq !== null && v.gnomadFreq !== undefined ? (() => {
                                  const afNum = v.gnomadFreq;
                                  const displayStr = afNum < 0.001 
                                      ? afNum.toExponential(1) 
                                      : `${(afNum * 100).toFixed(2)}%`;
                                  const sourceLabel = v.gnomadDetails?.source === 'genome' ? 'Genomes' : 'Exomes';
                                  const countsStr = (v.gnomadDetails?.ac !== undefined && v.gnomadDetails?.an !== undefined)
                                      ? `AC: ${v.gnomadDetails.ac} / AN: ${v.gnomadDetails.an.toLocaleString()}`
                                      : null;
                                  const tooltipText = [
                                      `gnomAD v2.1.1 (${sourceLabel}):`,
                                      `• Allele Frequency: ${afNum} (${afNum.toExponential(4)} | ${(afNum * 100).toFixed(4)}%)`,
                                      countsStr ? `• Allele Count: ${countsStr}` : null,
                                      `• Primary link opens gnomAD v2.1.1 where this exact frequency appears in the table.`,
                                      v.gnomadLinkV4 ? `• Note: gnomAD v4 (GRCh38) has ~730k more samples, so v4 frequencies will differ.` : null
                                  ].filter(Boolean).join('\n');

                                  return (
                                      <div className="inline-flex items-center gap-1.5" title={tooltipText}>
                                          {v.gnomadLink ? (
                                              <a 
                                                  href={v.gnomadLink}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="hover:underline font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-0.5 group/glink"
                                              >
                                                  <span>{displayStr}</span>
                                                  <ExternalLink className="w-2.5 h-2.5 text-slate-400 group-hover/glink:text-emerald-500" />
                                              </a>
                                          ) : (
                                              <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                                                  {displayStr}
                                              </span>
                                          )}
                                          <span className={`text-[9px] font-bold px-1 py-0.2 rounded border ${
                                              afNum >= 0.01 
                                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800' 
                                                  : afNum >= 0.001 
                                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-800' 
                                                      : 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                                          }`}>
                                              {afNum >= 0.01 ? 'Common' : afNum >= 0.001 ? 'Low' : 'Rare'}
                                          </span>
                                          {v.gnomadLinkV4 && (
                                              <a
                                                  href={v.gnomadLinkV4}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="text-slate-400 hover:text-emerald-500 font-sans text-[9px] font-medium"
                                                  title="Open in modern gnomAD v4 (GRCh38)"
                                              >
                                                  [v4]
                                              </a>
                                          )}
                                      </div>
                                  );
                              })() : (
                                  <span className="text-slate-400 dark:text-slate-500 text-xs italic" title="Not observed in gnomAD exomes or genomes (< 1e-5)">
                                      Absent
                                  </span>
                              )}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                              {renderStarRating(v.clinVarStars, v.reviewStatus)}
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                              {v.clinVarSubmitters !== undefined && v.clinVarSubmitters > 0 ? (
                                  <span 
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                                    title={`${v.clinVarSubmitters} ClinVar submitter ${v.clinVarSubmitters === 1 ? 'entry' : 'entries'}`}
                                  >
                                      <Users className="w-3 h-3 text-slate-400" />
                                      {v.clinVarSubmitters}
                                  </span>
                              ) : (
                                  <span className="text-slate-400 dark:text-slate-500 text-xs italic">-</span>
                              )}
                          </td>
                        </tr>
                      ))}
                      {variants.length === 0 && (
                        <tr>
                          <td colSpan={14} className="px-6 py-8 text-center text-slate-500">
                            No variants found matching criteria.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {visibleVariantsCount < variants.length && (
                    <div className="flex border-t border-slate-200 dark:border-slate-700">
                        <button 
                            onClick={handleShowMore}
                            className="flex-1 py-3 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-emerald-600 dark:text-emerald-400 font-medium text-sm transition-colors border-r border-slate-200 dark:border-slate-700"
                        >
                            Show 20 More ({variants.length - visibleVariantsCount} remaining)
                        </button>
                        <button 
                            onClick={() => setVisibleVariantsCount(variants.length)}
                            className="flex-1 py-3 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-emerald-600 dark:text-emerald-400 font-medium text-sm transition-colors"
                        >
                            Show All
                        </button>
                    </div>
                )}
              </div>



            </div>

            {/* Right Column: Reports & AI */}
            <div className="space-y-8 min-w-0">
                {/* Phenotypes */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
                <div className="flex justify-between items-center mb-4">
                     <a 
                        href={yeastSgdId ? `https://www.alliancegenome.org/gene/${yeastSgdId}` : `https://www.alliancegenome.org/gene/NCBI_Gene:${ortholog.id}`}
                        target="_blank" rel="noopener noreferrer"
                        className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                     >
                        <Activity className="w-4 h-4" />
                        Loss of Function (LOF) Phenotypes
                        <ExternalLink className="w-3 h-3 text-slate-500" />
                     </a>
                     <a 
                        href={yeastSgdId ? `https://www.alliancegenome.org/gene/${yeastSgdId}` : `https://www.alliancegenome.org/gene/NCBI_Gene:${ortholog.id}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                     >
                        More Info <ExternalLink className="w-3 h-3" />
                     </a>
                </div>
                {phenotypes.length > 0 && (() => {
                  const classicCount = phenotypes.filter(p => p.studyType === 'classic' || p.studyType === 'both' || p.hasClassic).length;
                  const htCount = phenotypes.filter(p => p.studyType === 'high-throughput' || p.studyType === 'both' || p.hasHighThroughput).length;
                  const displayedPhenotypes = phenotypes.filter(p => {
                    if (phenotypeStudyFilter === 'classic') {
                      return p.studyType === 'classic' || p.studyType === 'both' || p.hasClassic;
                    }
                    if (phenotypeStudyFilter === 'high-throughput') {
                      return p.studyType === 'high-throughput' || p.studyType === 'both' || p.hasHighThroughput;
                    }
                    return true;
                  });

                  return (
                    <div className="space-y-3 mb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Select a phenotype to tailor the AI experiment plan to it (click to view citations and study origin):
                        </p>

                        {/* Study Type Filter Tabs: All vs Classic Targeted vs High-Throughput */}
                        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                          <button
                            type="button"
                            onClick={() => setPhenotypeStudyFilter('all')}
                            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                              phenotypeStudyFilter === 'all'
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                            }`}
                          >
                            All ({phenotypes.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setPhenotypeStudyFilter('classic')}
                            className={`px-2.5 py-1 rounded-md font-medium transition-all flex items-center gap-1 ${
                              phenotypeStudyFilter === 'classic'
                                ? 'bg-amber-500 text-white shadow-sm font-semibold'
                                : 'text-slate-600 dark:text-slate-400 hover:text-amber-700 dark:hover:text-amber-400'
                            }`}
                            title="Filter to phenotypes from Classic genetic targeted studies on gene (specific alleles/mutations)"
                          >
                            <span>🏛️ Classic Targeted</span>
                            <span className={`text-[10px] px-1 rounded-full font-bold ${phenotypeStudyFilter === 'classic' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'}`}>{classicCount}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPhenotypeStudyFilter('high-throughput')}
                            className={`px-2.5 py-1 rounded-md font-medium transition-all flex items-center gap-1 ${
                              phenotypeStudyFilter === 'high-throughput'
                                ? 'bg-sky-600 text-white shadow-sm font-semibold'
                                : 'text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-400'
                            }`}
                            title="Filter to phenotypes from High-throughput studies (deletion collection, screens)"
                          >
                            <span>⚡ High-Throughput</span>
                            <span className={`text-[10px] px-1 rounded-full font-bold ${phenotypeStudyFilter === 'high-throughput' ? 'bg-white/30 text-white' : 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-300'}`}>{htCount}</span>
                          </button>
                        </div>
                      </div>

                      {/* Phenotype Buttons */}
                      <div className="flex flex-wrap gap-2">
                        {displayedPhenotypes.length > 0 ? displayedPhenotypes.map((p, i) => {
                          const isClassic = p.studyType === 'classic' || (!p.hasHighThroughput && p.hasClassic);
                          const isHt = p.studyType === 'high-throughput' || (!p.hasClassic && p.hasHighThroughput);
                          const isBoth = p.studyType === 'both' || (p.hasClassic && p.hasHighThroughput);

                          return (
                            <button 
                                key={i} 
                                onClick={() => togglePhenotypeSelection(p.phenotype)}
                                title={`Study Origin: ${p.studyTypeLabel || (isBoth ? 'Both Classic & High-Throughput' : isClassic ? 'Classic Targeted' : 'High-Throughput')}${p.reference ? ` | Ref: ${p.reference}` : ''}`}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
                                    selectedPhenotype === p.phenotype 
                                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm' 
                                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-600 dark:hover:border-slate-500'
                                }`}
                            >
                              <span>{p.phenotype}</span>
                              {isBoth ? (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${selectedPhenotype === p.phenotype ? 'bg-teal-500 text-white' : 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-300'}`}>
                                  Classic & HT
                                </span>
                              ) : isClassic ? (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${selectedPhenotype === p.phenotype ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'}`}>
                                  Classic
                                </span>
                              ) : (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${selectedPhenotype === p.phenotype ? 'bg-sky-500 text-white' : 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-300'}`}>
                                  HT Screen
                                </span>
                              )}
                            </button>
                          );
                        }) : (
                          <span className="text-slate-500 text-xs italic">
                            No phenotypes match the "{phenotypeStudyFilter}" filter. <button type="button" onClick={() => setPhenotypeStudyFilter('all')} className="text-emerald-600 hover:underline font-semibold ml-1">Show all ({phenotypes.length})</button>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {phenotypes.length === 0 && (
                  <span className="text-slate-500 text-sm italic">
                    No specific phenotypes found. <a href={yeastSgdId ? `https://www.alliancegenome.org/gene/${yeastSgdId}` : `https://www.alliancegenome.org/`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">Check Alliance Genome</a>.
                  </span>
                )}

                {/* Active Selected Phenotype Reference Callout */}
                {selectedPhenotype && (() => {
                  const activePheno = phenotypes.find(p => p.phenotype === selectedPhenotype);
                  if (!activePheno) return null;

                  const isClassic = activePheno.studyType === 'classic' || (!activePheno.hasHighThroughput && activePheno.hasClassic);
                  const isHt = activePheno.studyType === 'high-throughput' || (!activePheno.hasClassic && activePheno.hasHighThroughput);
                  const isBoth = activePheno.studyType === 'both' || (activePheno.hasClassic && activePheno.hasHighThroughput);

                  return (
                    <div className="mt-4 p-4 bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-3 animate-fade-in text-xs shadow-sm">
                      {/* Top Header: Phenotype Name & Close Button */}
                      <div className="flex items-start justify-between gap-2 border-b border-emerald-200/70 dark:border-emerald-800/70 pb-2.5">
                        <div className="space-y-1">
                          <div className="font-semibold text-emerald-900 dark:text-emerald-100 flex items-center gap-1.5 flex-wrap">
                            <BookOpen className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span>Selected Phenotype:</span>
                            <span className="text-emerald-800 dark:text-emerald-200 font-bold text-sm">{activePheno.phenotype}</span>
                          </div>

                          {/* Study Origin Badge & Explanation */}
                          <div className="flex items-center gap-2 flex-wrap pt-0.5">
                            {isBoth ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200 border border-teal-300 dark:border-teal-700">
                                🔄 Both: Classic Genetic Targeted & High-Throughput Studies
                              </span>
                            ) : isClassic ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                                🏛️ Classic Genetic Targeted Study on Gene
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-900 dark:bg-sky-900/60 dark:text-sky-200 border border-sky-300 dark:border-sky-700">
                                ⚡ High-Throughput Study (e.g., Deletion Collection)
                              </span>
                            )}
                            <span className="text-[11px] text-slate-600 dark:text-slate-400 italic">
                              {activePheno.studyTypeDescription || (
                                isBoth
                                  ? 'Corroborated across both classic targeted gene studies and genome-wide high-throughput deletion screens.'
                                  : isClassic
                                  ? 'Discovered in a targeted, locus-specific study using dedicated mutant alleles or point mutations.'
                                  : 'Discovered in a systematic genome-wide survey (e.g., yeast knockout deletion collection, barcode profiling, or chemical genomics screen).'
                              )}
                            </span>
                          </div>
                        </div>
                        
                        <button
                          type="button"
                          onClick={() => setSelectedPhenotype(null)}
                          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors shrink-0"
                          title="Deselect phenotype"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Display All Studies / References */}
                      {activePheno.allReferences && activePheno.allReferences.length > 0 ? (
                        <div className="space-y-2">
                          <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                            Evidence & Citations ({activePheno.allReferences.length}):
                          </div>
                          <div className="grid gap-2">
                            {activePheno.allReferences.map((refItem, rIdx) => {
                              const isRefClassic = refItem.studyType === 'classic';
                              const refKey = `ref-${rIdx}-${refItem.pubmed_id || refItem.citation}`;
                              const isThisCopied = copiedRefKey === refKey;

                              return (
                                <div 
                                  key={rIdx}
                                  className="p-2.5 bg-white/95 dark:bg-slate-900/90 rounded-lg border border-emerald-200/80 dark:border-emerald-800/60 space-y-1.5 shadow-xs"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2 flex-wrap text-[11px]">
                                        <span className={`px-2 py-0.5 rounded font-bold ${
                                          isRefClassic 
                                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' 
                                            : 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300'
                                        }`}>
                                          {isRefClassic ? '🏛️ Classic Targeted Study' : '⚡ High-Throughput Screen'}
                                        </span>
                                        {refItem.allele && refItem.allele !== 'N/A' && refItem.allele !== 'Unknown' && (
                                          <span className="font-mono text-emerald-800 dark:text-emerald-300 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/50">
                                            Allele: {refItem.allele}
                                          </span>
                                        )}
                                        {refItem.experimentType && (
                                          <span className="text-slate-500 dark:text-slate-400">
                                            ({refItem.experimentType})
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-slate-800 dark:text-slate-200 font-medium select-all leading-relaxed text-xs">
                                        {refItem.citation}
                                      </p>
                                      {refItem.condition && (
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                                          Condition / Details: {refItem.condition}
                                        </p>
                                      )}
                                    </div>

                                    {/* Action buttons for this specific reference */}
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {refItem.pubmed_id ? (
                                        <a
                                          href={`https://pubmed.ncbi.nlm.nih.gov/${refItem.pubmed_id}/`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-semibold text-[11px] shadow-xs transition-all"
                                          title={`View paper on PubMed (PMID: ${refItem.pubmed_id}) in new tab`}
                                        >
                                          <ExternalLink className="w-3 h-3" />
                                          <span>PubMed ({refItem.pubmed_id})</span>
                                        </a>
                                      ) : (
                                        <a
                                          href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(refItem.citation)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-semibold text-[11px] shadow-xs transition-all"
                                          title="Search citation on PubMed in new tab"
                                        >
                                          <ExternalLink className="w-3 h-3" />
                                          <span>PubMed</span>
                                        </a>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => {
                                          copyToClipboard(refItem.citation);
                                          setCopiedRefKey(refKey);
                                          setTimeout(() => setCopiedRefKey(null), 2000);
                                        }}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-100 dark:hover:bg-slate-700 text-emerald-800 dark:text-emerald-300 rounded-md font-medium text-[11px] border border-emerald-200 dark:border-emerald-800 transition-all shadow-xs"
                                        title="Copy reference citation to clipboard"
                                      >
                                        {isThisCopied ? (
                                          <>
                                            <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                            <span className="font-bold text-emerald-700 dark:text-emerald-300">Copied!</span>
                                          </>
                                        ) : (
                                          <>
                                            <Copy className="w-3 h-3" />
                                            <span>Copy</span>
                                          </>
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        /* Single reference fallback if allReferences is empty */
                        <div className="p-3 bg-white/95 dark:bg-slate-900/90 rounded-lg border border-emerald-200/80 dark:border-emerald-800/60 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap text-[11px]">
                            {activePheno.mutant_type && activePheno.mutant_type !== 'Unknown' && (
                              <span className="font-mono text-emerald-800 dark:text-emerald-300 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/50">
                                Allele: {activePheno.mutant_type}
                              </span>
                            )}
                            {activePheno.category && activePheno.category !== 'Unknown' && (
                              <span className="text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                {activePheno.category}
                              </span>
                            )}
                            {activePheno.note && (
                              <span className="text-slate-500 dark:text-slate-400 italic">
                                Condition: {activePheno.note}
                              </span>
                            )}
                          </div>

                          {activePheno.reference ? (
                            <p className="text-slate-800 dark:text-slate-200 font-medium select-all leading-relaxed">
                              {activePheno.reference}
                            </p>
                          ) : (
                            <p className="text-slate-500 dark:text-slate-400 italic">
                              Reference citation not specified in annotation.
                            </p>
                          )}

                          {activePheno.reference && (
                            <div className="flex items-center gap-2 pt-1">
                              {activePheno.pubmed_id ? (
                                <a
                                  href={`https://pubmed.ncbi.nlm.nih.gov/${activePheno.pubmed_id}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs shadow-sm transition-all"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  View on PubMed (PMID: {activePheno.pubmed_id})
                                </a>
                              ) : (
                                <a
                                  href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(activePheno.reference)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs shadow-sm transition-all"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  Search on PubMed
                                </a>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  copyToClipboard(activePheno.reference || '');
                                  setCopiedRef(true);
                                  setTimeout(() => setCopiedRef(false), 2000);
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-slate-700 text-emerald-700 dark:text-emerald-300 rounded-lg font-medium text-xs border border-emerald-300 dark:border-emerald-700 transition-all shadow-sm"
                                title="Copy reference citation to clipboard"
                              >
                                {copiedRef ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    <span className="font-semibold text-emerald-700 dark:text-emerald-300">Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copy Reference</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              {/* CRISPR Oligo Design Card */}
              {selectedVariantIndices.length > 0 && (
                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/40 dark:to-teal-900/40 rounded-xl border border-emerald-200 dark:border-emerald-800 shadow-sm p-6 animate-fade-in relative overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <FlaskConical className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            <h3 className="font-bold text-emerald-900 dark:text-emerald-100">
                               CRISPR Oligo Design {settings.crispr.cloningType === 'NoClo' ? '(for NoClo)' : <>(for <a href="https://www.addgene.org/67638/" target="_blank" rel="noopener noreferrer" className="underline hover:text-emerald-700 dark:hover:text-emerald-300">pML104</a>)</>}
                            </h3>
                        </div>
                        <div className="flex items-center gap-2">
                            {selectedVariantIndices.length > 1 && crisprResults.length > 0 && (
                                <button 
                                    onClick={handleExportOligosCSV}
                                    className="flex items-center gap-1 px-2 py-1 text-s font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-400 bg-white/50 dark:bg-slate-800/50 rounded border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800 transition-all"
                                    title="Export Oligos as CSV"
                                >
                                    <Download className="w-3 h-3" />
                                    Export CSV
                                </button>
                            )}
                            {crisprResults.length > 0 && (
                                <button 
                                    onClick={handleResetCrispr}
                                    className="flex items-center gap-1 px-2 py-1 text-s font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-400 bg-white/50 dark:bg-slate-800/50 rounded border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800 transition-all"
                                    title="Reset Parameters"
                                >
                                    <RefreshCw className="w-3 h-3" />
                                    Reset
                                </button>
                            )}
                        </div>
                    </div>

                    {!isGeneratingCrispr && crisprResults.length === 0 && (
                        <div className="space-y-4">
                            <p className="text-xs text-emerald-800 dark:text-emerald-100 leading-relaxed font-medium">
                                Create repair templates to introduce mutations for <strong>{selectedVariantIndices.length}</strong> selected variant(s) in <strong>{ortholog.symbol}</strong>.
                            </p>
                            
                            {/* Repair Template Length Input */}
                            <div className="bg-white/60 dark:bg-slate-900/50 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 space-y-2">
                                <label className="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Template Length (bp)</label>
                                <input 
                                    type="number" 
                                    value={repairLength}
                                    onChange={(e) => setSettings({...settings, crispr: {...settings.crispr, repairTemplateLength: parseInt(e.target.value)}})}
                                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 rounded-lg text-emerald-900 dark:text-emerald-100 font-bold text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 italic">Standard 60-100bp. Try increasing value by 5-10 if no output occurs (also check status terminal updates). </p>
                            </div>

                            <div className="bg-white/60 dark:bg-slate-900/50 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 space-y-2">
                                <label className="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Cloning Type</label>
                                <select 
                                    value={settings.crispr.cloningType || 'pML104'}
                                    onChange={(e) => setSettings({...settings, crispr: {...settings.crispr, cloningType: e.target.value as 'pML104' | 'NoClo'}})}
                                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 rounded-lg text-emerald-900 dark:text-emerald-100 font-bold text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                >
                                    <option value="pML104">pML104 (Default)</option>
                                    <option value="NoClo">NoClo</option>
                                </select>
                            </div>

                            {settings.crispr.cloningType === 'NoClo' && (
                                <div className="bg-white/60 dark:bg-slate-900/50 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">NoClo Homology Length (bp)</label>
                                        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-700">
                                            {settings.crispr.nocloHomologyLength ?? 100}bp
                                        </span>
                                    </div>
                                    <input 
                                        type="range"
                                        min="20"
                                        max="100"
                                        step="1"
                                        value={settings.crispr.nocloHomologyLength ?? 100}
                                        onChange={(e) => setSettings({...settings, crispr: {...settings.crispr, nocloHomologyLength: parseInt(e.target.value)}})}
                                        className="w-full accent-emerald-600 dark:accent-emerald-400"
                                    />
                                    <div className="flex justify-between text-xs text-emerald-700 dark:text-emerald-300">
                                        <span>20bp</span>
                                        <span className="font-bold">{settings.crispr.nocloHomologyLength ?? 100}bp (Default: 100bp)</span>
                                        <span>100bp</span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                                        Homology arms up to 100bp flanking both ends (5' & 3') of the sgRNA targeting sequence for direct in vivo gap repair.
                                    </p>

                                    {/* Integrated Repair Template Option */}
                                    <div className="pt-2 border-t border-emerald-200 dark:border-emerald-800/60">
                                        <label className="flex items-start gap-2.5 cursor-pointer">
                                            <input 
                                                type="checkbox"
                                                checked={Boolean(settings.crispr.nocloIntegratedRepair)}
                                                onChange={(e) => setSettings({
                                                    ...settings, 
                                                    crispr: { ...settings.crispr, nocloIntegratedRepair: e.target.checked }
                                                })}
                                                className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                            />
                                            <div>
                                                <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-200 block">
                                                    Integrate Repair Template onto Same Sequence
                                                </span>
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5 leading-snug">
                                                    Generates a single All-in-One ~475nt sequence: 100bp upstream homology + 100bp repair template + 155bp RNApr + 20bp sgRNA + 100bp downstream homology
                                                </span>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            )}

                            <div className="bg-white/60 dark:bg-slate-900/50 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 space-y-2">
                                <label className="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">PCR Product Target Size (bp)</label>
                                <input 
                                    type="range"
                                    min="250"
                                    max="1000"
                                    step="50"
                                    value={settings.crispr.targetPrimerProdSize || 500}
                                    onChange={(e) => setSettings({...settings, crispr: {...settings.crispr, targetPrimerProdSize: parseInt(e.target.value)}})}
                                    className="w-full accent-emerald-600 dark:accent-emerald-400"
                                />
                                <div className="flex justify-between text-xs text-emerald-700 dark:text-emerald-300">
                                    <span>250bp</span>
                                    <span className="font-bold">{settings.crispr.targetPrimerProdSize || 500}bp</span>
                                    <span>1000bp</span>
                                </div>
                                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 italic">Auto-adjusts bounds if ideal primers aren't found precisely.</p>
                            </div>

                            {!isYeastOnlyMode && (
                                <div className="mt-4 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id="includeControls"
                                            checked={includeControls}
                                            onChange={(e) => setIncludeControls(e.target.checked)}
                                            className="w-4 h-4 text-emerald-600 bg-white dark:bg-slate-800 border-emerald-300 dark:border-emerald-700 rounded focus:ring-emerald-500"
                                        />
                                        <label htmlFor="includeControls" className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                                            Include Benign/Pathogenic Controls
                                        </label>
                                    </div>
                                    {includeControls && selectedVariantIndices.length > 1 && (
                                        <div className="flex gap-4 ml-6 items-center flex-wrap">
                                            <div className="flex items-center gap-2">
                                                <label className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">Benign Amount:</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="9"
                                                    value={numBenignControls}
                                                    onChange={(e) => setNumBenignControls(parseInt(e.target.value) || 0)}
                                                    className="w-16 px-2 py-1 bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 rounded text-sm text-emerald-900 dark:text-emerald-100"
                                                />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <label className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">Pathogenic Amount:</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="9"
                                                    value={numPathogenicControls}
                                                    onChange={(e) => setNumPathogenicControls(parseInt(e.target.value) || 0)}
                                                    className="w-16 px-2 py-1 bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 rounded text-sm text-emerald-900 dark:text-emerald-100"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <button 
                                onClick={handleGenerateCrispr}
                                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-black shadow-lg hover:shadow-emerald-900 transition-all flex items-center justify-center gap-2 text-sm"
                            >
                                <Zap className="w-4 h-4" />
                                Generate Design
                            </button>
                        </div>
                    )}

                    {isGeneratingCrispr && (
                        <div className="flex flex-col items-center justify-center py-12 text-emerald-600 dark:text-emerald-400">
                             <Dna className="w-8 h-8 animate-spin mb-3" />
                             <span className="text-xs font-black uppercase tracking-widest">Designing Oligonucleotides...</span>
                        </div>
                    )}

                    {!isGeneratingCrispr && crisprGroups.map((group) => {
                        const localIndex = selectedCrisprIndicesObj[group.variantKey] || 0;
                        const currentGroupCrispr = group.results[localIndex];
                        if (!currentGroupCrispr) return null;
                        
                        return (
                            <div key={group.variantKey} className="mt-8 border-t border-emerald-100 dark:border-emerald-800/30 pt-8 first:mt-2 first:pt-4 first:border-0">
                                <div className="flex items-center justify-between mb-6">
                                     <h4 className="font-bold text-sm text-emerald-800 dark:text-emerald-200">
                                         Results for {group.variantKey}
                                     </h4>
                                     {group.results.length > 1 && (
                                         <div className="flex items-center gap-2 bg-yellow-50 dark:bg-yellow-900/50 rounded-lg p-1 border border-amber-200 dark:border-teal-800/50">
                                            <button 
                                                onClick={() => setSelectedCrisprIndicesObj(prev => ({...prev, [group.variantKey]: localIndex > 0 ? localIndex - 1 : group.results.length - 1}))}
                                                className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-800/50 rounded text-emerald-600 dark:text-emerald-400 transition-colors"
                                            >
                                                <ChevronLeft className="w-4 h-4" />
                                            </button>
                                            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-100 min-w-[80px] text-center">
                                                Design {localIndex + 1} of {group.results.length}
                                            </span>
                                            <button 
                                                onClick={() => setSelectedCrisprIndicesObj(prev => ({...prev, [group.variantKey]: localIndex < group.results.length - 1 ? localIndex + 1 : 0}))}
                                                className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-800/50 rounded text-emerald-600 dark:text-emerald-400 transition-colors"
                                            >
                                                <ChevronRight className="w-4 h-4" />
                                            </button>
                                        </div>
                                     )}
                                </div>
                                {renderCrisprResult(currentGroupCrispr)}
                            </div>
                        );
                    })}

                    {/* Control CRISPR Results */}
                    {includeControls && !isGeneratingCrispr && crisprResults.length > 0 && (
                        <div className="mt-8 space-y-6 border-t border-emerald-200 dark:border-emerald-800 pt-6">
                            <h3 className="text-lg font-bold text-emerald-800 dark:text-emerald-200">Control Variants</h3>
                            
                            {controlCrisprResults.benign && controlCrisprResults.benign.length > 0 ? (
                                controlCrisprResults.benign.map((control, idx) => (
                                    <div key={`benign-${idx}`} className="bg-white/40 dark:bg-slate-900/40 rounded-xl border border-emerald-200 dark:border-emerald-800 p-4">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="px-2 py-1 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-bold rounded uppercase">
                                                Benign Control {controlCrisprResults.benign.length > 1 ? `#${idx + 1}` : ''}
                                            </div>
                                            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                                <a 
                                                    href={`https://www.ncbi.nlm.nih.gov/clinvar/${control.variant.clinVarId}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-emerald-600 dark:text-emerald-400 hover:underline"
                                                >
                                                    {control.variant.clinVarId}
                                                </a> ({control.variant.proteinChange})
                                            </div>
                                        </div>
                                        {renderCrisprResult(control.results[0], true)}
                                    </div>
                                ))
                            ) : (
                                <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-sm text-slate-500 dark:text-slate-400">
                                    No benign or likely benign conserved missense variants were found in ClinVar for this gene.
                                </div>
                            )}

                            {controlCrisprResults.pathogenic && controlCrisprResults.pathogenic.length > 0 ? (
                                controlCrisprResults.pathogenic.map((control, idx) => (
                                    <div key={`pathogenic-${idx}`} className="bg-white/40 dark:bg-slate-900/40 rounded-xl border border-emerald-200 dark:border-emerald-800 p-4">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="px-2 py-1 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 text-xs font-bold rounded uppercase">
                                                Pathogenic Control {controlCrisprResults.pathogenic.length > 1 ? `#${idx + 1}` : ''}
                                            </div>
                                            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                                <a 
                                                    href={`https://www.ncbi.nlm.nih.gov/clinvar/${control.variant.clinVarId}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-emerald-600 dark:text-emerald-400 hover:underline"
                                                >
                                                    {control.variant.clinVarId}
                                                </a> ({control.variant.proteinChange})
                                            </div>
                                        </div>
                                        {renderCrisprResult(control.results[0], true)}
                                    </div>
                                ))
                            ) : (
                                <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-sm text-slate-500 dark:text-slate-400">
                                    No pathogenic or likely pathogenic conserved missense variants were found in ClinVar for this gene.
                                </div>
                            )}
                        </div>
                    )}
                </div>
              )}

              {/* AI Report Card */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-bold text-slate-800 dark:text-slate-100">AI Experimental Plan</h3>
                </div>
                
                {!aiPlan && !isGeneratingAI && (
                    <div className="text-center py-8">
                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                            Use Gemini to analyze the gene function, variant, phenotypes, and other available info to propose a functional assay.
                        </p>
                        <button 
                            onClick={handleGeneratePlan}
                            className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-6 py-2 rounded-lg font-medium shadow-sm transition-all flex items-center gap-2 mx-auto"
                        >
                            <Sparkles className="w-4 h-4" />
                            Generate AI-assisted Experimental Plan
                        </button>
                    </div>
                )}

                {isGeneratingAI && !aiPlan && (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                    <Dna className="w-8 h-8 animate-spin text-emerald-500 mb-2" />
                    <span className="text-sm font-medium">Consulting Gemini. Be patient, this may take a few minutes...</span>
                  </div>
                )}

                {aiPlan && (
                  <div className="prose prose-sm prose-slate dark:prose-invert max-w-none prose-headings:font-bold prose-headings:text-slate-800 dark:prose-headings:text-slate-100 prose-p:text-slate-700 dark:prose-p:text-slate-300 prose-li:text-slate-700 dark:prose-li:text-slate-300 prose-hr:border-slate-300 dark:prose-hr:border-slate-700">
                    <ReactMarkdown 
                        components={{
                            hr: ({node, ...props}) => <hr className="border-t-2 border-slate-300 dark:border-slate-700 my-4" {...props} />
                        }}
                    >
                        {aiPlan}
                    </ReactMarkdown>
                    {isGeneratingAI && <span className="inline-block w-2 h-4 bg-emerald-500 animate-pulse ml-1 align-middle"/>}
                  </div>
                )}
              </div>
              
              {/* Print Button */}
              {aiPlan && !isGeneratingAI && (
                  <button 
                      onClick={() => window.print()}
                      className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium shadow-sm transition-all flex items-center justify-center gap-2 print:hidden"
                  >
                      <Printer className="w-4 h-4" />
                      Print Analysis Report
                  </button>
              )}

            </div>
          </div>
        )}
      </main>
      
    </div>
  );
};
