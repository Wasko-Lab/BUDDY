import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Layers,
  Search,
  Filter,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Dna,
  X,
  Users,
  Info,
  Sparkles,
  BookOpen,
  ArrowRight,
  Database,
  Zap,
  Download,
  Star,
  Check,
  Copy,
  Sliders,
  ArrowUpDown
} from 'lucide-react';
import { ProteinComplex, ComplexSearchResult, ComplexVariantRecord, ComplexVariantsResponse } from '../types';
import { searchProteinComplexes, fetchComplexVariants } from '../services/api';

interface ProteinComplexesExplorerProps {
  onSelectGene?: (geneSymbol: string) => void;
  onSelectGeneVariant?: (geneSymbol: string, hgvs?: string, variantObj?: any) => void;
  initialQuery?: string;
  isDarkMode?: boolean;
}

const ASSEMBLY_FILTERS = [
  { id: 'all', label: 'All Assemblies', icon: '🌐' },
  { id: 'Dimer', label: 'Dimers (2)', icon: '👥' },
  { id: 'Trimer', label: 'Trimers (3)', icon: '🔺' },
  { id: 'Tetramer', label: 'Tetramers (4)', icon: '💠' },
  { id: 'Pentamer', label: 'Pentamers (5)', icon: '⬟' },
  { id: 'Hexamer', label: 'Hexamers (6)', icon: '⬡' },
  { id: 'Heptamer', label: 'Heptamers (7)', icon: '⚛️' },
  { id: 'Octamer', label: 'Octamers (8)', icon: '🔷' },
  { id: 'Multimer', label: 'Multimers (8+)', icon: '🧬' },
] as const;

const PRESET_SEARCHES = [
  { label: 'MSH2 (MutS Dimer)', query: 'MSH2', assembly: 'Dimer' },
  { label: 'RPA1 (Trimer)', query: 'RPA1', assembly: 'Trimer' },
  { label: 'PCNA (Trimer)', query: 'PCNA', assembly: 'Trimer' },
  { label: 'V-ATPase (Multimer)', query: 'V-ATPase', assembly: 'Multimer' },
  { label: 'RNA Polymerase III', query: 'RNA Polymerase III', assembly: 'Multimer' },
  { label: 'TRiC/CCT Chaperonin Complex', query: 'TRiC', assembly: 'all' },
  { label: 'Proteasome', query: 'Proteasome', assembly: 'all' },
  { label: 'MCM Complex', query: 'MCM', assembly: 'Hexamer' },
];

export const ProteinComplexesExplorer: React.FC<ProteinComplexesExplorerProps> = ({
  onSelectGene,
  onSelectGeneVariant,
  initialQuery = '',
  isDarkMode = false
}) => {
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [selectedSpecies, setSelectedSpecies] = useState<'all' | 'human' | 'yeast'>('all');
  const [selectedAssembly, setSelectedAssembly] = useState<string>('all');
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ComplexSearchResult>({
    total: 0,
    returned: 0,
    page: 1,
    pageSize: 12,
    complexes: [],
    assemblyCounts: {},
    speciesCounts: { human: 0, yeast: 0 }
  });
  const [expandedComplexId, setExpandedComplexId] = useState<string | null>(null);

  // Complex Variants Modal State
  const [activeComplexForVariants, setActiveComplexForVariants] = useState<ProteinComplex | null>(null);
  const [loadingComplexVariants, setLoadingComplexVariants] = useState(false);
  const [complexVariantsData, setComplexVariantsData] = useState<ComplexVariantsResponse | null>(null);
  const [variantsError, setVariantsError] = useState<string | null>(null);

  // Variant Table Filtering State
  const [selectedSubunitFilter, setSelectedSubunitFilter] = useState<string>('all');
  const [selectedSigFilter, setSelectedSigFilter] = useState<string>('all');
  const [selectedAmFilter, setSelectedAmFilter] = useState<'all' | 'pathogenic' | 'ambiguous' | 'benign'>('all');
  const [variantSearchQuery, setVariantSearchQuery] = useState<string>('');
  const [variantTablePage, setVariantTablePage] = useState(1);
  const variantPageSize = 25;
  const [copiedVariantId, setCopiedVariantId] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(queryInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [queryInput]);

  // Load complexes list
  const fetchComplexes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await searchProteinComplexes({
        q: debouncedQuery,
        species: selectedSpecies,
        assembly: selectedAssembly,
        page,
        pageSize
      });
      setData(res);
    } catch (err) {
      console.error("Failed to load complexes:", err);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, selectedSpecies, selectedAssembly, page, pageSize]);

  useEffect(() => {
    fetchComplexes();
  }, [fetchComplexes]);

  // Open Full Complex Variant Table
  const handleOpenComplexVariants = async (complex: ProteinComplex) => {
    setActiveComplexForVariants(complex);
    setLoadingComplexVariants(true);
    setComplexVariantsData(null);
    setVariantsError(null);
    setSelectedSubunitFilter('all');
    setSelectedSigFilter('all');
    setSelectedAmFilter('all');
    setVariantSearchQuery('');
    setVariantTablePage(1);

    try {
      const res = await fetchComplexVariants(complex.complexId);
      if (!res) {
        throw new Error('Could not retrieve variants for this complex');
      }
      setComplexVariantsData(res);
    } catch (err: any) {
      setVariantsError(err?.message || 'Failed to search variants across complex subunits');
    } finally {
      setLoadingComplexVariants(false);
    }
  };

  const handleCloseComplexVariants = () => {
    setActiveComplexForVariants(null);
    setComplexVariantsData(null);
    setVariantsError(null);
  };

  // Filtered variants inside the active complex modal
  const filteredComplexVariants = useMemo(() => {
    if (!complexVariantsData?.variants) return [];
    return complexVariantsData.variants.filter((v) => {
      // 1. Subunit filter
      if (selectedSubunitFilter !== 'all' && v.gene.toUpperCase() !== selectedSubunitFilter.toUpperCase()) {
        return false;
      }

      // 2. Clinical significance filter
      if (selectedSigFilter !== 'all') {
        if (selectedSigFilter === 'PATHOGENIC_ALL') {
          if (v.clinicalSignificance !== 'Pathogenic' && v.clinicalSignificance !== 'Likely Pathogenic') return false;
        } else if (selectedSigFilter === 'BENIGN_ALL') {
          if (v.clinicalSignificance !== 'Benign' && v.clinicalSignificance !== 'Likely Benign') return false;
        } else if (selectedSigFilter === 'CONFLICTING_ONLY') {
          if (v.clinicalSignificance !== 'Conflicting') return false;
        } else if (selectedSigFilter === 'CONFLICTING_PATH_BENIGN') {
          if (!v.isConflictingPathBenign) return false;
        } else if (selectedSigFilter === 'VUS') {
          if (v.clinicalSignificance !== 'VUS') return false;
        } else if (v.clinicalSignificance !== selectedSigFilter) {
          return false;
        }
      }

      // 3. AlphaMissense filter
      if (selectedAmFilter !== 'all') {
        if (selectedAmFilter === 'pathogenic' && (v.amScore === null || v.amScore < 0.56)) return false;
        if (selectedAmFilter === 'ambiguous' && (v.amScore === null || v.amScore <= 0.34 || v.amScore >= 0.56)) return false;
        if (selectedAmFilter === 'benign' && (v.amScore === null || v.amScore > 0.34)) return false;
      }

      // 4. Text Search filter
      if (variantSearchQuery.trim()) {
        const q = variantSearchQuery.toLowerCase().trim();
        const matchesGene = v.gene.toLowerCase().includes(q);
        const matchesChange = v.proteinChange.toLowerCase().includes(q);
        const matchesHgvs = (v.hgvs || '').toLowerCase().includes(q);
        const matchesId = (v.clinVarVariantId || '').includes(q) || (v.clinVarId || '').toLowerCase().includes(q);
        const matchesResidue = String(v.residue).includes(q);
        if (!matchesGene && !matchesChange && !matchesHgvs && !matchesId && !matchesResidue) {
          return false;
        }
      }

      return true;
    });
  }, [complexVariantsData, selectedSubunitFilter, selectedSigFilter, selectedAmFilter, variantSearchQuery]);

  const totalVariantPages = Math.ceil(filteredComplexVariants.length / variantPageSize) || 1;
  const paginatedComplexVariants = useMemo(() => {
    const start = (variantTablePage - 1) * variantPageSize;
    return filteredComplexVariants.slice(start, start + variantPageSize);
  }, [filteredComplexVariants, variantTablePage, variantPageSize]);

  // Export CSV
  const handleExportCsv = () => {
    if (!filteredComplexVariants || filteredComplexVariants.length === 0) return;
    const headers = [
      'Complex_ID',
      'Complex_Name',
      'Subunit_Gene',
      'UniProt_ID',
      'Protein_Change',
      'Residue',
      'Ref_AA',
      'Target_AA',
      'Clinical_Significance',
      'Conflict_Details',
      'AlphaMissense_Score',
      'AlphaMissense_Classification',
      'Review_Status',
      'ClinVar_Stars',
      'ClinVar_RCV',
      'ClinVar_Variant_ID',
      'gnomAD_Freq',
      'HGVS_Genomic'
    ];

    const rows = filteredComplexVariants.map((v) => [
      `"${activeComplexForVariants?.complexId || ''}"`,
      `"${(activeComplexForVariants?.name || '').replace(/"/g, '""')}"`,
      `"${v.gene}"`,
      `"${v.uniprotId || ''}"`,
      `"${v.proteinChange}"`,
      v.residue,
      `"${v.refAA}"`,
      `"${v.targetAA}"`,
      `"${v.clinicalSignificance}"`,
      `"${v.conflictingSummary || ''}"`,
      v.amScore ?? '',
      `"${v.amClassification || ''}"`,
      `"${(v.reviewStatus || '').replace(/"/g, '""')}"`,
      v.clinVarStars,
      `"${v.clinVarId || ''}"`,
      `"${v.clinVarVariantId || ''}"`,
      v.gnomadFreq ?? '',
      `"${(v.hgvs || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${activeComplexForVariants?.complexId || 'Complex'}_Variants.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalPages = Math.ceil(data.total / pageSize) || 1;

  const getAssemblyBadgeStyle = (category: string) => {
    switch (category) {
      case 'Dimer':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 dark:border-purple-800';
      case 'Trimer':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'Tetramer':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'Pentamer':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
      case 'Hexamer':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-200 dark:border-rose-800';
      case 'Heptamer':
        return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800';
      case 'Octamer':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';
      case 'Multimer':
        return 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300 border-fuchsia-200 dark:border-fuchsia-800';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    }
  };

  const getSignificanceBadgeStyle = (sig: string) => {
    switch (sig) {
      case 'Pathogenic':
        return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200 border-red-300 dark:border-red-800';
      case 'Likely Pathogenic':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200 border-orange-300 dark:border-orange-800';
      case 'Conflicting':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200 border-purple-300 dark:border-purple-800';
      case 'VUS':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 border-amber-300 dark:border-amber-800';
      case 'Likely Benign':
        return 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200 border-teal-300 dark:border-teal-800';
      case 'Benign':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800';
      default:
        return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700';
    }
  };

  const getAmBadgeStyle = (score: number | null) => {
    if (score === null) return 'text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700';
    if (score >= 0.564) return 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 font-bold';
    if (score <= 0.34) return 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 font-semibold';
    return 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800';
  };

  return (
    <div className="space-y-6">
      {/* Hero Header & Explorer Overview */}
      <div className="bg-gradient-to-r from-indigo-900/10 via-purple-900/10 to-emerald-900/10 dark:from-indigo-950/40 dark:via-purple-950/40 dark:to-emerald-950/40 border border-indigo-200/60 dark:border-indigo-800/40 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1.5 rounded-lg bg-indigo-600 text-white shadow-sm">
                <Layers className="w-5 h-5" />
              </span>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                Protein Complexes Explorer
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-300/40 dark:border-indigo-700/50">
                  Complex Portal (EBI)
                </span>
              </h2>
            </div>
            <p className="text-xs md:text-sm text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
              Explore any human or yeast multi-protein complex (dimers, trimers, tetramers, multimers).
              Search all ClinVar variants across an entire complex in parallel with AlphaMissense and gnomAD scores, or click any individual subunit gene to load directly into BUDDY.
            </p>
          </div>

          {/* Quick Metrics Bar */}
          <div className="flex items-center gap-3 self-start md:self-auto shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-slate-800 px-3.5 py-2 rounded-xl text-xs shadow-xs">
            <div className="text-center px-2">
              <span className="block text-[10px] text-slate-500 uppercase font-semibold">Total Complexes</span>
              <span className="font-bold text-slate-900 dark:text-white text-sm">3,132</span>
            </div>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
            <div className="text-center px-2">
              <span className="block text-[10px] text-slate-500 uppercase font-semibold">Human</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400 text-sm">2,498</span>
            </div>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
            <div className="text-center px-2">
              <span className="block text-[10px] text-slate-500 uppercase font-semibold">Yeast</span>
              <span className="font-bold text-amber-600 dark:text-amber-400 text-sm">634</span>
            </div>
          </div>
        </div>

        {/* Preset Discovery Chips */}
        <div className="mt-4 pt-3 border-t border-indigo-200/40 dark:border-indigo-800/30 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Quick Discovery:
          </span>
          {PRESET_SEARCHES.map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                setQueryInput(preset.query);
                setSelectedAssembly(preset.assembly);
                setPage(1);
              }}
              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-white/70 dark:bg-slate-800/70 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 transition-all cursor-pointer shadow-2xs"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm space-y-4">
        {/* Top line: Search Input & Species Tabs */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search by Gene Symbol (e.g. MSH2, RPA1), Complex Name, or CPX ID (e.g. CPX-80)..."
              className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
            />
            {queryInput && (
              <button
                onClick={() => {
                  setQueryInput('');
                  setPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Species Selector */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg shrink-0">
            <button
              onClick={() => { setSelectedSpecies('all'); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                selectedSpecies === 'all'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              All Species
            </button>
            <button
              onClick={() => { setSelectedSpecies('human'); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1 ${
                selectedSpecies === 'human'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>👤 Human</span>
              {data.speciesCounts.human > 0 && (
                <span className="text-[10px] opacity-75 font-mono">({data.speciesCounts.human})</span>
              )}
            </button>
            <button
              onClick={() => { setSelectedSpecies('yeast'); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1 ${
                selectedSpecies === 'yeast'
                  ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>🍞 Yeast</span>
              {data.speciesCounts.yeast > 0 && (
                <span className="text-[10px] opacity-75 font-mono">({data.speciesCounts.yeast})</span>
              )}
            </button>
          </div>
        </div>

        {/* Assembly Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-thin">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-1 flex items-center gap-1 shrink-0">
            <Filter className="w-3.5 h-3.5" /> Assembly:
          </span>
          {ASSEMBLY_FILTERS.map((f) => {
            const count = f.id === 'all' ? data.total : (data.assemblyCounts[f.id] || 0);
            const isSelected = selectedAssembly === f.id;
            return (
              <button
                key={f.id}
                onClick={() => { setSelectedAssembly(f.id); setPage(1); }}
                className={`px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer border ${
                  isSelected
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <span>{f.icon}</span>
                <span>{f.label}</span>
                {count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    isSelected ? 'bg-indigo-800/50 text-indigo-100' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results Header with Count & Refresh */}
      <div className="flex items-center justify-between px-1">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
          Showing <span className="font-bold text-slate-900 dark:text-white">{data.returned}</span> of{' '}
          <span className="font-bold text-slate-900 dark:text-white">{data.total}</span> complexes
          {debouncedQuery && (
            <span> matching &ldquo;<span className="text-indigo-600 dark:text-indigo-400 font-semibold">{debouncedQuery}</span>&rdquo;</span>
          )}
          {selectedAssembly !== 'all' && (
            <span> as <span className="text-purple-600 dark:text-purple-400 font-semibold">{selectedAssembly}</span></span>
          )}
        </div>

        <button
          onClick={fetchComplexes}
          disabled={loading}
          className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="py-16 text-center">
          <div className="inline-block p-3 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 animate-spin mb-3">
            <RefreshCw className="w-6 h-6" />
          </div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Searching Complex Portal TSVs...</p>
          <p className="text-xs text-slate-500 mt-1">Cross-referencing Human and Yeast protein assemblies</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && data.complexes.length === 0 && (
        <div className="bg-slate-50 dark:bg-slate-900/50 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl p-10 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">No matching complexes found</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 mb-4">
            Try adjusting your search keywords, clearing assembly filters, or searching for a general protein family name (e.g. &ldquo;dimer&rdquo;, &ldquo;polymerase&rdquo;, &ldquo;repair&rdquo;).
          </p>
          <button
            onClick={() => {
              setQueryInput('');
              setSelectedAssembly('all');
              setSelectedSpecies('all');
              setPage(1);
            }}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs"
          >
            Reset All Filters
          </button>
        </div>
      )}

      {/* Complex Cards Grid */}
      {!loading && data.complexes.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {data.complexes.map((c) => {
            const isExpanded = expandedComplexId === c.complexId;
            const badgeStyle = getAssemblyBadgeStyle(c.assemblyCategory);

            return (
              <div
                key={c.complexId}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs hover:border-indigo-300 dark:hover:border-indigo-700/60 transition-all overflow-hidden"
              >
                {/* Header Row */}
                <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`https://www.ebi.ac.uk/complexportal/complex/${c.complexId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800"
                        title="View on EBI Complex Portal"
                      >
                        {c.complexId}
                        <ExternalLink className="w-3 h-3" />
                      </a>

                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${badgeStyle}`}>
                        {c.assemblyCategory} ({c.assembly !== '-' ? c.assembly : `${c.totalSubunits} subunits`})
                      </span>

                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                        c.species === 'human'
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                          : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                      }`}>
                        {c.species === 'human' ? '👤 Human (9606)' : '🍞 Yeast (559292)'}
                      </span>

                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {c.distinctSubunits} distinct {c.distinctSubunits === 1 ? 'subunit' : 'subunits'} ({c.totalSubunits} total)
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                      {c.name}
                    </h3>

                    {c.aliases && c.aliases.length > 0 && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold">Aliases:</span> {c.aliases.slice(0, 4).join(', ')}
                        {c.aliases.length > 4 && ` (+${c.aliases.length - 4} more)`}
                      </p>
                    )}
                  </div>

                  {/* Primary Action Buttons */}
                  <div className="flex items-center gap-2 self-start md:self-center shrink-0">
                    <button
                      onClick={() => handleOpenComplexVariants(c)}
                      className="px-3.5 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs hover:shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                      title="Search all ClinVar & AlphaMissense variants across all complex subunits"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-300" />
                      <span>Search Complex Variants</span>
                    </button>

                    <button
                      onClick={() => setExpandedComplexId(isExpanded ? null : c.complexId)}
                      className="px-3 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors flex items-center gap-1"
                    >
                      <span>{isExpanded ? 'Less' : 'Subunits'}</span>
                      <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Subunit Participants Quick Bar */}
                <div className="px-4 pb-4 sm:px-5 border-t border-slate-100 dark:border-slate-800/80 pt-3 bg-slate-50/50 dark:bg-slate-950/30">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Subunit Participants (click to analyze individual gene):</span>
                    </div>

                    <button
                      onClick={() => handleOpenComplexVariants(c)}
                      className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                    >
                      <span>Search All Variants Table</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {c.participants.map((p, idx) => (
                      <div
                        key={`${p.identifier}-${idx}`}
                        className="inline-flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs shadow-2xs group hover:border-indigo-400 dark:hover:border-indigo-500 transition-all"
                      >
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {p.symbol}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                            ({p.identifier})
                          </span>
                          {p.stoichiometry > 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                              {p.stoichiometry}x
                            </span>
                          )}
                        </div>

                        {onSelectGene && (
                          <button
                            onClick={() => onSelectGene(p.symbol)}
                            className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-0.5 ml-1 pl-1.5 border-l border-slate-200 dark:border-slate-700 cursor-pointer"
                            title={`Load individual gene ${p.symbol} into BUDDY analysis pipeline`}
                          >
                            <span>Analyze Gene</span>
                            <ArrowRight className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Collapsible Deep Details */}
                {isExpanded && (
                  <div className="px-4 pb-5 sm:px-5 pt-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 text-xs text-slate-600 dark:text-slate-300">
                    {c.description && (
                      <div>
                        <span className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                          Description:
                        </span>
                        <p className="leading-relaxed bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                          {c.description}
                        </p>
                      </div>
                    )}

                    {c.properties && (
                      <div>
                        <span className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                          Biochemical Properties & Assembly:
                        </span>
                        <p className="leading-relaxed bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                          {c.properties}
                        </p>
                      </div>
                    )}

                    {c.goAnnotations && c.goAnnotations.length > 0 && (
                      <div>
                        <span className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                          Gene Ontology (GO) Annotations:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {c.goAnnotations.map((go, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[11px]"
                            >
                              {go}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {c.crossReferences && c.crossReferences.length > 0 && (
                      <div>
                        <span className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                          Cross References (PDB / Reactome / IntAct):
                        </span>
                        <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
                          {c.crossReferences.slice(0, 12).map((xref, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 rounded-sm bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                            >
                              {xref}
                            </span>
                          ))}
                          {c.crossReferences.length > 12 && (
                            <span className="text-slate-400 self-center">
                              +{c.crossReferences.length - 12} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="pt-2 flex justify-end">
                      <a
                        href={`https://www.ebi.ac.uk/complexportal/complex/${c.complexId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
                      >
                        <span>Open full entry on Complex Portal</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Bar */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-4 px-1">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Previous
          </button>

          <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
            Page <span className="font-bold text-slate-900 dark:text-white">{page}</span> of{' '}
            <span className="font-bold text-slate-900 dark:text-white">{totalPages}</span>
          </span>

          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* WHOLE COMPLEX VARIANTS MODAL / SLIDE-OVER TABLE */}
      {/* ========================================================================= */}
      {activeComplexForVariants && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50 dark:bg-slate-950/60">
              <div className="flex items-center gap-3 min-w-0">
                <span className="p-2 rounded-xl bg-indigo-600 text-white shadow-sm shrink-0">
                  <Zap className="w-5 h-5 text-amber-300" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                      {activeComplexForVariants.complexId}
                    </span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${getAssemblyBadgeStyle(activeComplexForVariants.assemblyCategory)}`}>
                      {activeComplexForVariants.assemblyCategory}
                    </span>
                    <span className="text-xs text-slate-500 font-semibold">
                      {activeComplexForVariants.species === 'human' ? '👤 Human' : '🍞 Yeast'} Complex
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate mt-0.5">
                    {activeComplexForVariants.name}
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {complexVariantsData && complexVariantsData.variants.length > 0 && (
                  <button
                    onClick={handleExportCsv}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    title="Export filtered variants to CSV"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>Download CSV</span>
                  </button>
                )}

                <button
                  onClick={handleCloseComplexVariants}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Loading State */}
              {loadingComplexVariants && (
                <div className="py-20 text-center space-y-3">
                  <div className="inline-block p-3 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 animate-spin">
                    <RefreshCw className="w-8 h-8" />
                  </div>
                  <h4 className="text-base font-bold text-slate-800 dark:text-slate-200">
                    Querying ClinVar & AlphaMissense across all complex subunits...
                  </h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Retrieving clinical assertions, review star ratings, AlphaMissense pathogenicity scores, and gnomAD frequencies for {activeComplexForVariants.participants.map(p => p.symbol).join(', ')}.
                  </p>
                </div>
              )}

              {/* Error State */}
              {!loadingComplexVariants && variantsError && (
                <div className="p-6 text-center bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl space-y-3">
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">{variantsError}</p>
                  <button
                    onClick={() => handleOpenComplexVariants(activeComplexForVariants)}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {/* Data Loaded Successfully */}
              {!loadingComplexVariants && complexVariantsData && (
                <>
                  {/* Subunit Distribution Summary Bar */}
                  <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-500" />
                        <span className="font-bold text-slate-800 dark:text-slate-200">Complex Subunits & Variant Counts:</span>
                        <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold">
                          {complexVariantsData.totalVariants} Total Variants
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 font-bold text-[11px]">
                          {complexVariantsData.significanceCounts['Pathogenic'] || 0} Pathogenic
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 font-bold text-[11px]">
                          {complexVariantsData.significanceCounts['Likely Pathogenic'] || 0} Likely Path
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold text-[11px]">
                          {complexVariantsData.significanceCounts['Conflicting'] || 0} Conflicting
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold text-[11px]">
                          {complexVariantsData.significanceCounts['VUS'] || 0} VUS
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-[11px]">
                          {complexVariantsData.significanceCounts['Benign'] || 0} Benign
                        </span>
                      </div>
                    </div>

                    {/* Subunit Tabs */}
                    <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-200 dark:border-slate-800">
                      <button
                        onClick={() => { setSelectedSubunitFilter('all'); setVariantTablePage(1); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          selectedSubunitFilter === 'all'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-indigo-300'
                        }`}
                      >
                        All Subunits ({complexVariantsData.totalVariants})
                      </button>

                      {complexVariantsData.subunits.map((sub) => (
                        <button
                          key={sub.symbol}
                          onClick={() => { setSelectedSubunitFilter(sub.symbol); setVariantTablePage(1); }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                            selectedSubunitFilter === sub.symbol
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-indigo-300'
                          }`}
                        >
                          <span>{sub.symbol}</span>
                          {sub.yeastSymbol && sub.yeastSymbol !== sub.symbol && (
                            <span className="text-[10px] opacity-75 font-normal">({sub.yeastSymbol})</span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                            selectedSubunitFilter === sub.symbol ? 'bg-indigo-800/60 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          }`}>
                            {sub.variantCount}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Filter Toolbar inside Modal */}
                  <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between bg-white dark:bg-slate-900">
                    {/* Variant Search */}
                    <div className="relative flex-1 max-w-md">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        value={variantSearchQuery}
                        onChange={(e) => { setVariantSearchQuery(e.target.value); setVariantTablePage(1); }}
                        placeholder="Filter by protein change (p.Arg534Leu), residue, or ClinVar ID..."
                        className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      {variantSearchQuery && (
                        <button
                          onClick={() => { setVariantSearchQuery(''); setVariantTablePage(1); }}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Filter Dropdowns / Pills */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Clinical Significance filter */}
                      <select
                        value={selectedSigFilter}
                        onChange={(e) => { setSelectedSigFilter(e.target.value); setVariantTablePage(1); }}
                        className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="all">All Significances</option>
                        <option value="PATHOGENIC_ALL">Pathogenic & Likely Path</option>
                        <option value="Pathogenic">Pathogenic Only</option>
                        <option value="Likely Pathogenic">Likely Pathogenic Only</option>
                        <option value="CONFLICTING_ONLY">Conflicting (All)</option>
                        <option value="CONFLICTING_PATH_BENIGN">Conflicting (Path vs Benign)</option>
                        <option value="VUS">VUS (Uncertain Significance)</option>
                        <option value="BENIGN_ALL">Benign & Likely Benign</option>
                        <option value="Benign">Benign Only</option>
                      </select>

                      {/* AlphaMissense filter */}
                      <select
                        value={selectedAmFilter}
                        onChange={(e) => { setSelectedAmFilter(e.target.value as any); setVariantTablePage(1); }}
                        className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="all">All AlphaMissense Scores</option>
                        <option value="pathogenic">AM Likely Pathogenic (≥ 0.56)</option>
                        <option value="ambiguous">AM Ambiguous (0.34 - 0.56)</option>
                        <option value="benign">AM Likely Benign (≤ 0.34)</option>
                      </select>
                    </div>
                  </div>

                  {/* Table Results Counter */}
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      Showing <strong className="text-slate-900 dark:text-white">{filteredComplexVariants.length}</strong> matching variants
                      {selectedSubunitFilter !== 'all' && <span> for subunit <strong>{selectedSubunitFilter}</strong></span>}
                    </span>
                    <span>
                      Page {variantTablePage} of {totalVariantPages}
                    </span>
                  </div>

                  {/* Variants Table */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800 uppercase tracking-wider text-[11px]">
                          <tr>
                            <th className="py-3 px-4">Subunit</th>
                            <th className="py-3 px-4">Protein Change</th>
                            <th className="py-3 px-4">ClinVar Significance</th>
                            <th className="py-3 px-4">AlphaMissense</th>
                            <th className="py-3 px-4">gnomAD AF</th>
                            <th className="py-3 px-4">ClinVar Accession</th>
                            <th className="py-3 px-4 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-slate-900">
                          {paginatedComplexVariants.map((v) => {
                            const sigBadgeStyle = getSignificanceBadgeStyle(v.clinicalSignificance);
                            const amBadgeStyle = getAmBadgeStyle(v.amScore);

                            return (
                              <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                {/* Subunit Gene */}
                                <td className="py-3 px-4 whitespace-nowrap">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800">
                                      {v.gene}
                                    </span>
                                    {onSelectGene && (
                                      <button
                                        onClick={() => {
                                          handleCloseComplexVariants();
                                          onSelectGene(v.gene);
                                        }}
                                        className="text-[10px] text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-semibold cursor-pointer underline"
                                        title={`Switch BUDDY active analysis to gene ${v.gene}`}
                                      >
                                        Select Gene
                                      </button>
                                    )}
                                  </div>
                                </td>

                                {/* Protein Change */}
                                <td className="py-3 px-4 font-mono whitespace-nowrap">
                                  <div className="font-bold text-slate-900 dark:text-white">
                                    {v.proteinChange}
                                  </div>
                                  {v.residue > 0 && (
                                    <span className="text-[10px] text-slate-400 font-sans">
                                      Residue {v.residue} ({v.refAA} → {v.targetAA})
                                    </span>
                                  )}
                                </td>

                                {/* Significance & Stars */}
                                <td className="py-3 px-4">
                                  <div className="flex flex-col gap-1 items-start">
                                    <span className={`px-2 py-0.5 rounded-md font-bold text-[11px] border ${sigBadgeStyle}`}>
                                      {v.clinicalSignificance}
                                    </span>
                                    {v.conflictingSummary && (
                                      <span className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold">
                                        {v.conflictingSummary}
                                      </span>
                                    )}
                                    <div className="flex items-center gap-1 text-[10px] text-slate-400">
                                      {v.clinVarStars > 0 ? (
                                        <span className="text-amber-500 font-bold flex items-center">
                                          {'★'.repeat(v.clinVarStars)}
                                          <span className="text-slate-300 dark:text-slate-600">{'★'.repeat(4 - v.clinVarStars)}</span>
                                        </span>
                                      ) : (
                                        <span className="text-slate-400">0 stars</span>
                                      )}
                                      <span className="truncate max-w-[140px]" title={v.reviewStatus}>
                                        ({v.reviewStatus})
                                      </span>
                                    </div>
                                  </div>
                                </td>

                                {/* AlphaMissense */}
                                <td className="py-3 px-4 whitespace-nowrap">
                                  {v.amScore !== null ? (
                                    <div className="flex flex-col gap-0.5">
                                      <span className={`px-1.5 py-0.5 rounded-md font-mono text-xs border inline-block text-center ${amBadgeStyle}`}>
                                        {v.amScore.toFixed(3)}
                                      </span>
                                      {v.amClassification && (
                                        <span className="text-[10px] text-slate-500 font-sans">
                                          {v.amClassification}
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>

                                {/* gnomAD AF */}
                                <td className="py-3 px-4 whitespace-nowrap font-mono">
                                  {v.gnomadFreq !== null ? (
                                    <span>{v.gnomadFreq.toExponential(2)}</span>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>

                                {/* ClinVar Accession */}
                                <td className="py-3 px-4 whitespace-nowrap">
                                  {v.clinVarVariantId ? (
                                    <a
                                      href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${v.clinVarVariantId}/`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="font-mono text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                                      title="Open in NCBI ClinVar"
                                    >
                                      <span>{v.clinVarId || `ID:${v.clinVarVariantId}`}</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  ) : (
                                    <span className="font-mono text-slate-400">{v.clinVarId || '-'}</span>
                                  )}
                                </td>

                                {/* Action */}
                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  {onSelectGeneVariant ? (
                                    <button
                                      onClick={() => {
                                        handleCloseComplexVariants();
                                        onSelectGeneVariant(v.gene, v.hgvs || v.proteinChange, v);
                                      }}
                                      className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition-all flex items-center gap-1 ml-auto cursor-pointer"
                                      title={`Model this exact variant of ${v.gene} into yeast in BUDDY`}
                                    >
                                      <span>Analyze in BUDDY</span>
                                      <ArrowRight className="w-3 h-3" />
                                    </button>
                                  ) : onSelectGene ? (
                                    <button
                                      onClick={() => {
                                        handleCloseComplexVariants();
                                        onSelectGene(v.gene);
                                      }}
                                      className="px-2.5 py-1 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                                    >
                                      <span>Load Gene</span>
                                    </button>
                                  ) : null}
                                </td>
                              </tr>
                            );
                          })}

                          {paginatedComplexVariants.length === 0 && (
                            <tr>
                              <td colSpan={7} className="py-12 text-center text-slate-400">
                                No variants matched your current subunit or clinical significance filter.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Variant Table Pagination */}
                  {totalVariantPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <button
                        onClick={() => setVariantTablePage(Math.max(1, variantTablePage - 1))}
                        disabled={variantTablePage === 1}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Previous
                      </button>

                      <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                        Page <strong className="text-slate-900 dark:text-white">{variantTablePage}</strong> of{' '}
                        <strong className="text-slate-900 dark:text-white">{totalVariantPages}</strong>
                      </span>

                      <button
                        onClick={() => setVariantTablePage(Math.min(totalVariantPages, variantTablePage + 1))}
                        disabled={variantTablePage === totalVariantPages}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        Next
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
