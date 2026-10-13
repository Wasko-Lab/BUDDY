import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Dna, 
  Search, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Filter, 
  ExternalLink, 
  Target, 
  Sparkles, 
  Layers, 
  ArrowRight, 
  Download, 
  Info, 
  Star, 
  Users, 
  ChevronRight, 
  Check, 
  Activity,
  Maximize2,
  Minimize2,
  X,
  Eye,
  EyeOff,
  MoveHorizontal,
  ChevronLeft
} from 'lucide-react';
import { Variant, ProteinDomain, FunctionalSite, ProteinPtm, ProteinInterfaceData } from '../types';

export interface VariantLandscapeViewerProps {
  geneSymbol: string;
  proteinLength: number;
  variants: Variant[];
  proteinDomains?: ProteinDomain[];
  functionalSites?: FunctionalSite[];
  proteinPtms?: ProteinPtm[];
  proteinInterfaces?: ProteinInterfaceData | null;
  uniprotId?: string | null;
  selectedResidue?: number | null;
  onSelectResidue?: (residue: number, variant?: Variant) => void;
  onJumpToAlignment?: (residue: number) => void;
  onHighlightStructure?: (residue: number) => void;
  onOverlayOnAlignment?: (enabled: boolean) => void;
  isOverlayOnAlignmentActive?: boolean;
  isLoading?: boolean;
  onReload?: () => void;
  onClose?: () => void;
  isDarkMode?: boolean;
}

// Color coding mapping based on user specifications:
// - Dark red: Pathogenic
// - Light red: Likely Pathogenic
// - Yellow: Conflicting
// - Light green: Likely Benign
// - Dark green: Benign
// - Violet/Indigo: VUS (Uncertain Significance)
export const SIGNIFICANCE_COLORS: Record<string, { fill: string; border: string; text: string; bg: string; label: string }> = {
  'Pathogenic': {
    fill: '#b91c1c',        // Dark Red
    border: '#7f1d1d',
    text: '#991b1b',
    bg: '#fee2e2',
    label: 'Pathogenic'
  },
  'Likely Pathogenic': {
    fill: '#ef4444',        // Light Red / Coral
    border: '#b91c1c',
    text: '#dc2626',
    bg: '#fef2f2',
    label: 'Likely Pathogenic'
  },
  'VUS': {
    fill: '#6366f1',        // Violet / Indigo
    border: '#4338ca',
    text: '#4f46e5',
    bg: '#e0e7ff',
    label: 'VUS (Uncertain)'
  },
  'Conflicting': {
    fill: '#eab308',        // Yellow
    border: '#a16207',
    text: '#854d0e',
    bg: '#fef9c3',
    label: 'Conflicting'
  },
  'Likely Benign': {
    fill: '#22c55e',        // Light Green
    border: '#15803d',
    text: '#16a34a',
    bg: '#dcfce7',
    label: 'Likely Benign'
  },
  'Benign': {
    fill: '#15803d',        // Dark Green
    border: '#14532d',
    text: '#166534',
    bg: '#bbf7d0',
    label: 'Benign'
  },
  'Unknown': {
    fill: '#94a3b8',
    border: '#64748b',
    text: '#475569',
    bg: '#f1f5f9',
    label: 'Other / Unclassified'
  }
};

export const getVariantCategory = (sig?: string): string => {
  if (!sig) return 'Unknown';
  const s = sig.toLowerCase();
  if (s.includes('conflicting')) return 'Conflicting';
  if (s === 'pathogenic' || (s.includes('pathogenic') && !s.includes('likely'))) return 'Pathogenic';
  if (s.includes('likely pathogenic')) return 'Likely Pathogenic';
  if (s === 'benign' || (s.includes('benign') && !s.includes('likely'))) return 'Benign';
  if (s.includes('likely benign')) return 'Likely Benign';
  if (s.includes('uncertain') || s.includes('vus')) return 'VUS';
  return 'Unknown';
};

export const VariantLandscapeViewer: React.FC<VariantLandscapeViewerProps> = ({
  geneSymbol,
  proteinLength,
  variants,
  proteinDomains = [],
  functionalSites = [],
  proteinPtms = [],
  proteinInterfaces,
  uniprotId,
  selectedResidue,
  onSelectResidue,
  onJumpToAlignment,
  onHighlightStructure,
  onOverlayOnAlignment,
  isOverlayOnAlignmentActive = false,
  isLoading = false,
  onReload,
  onClose,
  isDarkMode = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1000);

  // Zoom and Pan state
  const [zoomRange, setZoomRange] = useState<[number, number]>([1, Math.max(proteinLength, 100)]);
  const [activeCategories, setActiveCategories] = useState<Record<string, boolean>>({
    'Pathogenic': true,
    'Likely Pathogenic': true,
    'VUS': true,
    'Conflicting': true,
    'Likely Benign': true,
    'Benign': true,
    'Unknown': true
  });

  // AlphaMissense Score Filter
  const [amScoreFilter, setAmScoreFilter] = useState<'all' | 'high' | 'ambiguous' | 'low'>('all');

  // Filter to only Conflicting variants that have Pathogenic AND Benign submissions
  const [onlyPathBenignConflicts, setOnlyPathBenignConflicts] = useState<boolean>(false);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Drag panning state
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [dragStartRange, setDragStartRange] = useState<[number, number]>([1, Math.max(proteinLength, 100)]);
  const plotAreaRef = useRef<HTMLDivElement>(null);

  // Selected Variant state
  const [activeVariant, setActiveVariant] = useState<Variant | null>(null);

  // Fullscreen State
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = async () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      if (containerRef.current?.requestFullscreen) {
        try {
          await containerRef.current.requestFullscreen();
        } catch {
          // Fallback to CSS full-viewport fixed overlay in iframes/safari
        }
      }
    } else {
      setIsFullscreen(false);
      if (document.fullscreenElement && document.exitFullscreen) {
        try {
          await document.exitFullscreen();
        } catch {
          // ignore
        }
      }
    }
  };

  // Keyboard shortcut: ESC to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Sync native fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isFullscreen]);

  // Prevent background scrolling while in full screen mode
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  // Hover Tooltip state
  const [hoveredVariant, setHoveredVariant] = useState<{ variant: Variant; x: number; y: number } | null>(null);
  const [hoveredDomain, setHoveredDomain] = useState<{ domain: ProteinDomain; x: number; y: number } | null>(null);
  const [hoveredSite, setHoveredSite] = useState<{ site: FunctionalSite; x: number; y: number } | null>(null);
  const [hoveredDensityBin, setHoveredDensityBin] = useState<{
    binStart: number;
    binEnd: number;
    total: number;
    pathogenic: number;
    vus: number;
    benign: number;
    x: number;
    y: number;
  } | null>(null);

  // Measure container width responsively
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        if (w > 200) setContainerWidth(w);
      }
    };
    updateWidth();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      observer = new ResizeObserver(() => updateWidth());
      observer.observe(containerRef.current);
    }
    window.addEventListener('resize', updateWidth);
    const timer = setTimeout(updateWidth, 60);
    return () => {
      window.removeEventListener('resize', updateWidth);
      observer?.disconnect();
      clearTimeout(timer);
    };
  }, [isFullscreen]);

  // Update zoom range when proteinLength changes
  useEffect(() => {
    if (proteinLength > 0) {
      setZoomRange([1, proteinLength]);
    }
  }, [proteinLength]);

  // Sync external selectedResidue to activeVariant
  useEffect(() => {
    if (selectedResidue) {
      const match = variants.find(v => v.residue === selectedResidue);
      if (match) {
        setActiveVariant(match);
      }
    }
  }, [selectedResidue, variants]);

  // Categorize and filter variants
  const categorizedVariants = useMemo(() => {
    return variants.map(v => ({
      variant: v,
      category: getVariantCategory(v.clinicalSignificance),
      am: v.amScore
    }));
  }, [variants]);

  // Counts by category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      'Pathogenic': 0,
      'Likely Pathogenic': 0,
      'VUS': 0,
      'Conflicting': 0,
      'Likely Benign': 0,
      'Benign': 0,
      'Unknown': 0
    };
    categorizedVariants.forEach(cv => {
      if (counts[cv.category] !== undefined) {
        counts[cv.category]++;
      } else {
        counts['Unknown']++;
      }
    });
    return counts;
  }, [categorizedVariants]);

  // Count of true Major Conflicting variants (Pathogenic/LP AND Benign/LB entries)
  const pathBenignConflictCount = useMemo(() => {
    return variants.filter(v => v.isConflictingPathBenign).length;
  }, [variants]);

  // Filtered variants to display
  const displayedVariants = useMemo(() => {
    let list = categorizedVariants.filter(cv => activeCategories[cv.category] !== false);

    // Apply strict Pathogenic vs Benign conflicting filter
    if (onlyPathBenignConflicts) {
      list = list.filter(cv => {
        if (cv.category === 'Conflicting') {
          return !!cv.variant.isConflictingPathBenign;
        }
        return true;
      });
    }

    if (amScoreFilter === 'high') {
      list = list.filter(cv => cv.am !== null && cv.am >= 0.56);
    } else if (amScoreFilter === 'ambiguous') {
      list = list.filter(cv => cv.am !== null && cv.am > 0.34 && cv.am < 0.56);
    } else if (amScoreFilter === 'low') {
      list = list.filter(cv => cv.am !== null && cv.am <= 0.34);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(cv => {
        const v = cv.variant;
        return (
          v.proteinChange.toLowerCase().includes(q) ||
          v.residue.toString() === q ||
          v.hgvs.toLowerCase().includes(q) ||
          (v.clinVarId && v.clinVarId.toLowerCase().includes(q))
        );
      });
    }

    return list;
  }, [categorizedVariants, activeCategories, onlyPathBenignConflicts, amScoreFilter, searchQuery]);

  // Coordinates calculation
  const margin = { left: 68, right: 32, top: 24, bottom: 20 };
  const plotWidth = Math.max(containerWidth - margin.left - margin.right, 300);

  // Height allocations
  const scatterHeight = isFullscreen ? 260 : 170;
  const domainTrackHeight = 32;
  const siteTrackHeight = 26;
  const axisHeight = 24;
  const densityHeight = 44;

  const totalSvgHeight = margin.top + scatterHeight + 16 + domainTrackHeight + 10 + siteTrackHeight + 6 + axisHeight + 12 + densityHeight + margin.bottom;

  const [viewStart, viewEnd] = zoomRange;
  const viewSpan = Math.max(viewEnd - viewStart, 1);

  const getX = (res: number) => {
    const clamped = Math.max(viewStart, Math.min(viewEnd, res));
    return margin.left + ((clamped - viewStart) / viewSpan) * plotWidth;
  };

  const getYFromAmScore = (score: number | null) => {
    // If no AM score, place in median ambiguous level (0.50)
    const val = score !== null ? Math.max(0, Math.min(1, score)) : 0.50;
    return margin.top + (1.0 - val) * scatterHeight;
  };

  // Zoom handlers
  const handleZoomIn = () => {
    // If a variant is selected, center zoom around the selected variant residue!
    const center = activeVariant ? activeVariant.residue : (viewStart + viewEnd) / 2;
    const currentSpan = viewEnd - viewStart;
    const newSpan = Math.max(15, currentSpan * 0.6);
    let newStart = Math.round(center - newSpan / 2);
    let newEnd = Math.round(center + newSpan / 2);
    if (newStart < 1) {
      newEnd = Math.min(proteinLength, newEnd + (1 - newStart));
      newStart = 1;
    }
    if (newEnd > proteinLength) {
      newStart = Math.max(1, newStart - (newEnd - proteinLength));
      newEnd = proteinLength;
    }
    setZoomRange([Math.max(1, newStart), Math.min(proteinLength, newEnd)]);
  };

  const handleZoomOut = () => {
    // If a variant is selected, center zoom around the selected variant residue!
    const center = activeVariant ? activeVariant.residue : (viewStart + viewEnd) / 2;
    const currentSpan = viewEnd - viewStart;
    const newSpan = Math.min(proteinLength, currentSpan * 1.6);
    let newStart = Math.round(center - newSpan / 2);
    let newEnd = Math.round(center + newSpan / 2);
    if (newStart < 1) {
      newEnd = Math.min(proteinLength, newEnd + (1 - newStart));
      newStart = 1;
    }
    if (newEnd > proteinLength) {
      newStart = Math.max(1, newStart - (newEnd - proteinLength));
      newEnd = proteinLength;
    }
    setZoomRange([Math.max(1, newStart), Math.min(proteinLength, newEnd)]);
  };

  // Pan handlers (horizontal scroll buttons)
  const handlePanLeft = () => {
    const shift = Math.max(5, Math.round(viewSpan * 0.25));
    const newStart = Math.max(1, viewStart - shift);
    const newEnd = Math.max(newStart + viewSpan, viewEnd - shift);
    setZoomRange([newStart, Math.min(proteinLength, newStart + viewSpan)]);
  };

  const handlePanRight = () => {
    const shift = Math.max(5, Math.round(viewSpan * 0.25));
    const newEnd = Math.min(proteinLength, viewEnd + shift);
    const newStart = Math.max(1, newEnd - viewSpan);
    setZoomRange([newStart, newEnd]);
  };

  const handleResetZoom = () => {
    setZoomRange([1, proteinLength]);
  };

  const handleZoomToDomain = (domain: ProteinDomain) => {
    const pad = Math.max(5, Math.round((domain.end - domain.start) * 0.15));
    const newStart = Math.max(1, domain.start - pad);
    const newEnd = Math.min(proteinLength, domain.end + pad);
    setZoomRange([newStart, newEnd]);
  };

  // Drag and Wheel Event Handlers for Horizontal Navigation
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only initiate drag with left mouse button and if not clicking a clickable child node
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStartX(e.clientX);
    setDragStartRange([...zoomRange]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const deltaPx = e.clientX - dragStartX;
    const deltaResidues = Math.round((deltaPx / plotWidth) * viewSpan);
    if (deltaResidues === 0) return;

    let [start, end] = dragStartRange;
    const span = end - start;
    let newStart = start - deltaResidues;
    let newEnd = end - deltaResidues;

    if (newStart < 1) {
      newStart = 1;
      newEnd = Math.min(proteinLength, 1 + span);
    } else if (newEnd > proteinLength) {
      newEnd = proteinLength;
      newStart = Math.max(1, proteinLength - span);
    }

    setZoomRange([newStart, newEnd]);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Horizontal wheel handler for trackpads and shift+wheel / wheel
  const handleWheel = (e: React.WheelEvent) => {
    // If user holds Ctrl or pinch-zooming
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
      const mouseX = e.clientX - (containerRef.current?.getBoundingClientRect().left || 0) - margin.left;
      const mouseResidue = Math.max(1, Math.min(proteinLength, Math.round(viewStart + (mouseX / plotWidth) * viewSpan)));
      const center = activeVariant ? activeVariant.residue : mouseResidue;
      const newSpan = Math.max(15, Math.min(proteinLength, viewSpan * zoomFactor));
      let newStart = Math.round(center - (mouseX / plotWidth) * newSpan);
      let newEnd = Math.round(newStart + newSpan);
      if (newStart < 1) {
        newStart = 1;
        newEnd = Math.min(proteinLength, Math.round(newStart + newSpan));
      }
      if (newEnd > proteinLength) {
        newEnd = proteinLength;
        newStart = Math.max(1, Math.round(proteinLength - newSpan));
      }
      setZoomRange([newStart, newEnd]);
      return;
    }

    // Horizontal panning via shift+wheel or trackpad deltaX
    const deltaX = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    if (Math.abs(deltaX) > 2) {
      e.preventDefault();
      const deltaResidues = Math.round((deltaX / plotWidth) * viewSpan);
      if (deltaResidues !== 0) {
        let newStart = viewStart + deltaResidues;
        let newEnd = viewEnd + deltaResidues;
        if (newStart < 1) {
          newStart = 1;
          newEnd = Math.min(proteinLength, 1 + viewSpan);
        } else if (newEnd > proteinLength) {
          newEnd = proteinLength;
          newStart = Math.max(1, proteinLength - viewSpan);
        }
        setZoomRange([newStart, newEnd]);
      }
    }
  };

  // Generate tick marks
  const ticks = useMemo(() => {
    const count = Math.min(12, Math.max(5, Math.floor(plotWidth / 80)));
    const step = Math.max(1, Math.ceil(viewSpan / count));
    const niceStep = step < 10 ? 5 : step < 25 ? 10 : step < 50 ? 25 : step < 100 ? 50 : step < 250 ? 100 : step < 500 ? 250 : 500;
    
    const result: number[] = [];
    const firstTick = Math.ceil(viewStart / niceStep) * niceStep;
    for (let pos = firstTick; pos <= viewEnd; pos += niceStep) {
      result.push(pos);
    }
    if (!result.includes(viewStart) && viewStart === 1) result.unshift(1);
    return result;
  }, [viewStart, viewEnd, viewSpan, plotWidth]);

  // Binned density histogram across visible range
  const densityBins = useMemo(() => {
    const numBins = Math.min(50, Math.max(20, Math.floor(plotWidth / 16)));
    const binSize = viewSpan / numBins;
    const bins: { 
      binStart: number; 
      binEnd: number; 
      pathogenic: number; 
      vus: number; 
      benign: number; 
      total: number;
    }[] = [];

    for (let b = 0; b < numBins; b++) {
      const bStart = viewStart + b * binSize;
      const bEnd = bStart + binSize;
      bins.push({
        binStart: bStart,
        binEnd: bEnd,
        pathogenic: 0,
        vus: 0,
        benign: 0,
        total: 0
      });
    }

    displayedVariants.forEach(cv => {
      const res = cv.variant.residue;
      // Strictly enforce valid 1-based residue coordinate within actual protein bounds and viewport
      if (typeof res === 'number' && !isNaN(res) && res >= 1 && res <= proteinLength && res >= viewStart && res <= viewEnd) {
        const binIdx = Math.min(numBins - 1, Math.max(0, Math.floor((res - viewStart) / binSize)));
        const cat = cv.category;
        if (cat === 'Pathogenic' || cat === 'Likely Pathogenic') {
          bins[binIdx].pathogenic++;
        } else if (cat === 'VUS' || cat === 'Conflicting') {
          bins[binIdx].vus++;
        } else if (cat === 'Benign' || cat === 'Likely Benign') {
          bins[binIdx].benign++;
        }
        bins[binIdx].total++;
      }
    });

    const maxTotal = Math.max(1, ...bins.map(b => b.total));
    return { bins, maxTotal, binWidth: plotWidth / numBins };
  }, [displayedVariants, viewStart, viewEnd, viewSpan, plotWidth]);

  // Selected Variant details
  const activeVariantDetails = useMemo(() => {
    if (!activeVariant) return null;
    const res = activeVariant.residue;
    const overlappingDomain = proteinDomains.find(d => res >= d.start && res <= d.end);
    const overlappingSites = functionalSites.filter(s => res >= s.start && res <= s.end);
    const overlappingPtms = proteinPtms.filter(p => res >= p.start && res <= p.end);
    const overlappingInterfaces = proteinInterfaces?.interfaceResidues?.find(ir => ir.residue === res);
    
    return {
      variant: activeVariant,
      category: getVariantCategory(activeVariant.clinicalSignificance),
      domain: overlappingDomain,
      sites: overlappingSites,
      ptms: overlappingPtms,
      interfaces: overlappingInterfaces
    };
  }, [activeVariant, proteinDomains, functionalSites, proteinPtms, proteinInterfaces]);

  // Y-coords for tracks
  const domainTrackY = margin.top + scatterHeight + 16;
  const siteTrackY = domainTrackY + domainTrackHeight + 10;
  const axisY = siteTrackY + siteTrackHeight + 6;
  const densityY = axisY + axisHeight + 12;

  // Toggle category
  const toggleCategory = (cat: string) => {
    setActiveCategories(prev => ({
      ...prev,
      [cat]: !prev[cat]
    }));
  };

  // Export Landscape as CSV
  const handleExportCsv = () => {
    const headers = ['ProteinChange', 'Residue', 'RefAA', 'AltAA', 'ClinicalSignificance', 'ReviewStars', 'ClinVarID', 'AlphaMissenseScore', 'gnomAD_AF'];
    const rows = variants.map(v => [
      v.proteinChange,
      v.residue,
      v.refAA,
      v.targetAA,
      v.clinicalSignificance || '',
      v.clinVarStars || 0,
      v.clinVarId || '',
      v.amScore !== null ? v.amScore : '',
      v.gnomadFreq !== null && v.gnomadFreq !== undefined ? v.gnomadFreq : ''
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${geneSymbol}_Variant_Landscape_${variants.length}_variants.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div 
      ref={containerRef}
      className={`bg-white dark:bg-slate-900 border transition-all duration-200 ${
        isFullscreen
          ? 'fixed inset-0 z-[100] w-screen h-screen rounded-none overflow-y-auto border-transparent shadow-2xl flex flex-col'
          : 'rounded-xl border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden mb-8'
      }`}
      id="variant-landscape-section"
    >
      {/* Header bar */}
      <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 sticky top-0 z-30 backdrop-blur-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                <Dna className="w-5 h-5" />
              </div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>{geneSymbol} Mutational Landscape</span>
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  ({variants.length} mapped variants · 1–{proteinLength} aa)
                </span>
                {isFullscreen && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 uppercase tracking-wider">
                    Full Screen Mode
                  </span>
                )}
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl leading-relaxed">
              Full-gene bird's-eye view mapping ClinVar variants (Pathogenic, VUS, Conflicting, Benign) against AlphaMissense pathogenicity scores and protein domain architecture.
            </p>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {onOverlayOnAlignment && (
              <button
                type="button"
                onClick={() => onOverlayOnAlignment(!isOverlayOnAlignmentActive)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  isOverlayOnAlignmentActive
                    ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750'
                }`}
                title="When enabled, all landscape variants are highlighted on the Boxshade sequence alignment track"
              >
                {isOverlayOnAlignmentActive ? <Eye className="w-3.5 h-3.5 text-emerald-600" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                <span>{isOverlayOnAlignmentActive ? 'Synced to Alignment' : 'Sync to Alignment'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750 transition-colors"
              title="Export all landscape variants as CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            {/* Full Screen Toggle Button */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                isFullscreen
                  ? 'bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700 shadow-xs'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750'
              }`}
              title={isFullscreen ? 'Exit Full Screen (Esc)' : 'Expand Mutational Landscape to Full Screen'}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>Exit Full Screen</span>
                  <kbd className="px-1 py-0.2 text-[9px] bg-indigo-200 dark:bg-indigo-900 border border-indigo-300 dark:border-indigo-700 rounded text-indigo-800 dark:text-indigo-200 font-mono ml-0.5">ESC</kbd>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Full Screen</span>
                </>
              )}
            </button>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                title="Close Landscape Viewer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Filter Controls & Legend Bar */}
        <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          {/* Clinical Significance Legend Toggles */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 mr-1 flex items-center gap-1">
              <Filter className="w-3 h-3 text-slate-400" /> Filter:
            </span>
            {Object.entries(SIGNIFICANCE_COLORS).map(([key, cfg]) => {
              const count = categoryCounts[key] || 0;
              if (key === 'Unknown' && count === 0) return null;
              const isActive = activeCategories[key] !== false;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleCategory(key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
                    isActive 
                      ? 'shadow-2xs' 
                      : 'opacity-40 grayscale hover:opacity-75 bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                  }`}
                  style={isActive ? { 
                    backgroundColor: cfg.bg, 
                    borderColor: cfg.border, 
                    color: cfg.text 
                  } : undefined}
                  title={`Toggle ${cfg.label} (${count} variants)`}
                >
                  <span 
                    className="w-2.5 h-2.5 rounded-full shrink-0" 
                    style={{ backgroundColor: cfg.fill }}
                  />
                  <span>{cfg.label}</span>
                  <span className="text-[10px] opacity-75 font-mono">({count})</span>
                </button>
              );
            })}

            {/* Specialized Sub-Filter: Pathogenic vs Benign Conflicts Only */}
            {categoryCounts['Conflicting'] > 0 && (
              <button
                type="button"
                onClick={() => setOnlyPathBenignConflicts(!onlyPathBenignConflicts)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
                  onlyPathBenignConflicts
                    ? 'bg-gradient-to-r from-red-600 to-emerald-600 text-white border-transparent shadow-xs font-bold'
                    : 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/40'
                }`}
                title="Filter conflicting variants to ONLY those with entries as BENIGN/LIKELY BENIGN AND PATHOGENIC/LIKELY PATHOGENIC (strictly excludes benign + VUS conflicts)"
              >
                <span>⚔️</span>
                <span>Path vs Benign Conflicts Only</span>
                <span className="text-[10px] opacity-80 font-mono">({pathBenignConflictCount})</span>
              </button>
            )}
          </div>

          {/* AlphaMissense Score Preset Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">AM Score:</span>
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setAmScoreFilter('all')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${amScoreFilter === 'all' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setAmScoreFilter('high')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${amScoreFilter === 'high' ? 'bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
                title="AlphaMissense Score ≥ 0.56 (Likely Pathogenic)"
              >
                High (≥0.56)
              </button>
              <button
                type="button"
                onClick={() => setAmScoreFilter('ambiguous')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${amScoreFilter === 'ambiguous' ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
                title="AlphaMissense Score 0.34–0.56 (Ambiguous)"
              >
                Ambiguous
              </button>
              <button
                type="button"
                onClick={() => setAmScoreFilter('low')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${amScoreFilter === 'low' ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
                title="AlphaMissense Score ≤ 0.34 (Likely Benign)"
              >
                Low (≤0.34)
              </button>
            </div>
          </div>
        </div>

        {/* Search & Zoom Toolbar */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
          {/* Domain Quick-Jump Badges */}
          {proteinDomains.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 font-medium">
                <Layers className="w-3.5 h-3.5 text-indigo-500" /> Focus Domain:
              </span>
              {proteinDomains.map((dom, idx) => (
                <button
                  key={`${dom.id}-${idx}`}
                  type="button"
                  onClick={() => handleZoomToDomain(dom)}
                  className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors"
                  title={`Zoom into ${dom.name} (${dom.start}–${dom.end} aa)`}
                >
                  {dom.name} <span className="opacity-75 font-mono">[{dom.start}–{dom.end}]</span>
                </button>
              ))}
            </div>
          )}

          {/* Search residue or mutation */}
          <div className="flex items-center gap-2 ml-auto">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search residue or mutation (e.g. 171)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 rounded-lg text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 w-44 sm:w-56 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  ×
                </button>
              )}
            </div>

            {/* Pan & Zoom Controls */}
            <div className="flex items-center gap-1 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5 bg-white dark:bg-slate-800">
              <button
                type="button"
                onClick={handlePanLeft}
                disabled={viewStart <= 1}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded text-slate-600 dark:text-slate-300 transition-colors"
                title="Scroll left across protein sequence (←)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handlePanRight}
                disabled={viewEnd >= proteinLength}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded text-slate-600 dark:text-slate-300 transition-colors"
                title="Scroll right across protein sequence (→)"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <div className="h-3.5 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />
              <button
                type="button"
                onClick={handleZoomIn}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors"
                title={activeVariant ? `Zoom in centered on variant ${activeVariant.proteinChange} (residue ${activeVariant.residue})` : "Zoom in on sequence"}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors"
                title={activeVariant ? `Zoom out centered on variant ${activeVariant.proteinChange}` : "Zoom out"}
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors"
                title="Reset zoom to full protein (100%)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              {viewSpan < proteinLength && (
                <span className="text-[10px] font-mono font-medium text-indigo-600 dark:text-indigo-400 px-1 select-none">
                  aa {viewStart}–{viewEnd}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main SVG Visualization Container */}
      <div 
        ref={plotAreaRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className={`relative p-2 sm:p-4 overflow-x-auto select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        {isLoading && (
          <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 z-20 flex flex-col items-center justify-center gap-2 backdrop-blur-xs">
            <Activity className="w-6 h-6 text-emerald-500 animate-spin" />
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Fetching all ClinVar variants across categories & AlphaMissense scores...
            </span>
          </div>
        )}

        <svg
          ref={svgRef}
          width={containerWidth}
          height={totalSvgHeight}
          className="overflow-visible font-sans"
        >
          <defs>
            {/* Gradients for AlphaMissense threshold zones */}
            <linearGradient id="pathogenic-zone-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={isDarkMode ? '0.12' : '0.08'} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={isDarkMode ? '0.04' : '0.02'} />
            </linearGradient>
            <linearGradient id="benign-zone-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={isDarkMode ? '0.04' : '0.02'} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={isDarkMode ? '0.12' : '0.08'} />
            </linearGradient>

            {/* Domain gradients */}
            <linearGradient id="domain-gradient-indigo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="domain-gradient-teal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#0d9488" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="domain-gradient-amber" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#d97706" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="domain-gradient-purple" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#9333ea" stopOpacity="0.95" />
            </linearGradient>
          </defs>

          {/* AlphaMissense Background Zones */}
          {/* Pathogenic Zone (AM >= 0.56) */}
          <rect
            x={margin.left}
            y={margin.top}
            width={plotWidth}
            height={(1.0 - 0.56) * scatterHeight}
            fill="url(#pathogenic-zone-gradient)"
          />
          {/* Ambiguous Zone (0.34 < AM < 0.56) */}
          <rect
            x={margin.left}
            y={margin.top + (1.0 - 0.56) * scatterHeight}
            width={plotWidth}
            height={(0.56 - 0.34) * scatterHeight}
            fill={isDarkMode ? '#1e293b' : '#f8fafc'}
            fillOpacity="0.4"
          />
          {/* Benign Zone (AM <= 0.34) */}
          <rect
            x={margin.left}
            y={margin.top + (1.0 - 0.34) * scatterHeight}
            width={plotWidth}
            height={0.34 * scatterHeight}
            fill="url(#benign-zone-gradient)"
          />

          {/* Plot Boundaries */}
          <rect
            x={margin.left}
            y={margin.top}
            width={plotWidth}
            height={scatterHeight}
            fill="none"
            stroke={isDarkMode ? '#334155' : '#e2e8f0'}
            strokeWidth="1"
          />

          {/* AlphaMissense Threshold Cutoff Lines */}
          {/* 0.56 Cutoff */}
          <line
            x1={margin.left}
            y1={margin.top + (1.0 - 0.56) * scatterHeight}
            x2={margin.left + plotWidth}
            y2={margin.top + (1.0 - 0.56) * scatterHeight}
            stroke="#ef4444"
            strokeWidth="1"
            strokeDasharray="4 3"
            strokeOpacity="0.7"
          />
          <text
            x={margin.left + 6}
            y={margin.top + (1.0 - 0.56) * scatterHeight - 4}
            fill="#ef4444"
            fontSize="9"
            fontWeight="bold"
            fontFamily="monospace"
          >
            Pathogenic Cutoff (≥ 0.56)
          </text>

          {/* 0.34 Cutoff */}
          <line
            x1={margin.left}
            y1={margin.top + (1.0 - 0.34) * scatterHeight}
            x2={margin.left + plotWidth}
            y2={margin.top + (1.0 - 0.34) * scatterHeight}
            stroke="#22c55e"
            strokeWidth="1"
            strokeDasharray="4 3"
            strokeOpacity="0.7"
          />
          <text
            x={margin.left + 6}
            y={margin.top + (1.0 - 0.34) * scatterHeight + 11}
            fill="#16a34a"
            fontSize="9"
            fontWeight="bold"
            fontFamily="monospace"
          >
            Benign Cutoff (≤ 0.34)
          </text>

          {/* Y-Axis Label and Ticks */}
          <text
            transform={`rotate(-90) translate(-${margin.top + scatterHeight / 2}, 18)`}
            textAnchor="middle"
            fill={isDarkMode ? '#94a3b8' : '#64748b'}
            fontSize="10"
            fontWeight="bold"
          >
            AlphaMissense Score
          </text>

          {/* Y-axis Ticks: 1.0, 0.75, 0.56, 0.34, 0.0 */}
          {[
            { val: 1.0, label: '1.0' },
            { val: 0.75, label: '0.75' },
            { val: 0.56, label: '0.56' },
            { val: 0.34, label: '0.34' },
            { val: 0.0, label: '0.0' }
          ].map(tick => {
            const yPos = margin.top + (1.0 - tick.val) * scatterHeight;
            return (
              <g key={`y-${tick.val}`}>
                <line
                  x1={margin.left - 5}
                  y1={yPos}
                  x2={margin.left}
                  y2={yPos}
                  stroke={isDarkMode ? '#475569' : '#cbd5e1'}
                  strokeWidth="1"
                />
                <text
                  x={margin.left - 8}
                  y={yPos + 3}
                  textAnchor="end"
                  fill={isDarkMode ? '#94a3b8' : '#64748b'}
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {tick.label}
                </text>
              </g>
            );
          })}

          {/* Protein Domain Vertical Guides through the scatter area */}
          {proteinDomains.map((dom, idx) => {
            if (dom.end < viewStart || dom.start > viewEnd) return null;
            const x1 = Math.max(margin.left, getX(dom.start));
            const x2 = Math.min(margin.left + plotWidth, getX(dom.end));
            return (
              <rect
                key={`dom-guide-${idx}`}
                x={x1}
                y={margin.top}
                width={Math.max(1, x2 - x1)}
                height={scatterHeight}
                fill={idx % 2 === 0 ? '#6366f1' : '#14b8a6'}
                fillOpacity="0.03"
              />
            );
          })}

          {/* Selected Residue Highlight Bar & Stable Pulsing Ring */}
          {activeVariant && activeVariant.residue >= viewStart && activeVariant.residue <= viewEnd && (
            <g>
              {/* Subtle vertical alignment guide */}
              <line
                x1={getX(activeVariant.residue)}
                y1={margin.top}
                x2={getX(activeVariant.residue)}
                y2={axisY + axisHeight}
                stroke="#6366f1"
                strokeWidth="1.5"
                strokeDasharray="3 2"
                strokeOpacity="0.8"
              />
              
              {/* Concentric pulsing radar ring 1 */}
              <circle
                cx={getX(activeVariant.residue)}
                cy={getYFromAmScore(activeVariant.amScore)}
                r="7"
                fill="none"
                stroke="#6366f1"
                strokeWidth="2"
                className="pointer-events-none"
              >
                <animate
                  attributeName="r"
                  values="7;17;21"
                  dur="2s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.85;0.25;0"
                  dur="2s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="stroke-width"
                  values="2;1.5;0.5"
                  dur="2s"
                  repeatCount="indefinite"
                />
              </circle>

              {/* Concentric pulsing radar ring 2 (offset) */}
              <circle
                cx={getX(activeVariant.residue)}
                cy={getYFromAmScore(activeVariant.amScore)}
                r="7"
                fill="none"
                stroke="#818cf8"
                strokeWidth="1.5"
                className="pointer-events-none"
              >
                <animate
                  attributeName="r"
                  values="7;13;17"
                  begin="0.8s"
                  dur="2s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.7;0.2;0"
                  begin="0.8s"
                  dur="2s"
                  repeatCount="indefinite"
                />
              </circle>

              {/* Static crisp halo ring directly surrounding the variant dot */}
              <circle
                cx={getX(activeVariant.residue)}
                cy={getYFromAmScore(activeVariant.amScore)}
                r="9.5"
                fill="none"
                stroke="#6366f1"
                strokeWidth="1.5"
                strokeOpacity="0.85"
                className="pointer-events-none"
              />
            </g>
          )}

          {/* Variant Data Points (Scatter / Lollipop) */}
          {displayedVariants.map((cv, i) => {
            const v = cv.variant;
            if (v.residue < viewStart || v.residue > viewEnd) return null;
            
            const cx = getX(v.residue);
            const cy = getYFromAmScore(v.amScore);
            const cfg = SIGNIFICANCE_COLORS[cv.category] || SIGNIFICANCE_COLORS['Unknown'];
            const isSelected = activeVariant?.residue === v.residue && activeVariant?.proteinChange === v.proteinChange;
            const isHovered = hoveredVariant?.variant === v;

            return (
              <g
                key={`var-${v.residue}-${v.proteinChange}-${i}`}
                className="cursor-pointer"
                onClick={() => {
                  setActiveVariant(v);
                  onSelectResidue?.(v.residue, v);
                }}
                onMouseEnter={(e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  setHoveredVariant({
                    variant: v,
                    x: e.clientX - (rect?.left || 0),
                    y: e.clientY - (rect?.top || 0)
                  });
                }}
                onMouseMove={(e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  setHoveredVariant({
                    variant: v,
                    x: e.clientX - (rect?.left || 0),
                    y: e.clientY - (rect?.top || 0)
                  });
                }}
                onMouseLeave={() => setHoveredVariant(null)}
              >
                {/* Generous stable invisible hit target */}
                <circle
                  cx={cx}
                  cy={cy}
                  r="8"
                  fill="transparent"
                />

                {/* Thin vertical guide stem */}
                <line
                  x1={cx}
                  y1={cy}
                  x2={cx}
                  y2={domainTrackY}
                  stroke={cfg.fill}
                  strokeWidth={isHovered ? '1.5' : '0.8'}
                  strokeOpacity={isSelected ? '0.9' : (isHovered ? '0.7' : '0.25')}
                />

                {/* Variant Node Circle */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 6.5 : (isHovered ? 6 : 4)}
                  fill={cfg.fill}
                  stroke={isSelected || isHovered ? '#ffffff' : cfg.border}
                  strokeWidth={isSelected || isHovered ? 2 : 1}
                  className="transition-all duration-150 pointer-events-none"
                />
              </g>
            );
          })}

          {/* TRACK 2: Protein Domain Architecture Bar */}
          <g transform={`translate(0, ${domainTrackY})`}>
            {/* Background backbone bar */}
            <rect
              x={margin.left}
              y={6}
              width={plotWidth}
              height={14}
              rx={7}
              fill={isDarkMode ? '#1e293b' : '#e2e8f0'}
            />
            <text
              x={margin.left - 8}
              y={18}
              textAnchor="end"
              fill={isDarkMode ? '#94a3b8' : '#64748b'}
              fontSize="10"
              fontWeight="bold"
            >
              Domains
            </text>

            {/* Render Domain Blocks */}
            {proteinDomains.map((dom, idx) => {
              if (dom.end < viewStart || dom.start > viewEnd) return null;
              const x1 = Math.max(margin.left, getX(dom.start));
              const x2 = Math.min(margin.left + plotWidth, getX(dom.end));
              const w = Math.max(4, x2 - x1);
              const paletteGradients = [
                'url(#domain-gradient-indigo)',
                'url(#domain-gradient-teal)',
                'url(#domain-gradient-amber)',
                'url(#domain-gradient-purple)'
              ];
              const gradient = paletteGradients[idx % paletteGradients.length];

              return (
                <g 
                  key={`domain-bar-${dom.id}-${idx}`}
                  className="cursor-pointer group"
                  onClick={() => handleZoomToDomain(dom)}
                  onMouseEnter={(e) => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    setHoveredDomain({
                      domain: dom,
                      x: e.clientX - (rect?.left || 0),
                      y: e.clientY - (rect?.top || 0)
                    });
                  }}
                  onMouseMove={(e) => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    setHoveredDomain({
                      domain: dom,
                      x: e.clientX - (rect?.left || 0),
                      y: e.clientY - (rect?.top || 0)
                    });
                  }}
                  onMouseLeave={() => setHoveredDomain(null)}
                >
                  <rect
                    x={x1}
                    y={2}
                    width={w}
                    height={22}
                    rx={5}
                    fill={gradient}
                    stroke="#ffffff"
                    strokeWidth="1"
                    strokeOpacity="0.4"
                    className="hover:brightness-110 transition-all shadow-sm"
                  />
                  {w > 36 && (
                    <text
                      x={x1 + w / 2}
                      y={16}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="9"
                      fontWeight="bold"
                      className="pointer-events-none select-none truncate"
                    >
                      {dom.name.length > Math.floor(w / 7) ? dom.name.slice(0, Math.floor(w / 7)) + '…' : dom.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* TRACK 3: Functional Sites */}
          <g transform={`translate(0, ${siteTrackY})`}>
            <text
              x={margin.left - 8}
              y={16}
              textAnchor="end"
              fill={isDarkMode ? '#94a3b8' : '#64748b'}
              fontSize="10"
              fontWeight="bold"
            >
              Sites
            </text>

            {/* Backbone guide line */}
            <line
              x1={margin.left}
              y1={12}
              x2={margin.left + plotWidth}
              y2={12}
              stroke={isDarkMode ? '#334155' : '#cbd5e1'}
              strokeWidth="1"
              strokeDasharray="2 2"
            />

            {/* Functional Sites */}
            {functionalSites.map((site, idx) => {
              if (site.end < viewStart || site.start > viewEnd) return null;
              const xPos = getX(site.start);

              const color = site.category === 'ACTIVE_SITE' ? '#ef4444' :
                            site.category === 'BINDING_SITE' ? '#8b5cf6' :
                            site.category === 'METAL_BINDING' ? '#3b82f6' :
                            site.category === 'SLIM_MOTIF' ? '#ec4899' : '#06b6d4';

              const isHovered = hoveredSite?.site === site;
              const siteDisplayName = site.name || site.category || 'Functional Site';

              return (
                <g
                  key={`site-${site.id}-${idx}`}
                  className="cursor-pointer"
                  onClick={() => onSelectResidue?.(site.start)}
                  onMouseEnter={(e) => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    setHoveredSite({
                      site,
                      x: e.clientX - (rect?.left || 0),
                      y: e.clientY - (rect?.top || 0)
                    });
                  }}
                  onMouseMove={(e) => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    setHoveredSite({
                      site,
                      x: e.clientX - (rect?.left || 0),
                      y: e.clientY - (rect?.top || 0)
                    });
                  }}
                  onMouseLeave={() => setHoveredSite(null)}
                >
                  <title>{`${siteDisplayName}${site.description ? `: ${site.description}` : ''} (Residue ${site.start}${site.end !== site.start ? `–${site.end}` : ''})`}</title>
                  {/* Stable generous invisible hit target to prevent jitter */}
                  <circle
                    cx={xPos}
                    cy={12}
                    r="9"
                    fill="transparent"
                  />
                  {/* Visible sphere - expands smoothly in-place without coordinate translation */}
                  <circle
                    cx={xPos}
                    cy={12}
                    r={isHovered ? 6.5 : 4.5}
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth={isHovered ? 2 : 1}
                    className="transition-all duration-150 pointer-events-none"
                  />
                </g>
              );
            })}
          </g>

          {/* TRACK 4: Residue Coordinates Axis */}
          <g transform={`translate(0, ${axisY})`}>
            {/* Axis main line */}
            <line
              x1={margin.left}
              y1={0}
              x2={margin.left + plotWidth}
              y2={0}
              stroke={isDarkMode ? '#475569' : '#94a3b8'}
              strokeWidth="1"
            />

            {/* Tick Marks */}
            {ticks.map(tick => {
              const xPos = getX(tick);
              return (
                <g key={`axis-tick-${tick}`}>
                  <line
                    x1={xPos}
                    y1={0}
                    x2={xPos}
                    y2={6}
                    stroke={isDarkMode ? '#475569' : '#94a3b8'}
                    strokeWidth="1"
                  />
                  <text
                    x={xPos}
                    y={17}
                    textAnchor="middle"
                    fill={isDarkMode ? '#94a3b8' : '#64748b'}
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {tick}
                  </text>
                </g>
              );
            })}
            <text
              x={margin.left + plotWidth + 8}
              y={12}
              fill={isDarkMode ? '#94a3b8' : '#64748b'}
              fontSize="9"
              fontWeight="bold"
            >
              aa
            </text>
          </g>

          {/* TRACK 5: Mutational Density Histogram */}
          <g transform={`translate(0, ${densityY})`}>
            <text
              x={margin.left - 8}
              y={18}
              textAnchor="end"
              fill={isDarkMode ? '#94a3b8' : '#64748b'}
              fontSize="10"
              fontWeight="bold"
            >
              Density
            </text>

            {/* Histogram baseline */}
            <line
              x1={margin.left}
              y1={densityHeight}
              x2={margin.left + plotWidth}
              y2={densityHeight}
              stroke={isDarkMode ? '#334155' : '#e2e8f0'}
              strokeWidth="1"
            />

            {/* Stacked Bars with hover inspection */}
            {densityBins.bins.map((bin, idx) => {
              const xPos = margin.left + idx * densityBins.binWidth;
              const w = Math.max(1, densityBins.binWidth - 1);
              const maxH = densityHeight - 4;
              const totalH = (bin.total / densityBins.maxTotal) * maxH;
              if (totalH <= 0) return null;

              const pathH = (bin.pathogenic / densityBins.maxTotal) * maxH;
              const vusH = (bin.vus / densityBins.maxTotal) * maxH;
              const benH = (bin.benign / densityBins.maxTotal) * maxH;

              const handleBinHover = (e: React.MouseEvent) => {
                const rect = containerRef.current?.getBoundingClientRect();
                setHoveredDensityBin({
                  binStart: Math.round(bin.binStart),
                  binEnd: Math.round(bin.binEnd),
                  total: bin.total,
                  pathogenic: bin.pathogenic,
                  vus: bin.vus,
                  benign: bin.benign,
                  x: e.clientX - (rect?.left || 0),
                  y: e.clientY - (rect?.top || 0)
                });
              };

              return (
                <g 
                  key={`density-bin-${idx}`}
                  className="cursor-pointer"
                  onMouseEnter={handleBinHover}
                  onMouseMove={handleBinHover}
                  onMouseLeave={() => setHoveredDensityBin(null)}
                >
                  {/* Invisible hit-target overlay across entire bin height */}
                  <rect
                    x={xPos}
                    y={0}
                    width={w}
                    height={densityHeight}
                    fill="transparent"
                  />
                  {/* Benign base */}
                  {benH > 0 && (
                    <rect
                      x={xPos}
                      y={densityHeight - benH}
                      width={w}
                      height={benH}
                      fill="#22c55e"
                      fillOpacity="0.75"
                    />
                  )}
                  {/* VUS middle */}
                  {vusH > 0 && (
                    <rect
                      x={xPos}
                      y={densityHeight - benH - vusH}
                      width={w}
                      height={vusH}
                      fill="#6366f1"
                      fillOpacity="0.75"
                    />
                  )}
                  {/* Pathogenic top */}
                  {pathH > 0 && (
                    <rect
                      x={xPos}
                      y={densityHeight - benH - vusH - pathH}
                      width={w}
                      height={pathH}
                      fill="#ef4444"
                      fillOpacity="0.85"
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Floating Tooltip for Variant */}
        {hoveredVariant && (
          <div
            className="absolute z-30 pointer-events-none bg-slate-900 text-white rounded-lg p-3 shadow-xl border border-slate-700 text-xs max-w-xs transition-opacity"
            style={{
              left: Math.min(hoveredVariant.x + 15, containerWidth - 260),
              top: Math.max(10, hoveredVariant.y - 70)
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 mb-1.5">
              <span className="font-bold text-sm text-emerald-400 font-mono">
                {hoveredVariant.variant.proteinChange}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                Residue {hoveredVariant.variant.residue}
              </span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">ClinVar:</span>
                <span 
                  className="font-bold px-1.5 py-0.2 rounded text-[10px]"
                  style={{
                    backgroundColor: (SIGNIFICANCE_COLORS[getVariantCategory(hoveredVariant.variant.clinicalSignificance)] || SIGNIFICANCE_COLORS['Unknown']).bg,
                    color: (SIGNIFICANCE_COLORS[getVariantCategory(hoveredVariant.variant.clinicalSignificance)] || SIGNIFICANCE_COLORS['Unknown']).text
                  }}
                >
                  {hoveredVariant.variant.clinicalSignificance || 'Unclassified'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">AlphaMissense:</span>
                <span className="font-mono font-bold">
                  {hoveredVariant.variant.amScore !== null ? (
                    <span className={hoveredVariant.variant.amScore >= 0.56 ? 'text-red-400' : hoveredVariant.variant.amScore <= 0.34 ? 'text-green-400' : 'text-amber-400'}>
                      {hoveredVariant.variant.amScore.toFixed(3)}
                    </span>
                  ) : 'N/A'}
                </span>
              </div>
              {hoveredVariant.variant.gnomadFreq !== null && hoveredVariant.variant.gnomadFreq !== undefined && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">gnomAD AF:</span>
                  <span className="font-mono text-slate-300">
                    {hoveredVariant.variant.gnomadFreq < 0.001 ? hoveredVariant.variant.gnomadFreq.toExponential(1) : `${(hoveredVariant.variant.gnomadFreq * 100).toFixed(2)}%`}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-2 pt-1 border-t border-slate-800 text-[10px] text-slate-400 italic">
              Click node to select and inspect details.
            </div>
          </div>
        )}

        {/* Floating Tooltip for Domain */}
        {hoveredDomain && (
          <div
            className="absolute z-30 pointer-events-none bg-indigo-950 text-white rounded-lg p-2.5 shadow-xl border border-indigo-800 text-xs max-w-xs"
            style={{
              left: Math.min(hoveredDomain.x + 10, containerWidth - 240),
              top: Math.max(10, hoveredDomain.y - 50)
            }}
          >
            <div className="font-bold text-indigo-300">{hoveredDomain.domain.name}</div>
            <div className="text-[11px] text-slate-300 mt-0.5">
              Coordinates: residues {hoveredDomain.domain.start}–{hoveredDomain.domain.end} ({hoveredDomain.domain.end - hoveredDomain.domain.start + 1} aa)
            </div>
            <div className="text-[10px] text-indigo-400 mt-1 italic">Click domain to zoom in.</div>
          </div>
        )}

        {/* Floating Tooltip for Site */}
        {hoveredSite && (
          <div
            className="absolute z-30 pointer-events-none bg-slate-900/95 backdrop-blur-sm text-white rounded-lg px-3 py-2.5 shadow-xl border border-purple-500/50 text-xs max-w-xs animate-in fade-in duration-150"
            style={{
              left: Math.min(hoveredSite.x + 10, containerWidth - 240),
              top: Math.max(10, hoveredSite.y - 65)
            }}
          >
            <div className="font-bold text-purple-300 text-xs flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
              <span>{hoveredSite.site.name || 'Functional Site'}</span>
            </div>
            {hoveredSite.site.category && hoveredSite.site.category !== hoveredSite.site.name && (
              <div className="text-[10px] text-purple-200/80 font-medium mt-0.5">
                Category: {hoveredSite.site.category}
              </div>
            )}
            {hoveredSite.site.description && (
              <div className="text-[11px] text-slate-300 mt-1 leading-snug">
                {hoveredSite.site.description}
              </div>
            )}
          </div>
        )}

        {/* Floating Tooltip for Density Histogram Bin */}
        {hoveredDensityBin && (
          <div
            className="absolute z-30 pointer-events-none bg-slate-900/95 text-slate-100 p-2.5 rounded-lg shadow-xl border border-slate-700 text-xs backdrop-blur-xs min-w-[190px]"
            style={{
              left: Math.min(hoveredDensityBin.x + 12, containerWidth - 210),
              top: Math.max(10, hoveredDensityBin.y - 85)
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 mb-1.5">
              <span className="font-bold text-xs text-slate-200">
                Residues {hoveredDensityBin.binStart}–{hoveredDensityBin.binEnd}
              </span>
              <span className="font-mono text-xs font-bold text-emerald-400">
                {hoveredDensityBin.total} {hoveredDensityBin.total === 1 ? 'variant' : 'variants'}
              </span>
            </div>
            <div className="space-y-1 text-[11px]">
              {hoveredDensityBin.pathogenic > 0 && (
                <div className="flex items-center justify-between text-red-400">
                  <span>Pathogenic / LP:</span>
                  <span className="font-mono font-bold">{hoveredDensityBin.pathogenic}</span>
                </div>
              )}
              {hoveredDensityBin.vus > 0 && (
                <div className="flex items-center justify-between text-indigo-400">
                  <span>VUS / Conflicting:</span>
                  <span className="font-mono font-bold">{hoveredDensityBin.vus}</span>
                </div>
              )}
              {hoveredDensityBin.benign > 0 && (
                <div className="flex items-center justify-between text-green-400">
                  <span>Benign / LB:</span>
                  <span className="font-mono font-bold">{hoveredDensityBin.benign}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Selected Variant Detail Inspector Card */}
      {activeVariantDetails && (
        <div className="p-4 sm:p-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 transition-colors animate-fade-in">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100">
                  {activeVariantDetails.variant.proteinChange}
                </span>

                {/* Significance Badge */}
                <span 
                  className="px-2.5 py-1 rounded-md text-xs font-bold border"
                  style={{
                    backgroundColor: (SIGNIFICANCE_COLORS[activeVariantDetails.category] || SIGNIFICANCE_COLORS['Unknown']).bg,
                    borderColor: (SIGNIFICANCE_COLORS[activeVariantDetails.category] || SIGNIFICANCE_COLORS['Unknown']).border,
                    color: (SIGNIFICANCE_COLORS[activeVariantDetails.category] || SIGNIFICANCE_COLORS['Unknown']).text
                  }}
                >
                  {activeVariantDetails.variant.clinicalSignificance || 'Unclassified'}
                </span>

                {/* AlphaMissense Score Badge */}
                {activeVariantDetails.variant.amScore !== null && (
                  <span className={`px-2.5 py-1 rounded-md text-xs font-mono font-bold border ${
                    activeVariantDetails.variant.amScore >= 0.56
                      ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                      : activeVariantDetails.variant.amScore <= 0.34
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                      : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                  }`}>
                    AM: {activeVariantDetails.variant.amScore.toFixed(3)} (
                    {activeVariantDetails.variant.amScore >= 0.56 ? 'Likely Pathogenic' : activeVariantDetails.variant.amScore <= 0.34 ? 'Likely Benign' : 'Ambiguous'}
                    )
                  </span>
                )}

                {/* ClinVar Stars */}
                {activeVariantDetails.variant.clinVarStars !== undefined && activeVariantDetails.variant.clinVarStars > 0 && (
                  <span className="flex items-center text-amber-500 text-xs font-semibold gap-0.5">
                    {'★'.repeat(activeVariantDetails.variant.clinVarStars)}
                    <span className="text-slate-400 text-[10px] ml-1">({activeVariantDetails.variant.reviewStatus})</span>
                  </span>
                )}
              </div>

              {/* Metadata row */}
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                <span>Residue {activeVariantDetails.variant.residue} ({activeVariantDetails.variant.refAA} → {activeVariantDetails.variant.targetAA})</span>
                <span aria-hidden="true">·</span>
                {activeVariantDetails.domain ? (
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                    Domain: {activeVariantDetails.domain.name} ({activeVariantDetails.domain.start}–{activeVariantDetails.domain.end})
                  </span>
                ) : (
                  <span>Inter-domain region</span>
                )}
                {activeVariantDetails.sites.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-purple-600 dark:text-purple-400">
                      Site: {activeVariantDetails.sites.map(s => s.name).join(', ')}
                    </span>
                  </>
                )}
                {activeVariantDetails.variant.gnomadFreq !== null && activeVariantDetails.variant.gnomadFreq !== undefined && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>gnomAD AF: {(activeVariantDetails.variant.gnomadFreq * 100).toFixed(3)}%</span>
                  </>
                )}
              </div>
            </div>

            {/* Quick Actions for Selected Variant */}
            <div className="flex items-center gap-2 flex-wrap">
              {onJumpToAlignment && (
                <button
                  type="button"
                  onClick={() => onJumpToAlignment(activeVariantDetails.variant.residue)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs transition-colors"
                  title="Scroll Boxshade Sequence Alignment to this residue"
                >
                  <Target className="w-3.5 h-3.5" />
                  <span>Jump in Alignment</span>
                </button>
              )}

              {onHighlightStructure && (
                <button
                  type="button"
                  onClick={() => onHighlightStructure(activeVariantDetails.variant.residue)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 shadow-xs transition-colors"
                  title="Highlight mutation in Mol* 3D structure viewer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Highlight in 3D</span>
                </button>
              )}

              {activeVariantDetails.variant.clinVarVariantId && (
                <a
                  href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${activeVariantDetails.variant.clinVarVariantId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>NCBI ClinVar</span>
                </a>
              )}

              {uniprotId && (
                <a
                  href={`https://alphamissense.hegelab.org/hotspot?uid=${uniprotId}&resi=${activeVariantDetails.variant.residue}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors"
                  title="View full AlphaMissense mutational heatmap for this residue at Hege Lab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>AM Heatmap</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
