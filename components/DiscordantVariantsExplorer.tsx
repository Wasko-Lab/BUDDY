import React, { useState, useEffect, useMemo } from 'react';
import { 
  Scale, 
  Search, 
  AlertTriangle, 
  Zap, 
  Filter, 
  Download, 
  ExternalLink, 
  ChevronRight, 
  ChevronLeft, 
  RefreshCw, 
  Dna, 
  Star, 
  Check, 
  Copy, 
  Globe, 
  Sliders, 
  Info,
  ArrowUpDown,
  X,
  Users
} from 'lucide-react';
import { DiscordantVariant, DiscordantSearchResult } from '../types';
import { fetchDiscordantVariants, DiscordantQueryParams } from '../services/api';

interface DiscordantVariantsExplorerProps {
  onSelectGeneVariant?: (geneSymbol: string, hgvs?: string, variant?: DiscordantVariant) => void;
  isDarkMode?: boolean;
}

const PRESET_PANELS = [
  {
    name: "ACMG SF v3.2 (Actionable 81)",
    description: "81 medically actionable genes recommended for secondary findings reporting by ACMG",
    genes: "ACTA2, ACTC1, APC, APOB, ATP7B, BAG3, BMPR1A, BRCA1, BRCA2, BTD, CACNA1S, CALM1, CALM2, CALM3, CASQ2, COL3A1, DES, DSC2, DSG2, DSP, FBN1, FLNC, GAA, GLA, HFE, HNF1A, KCNH2, KCNQ1, LDLR, LMNA, MAX, MEN1, MLH1, MSH2, MSH6, MUTYH, MYBPC3, MYH11, MYH7, MYL2, MYL3, NF2, OTC, PALB2, PCSK9, PKP2, PMS2, PRKAG2, PTEN, RB1, RBM20, RET, RPE65, RYR1, RYR2, SCN5A, SDHA, SDHAF2, SDHB, SDHC, SDHD, SMAD3, SMAD4, STK11, TGFBR1, TGFBR2, TMEM127, TMEM43, TNNC1, TNNI3, TNNT2, TP53, TPM1, TRDN, TSC1, TSC2, TTN, TTR, VHL, WT1"
  },
  {
    name: "Understudied Kinases",
    description: "Understudied Kinases Associated with Rare Diseases",
    genes: "ADCK2, ADPGK, AK3, AK6, AK9, ALPK1, ALPK2, BCKDK, CAMKV, EPHA10, ETNK1, ETNK2, FGGY, FN3KRP, GALK2, GK5, GLYCTK, GUCY2F, IDNK, IP6K2, IP6K3, ITPK1, KSR2, LRRK1, MAP3K21, MAP3K4, MAST2, MAST4, MOS, MYO3A, NADK, NADK2, NEK11, NEK3, NIM1K, NME3, NME4, NME5, NME6, NMRK1, NRBP1, NRK, OXSR1, PAN3, PANK4, PDIK1L, PFKFB1, PHKA1, PI4K2A, PIP5K1B, PKDCC, POMK, PRKY, PRPS2, PSKH1, PSKH2, PSTK, RPS6KC1, RPS6KL1, RSKR, SCYL1, SCYL2, SCYL3, STK31, STK32C, STK36, STKLD1, TBCK, TEX14, TP53RK, TTBK1, TTBK2, UCKL1, ULK4, VRK2, VRK3, WNK2"
  },
  {
    name: "Understudied Rare Disease Enzymes",
    description: "Understudied Enzymes Associated with Rare Disease Panel",
    genes: "AADACL2, ABHD1, ABHD12B, ABHD14A, ABHD14B, ABHD15, ABHD16B, ABHD17B, ABHD17C, ABHD3, ABHD8, ACOXL, AKAP14, ALKBH6, ANAPC4, ANKRD44, ARHGAP23, ARHGAP28, ARHGAP40, ARL10, ARL16, ARL6, ARL9, ASNSD1, ASPHD1, ASPHD2, ATP5EP2, ATP6AP1L, ATP6V0E2, B3GNT4, C11orf54, C2orf88, CA5BP1, CARNMT1, CASP12, CBLC, CDADC1, CERCAM, CES1P1, CHSY3, CMAHP, CNEP1R1, COA1, CYB5RL, DCAKD, DDX31, DDX3Y, DDX51, DDX55, DDX60L, DHRS1, DHRS13, DHRS7B, DHRS7C, DHRSX, DHX57, DMAC2, DPY19L2P1, DPY19L2P2, DPY19L3, DPY19L4, ECHDC2, ECHDC3, EEF1AKMT3, ELFN2, ENDOD1, EPS8L2, ETFBKMT, FAHD2A, FASTKD1, FASTKD3, FAXDC2, FBLL1, FOLH1B, FOXRED2, GAL3ST3, GAL3ST4, GALNT16, GARNL3, GATC, GBA3, GFOD1, GFOD2, GGACT, GGTA1P, GKAP1, GLB1L2, GLB1L3, GLT1D1, GLT8D2, GSTT1, GUCA1C, GUSBP1, GVINP1, GXYLT1, GXYLT2, HACD4, HDHD2, HDHD3, HECTD2, HECTD3, HS3ST6, IRGQ, ISG20L2, JAKMIP2, JAKMIP3, KAZALD1, KIAA1191, L3HYPDH, LONRF1, LONRF2, LONRF3, MANEAL, MBLAC1, MBLAC2, MDH1B, METTL17, METTL21A, METTL22, METTL25, MOB3A, MOB3B, MOB3C, MPPED1, MTHFSD, MYRFL, NAA16, NAA38, NAT16, NAT8B, NKAIN1, NKAIN4, NLGN4Y, NT5DC1, NYAP1, NYAP2, OAZ2, OGFOD3, OVCH1, OVCH2, OXLD1, PCED1A, PCED1B, PCMTD2, PCYOX1L, PGGHG, PHACTR2, PHYHIP, PHYHIPL, PINLYP, PIP4P2, PLA2G4F, PLBD1, PLPP7, PLPPR1, PLPPR2, PM20D2, PMS2P3, POP1, PPIL4, PPIL6, PPP1R16A, PPP1R21, PPP1R35, PPP1R36, PPP1R37, PPP1R3D, PPP1R3E, PPP4R4, PPP5D1, PRORSD1P, PRSS33, PRXL2B, PTAR1, PTPDC1, PTPN20, PUS7L, PUSL1, RAB9B, RALGAPB, RASL10B, RERGL, RFNG, RIMKLA, RNF130, RNF149, RNF182, RPUSD2, RPUSD3, RPUSD4, SAP130, SCRN2, SDR42E1, SPATA5L1, SPHKAP, SPINT3, SRGAP2B, SYDE2, TAF1D, TATDN3, TCAF1, TDH, THNSL1, TIMM10B, TMEM129, TMPRSS11B, TPGS2, TPTE2P1, TREX1, TRIML2, TRMT2B, TRMT44, TRUB2, TSTD1, TSTD2, TTLL11, UGGT2, UGT3A1, UGT3A2, UNKL, USP31, USP54, USP9Y, VAT1L, VCPKMT, VMA21, ZDHHC18, ZDHHC22"
  },
  {
    name: "Cancer Predisposition Panel",
    description: "High-penetrance hereditary cancer risk genes",
    genes: "TP53, BRCA1, BRCA2, PTEN, MLH1, MSH2, MSH6, PMS2, APC, RB1, VHL, WT1, MEN1, RET, PALB2, ATM, CHEK2, CDH1, NF1, STK11"
  }
];

export const DiscordantVariantsExplorer: React.FC<DiscordantVariantsExplorerProps> = ({
  onSelectGeneVariant
}) => {
  // Input states
  const [genesInput, setGenesInput] = useState<string>("ACTA1, MYH7, TP53, LDLR, BRCA1, PTEN, SCN5A, KCNQ1");
  const [isAllGenesMode, setIsAllGenesMode] = useState<boolean>(true);
  
  // Filter states
  const [discordanceType, setDiscordanceType] = useState<'ALL' | 'BENIGN_AM_PATHOGENIC' | 'PATHOGENIC_AM_BENIGN' | 'RECURRENT_BENIGN'>('ALL');
  const [minStars, setMinStars] = useState<number>(0);
  const [minSubmissions, setMinSubmissions] = useState<number>(0);
  const [gnomadFilter, setGnomadFilter] = useState<'ALL' | 'COMMON' | 'LOW_FREQUENCY' | 'RARE' | 'ULTRA_RARE'>('ALL');
  const [onlyYeastHomologs, setOnlyYeastHomologs] = useState<boolean>(true);
  const [minDioptScore, setMinDioptScore] = useState<number>(5);
  const [minVariantsPerGene, setMinVariantsPerGene] = useState<number>(0);
  const [includePathogenic, setIncludePathogenic] = useState<boolean>(true);
  const [includeLikelyPathogenic, setIncludeLikelyPathogenic] = useState<boolean>(true);
  const [includeBenign, setIncludeBenign] = useState<boolean>(true);
  const [includeLikelyBenign, setIncludeLikelyBenign] = useState<boolean>(true);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'delta_desc' | 'gene_asc' | 'score_desc' | 'stars_desc' | 'submissions_desc' | 'gnomad_desc' | 'gnomad_asc'>('delta_desc');
  
  // Cutoff thresholds
  const [minAmPathScore, setMinAmPathScore] = useState<number>(0.56);
  const [maxAmBenignScore, setMaxAmBenignScore] = useState<number>(0.34);
  const [showAdvancedCutoffs, setShowAdvancedCutoffs] = useState<boolean>(false);

  // Pagination states
  const [page, setPage] = useState<number>(1);
  const pageSize = 50;

  // Data states
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<DiscordantSearchResult | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Perform Search
  const executeSearch = async (targetPage: number = 1) => {
    // Automatically remove leading and trailing spaces
    const cleanGenes = genesInput.trim();
    if (cleanGenes !== genesInput) setGenesInput(cleanGenes);
    const cleanFilter = searchFilter.trim();
    if (cleanFilter !== searchFilter) setSearchFilter(cleanFilter);

    setLoading(true);
    setError(null);
    try {
      const params: DiscordantQueryParams = {
        genes: isAllGenesMode ? 'ALL' : cleanGenes,
        type: discordanceType,
        minStars,
        minSubmissions,
        gnomadFilter,
        onlyYeastHomologs: onlyYeastHomologs || minDioptScore > 0,
        minDioptScore,
        minVariantsPerGene,
        includePathogenic,
        includeLikelyPathogenic,
        includeBenign,
        includeLikelyBenign,
        searchQuery: cleanFilter,
        page: targetPage,
        pageSize,
        sort: sortBy,
        minAmPathScore,
        maxAmBenignScore
      };

      const res = await fetchDiscordantVariants(params);
      setSearchResult(res);
      setPage(targetPage);
    } catch (err: any) {
      console.error("Failed to fetch discordant variants:", err);
      setError(err.message || "Failed to query discordant variants");
    } finally {
      setLoading(false);
    }
  };

  // Run initial search once on mount
  useEffect(() => {
    executeSearch(1);
  }, []);

  // Filtered results in client for search query, diopt score, cutoffs, and significance tiers
  const displayedVariants = useMemo(() => {
    if (!searchResult?.variants) return [];
    let list = searchResult.variants;

    // Discordance direction filter
    if (discordanceType !== 'ALL') {
      list = list.filter(v => v.discordanceType === discordanceType);
    }

    // Stars filter
    if (minStars > 0) {
      list = list.filter(v => v.clinVarStars >= minStars);
    }

    // Yeast homolog and DIOPT score filter
    if (onlyYeastHomologs || minDioptScore > 0) {
      list = list.filter(v => !!v.yeastOrtholog && (minDioptScore === 0 || (v.yeastOrtholog.dioptScore ?? 0) >= minDioptScore));
    }

    // Sub-tier significance filter
    list = list.filter(v => {
      const sig = v.clinVarSignificance.toLowerCase();
      const isExact = !sig.includes('likely');
      const isLikely = sig.includes('likely');
      if (v.discordanceType === 'BENIGN_AM_PATHOGENIC') {
        if (isExact && !includeBenign) return false;
        if (isLikely && !includeLikelyBenign) return false;
      }
      if (v.discordanceType === 'PATHOGENIC_AM_BENIGN') {
        if (isExact && !includePathogenic) return false;
        if (isLikely && !includeLikelyPathogenic) return false;
      }
      return true;
    });

    // Score cutoffs
    list = list.filter(v => {
      if (v.discordanceType === 'BENIGN_AM_PATHOGENIC') {
        return v.amScore >= minAmPathScore;
      }
      if (v.discordanceType === 'PATHOGENIC_AM_BENIGN') {
        return v.amScore <= maxAmBenignScore;
      }
      return true;
    });

    // Gene-level variant frequency filter: only show genes with > minVariantsPerGene variants
    if (minVariantsPerGene > 0) {
      const counts = new Map<string, number>();
      for (const v of list) {
        counts.set(v.gene, (counts.get(v.gene) || 0) + 1);
      }
      list = list.filter(v => {
        const geneCount = (typeof v.geneVariantCount === 'number' && v.geneVariantCount > 0)
          ? v.geneVariantCount
          : (counts.get(v.gene) || 0);
        return geneCount > minVariantsPerGene;
      });
    }

    // Submissions filter
    if (minSubmissions > 0) {
      list = list.filter(v => (v.clinVarSubmissions || 0) >= minSubmissions);
    }

    // gnomAD frequency filter
    if (gnomadFilter !== 'ALL') {
      list = list.filter(v => {
        if (gnomadFilter === 'COMMON') return v.gnomadAf !== null && v.gnomadAf !== undefined && v.gnomadAf >= 0.01;
        if (gnomadFilter === 'LOW_FREQUENCY') return v.gnomadAf !== null && v.gnomadAf !== undefined && v.gnomadAf >= 0.001;
        if (gnomadFilter === 'RARE') return v.gnomadAf !== null && v.gnomadAf !== undefined && v.gnomadAf > 0 && v.gnomadAf < 0.001;
        if (gnomadFilter === 'ULTRA_RARE') return v.gnomadAf === null || v.gnomadAf === undefined || v.gnomadAf === 0;
        return true;
      });
    }

    // Text search filter
    if (searchFilter.trim()) {
      const q = searchFilter.trim().toLowerCase();
      list = list.filter(v => 
        v.gene.toLowerCase().includes(q) ||
        v.hgvsProtein.toLowerCase().includes(q) ||
        v.diseaseOrCondition.toLowerCase().includes(q) ||
        v.yeastOrtholog?.symbol.toLowerCase().includes(q) ||
        v.clinVarSignificance.toLowerCase().includes(q)
      );
    }

    // Sorting
    list = [...list].sort((a, b) => {
      if (sortBy === 'delta_desc') return b.discordanceDelta - a.discordanceDelta;
      if (sortBy === 'gene_asc') return a.gene.localeCompare(b.gene);
      if (sortBy === 'score_desc') return b.amScore - a.amScore;
      if (sortBy === 'stars_desc') return b.clinVarStars - a.clinVarStars;
      if (sortBy === 'submissions_desc') return (b.clinVarSubmissions || 0) - (a.clinVarSubmissions || 0);
      if (sortBy === 'gnomad_desc') return (b.gnomadAf ?? -1) - (a.gnomadAf ?? -1);
      if (sortBy === 'gnomad_asc') {
        if (a.gnomadAf === null && b.gnomadAf === null) return 0;
        if (a.gnomadAf === null) return -1;
        if (b.gnomadAf === null) return 1;
        return a.gnomadAf - b.gnomadAf;
      }
      return b.discordanceDelta - a.discordanceDelta;
    });

    return list;
  }, [
    searchResult, 
    discordanceType,
    minStars,
    minSubmissions,
    gnomadFilter,
    sortBy,
    onlyYeastHomologs,
    minDioptScore,
    minVariantsPerGene,
    includePathogenic, 
    includeLikelyPathogenic, 
    includeBenign, 
    includeLikelyBenign,
    minAmPathScore,
    maxAmBenignScore,
    searchFilter
  ]);

  // Real-time statistics dynamically reflecting the currently refined dataset
  const refinedSummaryStats = useMemo(() => {
    let benignAmPath = 0;
    let pathogenicAmBenign = 0;
    let recurrentBenign = 0;
    let highBackground = 0;
    let ultraRareOrAbsent = 0;
    const genes = new Set<string>();
    let yeastCount = 0;

    for (const v of displayedVariants) {
      if (v.discordanceType === 'BENIGN_AM_PATHOGENIC') benignAmPath++;
      if (v.discordanceType === 'PATHOGENIC_AM_BENIGN') pathogenicAmBenign++;
      if (v.discordanceType === 'RECURRENT_BENIGN') recurrentBenign++;
      if (v.gnomadAf !== null && v.gnomadAf !== undefined && v.gnomadAf >= 0.001) highBackground++;
      if (v.gnomadAf === null || v.gnomadAf === undefined || v.gnomadAf === 0) ultraRareOrAbsent++;
      if (v.gene) genes.add(v.gene);
      if (v.yeastOrtholog && (minDioptScore === 0 || (v.yeastOrtholog.dioptScore ?? 0) >= minDioptScore)) {
        yeastCount++;
      }
    }

    return {
      total: displayedVariants.length,
      benignAmPath,
      pathogenicAmBenign,
      recurrentBenign,
      highBackground,
      ultraRareOrAbsent,
      genesCount: genes.size,
      yeastCount
    };
  }, [displayedVariants, minDioptScore]);

  // Count of discordant variants per gene for badge display
  const geneVariantCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of displayedVariants) {
      const authoritative = (typeof v.geneVariantCount === 'number' && v.geneVariantCount > 0) ? v.geneVariantCount : 0;
      const current = counts.get(v.gene) || 0;
      counts.set(v.gene, Math.max(authoritative, current + 1));
    }
    return counts;
  }, [displayedVariants]);

  // Reset pagination page to 1 whenever any filtering criteria changes
  useEffect(() => {
    setPage(1);
  }, [
    discordanceType,
    minStars,
    minSubmissions,
    gnomadFilter,
    sortBy,
    onlyYeastHomologs,
    minDioptScore,
    minVariantsPerGene,
    includePathogenic,
    includeLikelyPathogenic,
    includeBenign,
    includeLikelyBenign,
    minAmPathScore,
    maxAmBenignScore,
    searchFilter,
    genesInput,
    isAllGenesMode
  ]);

  // Derived pagination based on the currently refined displayedVariants
  const totalDisplayed = displayedVariants.length;
  const totalPages = Math.max(1, Math.ceil(totalDisplayed / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = totalDisplayed === 0 ? 0 : (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalDisplayed);
  const paginatedVariants = useMemo(() => {
    return displayedVariants.slice(startIndex, endIndex);
  }, [displayedVariants, startIndex, endIndex]);

  // Export handlers
  const handleExportCSV = () => {
    if (!displayedVariants || displayedVariants.length === 0) return;
    const headers = [
      "Gene",
      "HGVS_Protein",
      "ClinVar_Significance",
      "ClinVar_Stars",
      "ClinVar_Review_Status",
      "ClinVar_Submissions",
      "AlphaMissense_Score",
      "AlphaMissense_Class",
      "Discordance_Type",
      "Discordance_Delta",
      "gnomAD_AF",
      "gnomAD_Category",
      "ClinVar_Condition",
      "Yeast_Homolog",
      "DIOPT_Score",
      "ClinVar_Variant_ID"
    ];

    const rows = displayedVariants.map(v => [
      `"${v.gene}"`,
      `"${v.hgvsProtein}"`,
      `"${v.clinVarSignificance}"`,
      v.clinVarStars,
      `"${v.clinVarReviewStatus.replace(/"/g, '""')}"`,
      v.clinVarSubmissions || 1,
      v.amScore,
      `"${v.amClass}"`,
      `"${v.discordanceType}"`,
      v.discordanceDelta,
      v.gnomadAf !== null && v.gnomadAf !== undefined ? (v.gnomadAf * 100).toFixed(4) + '%' : 'Absent / <1e-5',
      `"${v.gnomadCategory || 'ULTRA_RARE'}"`,
      `"${v.diseaseOrCondition.replace(/"/g, '""')}"`,
      `"${v.yeastOrtholog?.symbol || 'None'}"`,
      v.yeastOrtholog?.dioptScore || 0,
      v.clinVarVariantId || ''
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `discordant_variants_${isAllGenesMode ? 'all_genes' : 'panel'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyRowJson = (variant: DiscordantVariant) => {
    navigator.clipboard.writeText(JSON.stringify(variant, null, 2));
    setCopiedId(variant.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Scientific Orientation Banner */}
      <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                ClinVar ⇄ AlphaMissense Discordant Variant Explorer
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 max-w-4xl leading-relaxed">
              Pinpoint variants where diagnostic clinical curation in ClinVar clashes sharply with structural AI pathogenicity predictions from AlphaMissense (Cheng et al., <em>Science</em> 2023). Identify potential disease-misclassifications, incomplete penetrance, structural tolerance, or non-structural pathogenic mechanisms across multi-gene panels or the entire human genome.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start shrink-0">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Genome-Wide Dataset:
            </span>
            <span className="text-xs font-mono font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-800">
              {searchResult?.rawTotalEstimate ? searchResult.rawTotalEstimate.toLocaleString() : "26,397"} Discordant
            </span>
          </div>
        </div>

        {/* Discordance Mechanism Clarification */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60">
            <div className="w-7 h-7 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <span className="font-bold text-slate-900 dark:text-white">Type 1: ClinVar Benign / AlphaMissense Pathogenic</span>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                Classified as <em>Benign / Likely Benign</em> in ClinVar, yet AlphaMissense score is ≥ {minAmPathScore} (Likely Pathogenic). Indicates possible misclassification, mild phenotype, or structural strain tolerated under normal physiological conditions.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60">
            <div className="w-7 h-7 rounded-md bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 border border-rose-200 dark:border-rose-800">
              <Zap className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <span className="font-bold text-slate-900 dark:text-white">Type 2: ClinVar Pathogenic / AlphaMissense Benign</span>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                Classified as <em>Pathogenic / Likely Pathogenic</em> in ClinVar, yet AlphaMissense score is ≤ {maxAmBenignScore} (Likely Benign). Indicates structural tolerance with functional defect (e.g. active site catalytic disruption, regulatory binding, or gain-of-function).
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Input Form & Gene Selector */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            Target Gene Scope
          </label>

          {/* Toggle between Multi-Gene and All Genes */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg text-xs font-medium">
            <button
              type="button"
              onClick={() => setIsAllGenesMode(false)}
              className={`px-3 py-1.5 rounded-md transition-all ${
                !isAllGenesMode 
                  ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 font-bold shadow-sm' 
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Gene List / Panel
            </button>
            <button
              type="button"
              onClick={() => setIsAllGenesMode(true)}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
                isAllGenesMode 
                  ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 font-bold shadow-sm' 
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Globe className="w-3 h-3" />
              All Genes (Whole Genome)
            </button>
          </div>
        </div>

        {/* Multi-Gene Input Area */}
        {!isAllGenesMode ? (
          <div className="space-y-3">
            <div className="relative">
              <textarea
                rows={3}
                value={genesInput}
                onChange={(e) => setGenesInput(e.target.value.toUpperCase())}
                placeholder="Enter gene symbols separated by comma, space, or newline (e.g. ACTA1, MYH7, TP53, BRCA1, LDLR, PTEN, SCN5A, KCNQ1)..."
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 font-mono text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
              />
            </div>

            {/* Preset Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Quick Panels:</span>
              {PRESET_PANELS.map((panel, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setGenesInput(panel.genes)}
                  title={panel.description}
                  className="px-2.5 py-1 text-xs rounded-md font-medium bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 transition-colors"
                >
                  {panel.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setGenesInput("")}
                className="px-2 py-1 text-xs rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline ml-auto"
              >
                Clear
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/60 flex items-start gap-3">
            <Globe className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold text-amber-900 dark:text-amber-200">
                Whole-Genome Mode Enabled ({searchResult?.rawTotalEstimate ? searchResult.rawTotalEstimate.toLocaleString() : "26,397"} Discordant Variants)
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                Querying ClinVar ⇄ AlphaMissense discordant entries across all human genes (15,258 Benign ⇄ AM Pathogenic; 11,139 Pathogenic ⇄ AM Benign). Defaulting to high yeast orthology (DIOPT ≥ 5). You can filter by review stars, yeast conservation, and discordance direction below.
              </p>
            </div>
          </div>
        )}

        {/* Filter & Trigger Row */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-3">
            {/* Discordance Direction Selector */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg text-xs font-semibold">
              <button
                type="button"
                onClick={() => setDiscordanceType('ALL')}
                className={`px-3 py-1 rounded-md transition-all ${
                  discordanceType === 'ALL'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                All Discordant
              </button>
              <button
                type="button"
                onClick={() => setDiscordanceType('BENIGN_AM_PATHOGENIC')}
                className={`px-3 py-1 rounded-md transition-all flex items-center gap-1 ${
                  discordanceType === 'BENIGN_AM_PATHOGENIC'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                }`}
                title="ClinVar Benign / AlphaMissense Likely Pathogenic"
              >
                <AlertTriangle className="w-3 h-3" />
                Benign ⇄ AM Pathogenic
              </button>
              <button
                type="button"
                onClick={() => setDiscordanceType('PATHOGENIC_AM_BENIGN')}
                className={`px-3 py-1 rounded-md transition-all flex items-center gap-1 ${
                  discordanceType === 'PATHOGENIC_AM_BENIGN'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                }`}
                title="ClinVar Pathogenic / AlphaMissense Likely Benign"
              >
                <Zap className="w-3 h-3" />
                Pathogenic ⇄ AM Benign
              </button>
              <button
                type="button"
                onClick={() => {
                  setDiscordanceType('RECURRENT_BENIGN');
                  if (minSubmissions < 2) setMinSubmissions(2);
                }}
                className={`px-3 py-1 rounded-md transition-all flex items-center gap-1 ${
                  discordanceType === 'RECURRENT_BENIGN'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                }`}
                title="Search variants submitted multiple times for disease yet labeled Benign (cross-reference with gnomAD frequency)"
              >
                <Users className="w-3 h-3" />
                Recurrent Benign (Any AM)
              </button>
            </div>

            {/* Stars Selector */}
            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Stars:</span>
              <select
                value={minStars}
                onChange={(e) => setMinStars(parseInt(e.target.value, 10))}
                className="px-2 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded text-slate-800 dark:text-slate-200 text-xs font-semibold focus:ring-1 focus:ring-emerald-500"
              >
                <option value={0}>All Stars (0+★)</option>
                <option value={1}>1+ ⭐ (Single submitter+)</option>
                <option value={2}>2+ ⭐⭐ (Multiple submitters)</option>
                <option value={3}>3+ ⭐⭐⭐ (Expert panel / ClinGen)</option>
              </select>
            </div>

            {/* ClinVar Submissions Count Selector: Direct Number Input + Presets */}
            <div className="flex items-center gap-1 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-2 py-1" title="Filter by minimum number of independent disease submissions in ClinVar">
              <span className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                Submissions ≥
              </span>
              <input
                type="number"
                min="0"
                max="500"
                value={minSubmissions === 0 ? '' : minSubmissions}
                placeholder="1"
                onChange={(e) => {
                  const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                  setMinSubmissions(val);
                }}
                className="w-11 px-1 py-0.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white text-xs font-bold text-center focus:ring-1 focus:ring-blue-500"
                title="Type any number X to find variants submitted X or more times for a condition in ClinVar"
              />
              <select
                value={minSubmissions}
                onChange={(e) => setMinSubmissions(parseInt(e.target.value, 10))}
                className="px-1 py-0.5 bg-transparent border-0 text-slate-500 dark:text-slate-400 text-xs font-semibold focus:ring-0 cursor-pointer"
                title="Quick presets for submissions"
              >
                <option value={0}>Any</option>
                <option value={2}>≥ 2</option>
                <option value={3}>≥ 3</option>
                <option value={5}>≥ 5</option>
                <option value={10}>≥ 10</option>
                <option value={20}>≥ 20</option>
              </select>
              {minSubmissions > 0 && (
                <button
                  type="button"
                  onClick={() => setMinSubmissions(0)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-0.5"
                  title="Clear submissions filter"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* gnomAD Frequency Filter */}
            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap">gnomAD AF:</span>
              <select
                value={gnomadFilter}
                onChange={(e) => setGnomadFilter(e.target.value as any)}
                className="px-2 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded text-slate-800 dark:text-slate-200 text-xs font-semibold focus:ring-1 focus:ring-emerald-500"
                title="Filter variants by population allele frequency in gnomAD"
              >
                <option value="ALL">All Frequencies</option>
                <option value="ULTRA_RARE">Ultra-Rare / Absent (&lt;0.01% or Absent)</option>
                <option value="RARE">Rare (&lt;0.1%)</option>
                <option value="LOW_FREQUENCY">Low-Frequency (0.1% – 1%)</option>
                <option value="COMMON">Common (≥1% High Background)</option>
              </select>
            </div>

            {/* Only Yeast Homologs Toggle */}
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyYeastHomologs || minDioptScore > 0}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setOnlyYeastHomologs(checked);
                  if (!checked) setMinDioptScore(0);
                }}
                className="w-4 h-4 text-emerald-600 rounded border-slate-300 dark:border-slate-600 focus:ring-emerald-500 dark:bg-slate-900"
              />
              <span className="flex items-center gap-1">
                <Dna className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Only with Yeast Homolog
              </span>
            </label>

            {/* Min DIOPT Score Selector */}
            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Min DIOPT:</span>
              <select
                value={minDioptScore}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setMinDioptScore(val);
                  if (val > 0) setOnlyYeastHomologs(true);
                }}
                className="px-2 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded text-slate-800 dark:text-slate-200 text-xs font-semibold focus:ring-1 focus:ring-emerald-500"
                title="Filter variants by minimum DIOPT orthology score between Human and S. cerevisiae (scale 0-16)"
              >
                <option value={0}>Any Score (0+)</option>
                <option value={3}>≥ 3 (Moderate)</option>
                <option value={5}>≥ 5 (High - Default)</option>
                <option value={8}>≥ 8 (Strong)</option>
                <option value={10}>≥ 10 (Strict)</option>
                <option value={12}>≥ 12 (Highest Conservation)</option>
              </select>
            </div>

            {/* Min Variants per Gene Filter */}
            <div className="flex items-center gap-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-2 py-1">
              <span className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">
                Genes with &gt;
              </span>
              <input
                type="number"
                min="0"
                max="500"
                value={minVariantsPerGene === 0 ? '' : minVariantsPerGene}
                placeholder="0"
                onChange={(e) => {
                  const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                  setMinVariantsPerGene(val);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    executeSearch(1);
                  }
                }}
                className="w-12 px-1 py-0.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white text-xs font-bold text-center focus:ring-1 focus:ring-emerald-500"
                title="Only show genes with more than this number of discordant variants (e.g. enter 8 to show genes with > 8 variants). Press Enter to query."
              />
              <span className="text-slate-500 dark:text-slate-400 font-medium">vars</span>
              {minVariantsPerGene > 0 && (
                <button
                  type="button"
                  onClick={() => setMinVariantsPerGene(0)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-0.5"
                  title="Clear min variants per gene filter"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Advanced Cutoffs Toggle */}
            <button
              type="button"
              onClick={() => setShowAdvancedCutoffs(!showAdvancedCutoffs)}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 underline underline-offset-2"
            >
              <Sliders className="w-3 h-3" />
              {showAdvancedCutoffs ? 'Hide Cutoffs' : 'Custom AM Cutoffs'}
            </button>
          </div>

          {/* Search Trigger Button */}
          <button
            type="button"
            onClick={() => executeSearch(1)}
            disabled={loading}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium text-xs transition-all shadow-sm h-[38px] shrink-0"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? "Searching..." : "Search Discordant Variants"}
          </button>
        </div>

        {/* ClinVar Assertions Inclusion Sub-Row */}
        <div className="flex flex-wrap items-center gap-4 px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
            <Filter className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>ClinVar Inclusions:</span>
          </div>

          {/* Benign Sub-Tiers */}
          {(discordanceType === 'ALL' || discordanceType === 'BENIGN_AM_PATHOGENIC') && (
            <div className="flex items-center gap-2.5 pl-2 border-l border-slate-200 dark:border-slate-700">
              <span className="font-semibold text-emerald-700 dark:text-emerald-400 text-[11px] uppercase tracking-wider">Benign Direction:</span>
              <label className="flex items-center gap-1.5 cursor-pointer select-none font-medium text-slate-800 dark:text-slate-200 hover:text-emerald-600">
                <input
                  type="checkbox"
                  checked={includeBenign}
                  onChange={(e) => setIncludeBenign(e.target.checked)}
                  className="w-3.5 h-3.5 text-emerald-600 rounded border-slate-300 dark:border-slate-600 focus:ring-emerald-500"
                />
                <span>Benign</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none font-medium text-slate-800 dark:text-slate-200 hover:text-emerald-600">
                <input
                  type="checkbox"
                  checked={includeLikelyBenign}
                  onChange={(e) => setIncludeLikelyBenign(e.target.checked)}
                  className="w-3.5 h-3.5 text-emerald-600 rounded border-slate-300 dark:border-slate-600 focus:ring-emerald-500"
                />
                <span>Likely benign</span>
              </label>
            </div>
          )}

          {/* Pathogenic Sub-Tiers */}
          {(discordanceType === 'ALL' || discordanceType === 'PATHOGENIC_AM_BENIGN') && (
            <div className="flex items-center gap-2.5 pl-2 border-l border-slate-200 dark:border-slate-700">
              <span className="font-semibold text-rose-700 dark:text-rose-400 text-[11px] uppercase tracking-wider">Pathogenic Direction:</span>
              <label className="flex items-center gap-1.5 cursor-pointer select-none font-medium text-slate-800 dark:text-slate-200 hover:text-rose-600">
                <input
                  type="checkbox"
                  checked={includePathogenic}
                  onChange={(e) => setIncludePathogenic(e.target.checked)}
                  className="w-3.5 h-3.5 text-rose-600 rounded border-slate-300 dark:border-slate-600 focus:ring-rose-500"
                />
                <span>Pathogenic</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none font-medium text-slate-800 dark:text-slate-200 hover:text-rose-600">
                <input
                  type="checkbox"
                  checked={includeLikelyPathogenic}
                  onChange={(e) => setIncludeLikelyPathogenic(e.target.checked)}
                  className="w-3.5 h-3.5 text-rose-600 rounded border-slate-300 dark:border-slate-600 focus:ring-rose-500"
                />
                <span>Likely pathogenic</span>
              </label>
            </div>
          )}

          {/* Quick preset buttons */}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400">Presets:</span>
            <button
              type="button"
              onClick={() => {
                setIncludePathogenic(true);
                setIncludeLikelyPathogenic(false);
                setIncludeBenign(true);
                setIncludeLikelyBenign(false);
              }}
              className="px-2 py-0.5 text-[11px] font-medium rounded bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Include definite Pathogenic and Benign only (exclude Likely assertions)"
            >
              Definite Only
            </button>
            <button
              type="button"
              onClick={() => {
                setIncludePathogenic(true);
                setIncludeLikelyPathogenic(true);
                setIncludeBenign(true);
                setIncludeLikelyBenign(true);
              }}
              className="px-2 py-0.5 text-[11px] font-medium rounded bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Include both definite and likely assertions"
            >
              All Assertions
            </button>
          </div>
        </div>

        {/* Advanced Cutoff Sliders / Inputs */}
        {showAdvancedCutoffs && (
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                AlphaMissense Likely Pathogenic Cutoff (Default 0.56):
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0.35"
                  max="0.99"
                  value={minAmPathScore}
                  onChange={(e) => setMinAmPathScore(parseFloat(e.target.value) || 0.56)}
                  className="w-24 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white"
                />
                <span className="text-[11px] text-slate-500">Score ≥ this value evaluated as Pathogenic</span>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                AlphaMissense Likely Benign Cutoff (Default 0.34):
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="0.55"
                  value={maxAmBenignScore}
                  onChange={(e) => setMaxAmBenignScore(parseFloat(e.target.value) || 0.34)}
                  className="w-24 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white"
                />
                <span className="text-[11px] text-slate-500">Score ≤ this value evaluated as Benign</span>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Minimum DIOPT Score Threshold (0–16):
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="16"
                  value={minDioptScore}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(16, parseInt(e.target.value, 10) || 0));
                    setMinDioptScore(val);
                    if (val > 0) setOnlyYeastHomologs(true);
                  }}
                  className="w-20 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white"
                />
                <span className="text-[11px] text-slate-500">
                  {minDioptScore === 0 ? 'No minimum threshold' : `DIOPT score ≥ ${minDioptScore} required`}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
          <strong>Search Error:</strong> {error}
        </div>
      )}

      {/* Statistics & Result Overview Cards */}
      {searchResult && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {discordanceType === 'RECURRENT_BENIGN' ? 'Recurrent Benign' : 'Total Discordant'}
              </div>
              <div className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                {refinedSummaryStats.total.toLocaleString()}
              </div>
              {isAllGenesMode && (
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {refinedSummaryStats.total !== (searchResult.rawTotalEstimate || 26397)
                    ? `Filtered from ${(searchResult.rawTotalEstimate || 26397).toLocaleString()}`
                    : `Across ${(searchResult.rawTotalEstimate || 26397).toLocaleString()} genome index`}
                </div>
              )}
            </div>

            {discordanceType === 'RECURRENT_BENIGN' ? (
              <>
                <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-blue-200/80 dark:border-blue-800/60 shadow-sm">
                  <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    Submissions ≥ {minSubmissions || 1}
                  </div>
                  <div className="text-xl font-bold font-mono text-blue-700 dark:text-blue-300 mt-1">
                    {refinedSummaryStats.recurrentBenign.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Repeated disease submissions
                  </div>
                </div>

                <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                    High Background (≥0.1%)
                  </div>
                  <div className="text-xl font-bold font-mono text-slate-700 dark:text-slate-300 mt-1">
                    {refinedSummaryStats.highBackground.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Common in general pop
                  </div>
                </div>

                <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-purple-200/80 dark:border-purple-800/60 shadow-sm">
                  <div className="text-[11px] font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                    Ultra-Rare in Population
                  </div>
                  <div className="text-xl font-bold font-mono text-purple-700 dark:text-purple-300 mt-1">
                    {refinedSummaryStats.ultraRareOrAbsent.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-purple-600 dark:text-purple-400 font-medium mt-0.5">
                    gnomAD &lt;0.01% (Dual Risk)
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-amber-200/80 dark:border-amber-800/60 shadow-sm">
                  <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Benign ⇄ AM Path
                  </div>
                  <div className="text-xl font-bold font-mono text-amber-700 dark:text-amber-300 mt-1">
                    {refinedSummaryStats.benignAmPath.toLocaleString()}
                  </div>
                  {isAllGenesMode && (
                    <div className="text-[10px] text-amber-600/70 dark:text-amber-400/70 mt-0.5 font-mono">
                      (of 15,258 genome-wide)
                    </div>
                  )}
                </div>

                <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-rose-200/80 dark:border-rose-800/60 shadow-sm">
                  <div className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Path ⇄ AM Benign
                  </div>
                  <div className="text-xl font-bold font-mono text-rose-700 dark:text-rose-300 mt-1">
                    {refinedSummaryStats.pathogenicAmBenign.toLocaleString()}
                  </div>
                  {isAllGenesMode && (
                    <div className="text-[10px] text-rose-600/70 dark:text-rose-400/70 mt-0.5 font-mono">
                      (of 11,139 genome-wide)
                    </div>
                  )}
                </div>

                <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Genes Analyzed
                  </div>
                  <div className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {refinedSummaryStats.genesCount.toLocaleString()}
                  </div>
                  {minVariantsPerGene > 0 && (
                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-medium">
                      &gt;{minVariantsPerGene} variants/gene
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-emerald-200/80 dark:border-emerald-800/60 shadow-sm col-span-2 sm:col-span-1">
              <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Dna className="w-3 h-3" />
                {minDioptScore > 0 ? `DIOPT ≥ ${minDioptScore}` : 'Yeast Homologs'}
              </div>
              <div className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-300 mt-1">
                {refinedSummaryStats.yeastCount.toLocaleString()}
              </div>
              <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                S. cerevisiae orthologs
              </div>
            </div>
          </div>

          {/* Recurrent Disease Submissions & gnomAD Hypothesis Callout */}
          {(minSubmissions >= 2 || discordanceType === 'RECURRENT_BENIGN') && (
            <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950/40 dark:via-indigo-950/30 dark:to-purple-950/40 border border-blue-200 dark:border-blue-800/80 rounded-xl p-4 shadow-sm space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0 border border-blue-300 dark:border-blue-700">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-blue-950 dark:text-blue-100 uppercase tracking-wider flex items-center gap-1.5">
                      Recurrent Disease Submissions Labeled as Benign ({minSubmissions > 0 ? `≥ ${minSubmissions} Submissions` : 'Recurrent in ClinVar'})
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-4xl leading-relaxed">
                      Why would a variant be repeatedly submitted {minSubmissions > 0 ? `(${minSubmissions}+ times)` : 'multiple times'} for a disease yet classified as <em>Benign / Likely Benign</em> (even with low AlphaMissense score)? Comparing ClinVar submissions against <strong>gnomAD population allele frequency</strong> distinguishes between two opposing genetic scenarios:
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className={`p-3 rounded-lg border transition-all ${
                  gnomadFilter === 'COMMON' || gnomadFilter === 'LOW_FREQUENCY'
                    ? 'bg-blue-100/70 dark:bg-blue-900/40 border-blue-400 dark:border-blue-600 ring-2 ring-blue-500/20'
                    : 'bg-white/80 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/60'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                      Scenario A: High Background Polymorphism
                    </span>
                    <button
                      type="button"
                      onClick={() => setGnomadFilter(gnomadFilter === 'COMMON' ? 'ALL' : 'COMMON')}
                      className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {gnomadFilter === 'COMMON' ? 'Show All' : 'Filter (gnomAD ≥ 1%)'}
                    </button>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 mt-1 leading-normal">
                    <strong>High gnomAD AF (≥ 0.1% or ≥ 1.0%):</strong> Variant is common in healthy populations. It repeatedly turns up incidentally during multi-gene clinical sequencing panels for patients with diverse disorders, prompting multiple labs to correctly log it as Benign.
                  </p>
                </div>

                <div className={`p-3 rounded-lg border transition-all ${
                  gnomadFilter === 'ULTRA_RARE' || gnomadFilter === 'RARE'
                    ? 'bg-purple-100/70 dark:bg-purple-900/40 border-purple-400 dark:border-purple-600 ring-2 ring-purple-500/20'
                    : 'bg-white/80 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/60'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-purple-950 dark:text-purple-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
                      Scenario B: Potential False-Negative / Dual Diagnostic Blindspot
                    </span>
                    <button
                      type="button"
                      onClick={() => setGnomadFilter(gnomadFilter === 'ULTRA_RARE' ? 'ALL' : 'ULTRA_RARE')}
                      className="text-[11px] font-bold text-purple-600 dark:text-purple-400 hover:underline"
                    >
                      {gnomadFilter === 'ULTRA_RARE' ? 'Show All' : 'Filter (gnomAD < 0.01% / Absent)'}
                    </button>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 mt-1 leading-normal">
                    <strong>Ultra-Rare or Absent in gnomAD (&lt; 0.01% / &lt;1e-5):</strong> Despite low population prevalence, this variant was independently ascertained across multiple patients with the disease. Structural deep learning models (AlphaMissense) can miss non-structural pathogenic mechanisms (splicing, regulatory, allostery, or multimer disruption), and ClinVar calls may have anchored on outdated benign literature. High priority for BUDDY yeast functional testing!
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Table Header Filter & Sorting Controls */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Quick text filter */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter by gene, variant, or disease condition..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {/* Sort & Export Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-medium">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as any);
                    setTimeout(() => executeSearch(page), 50);
                  }}
                  className="px-2 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded text-xs text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-emerald-500 font-medium"
                >
                  <option value="delta_desc">Highest Discordance Delta</option>
                  <option value="submissions_desc">Most ClinVar Submissions</option>
                  <option value="gnomad_desc">gnomAD Frequency (High to Low)</option>
                  <option value="gnomad_asc">gnomAD Frequency (Rare to Common)</option>
                  <option value="gene_asc">Gene Symbol (A-Z)</option>
                  <option value="score_desc">AlphaMissense Score (High-Low)</option>
                  <option value="stars_desc">ClinVar Review Stars (High-Low)</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
                title="Download CSV table of discordant variants"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Variants Table */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 uppercase font-bold tracking-wider text-[11px]">
                    <th className="py-3 px-4">Gene Symbol</th>
                    <th className="py-3 px-4">Variant (HGVS)</th>
                    <th className="py-2.5 px-3">
                      <div>ClinVar /</div>
                      <div>Submissions</div>
                    </th>
                    <th className="py-2.5 px-3">
                      <div>Alpha</div>
                      <div>Missense</div>
                    </th>
                    <th className="py-2.5 px-3">
                      <div>gnomAD</div>
                      <div>Frequency</div>
                    </th>
                    <th className="py-3 px-4">Tension / Interpretation</th>
                    <th className="py-3 px-4">Condition / Disease</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 font-medium">
                  {displayedVariants.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500 dark:text-slate-400">
                        {loading ? (
                          <div className="flex flex-col items-center justify-center gap-2">
                            <RefreshCw className="w-6 h-6 animate-spin text-emerald-600 dark:text-emerald-400" />
                            <span>Querying ClinVar & AlphaMissense datasets...</span>
                          </div>
                        ) : (
                          <span>No discordant variants matching your current filter criteria.</span>
                        )}
                      </td>
                    </tr>
                  ) : (
                    paginatedVariants.map((v) => {
                      const isBenignAmPath = v.discordanceType === 'BENIGN_AM_PATHOGENIC';
                      return (
                        <tr 
                          key={v.id} 
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-700/40 transition-colors"
                        >
                          {/* Gene Symbol */}
                          <td className="py-3 px-4">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-slate-900 dark:text-white text-sm">
                                  {v.gene}
                                </span>
                                {(geneVariantCounts.get(v.gene) || v.geneVariantCount || 0) > 1 && (
                                  <span 
                                    className="text-[10px] bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 font-semibold px-1.5 py-0.5 rounded"
                                    title={`${geneVariantCounts.get(v.gene) || v.geneVariantCount} discordant variants in ${v.gene}`}
                                  >
                                    {geneVariantCounts.get(v.gene) || v.geneVariantCount} vars
                                  </span>
                                )}
                              </div>
                              {v.yeastOrtholog ? (
                                <div className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold" title={`Ortholog in S. cerevisiae: ${v.yeastOrtholog.symbol} (DIOPT Score: ${v.yeastOrtholog.dioptScore})`}>
                                  <Dna className="w-3 h-3 shrink-0" />
                                  <span>⇄ {v.yeastOrtholog.symbol}</span>
                                  <span className="text-[10px] text-slate-400">({v.yeastOrtholog.dioptScore})</span>
                                </div>
                              ) : (
                                <div className="text-[10px] text-slate-400">
                                  No yeast ortholog
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Variant Protein Change */}
                          <td className="py-3 px-4">
                            <div className="space-y-0.5">
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                {v.hgvsProtein}
                              </span>
                              {v.clinVarVariantId && (
                                <div>
                                  <a
                                    href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${v.clinVarVariantId}/`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-0.5"
                                  >
                                    ClinVar #{v.clinVarVariantId}
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* ClinVar Clinical Significance & Submissions */}
                          <td className="py-3 px-4">
                            <div className="space-y-1">
                              <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                                v.clinVarSignificance.toLowerCase().includes('pathogenic')
                                  ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800'
                                  : 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
                              }`}>
                                {v.clinVarSignificance}
                              </span>

                              {/* Review Stars & Status */}
                              <div className="flex items-center gap-1" title={v.clinVarReviewStatus}>
                                <div className="flex text-amber-500">
                                  {Array.from({ length: 4 }).map((_, i) => (
                                    <Star 
                                      key={i} 
                                      className={`w-3 h-3 ${i < v.clinVarStars ? 'fill-amber-400 text-amber-500' : 'text-slate-300 dark:text-slate-600'}`} 
                                    />
                                  ))}
                                </div>
                                <span className="text-[10px] text-slate-400 truncate max-w-[130px]">
                                  {v.clinVarReviewStatus}
                                </span>
                              </div>

                              {/* ClinVar Submission Count */}
                              <div 
                                className="flex items-center gap-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                                title={`${v.clinVarSubmissions || 1} independent clinical submissions recorded in ClinVar`}
                              >
                                <Users className="w-3 h-3 text-slate-400 shrink-0" />
                                <span>{v.clinVarSubmissions || 1} submissions</span>
                              </div>
                            </div>
                          </td>

                          {/* AlphaMissense Score */}
                          <td className="py-3 px-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 font-mono font-bold text-sm">
                                <span className={
                                  v.amScore > 0.56 
                                    ? 'text-rose-600 dark:text-rose-400' 
                                    : v.amScore < 0.34 
                                    ? 'text-emerald-600 dark:text-emerald-400' 
                                    : 'text-amber-600 dark:text-amber-400'
                                }>
                                  {v.amScore.toFixed(3)}
                                </span>
                                <span className="text-[10px] font-sans font-semibold text-slate-400">
                                  ({v.amClass})
                                </span>
                              </div>

                              {/* External Hegelab Viewer Link */}
                              {v.uniprotId && v.residue ? (
                                <a
                                  href={`https://alphamissense.hegelab.org/hotspot?uid=${v.uniprotId}&resi=${v.residue}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-0.5"
                                >
                                  View 3D Hotspot
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  Scale 0.0 - 1.0
                                </span>
                              )}
                            </div>
                          </td>

                          {/* gnomAD Population Frequency */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {v.gnomadAf !== null && v.gnomadAf !== undefined ? (() => {
                              const afVal = v.gnomadAf;
                              const isExome = v.gnomadExomeAf !== null && v.gnomadExomeAf !== undefined;
                              const sourceTag = isExome ? 'Exomes' : 'Genomes';
                              const displayStr = afVal < 0.001 ? afVal.toExponential(1) : `${(afVal * 100).toFixed(2)}%`;
                              const countInfo = isExome && v.gnomadExomeAc !== null && v.gnomadExomeAn !== null
                                ? `AC: ${v.gnomadExomeAc} / AN: ${v.gnomadExomeAn.toLocaleString()}`
                                : (!isExome && v.gnomadGenomeAc !== null && v.gnomadGenomeAn !== null)
                                  ? `AC: ${v.gnomadGenomeAc} / AN: ${v.gnomadGenomeAn.toLocaleString()}`
                                  : null;
                              const tooltipInfo = [
                                `gnomAD v2.1.1 (${sourceTag}):`,
                                `• Allele Frequency: ${afVal} (${afVal.toExponential(4)} | ${(afVal * 100).toFixed(4)}%)`,
                                countInfo ? `• Allele Count: ${countInfo}` : null,
                                `• Primary link opens gnomAD v2.1.1 where this exact frequency appears in the table.`,
                                v.gnomadLinkV4 ? `• Note: gnomAD v4 (GRCh38) has ~730k more samples, so v4 frequencies will differ.` : null
                              ].filter(Boolean).join('\n');

                              return (
                                <div title={tooltipInfo} className="inline-flex items-center gap-1.5">
                                  {v.gnomadLink ? (
                                    <a
                                      href={v.gnomadLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-mono font-bold text-slate-900 dark:text-white text-xs hover:underline inline-flex items-center gap-0.5 group"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <span>{displayStr}</span>
                                      <ExternalLink className="w-2.5 h-2.5 text-slate-400 group-hover:text-blue-500" />
                                    </a>
                                  ) : (
                                    <span className="font-mono font-bold text-slate-900 dark:text-white text-xs">
                                      {displayStr}
                                    </span>
                                  )}
                                  {v.gnomadAf >= 0.01 ? (
                                    <span className="inline-block px-1 py-0.2 rounded text-[9px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600" title="Allele frequency ≥ 1% (Common polymorphism)">
                                      Common
                                    </span>
                                  ) : v.gnomadAf >= 0.001 ? (
                                    <span className="inline-block px-1 py-0.2 rounded text-[9px] font-bold bg-sky-100 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800" title="Allele frequency 0.1% - 1% (Low frequency)">
                                      Low
                                    </span>
                                  ) : (
                                    <span className="inline-block px-1 py-0.2 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800" title="Allele frequency < 0.1% (Rare)">
                                      Rare
                                    </span>
                                  )}
                                  {v.gnomadLinkV4 && (
                                    <a
                                      href={v.gnomadLinkV4}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-slate-400 hover:text-emerald-500 font-sans font-medium text-[9px]"
                                      title="Open in modern gnomAD v4 (GRCh38)"
                                    >
                                      [v4]
                                    </a>
                                  )}
                                </div>
                              );
                            })() : (
                              <span className="text-slate-400 dark:text-slate-500 text-xs italic" title="Not identified in gnomAD (< 1e-5)">
                                Absent
                              </span>
                            )}
                          </td>

                          {/* Discordance Tension & Interpretation */}
                          <td className="py-3 px-4">
                            <div className="space-y-1 max-w-[170px]">
                              {v.discordanceType === 'BENIGN_AM_PATHOGENIC' ? (
                                <div className="flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                  <span>Benign ⇄ AM Path</span>
                                </div>
                              ) : v.discordanceType === 'PATHOGENIC_AM_BENIGN' ? (
                                <div className="flex items-center gap-1 text-[11px] font-bold text-rose-700 dark:text-rose-300">
                                  <Zap className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                                  <span>Pathogenic ⇄ AM Benign</span>
                                </div>
                              ) : (
                                <div className="space-y-0.5">
                                  {(v.clinVarSubmissions || 0) >= 2 && v.gnomadAf && v.gnomadAf >= 0.001 ? (
                                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600" title="Frequently submitted across clinical tests with high population frequency (common incidental polymorphism)">
                                      High Background
                                    </span>
                                  ) : (v.clinVarSubmissions || 0) >= 2 && (!v.gnomadAf || v.gnomadAf < 0.0001) ? (
                                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-700" title="Submitted multiple times for disease yet absent in general population! Potential dual diagnostic failure (structural blindness or misclassified benign call)">
                                      ⚠️ Recurrent in Disease
                                    </span>
                                  ) : (
                                    <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                                      Recurrent Benign
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Discordance Delta Gauge */}
                              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${
                                    v.discordanceType === 'BENIGN_AM_PATHOGENIC' ? 'bg-amber-500' : 
                                    v.discordanceType === 'PATHOGENIC_AM_BENIGN' ? 'bg-rose-500' : 'bg-blue-500'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(10, v.discordanceDelta * 100))}%` }}
                                />
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 flex justify-between">
                                <span>Tension:</span>
                                <span className="font-mono font-bold">{(v.discordanceDelta * 100).toFixed(0)}%</span>
                              </div>
                            </div>
                          </td>

                          {/* Disease / Condition */}
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-300 max-w-[220px]">
                            <div className="line-clamp-2" title={v.diseaseOrCondition}>
                              {v.diseaseOrCondition}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* One-click Deep Dive into BUDDY Pipeline */}
                              {onSelectGeneVariant && (
                                <button
                                  type="button"
                                  onClick={() => onSelectGeneVariant(v.gene, v.hgvsProtein, v)}
                                  className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px] flex items-center gap-1 transition-all shadow-sm"
                                  title={`Load ${v.gene} into BUDDY pipeline to align sequences, model in yeast, design CRISPR oligos, and generate experimental assay`}
                                >
                                  Deep-Dive
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              )}

                              {/* Copy JSON */}
                              <button
                                type="button"
                                onClick={() => copyRowJson(v)}
                                className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                title="Copy variant data as JSON"
                              >
                                {copiedId === v.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Dynamic Pagination Controls */}
            {totalDisplayed > 0 && (
              <div className="p-3 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
                <div>
                  Showing variants <span className="font-semibold text-slate-900 dark:text-slate-100">{startIndex + 1}</span> to <span className="font-semibold text-slate-900 dark:text-slate-100">{endIndex}</span> of <span className="font-semibold text-slate-900 dark:text-slate-100">{totalDisplayed.toLocaleString()}</span> matching variants
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={safePage <= 1 || loading}
                      className="p-1.5 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-40 hover:bg-white dark:hover:bg-slate-800 transition-colors"
                      title="Previous page"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>

                    <span className="px-2 font-mono font-semibold text-slate-800 dark:text-slate-200">
                      Page {safePage} of {totalPages}
                    </span>

                    <button
                      type="button"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages || loading}
                      className="p-1.5 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-40 hover:bg-white dark:hover:bg-slate-800 transition-colors"
                      title="Next page"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
