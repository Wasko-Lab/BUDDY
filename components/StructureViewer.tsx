
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Camera, ExternalLink, AlertCircle, RotateCw, Box, Layers, Eye, EyeOff, Palette, Move, MousePointer2, RefreshCw, Check, Database, Save, X, Dna, ChevronDown, Shuffle, Target, Zap, Users, Sparkles, Filter } from 'lucide-react';
import { calculateKabschTransform, applyTransform, Point3D, OverlayAlgorithmType, AlignmentMetrics, OVERLAY_ALGORITHMS, computeSuperposition } from '../utils/superposition';
import { AdvancedSettings, ProteinDomain, FunctionalSite, ProteinPtm, ProteinInterfaceData } from '../types';

declare global {
  interface Window {
    $3Dmol: any;
  }
}

interface Highlight {
  residue: number;
  color: string;
}

interface Props {
  humanUniprot: string | null;
  yeastUniprot: string | null;
  initialSpecies?: 'human' | 'yeast';
  customHighlights: Highlight[];
  highlightsBySpecies?: {
      human: Highlight[];
      yeast: Highlight[];
  };
  alignmentMap?: Map<number, number>; 
  settings?: AdvancedSettings['structure'];
  proteinDomains?: ProteinDomain[];
  functionalSites?: FunctionalSite[];
  proteinPtms?: ProteinPtm[];
  proteinInterfaces?: ProteinInterfaceData | null;
}

type ViewMode = 'human' | 'yeast' | 'overlay';
type Representation = 'cartoon' | 'stick' | 'surface' | 'sphere';

export interface StructureViewerHandle {
  captureImage: () => string | null;
  ensureOverlayEnabled: () => Promise<void>;
}

export const StructureViewer = React.forwardRef<StructureViewerHandle, Props>(({ 
  humanUniprot, 
  yeastUniprot, 
  initialSpecies = 'human',
  customHighlights,
  highlightsBySpecies,
  alignmentMap,
  settings,
  proteinDomains = [],
  functionalSites = [],
  proteinPtms = [],
  proteinInterfaces = null
}, ref) => {
  const [viewMode, setViewMode] = useState<ViewMode>(initialSpecies);
  const [representation, setRepresentation] = useState<Representation>('cartoon');
  const [variantRepresentation, setVariantRepresentation] = useState<Representation>('sphere');
  type FeatureRepresentation = 'cartoon' | 'stick' | 'surface';
  const [siteRepresentation, setSiteRepresentation] = useState<FeatureRepresentation>('stick');
  const [interfaceRepresentation, setInterfaceRepresentation] = useState<FeatureRepresentation>('surface');
  
  // ID State (allows manual override)
  const [activeHumanId, setActiveHumanId] = useState<string | null>(humanUniprot);
  const [activeYeastId, setActiveYeastId] = useState<string | null>(yeastUniprot);
  const [showIdControls, setShowIdControls] = useState(false);
  const [humanInput, setHumanInput] = useState('');
  const [yeastInput, setYeastInput] = useState('');

  // Unified 3D Feature Overlays State (ALL DEFAULT OFF)
  type AnnotationTab = 'sites' | 'ptms' | 'interfaces' | 'domains';
  const [activeAnnotationTab, setActiveAnnotationTab] = useState<AnnotationTab | null>(null);

  // 1. Sites & Motifs State (default OFF)
  const [enabledSiteIds, setEnabledSiteIds] = useState<Set<string>>(new Set());
  const [siteColors, setSiteColors] = useState<Record<string, string>>({});
  const [siteFilterCategory, setSiteFilterCategory] = useState<string>('ALL');

  const toggleSite = (siteId: string) => {
    setEnabledSiteIds(prev => {
      const next = new Set(prev);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
  };

  const enableAllSites = () => {
    setEnabledSiteIds(new Set(functionalSites.map(s => s.id)));
  };

  const disableAllSites = () => {
    setEnabledSiteIds(new Set());
  };

  const toggleSiteCategory = (cat: string) => {
    const catSites = functionalSites.filter(s => s.category === cat);
    const allOn = catSites.length > 0 && catSites.every(s => enabledSiteIds.has(s.id));
    setEnabledSiteIds(prev => {
      const next = new Set(prev);
      catSites.forEach(s => {
        if (allOn) next.delete(s.id);
        else next.add(s.id);
      });
      return next;
    });
  };

  const setCustomSiteColor = (siteId: string, color: string) => {
    setSiteColors(prev => ({ ...prev, [siteId]: color }));
  };

  const focusSite = (s: FunctionalSite) => {
    if (!viewerRef.current) return;
    const v = viewerRef.current;
    if (!enabledSiteIds.has(s.id)) {
      setEnabledSiteIds(prev => new Set([...prev, s.id]));
    }
    const resList: number[] = [];
    for (let r = s.start; r <= s.end; r++) resList.push(r);
    v.zoomTo({ resi: resList });
  };

  // 2. PTMs State (default OFF)
  const [enabledPtmIds, setEnabledPtmIds] = useState<Set<string>>(new Set());
  const [ptmColors, setPtmColors] = useState<Record<string, string>>({});
  const [ptmFilterCategory, setPtmFilterCategory] = useState<string>('ALL');

  const togglePtm = (ptmId: string) => {
    setEnabledPtmIds(prev => {
      const next = new Set(prev);
      if (next.has(ptmId)) next.delete(ptmId);
      else next.add(ptmId);
      return next;
    });
  };

  const enableAllPtms = () => {
    setEnabledPtmIds(new Set(proteinPtms.map(p => p.id)));
  };

  const disableAllPtms = () => {
    setEnabledPtmIds(new Set());
  };

  const togglePtmCategory = (cat: string) => {
    const catPtms = proteinPtms.filter(p => p.category === cat);
    const allOn = catPtms.length > 0 && catPtms.every(p => enabledPtmIds.has(p.id));
    setEnabledPtmIds(prev => {
      const next = new Set(prev);
      catPtms.forEach(p => {
        if (allOn) next.delete(p.id);
        else next.add(p.id);
      });
      return next;
    });
  };

  const setCustomPtmColor = (ptmId: string, color: string) => {
    setPtmColors(prev => ({ ...prev, [ptmId]: color }));
  };

  const focusPtm = (p: ProteinPtm) => {
    if (!viewerRef.current) return;
    const v = viewerRef.current;
    if (!enabledPtmIds.has(p.id)) {
      setEnabledPtmIds(prev => new Set([...prev, p.id]));
    }
    const resList: number[] = [];
    for (let r = p.start; r <= p.end; r++) resList.push(r);
    v.zoomTo({ resi: resList });
  };

  // 3. 3D Contact Interfaces State (default OFF)
  const [showAllInterfaces, setShowAllInterfaces] = useState<boolean>(false);
  const [enabledInterfacePartners, setEnabledInterfacePartners] = useState<Set<string>>(new Set());
  const [interfaceColors, setInterfaceColors] = useState<Record<string, string>>({});

  const toggleAllInterfaces = () => {
    setShowAllInterfaces(prev => !prev);
  };

  const toggleInterfacePartner = (partnerSymbol: string) => {
    setEnabledInterfacePartners(prev => {
      const next = new Set(prev);
      if (next.has(partnerSymbol)) next.delete(partnerSymbol);
      else next.add(partnerSymbol);
      return next;
    });
  };

  const enableAllInterfacePartners = () => {
    setShowAllInterfaces(true);
    const allPartners = (proteinInterfaces?.interfacePartners || []).map(p => p.partnerSymbol);
    setEnabledInterfacePartners(new Set(allPartners));
  };

  const disableAllInterfaces = () => {
    setShowAllInterfaces(false);
    setEnabledInterfacePartners(new Set());
  };

  const setCustomInterfaceColor = (partnerSymbol: string, color: string) => {
    setInterfaceColors(prev => ({ ...prev, [partnerSymbol]: color }));
  };

  const focusInterfaceResidues = (residues: number[], partnerSymbol?: string) => {
    if (!viewerRef.current || !residues.length) return;
    const v = viewerRef.current;
    if (partnerSymbol && !enabledInterfacePartners.has(partnerSymbol)) {
      setEnabledInterfacePartners(prev => new Set([...prev, partnerSymbol]));
    } else if (!partnerSymbol && !showAllInterfaces) {
      setShowAllInterfaces(true);
    }
    v.zoomTo({ resi: residues });
  };

  // 4. 3D Domain Overlays State (default OFF)
  const [enabledDomainIds, setEnabledDomainIds] = useState<Set<string>>(new Set());
  const [domainColors, setDomainColors] = useState<Record<string, string>>({});

  // Toggle individual domain on/off on the fly
  const toggleDomain = (domainId: string) => {
    setEnabledDomainIds(prev => {
      const next = new Set(prev);
      if (next.has(domainId)) {
        next.delete(domainId);
      } else {
        next.add(domainId);
      }
      return next;
    });
  };

  const enableAllDomains = () => {
    setEnabledDomainIds(new Set(proteinDomains.map(d => d.id)));
  };

  const disableAllDomains = () => {
    setEnabledDomainIds(new Set());
  };

  const setCustomDomainColor = (domainId: string, color: string) => {
    setDomainColors(prev => ({ ...prev, [domainId]: color }));
  };

  const focusDomain = (d: ProteinDomain) => {
    if (!viewerRef.current) return;
    const v = viewerRef.current;
    if (!enabledDomainIds.has(d.id)) {
      setEnabledDomainIds(prev => new Set([...prev, d.id]));
    }
    const resList: number[] = [];
    for (let r = d.start; r <= d.end; r++) resList.push(r);
    v.zoomTo({ resi: resList });
  };

  // Overlay Alignment Algorithm State (allows cycling between Global Kabsch, Pruned Core, Conserved Anchors, TM-Weighted)
  const [overlayAlgorithm, setOverlayAlgorithm] = useState<OverlayAlgorithmType>('kabsch_global');
  const [alignmentMetrics, setAlignmentMetrics] = useState<AlignmentMetrics | null>(null);
  const [showAlgorithmMenu, setShowAlgorithmMenu] = useState(false);

  // Cached matched coordinates & raw atoms for fast on-the-fly algorithm switching without network reload
  const rawHumanAtomsRef = useRef<{ x: number; y: number; z: number }[] | null>(null);
  const overlayMatchedPairsRef = useRef<{
    fixed: Point3D[];
    moving: Point3D[];
    isConserved: boolean[];
  } | null>(null);

  // Apply a new alignment algorithm instantly on the currently loaded structures
  const applyOverlayAlgorithm = (targetAlgo: OverlayAlgorithmType) => {
    setOverlayAlgorithm(targetAlgo);
    if (!viewerRef.current || !overlayMatchedPairsRef.current || !rawHumanAtomsRef.current) return;
    const v = viewerRef.current;
    const humanModel = v.custom_models?.human;
    if (!humanModel) return;

    const { fixed, moving, isConserved } = overlayMatchedPairsRef.current;
    const { transform, metrics } = computeSuperposition(fixed, moving, targetAlgo, isConserved);

    const rawAtoms = rawHumanAtomsRef.current;
    const currentAtoms = humanModel.selectedAtoms({});
    for (let i = 0; i < currentAtoms.length; i++) {
      const originalPos = rawAtoms[i];
      const newPos = applyTransform(originalPos, transform);
      currentAtoms[i].x = newPos.x;
      currentAtoms[i].y = newPos.y;
      currentAtoms[i].z = newPos.z;
    }
    humanModel.setCoordinates(currentAtoms);

    // Update base coordinates & centroid for manual adjustment
    baseCoordsRef.current = currentAtoms.map((a: any) => ({ x: a.x, y: a.y, z: a.z }));
    let cx = 0, cy = 0, cz = 0;
    currentAtoms.forEach((a: any) => { cx += a.x; cy += a.y; cz += a.z; });
    humanCentroidRef.current = { x: cx / currentAtoms.length, y: cy / currentAtoms.length, z: cz / currentAtoms.length };

    // Reset manual adjustment
    setManualAdj({ tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 });

    setAlignmentMetrics(metrics);
    updateRender();
  };

  // Cycle to next alignment algorithm
  const cycleOverlayAlgorithm = () => {
    const currentIndex = OVERLAY_ALGORITHMS.findIndex(a => a.type === overlayAlgorithm);
    const nextIndex = (currentIndex + 1) % OVERLAY_ALGORITHMS.length;
    applyOverlayAlgorithm(OVERLAY_ALGORITHMS[nextIndex].type);
  };

  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(loading);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  
  const viewModeRef = useRef(viewMode);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  // Expose captureImage method
  React.useImperativeHandle(ref, () => ({
    captureImage: () => {
        if (!viewerRef.current) return null;
        const v = viewerRef.current;
        v.render();
        return v.pngURI();
    },
    ensureOverlayEnabled: async () => {
        if (viewModeRef.current !== 'overlay') {
            setViewMode('overlay');
            setShowManualControls(false);
            
            // Wait for loading to start and then finish
            await new Promise(resolve => setTimeout(resolve, 100)); // allow re-render to trigger useEffect
            while (loadingRef.current) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            // Add a small delay for rendering
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
  }));

  // Colors State
  const [colors, setColors] = useState({
      singleBase: '#94a3b8', // Slate-400
      singleVariant: '#ef4444', // Red-500
      humanBase: '#94a3b8',
      humanVariant: '#a855f7', // Purple-500
      yeastBase: '#facc15', // Yellow-400
      yeastVariant: '#ef4444' // Red-500
  });

  // Manual Adjustment State
  const [manualAdj, setManualAdj] = useState({ tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 });
  const [showManualControls, setShowManualControls] = useState(false);
  const [manipulationMode, setManipulationMode] = useState<'object' | 'camera'>('object');
  const [isRealTime, setIsRealTime] = useState(true);
  
  const baseCoordsRef = useRef<Point3D[] | null>(null);
  const humanCentroidRef = useRef<Point3D | null>(null);
  const dragRef = useRef<{ startX: number, startY: number, startAdj: typeof manualAdj } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [structureInfo, setStructureInfo] = useState<{ source: string, id: string } | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);

  // Sync props to state when gene changes
  useEffect(() => {
      setActiveHumanId(humanUniprot);
      setActiveYeastId(yeastUniprot);
      setHumanInput(humanUniprot || '');
      setYeastInput(yeastUniprot || '');
  }, [humanUniprot, yeastUniprot]);

  // Determine which highlights to use based on current viewMode
  const activeHighlights = useMemo(() => {
      if (viewMode === 'overlay') return []; 
      if (highlightsBySpecies) {
          return highlightsBySpecies[viewMode] || [];
      }
      return customHighlights;
  }, [viewMode, highlightsBySpecies, customHighlights]);

  const fetchWithProxy = async (url: string) => {
    try {
        const res = await fetch(url);
        if (res.ok) return await res.text();
    } catch (e) {
        // Fallback
    }
    try {
        const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
        if (res.ok) return await res.text();
    } catch (e) {
        console.warn("CorsProxy failed", e);
    }
    try {
        const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
        if (res.ok) {
            const json = await res.json();
            return json.contents;
        }
    } catch (e) {
        console.warn("AllOrigins failed", e);
    }
    throw new Error("Failed to fetch structure data.");
  };

  const getPdbData = async (id: string): Promise<{ data: string, source: string, id: string }> => {
      const cleanId = id.trim().toUpperCase();
      
      // Heuristic: PDB IDs are exactly 4 chars. UniProt IDs are usually 6+.
      const isLikelyPdb = cleanId.length === 4;

      if (isLikelyPdb) {
          try {
              const data = await fetchWithProxy(`https://files.rcsb.org/download/${cleanId}.pdb`);
              return { data, source: 'PDB(RCSB)', id: cleanId };
          } catch (e) {
              console.warn("RCSB direct fetch failed, trying AlphaFold as fallback");
          }
      }

      // Try AlphaFold first for UniProt IDs
      try {
        const afRes = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${cleanId}`);
        if (afRes.ok) {
            const afData = await afRes.json();
            if (afData && afData.length > 0) {
                const pdbUrl = afData[0].pdbUrl;
                if (pdbUrl) {
                    const data = await fetchWithProxy(pdbUrl);
                    return { data, source: 'AlphaFold', id: cleanId };
                }
            }
        }
      } catch (e) {
          console.warn("AlphaFold fetch failed", e);
      }

      // Fallback to RCSB search if AlphaFold failed or if it wasn't a PDB ID initially
      try {
          const query = {
              query: {
                  type: "terminal",
                  service: "text",
                  parameters: {
                      attribute: "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession",
                      operator: "exact_match",
                      value: cleanId
                  }
              },
              return_type: "entry",
              request_options: {
                  scoring_strategy: "combined",
                  sort: [{ sort_by: "score", direction: "desc" }]
              }
          };
          
          const rcsbRes = await fetch(`https://search.rcsb.org/rcsbsearch/v2/query?json=${encodeURIComponent(JSON.stringify(query))}`);
          if (rcsbRes.ok) {
              const rcsbData = await rcsbRes.json();
              if (rcsbData.result_set && rcsbData.result_set.length > 0) {
                  const pdbId = rcsbData.result_set[0].identifier;
                  const data = await fetchWithProxy(`https://files.rcsb.org/download/${pdbId}.pdb`);
                  return { data, source: 'RCSB (Lookup)', id: pdbId };
              }
          }
      } catch (e) {
          console.warn("RCSB fetch failed", e);
      }

      throw new Error(`No structure found for ${cleanId}`);
  };

  interface CaCoordEntry {
    pt: Point3D;
    resName: string;
  }

  const extractCaCoords = (pdbText: string): Map<number, CaCoordEntry> => {
      const coords = new Map<number, CaCoordEntry>();
      const lines = pdbText.split('\n');
      for (const line of lines) {
          if (line.startsWith('ATOM')) {
              const atomName = line.substring(12, 16).trim();
              if (atomName === 'CA') {
                  const resSeq = parseInt(line.substring(22, 26).trim());
                  const resName = line.substring(17, 20).trim();
                  const x = parseFloat(line.substring(30, 38).trim());
                  const y = parseFloat(line.substring(38, 46).trim());
                  const z = parseFloat(line.substring(46, 54).trim());
                  if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                      coords.set(resSeq, { pt: { x, y, z }, resName });
                  }
              }
          }
      }
      return coords;
  };

  const getStyle = (rep: Representation, color: string, opacity: number = 1.0) => {
      if (rep === 'cartoon') return { cartoon: { color, opacity } };
      if (rep === 'stick') return { stick: { color, opacity, radius: 0.2 } };
      if (rep === 'sphere') return { sphere: { color, opacity, scale: 1.0 } };
      // For surface, we usually use the model as base or hide it
      return { cartoon: { color, opacity: 0 } }; 
  };

  const loadStructure = async () => {
    setLoading(true);
    setError(null);
    setStructureInfo(null);
    // Reset manual adjustment on new load
    setManualAdj({ tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 });
    baseCoordsRef.current = null;
    humanCentroidRef.current = null;

    if (!viewerRef.current && containerRef.current && window.$3Dmol) {
        const config = { backgroundColor: '#1e293b' }; // slate-800
        viewerRef.current = window.$3Dmol.createViewer(containerRef.current, config);
    }
    
    const v = viewerRef.current;
    if (!v) {
        setLoading(false);
        return;
    }
    
    v.clear();

    try {
        if (viewMode === 'overlay') {
            if (!activeHumanId || !activeYeastId) throw new Error("Both Human and Yeast IDs are required for overlay.");
            
            const [humanRes, yeastRes] = await Promise.all([
                getPdbData(activeHumanId),
                getPdbData(activeYeastId)
            ]);

            const humanCA = extractCaCoords(humanRes.data);
            const yeastCA = extractCaCoords(yeastRes.data);

            const fixedPoints: Point3D[] = [];
            const movingPoints: Point3D[] = [];
            const isConservedFlags: boolean[] = [];

            const SIMILAR_AA_SETS = [
                new Set(['ASP', 'GLU']),
                new Set(['ARG', 'LYS', 'HIS']),
                new Set(['ILE', 'LEU', 'VAL', 'MET']),
                new Set(['PHE', 'TYR', 'TRP']),
                new Set(['SER', 'THR', 'ASN', 'GLN']),
                new Set(['ALA', 'GLY', 'PRO'])
            ];

            const checkConserved = (r1?: string, r2?: string) => {
                if (!r1 || !r2) return false;
                if (r1 === r2) return true;
                return SIMILAR_AA_SETS.some(s => s.has(r1) && s.has(r2));
            };

            if (!alignmentMap || alignmentMap.size === 0) {
                // Identity alignment assumption: Match residue numbers existing in BOTH models
                humanCA.forEach((hEntry, resid) => {
                    if (yeastCA.has(resid)) {
                        const yEntry = yeastCA.get(resid)!;
                        movingPoints.push(hEntry.pt);
                        fixedPoints.push(yEntry.pt);
                        isConservedFlags.push(checkConserved(hEntry.resName, yEntry.resName));
                    }
                });
            } else {
                alignmentMap.forEach((yeastResIdx, humanResIdx) => {
                    const hEntry = humanCA.get(humanResIdx);
                    const yEntry = yeastCA.get(yeastResIdx);
                    if (hEntry && yEntry) {
                        movingPoints.push(hEntry.pt);
                        fixedPoints.push(yEntry.pt);
                        isConservedFlags.push(checkConserved(hEntry.resName, yEntry.resName));
                    }
                });
            }

            if (fixedPoints.length < 3) {
                // Determine which model is failing to provide points
                const hCount = humanCA.size;
                const yCount = yeastCA.size;
                throw new Error(`Alignment Failed. Overlapping residues found: ${fixedPoints.length}. (Human model has ${hCount} residues, Yeast has ${yCount}). Try using PDB structures with matching residue numbering.`);
            }

            // Cache matched coordinates for instantaneous on-the-fly algorithm cycling
            overlayMatchedPairsRef.current = { fixed: fixedPoints, moving: movingPoints, isConserved: isConservedFlags };

            // Yeast Model (Fixed)
            const yeastModel = v.addModel(yeastRes.data, "pdb");
            
            // Human Model (Moving)
            const humanModel = v.addModel(humanRes.data, "pdb");

            // Cache raw un-transformed atom positions
            rawHumanAtomsRef.current = humanModel.selectedAtoms({}).map((a: any) => ({ x: a.x, y: a.y, z: a.z }));

            // Compute initial superposition using the active algorithm
            const { transform, metrics } = computeSuperposition(fixedPoints, movingPoints, overlayAlgorithm, isConservedFlags);
            setAlignmentMetrics(metrics);

            const atoms = humanModel.selectedAtoms({});
            for (let i = 0; i < atoms.length; i++) {
                const originalPos = rawHumanAtomsRef.current[i];
                const newPos = applyTransform(originalPos, transform);
                atoms[i].x = newPos.x;
                atoms[i].y = newPos.y;
                atoms[i].z = newPos.z;
            }
            humanModel.setCoordinates(atoms);

            // Save Base Coords for Manual Adjustment
            baseCoordsRef.current = atoms.map((a: any) => ({ x: a.x, y: a.y, z: a.z }));
            
            // Calc Centroid for Rotation
            let cx=0, cy=0, cz=0;
            atoms.forEach((a: any) => { cx+=a.x; cy+=a.y; cz+=a.z; });
            const n = atoms.length;
            humanCentroidRef.current = { x: cx/n, y: cy/n, z: cz/n };

            // Store models in custom properties for render update
            v.custom_models = { yeast: yeastModel, human: humanModel };
            
            setStructureInfo({ source: 'Overlay', id: `${humanRes.id} (Hu) / ${yeastRes.id} (Ye)` });

        } else {
            const targetId = viewMode === 'human' ? activeHumanId : activeYeastId;
            if (!targetId) throw new Error(`No ID for ${viewMode}`);
            
            const res = await getPdbData(targetId);
            const model = v.addModel(res.data, "pdb");
            
            v.custom_models = { single: model };
            
            setStructureInfo({ source: res.source, id: res.id });
        }

        v.zoomTo();
        updateRender(); // Apply initial styles

    } catch (err) {
        setError((err as Error).message);
    } finally {
        setLoading(false);
    }
  };

  const applyManualTransformation = () => {
      if (viewMode === 'overlay' && viewerRef.current && baseCoordsRef.current && humanCentroidRef.current) {
          const v = viewerRef.current;
          const human = v.custom_models?.human;
          if (!human) return;

          const base = baseCoordsRef.current;
          const cent = humanCentroidRef.current;
          const { tx, ty, tz, rx, ry, rz } = manualAdj;
          
          const radX = rx * Math.PI / 180;
          const radY = ry * Math.PI / 180;
          const radZ = rz * Math.PI / 180;

          const atoms = human.selectedAtoms({});
          
          if (atoms.length !== base.length) return;

          // Precompute trig
          const cosX = Math.cos(radX), sinX = Math.sin(radX);
          const cosY = Math.cos(radY), sinY = Math.sin(radY);
          const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);

          for(let i=0; i<atoms.length; i++) {
              let x = base[i].x - cent.x;
              let y = base[i].y - cent.y;
              let z = base[i].z - cent.z;

              // Rotate X
              let y1 = y * cosX - z * sinX;
              let z1 = y * sinX + z * cosX;
              y = y1; z = z1;

              // Rotate Y
              let x1 = x * cosY + z * sinY;
              z1 = -x * sinY + z * cosY;
              x = x1; z = z1;

              // Rotate Z
              x1 = x * cosZ - y * sinZ;
              y1 = x * sinZ + y * cosZ;
              x = x1; y = y1;

              atoms[i].x = x + cent.x + tx;
              atoms[i].y = y + cent.y + ty;
              atoms[i].z = z + cent.z + tz;
          }
          human.setCoordinates(atoms);
          
          // CRITICAL: We must re-render the visual style to match new coordinates for Cartoons/Surfaces
          updateRender();
      }
  };

  // Effect to handle manual adjustment
  useEffect(() => {
      if (isRealTime) {
          applyManualTransformation();
      }
  }, [manualAdj, viewMode, isRealTime]);

  // Handle Drag on Transparent Overlay
  const handlePointerDown = (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startAdj: { ...manualAdj }
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const s = dragRef.current.startAdj;

      // Sensitivity factors
      const ROT_SPEED = 0.5; 
      const TRANS_SPEED = 0.1;

      if (e.shiftKey) {
          // Translate
          setManualAdj({
              ...s,
              tx: s.tx + dx * TRANS_SPEED,
              ty: s.ty - dy * TRANS_SPEED, // Screen Y is down, 3D Y is up
          });
      } else {
          // Rotate (Orbit style)
          setManualAdj({
              ...s,
              ry: s.ry + dx * ROT_SPEED,
              rx: s.rx + dy * ROT_SPEED
          });
      }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
      dragRef.current = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // Function to apply styles based on current state (colors, representation) without reloading geometry
  const updateRender = () => {
      const v = viewerRef.current;
      if (!v || !v.custom_models) return;

      v.removeAllSurfaces();
      v.removeAllLabels();

      const applyVariantStyle = (model: any, residue: number, color: string) => {
          const sel = { model: model, resi: residue };
          
          if (variantRepresentation === 'surface') {
              v.addSurface(window.$3Dmol.SurfaceType.VDW, { opacity: 1.0, color: color }, sel);
          } else {
              let style = {};
              if (variantRepresentation === 'stick') style = { stick: { color, radius: 0.3 } };
              else if (variantRepresentation === 'sphere') style = { sphere: { color, scale: 0.8 } };
              else if (variantRepresentation === 'cartoon') style = { cartoon: { color, thickness: 1.0, opacity: 1.0 } };
              
              v.addStyle(sel, style);
          }
      };

      const applyDomainStyle = (targetModel: any, residues: number[], color: string) => {
          if (!residues || residues.length === 0 || !targetModel) return;
          const sel = { model: targetModel, resi: residues };
          if (representation === 'surface') {
              v.addSurface(window.$3Dmol.SurfaceType.VDW, { opacity: 0.85, color: color }, sel);
          } else {
              let dStyle = {};
              if (representation === 'stick') dStyle = { stick: { color, radius: 0.3 } };
              else if (representation === 'sphere') dStyle = { sphere: { color, scale: 0.8 } };
              else dStyle = { cartoon: { color, thickness: 1.1, opacity: 0.95 } };
              v.addStyle(sel, dStyle);
          }
      };

      const applyInterfaceStyle = (targetModel: any, residues: number[], color: string) => {
          if (!residues || residues.length === 0 || !targetModel) return;
          const sel = { model: targetModel, resi: residues };
          if (interfaceRepresentation === 'surface') {
              v.addSurface(window.$3Dmol.SurfaceType.VDW, { opacity: 0.85, color }, sel);
          } else if (interfaceRepresentation === 'stick') {
              v.addStyle(sel, { stick: { color, radius: 0.3 } });
          } else {
              v.addStyle(sel, { cartoon: { color, thickness: 1.3, opacity: 1.0 } });
          }
      };

      const applySiteStyle = (targetModel: any, residues: number[], color: string) => {
          if (!residues || residues.length === 0 || !targetModel) return;
          const sel = { model: targetModel, resi: residues };
          if (siteRepresentation === 'surface') {
              v.addSurface(window.$3Dmol.SurfaceType.VDW, { opacity: 0.9, color }, sel);
          } else if (siteRepresentation === 'stick') {
              v.addStyle(sel, { stick: { color, radius: 0.35 } });
          } else {
              v.addStyle(sel, { cartoon: { color, thickness: 1.3, opacity: 1.0 } });
          }
      };

      const applyPtmStyle = (targetModel: any, residues: number[], color: string, badge?: string) => {
          if (!residues || residues.length === 0 || !targetModel) return;
          const sel = { model: targetModel, resi: residues };
          if (representation === 'surface') {
              v.addSurface(window.$3Dmol.SurfaceType.VDW, { opacity: 0.94, color }, sel);
          } else {
              v.addStyle(sel, {
                  cartoon: { color, thickness: 1.15, opacity: 1.0 },
                  stick: { color, radius: 0.32 },
                  sphere: { color, scale: 0.65 }
              });
          }
          if (badge && residues.length === 1) {
              v.addLabel(`${badge}${residues[0]}`, {
                  position: { resi: residues[0] },
                  backgroundColor: 'rgba(15, 23, 42, 0.85)',
                  fontColor: color,
                  fontSize: 10
              });
          }
      };

      const mapHumanToYeast = (hResList: number[]): number[] => {
          if (!alignmentMap || alignmentMap.size === 0) return [];
          const yList: number[] = [];
          alignmentMap.forEach((val, key) => {
              if (hResList.includes(key)) yList.push(val);
              else if (hResList.includes(val)) yList.push(key);
          });
          return yList;
      };

      if (viewMode === 'overlay') {
          const { yeast, human } = v.custom_models;
          
          // Safety check
          if (!yeast || !human) return;

          const hRes = highlightsBySpecies?.human || [];
          const yRes = highlightsBySpecies?.yeast || [];

          // 1. Yeast Style
          if (representation === 'surface') {
              v.addSurface(window.$3Dmol.SurfaceType.VDW, {opacity: 0.8, color: colors.yeastBase}, {model: yeast});
          } else {
              yeast.setStyle({}, getStyle(representation, colors.yeastBase, 0.7));
          }

          // 2. Human Style
          if (representation === 'surface') {
              v.addSurface(window.$3Dmol.SurfaceType.VDW, {opacity: 0.5, color: colors.humanBase}, {model: human});
          } else {
              human.setStyle({}, getStyle(representation, colors.humanBase, 0.5));
          }

          // 3. Domain Overlays (Overlay Mode)
          if (proteinDomains && proteinDomains.length > 0 && enabledDomainIds.size > 0) {
              proteinDomains.forEach(d => {
                  if (!enabledDomainIds.has(d.id)) return;
                  const dColor = domainColors[d.id] || d.color || '#6366f1';
                  const resList: number[] = [];
                  for (let r = d.start; r <= d.end; r++) resList.push(r);

                  applyDomainStyle(human, resList, dColor);

                  // Also overlay homologous yeast region if alignmentMap is present
                  const yList = mapHumanToYeast(resList);
                  if (yList.length > 0) applyDomainStyle(yeast, yList, dColor);
              });
          }

          // 4. Contact Interfaces Overlays (Overlay Mode)
          if (proteinInterfaces && (showAllInterfaces || enabledInterfacePartners.size > 0)) {
              let intfResList: number[] = [];
              if (showAllInterfaces) {
                  intfResList = proteinInterfaces.allInterfaceResidueIndices || [];
              } else {
                  const resSet = new Set<number>();
                  (proteinInterfaces.interfacePartners || []).forEach(p => {
                      if (enabledInterfacePartners.has(p.partnerSymbol)) {
                          (p.residues || []).forEach(r => resSet.add(r));
                      }
                  });
                  intfResList = Array.from(resSet);
              }
              if (intfResList.length > 0) {
                  applyInterfaceStyle(human, intfResList, '#10b981');
                  const yIntfList = mapHumanToYeast(intfResList);
                  if (yIntfList.length > 0) applyInterfaceStyle(yeast, yIntfList, '#10b981');
              }
          }

          // 5. Sites & Motifs Overlays (Overlay Mode)
          if (functionalSites && functionalSites.length > 0 && enabledSiteIds.size > 0) {
              functionalSites.forEach(s => {
                  if (!enabledSiteIds.has(s.id)) return;
                  const sColor = siteColors[s.id] || s.color || '#e11d48';
                  const resList: number[] = [];
                  for (let r = s.start; r <= s.end; r++) resList.push(r);
                  if (s.source !== 'yeast') {
                      applySiteStyle(human, resList, sColor);
                      const yList = mapHumanToYeast(resList);
                      if (yList.length > 0) applySiteStyle(yeast, yList, sColor);
                  } else {
                      applySiteStyle(yeast, resList, sColor);
                  }
              });
          }

          // 6. PTM Overlays (Overlay Mode)
          if (proteinPtms && proteinPtms.length > 0 && enabledPtmIds.size > 0) {
              proteinPtms.forEach(p => {
                  if (!enabledPtmIds.has(p.id)) return;
                  const pColor = ptmColors[p.id] || p.color || '#f59e0b';
                  const resList: number[] = [];
                  for (let r = p.start; r <= p.end; r++) resList.push(r);
                  if (p.source !== 'yeast') {
                      applyPtmStyle(human, resList, pColor, p.badge);
                      const yList = mapHumanToYeast(resList);
                      if (yList.length > 0) applyPtmStyle(yeast, yList, pColor, p.badge);
                  } else {
                      applyPtmStyle(yeast, resList, pColor, p.badge);
                  }
              });
          }

          // 7. Variants (always on top)
          yRes?.forEach((h: Highlight) => applyVariantStyle(yeast, h.residue, colors.yeastVariant));
          hRes?.forEach((h: Highlight) => applyVariantStyle(human, h.residue, colors.humanVariant));

      } else {
          // Single Mode
          const model = v.custom_models.single;
          
          // Safety check
          if (!model) return;

          const highlights = activeHighlights || [];

          if (representation === 'surface') {
              v.addSurface(window.$3Dmol.SurfaceType.VDW, {opacity: 0.9, color: colors.singleBase}, {model: model});
          } else {
              model.setStyle({}, getStyle(representation, colors.singleBase));
          }

          // Domain Overlays (Single Mode)
          if (proteinDomains && proteinDomains.length > 0 && enabledDomainIds.size > 0) {
              proteinDomains.forEach(d => {
                  if (!enabledDomainIds.has(d.id)) return;
                  const dColor = domainColors[d.id] || d.color || '#6366f1';
                  
                  if (viewMode === 'human') {
                      const resList: number[] = [];
                      for (let r = d.start; r <= d.end; r++) resList.push(r);
                      applyDomainStyle(model, resList, dColor);
                  } else if (viewMode === 'yeast') {
                      const resList: number[] = [];
                      for (let r = d.start; r <= d.end; r++) resList.push(r);
                      const yList = mapHumanToYeast(resList);
                      if (yList.length > 0) applyDomainStyle(model, yList, dColor);
                  }
              });
          }

          // Contact Interfaces Overlays (Single Mode)
          if (proteinInterfaces && (showAllInterfaces || enabledInterfacePartners.size > 0)) {
              let intfResList: number[] = [];
              if (showAllInterfaces) {
                  intfResList = proteinInterfaces.allInterfaceResidueIndices || [];
              } else {
                  const resSet = new Set<number>();
                  (proteinInterfaces.interfacePartners || []).forEach(p => {
                      if (enabledInterfacePartners.has(p.partnerSymbol)) {
                          (p.residues || []).forEach(r => resSet.add(r));
                      }
                  });
                  intfResList = Array.from(resSet);
              }
              if (intfResList.length > 0) {
                  const resToApply = viewMode === 'human' ? intfResList : mapHumanToYeast(intfResList);
                  if (resToApply.length > 0) applyInterfaceStyle(model, resToApply, '#10b981');
              }
          }

          // Sites & Motifs Overlays (Single Mode)
          if (functionalSites && functionalSites.length > 0 && enabledSiteIds.size > 0) {
              functionalSites.forEach(s => {
                  if (!enabledSiteIds.has(s.id)) return;
                  const sColor = siteColors[s.id] || s.color || '#e11d48';
                  const resList: number[] = [];
                  for (let r = s.start; r <= s.end; r++) resList.push(r);

                  let resToApply: number[] = [];
                  if (viewMode === 'human') {
                      if (s.source !== 'yeast') resToApply = resList;
                  } else {
                      if (s.source === 'yeast') resToApply = resList;
                      else resToApply = mapHumanToYeast(resList);
                  }
                  if (resToApply.length > 0) applySiteStyle(model, resToApply, sColor);
              });
          }

          // PTM Overlays (Single Mode)
          if (proteinPtms && proteinPtms.length > 0 && enabledPtmIds.size > 0) {
              proteinPtms.forEach(p => {
                  if (!enabledPtmIds.has(p.id)) return;
                  const pColor = ptmColors[p.id] || p.color || '#f59e0b';
                  const resList: number[] = [];
                  for (let r = p.start; r <= p.end; r++) resList.push(r);

                  let resToApply: number[] = [];
                  if (viewMode === 'human') {
                      if (p.source !== 'yeast') resToApply = resList;
                  } else {
                      if (p.source === 'yeast') resToApply = resList;
                      else resToApply = mapHumanToYeast(resList);
                  }
                  if (resToApply.length > 0) applyPtmStyle(model, resToApply, pColor, p.badge);
              });
          }

          // Variants (always on top)
          highlights?.forEach((h: Highlight) => {
              applyVariantStyle(model, h.residue, colors.singleVariant);
              // Label
              v.addLabel(`${h.residue}`, { 
                  position: { resi: h.residue }, 
                  backgroundColor: 'rgba(0,0,0,0.7)', 
                  fontColor: 'white', 
                  fontSize: 12 
              });
          });
      }
      
      v.render();
  };

  useEffect(() => {
      if (window.$3Dmol) {
          loadStructure();
      } else {
          setError("3Dmol.js library not loaded.");
      }
  }, [viewMode, activeHumanId, activeYeastId]); 

  // Re-render when display options, domains, sites, PTMs, or interfaces overlays change
  useEffect(() => {
      updateRender();
  }, [
      representation, 
      variantRepresentation, 
      siteRepresentation,
      interfaceRepresentation,
      colors, 
      activeHighlights, 
      enabledDomainIds, 
      domainColors, 
      proteinDomains,
      enabledSiteIds,
      siteColors,
      functionalSites,
      enabledPtmIds,
      ptmColors,
      proteinPtms,
      showAllInterfaces,
      enabledInterfacePartners,
      interfaceColors,
      proteinInterfaces
  ]);

  const handleSnapshot = () => {
      if (!viewerRef.current) return;
      const v = viewerRef.current;
      v.render();
      const dataURI = v.pngURI();
      const link = document.createElement('a');
      link.href = dataURI;
      link.download = `Structure_${viewMode}_${structureInfo?.id || 'protein'}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const handleSaveIds = () => {
      setActiveHumanId(humanInput || null);
      setActiveYeastId(yeastInput || null);
      setShowIdControls(false);
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-sm overflow-hidden flex flex-col h-[650px] animate-fade-in">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-900 border-b border-slate-700 flex justify-between items-center relative">
            <div className="flex items-center gap-2">
                <Box className="w-5 h-5 text-emerald-500" />
                <h3 className="font-bold text-slate-100">3D Structure</h3>
                {structureInfo && (
                    <div className="hidden sm:flex items-center gap-2">
                        <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                            {structureInfo.source}: {structureInfo.id}
                        </span>
                        <button 
                            onClick={() => setShowIdControls(!showIdControls)}
                            className="p-1 rounded-full hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                            title="Manually Change Structure ID (PDB/UniProt)"
                        >
                            <Database className="w-3 h-3" />
                        </button>
                    </div>
                )}
            </div>

            {/* ID Override Popup */}
            {showIdControls && (
                <div className="absolute top-12 left-4 z-50 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl w-64 animate-fade-in">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-xs font-bold text-slate-300 uppercase">Change Structures</h4>
                        <button onClick={() => setShowIdControls(false)} className="text-slate-500 hover:text-white"><X className="w-3 h-3" /></button>
                    </div>
                    <div className="space-y-2 mb-3">
                        <div>
                            <label className="block text-[10px] text-slate-500 mb-1">Human ID (UniProt or PDB)</label>
                            <input 
                                type="text" 
                                value={humanInput} 
                                onChange={(e) => setHumanInput(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-emerald-500 outline-none"
                                placeholder="e.g. P12345 or 1ABC"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] text-slate-500 mb-1">Yeast ID (UniProt or PDB)</label>
                            <input 
                                type="text" 
                                value={yeastInput} 
                                onChange={(e) => setYeastInput(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-emerald-500 outline-none"
                                placeholder="e.g. P54321 or 2XYZ"
                            />
                        </div>
                    </div>
                    <button 
                        onClick={handleSaveIds}
                        className="w-full py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold flex items-center justify-center gap-1"
                    >
                        <Save className="w-3 h-3" /> Update Viewer
                    </button>
                </div>
            )}

            <div className="flex items-center gap-2">
                <div className="bg-slate-800 rounded-lg border border-slate-600 p-0.5 flex">
                    <button 
                        onClick={() => setViewMode('human')}
                        disabled={!activeHumanId}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${viewMode === 'human' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 disabled:opacity-30'}`}
                    >
                        Human
                    </button>
                    <button 
                        onClick={() => setViewMode('yeast')}
                        disabled={!activeYeastId}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${viewMode === 'yeast' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 disabled:opacity-30'}`}
                    >
                        Yeast
                    </button>
                    <button 
                        onClick={() => {
                            setViewMode('overlay');
                            setShowManualControls(false); // Reset manual controls on toggle
                        }}
                        disabled={!activeYeastId || !activeHumanId}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${viewMode === 'overlay' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 disabled:opacity-30'}`}
                        title="Structural Superposition"
                    >
                        <Layers className="w-3 h-3" />
                        Overlay
                    </button>
                </div>

                {/* Optional Cycle Alignment Button with Dropdown (Active in Overlay Mode) */}
                {viewMode === 'overlay' && (
                    <div className="relative flex items-center">
                        <div className="flex items-center rounded-lg bg-slate-800 border border-slate-600 p-0.5 shadow-xs">
                            <button 
                                type="button"
                                onClick={cycleOverlayAlgorithm}
                                className="px-2.5 py-1 text-xs font-bold text-emerald-400 hover:text-emerald-300 hover:bg-slate-700/80 rounded-md transition-colors flex items-center gap-1.5"
                                title="Click to cycle alignment algorithm (Global Kabsch ➔ Pruned Core ➔ Conserved Anchors ➔ TM-Weighted)"
                            >
                                <RefreshCw className="w-3.5 h-3.5 text-emerald-400 hover:rotate-180 transition-transform" />
                                <span className="text-white text-xs font-bold">
                                    {OVERLAY_ALGORITHMS.find(a => a.type === overlayAlgorithm)?.shortName || 'Alignment'}
                                </span>
                                {alignmentMetrics && (
                                    <span className="text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 px-1.5 py-0.2 rounded">
                                        {alignmentMetrics.rmsd.toFixed(2)}Å
                                    </span>
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowAlgorithmMenu(!showAlgorithmMenu)}
                                className={`px-1.5 py-1 rounded-md text-slate-400 hover:text-white transition-colors border-l border-slate-700 ${
                                    showAlgorithmMenu ? 'bg-slate-700 text-white' : ''
                                }`}
                                title="Select specific alignment algorithm"
                            >
                                <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {/* Dropdown Menu for Direct Algorithm Selection */}
                        {showAlgorithmMenu && (
                            <div className="absolute top-full mt-1.5 right-0 z-50 w-72 bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-2 animate-fade-in text-xs">
                                <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 mb-1 flex justify-between items-center">
                                    <span>Superposition Algorithm</span>
                                    <span className="text-[9px] text-emerald-400 font-normal">Click to apply</span>
                                </div>
                                <div className="space-y-1">
                                    {OVERLAY_ALGORITHMS.map(algo => {
                                        const isSelected = algo.type === overlayAlgorithm;
                                        return (
                                            <button
                                                key={algo.type}
                                                type="button"
                                                onClick={() => {
                                                    applyOverlayAlgorithm(algo.type);
                                                    setShowAlgorithmMenu(false);
                                                }}
                                                className={`w-full text-left p-2 rounded-lg transition-all flex flex-col gap-0.5 ${
                                                    isSelected 
                                                        ? 'bg-emerald-950/70 border border-emerald-700/80 text-white shadow-xs' 
                                                        : 'hover:bg-slate-800 text-slate-300 border border-transparent'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between font-bold">
                                                    <span className={isSelected ? 'text-emerald-300 font-bold' : 'text-slate-200'}>
                                                        {algo.name}
                                                    </span>
                                                    {isSelected && (
                                                        <span className="text-[10px] text-emerald-400 bg-emerald-900/60 px-1.5 py-0.2 rounded font-mono font-bold">
                                                            Active
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[10px] text-slate-400 leading-tight">
                                                    {algo.description}
                                                </p>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {/* 3D Feature Overlays Toolbar Group (Sites, PTMs, Interfaces, Domains - Default OFF) */}
                <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-slate-700">
                    {/* Sites & Motifs */}
                    <button 
                        type="button"
                        onClick={() => setActiveAnnotationTab(activeAnnotationTab === 'sites' ? null : 'sites')}
                        className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 border ${
                            enabledSiteIds.size > 0
                                ? 'bg-rose-600 text-white border-rose-500 shadow-sm'
                                : activeAnnotationTab === 'sites'
                                    ? 'bg-slate-700 text-white border-slate-500'
                                    : 'bg-slate-800 text-slate-300 hover:text-white border-slate-700 hover:border-slate-600'
                        }`}
                        title="3D Sites & Motifs: Active catalytic sites, metal coordination, ligand binding, SLiMs (Default: Off)"
                    >
                        <Target className="w-3.5 h-3.5 text-rose-400" />
                        <span>Sites</span>
                        {enabledSiteIds.size > 0 ? (
                            <span className="px-1.5 py-0.2 bg-white text-rose-900 rounded-full text-[10px] font-black">
                                {enabledSiteIds.size}
                            </span>
                        ) : (
                            <span className="text-[10px] text-slate-400 font-normal">Off</span>
                        )}
                    </button>

                    {/* PTMs */}
                    <button 
                        type="button"
                        onClick={() => setActiveAnnotationTab(activeAnnotationTab === 'ptms' ? null : 'ptms')}
                        className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 border ${
                            enabledPtmIds.size > 0
                                ? 'bg-amber-600 text-white border-amber-500 shadow-sm'
                                : activeAnnotationTab === 'ptms'
                                    ? 'bg-slate-700 text-white border-slate-500'
                                    : 'bg-slate-800 text-slate-300 hover:text-white border-slate-700 hover:border-slate-600'
                        }`}
                        title="3D Post-Translational Modifications: Phosphorylation, Acetylation, Ubiquitination, etc. (Default: Off)"
                    >
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        <span>PTMs</span>
                        {enabledPtmIds.size > 0 ? (
                            <span className="px-1.5 py-0.2 bg-white text-amber-900 rounded-full text-[10px] font-black">
                                {enabledPtmIds.size}
                            </span>
                        ) : (
                            <span className="text-[10px] text-slate-400 font-normal">Off</span>
                        )}
                    </button>

                    {/* Interfaces */}
                    <button 
                        type="button"
                        onClick={() => setActiveAnnotationTab(activeAnnotationTab === 'interfaces' ? null : 'interfaces')}
                        className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 border ${
                            showAllInterfaces || enabledInterfacePartners.size > 0
                                ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                                : activeAnnotationTab === 'interfaces'
                                    ? 'bg-slate-700 text-white border-slate-500'
                                    : 'bg-slate-800 text-slate-300 hover:text-white border-slate-700 hover:border-slate-600'
                        }`}
                        title="3D Contact Interfaces: Protein-protein & nucleic acid structural contacts from BioGRID/PDBe-KB (Default: Off)"
                    >
                        <Users className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Interfaces</span>
                        {showAllInterfaces ? (
                            <span className="px-1.5 py-0.2 bg-white text-emerald-900 rounded-full text-[10px] font-black">
                                All
                            </span>
                        ) : enabledInterfacePartners.size > 0 ? (
                            <span className="px-1.5 py-0.2 bg-white text-emerald-900 rounded-full text-[10px] font-black">
                                {enabledInterfacePartners.size}
                            </span>
                        ) : (
                            <span className="text-[10px] text-slate-400 font-normal">Off</span>
                        )}
                    </button>

                    {/* Domains */}
                    <button 
                        type="button"
                        onClick={() => setActiveAnnotationTab(activeAnnotationTab === 'domains' ? null : 'domains')}
                        className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 border ${
                            enabledDomainIds.size > 0
                                ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                                : activeAnnotationTab === 'domains'
                                    ? 'bg-slate-700 text-white border-slate-500'
                                    : 'bg-slate-800 text-slate-300 hover:text-white border-slate-700 hover:border-slate-600'
                        }`}
                        title="3D Protein Domains (Pfam, UniProt, SMART domains) (Default: Off)"
                    >
                        <Layers className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Domains</span>
                        {enabledDomainIds.size > 0 ? (
                            <span className="px-1.5 py-0.2 bg-white text-indigo-900 rounded-full text-[10px] font-black">
                                {enabledDomainIds.size}
                            </span>
                        ) : (
                            <span className="text-[10px] text-slate-400 font-normal">Off</span>
                        )}
                    </button>
                </div>
                <button 
                    onClick={handleSnapshot}
                    disabled={loading || !!error}
                    className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-700 rounded-lg transition-colors"
                    title="Take HD Snapshot"
                >
                    <Camera className="w-4 h-4" />
                </button>
            </div>
        </div>

        {/* Viewer Area */}
        <div className="flex-grow relative bg-slate-900 group">
            {/* Overlay Superposition Metrics & Quick-Cycle HUD Chip */}
            {viewMode === 'overlay' && alignmentMetrics && !activeAnnotationTab && (
                <div className="absolute top-3 right-3 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 shadow-xl pointer-events-auto animate-fade-in">
                    <span className="font-bold text-white text-xs">{alignmentMetrics.shortName}</span>
                    <span className="text-slate-600">•</span>
                    <span className="font-mono text-emerald-400 font-bold text-xs">
                        RMSD: {alignmentMetrics.rmsd.toFixed(2)} Å
                    </span>
                    {alignmentMetrics.alignedPairsCount !== alignmentMetrics.totalPairsCount && (
                        <span className="text-[10px] text-slate-400 font-mono">
                            ({alignmentMetrics.alignedPairsCount}/{alignmentMetrics.totalPairsCount} Cα)
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={cycleOverlayAlgorithm}
                        className="ml-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 font-bold text-[10px] flex items-center gap-1 border border-slate-600/80 transition-colors shadow-xs"
                        title="Click to cycle alignment algorithm"
                    >
                        <RefreshCw className="w-2.5 h-2.5" />
                        Cycle
                    </button>
                </div>
            )}
            
            {/* Unified 3D Structural Features & Overlays Floating Panel */}
            {activeAnnotationTab !== null && (
                <div className="absolute top-3 left-3 z-30 w-88 max-h-[85%] bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl flex flex-col p-3 animate-fade-in text-xs">
                    {/* Header */}
                    <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                        <div className="flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4 text-emerald-400" />
                            <h4 className="font-bold text-slate-100 text-xs">3D Structural Overlays</h4>
                        </div>
                        <button 
                            type="button"
                            onClick={() => setActiveAnnotationTab(null)} 
                            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {/* Tab Navigation Bar */}
                    <div className="flex items-center gap-1 pt-2 pb-2 border-b border-slate-800/80">
                        <button
                            type="button"
                            onClick={() => setActiveAnnotationTab('sites')}
                            className={`flex-1 py-1 px-1.5 rounded text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                                activeAnnotationTab === 'sites'
                                    ? 'bg-rose-600/30 text-rose-300 border border-rose-500/50'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                            }`}
                        >
                            <Target className="w-3 h-3 text-rose-400" />
                            <span>Sites</span>
                            {enabledSiteIds.size > 0 && (
                                <span className="px-1 py-0.2 bg-rose-500 text-white rounded-full text-[9px] font-black">
                                    {enabledSiteIds.size}
                                </span>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveAnnotationTab('ptms')}
                            className={`flex-1 py-1 px-1.5 rounded text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                                activeAnnotationTab === 'ptms'
                                    ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                            }`}
                        >
                            <Zap className="w-3 h-3 text-amber-400" />
                            <span>PTMs</span>
                            {enabledPtmIds.size > 0 && (
                                <span className="px-1 py-0.2 bg-amber-500 text-white rounded-full text-[9px] font-black">
                                    {enabledPtmIds.size}
                                </span>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveAnnotationTab('interfaces')}
                            className={`flex-1 py-1 px-1.5 rounded text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                                activeAnnotationTab === 'interfaces'
                                    ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                            }`}
                        >
                            <Users className="w-3 h-3 text-emerald-400" />
                            <span>Interfaces</span>
                            {(showAllInterfaces || enabledInterfacePartners.size > 0) && (
                                <span className="px-1 py-0.2 bg-emerald-500 text-white rounded-full text-[9px] font-black">
                                    {showAllInterfaces ? 'All' : enabledInterfacePartners.size}
                                </span>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveAnnotationTab('domains')}
                            className={`flex-1 py-1 px-1.5 rounded text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                                activeAnnotationTab === 'domains'
                                    ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/50'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                            }`}
                        >
                            <Layers className="w-3 h-3 text-indigo-400" />
                            <span>Domains</span>
                            {enabledDomainIds.size > 0 && (
                                <span className="px-1 py-0.2 bg-indigo-500 text-white rounded-full text-[9px] font-black">
                                    {enabledDomainIds.size}
                                </span>
                            )}
                        </button>
                    </div>

                    {/* TAB 1: SITES & MOTIFS */}
                    {activeAnnotationTab === 'sites' && (
                        <div className="flex flex-col flex-1 overflow-hidden pt-1">
                            <div className="py-1 text-[11px] text-slate-400 leading-tight">
                                Highlight catalytic active sites, metal coordination, ligand/cofactor binding, and short linear motifs (SLiMs).
                            </div>

                            {functionalSites && functionalSites.length > 0 ? (
                                <>
                                    {/* Action Bar */}
                                    <div className="flex items-center justify-between py-1.5 mb-2 border-b border-slate-800/80 gap-2 flex-wrap">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                                Active: <span className="text-rose-400 font-bold">{enabledSiteIds.size}</span> of {functionalSites.length}
                                            </span>
                                            {/* Style representation toggle for sites */}
                                            <div className="flex items-center bg-slate-800 rounded border border-slate-700 p-0.5" title="Sites 3D representation style">
                                                <button
                                                    type="button"
                                                    onClick={() => setSiteRepresentation('cartoon')}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                                        siteRepresentation === 'cartoon' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                                                    }`}
                                                >
                                                    Cartoon
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setSiteRepresentation('stick')}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                                        siteRepresentation === 'stick' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                                                    }`}
                                                >
                                                    Stick
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setSiteRepresentation('surface')}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                                        siteRepresentation === 'surface' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                                                    }`}
                                                >
                                                    Surface
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={disableAllSites}
                                                disabled={enabledSiteIds.size === 0}
                                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 border border-slate-700 transition-colors"
                                            >
                                                All Off
                                            </button>
                                            <button
                                                type="button"
                                                onClick={enableAllSites}
                                                disabled={enabledSiteIds.size === functionalSites.length}
                                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/50 transition-colors"
                                            >
                                                All On
                                            </button>
                                        </div>
                                    </div>

                                    {/* Category Filter Chips */}
                                    <div className="flex items-center gap-1 flex-wrap pb-2 border-b border-slate-800/60 mb-2">
                                        {['ALL', 'ACTIVE_SITE', 'METAL_BINDING', 'BINDING_SITE', 'SLIM_MOTIF'].map(cat => {
                                            const label = cat === 'ALL' ? 'All' : cat === 'ACTIVE_SITE' ? 'Active' : cat === 'METAL_BINDING' ? 'Metal' : cat === 'BINDING_SITE' ? 'Binding' : 'Motifs';
                                            const isSelected = siteFilterCategory === cat;
                                            return (
                                                <button
                                                    key={cat}
                                                    type="button"
                                                    onClick={() => setSiteFilterCategory(cat)}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all ${
                                                        isSelected
                                                            ? 'bg-rose-950 text-rose-300 border border-rose-700 font-bold'
                                                            : 'bg-slate-800/80 text-slate-400 hover:text-white border border-slate-700'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Sites List */}
                                    <div className="space-y-1.5 overflow-y-auto max-h-[300px] pr-1">
                                        {functionalSites
                                            .filter(s => siteFilterCategory === 'ALL' || s.category === siteFilterCategory)
                                            .map(s => {
                                                const isEnabled = enabledSiteIds.has(s.id);
                                                const currentColor = siteColors[s.id] || s.color || '#e11d48';
                                                return (
                                                    <div 
                                                        key={s.id} 
                                                        className={`p-2 rounded-lg border transition-all flex items-center justify-between gap-2 ${
                                                            isEnabled 
                                                                ? 'bg-slate-800/90 border-rose-500/50 shadow-xs' 
                                                                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                            <input 
                                                                type="checkbox"
                                                                checked={isEnabled}
                                                                onChange={() => toggleSite(s.id)}
                                                                id={`site-chk-${s.id}`}
                                                                className="w-3.5 h-3.5 rounded text-rose-600 bg-slate-800 border-slate-600 focus:ring-0 cursor-pointer shrink-0"
                                                            />
                                                            
                                                            <label 
                                                                className="relative w-5 h-5 rounded-full cursor-pointer shrink-0 border border-white/20 shadow-xs flex items-center justify-center overflow-hidden" 
                                                                style={{ backgroundColor: currentColor }}
                                                                title="Change site highlight color"
                                                            >
                                                                <input 
                                                                    type="color" 
                                                                    value={currentColor} 
                                                                    onChange={e => setCustomSiteColor(s.id, e.target.value)} 
                                                                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                                                />
                                                            </label>

                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <label 
                                                                        htmlFor={`site-chk-${s.id}`} 
                                                                        className={`block text-[11px] font-semibold truncate cursor-pointer ${
                                                                            isEnabled ? 'text-white' : 'text-slate-400'
                                                                        }`}
                                                                        title={s.name}
                                                                    >
                                                                        {s.name}
                                                                    </label>
                                                                    <span className="px-1 py-0.2 rounded text-[9px] font-bold uppercase bg-slate-800 text-rose-300 border border-rose-900/50">
                                                                        {s.label}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-mono">
                                                                    <span>Pos: {s.start === s.end ? s.start : `${s.start}–${s.end}`}</span>
                                                                    {s.description && (
                                                                        <>
                                                                            <span className="text-slate-600">•</span>
                                                                            <span className="truncate max-w-[140px] text-slate-400" title={s.description}>
                                                                                {s.description}
                                                                            </span>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Focus Button */}
                                                        <button
                                                            type="button"
                                                            onClick={() => focusSite(s)}
                                                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors shrink-0"
                                                            title="Zoom camera directly to this site in 3D"
                                                        >
                                                            <MousePointer2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </>
                            ) : (
                                <div className="py-6 text-center text-slate-500 text-xs">
                                    No functional sites or motifs annotated for this structure.
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 2: PTMs */}
                    {activeAnnotationTab === 'ptms' && (
                        <div className="flex flex-col flex-1 overflow-hidden pt-1">
                            <div className="py-1 text-[11px] text-slate-400 leading-tight">
                                Highlight post-translational modifications (Phosphorylation, Acetylation, Ubiquitination, Methylation, etc.).
                            </div>

                            {proteinPtms && proteinPtms.length > 0 ? (
                                <>
                                    {/* Action Bar */}
                                    <div className="flex items-center justify-between py-1.5 mb-2 border-b border-slate-800/80">
                                        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                            Active: <span className="text-amber-400 font-bold">{enabledPtmIds.size}</span> of {proteinPtms.length}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={disableAllPtms}
                                                disabled={enabledPtmIds.size === 0}
                                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 border border-slate-700 transition-colors"
                                            >
                                                All Off
                                            </button>
                                            <button
                                                type="button"
                                                onClick={enableAllPtms}
                                                disabled={enabledPtmIds.size === proteinPtms.length}
                                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 border border-amber-500/50 transition-colors"
                                            >
                                                All On
                                            </button>
                                        </div>
                                    </div>

                                    {/* Category Filter Chips */}
                                    <div className="flex items-center gap-1 flex-wrap pb-2 border-b border-slate-800/60 mb-2">
                                        {['ALL', 'Phosphorylation', 'Acetylation', 'Methylation', 'Ubiquitination', 'SUMOylation', 'Glycosylation', 'Disulfide'].map(cat => {
                                            const label = cat === 'ALL' ? 'All' : cat === 'Phosphorylation' ? 'Phospho' : cat === 'Acetylation' ? 'Acetyl' : cat === 'Methylation' ? 'Methyl' : cat === 'Ubiquitination' ? 'Ubiquitin' : cat === 'SUMOylation' ? 'SUMO' : cat === 'Glycosylation' ? 'Glyco' : 'Disulfide';
                                            const isSelected = ptmFilterCategory === cat;
                                            return (
                                                <button
                                                    key={cat}
                                                    type="button"
                                                    onClick={() => setPtmFilterCategory(cat)}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all ${
                                                        isSelected
                                                            ? 'bg-amber-950 text-amber-300 border border-amber-700 font-bold'
                                                            : 'bg-slate-800/80 text-slate-400 hover:text-white border border-slate-700'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* PTMs List */}
                                    <div className="space-y-1.5 overflow-y-auto max-h-[300px] pr-1">
                                        {proteinPtms
                                            .filter(p => ptmFilterCategory === 'ALL' || p.category === ptmFilterCategory)
                                            .map(p => {
                                                const isEnabled = enabledPtmIds.has(p.id);
                                                const currentColor = ptmColors[p.id] || p.color || '#f59e0b';
                                                return (
                                                    <div 
                                                        key={p.id} 
                                                        className={`p-2 rounded-lg border transition-all flex items-center justify-between gap-2 ${
                                                            isEnabled 
                                                                ? 'bg-slate-800/90 border-amber-500/50 shadow-xs' 
                                                                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                            <input 
                                                                type="checkbox"
                                                                checked={isEnabled}
                                                                onChange={() => togglePtm(p.id)}
                                                                id={`ptm-chk-${p.id}`}
                                                                className="w-3.5 h-3.5 rounded text-amber-600 bg-slate-800 border-slate-600 focus:ring-0 cursor-pointer shrink-0"
                                                            />
                                                            
                                                            <label 
                                                                className="relative w-5 h-5 rounded-full cursor-pointer shrink-0 border border-white/20 shadow-xs flex items-center justify-center overflow-hidden" 
                                                                style={{ backgroundColor: currentColor }}
                                                                title="Change PTM highlight color"
                                                            >
                                                                <input 
                                                                    type="color" 
                                                                    value={currentColor} 
                                                                    onChange={e => setCustomPtmColor(p.id, e.target.value)} 
                                                                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                                                />
                                                            </label>

                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <span className="px-1 py-0.2 rounded text-[9px] font-bold uppercase bg-slate-800 text-amber-300 border border-amber-900/50">
                                                                        {p.badge}
                                                                    </span>
                                                                    <label 
                                                                        htmlFor={`ptm-chk-${p.id}`} 
                                                                        className={`block text-[11px] font-semibold truncate cursor-pointer ${
                                                                            isEnabled ? 'text-white' : 'text-slate-400'
                                                                        }`}
                                                                    >
                                                                        {p.category}
                                                                    </label>
                                                                    <span className="text-[10px] font-mono font-bold text-slate-300">
                                                                        {p.aminoAcid || ''}{p.start}
                                                                    </span>
                                                                </div>
                                                                <div className="text-[9px] text-slate-400 truncate max-w-[200px]" title={p.description}>
                                                                    {p.description}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Focus Button */}
                                                        <button
                                                            type="button"
                                                            onClick={() => focusPtm(p)}
                                                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors shrink-0"
                                                            title="Zoom camera directly to this PTM residue in 3D"
                                                        >
                                                            <MousePointer2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </>
                            ) : (
                                <div className="py-6 text-center text-slate-500 text-xs">
                                    No post-translational modifications annotated for this structure.
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 3: CONTACT INTERFACES */}
                    {activeAnnotationTab === 'interfaces' && (
                        <div className="flex flex-col flex-1 overflow-hidden pt-1">
                            <div className="py-1 text-[11px] text-slate-400 leading-tight">
                                Highlight structural contact residues from BioGRID & PDBe-KB interaction networks.
                            </div>

                            {proteinInterfaces && (proteinInterfaces.interfacePartners.length > 0 || proteinInterfaces.allInterfaceResidueIndices.length > 0) ? (
                                <>
                                    {/* Master Highlight All Toggle */}
                                    <div className="p-2.5 my-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <input 
                                                type="checkbox"
                                                id="master-interface-toggle"
                                                checked={showAllInterfaces}
                                                onChange={toggleAllInterfaces}
                                                className="w-4 h-4 rounded text-emerald-600 bg-slate-800 border-slate-600 focus:ring-0 cursor-pointer"
                                            />
                                            <label htmlFor="master-interface-toggle" className="font-bold text-white text-[11px] cursor-pointer">
                                                Highlight All Interface Contacts
                                            </label>
                                        </div>
                                        <span className="text-[10px] font-mono font-bold bg-emerald-900/60 text-emerald-300 px-2 py-0.5 rounded border border-emerald-700/60">
                                            {proteinInterfaces.allInterfaceResidueIndices.length} Residues
                                        </span>
                                    </div>

                                    {/* Action Bar */}
                                    <div className="flex items-center justify-between py-1.5 mb-2 border-b border-slate-800/80 gap-2 flex-wrap">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                                Partners: <span className="text-emerald-400 font-bold">{enabledInterfacePartners.size}</span> of {proteinInterfaces.interfacePartners.length}
                                            </span>
                                            {/* Style representation toggle for interfaces */}
                                            <div className="flex items-center bg-slate-800 rounded border border-slate-700 p-0.5" title="Interfaces 3D representation style">
                                                <button
                                                    type="button"
                                                    onClick={() => setInterfaceRepresentation('cartoon')}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                                        interfaceRepresentation === 'cartoon' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                                                    }`}
                                                >
                                                    Cartoon
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setInterfaceRepresentation('stick')}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                                        interfaceRepresentation === 'stick' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                                                    }`}
                                                >
                                                    Stick
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setInterfaceRepresentation('surface')}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                                        interfaceRepresentation === 'surface' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                                                    }`}
                                                >
                                                    Surface
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={disableAllInterfaces}
                                                disabled={!showAllInterfaces && enabledInterfacePartners.size === 0}
                                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 border border-slate-700 transition-colors"
                                            >
                                                All Off
                                            </button>
                                            <button
                                                type="button"
                                                onClick={enableAllInterfacePartners}
                                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/50 transition-colors"
                                            >
                                                All On
                                            </button>
                                        </div>
                                    </div>

                                    {/* Interface Partners List */}
                                    <div className="space-y-1.5 overflow-y-auto max-h-[300px] pr-1">
                                        {proteinInterfaces.interfacePartners.map(p => {
                                            const isEnabled = showAllInterfaces || enabledInterfacePartners.has(p.partnerSymbol);
                                            return (
                                                <div 
                                                    key={p.partnerSymbol} 
                                                    className={`p-2 rounded-lg border transition-all flex items-center justify-between gap-2 ${
                                                        isEnabled 
                                                            ? 'bg-slate-800/90 border-emerald-500/50 shadow-xs' 
                                                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        <input 
                                                            type="checkbox"
                                                            checked={isEnabled}
                                                            onChange={() => {
                                                                if (showAllInterfaces) setShowAllInterfaces(false);
                                                                toggleInterfacePartner(p.partnerSymbol);
                                                            }}
                                                            id={`intf-chk-${p.partnerSymbol}`}
                                                            className="w-3.5 h-3.5 rounded text-emerald-600 bg-slate-800 border-slate-600 focus:ring-0 cursor-pointer shrink-0"
                                                        />
                                                        
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <label 
                                                                    htmlFor={`intf-chk-${p.partnerSymbol}`} 
                                                                    className={`block text-[11px] font-semibold truncate cursor-pointer ${
                                                                        isEnabled ? 'text-white' : 'text-slate-400'
                                                                    }`}
                                                                >
                                                                    {p.partnerSymbol}
                                                                </label>
                                                                {p.isHomomer && (
                                                                    <span className="px-1 py-0.2 rounded text-[9px] font-bold uppercase bg-slate-800 text-purple-300 border border-purple-900/50">
                                                                        Homomer
                                                                    </span>
                                                                )}
                                                                {p.isNucleicAcid && (
                                                                    <span className="px-1 py-0.2 rounded text-[9px] font-bold uppercase bg-slate-800 text-cyan-300 border border-cyan-900/50">
                                                                        DNA/RNA
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-mono">
                                                                <span className="text-emerald-400 font-bold">{p.residueCount} Residues</span>
                                                                {p.pdbIds?.length > 0 && (
                                                                    <>
                                                                        <span className="text-slate-600">•</span>
                                                                        <span>{p.pdbIds.length} PDBs</span>
                                                                    </>
                                                                )}
                                                                {p.bioGridCount > 0 && (
                                                                    <>
                                                                        <span className="text-slate-600">•</span>
                                                                        <span>{p.bioGridCount} BioGRID Evidences</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Focus Button */}
                                                    <button
                                                        type="button"
                                                        onClick={() => focusInterfaceResidues(p.residues, p.partnerSymbol)}
                                                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors shrink-0"
                                                        title="Zoom camera directly to this interface patch in 3D"
                                                    >
                                                        <MousePointer2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            ) : (
                                <div className="py-6 text-center text-slate-500 text-xs">
                                    No structural interface contacts annotated for this structure.
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 4: DOMAINS */}
                    {activeAnnotationTab === 'domains' && (
                        <div className="flex flex-col flex-1 overflow-hidden pt-1">
                            <div className="py-1 text-[11px] text-slate-400 leading-tight">
                                Overlay individual functional domains on the 3D structure in customizable colors.
                            </div>

                            {proteinDomains && proteinDomains.length > 0 ? (
                                <>
                                    {/* Quick Action Toolbar */}
                                    <div className="flex items-center justify-between py-1.5 mb-2 border-b border-slate-800/80">
                                        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                            Active: <span className="text-indigo-400 font-bold">{enabledDomainIds.size}</span> of {proteinDomains.length}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={disableAllDomains}
                                                disabled={enabledDomainIds.size === 0}
                                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 border border-slate-700 transition-colors"
                                            >
                                                All Off
                                            </button>
                                            <button
                                                type="button"
                                                onClick={enableAllDomains}
                                                disabled={enabledDomainIds.size === proteinDomains.length}
                                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/50 transition-colors"
                                            >
                                                All On
                                            </button>
                                        </div>
                                    </div>

                                    {/* Domains List */}
                                    <div className="space-y-1.5 overflow-y-auto max-h-[300px] pr-1">
                                        {proteinDomains.map(d => {
                                            const isEnabled = enabledDomainIds.has(d.id);
                                            const currentColor = domainColors[d.id] || d.color || '#6366f1';
                                            return (
                                                <div 
                                                    key={d.id} 
                                                    className={`p-2 rounded-lg border transition-all flex items-center justify-between gap-2 ${
                                                        isEnabled 
                                                            ? 'bg-slate-800/90 border-indigo-500/50 shadow-xs' 
                                                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        <input 
                                                            type="checkbox"
                                                            checked={isEnabled}
                                                            onChange={() => toggleDomain(d.id)}
                                                            id={`domain-chk-${d.id}`}
                                                            className="w-3.5 h-3.5 rounded text-indigo-600 bg-slate-800 border-slate-600 focus:ring-0 cursor-pointer shrink-0"
                                                        />
                                                        
                                                        <label 
                                                            className="relative w-5 h-5 rounded-full cursor-pointer shrink-0 border border-white/20 shadow-xs flex items-center justify-center overflow-hidden" 
                                                            style={{ backgroundColor: currentColor }}
                                                            title="Change 3D domain color on the fly"
                                                        >
                                                            <input 
                                                                type="color" 
                                                                value={currentColor} 
                                                                onChange={e => setCustomDomainColor(d.id, e.target.value)} 
                                                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                                            />
                                                        </label>

                                                        <div className="min-w-0 flex-1">
                                                            <label 
                                                                htmlFor={`domain-chk-${d.id}`} 
                                                                className={`block text-[11px] font-semibold truncate cursor-pointer ${
                                                                    isEnabled ? 'text-white' : 'text-slate-400'
                                                                }`}
                                                                title={d.name}
                                                            >
                                                                {d.name}
                                                            </label>
                                                            <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-mono">
                                                                <span>{d.start}–{d.end}</span>
                                                                <span className="text-slate-600">•</span>
                                                                <span className="text-slate-400">{d.type}</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Focus Button */}
                                                    <button
                                                        type="button"
                                                        onClick={() => focusDomain(d)}
                                                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors shrink-0"
                                                        title="Zoom camera directly to this domain in 3D"
                                                    >
                                                        <MousePointer2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            ) : (
                                <div className="py-6 text-center text-slate-500 text-xs">
                                    No protein domains annotated for this structure.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
            {loading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 z-10 text-emerald-500">
                    <Dna className="w-8 h-8 animate-spin mb-2" />
                    <span className="text-xs font-bold uppercase tracking-wider">Fetching Structure...</span>
                </div>
            )}
            
            {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 z-10 text-slate-400 p-6 text-center">
                    <AlertCircle className="w-8 h-8 mb-2 text-red-400" />
                    <p className="text-sm font-medium mb-4">{error}</p>
                    <div className="flex gap-2 text-xs justify-center">
                        {activeHumanId && (
                            <a href={`https://alphafold.ebi.ac.uk/entry/${activeHumanId}`} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline flex items-center gap-1">
                                AF-Human <ExternalLink className="w-3 h-3"/>
                            </a>
                        )}
                        <span className="text-slate-600">|</span>
                        {activeYeastId && (
                            <a href={`https://alphafold.ebi.ac.uk/entry/${activeYeastId}`} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline flex items-center gap-1">
                                AF-Yeast <ExternalLink className="w-3 h-3"/>
                            </a>
                        )}
                    </div>
                    <button onClick={() => setShowIdControls(true)} className="mt-4 px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white">
                        Try different ID
                    </button>
                </div>
            )}

            {/* Mouse Capture Overlay for Object Manipulation */}
            {viewMode === 'overlay' && showManualControls && manipulationMode === 'object' && !loading && !error && (
                <div 
                    className="absolute inset-0 z-20 cursor-move"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                    title="Drag to Rotate Human Model. Shift+Drag to Translate."
                >
                    <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded pointer-events-none border border-slate-600/50 shadow-sm backdrop-blur-sm">
                        Mode: Move Object (Drag to Rotate, Shift+Drag to Move)
                    </div>
                </div>
            )}

            <div id="3dmol-container" ref={containerRef} className="w-full h-full cursor-move relative z-0"></div>
        </div>

        {/* Controls Bar */}
        <div className="px-4 py-3 bg-slate-900 border-t border-slate-700 flex flex-col gap-3">
            
            {/* Manual Alignment Controls (Collapsible) */}
            {viewMode === 'overlay' && showManualControls && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 p-3 bg-slate-800 rounded border border-slate-600 animate-fade-in text-xs">
                    <div className="col-span-full flex justify-between items-center mb-1">
                        <span className="font-bold text-slate-400 uppercase tracking-wider">Manual Alignment (Human Structure)</span>
                        <div className="flex gap-2 items-center">
                            <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer hover:text-white">
                                <input 
                                    type="checkbox" 
                                    checked={isRealTime} 
                                    onChange={(e) => setIsRealTime(e.target.checked)} 
                                    className="rounded bg-slate-700 border-slate-500 text-emerald-500 focus:ring-0"
                                />
                                Real-time
                            </label>
                            
                            {!isRealTime && (
                                <button 
                                    onClick={applyManualTransformation}
                                    className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold flex items-center gap-1"
                                >
                                    <Check className="w-3 h-3" /> Apply
                                </button>
                            )}

                            <div className="w-px h-4 bg-slate-600 mx-1"></div>

                            <div className="flex bg-slate-700 rounded p-0.5">
                                <button 
                                    onClick={() => setManipulationMode('object')}
                                    className={`px-2 py-0.5 rounded flex items-center gap-1 ${manipulationMode === 'object' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                    title="Drag on canvas moves the human structure"
                                >
                                    <Move className="w-3 h-3" /> Object
                                </button>
                                <button 
                                    onClick={() => setManipulationMode('camera')}
                                    className={`px-2 py-0.5 rounded flex items-center gap-1 ${manipulationMode === 'camera' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                    title="Drag on canvas moves the camera view"
                                >
                                    <Camera className="w-3 h-3" /> Camera
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex flex-col gap-1">
                        <label className="flex justify-between text-slate-400"><span>Move X</span> <span>{manualAdj.tx.toFixed(1)} Å</span></label>
                        <input type="range" min="-50" max="50" step="0.5" value={manualAdj.tx} onChange={e => setManualAdj({...manualAdj, tx: parseFloat(e.target.value)})} className="h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="flex justify-between text-slate-400"><span>Move Y</span> <span>{manualAdj.ty.toFixed(1)} Å</span></label>
                        <input type="range" min="-50" max="50" step="0.5" value={manualAdj.ty} onChange={e => setManualAdj({...manualAdj, ty: parseFloat(e.target.value)})} className="h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="flex justify-between text-slate-400"><span>Move Z</span> <span>{manualAdj.tz.toFixed(1)} Å</span></label>
                        <input type="range" min="-50" max="50" step="0.5" value={manualAdj.tz} onChange={e => setManualAdj({...manualAdj, tz: parseFloat(e.target.value)})} className="h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="flex justify-between text-slate-400"><span>Rotate X</span> <span>{manualAdj.rx.toFixed(0)}°</span></label>
                        <input type="range" min="-180" max="180" step="1" value={manualAdj.rx} onChange={e => setManualAdj({...manualAdj, rx: parseFloat(e.target.value)})} className="h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="flex justify-between text-slate-400"><span>Rotate Y</span> <span>{manualAdj.ry.toFixed(0)}°</span></label>
                        <input type="range" min="-180" max="180" step="1" value={manualAdj.ry} onChange={e => setManualAdj({...manualAdj, ry: parseFloat(e.target.value)})} className="h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="flex justify-between text-slate-400"><span>Rotate Z</span> <span>{manualAdj.rz.toFixed(0)}°</span></label>
                        <input type="range" min="-180" max="180" step="1" value={manualAdj.rz} onChange={e => setManualAdj({...manualAdj, rz: parseFloat(e.target.value)})} className="h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                    </div>
                    
                    <div className="col-span-full flex justify-end mt-1">
                        <button onClick={() => setManualAdj({ tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 })} className="text-[10px] text-slate-400 hover:text-white underline flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" /> Reset Transform
                        </button>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs items-center">
                {/* View Style Options */}
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px] w-24">Base Style</span>
                        <div className="flex bg-slate-800 rounded border border-slate-600 p-0.5">
                            <button onClick={() => setRepresentation('cartoon')} className={`px-2 py-1 rounded ${representation === 'cartoon' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Cartoon</button>
                            <button onClick={() => setRepresentation('stick')} className={`px-2 py-1 rounded ${representation === 'stick' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Stick</button>
                            <button onClick={() => setRepresentation('surface')} className={`px-2 py-1 rounded ${representation === 'surface' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Surface</button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px] w-24">Variant Style</span>
                        <div className="flex bg-slate-800 rounded border border-slate-600 p-0.5">
                            <button onClick={() => setVariantRepresentation('cartoon')} className={`px-2 py-1 rounded ${variantRepresentation === 'cartoon' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Cartoon</button>
                            <button onClick={() => setVariantRepresentation('stick')} className={`px-2 py-1 rounded ${variantRepresentation === 'stick' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Stick</button>
                            <button onClick={() => setVariantRepresentation('sphere')} className={`px-2 py-1 rounded ${variantRepresentation === 'sphere' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Sphere</button>
                            <button onClick={() => setVariantRepresentation('surface')} className={`px-2 py-1 rounded ${variantRepresentation === 'surface' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Surface</button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-rose-400 uppercase tracking-wider text-[10px] w-24 flex items-center gap-1">
                            <Target className="w-3 h-3 text-rose-400" /> Sites
                        </span>
                        <div className="flex bg-slate-800 rounded border border-slate-600 p-0.5">
                            <button onClick={() => setSiteRepresentation('cartoon')} className={`px-2 py-1 rounded ${siteRepresentation === 'cartoon' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Cartoon</button>
                            <button onClick={() => setSiteRepresentation('stick')} className={`px-2 py-1 rounded ${siteRepresentation === 'stick' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Stick</button>
                            <button onClick={() => setSiteRepresentation('surface')} className={`px-2 py-1 rounded ${siteRepresentation === 'surface' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Surface</button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-emerald-400 uppercase tracking-wider text-[10px] w-24 flex items-center gap-1">
                            <Users className="w-3 h-3 text-emerald-400" /> Interfaces
                        </span>
                        <div className="flex bg-slate-800 rounded border border-slate-600 p-0.5">
                            <button onClick={() => setInterfaceRepresentation('cartoon')} className={`px-2 py-1 rounded ${interfaceRepresentation === 'cartoon' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Cartoon</button>
                            <button onClick={() => setInterfaceRepresentation('stick')} className={`px-2 py-1 rounded ${interfaceRepresentation === 'stick' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Stick</button>
                            <button onClick={() => setInterfaceRepresentation('surface')} className={`px-2 py-1 rounded ${interfaceRepresentation === 'surface' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-300'}`}>Surface</button>
                        </div>
                    </div>
                </div>

                {/* Color Controls & Manual Toggle */}
                <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center justify-end gap-3 flex-wrap">
                        <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px] flex items-center gap-1">
                            <Palette className="w-3 h-3" /> Colors
                        </span>
                        
                        {viewMode === 'overlay' ? (
                            <>
                                <div className="flex items-center gap-1" title="Human Base">
                                    <input type="color" value={colors.humanBase} onChange={e => setColors({...colors, humanBase: e.target.value})} className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0" />
                                    <span className="text-slate-500">H.Base</span>
                                </div>
                                <div className="flex items-center gap-1" title="Human Variant">
                                    <input type="color" value={colors.humanVariant} onChange={e => setColors({...colors, humanVariant: e.target.value})} className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0" />
                                    <span className="text-slate-500">H.Var</span>
                                </div>
                                <div className="flex items-center gap-1" title="Yeast Base">
                                    <input type="color" value={colors.yeastBase} onChange={e => setColors({...colors, yeastBase: e.target.value})} className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0" />
                                    <span className="text-slate-500">Y.Base</span>
                                </div>
                                <div className="flex items-center gap-1" title="Yeast Variant">
                                    <input type="color" value={colors.yeastVariant} onChange={e => setColors({...colors, yeastVariant: e.target.value})} className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0" />
                                    <span className="text-slate-500">Y.Var</span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex items-center gap-1">
                                    <input type="color" value={colors.singleBase} onChange={e => setColors({...colors, singleBase: e.target.value})} className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0" />
                                    <span className="text-slate-500">Protein</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <input type="color" value={colors.singleVariant} onChange={e => setColors({...colors, singleVariant: e.target.value})} className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0" />
                                    <span className="text-slate-500">Variant</span>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Manual Align Toggle */}
                    {viewMode === 'overlay' && (
                        <button 
                            onClick={() => {
                                setShowManualControls(!showManualControls);
                                setManipulationMode('object'); // Default to object mode on open
                            }}
                            className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded transition-colors ${showManualControls ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                        >
                            <Move className="w-3 h-3" />
                            {showManualControls ? 'Hide Manual Align' : 'Manual Align'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    </div>
  );
});
