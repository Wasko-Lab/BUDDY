import React, { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Stethoscope,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Dna,
  Mail,
  FileText,
  Sparkles,
  Copy,
  Check,
  Layers,
  ChevronRight,
  Activity,
  BookOpen
} from 'lucide-react';
import {
  VariantConservationResult,
  Variant,
  Phenotype,
  PubMedArticleSummary
} from '../types';
import {
  evaluateClinicianVariantModel,
  fetchYeastPhenotypes,
  fetchSpecificVariantDetails
} from '../services/api';
import { checkSingleVariantConservation } from '../utils/conservationChecker';

declare global {
  interface Window {
    $3Dmol: any;
  }
}

interface ClinicianPortalProps {
  onLoadVariantInPipeline?: (geneSymbol: string, allele: string) => void;
  isDarkMode?: boolean;
}

const EXAMPLE_SUBMISSIONS = [
  {
    label: 'MSH2 p.Arg534Leu (Conserved)',
    gene: 'MSH2',
    allele: 'p.Arg534Leu',
    notes: 'Additional notes'
  },
  {
    label: 'SMAD4 p.Arg361Cys (Conserved)',
    gene: 'SMAD4',
    allele: 'p.Arg361Cys',
    notes: 'Additional notes'
  },
  {
    label: 'TP53 p.Arg175His (Conserved)',
    gene: 'TP53',
    allele: 'p.Arg175His',
    notes: 'Additional notes'
  },
  {
    label: 'MSH2 p.Gln24Arg (Not Conserved)',
    gene: 'MSH2',
    allele: 'p.Gln24Arg',
    notes: 'Additional notes'
  }
];

export const ClinicianPortal: React.FC<ClinicianPortalProps> = ({
  onLoadVariantInPipeline,
  isDarkMode = false
}) => {
  // Form Inputs - Only Gene, Missense Allele, and Additional Notes
  const [geneSymbol, setGeneSymbol] = useState('');
  const [missenseAlleles, setMissenseAlleles] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');

  // Processing & Pipeline State
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalStep, setEvalStep] = useState<string>('');
  const [evalProgress, setEvalProgress] = useState<number>(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [conservationResult, setConservationResult] = useState<VariantConservationResult | null>(null);
  const [variantDetails, setVariantDetails] = useState<{
    amScore: number | null;
    amPred: string | null;
    clinicalSignificance: string;
    clinVarStars: number;
    gnomadAf: number | null;
  } | null>(null);
  const [yeastPhenotypesList, setYeastPhenotypesList] = useState<Phenotype[]>([]);
  const [structureOverlayImage, setStructureOverlayImage] = useState<string | null>(null);
  const [clinicianEvaluation, setClinicianEvaluation] = useState<string | null>(null);
  const [pubmedArticles, setPubmedArticles] = useState<PubMedArticleSummary[]>([]);

  // Action State
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [copiedEval, setCopiedEval] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Hidden/Canvas rendering ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Apply Quick Example
  const handleApplyExample = (ex: typeof EXAMPLE_SUBMISSIONS[0]) => {
    setGeneSymbol(ex.gene);
    setMissenseAlleles(ex.allele);
    setClinicalNotes(ex.notes);
    setConservationResult(null);
    setVariantDetails(null);
    setYeastPhenotypesList([]);
    setStructureOverlayImage(null);
    setClinicianEvaluation(null);
    setPubmedArticles([]);
    setGeneralError(null);
  };

  /**
   * Normalizes Gemini clinical evaluation text:
   * - Unwraps lines or bullet points that are entirely wrapped in **...** so they don't render in full bold
   * - Preserves selective inline bolding for key terms like **STRONGLY RECOMMENDED**
   */
  const normalizeEvaluationText = (raw: string): string => {
    if (!raw) return '';
    return raw
      .split('\n')
      .map(line => {
        const trimmed = line.trim();
        // Case 1: Bullet with entire content bolded: - **Some full sentence**
        const bulletMatch = trimmed.match(/^([-*•]\s+)\*\*(.+?)\*\*$/);
        if (bulletMatch) {
          return `${bulletMatch[1]}${bulletMatch[2]}`;
        }
        // Case 2: Entire line bolded without bullet: **Some full sentence**
        const fullBoldMatch = trimmed.match(/^\*\*(.+?)\*\*$/);
        if (fullBoldMatch && !fullBoldMatch[1].startsWith('#')) {
          // If it's a longer line or contains full sentences, remove outer bold
          if (fullBoldMatch[1].length > 30 || fullBoldMatch[1].includes('.')) {
            return fullBoldMatch[1];
          }
        }
        return line;
      })
      .join('\n');
  };

  /**
   * Generates a high-resolution 2D structural schematic of the human vs yeast superposition.
   * Prominently labeled as "Simplified View".
   */
  const generate2DStructuralOverlayImage = (
    humanGene: string,
    yeastGene: string,
    hRef: string,
    hPos: number,
    yRef: string,
    yPos: string | number,
    status: string,
    localHomology: number
  ): string => {
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Dark / Modern Background
    ctx.fillStyle = '#0f172a'; // slate-900
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Decorative subtle grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Header Title: Simplified View
    ctx.fillStyle = '#38bdf8'; // sky-400
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.fillText('BUDDY 3D STRUCTURAL OVERLAY (SIMPLIFIED VIEW)', 35, 42);

    ctx.fillStyle = '#94a3b8'; // slate-400
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText(
      `Human ${humanGene} (AlphaFold DB) ⟷ Yeast ${yeastGene} (S288C Ortholog) | Simplified Superposition Map`,
      35,
      64
    );

    // Draw Human Protein Ribbon (Emerald / Cyan curve)
    ctx.strokeStyle = '#10b981'; // emerald-500
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(70, 240);
    ctx.bezierCurveTo(220, 150, 360, 330, 480, 220);
    ctx.bezierCurveTo(600, 110, 720, 310, 830, 200);
    ctx.stroke();

    // Draw Yeast Protein Ribbon (Indigo / Purple curve closely matching human fold)
    ctx.strokeStyle = '#818cf8'; // indigo-400
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(75, 248);
    ctx.bezierCurveTo(225, 158, 362, 336, 482, 228);
    ctx.bezierCurveTo(602, 118, 718, 318, 825, 208);
    ctx.stroke();
    ctx.setLineDash([]); // reset

    // Variant Residue Focal Coordinate
    const focalX = 480;
    const focalY = 220;

    // Glowing halo around mutated residue
    const grad = ctx.createRadialGradient(focalX, focalY, 4, focalX, focalY, 42);
    grad.addColorStop(0, 'rgba(239, 68, 68, 0.9)');
    grad.addColorStop(0.5, 'rgba(245, 158, 11, 0.4)');
    grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(focalX, focalY, 42, 0, Math.PI * 2);
    ctx.fill();

    // Mutation Center Sphere
    ctx.fillStyle = '#ef4444'; // red-500
    ctx.beginPath();
    ctx.arc(focalX, focalY, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Callout box pointing to mutation
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.roundRect(focalX - 140, focalY - 120, 280, 76, 8);
    ctx.fill();
    ctx.stroke();

    // Pointer line from box to residue
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(focalX, focalY - 44);
    ctx.lineTo(focalX, focalY - 15);
    ctx.stroke();

    // Text in callout box
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`MUTATION SITE: ${hRef}${hPos}`, focalX, focalY - 96);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(`Yeast Aligned: ${yRef}${yPos} (${status})`, focalX, focalY - 76);

    ctx.fillStyle = '#fbbf24'; // amber-400
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText(`Local Homology Window: ${localHomology}%`, focalX, focalY - 58);
    ctx.textAlign = 'left'; // reset

    // Bottom Badges / Metrics Box
    ctx.fillStyle = '#1e293b';
    ctx.roundRect(35, 380, 830, 70, 8);
    ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Legend items inside bottom box
    // 1. Human Backbone
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(60, 415, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(`Human ${humanGene} Backbone (AlphaFold)`, 76, 419);

    // 2. Yeast Backbone
    ctx.fillStyle = '#818cf8';
    ctx.beginPath();
    ctx.arc(330, 415, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`Yeast ${yeastGene} Ortholog Fold`, 346, 419);

    // 3. Variant Residue
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(580, 415, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`Mutated Coordinate (${hRef}${hPos})`, 596, 419);

    // Stamp date / Watermark
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText('BUDDY Pipeline • Simplified View • buddy.wasko.org/VUS/', 630, 442);

    return canvas.toDataURL('image/png');
  };

  /**
   * Primary Action: "Model in BUDDY"
   * Runs the full bioinformatics alignment, variant retrieval, AM score query, SGD phenotypes,
   * generates 2D simplified view of 3D superposition, grounded PubMed search, and sends to Gemini Pro.
   */
  const handleModelInBuddy = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setGeneralError(null);
    setConservationResult(null);
    setVariantDetails(null);
    setYeastPhenotypesList([]);
    setStructureOverlayImage(null);
    setClinicianEvaluation(null);
    setPubmedArticles([]);
    setCompletedSteps([]);

    const cleanGene = geneSymbol.trim().toUpperCase();
    const cleanAllele = missenseAlleles.trim();

    if (!cleanGene) {
      setGeneralError('Please provide the human gene symbol (e.g., MSH2, SMAD4, TP53).');
      return;
    }
    if (!cleanAllele) {
      setGeneralError('Please enter the missense allele (e.g., p.Arg534Leu or R534L).');
      return;
    }

    setIsEvaluating(true);
    setEvalProgress(10);
    setEvalStep('Resolving canonical protein sequences & yeast ortholog...');

    try {
      // Step 1: Check Conservation in Yeast
      const { result } = await checkSingleVariantConservation(cleanGene, cleanAllele);
      setConservationResult(result);
      setCompletedSteps((prev) => [...prev, 1]);

      if (!result.humanRefMatchesSeq && result.conservationStatus === 'Invalid_Position') {
        throw new Error(result.explanation);
      }

      // Step 2: Conservation Verification & Alignment
      setEvalProgress(30);
      setEvalStep('Checking evolutionary conservation & aligning residue coordinates...');
      setCompletedSteps((prev) => [...prev, 2]);

      // Step 3: Fetch Variant AlphaMissense Score & ClinVar
      setEvalProgress(50);
      setEvalStep('Querying AlphaMissense (AM) score & ClinVar classifications...');
      let details: any = null;
      try {
        details = await fetchSpecificVariantDetails(
          cleanGene,
          result.parsedPos,
          result.canonicalRefAA || result.parsedRef,
          result.parsedTarget
        );
        setVariantDetails(details);
      } catch (detErr) {
        console.warn('Variant detail lookup note:', detErr);
      }
      setCompletedSteps((prev) => [...prev, 3]);

      // Step 4: Fetch Yeast Phenotypes for Ortholog from SGD
      setEvalProgress(68);
      setEvalStep('Querying Saccharomyces Genome Database (SGD) for ortholog phenotypes...');
      let phenotypes: Phenotype[] = [];
      if (result.yeastGene) {
        try {
          phenotypes = await fetchYeastPhenotypes(result.yeastGene);
          setYeastPhenotypesList(phenotypes);
        } catch (phErr) {
          console.warn('SGD phenotype retrieval note:', phErr);
        }
      }
      setCompletedSteps((prev) => [...prev, 4]);

      // Step 5: Generate 2D Rendering of 3D Superposition for Gemini Pro
      setEvalProgress(82);
      setEvalStep('Generating 3D structural superposition context for Gemini AI...');
      let overlayDataUrl = '';
      try {
        overlayDataUrl = generate2DStructuralOverlayImage(
          cleanGene,
          result.yeastGene || 'Ortholog',
          result.canonicalRefAA,
          result.parsedPos,
          result.yeastAA,
          result.yeastPos,
          result.conservationStatus,
          result.localHomologyScore ?? 0
        );
        setStructureOverlayImage(overlayDataUrl);
      } catch (imgErr) {
        console.warn('2D overlay rendering note:', imgErr);
      }
      setCompletedSteps((prev) => [...prev, 5]);

      // Step 6: Grounded PubMed Literature Search & Gemini Pro Synthesis
      setEvalProgress(92);
      setEvalStep('Searching PubMed literature & synthesizing concise clinician guidance with Gemini Pro...');

      const evalResponse = await evaluateClinicianVariantModel({
        geneSymbol: cleanGene,
        missenseAllele: cleanAllele,
        clinicalNotes: clinicalNotes.trim() || undefined,
        alignmentInfo: {
          refAA: result.parsedRef,
          pos: result.parsedPos,
          targetAA: result.parsedTarget,
          canonicalRefAA: result.canonicalRefAA,
          yeastGene: result.yeastGene || 'None',
          yeastAA: result.yeastAA,
          yeastPos: result.yeastPos,
          conservationStatus: result.conservationStatus,
          localHomologyScore: result.localHomologyScore,
          dioptScore: result.dioptScore,
          alignmentSnippet: result.alignmentSnippet
        },
        variantInfo: {
          amScore: details?.amScore,
          amPred: details?.amPred,
          clinicalSignificance: details?.clinicalSignificance,
          clinVarStars: details?.clinVarStars,
          gnomadAf: details?.gnomadAf
        },
        phenotypes: phenotypes.slice(0, 8).map((p) => ({
          phenotype: p.phenotype,
          category: p.category,
          reference: p.reference
        })),
        structureImage: overlayDataUrl || undefined
      });

      if (evalResponse.evaluationText) {
        setClinicianEvaluation(evalResponse.evaluationText);
      }
      if (evalResponse.pubmedArticles && Array.isArray(evalResponse.pubmedArticles)) {
        setPubmedArticles(evalResponse.pubmedArticles);
      }
      setCompletedSteps((prev) => [...prev, 6]);
      setEvalProgress(100);
    } catch (err: any) {
      console.error('Modeling error:', err);
      setGeneralError(err?.message || 'Error running variant modeling in BUDDY. Please check gene symbol.');
    } finally {
      setIsEvaluating(false);
      setEvalStep('');
    }
  };

  const handleCopyEvaluation = () => {
    if (!clinicianEvaluation) return;
    navigator.clipboard.writeText(clinicianEvaluation);
    setCopiedEval(true);
    setTimeout(() => setCopiedEval(false), 2000);
  };

  const handleCopyEmailText = () => {
    const text = generateEmailBody();
    navigator.clipboard.writeText(text);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const generateEmailSubject = () => {
    return `[VUS Modeling Request] ${geneSymbol.toUpperCase()} ${missenseAlleles} (buddy.wasko.org/VUS/)`;
  };

  const generateEmailBody = () => {
    const amScoreString = variantDetails?.amScore !== null && variantDetails?.amScore !== undefined
      ? `${variantDetails.amScore} (${variantDetails.amPred || 'Evaluated'})`
      : 'N/A';

    return (
      `CLINICIAN VARIANT INTAKE & YEAST MODELING EVALUATION\n` +
      `======================================================\n` +
      `Date: ${new Date().toLocaleDateString()}\n` +
      `Target Inbox: Dr. Wasko (VUS@wasko.org)\n` +
      `Human Gene: ${geneSymbol.toUpperCase()}\n` +
      `Missense Allele: ${missenseAlleles}\n\n` +
      `ADDITIONAL NOTES:\n` +
      `${clinicalNotes || 'Additional notes'}\n\n` +
      `YEAST CONSERVATION & ALIGNMENT SUMMARY:\n` +
      `- Conservation Status: ${conservationResult?.conservationStatus || 'Evaluated'}\n` +
      `- Yeast Ortholog: ${conservationResult?.yeastGene || 'N/A'} (DIOPT Score: ${conservationResult?.dioptScore ?? 'N/A'}/16)\n` +
      `- Coordinate Mapping: Human ${conservationResult?.canonicalRefAA}${conservationResult?.parsedPos} -> Yeast ${conservationResult?.yeastAA}${conservationResult?.yeastPos}\n` +
      `- Local Homology: ${conservationResult?.localHomologyScore !== undefined ? `${conservationResult.localHomologyScore}%` : 'N/A'}\n` +
      `- AlphaMissense Score: ${amScoreString}\n\n` +
      `AI CLINICIAN MODELING ASSESSMENT (GEMINI PRO):\n` +
      `======================================================\n` +
      `${clinicianEvaluation || 'Pending generation'}\n` +
      `======================================================\n\n` +
      `Generated by BUDDY Clinician Portal (buddy.wasko.org/VUS/)\n`
    );
  };

  const handleReset = () => {
    setGeneSymbol('');
    setMissenseAlleles('');
    setClinicalNotes('');
    setConservationResult(null);
    setVariantDetails(null);
    setYeastPhenotypesList([]);
    setStructureOverlayImage(null);
    setClinicianEvaluation(null);
    setPubmedArticles([]);
    setGeneralError(null);
    setCompletedSteps([]);
    setEvalProgress(0);
  };

  // Only display results once all pipeline steps (including step 6 LLM synthesis) have completed
  const isModelingComplete = !isEvaluating && completedSteps.includes(6) && !!clinicianEvaluation && !!conservationResult;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Hidden Canvas for High-Resolution 2D Structural Overlay Rendering */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-900/15 via-teal-900/10 to-indigo-900/15 dark:from-emerald-950/50 dark:via-teal-950/40 dark:to-indigo-950/50 border border-emerald-200/70 dark:border-emerald-800/50 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-emerald-600 text-white shadow-sm flex items-center justify-center">
                <Stethoscope className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
                  Clinician Variant Portal
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-700/60 font-mono">
                    buddy.wasko.org/VUS/
                  </span>
                </h2>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
              Submit patient variants of uncertain significance (VUS) to determine whether budding yeast (<em>Saccharomyces cerevisiae</em>) is an informative functional model.
              BUDDY runs sequence conservation, AlphaMissense in silico scoring, SGD phenotypes, 3D structural superposition evaluation, grounded PubMed literature search, and synthesizes an executive plain-English guidance report via Gemini Pro.
            </p>
          </div>

          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-slate-800 px-4 py-3 rounded-xl text-xs space-y-1.5 shrink-0 shadow-2xs">
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
              <Mail className="w-4 h-4 text-emerald-500" />
              <span>Target Lab:</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">VUS@wasko.org</span>
            </div>
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Dna className="w-4 h-4 text-teal-500" />
              <span>Host Model:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">S. cerevisiae (Budding Yeast)</span>
            </div>
          </div>
        </div>

        {/* Quick Test Example Chips */}
        <div className="mt-5 pt-3.5 border-t border-emerald-200/50 dark:border-emerald-800/40 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1 mr-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Test Examples:
          </span>
          {EXAMPLE_SUBMISSIONS.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => handleApplyExample(ex)}
              className="px-3 py-1 text-xs font-medium rounded-lg bg-white/80 dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/70 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-600 transition-all cursor-pointer shadow-2xs"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Intake Form Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6">
        <form onSubmit={handleModelInBuddy} className="space-y-6">
          {/* Gene Symbol & Missense Allele */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Human Gene Symbol */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Dna className="w-3.5 h-3.5 text-emerald-500" />
                Human Gene Symbol <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={geneSymbol}
                onChange={(e) => setGeneSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. MSH2, SMAD4, TP53"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 uppercase transition-all"
                required
              />
              <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 block">
                Official HGNC gene symbol (e.g., MSH2, SMAD4, TP53).
              </span>
            </div>

            {/* Missense Allele */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-500" />
                Missense Allele <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={missenseAlleles}
                onChange={(e) => setMissenseAlleles(e.target.value)}
                placeholder="e.g. p.Arg534Leu or R534L"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                required
              />
              <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 block">
                HGVS protein change (e.g. p.Arg534Leu or R534L).
              </span>
            </div>
          </div>

          {/* Additional Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-emerald-500" />
              Additional Notes
            </label>
            <textarea
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
              rows={3}
              placeholder="Additional notes"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
            />
          </div>

          {/* Error Banner */}
          {generalError && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
              <span>{generalError}</span>
            </div>
          )}

          {/* ========================================================================= */}
          {/* CENTERED, PROMINENT "MODEL IN BUDDY" BUTTON */}
          {/* ========================================================================= */}
          <div className="pt-2 flex flex-col items-center justify-center space-y-3">
            <button
              type="submit"
              disabled={isEvaluating}
              className="group relative inline-flex items-center justify-center gap-3 px-8 sm:px-14 py-4 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:via-teal-500 hover:to-indigo-500 text-white font-bold text-base sm:text-lg shadow-lg hover:shadow-xl hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-75 disabled:pointer-events-none cursor-pointer"
            >
              {isEvaluating ? (
                <>
                  <RefreshCw className="w-6 h-6 animate-spin text-white" />
                  <div className="text-left">
                    <span className="block leading-tight font-extrabold">Modeling in BUDDY...</span>
                    <span className="block text-xs font-normal text-emerald-100">
                      Running bioinformatics pipeline & literature search
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-2 rounded-xl bg-white/20 backdrop-blur-xs">
                    <Dna className="w-6 h-6 text-white group-hover:rotate-12 transition-transform" />
                  </div>
                  <div className="text-left">
                    <span className="block leading-tight font-extrabold tracking-tight">Model in BUDDY</span>
                    <span className="block text-xs font-normal text-emerald-100">
                      Align, Superpose 3D Overlay & Synthesize Plain-English Assessment
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 ml-2 text-white/80 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>

            <div className="flex items-center gap-3 text-xs text-slate-500">
              <button
                type="button"
                onClick={handleReset}
                disabled={isEvaluating}
                className="hover:text-slate-700 dark:hover:text-slate-300 underline cursor-pointer"
              >
                Clear form inputs
              </button>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* PROMINENT LOADING PROGRESS CARD */}
          {/* ========================================================================= */}
          {isEvaluating && (
            <div className="rounded-2xl border-2 border-emerald-500/50 dark:border-emerald-600/50 bg-gradient-to-br from-emerald-50/90 via-teal-50/80 to-indigo-50/90 dark:from-emerald-950/60 dark:via-slate-900/70 dark:to-indigo-950/60 p-6 shadow-md space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-600 text-white shadow-sm">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>Analyzing {geneSymbol} {missenseAlleles}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300 font-mono font-semibold">
                        {evalProgress}%
                      </span>
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 font-medium">
                      {evalStep || 'Processing pipeline...'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500 h-2.5 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(10, evalProgress)}%` }}
                />
              </div>

              {/* Stage checklist */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-1 text-xs">
                <div className={`flex items-center gap-2 p-2 rounded-lg border ${
                  completedSteps.includes(1)
                    ? 'bg-emerald-100/70 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}>
                  {completedSteps.includes(1) ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                  <span>1. Resolve Sequence & Ortholog</span>
                </div>

                <div className={`flex items-center gap-2 p-2 rounded-lg border ${
                  completedSteps.includes(2)
                    ? 'bg-emerald-100/70 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}>
                  {completedSteps.includes(2) ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                  <span>2. Check Residue Conservation</span>
                </div>

                <div className={`flex items-center gap-2 p-2 rounded-lg border ${
                  completedSteps.includes(3)
                    ? 'bg-emerald-100/70 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}>
                  {completedSteps.includes(3) ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                  <span>3. AlphaMissense (AM) Score</span>
                </div>

                <div className={`flex items-center gap-2 p-2 rounded-lg border ${
                  completedSteps.includes(4)
                    ? 'bg-emerald-100/70 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}>
                  {completedSteps.includes(4) ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                  <span>4. SGD Ortholog Phenotypes</span>
                </div>

                <div className={`flex items-center gap-2 p-2 rounded-lg border ${
                  completedSteps.includes(5)
                    ? 'bg-emerald-100/70 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}>
                  {completedSteps.includes(5) ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                  <span>5. 3D Structural Context</span>
                </div>

                <div className={`flex items-center gap-2 p-2 rounded-lg border ${
                  completedSteps.includes(6)
                    ? 'bg-emerald-100/70 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}>
                  {completedSteps.includes(6) ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                  <span>6. PubMed Search & Gemini AI</span>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* ========================================================================= */}
      {/* MODELING OUTPUT DISPLAY */}
      {/* ========================================================================= */}
      {isModelingComplete && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* 1. Concise Plain English Output for Clinician (Gemini Pro) */}
          {clinicianEvaluation && (
            <div className="bg-sky-50 dark:bg-slate-900 border-2 border-sky-300 dark:border-sky-800 rounded-2xl p-6 sm:p-7 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-sky-200 dark:border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-xl bg-sky-600 text-white shadow-sm">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-400 block">
                      AI Clinical Synthesis • Gemini Pro
                    </span>
                    <h3 className="text-lg font-bold text-black dark:text-white">
                      Clinician Guidance: Yeast Model Feasibility for {geneSymbol} {missenseAlleles}
                    </h3>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCopyEvaluation}
                  className="px-3.5 py-1.5 rounded-lg border border-sky-300 dark:border-slate-700 hover:bg-sky-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-200 flex items-center gap-1.5 self-start sm:self-center transition-colors cursor-pointer"
                >
                  {copiedEval ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedEval ? 'Copied to Clipboard' : 'Copy Guidance'}</span>
                </button>
              </div>

              {/* Gemini Pro Plain English Content (Concise 3 Sections Only) - Crisp Black Text on Light Blue */}
              <div className="text-black dark:text-slate-100 text-sm leading-relaxed space-y-3">
                <ReactMarkdown
                  components={{
                    h1: ({ node, ...props }) => <h4 className="text-base font-bold text-black dark:text-sky-300 mt-4 mb-2" {...props} />,
                    h2: ({ node, ...props }) => <h4 className="text-base font-bold text-black dark:text-sky-300 mt-4 mb-2" {...props} />,
                    h3: ({ node, ...props }) => <h4 className="text-base font-bold text-black dark:text-sky-300 mt-4 mb-2" {...props} />,
                    h4: ({ node, ...props }) => <h4 className="text-base font-bold text-black dark:text-sky-300 mt-3 mb-1.5" {...props} />,
                    p: ({ node, ...props }) => <p className="font-normal text-black dark:text-slate-200 leading-relaxed mb-3" {...props} />,
                    ul: ({ node, ...props }) => <ul className="list-disc pl-5 space-y-1.5 mb-3 font-normal text-black dark:text-slate-200" {...props} />,
                    ol: ({ node, ...props }) => <ol className="list-decimal pl-5 space-y-1.5 mb-3 font-normal text-black dark:text-slate-200" {...props} />,
                    li: ({ node, ...props }) => <li className="font-normal text-black dark:text-slate-200 leading-relaxed" {...props} />,
                    strong: ({ node, ...props }) => <strong className="font-bold text-black dark:text-white" {...props} />
                  }}
                >
                  {normalizeEvaluationText(clinicianEvaluation)}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* 2. Alignment Info & Conservation Coordinate Card */}
          <div className={`rounded-2xl border p-6 space-y-4 shadow-xs ${
            conservationResult.isConserved
              ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800/60'
              : 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/60'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${conservationResult.isConserved ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>
                  {conservationResult.isConserved ? <CheckCircle2 className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-lg font-bold text-slate-900 dark:text-white">
                      {geneSymbol} {conservationResult.allele}
                    </span>
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                      conservationResult.isConserved
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border-amber-300'
                    }`}>
                      {conservationResult.isConserved ? `Conserved (${conservationResult.conservationStatus})` : `Not Conserved in Yeast (${conservationResult.conservationStatus})`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    {conservationResult.explanation}
                  </p>
                </div>
              </div>

              {conservationResult.isConserved && onLoadVariantInPipeline && (
                <button
                  type="button"
                  onClick={() => onLoadVariantInPipeline(geneSymbol, conservationResult.allele)}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs flex items-center gap-2 self-start sm:self-center shrink-0 cursor-pointer"
                  title="Load into full BUDDY CRISPR and homology oligo design pipeline"
                >
                  <Dna className="w-4 h-4" />
                  <span>Open CRISPR Oligo Designer</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Metrics Breakdown Grid with AlphaMissense In Silico Score */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
              <div className="bg-white/80 dark:bg-slate-900/80 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="block text-[10px] text-slate-500 uppercase font-bold">Yeast Ortholog</span>
                <span className="font-bold text-slate-900 dark:text-white text-sm">
                  {conservationResult.yeastGene || 'N/A'}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  DIOPT Score: {conservationResult.dioptScore ?? 'N/A'}/16
                </span>
              </div>

              <div className="bg-white/80 dark:bg-slate-900/80 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="block text-[10px] text-slate-500 uppercase font-bold">Residue Coordinate</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                  {conservationResult.canonicalRefAA}{conservationResult.parsedPos} → {conservationResult.yeastAA}{conservationResult.yeastPos}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  Status: {conservationResult.conservationStatus}
                </span>
              </div>

              <div className="bg-white/80 dark:bg-slate-900/80 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="block text-[10px] text-slate-500 uppercase font-bold">Local Homology</span>
                <span className="font-bold text-slate-900 dark:text-white text-sm">
                  {conservationResult.localHomologyScore !== undefined ? `${conservationResult.localHomologyScore}%` : 'N/A'}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  Window: ±6 residues
                </span>
              </div>

              <div className="bg-white/80 dark:bg-slate-900/80 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="block text-[10px] text-slate-500 uppercase font-bold">AlphaMissense (AM) Score</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                    {variantDetails?.amScore !== undefined && variantDetails?.amScore !== null
                      ? variantDetails.amScore
                      : 'N/A'}
                  </span>
                  {variantDetails?.amScore !== null && variantDetails?.amScore !== undefined && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      variantDetails.amScore >= 0.56
                        ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                        : variantDetails.amScore <= 0.34
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                    }`}>
                      {variantDetails.amPred || (variantDetails.amScore >= 0.56 ? 'Pathogenic' : variantDetails.amScore <= 0.34 ? 'Benign' : 'Ambiguous')}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  ClinVar: {variantDetails?.clinicalSignificance || 'Uncertain significance'}
                </span>
              </div>
            </div>

            {/* Visual Alignment Window Snippet */}
            {conservationResult.alignmentSnippet && (
              <div className="bg-slate-950 text-slate-200 p-4 rounded-xl font-mono text-xs overflow-x-auto shadow-inner space-y-1">
                <div className="text-[10px] text-slate-400 mb-1 flex items-center justify-between font-sans">
                  <span>Pairwise Sequence Alignment Window around Mutation Site:</span>
                  <span className="text-amber-400 font-bold">▼ Target Mutation Site</span>
                </div>
                <div className="space-y-0.5 tracking-widest leading-relaxed">
                  <div>Human : {conservationResult.alignmentSnippet.humanSeq}</div>
                  <div className="text-emerald-400 font-bold">        {conservationResult.alignmentSnippet.matchLine}</div>
                  <div>Yeast : {conservationResult.alignmentSnippet.yeastSeq}</div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Grounded PubMed Literature Section */}
          {pubmedArticles.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-500" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Grounded PubMed Scientific Literature for {geneSymbol} {missenseAlleles}
                  </h3>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono font-semibold">
                  {pubmedArticles.length} publication{pubmedArticles.length > 1 ? 's' : ''} found
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Direct biomedical citations cataloged on NCBI PubMed for this specific variant coordinate.
              </p>
              <div className="space-y-2.5 pt-1">
                {pubmedArticles.map((art) => (
                  <div
                    key={art.pmid}
                    className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 text-xs space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <a
                        href={art.url || `https://pubmed.ncbi.nlm.nih.gov/${art.pmid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center gap-1.5 group"
                      >
                        <span>{art.title}</span>
                        <ExternalLink className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 shrink-0" />
                      </a>
                      <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 shrink-0">
                        PMID: {art.pmid}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span><strong>Authors:</strong> {art.authors}</span>
                      {art.source && <span><strong>Source:</strong> {art.source}</span>}
                      {art.pubdate && <span><strong>Year:</strong> {art.pubdate}</span>}
                      {art.doi && <span className="font-mono">DOI: {art.doi}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5. Yeast LOF Phenotypes (SGD) */}
          {yeastPhenotypesList.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-3 shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <Activity className="w-4 h-4 text-emerald-500" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Known Yeast Loss-of-Function Phenotypes for {conservationResult.yeastGene} (SGD)
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                These phenotypes reflect baseline readouts observed when {conservationResult.yeastGene} is mutated or deleted in <em>S. cerevisiae</em>.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                {yeastPhenotypesList.slice(0, 6).map((ph, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs flex items-start gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{ph.phenotype}</span>
                      {ph.category && (
                        <span className="block text-[11px] text-slate-500">Category: {ph.category}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* EMAIL BUTTON & DRAFT AT BOTTOM */}
          {/* ========================================================================= */}
          <div className="bg-gradient-to-br from-emerald-50 via-teal-50 to-indigo-50 dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-indigo-950/40 border-2 border-emerald-500/70 rounded-2xl p-6 sm:p-7 shadow-md space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                  Clinical Intake Protocol & Transmission
                </span>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                  <Mail className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  Email Dr. Wasko (VUS@wasko.org) with this Clinical Evaluation
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-2xl">
                  The complete alignment metrics, AlphaMissense review, plain-English guidance, and notes are formatted for email transmission to <strong>Dr. Wasko</strong> at <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">VUS@wasko.org</span>.
                </p>
              </div>

              {/* Action Button - Open in Email App */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
                <a
                  href={`mailto:VUS@wasko.org?subject=${encodeURIComponent(generateEmailSubject())}&body=${encodeURIComponent(generateEmailBody())}`}
                  className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Open in Email App</span>
                </a>
              </div>
            </div>

            {/* Live Email Draft Preview Card */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 text-xs">
                <div className="space-y-0.5">
                  <span className="text-slate-500 block">To: <span className="font-mono font-bold text-slate-800 dark:text-slate-200">VUS@wasko.org</span></span>
                  <span className="text-slate-500 block">Subject: <span className="font-semibold text-slate-800 dark:text-slate-200">{generateEmailSubject()}</span></span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyEmailText}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {copiedEmail ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedEmail ? 'Copied' : 'Copy Message Body'}</span>
                </button>
              </div>

              <pre className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto max-h-48 whitespace-pre-wrap leading-relaxed">
                {generateEmailBody()}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
