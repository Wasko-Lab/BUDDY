import React, { useMemo, useEffect, useRef, useState } from 'react';
import { Variant, ProteinDomain, ProteinPtm, PtmCategory, FunctionalSite, FunctionalSiteCategory, ProteinInterfaceData, ProteinInterfacePartner, InterfaceResidue } from '../types';
import { isSimilarAA } from '../utils/alignment';
import { fetchProteinDomains, fetchProteinPtms, fetchFunctionalSites, fetchProteinInterfaces } from '../services/api';
import html2canvas from 'html2canvas';
import { Download, Image as ImageIcon, FileText, Palette, Layers, ChevronRight, Sparkles, AlertCircle, Info, X, ExternalLink, Check, Target, Zap, Network } from 'lucide-react';

interface Props {
  humanSeq: string;
  yeastSeq: string;
  variants: Variant[];
  humanName: string;
  yeastName: string;
  selectedResidues?: number[];
  onResidueClick?: (residue: number) => void;
  humanUniProtId?: string | null;
  yeastUniProtId?: string | null;
  proteinDomains?: ProteinDomain[];
  proteinPtms?: ProteinPtm[];
  functionalSites?: FunctionalSite[];
  proteinInterfaces?: ProteinInterfaceData | null;
}

export const AlignmentView: React.FC<Props> = ({ 
  humanSeq, 
  yeastSeq, 
  variants, 
  humanName, 
  yeastName, 
  selectedResidues, 
  onResidueClick,
  humanUniProtId,
  yeastUniProtId,
  proteinDomains,
  proteinPtms,
  functionalSites,
  proteinInterfaces
}) => {
  const LINE_WIDTH = 60;
  const containerRef = useRef<HTMLDivElement>(null);
  const [useBoxshade, setUseBoxshade] = useState(false);
  
  // Domains state: Selectable, default OFF
  const [showDomains, setShowDomains] = useState(false);
  const [domains, setDomains] = useState<ProteinDomain[]>(proteinDomains || []);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);

  // Post-Translational Modifications (PTMs): Selectable, default OFF
  const [showPtms, setShowPtms] = useState(false);
  const [humanPtms, setHumanPtms] = useState<ProteinPtm[]>(proteinPtms || []);
  const [yeastPtms, setYeastPtms] = useState<ProteinPtm[]>([]);
  const [loadingPtms, setLoadingPtms] = useState(false);
  const [selectedPtmCategory, setSelectedPtmCategory] = useState<string | null>(null);
  const [selectedPtm, setSelectedPtm] = useState<ProteinPtm | null>(null);

  // Functional Sites (Active sites, Metal/Ligand binding, SLiMs): Selectable, default OFF
  const [showSites, setShowSites] = useState(false);
  const [humanSites, setHumanSites] = useState<FunctionalSite[]>(functionalSites || []);
  const [yeastSites, setYeastSites] = useState<FunctionalSite[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [selectedSiteCategory, setSelectedSiteCategory] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<FunctionalSite | null>(null);

  // BioGRID & PDBe-KB Structural Interfaces: Selectable, default OFF
  const [showInterfaces, setShowInterfaces] = useState(false);
  const [interfacesData, setInterfacesData] = useState<ProteinInterfaceData | null>(proteinInterfaces || null);
  const [loadingInterfaces, setLoadingInterfaces] = useState(false);
  const [selectedInterfacePartner, setSelectedInterfacePartner] = useState<string | null>(null);
  const [selectedInterfaceResidue, setSelectedInterfaceResidue] = useState<InterfaceResidue | null>(null);
  const [selectedPartnerDetail, setSelectedPartnerDetail] = useState<ProteinInterfacePartner | null>(null);

  // Fetch protein domain annotations from UniProt for human gene or use passed proteinDomains
  useEffect(() => {
    if (proteinDomains && proteinDomains.length > 0) {
      setDomains(proteinDomains);
      return;
    }
    let isMounted = true;
    const loadDomains = async () => {
      const query = humanUniProtId || humanName;
      if (!query || query === 'N/A') {
        setDomains([]);
        return;
      }
      setLoadingDomains(true);
      try {
        const doms = await fetchProteinDomains(query, 'human');
        if (isMounted) {
          setDomains(doms);
        }
      } catch (e) {
        console.warn("Failed to load domains in AlignmentView:", e);
      } finally {
        if (isMounted) setLoadingDomains(false);
      }
    };
    loadDomains();
    return () => { isMounted = false; };
  }, [proteinDomains, humanUniProtId, humanName]);

  // Sync passed proteinPtms prop
  useEffect(() => {
    if (proteinPtms && proteinPtms.length > 0) {
      setHumanPtms(proteinPtms);
    }
  }, [proteinPtms]);

  // Sync passed functionalSites prop
  useEffect(() => {
    if (functionalSites && functionalSites.length > 0) {
      setHumanSites(functionalSites);
    }
  }, [functionalSites]);

  // Sync passed proteinInterfaces prop
  useEffect(() => {
    if (proteinInterfaces) {
      setInterfacesData(proteinInterfaces);
    }
  }, [proteinInterfaces]);

  // Fallback load interfaces from BioGRID & PDBe-KB if not provided via props
  useEffect(() => {
    if (proteinInterfaces) return;
    const querySymbol = humanName;
    const queryUniProt = humanUniProtId;
    if (!querySymbol && !queryUniProt) return;

    let isMounted = true;
    setLoadingInterfaces(true);
    fetchProteinInterfaces(querySymbol, queryUniProt)
      .then(data => {
        if (isMounted && data) {
          setInterfacesData(data);
        }
      })
      .catch(e => console.warn("Failed to fetch protein interfaces in AlignmentView:", e))
      .finally(() => {
        if (isMounted) setLoadingInterfaces(false);
      });
    return () => { isMounted = false; };
  }, [proteinInterfaces, humanName, humanUniProtId]);

  // Fetch PTMs for human and yeast when toggle is on or if not yet loaded
  useEffect(() => {
    if (!showPtms) return;
    let isMounted = true;

    if (humanPtms.length === 0) {
      const queryH = humanUniProtId || humanName;
      if (queryH && queryH !== 'N/A') {
        setLoadingPtms(true);
        fetchProteinPtms(queryH, 'human')
          .then(ptms => {
            if (isMounted) setHumanPtms(ptms);
          })
          .catch(e => console.warn("Failed to fetch human PTMs in AlignmentView:", e))
          .finally(() => {
            if (isMounted) setLoadingPtms(false);
          });
      }
    }

    if (yeastPtms.length === 0 && (yeastUniProtId || yeastName)) {
      const queryY = yeastUniProtId || yeastName;
      if (queryY && queryY !== 'N/A') {
        fetchProteinPtms(queryY, 'yeast')
          .then(ptms => {
            if (isMounted) setYeastPtms(ptms);
          })
          .catch(e => console.warn("Failed to fetch yeast PTMs in AlignmentView:", e));
      }
    }

    return () => { isMounted = false; };
  }, [showPtms, humanUniProtId, humanName, yeastUniProtId, yeastName, humanPtms.length, yeastPtms.length]);

  // Fetch Functional Sites & Motifs for human and yeast when toggle is on or if not yet loaded
  useEffect(() => {
    if (!showSites) return;
    let isMounted = true;

    if (humanSites.length === 0) {
      const queryH = humanUniProtId || humanName;
      if (queryH && queryH !== 'N/A') {
        setLoadingSites(true);
        fetchFunctionalSites(queryH, 'human')
          .then(sites => {
            if (isMounted) setHumanSites(sites);
          })
          .catch(e => console.warn("Failed to fetch human functional sites in AlignmentView:", e))
          .finally(() => {
            if (isMounted) setLoadingSites(false);
          });
      }
    }

    if (yeastSites.length === 0 && (yeastUniProtId || yeastName)) {
      const queryY = yeastUniProtId || yeastName;
      if (queryY && queryY !== 'N/A') {
        fetchFunctionalSites(queryY, 'yeast')
          .then(sites => {
            if (isMounted) setYeastSites(sites);
          })
          .catch(e => console.warn("Failed to fetch yeast functional sites in AlignmentView:", e));
      }
    }

    return () => { isMounted = false; };
  }, [showSites, humanUniProtId, humanName, yeastUniProtId, yeastName, humanSites.length, yeastSites.length]);

  // Map variants to residue positions
  const variantMap = useMemo(() => {
    const map = new Map<number, Variant[]>();
    variants.forEach(v => {
      const list = map.get(v.residue) || [];
      list.push(v);
      map.set(v.residue, list);
    });
    return map;
  }, [variants]);

  // Map PTMs to residue positions (Human)
  const ptmMapH = useMemo(() => {
    const map = new Map<number, ProteinPtm[]>();
    humanPtms.forEach(p => {
      if (selectedPtmCategory && p.category !== selectedPtmCategory) return;
      for (let r = p.start; r <= p.end; r++) {
        const list = map.get(r) || [];
        list.push(p);
        map.set(r, list);
      }
    });
    return map;
  }, [humanPtms, selectedPtmCategory]);

  // Map PTMs to residue positions (Yeast)
  const ptmMapY = useMemo(() => {
    const map = new Map<number, ProteinPtm[]>();
    yeastPtms.forEach(p => {
      if (selectedPtmCategory && p.category !== selectedPtmCategory) return;
      for (let r = p.start; r <= p.end; r++) {
        const list = map.get(r) || [];
        list.push(p);
        map.set(r, list);
      }
    });
    return map;
  }, [yeastPtms, selectedPtmCategory]);

  // Map Functional Sites & Motifs to residue positions (Human)
  const siteMapH = useMemo(() => {
    const map = new Map<number, FunctionalSite[]>();
    humanSites.forEach(s => {
      if (selectedSiteCategory && s.category !== selectedSiteCategory) return;
      for (let r = s.start; r <= s.end; r++) {
        const list = map.get(r) || [];
        list.push(s);
        map.set(r, list);
      }
    });
    return map;
  }, [humanSites, selectedSiteCategory]);

  // Map Functional Sites & Motifs to residue positions (Yeast)
  const siteMapY = useMemo(() => {
    const map = new Map<number, FunctionalSite[]>();
    yeastSites.forEach(s => {
      if (selectedSiteCategory && s.category !== selectedSiteCategory) return;
      for (let r = s.start; r <= s.end; r++) {
        const list = map.get(r) || [];
        list.push(s);
        map.set(r, list);
      }
    });
    return map;
  }, [yeastSites, selectedSiteCategory]);

  // Map BioGRID & PDBe-KB Interface Residues to residue positions (Human)
  const interfaceMap = useMemo(() => {
    const map = new Map<number, InterfaceResidue>();
    if (!interfacesData || !interfacesData.interfaceResidues) return map;
    for (const r of interfacesData.interfaceResidues) {
      map.set(r.residue, r);
    }
    return map;
  }, [interfacesData]);

  // Partner color palette
  const PARTNER_COLOR_PALETTE = [
    '#0284c7', // Sky
    '#7c3aed', // Violet
    '#0d9488', // Teal
    '#c026d3', // Fuchsia
    '#ea580c', // Orange
    '#2563eb', // Blue
    '#059669', // Emerald
    '#d97706', // Amber
    '#db2777', // Pink
    '#4f46e5', // Indigo
  ];

  const partnerColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!interfacesData?.interfacePartners) return map;
    interfacesData.interfacePartners.forEach((p, idx) => {
      if (p.isHomomer) {
        map.set(p.partnerSymbol, '#6366f1'); // Indigo
      } else if (p.isNucleicAcid) {
        map.set(p.partnerSymbol, '#ec4899'); // Pink
      } else {
        map.set(p.partnerSymbol, PARTNER_COLOR_PALETTE[idx % PARTNER_COLOR_PALETTE.length]);
      }
    });
    return map;
  }, [interfacesData]);

  // Aggregate PTM categories and counts
  const ptmCategoryCounts = useMemo(() => {
    const counts = new Map<PtmCategory, { count: number; color: string; badge: string }>();
    const all = [...humanPtms, ...yeastPtms];
    all.forEach(p => {
      const cur = counts.get(p.category) || { count: 0, color: p.color, badge: p.badge };
      cur.count += 1;
      counts.set(p.category, cur);
    });
    return counts;
  }, [humanPtms, yeastPtms]);

  // Aggregate Functional Site categories and counts
  const siteCategoryCounts = useMemo(() => {
    const counts = new Map<FunctionalSiteCategory, { count: number; color: string; label: string; name: string }>();
    const all = [...humanSites, ...yeastSites];
    all.forEach(s => {
      const cur = counts.get(s.category) || { count: 0, color: s.color, label: s.label, name: s.name };
      cur.count += 1;
      counts.set(s.category, cur);
    });
    return counts;
  }, [humanSites, yeastSites]);

  // Jump to residue position in alignment view
  const scrollToResidue = (residue: number, isHuman: boolean = true) => {
    if (!containerRef.current) return;
    const chunkIdx = chunks.findIndex(c => 
      isHuman 
        ? (residue >= c.lineStartH && residue <= c.lineEndH) 
        : (residue >= c.lineStartY && residue <= c.lineEndY)
    );
    if (chunkIdx !== -1) {
      const el = document.getElementById(`alignment-chunk-${chunkIdx}`);
      if (el && containerRef.current) {
        const topPos = el.offsetTop;
        containerRef.current.scrollTo({
          top: topPos - 40,
          behavior: 'smooth'
        });
      }
    }
  };

  // Constants for column widths to ensure perfect alignment
  const LABEL_CLS = "w-24 shrink-0 font-mono text-xs"; 
  const INDEX_CLS = "w-8 text-right mr-2 shrink-0 font-mono text-xs";
  const SEQ_CLS = "tracking-widest font-mono text-xs";

  const chunks = useMemo(() => {
    const result = [];
    let humanPos = 0;
    let yeastPos = 0;

    for (let i = 0; i < humanSeq.length; i += LINE_WIDTH) {
      const sliceH = humanSeq.slice(i, i + LINE_WIDTH);
      const sliceY = yeastSeq.slice(i, i + LINE_WIDTH);
      
      let matchLine = "";
      let markerLine = "";
      let highlightIndicesH: number[] = [];
      const humanChars: { char: string; residue: number | null; isVariant: boolean; isIdentical: boolean; isSimilar: boolean }[] = [];
      const yeastChars: { char: string; residue: number | null; isIdentical: boolean; isSimilar: boolean }[] = [];
      
      const lineStartH = humanPos + 1;
      const lineStartY = yeastPos + 1;

      for (let j = 0; j < sliceH.length; j++) {
        const aaH = sliceH[j];
        const aaY = sliceY[j];
        
        const isResidueH = aaH !== '-';
        const isResidueY = aaY !== '-';

        if (isResidueH) humanPos++;
        if (isResidueY) yeastPos++;

        const currentHumanResidue = isResidueH ? humanPos : null;
        const currentYeastResidue = isResidueY ? yeastPos : null;

        const isIdentical = aaH !== '-' && aaY !== '-' && aaH === aaY;
        const isSimilar = !isIdentical && aaH !== '-' && aaY !== '-' && isSimilarAA(aaH, aaY);
        const isVariant = currentHumanResidue !== null && variantMap.has(currentHumanResidue);

        if (isResidueH && selectedResidues?.includes(humanPos)) {
            highlightIndicesH.push(j);
        }

        humanChars.push({
            char: aaH,
            residue: currentHumanResidue,
            isVariant,
            isIdentical,
            isSimilar
        });

        yeastChars.push({
            char: aaY,
            residue: currentYeastResidue,
            isIdentical,
            isSimilar
        });

        // Match Logic
        if (aaH === '-' || aaY === '-') matchLine += '\u00A0'; // Non-breaking space
        else if (isIdentical) matchLine += '|';
        else if (isSimilar) matchLine += ':';
        else matchLine += '\u00A0'; // Space for mismatch

        // Marker Logic
        if (isResidueH && variantMap.has(humanPos)) {
            const vs = variantMap.get(humanPos);
            markerLine += (vs && vs.length > 1) ? '*' : (vs?.[0].targetAA || 'v');
        } else {
            markerLine += '\u00A0';
        }
      }

      result.push({
        lineStartH,
        lineStartY,
        sliceH,
        humanChars,
        yeastChars,
        sliceY,
        matchLine,
        markerLine,
        lineEndH: humanPos,
        lineEndY: yeastPos,
        highlightIndicesH
      });
    }
    return result;
  }, [humanSeq, yeastSeq, variantMap, selectedResidues]);

  // Auto-scroll to selected residue
  useEffect(() => {
    if (selectedResidues && selectedResidues.length > 0 && containerRef.current) {
      const chunkIdx = chunks.findIndex(c => c.highlightIndicesH.length > 0);
      if (chunkIdx !== -1) {
        const el = document.getElementById(`alignment-chunk-${chunkIdx}`);
        if (el) {
          const container = containerRef.current;
          const topPos = el.offsetTop;
          container.scrollTo({
              top: topPos - (container.clientHeight / 2) + (el.clientHeight / 2),
              behavior: 'smooth'
          });
        }
      }
    }
  }, [selectedResidues, chunks]);

  const handleExportTxt = () => {
    let content = `Alignment: ${humanName} vs ${yeastName}\n\n`;
    chunks.forEach(chunk => {
      content += `${humanName.padEnd(10)} ${chunk.lineStartH.toString().padStart(4)} ${chunk.sliceH} ${chunk.lineEndH}\n`;
      content += `${''.padEnd(10)} ${''.padStart(4)} ${chunk.matchLine}\n`;
      content += `${yeastName.padEnd(10)} ${chunk.lineStartY.toString().padStart(4)} ${chunk.sliceY} ${chunk.lineEndY}\n\n`;
    });
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Alignment_${humanName}_${yeastName}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportImage = async () => {
    if (containerRef.current) {
      const originalOverflow = containerRef.current.style.overflow;
      const originalMaxHeight = containerRef.current.style.maxHeight;
      const originalPosition = containerRef.current.style.position;
      
      containerRef.current.style.overflow = 'visible';
      containerRef.current.style.maxHeight = 'none';
      
      try {
          const canvas = await html2canvas(containerRef.current, {
              backgroundColor: '#0f172a',
              scale: 2,
              logging: false,
              useCORS: true
          });
          
          const link = document.createElement('a');
          link.download = `Alignment_${humanName}_${yeastName}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
      } catch (e) {
          console.error("Export image failed", e);
      } finally {
          containerRef.current.style.overflow = originalOverflow;
          containerRef.current.style.maxHeight = originalMaxHeight;
          containerRef.current.style.position = originalPosition;
      }
    }
  };

  const HighlightSpan: React.FC<{ char: string; onClick?: () => void }> = ({ char, onClick }) => (
    <span 
        onClick={onClick}
        className="bg-emerald-500 text-slate-900 font-bold inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center cursor-pointer overflow-hidden leading-none rounded-xs"
    >
      {char}
    </span>
  );

  const getBoxshadeClass = (isIdentical: boolean, isSimilar: boolean) => {
      if (!useBoxshade) return '';
      if (isIdentical) return 'bg-slate-800 text-white';
      if (isSimilar) return 'bg-slate-300 text-slate-900';
      return '';
  };

  // Helper to get exact 1-letter / color bar representation for functional sites
  const getSiteGlyph = (site: FunctionalSite, res: number | null) => {
    if (!res) return '●';
    const isSpan = site.end > site.start;
    const isStart = res === site.start;
    const isEnd = res === site.end;

    if (site.category === 'ACTIVE_SITE') {
      return 'A'; // 1-letter representation for Active / Catalytic site
    }
    if (site.category === 'METAL_BINDING') {
      return 'M'; // 1-letter for Metal coordination site
    }
    if (site.category === 'BINDING_SITE') {
      return 'B'; // 1-letter for Ligand/Cofactor binding site
    }
    if (site.category === 'SLIM_MOTIF') {
      if (isSpan) {
        if (isStart) {
          if (site.label === 'NLS') return 'N';
          if (site.label === 'NES') return 'E';
          if (site.label === 'DEG') return 'D';
          return 'M';
        }
        if (isEnd) return '▶';
        return '━'; // Continuous color bar across motif span
      }
      return 'M';
    }
    return 'S'; // Other site
  };

  // Helper to get exact 1-letter badge for PTMs
  const getPtmGlyph = (ptm: ProteinPtm) => {
    switch (ptm.category) {
      case 'Phosphorylation': return 'P';
      case 'Acetylation': return 'A';
      case 'Methylation': return 'M';
      case 'Ubiquitination': return 'U';
      case 'SUMOylation': return 'S';
      case 'Glycosylation': return 'G';
      case 'Disulfide': return 'D';
      case 'Lipidation': return 'L';
      default: return 'O';
    }
  };

  // Helper to get exact 1-letter glyph for BioGRID & PDBe-KB 3D contact interface residues
  const getInterfaceGlyph = (intf: InterfaceResidue, selectedPartner: string | null) => {
    const partners = intf.partners || [];
    if (selectedPartner) {
      const match = partners.find(p => p.partnerSymbol === selectedPartner) || (intf.partnerSymbol === selectedPartner ? intf : null);
      if (!match) return null;
      if (match.isHomomer) return 'H';
      if (match.partnerSymbol === 'DNA') return 'D';
      if (match.partnerSymbol === 'RNA') return 'R';
      return match.partnerSymbol ? match.partnerSymbol[0] : 'I';
    }
    if (partners.length > 1) return '*';
    if (partners.length === 1) {
      const p = partners[0];
      if (p.isHomomer) return 'H';
      if (p.partnerSymbol === 'DNA') return 'D';
      if (p.partnerSymbol === 'RNA') return 'R';
      return p.partnerSymbol ? p.partnerSymbol[0] : 'I';
    }
    if (intf.isHomomer) return 'H';
    if (intf.partnerSymbol === 'DNA') return 'D';
    if (intf.partnerSymbol === 'RNA') return 'R';
    return intf.partnerSymbol ? intf.partnerSymbol[0] : 'I';
  };

  const totalPtmsCount = humanPtms.length + yeastPtms.length;
  const totalSitesCount = humanSites.length + yeastSites.length;
  const totalInterfaceResiduesCount = interfacesData?.interfaceResidues?.length || 0;

  return (
    <div ref={containerRef} className={`font-mono text-xs overflow-x-auto bg-white p-4 rounded-xl border border-slate-200 shadow-sm max-h-[580px] overflow-y-auto relative text-slate-600 transition-colors duration-300 ${!useBoxshade ? 'dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300' : ''}`}>
      <div className={`flex justify-between items-center mb-3 sticky top-0 bg-white pb-2 border-b border-slate-200 z-10 transition-colors duration-300 ${!useBoxshade ? 'dark:bg-slate-900 dark:border-slate-700' : ''}`}>
          <div>
              <h3 className={`font-bold text-slate-900 flex items-center gap-2 ${!useBoxshade ? 'dark:text-slate-200' : ''}`}>
                <span>Sequence Alignment</span>
                <span className="text-slate-400 font-normal text-xs">(v = variant, * = multiple variants)</span>
              </h3>
              <div className={`text-[10px] font-normal text-emerald-600 mt-0.5 ${!useBoxshade ? 'dark:text-emerald-500' : ''}`}>
                  Tip: Click on a variant symbol, residue, domain, PTM badge, functional site, or interface to inspect details.
              </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
              {/* Protein Domains Toggle: Selectable, Default OFF */}
              <button 
                  type="button"
                  onClick={() => setShowDomains(!showDomains)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold border transition-all ${
                    showDomains 
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-300 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-700 shadow-xs' 
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600'
                  }`}
                  title="Toggle Protein Domain Annotations on Alignment (Default OFF)"
              >
                  <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span>Domains</span>
                  {loadingDomains ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                  ) : (
                    <span className={`w-1.5 h-1.5 rounded-full ${showDomains ? 'bg-indigo-600 dark:bg-indigo-400' : 'bg-slate-400'}`} />
                  )}
              </button>

              {/* Functional Sites Toggle: Active sites, Metal/Ligand binding, SLiMs (Selectable, Default OFF) */}
              <button 
                  type="button"
                  onClick={() => setShowSites(!showSites)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold border transition-all ${
                    showSites 
                      ? 'bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-700 shadow-xs ring-1 ring-purple-400/50' 
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600'
                  }`}
                  title="Toggle Active/Catalytic Sites, Metal/Ligand Binding, & SLiM Motifs (Default OFF)"
              >
                  <Target className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                  <span>Sites & Motifs</span>
                  {loadingSites ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
                  ) : (
                    <span className={`w-1.5 h-1.5 rounded-full ${showSites ? 'bg-purple-500 shadow-[0_0_6px_rgba(168,85,247,0.6)]' : 'bg-slate-400'}`} />
                  )}
              </button>

              {/* Post-Translational Modifications (PTM) Toggle: Selectable, Default OFF */}
              <button 
                  type="button"
                  onClick={() => setShowPtms(!showPtms)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold border transition-all ${
                    showPtms 
                      ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-700 shadow-xs ring-1 ring-amber-400/50' 
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600'
                  }`}
                  title="Toggle UniProt Post-Translational Modification (PTM) Overlay on Alignment (Default OFF)"
              >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>PTMs</span>
                  {loadingPtms ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                  ) : (
                    <span className={`w-1.5 h-1.5 rounded-full ${showPtms ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]' : 'bg-slate-400'}`} />
                  )}
              </button>

              {/* BioGRID & PDBe-KB Structural Interfaces Toggle: Selectable, Default OFF */}
              <button 
                  type="button"
                  onClick={() => setShowInterfaces(!showInterfaces)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold border transition-all ${
                    showInterfaces 
                      ? 'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/70 dark:text-sky-300 dark:border-sky-700 shadow-xs ring-1 ring-sky-400/50' 
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600'
                  }`}
                  title="Toggle BioGRID Interacting Partners & PDBe-KB 3D Contact Interfaces (Default OFF)"
              >
                  <Network className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span>Interfaces</span>
                  {loadingInterfaces ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                  ) : (
                    <span className={`w-1.5 h-1.5 rounded-full ${showInterfaces ? 'bg-sky-500 shadow-[0_0_6px_rgba(14,165,233,0.6)]' : 'bg-slate-400'}`} />
                  )}
              </button>

              <button 
                  onClick={() => setUseBoxshade(!useBoxshade)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${useBoxshade ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600'}`}
                  title="Toggle Boxshade Style"
              >
                  <Palette className="w-3 h-3" /> Boxshade
              </button>
              <button 
                  onClick={handleExportTxt}
                  className={`flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-xs border border-slate-300 transition-colors ${!useBoxshade ? 'dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-600' : ''}`}
                  title="Export as Text"
              >
                  <FileText className="w-3 h-3" /> TXT
              </button>
              <button 
                  onClick={handleExportImage}
                  className={`flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-xs border border-slate-300 transition-colors ${!useBoxshade ? 'dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-600' : ''}`}
                  title="Export as Image"
              >
                  <ImageIcon className="w-3 h-3" /> IMG
              </button>
          </div>
      </div>

      {/* Protein Domains Legend Bar (Shown when Domains toggle is ON) */}
      {showDomains && domains.length > 0 && (
        <div className="mb-3 px-3 py-2 bg-gradient-to-r from-indigo-50/80 via-slate-50 to-purple-50/80 dark:from-indigo-950/40 dark:via-slate-900/60 dark:to-purple-950/40 rounded-lg border border-indigo-200/70 dark:border-indigo-800/60 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-indigo-950 dark:text-indigo-200 flex items-center gap-1 shrink-0">
            <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>Annotated Domains:</span>
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {domains.map(dom => {
              const isSelected = selectedDomainId === dom.id;
              return (
                <button
                  key={dom.id}
                  type="button"
                  onClick={() => setSelectedDomainId(isSelected ? null : dom.id)}
                  className={`px-2 py-0.5 rounded text-xs font-medium border flex items-center gap-1.5 transition-all ${
                    isSelected 
                      ? 'ring-2 ring-indigo-500 font-bold bg-white text-slate-900 dark:bg-slate-800 dark:text-white border-indigo-400 shadow-xs' 
                      : 'bg-white/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                  }`}
                  style={{ borderLeftColor: dom.color, borderLeftWidth: '3px' }}
                  title={`${dom.name} (${dom.type}, ${dom.start}–${dom.end})`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dom.color }} />
                  <span>{dom.name}</span>
                  <span className="text-[10px] opacity-70 font-mono">({dom.start}–{dom.end})</span>
                </button>
              );
            })}
            {selectedDomainId && (
              <button
                type="button"
                onClick={() => setSelectedDomainId(null)}
                className="text-[10px] text-slate-400 hover:text-slate-600 underline ml-1"
              >
                Clear Filter
              </button>
            )}
          </div>
        </div>
      )}

      {/* Functional Sites & Motifs Legend & Filter Bar (Shown when Sites toggle is ON) */}
      {showSites && (
        <div className="mb-3 px-3 py-2 bg-gradient-to-r from-purple-50/90 via-violet-50/50 to-fuchsia-50/80 dark:from-purple-950/40 dark:via-slate-900/60 dark:to-fuchsia-950/40 rounded-lg border border-purple-200/80 dark:border-purple-800/60 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-purple-950 dark:text-purple-200 flex items-center gap-1.5 shrink-0">
                <Target className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                <span>Functional Sites & Motifs</span>
                <span className="text-[11px] font-normal text-purple-700/80 dark:text-purple-300/80">
                  ({humanSites.length} human sites{yeastSites.length > 0 ? `, ${yeastSites.length} yeast` : ''}):
                </span>
              </span>

              {/* Category Filter Chips */}
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedSiteCategory(null)}
                  className={`px-2 py-0.5 rounded text-xs font-bold border transition-all ${
                    selectedSiteCategory === null
                      ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                      : 'bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-purple-50'
                  }`}
                >
                  All ({totalSitesCount})
                </button>
                {Array.from(siteCategoryCounts.entries()).map(([cat, meta]) => {
                  const isCatSelected = selectedSiteCategory === cat;
                  const icon = cat === 'ACTIVE_SITE' ? '⚡' : cat === 'METAL_BINDING' ? '🧲' : cat === 'BINDING_SITE' ? '🔗' : cat === 'SLIM_MOTIF' ? '🎯' : '🏷️';
                  const badgeChar = cat === 'ACTIVE_SITE' ? 'A' : cat === 'METAL_BINDING' ? 'M' : cat === 'BINDING_SITE' ? 'B' : cat === 'SLIM_MOTIF' ? 'N/━' : 'S';
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedSiteCategory(isCatSelected ? null : cat)}
                      className={`px-2 py-0.5 rounded text-xs font-medium border flex items-center gap-1 transition-all ${
                        isCatSelected
                          ? 'ring-2 ring-purple-500 font-bold bg-white text-slate-900 dark:bg-slate-800 dark:text-white border-purple-400 shadow-xs'
                          : 'bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                      title={`Filter by ${meta.name} (${meta.count} sites)`}
                    >
                      <span 
                        className="px-1 text-[10px] font-bold rounded text-white shrink-0 min-w-[14px] text-center" 
                        style={{ backgroundColor: meta.color }}
                      >
                        {badgeChar}
                      </span>
                      <span>{icon} {meta.name.split('(')[0].trim()}</span>
                      <span className="text-[10px] opacity-70 font-mono">({meta.count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {loadingSites && (
              <span className="text-[11px] text-purple-700 dark:text-purple-300 flex items-center gap-1 shrink-0 font-medium">
                <span className="w-2 h-2 rounded-full bg-purple-500 animate-ping"></span>
                Fetching UniProt Sites & SLiMs...
              </span>
            )}
          </div>

          {/* Selected Site Inspector Callout */}
          {selectedSite && (
            <div className="mt-2.5 p-2 bg-white/95 dark:bg-slate-800/95 rounded border border-purple-300 dark:border-purple-700 shadow-xs flex flex-wrap items-center justify-between gap-2 text-slate-800 dark:text-slate-200">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span 
                  className="px-2 py-0.5 rounded text-white font-bold text-xs" 
                  style={{ backgroundColor: selectedSite.color }}
                >
                  {selectedSite.label} • {selectedSite.name}
                </span>
                <span className="font-bold text-slate-900 dark:text-white">
                  Residue {selectedSite.aminoAcid ? `${selectedSite.aminoAcid} ` : ''}({selectedSite.start}{selectedSite.end !== selectedSite.start ? `–${selectedSite.end}` : ''})
                </span>
                <span className="text-slate-700 dark:text-slate-300">
                  {selectedSite.description}
                </span>
                {selectedSite.ligand && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 font-semibold rounded">
                    Ligand: {selectedSite.ligand}
                  </span>
                )}
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded font-mono">
                  {selectedSite.source === 'yeast' ? `Yeast (${yeastName})` : `Human (${humanName})`}
                </span>
                {/* Variant Overlap Warning */}
                {selectedSite.source === 'human' && (
                  Array.from({ length: selectedSite.end - selectedSite.start + 1 }, (_, k) => selectedSite.start + k).some(r => variantMap.has(r))
                ) && (
                  <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300 rounded text-xs font-bold flex items-center gap-1 border border-red-300 dark:border-red-700 animate-pulse">
                    <AlertCircle className="w-3.5 h-3.5" />
                    ClinVar Mutation Disrupts This Functional Site!
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => scrollToResidue(selectedSite.start, selectedSite.source === 'human')}
                  className="text-xs font-bold text-purple-700 hover:text-purple-900 dark:text-purple-300 underline"
                >
                  Jump to Site
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSite(null)}
                  className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="Close Inspector"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Empty notice if finished loading and no functional sites found */}
          {!loadingSites && totalSitesCount === 0 && (
            <div className="mt-1 text-[11px] text-purple-800/80 dark:text-purple-300/80 italic flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>No curated catalytic active sites, metal/ligand binding sites, or SLiM motifs found in UniProt for this sequence.</span>
            </div>
          )}
        </div>
      )}

      {/* Post-Translational Modifications (PTM) Legend & Category Filters Bar (Shown when PTM toggle is ON) */}
      {showPtms && (
        <div className="mb-3 px-3 py-2 bg-gradient-to-r from-amber-50/90 via-orange-50/50 to-yellow-50/80 dark:from-amber-950/40 dark:via-slate-900/60 dark:to-orange-950/40 rounded-lg border border-amber-200/80 dark:border-amber-800/60 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-amber-950 dark:text-amber-200 flex items-center gap-1.5 shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>UniProt PTM Annotations</span>
                <span className="text-[11px] font-normal text-amber-700/80 dark:text-amber-300/80">
                  ({humanPtms.length} human sites{yeastPtms.length > 0 ? `, ${yeastPtms.length} yeast` : ''}):
                </span>
              </span>

              {/* Category Filter Chips */}
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedPtmCategory(null)}
                  className={`px-2 py-0.5 rounded text-xs font-bold border transition-all ${
                    selectedPtmCategory === null
                      ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                      : 'bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-amber-50'
                  }`}
                >
                  All ({totalPtmsCount})
                </button>
                {Array.from(ptmCategoryCounts.entries()).map(([cat, meta]) => {
                  const isCatSelected = selectedPtmCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedPtmCategory(isCatSelected ? null : cat)}
                      className={`px-2 py-0.5 rounded text-xs font-medium border flex items-center gap-1 transition-all ${
                        isCatSelected
                          ? 'ring-2 ring-amber-500 font-bold bg-white text-slate-900 dark:bg-slate-800 dark:text-white border-amber-400 shadow-xs'
                          : 'bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                      title={`Filter by ${cat} (${meta.count} sites)`}
                    >
                      <span 
                        className="px-1 text-[10px] font-bold rounded text-white shrink-0" 
                        style={{ backgroundColor: meta.color }}
                      >
                        {meta.badge}
                      </span>
                      <span>{cat}</span>
                      <span className="text-[10px] opacity-70 font-mono">({meta.count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {loadingPtms && (
              <span className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1 shrink-0 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                Fetching UniProt PTMs...
              </span>
            )}
          </div>

          {/* Selected PTM Inspector Callout */}
          {selectedPtm && (
            <div className="mt-2.5 p-2 bg-white/95 dark:bg-slate-800/95 rounded border border-amber-300 dark:border-amber-700 shadow-xs flex flex-wrap items-center justify-between gap-2 text-slate-800 dark:text-slate-200">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span 
                  className="px-2 py-0.5 rounded text-white font-bold text-xs" 
                  style={{ backgroundColor: selectedPtm.color }}
                >
                  {selectedPtm.badge} {selectedPtm.category}
                </span>
                <span className="font-bold text-slate-900 dark:text-white">
                  Residue {selectedPtm.aminoAcid ? `${selectedPtm.aminoAcid}${selectedPtm.start}` : selectedPtm.start}
                  {selectedPtm.end !== selectedPtm.start ? `–${selectedPtm.end}` : ''}
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  {selectedPtm.description}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded font-mono">
                  {selectedPtm.source === 'yeast' ? `Yeast (${yeastName})` : `Human (${humanName})`}
                </span>
                {selectedPtm.evidenceCount && selectedPtm.evidenceCount > 1 && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    ({selectedPtm.evidenceCount} evidences)
                  </span>
                )}
                {/* Variant Overlap Warning */}
                {selectedPtm.source === 'human' && variantMap.has(selectedPtm.start) && (
                  <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300 rounded text-xs font-bold flex items-center gap-1 border border-red-300 dark:border-red-700 animate-pulse">
                    <AlertCircle className="w-3.5 h-3.5" />
                    ClinVar Variant Overlap!
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => scrollToResidue(selectedPtm.start, selectedPtm.source === 'human')}
                  className="text-xs font-bold text-amber-700 hover:text-amber-900 dark:text-amber-300 underline"
                >
                  Jump to Site
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPtm(null)}
                  className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="Close Inspector"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Empty notice if finished loading and no PTMs found */}
          {!loadingPtms && totalPtmsCount === 0 && (
            <div className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-300/80 italic flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>No experimental or curated post-translational modifications found in UniProt for this sequence.</span>
            </div>
          )}
        </div>
      )}

      {/* BioGRID & PDBe-KB Structural Interfaces Legend & Filter Bar (Shown when Interfaces toggle is ON) */}
      {showInterfaces && (
        <div className="mb-3 px-3 py-2 bg-gradient-to-r from-sky-50/90 via-cyan-50/50 to-blue-50/80 dark:from-sky-950/40 dark:via-slate-900/60 dark:to-blue-950/40 rounded-lg border border-sky-200/80 dark:border-sky-800/60 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sky-950 dark:text-sky-200 flex items-center gap-1.5 shrink-0">
                <Network className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>BioGRID & PDBe-KB Contact Interfaces</span>
                <span className="text-[11px] font-normal text-sky-700/80 dark:text-sky-300/80">
                  ({totalInterfaceResiduesCount} residues across {interfacesData?.interfacePartners?.length || 0} structural complexes, {interfacesData?.partners?.length || 0} BioGRID partners):
                </span>
              </span>

              {/* Partner Filter Chips */}
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => { setSelectedInterfacePartner(null); setSelectedPartnerDetail(null); }}
                  className={`px-2 py-0.5 rounded text-xs font-bold border transition-all ${
                    selectedInterfacePartner === null
                      ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                      : 'bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-sky-50'
                  }`}
                >
                  All ({totalInterfaceResiduesCount})
                </button>
                {(interfacesData?.interfacePartners || []).map((partner) => {
                  const isPartnerSelected = selectedInterfacePartner === partner.partnerSymbol;
                  const color = partnerColorMap.get(partner.partnerSymbol) || '#0284c7';
                  return (
                    <button
                      key={partner.partnerSymbol}
                      type="button"
                      onClick={() => {
                        if (isPartnerSelected) {
                          setSelectedInterfacePartner(null);
                          setSelectedPartnerDetail(null);
                        } else {
                          setSelectedInterfacePartner(partner.partnerSymbol);
                          setSelectedPartnerDetail(partner);
                          setSelectedInterfaceResidue(null);
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-xs font-medium border flex items-center gap-1 transition-all ${
                        isPartnerSelected
                          ? 'ring-2 ring-sky-500 font-bold bg-white text-slate-900 dark:bg-slate-800 dark:text-white border-sky-400 shadow-xs'
                          : 'bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                      title={`${partner.partnerFullName || partner.partnerSymbol} (${partner.residueCount} interface residues, ${partner.bioGridCount} BioGRID interactions)`}
                    >
                      <span 
                        className="w-2 h-2 rounded-full shrink-0" 
                        style={{ backgroundColor: color }}
                      />
                      <span>{partner.partnerSymbol}</span>
                      {partner.bioGridCount > 0 && (
                        <span className="text-[10px] px-1 py-0.2 bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 rounded font-semibold">
                          {partner.bioGridCount} BG
                        </span>
                      )}
                      <span className="text-[10px] opacity-70 font-mono">({partner.residueCount} res)</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {loadingInterfaces && (
              <span className="text-[11px] text-sky-700 dark:text-sky-300 flex items-center gap-1 shrink-0 font-medium">
                <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping"></span>
                Querying BioGRID & PDBe-KB...
              </span>
            )}
          </div>

          {/* Selected Partner / Residue Inspector */}
          {(selectedPartnerDetail || selectedInterfaceResidue) && (
            <div className="mt-2.5 p-2 bg-white/95 dark:bg-slate-800/95 rounded border border-sky-300 dark:border-sky-700 shadow-xs flex flex-wrap items-center justify-between gap-2 text-slate-800 dark:text-slate-200">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {selectedPartnerDetail && (
                  <>
                    <span 
                      className="px-2 py-0.5 rounded text-white font-bold text-xs" 
                      style={{ backgroundColor: partnerColorMap.get(selectedPartnerDetail.partnerSymbol) || '#0284c7' }}
                    >
                      Partner: {selectedPartnerDetail.partnerSymbol}
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {selectedPartnerDetail.partnerFullName || selectedPartnerDetail.partnerSymbol}
                    </span>
                    {selectedPartnerDetail.partnerUniProt && selectedPartnerDetail.partnerUniProt !== 'DNA' && selectedPartnerDetail.partnerUniProt !== 'RNA' && (
                      <a
                        href={`https://www.uniprot.org/uniprotkb/${selectedPartnerDetail.partnerUniProt}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-sky-600 hover:text-sky-800 flex items-center gap-0.5 underline font-mono"
                      >
                        {selectedPartnerDetail.partnerUniProt} <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                    {selectedPartnerDetail.bioGridCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200 font-semibold rounded">
                        BioGRID: {selectedPartnerDetail.bioGridCount} interactions ({selectedPartnerDetail.bioGridExps?.slice(0, 2).join(', ')})
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded font-mono">
                      {selectedPartnerDetail.residueCount} contact residues
                    </span>
                    {selectedPartnerDetail.pdbIds?.length > 0 && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        PDB complexes: {selectedPartnerDetail.pdbIds.slice(0, 5).join(', ')}{selectedPartnerDetail.pdbIds.length > 5 ? ` +${selectedPartnerDetail.pdbIds.length - 5} more` : ''}
                      </span>
                    )}
                    {/* Variant Overlap Check for Partner */}
                    {selectedPartnerDetail.residues.some(r => variantMap.has(r)) && (
                      <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300 rounded text-xs font-bold flex items-center gap-1 border border-red-300 dark:border-red-700 animate-pulse">
                        <AlertCircle className="w-3.5 h-3.5" />
                        ClinVar Mutations at this Contact Interface!
                      </span>
                    )}
                  </>
                )}

                {selectedInterfaceResidue && !selectedPartnerDetail && (
                  <>
                    <span className="px-2 py-0.5 rounded bg-sky-600 text-white font-bold text-xs">
                      Residue {selectedInterfaceResidue.aminoAcid || ''}{selectedInterfaceResidue.residue}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">
                      Interacts with: {(selectedInterfaceResidue.partners || []).map(p => p.partnerSymbol).join(', ') || selectedInterfaceResidue.partnerSymbol}
                    </span>
                    {selectedInterfaceResidue.partners?.some(p => p.bioGridCount && p.bioGridCount > 0) && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200 font-semibold rounded">
                        Supported by BioGRID Evidence
                      </span>
                    )}
                    {/* ClinVar Variant Overlap Check */}
                    {variantMap.has(selectedInterfaceResidue.residue) && (
                      <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300 rounded text-xs font-bold flex items-center gap-1 border border-red-300 dark:border-red-700 animate-pulse">
                        <AlertCircle className="w-3.5 h-3.5" />
                        ClinVar Mutation Alters This Interface Contact Residue!
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedInterfaceResidue && (
                  <button
                    type="button"
                    onClick={() => scrollToResidue(selectedInterfaceResidue.residue, true)}
                    className="text-xs font-bold text-sky-700 hover:text-sky-900 dark:text-sky-300 underline"
                  >
                    Jump to Residue
                  </button>
                )}
                {selectedPartnerDetail && selectedPartnerDetail.residues.length > 0 && (
                  <button
                    type="button"
                    onClick={() => scrollToResidue(selectedPartnerDetail.residues[0], true)}
                    className="text-xs font-bold text-sky-700 hover:text-sky-900 dark:text-sky-300 underline"
                  >
                    Jump to Interface
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setSelectedPartnerDetail(null); setSelectedInterfaceResidue(null); }}
                  className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="Close Inspector"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Empty notice if finished loading and no interfaces found */}
          {!loadingInterfaces && totalInterfaceResiduesCount === 0 && (
            <div className="mt-1 text-[11px] text-sky-800/80 dark:text-sky-300/80 italic flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>No 3D structural interface residues found in PDBe-KB for this protein.</span>
            </div>
          )}
        </div>
      )}

      {chunks.map((chunk, idx) => {
        const hasChunkPtmsH = showPtms && chunk.humanChars.some(item => item.residue && ptmMapH.has(item.residue));
        const hasChunkPtmsY = showPtms && chunk.yeastChars.some(item => item.residue && ptmMapY.has(item.residue));
        const hasChunkSitesH = showSites && chunk.humanChars.some(item => item.residue && siteMapH.has(item.residue));
        const hasChunkSitesY = showSites && chunk.yeastChars.some(item => item.residue && siteMapY.has(item.residue));
        const hasChunkInterfaces = showInterfaces && chunk.humanChars.some(item => item.residue && interfaceMap.has(item.residue));

        return (
          <div key={idx} id={`alignment-chunk-${idx}`} className="mb-6 whitespace-pre">
              {/* Protein Domain Track Row (Selectable, Default ON) */}
              {showDomains && domains.length > 0 && (
                <div className="flex h-5 items-center my-0.5 select-none font-mono">
                  <span className={`${LABEL_CLS} font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1`} title="Annotated Protein Domains">
                    <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    Domain
                  </span>
                  <span className={INDEX_CLS}></span>
                  <span className={`${SEQ_CLS} flex items-center`}>
                    {chunk.humanChars.map((item, i) => {
                      const res = item.residue;
                      if (!res) return <span key={i} className="inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-slate-300 dark:text-slate-700 overflow-hidden leading-none">&nbsp;</span>;
                      
                      const dom = domains.find(d => res >= d.start && res <= d.end);
                      if (!dom) return <span key={i} className="inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-slate-300 dark:text-slate-700 overflow-hidden leading-none">&nbsp;</span>;

                      const isSelected = selectedDomainId === dom.id;
                      const isStart = res === dom.start;
                      const isEnd = res === dom.end;

                      return (
                        <span
                          key={i}
                          onClick={() => setSelectedDomainId(isSelected ? null : dom.id)}
                          className={`inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-xs font-bold cursor-pointer transition-colors overflow-hidden leading-none ${
                            isSelected ? 'bg-indigo-600 text-white z-10' : ''
                          }`}
                          style={{
                            backgroundColor: isSelected ? undefined : `${dom.color}25`,
                            color: isSelected ? '#ffffff' : dom.color,
                            borderTop: `2px solid ${dom.color}`,
                            borderBottom: `2px solid ${dom.color}`,
                            borderLeft: isStart ? `2px solid ${dom.color}` : undefined,
                            borderRight: isEnd ? `2px solid ${dom.color}` : undefined,
                            borderRadius: isStart && isEnd ? '2px' : isStart ? '2px 0 0 2px' : isEnd ? '0 2px 2px 0' : undefined
                          }}
                          title={`Domain: ${dom.name} (${dom.start}–${dom.end}, ${dom.type})`}
                        >
                          {isStart ? '■' : '─'}
                        </span>
                      );
                    })}
                  </span>
                </div>
              )}

              {/* Human PTM Track Row (Shown when PTM toggle is ON) */}
              {showPtms && (hasChunkPtmsH || humanPtms.length > 0) && (
                <div className="flex h-5 items-center my-0.5 select-none font-mono">
                  <span className={`${LABEL_CLS} font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1`} title="Human UniProt Post-Translational Modifications">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    PTM (H)
                  </span>
                  <span className={INDEX_CLS}></span>
                  <span className={`${SEQ_CLS} flex items-center`}>
                    {chunk.humanChars.map((item, i) => {
                      const res = item.residue;
                      const sitePtms = res ? ptmMapH.get(res) : null;
                      if (!sitePtms || sitePtms.length === 0) {
                        return <span key={i} className="inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-slate-300 dark:text-slate-700 overflow-hidden leading-none">&nbsp;</span>;
                      }

                      const primary = sitePtms[0];
                      const isMulti = sitePtms.length > 1;
                      const hasVariant = res !== null && variantMap.has(res);
                      const isPtmSelected = selectedPtm && sitePtms.some(p => p.id === selectedPtm.id);
                      const glyph = isMulti ? '*' : getPtmGlyph(primary);

                      const tooltipText = sitePtms.map(p => 
                        `${p.category} (${p.badge}): ${p.description} [${p.source === 'yeast' ? 'Yeast' : 'Human'} pos ${res}]`
                      ).join(' | ');

                      return (
                        <span
                          key={i}
                          onClick={() => setSelectedPtm(primary)}
                          className={`inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-xs font-bold cursor-pointer transition-transform hover:scale-125 overflow-hidden leading-none ${
                            isPtmSelected ? 'ring-2 ring-amber-400 z-10' : ''
                          } ${hasVariant ? 'ring-1 ring-red-500 animate-pulse' : ''}`}
                          style={{
                            color: primary.color
                          }}
                          title={tooltipText + (hasVariant ? ' • CLINVAR MUTATION AT THIS PTM SITE!' : '')}
                        >
                          {glyph}
                        </span>
                      );
                    })}
                  </span>
                </div>
              )}

              {/* Functional Sites Track Row (Active sites, Metal/Ligand binding, SLiMs) */}
              {showSites && (hasChunkSitesH || humanSites.length > 0) && (
                <div className="flex h-5 items-center my-0.5 select-none font-mono">
                  <span className={`${LABEL_CLS} font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1`} title="Active Sites, Metal/Ligand Binding, & SLiM Motifs">
                    <Target className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                    Site (H)
                  </span>
                  <span className={INDEX_CLS}></span>
                  <span className={`${SEQ_CLS} flex items-center`}>
                    {chunk.humanChars.map((item, i) => {
                      const res = item.residue;
                      const siteMatches = res ? siteMapH.get(res) : null;
                      if (!siteMatches || siteMatches.length === 0) {
                        return <span key={i} className="inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-slate-300 dark:text-slate-700 overflow-hidden leading-none">&nbsp;</span>;
                      }

                      const primary = siteMatches[0];
                      const isMulti = siteMatches.length > 1;
                      const hasVariant = res !== null && variantMap.has(res);
                      const isSiteSelected = selectedSite && siteMatches.some(s => s.id === selectedSite.id);
                      const glyph = isMulti ? '*' : getSiteGlyph(primary, res);

                      const tooltipText = siteMatches.map(s => 
                        `${s.name} (${s.label}): ${s.description}${s.ligand ? ` [Ligand: ${s.ligand}]` : ''} [Human pos ${res}]`
                      ).join(' | ');

                      return (
                        <span
                          key={i}
                          onClick={() => setSelectedSite(primary)}
                          className={`inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-xs font-bold cursor-pointer transition-transform hover:scale-125 overflow-hidden leading-none ${
                            isSiteSelected ? 'ring-2 ring-purple-400 z-10' : ''
                          } ${hasVariant ? 'ring-1 ring-red-500 animate-pulse' : ''}`}
                          style={{
                            color: primary.color
                          }}
                          title={tooltipText + (hasVariant ? ' • CLINVAR MUTATION DIRECTLY ALTERS THIS FUNCTIONAL SITE!' : '')}
                        >
                          {glyph}
                        </span>
                      );
                    })}
                  </span>
                </div>
              )}

              {/* BioGRID & PDBe-KB Interface Track Row (Shown when Interfaces toggle is ON) */}
              {showInterfaces && (hasChunkInterfaces || totalInterfaceResiduesCount > 0) && (
                <div className="flex h-5 items-center my-0.5 select-none font-mono">
                  <span className={`${LABEL_CLS} font-bold text-sky-600 dark:text-sky-400 flex items-center gap-1`} title="BioGRID Interacting Partners & PDBe-KB 3D Interface Residues">
                    <Network className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                    Intf (H)
                  </span>
                  <span className={INDEX_CLS}></span>
                  <span className={`${SEQ_CLS} flex items-center`}>
                    {chunk.humanChars.map((item, i) => {
                      const res = item.residue;
                      const intf = res ? interfaceMap.get(res) : null;
                      if (!intf) {
                        return <span key={i} className="inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-slate-300 dark:text-slate-700 overflow-hidden leading-none">&nbsp;</span>;
                      }

                      const glyph = getInterfaceGlyph(intf, selectedInterfacePartner);
                      if (!glyph) {
                        return <span key={i} className="inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-slate-300 dark:text-slate-700 overflow-hidden leading-none">&nbsp;</span>;
                      }

                      const partners = intf.partners || [];
                      const primaryPartner = selectedInterfacePartner 
                        ? (partners.find(p => p.partnerSymbol === selectedInterfacePartner) || partners[0])
                        : partners[0];
                      const partnerColor = primaryPartner ? (partnerColorMap.get(primaryPartner.partnerSymbol) || '#0284c7') : '#0284c7';
                      const hasVariant = res !== null && variantMap.has(res);
                      const isIntfSelected = (selectedInterfaceResidue && selectedInterfaceResidue.residue === res) || 
                        (selectedPartnerDetail && (partners.some(p => p.partnerSymbol === selectedPartnerDetail.partnerSymbol) || intf.partnerSymbol === selectedPartnerDetail.partnerSymbol));

                      const partnerListStr = partners.map(p => `${p.partnerSymbol}${p.bioGridCount ? ` (${p.bioGridCount} BioGRID)` : ''}${p.pdbIds?.length ? ` [PDB: ${p.pdbIds.slice(0, 3).join(',')}]` : ''}`).join(' | ') || intf.partnerSymbol || 'Interface';
                      const tooltip = `3D Interface residue ${item.char}${res}: ${partnerListStr}${hasVariant ? ' • CLINVAR MUTATION DIRECTLY ALTERS THIS CONTACT INTERFACE!' : ''}`;

                      return (
                        <span
                          key={i}
                          onClick={() => {
                            setSelectedInterfaceResidue(intf);
                            if (primaryPartner) {
                              const partnerDetail = interfacesData?.interfacePartners?.find(p => p.partnerSymbol === primaryPartner.partnerSymbol);
                              if (partnerDetail) setSelectedPartnerDetail(partnerDetail);
                            }
                          }}
                          className={`inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-xs cursor-pointer transition-transform hover:scale-125 overflow-hidden leading-none ${
                            isIntfSelected ? 'font-black underline z-10' : 'font-bold'
                          }`}
                          style={{
                            color: partnerColor
                          }}
                          title={tooltip}
                        >
                          {glyph}
                        </span>
                      );
                    })}
                  </span>
                </div>
              )}

              {/* VUS / Variant Marker Track (Positioned nearest to sequence alignment) */}
              <div className="flex h-5 items-center my-0.5 select-none font-mono">
                  <span className={`${LABEL_CLS} font-bold text-red-600 dark:text-red-400 flex items-center gap-1`} title="ClinVar Variants & VUS Mutations (v = single variant, * = multiple variants, or substituted amino acid)">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                      VUS / Var
                  </span>
                  <span className={INDEX_CLS}></span>
                  <span className={`${SEQ_CLS} text-red-600 font-bold ${!useBoxshade ? 'dark:text-red-400' : ''}`}>
                      {chunk.markerLine.split('').map((char, i) => {
                          const residue = chunk.humanChars[i]?.residue;
                          const isVariant = chunk.humanChars[i]?.isVariant;
                          const isHighlight = chunk.highlightIndicesH.includes(i);

                          const handleClick = () => {
                              if (isVariant && residue && onResidueClick) {
                                  onResidueClick(residue);
                              }
                          };
                          
                          const className = `inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center overflow-hidden leading-none ${isHighlight ? 'bg-emerald-900 text-emerald-200' : ''} ${isVariant ? `cursor-pointer hover:bg-emerald-100 hover:text-emerald-600 rounded-sm font-black ${!useBoxshade ? 'dark:hover:bg-emerald-900 dark:hover:text-emerald-400' : ''}` : ''}`;

                          return (
                               <span key={i} className={className} onClick={handleClick} title={isVariant ? `Select Variant at ${residue}` : undefined}>{char}</span>
                          );
                      })}
                  </span>
              </div>
              
              {/* Human Seq */}
              <div className="flex h-5 items-center">
                  <span className={`${LABEL_CLS} text-slate-500 truncate`} title={humanName}>{humanName}</span>
                  <span className={`${INDEX_CLS} text-slate-400 ${!useBoxshade ? 'dark:text-slate-600' : ''}`}>{chunk.lineStartH}</span>
                  <span className={`${SEQ_CLS} text-slate-800 ${!useBoxshade ? 'dark:text-slate-200' : ''}`}>
                      {chunk.humanChars.map((item, i) => {
                          const isHighlight = chunk.highlightIndicesH.includes(i);
                          const res = item.residue;
                          const dom = (showDomains && res) ? domains.find(d => res >= d.start && res <= d.end) : null;
                          const sitePtms = (showPtms && res) ? ptmMapH.get(res) : null;
                          const primaryPtm = sitePtms && sitePtms.length > 0 ? sitePtms[0] : null;
                          const siteMatches = (showSites && res) ? siteMapH.get(res) : null;
                          const primarySite = siteMatches && siteMatches.length > 0 ? siteMatches[0] : null;
                          const intf = (showInterfaces && res) ? interfaceMap.get(res) : null;
                          
                          const handleClick = () => {
                              if (item.isVariant && item.residue && onResidueClick) {
                                  onResidueClick(item.residue);
                              } else if (primarySite) {
                                  setSelectedSite(primarySite);
                              } else if (primaryPtm) {
                                  setSelectedPtm(primaryPtm);
                              } else if (intf) {
                                  setSelectedInterfaceResidue(intf);
                              }
                          };

                          if (isHighlight) {
                              return <HighlightSpan key={i} char={item.char} onClick={handleClick} />;
                          }

                          const boxshadeClass = getBoxshadeClass(item.isIdentical, item.isSimilar);
                          const domainTitle = dom ? ` • ${dom.name} (${dom.start}–${dom.end})` : '';
                          const siteTitle = primarySite ? ` • Site: ${primarySite.name} (${primarySite.description})` : '';
                          const ptmTitle = primaryPtm ? ` • PTM: ${primaryPtm.category} (${primaryPtm.description})` : '';
                          const intfTitle = intf ? ` • Interface with ${(intf.partners || []).map(p => p.partnerSymbol).join(', ') || intf.partnerSymbol}` : '';

                          const isSiteSelected = Boolean(selectedSite && siteMatches && siteMatches.some(s => s.id === selectedSite.id));
                          const isPtmSelected = Boolean(selectedPtm && sitePtms && sitePtms.some(p => p.id === selectedPtm.id));
                          const isIntfSelected = Boolean(
                            (selectedInterfaceResidue && selectedInterfaceResidue.residue === res) ||
                            (selectedPartnerDetail && intf && ((intf.partners || []).some(p => p.partnerSymbol === selectedPartnerDetail.partnerSymbol) || intf.partnerSymbol === selectedPartnerDetail.partnerSymbol))
                          );

                          // Color styling: pure text and background color changes (NO borders that shift font baselines)
                          let charStyle: React.CSSProperties = {};
                          if (isSiteSelected && selectedSite) {
                            charStyle = {
                              backgroundColor: selectedSite.color,
                              color: '#ffffff',
                              fontWeight: 'bold',
                              borderRadius: '2px'
                            };
                          } else if (isPtmSelected && selectedPtm) {
                            charStyle = {
                              backgroundColor: selectedPtm.color,
                              color: '#ffffff',
                              fontWeight: 'bold',
                              borderRadius: '2px'
                            };
                          } else if (isIntfSelected) {
                            charStyle = {
                              color: '#0284c7',
                              fontWeight: 'bold',
                              textDecoration: 'underline'
                            };
                          } else if (primarySite) {
                            charStyle = {
                              color: primarySite.color,
                              fontWeight: 'bold'
                            };
                          } else if (primaryPtm) {
                            charStyle = {
                              color: primaryPtm.color,
                              fontWeight: 'bold'
                            };
                          } else if (intf) {
                            charStyle = {
                              color: '#0284c7',
                              fontWeight: 'bold'
                            };
                          }

                          const isSelectedOverlay = isSiteSelected || isPtmSelected || isIntfSelected;

                          if (item.isVariant) {
                              const variantStyle: React.CSSProperties = isSiteSelected && selectedSite 
                                ? { backgroundColor: selectedSite.color, color: '#ffffff', fontWeight: 'bold' }
                                : isPtmSelected && selectedPtm
                                ? { backgroundColor: selectedPtm.color, color: '#ffffff', fontWeight: 'bold' }
                                : isIntfSelected
                                ? { color: '#0284c7', fontWeight: 'bold', textDecoration: 'underline' }
                                : primarySite
                                ? { color: primarySite.color, fontWeight: 'bold' }
                                : intf
                                ? { color: '#0284c7', fontWeight: 'bold' }
                                : {};

                              return (
                                  <span 
                                      key={i} 
                                      onClick={handleClick}
                                      title={`Click to select variant at ${item.residue}${domainTitle}${siteTitle}${ptmTitle}${intfTitle}`}
                                      className={`cursor-pointer font-black text-emerald-600 hover:text-black hover:bg-emerald-200 rounded-sm transition-colors inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center overflow-hidden leading-none ${!isSelectedOverlay ? boxshadeClass : ''} ${!useBoxshade ? 'dark:text-emerald-400 dark:hover:text-white dark:hover:bg-emerald-700' : ''}`}
                                      style={variantStyle}
                                  >
                                      {item.char}
                                  </span>
                              );
                          }

                          return (
                            <span 
                              key={i} 
                              onClick={(primarySite || primaryPtm || intf) ? handleClick : undefined}
                              className={`inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center overflow-hidden leading-none ${!isSelectedOverlay ? boxshadeClass : ''} ${(primarySite || primaryPtm || intf) ? 'cursor-pointer hover:bg-rose-100 dark:hover:bg-rose-950/60 font-semibold' : ''}`}
                              title={`${item.char}${item.residue || ''}${domainTitle}${siteTitle}${ptmTitle}${intfTitle}`}
                              style={charStyle}
                            >
                              {item.char}
                            </span>
                          );
                      })}
                  </span>
                  <span className={`w-8 ml-2 text-slate-400 ${!useBoxshade ? 'dark:text-slate-600' : ''}`}>{chunk.lineEndH}</span>
              </div>

              {/* Match Line */}
              {!useBoxshade && (
                  <div className="flex h-5 items-center">
                       <span className={LABEL_CLS}></span>
                       <span className={INDEX_CLS}></span>
                       <span className={`${SEQ_CLS} text-teal-600 font-bold`}>{chunk.matchLine}</span>
                  </div>
              )}

              {/* Yeast Seq */}
              <div className="flex h-5 items-center">
                  <span className={`${LABEL_CLS} text-slate-500 truncate`} title={yeastName}>{yeastName}</span>
                  <span className={`${INDEX_CLS} text-slate-400 ${!useBoxshade ? 'dark:text-slate-600' : ''}`}>{chunk.lineStartY}</span>
                  <span className={`${SEQ_CLS} text-slate-600 ${!useBoxshade ? 'dark:text-slate-400' : ''}`}>
                      {chunk.yeastChars.map((item, i) => {
                          const isHighlight = chunk.highlightIndicesH.includes(i);
                          const boxshadeClass = getBoxshadeClass(item.isIdentical, item.isSimilar);
                          const yRes = item.residue;
                          const sitePtmsY = (showPtms && yRes) ? ptmMapY.get(yRes) : null;
                          const primaryPtmY = sitePtmsY && sitePtmsY.length > 0 ? sitePtmsY[0] : null;
                          const siteMatchesY = (showSites && yRes) ? siteMapY.get(yRes) : null;
                          const primarySiteY = siteMatchesY && siteMatchesY.length > 0 ? siteMatchesY[0] : null;

                          const isSiteSelectedY = Boolean(selectedSite && siteMatchesY && siteMatchesY.some(s => s.id === selectedSite.id));
                          const isPtmSelectedY = Boolean(selectedPtm && sitePtmsY && sitePtmsY.some(p => p.id === selectedPtm.id));

                          let charStyleY: React.CSSProperties = {};
                          if (isSiteSelectedY && selectedSite) {
                            charStyleY = {
                              backgroundColor: selectedSite.color,
                              color: '#ffffff',
                              fontWeight: 'bold',
                              borderRadius: '2px'
                            };
                          } else if (isPtmSelectedY && selectedPtm) {
                            charStyleY = {
                              backgroundColor: selectedPtm.color,
                              color: '#ffffff',
                              fontWeight: 'bold',
                              borderRadius: '2px'
                            };
                          } else if (primarySiteY) {
                            charStyleY = {
                              color: primarySiteY.color,
                              fontWeight: 'bold'
                            };
                          } else if (primaryPtmY) {
                            charStyleY = {
                              color: primaryPtmY.color,
                              fontWeight: 'bold'
                            };
                          }
                          
                          if (isHighlight) {
                              return <span key={i} className="bg-emerald-900 text-emerald-200 font-bold inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center overflow-hidden leading-none rounded-xs">{item.char}</span>;
                          }

                          const isSelectedOverlayY = isSiteSelectedY || isPtmSelectedY;
                          
                          return (
                            <span 
                              key={i} 
                              onClick={primarySiteY ? () => setSelectedSite(primarySiteY) : (primaryPtmY ? () => setSelectedPtm(primaryPtmY) : undefined)}
                              className={`inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center overflow-hidden leading-none ${!isSelectedOverlayY ? boxshadeClass : ''} ${(primarySiteY || primaryPtmY) ? 'cursor-pointer hover:bg-rose-100 dark:hover:bg-rose-950/60 font-semibold' : ''}`}
                              title={primarySiteY ? `${item.char}${yRes || ''} • Yeast Site: ${primarySiteY.name} (${primarySiteY.description})` : (primaryPtmY ? `${item.char}${yRes || ''} • Yeast PTM: ${primaryPtmY.category} (${primaryPtmY.description})` : undefined)}
                              style={charStyleY}
                            >
                              {item.char}
                            </span>
                          );
                      })}
                  </span>
                  <span className={`w-8 ml-2 text-slate-400 ${!useBoxshade ? 'dark:text-slate-600' : ''}`}>{chunk.lineEndY}</span>
              </div>

              {/* Yeast Functional Sites Track Row (Shown when Sites toggle is ON and yeast sites exist) */}
              {showSites && (hasChunkSitesY || yeastSites.length > 0) && (
                <div className="flex h-5 items-center my-0.5 select-none font-mono">
                  <span className={`${LABEL_CLS} font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1`} title="Yeast Active Sites, Metal/Ligand Binding, & SLiM Motifs">
                    <Target className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                    Site (Y)
                  </span>
                  <span className={INDEX_CLS}></span>
                  <span className={`${SEQ_CLS} flex items-center`}>
                    {chunk.yeastChars.map((item, i) => {
                      const res = item.residue;
                      const siteMatches = res ? siteMapY.get(res) : null;
                      if (!siteMatches || siteMatches.length === 0) {
                        return <span key={i} className="inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-slate-300 dark:text-slate-700 overflow-hidden leading-none">&nbsp;</span>;
                      }

                      const primary = siteMatches[0];
                      const isMulti = siteMatches.length > 1;
                      const isSiteSelected = selectedSite && siteMatches.some(s => s.id === selectedSite.id);
                      const glyph = isMulti ? '*' : getSiteGlyph(primary, res);

                      const tooltipText = siteMatches.map(s => 
                        `${s.name} (${s.label}): ${s.description}${s.ligand ? ` [Ligand: ${s.ligand}]` : ''} [Yeast pos ${res}]`
                      ).join(' | ');

                      return (
                        <span
                          key={i}
                          onClick={() => setSelectedSite(primary)}
                          className={`inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-xs font-bold cursor-pointer transition-transform hover:scale-125 overflow-hidden leading-none ${
                            isSiteSelected ? 'ring-2 ring-purple-400 z-10' : ''
                          }`}
                          style={{
                            color: primary.color
                          }}
                          title={tooltipText}
                        >
                          {glyph}
                        </span>
                      );
                    })}
                  </span>
                </div>
              )}

              {/* Yeast PTM Track Row (Shown when PTM toggle is ON and yeast PTMs exist) */}
              {showPtms && (hasChunkPtmsY || yeastPtms.length > 0) && (
                <div className="flex h-5 items-center my-0.5 select-none font-mono">
                  <span className={`${LABEL_CLS} font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1`} title="Yeast UniProt Post-Translational Modifications">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    PTM (Y)
                  </span>
                  <span className={INDEX_CLS}></span>
                  <span className={`${SEQ_CLS} flex items-center`}>
                    {chunk.yeastChars.map((item, i) => {
                      const res = item.residue;
                      const sitePtms = res ? ptmMapY.get(res) : null;
                      if (!sitePtms || sitePtms.length === 0) {
                        return <span key={i} className="inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-slate-300 dark:text-slate-700 overflow-hidden leading-none">&nbsp;</span>;
                      }

                      const primary = sitePtms[0];
                      const isMulti = sitePtms.length > 1;
                      const isPtmSelected = selectedPtm && sitePtms.some(p => p.id === selectedPtm.id);
                      const glyph = isMulti ? '*' : getPtmGlyph(primary);

                      const tooltipText = sitePtms.map(p => 
                        `${p.category} (${p.badge}): ${p.description} [Yeast pos ${res}]`
                      ).join(' | ');

                      return (
                        <span
                          key={i}
                          onClick={() => setSelectedPtm(primary)}
                          className={`inline-block w-[1ch] min-w-[1ch] max-w-[1ch] text-center text-xs font-bold cursor-pointer transition-transform hover:scale-125 overflow-hidden leading-none ${
                            isPtmSelected ? 'ring-2 ring-amber-400 z-10' : ''
                          }`}
                          style={{
                            color: primary.color
                          }}
                          title={tooltipText}
                        >
                          {glyph}
                        </span>
                      );
                    })}
                  </span>
                </div>
              )}
          </div>
        );
      })}
    </div>
  );
};
