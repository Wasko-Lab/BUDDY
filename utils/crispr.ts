
import { Cas9Site, RepairResult, CodonTable, AlignmentData, VerificationPrimers, CodingExon, AdvancedSettings } from '../types';

// --- Constants & Tables ---

export const CODON_TABLE: CodonTable = {
  'F': ['TTT', 'TTC'], 'L': ['TTA', 'TTG', 'CTT', 'CTC', 'CTA', 'CTG'],
  'I': ['ATT', 'ATC', 'ATA'], 'M': ['ATG'], 'V': ['GTT', 'GTC', 'GTA', 'GTG'],
  'S': ['TCT', 'TCC', 'TCA', 'TCG', 'AGT', 'AGC'], 'P': ['CCT', 'CCC', 'CCA', 'CCG'],
  'T': ['ACT', 'ACC', 'ACA', 'ACG'], 'A': ['GCT', 'GCC', 'GCA', 'GCG'],
  'Y': ['TAT', 'TAC'], 'H': ['CAT', 'CAC'], 'Q': ['CAA', 'CAG'],
  'N': ['AAT', 'AAC'], 'K': ['AAA', 'AAG'], 'D': ['GAT', 'GAC'],
  'E': ['GAA', 'GAG'], 'C': ['TGT', 'TGC'], 'W': ['TGG'],
  'R': ['CGT', 'CGC', 'CGA', 'CGG', 'AGA', 'AGG'], 'G': ['GGT', 'GGC', 'GGA', 'GGG'],
  '*': ['TAA', 'TAG', 'TGA'],
};

// Invert the map for codon -> AA lookup
export const AA_LOOKUP: { [codon: string]: string } = {};
Object.entries(CODON_TABLE).forEach(([aa, codons]) => {
  codons.forEach(codon => {
    AA_LOOKUP[codon] = aa;
  });
});

export function getMutationIndex(codingExons: CodingExon[], aaPosition: number): number {
    const targetBaseIndex = (aaPosition - 1) * 3;
    
    for (const exon of codingExons) {
        const exonLen = exon.end - exon.start;
        // Check if the target start base falls within this exon's contribution
        if (targetBaseIndex >= exon.cumLengthBefore && targetBaseIndex < exon.cumLengthBefore + exonLen) {
            const offset = targetBaseIndex - exon.cumLengthBefore;
            return exon.start + offset;
        }
    }
    throw new Error(`Amino Acid position ${aaPosition} is out of bounds for the identified coding sequence.`);
}

// --- Scoring Logic (Doench 2014 Rule Set 1 Simplified) ---
function calculateScore(context30: string): number {
  if (!context30 || context30.length !== 30) return 0;
  
  const seq = context30.toUpperCase();
  let score = 0.5976;
  const gcCount = (seq.slice(4, 24).match(/[GC]/g) || []).length;
  const gcHigh = gcCount > 10 ? -0.1664 : 0; // High GC penalty
  const gcLow = gcCount < 10 ? -0.2026 : 0;  // Low GC penalty
  score += gcHigh + gcLow;

  const weights: Record<string, number> = {
    'G2': -0.2753, 'A3': -0.3238, 'C3': 0.1721, 'C6': -0.1006, 'C15': -0.2017,
    'C16': -0.0954, 'C18': -0.1852, 'G20': -0.1045, 'G21': -0.1604, 'A21': 0.0841,
    'G23': 0.1324, 'C24': 0.0894, // PAM proximal
    'A24': 0.0766, 'T28': 0.0396, 'C28': 0.1298
  };

  const check = (nuc: string, pos: number, weight: number) => {
      if (seq[pos] === nuc) score += weight;
  };
  
  check('G', 4+1, -0.27);
  check('T', 29, -0.10);
  check('C', 20, 0.10);
  check('G', 23, -0.15);

  const probability = 1 / (1 + Math.exp(-score * 4));
  return Math.round(probability * 100);
}

// --- Utils ---

export function reverseComplement(seq: string): string {
  const complement: { [key: string]: string } = {
    'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C',
    'a': 't', 't': 'a', 'c': 'g', 'g': 'c',
    'N': 'N', 'n': 'n', '-': '-'
  };
  return seq.split('').reverse().map(base => complement[base] || base).join('');
}

export function translate(seq: string): string {
  let protein = "";
  const cleanSeq = seq.toUpperCase();
  for (let i = 0; i < cleanSeq.length; i += 3) {
    if (i + 3 > cleanSeq.length) break;
    const codon = cleanSeq.substring(i, i + 3);
    protein += AA_LOOKUP[codon] || "X";
  }
  return protein;
}

export function codonToAA(codon: string): string | null {
  return AA_LOOKUP[codon.toUpperCase()] || null;
}

export function generateSimpleAlignment(seq1: string, seq2: string): string {
  let match = "";
  const len = Math.max(seq1.length, seq2.length);
  for (let i = 0; i < len; i++) {
    const c1 = seq1[i] || '-';
    const c2 = seq2[i] || '-';
    if (c1 === c2 && c1 !== '-' && c2 !== '-') {
      match += "|";
    } else {
      match += " ";
    }
  }
  return match;
}

// --- Primer Design Utils ---

function calculateTmSimple(seq: string): number {
  // Formula: 2*(A+T) + 4*(G+C)
  const matchesA = seq.match(/[A]/gi);
  const matchesT = seq.match(/[T]/gi);
  const matchesG = seq.match(/[G]/gi);
  const matchesC = seq.match(/[C]/gi);
  
  const A = matchesA ? matchesA.length : 0;
  const T = matchesT ? matchesT.length : 0;
  const G = matchesG ? matchesG.length : 0;
  const C = matchesC ? matchesC.length : 0;

  return 2 * (A + T) + 4 * (G + C);
}

function hasGcClamp(seq: string): boolean {
    if (!seq) return false;
    const last = seq[seq.length - 1].toUpperCase();
    return last === 'G' || last === 'C';
}

function hasHomopolymerRun(seq: string): boolean {
    // True if 5 or more of the same nucleotide in a row
    return /([acgtACGT])\1{4,}/.test(seq);
}

function hasHairpin(seq: string): boolean {
    // Check for self-complementarity (simple approach: look for 4+ base reverse complement within the primer)
    // with at least a 3 base loop
    for (let i = 0; i <= seq.length - 4; i++) {
        const kmer = seq.substr(i, 4);
        const revComp = reverseComplement(kmer);
        // Look for revComp later in the sequence, allowing for at least a 3bp loop
        if (seq.indexOf(revComp, i + 4 + 3) !== -1) {
            return true;
        }
    }
    return false;
}

function hasDimer(seq1: string, seq2: string): boolean {
    // Check for significant complementarity between two primers (e.g., 5+ base pairs)
    // Especially important at the 3' end, but we'll do a general 5bp check
    for (let i = 0; i <= seq1.length - 5; i++) {
        const kmer = seq1.substr(i, 5);
        const revComp = reverseComplement(kmer);
        if (seq2.indexOf(revComp) !== -1) {
            return true;
        }
    }
    return false;
}

function designVerificationPrimers(
    geneSequence: string, 
    mutationIndex: number,
    settings?: AdvancedSettings['crispr']
): VerificationPrimers | undefined {
    
    // Default or Advanced Settings
    const targetSize = settings?.targetPrimerProdSize ?? 500;
    const MIN_AMP = Math.max(100, targetSize - 200);
    const MAX_AMP = targetSize + 250;
    const MIN_TM = settings?.primerTmMin ?? 53;
    const MAX_TM = settings?.primerTmMax ?? 62;
    const FORCE_GC = settings?.forceGcClamp ?? false;
    
    // Auto-adjust flanking regions based on chosen size
    const FLANK_MIN = Math.max(40, MIN_AMP / 2 - 50); 
    const FLANK_MAX = MAX_AMP / 2 + 100; 
    const MIN_GC = 0.35;
    const MAX_GC = 0.65;
    const LENGTHS = [19, 20, 21, 22, 23, 24, 25];

    // Search Windows
    const fwdSearchStart = Math.max(0, mutationIndex - FLANK_MAX);
    const fwdSearchEnd = Math.max(0, mutationIndex - FLANK_MIN);
    const revSearchStart = Math.min(geneSequence.length, mutationIndex + FLANK_MIN);
    const revSearchEnd = Math.min(geneSequence.length, mutationIndex + FLANK_MAX);
    
    if (fwdSearchEnd <= fwdSearchStart || revSearchEnd <= revSearchStart) {
        return undefined;
    }

    interface PrimerCand {
        seq: string;
        tm: number;
        start: number;
        end: number;
        len: number;
        clamp: boolean;
        gc: number;
    }

    const fwdCandidates: PrimerCand[] = [];
    const revCandidates: PrimerCand[] = [];

    // Find Forward Candidates
    for (let i = fwdSearchStart; i < fwdSearchEnd; i++) {
        for (const len of LENGTHS) {
            if (i + len > geneSequence.length) continue;
            const seq = geneSequence.substring(i, i + len);
            const tm = calculateTmSimple(seq);
            const gc = (seq.match(/[GC]/gi) || []).length / len;
            const clamp = hasGcClamp(seq);
            
            if (FORCE_GC && !clamp) continue;
            
            // Check for homopolymers and hairpins
            if (hasHomopolymerRun(seq)) continue;
            if (hasHairpin(seq)) continue;

            if (tm >= MIN_TM && tm <= MAX_TM && gc >= MIN_GC && gc <= MAX_GC) {
                fwdCandidates.push({ seq, tm, start: i, end: i + len, len, clamp, gc });
            }
        }
    }

    // Find Reverse Candidates (Reverse Complement of sequence at + strand)
    for (let i = revSearchStart; i < revSearchEnd; i++) {
        for (const len of LENGTHS) {
            if (i + len > geneSequence.length) continue;
            const rawSeq = geneSequence.substring(i, i + len);
            const seq = reverseComplement(rawSeq);
            const tm = calculateTmSimple(seq);
            const gc = (seq.match(/[GC]/gi) || []).length / len;
            const clamp = hasGcClamp(seq);

            if (FORCE_GC && !clamp) continue;
            
            // Check for homopolymers and hairpins
            if (hasHomopolymerRun(seq)) continue;
            if (hasHairpin(seq)) continue;
            
            if (tm >= MIN_TM && tm <= MAX_TM && gc >= MIN_GC && gc <= MAX_GC) {
                revCandidates.push({ seq, tm, start: i, end: i + len, len, clamp, gc });
            }
        }
    }

    // Ranking Logic
    const idealTm = (MIN_TM + MAX_TM) / 2;
    const scorePrimer = (p: PrimerCand) => {
        let score = 100;
        if (p.clamp) score += 20; // Bonus
        score -= Math.abs(p.tm - idealTm) * 3; 
        score -= Math.abs(p.gc - 0.5) * 50; 
        return score;
    };

    fwdCandidates.sort((a,b) => scorePrimer(b) - scorePrimer(a));
    revCandidates.sort((a,b) => scorePrimer(b) - scorePrimer(a));

    const topFwd = fwdCandidates.slice(0, 100); 
    const topRev = revCandidates.slice(0, 100);

    let bestPair: VerificationPrimers | undefined;
    let bestScore = -Infinity;

    for (const f of topFwd) {
        for (const r of topRev) {
            const productSize = r.end - f.start;

            if (productSize >= MIN_AMP && productSize <= MAX_AMP) {
                 const tmDiff = Math.abs(f.tm - r.tm);
                 const optimalSize = targetSize;
                 const sizeDiff = Math.abs(productSize - optimalSize);
                 
                 let pairScore = scorePrimer(f) + scorePrimer(r) - (tmDiff * 5) - (sizeDiff * 0.2);
                 
                 // Check for heterodimers and deeply penalize if found
                 if (hasDimer(f.seq, r.seq)) {
                     pairScore -= 200; // Big penalty for primer dimers
                 }
                 
                 if (pairScore > bestScore) {
                     bestScore = pairScore;
                     bestPair = {
                         forward: f.seq,
                         reverse: r.seq,
                         productSize,
                         forwardTm: parseFloat(f.tm.toFixed(1)),
                         reverseTm: parseFloat(r.tm.toFixed(1)),
                         forwardStart: f.start,
                         reverseStart: r.start
                     };
                 }
            }
        }
    }

    return bestPair;
}

// --- Cas9 Logic ---

const WINDOW = 120; // Slightly larger for flexible guides

export function findCas9Sites(
    geneSequence: string, 
    mutationIndex: number, 
    settings?: AdvancedSettings['crispr']
): Cas9Site[] {
  const guideLen = settings?.guideLength || 20;
  const pamType = settings?.pamConstraint || 'NGG';
  
  const start = Math.max(0, mutationIndex - Math.floor(WINDOW / 2));
  const end = Math.min(geneSequence.length, mutationIndex + Math.floor(WINDOW / 2));
  const region = geneSequence.substring(start, end);

  const sites: Cas9Site[] = [];

  // Determine regex based on PAM settings
  // SpCas9 (NGG): N(20)NGG
  // SaCas9 (NNGRRT): N(21)NNGRRT
  let forwardRegex: RegExp;
  let reverseRegex: RegExp;
  let guideOffset = guideLen; // Length of spacer before PAM

  if (pamType === 'NGG') {
      // 5' - N(20) - NGG - 3'
      const pattern = `(?=([ACGT]{${guideLen}}[ACGT]GG))`;
      forwardRegex = new RegExp(pattern, 'gi');
      // Rev: 5' - CCN - N(20) - 3'
      const revPattern = `(?=(CC[ACGT][ACGT]{${guideLen}}))`;
      reverseRegex = new RegExp(revPattern, 'gi');
  } else if (pamType === 'NNGRRT') {
      // SaCas9 often 21nt. Assume N(guideLen)NNGRRT. 
      // R = A or G.
      const pattern = `(?=([ACGT]{${guideLen}}[ACGT]{2}G[AG]G[ACGT]))`;
      forwardRegex = new RegExp(pattern, 'gi');
      const revPattern = `(?=([ACGT]C[CT]C[ACGT]{2}[ACGT]{${guideLen}}))`;
      reverseRegex = new RegExp(revPattern, 'gi');
  } else if (pamType === 'TTTV') {
      // Cpf1/Cas12a is T-rich PAM at 5' end. 5' - TTTV - N(23) - 3'.
      // V = A, C, or G (not T).
      const pattern = `(?=(TTT[ACG][ACGT]{${guideLen}}))`;
      forwardRegex = new RegExp(pattern, 'gi');
      // Rev: 5' - N(23) - BAAA - 3' (B is comp of V)
      const revPattern = `(?=([ACGT]{${guideLen}}[CGT]AAA))`;
      reverseRegex = new RegExp(revPattern, 'gi');
  } else {
      // Fallback NGG
      const pattern = `(?=([ACGT]{${guideLen}}[ACGT]GG))`;
      forwardRegex = new RegExp(pattern, 'gi');
      const revPattern = `(?=(CC[ACGT][ACGT]{${guideLen}}))`;
      reverseRegex = new RegExp(revPattern, 'gi');
  }

  // Forward Scan
  let match;
  while ((match = forwardRegex.exec(region)) !== null) {
    const siteStart = start + match.index;
    // Score context: -4 to +30 relative to start?
    // Note: Doench score expects 30bp context for 20bp+NGG.
    // We only calculate score for standard NGG 20bp currently.
    let context30 = "";
    if (guideLen === 20 && pamType === 'NGG') {
        const contextStart = match.index - 4;
        if (contextStart >= 0 && contextStart + 30 <= region.length) {
            context30 = region.substring(contextStart, contextStart + 30);
        }
    }

    sites.push({
      position: siteStart,
      sequence: match[1],
      strand: 'forward',
      context30
    });
    forwardRegex.lastIndex = match.index + 1;
  }

  // Reverse Scan
  while ((match = reverseRegex.exec(region)) !== null) {
    const siteStart = start + match.index;
    sites.push({
      position: siteStart,
      sequence: match[1],
      strand: 'reverse'
    });
    reverseRegex.lastIndex = match.index + 1;
  }

  return sites.sort((a, b) => {
    return Math.abs(a.position - mutationIndex) - Math.abs(b.position - mutationIndex);
  });
}

interface MutationAttempt {
    sequence: string[];
    mutated: boolean;
    strategy: 'PAM_SILENT' | 'SEED_SILENT' | null;
    mutationCount: number;
}

function mutatePam(
  homologyList: string[],
  strand: 'forward' | 'reverse',
  pamStart: number,
  homologyStart: number,
  pamType: string
): MutationAttempt {
  const pamPosInHomology = pamStart - homologyStart;
  const listCopy = [...homologyList];

  // Identify PAM critical indices based on type
  let criticalIndices: number[] = [];
  
  if (pamType === 'NGG') {
      // NGG is at end. Indices 21, 22 relative to guide start (if 20bp).
      // Assuming passed pamStart is START of the Match (N20NGG)
      // N(0-19) N(20) G(21) G(22)
      criticalIndices = strand === 'forward' 
        ? [pamPosInHomology + 21, pamPosInHomology + 22]
        : [pamPosInHomology, pamPosInHomology + 1]; // CC(0,1) N(2)...
  } else {
      // For beta, simplifying non-NGG to just "try to mutate last 3 bases" or similar
      // SaCas9 NNGRRT: mutate the Gs
      // Cas12a TTTV: mutate Ts
      // Implementing full logic for all variants is complex; focusing on NGG default logic mostly
      // or simplistic assumption that changing the 'P' part of PAM works.
      return { sequence: [], mutated: false, strategy: null, mutationCount: 0 };
  }

  const codonStarts = new Set<number>();
  criticalIndices.forEach(idx => {
    if (idx >= 0 && idx < listCopy.length) {
      codonStarts.add(Math.floor(idx / 3) * 3);
    }
  });

  const sortedCodonStarts = Array.from(codonStarts).sort((a, b) => a - b);

  let bestResult: MutationAttempt = { sequence: [], mutated: false, strategy: null, mutationCount: 0 };
  let minChanges = Infinity;

  for (const codonStart of sortedCodonStarts) {
    if (codonStart + 3 > listCopy.length) continue;

    const currentCodon = listCopy.slice(codonStart, codonStart + 3).join('').toUpperCase();
    const currentAA = codonToAA(currentCodon);
    if (!currentAA || currentAA === '*') continue;

    const synonymousCodons = CODON_TABLE[currentAA] || [];

    for (const synonym of synonymousCodons) {
      if (synonym === currentCodon) continue;
      if (codonToAA(synonym) !== currentAA) continue;

      let disrupts = false;
      let tempChanges = 0;

      for (let i = 0; i < 3; i++) {
        const pos = codonStart + i;
        if (criticalIndices.includes(pos)) {
            if (synonym[i] !== currentCodon[i]) {
                disrupts = true;
            }
        }
        if (synonym[i] !== currentCodon[i]) tempChanges++;
      }

      if (disrupts) {
        if (tempChanges < minChanges) {
             minChanges = tempChanges;
             const newList = [...homologyList];
             for (let i = 0; i < 3; i++) newList[codonStart + i] = synonym[i];
             bestResult = { sequence: newList, mutated: true, strategy: 'PAM_SILENT', mutationCount: tempChanges };
        }
      }
    }
  }

  return bestResult;
}

function mutateSeed(
  homologyList: string[],
  strand: 'forward' | 'reverse',
  pamStart: number,
  homologyStart: number,
  settings?: AdvancedSettings['crispr']
): MutationAttempt {
    const pamPosInHomology = pamStart - homologyStart;
    const listCopy = [...homologyList];
    
    // Defaults
    const seedLen = settings?.seedLength || 10;
    const minMuts = settings?.minSeedMutations || 2;
    const guideLen = settings?.guideLength || 20;
    
    const seedIndices = new Set<number>();
    
    // Seed is proximal to PAM.
    // NGG Forward: 5' N...N(Seed) PAM 3'.
    // Indices 0..19. Seed is e.g. 10-19.
    if (strand === 'forward') {
        const guideEnd = guideLen - 1; // 19
        const seedStart = guideEnd - seedLen + 1; // 19 - 10 + 1 = 10
        for(let i = seedStart; i <= guideEnd; i++) seedIndices.add(pamPosInHomology + i);
    } else {
        // Reverse NGG: 5' PAM (Seed)N...N 3'
        // CCN... Match indices 0..22.
        // PAM is 0,1,2. Spacer is 3..22.
        // Seed is proximal to PAM -> 3..(3+seedLen-1)
        const spacerStart = 3;
        const seedEnd = spacerStart + seedLen - 1;
        for(let i = spacerStart; i <= seedEnd; i++) seedIndices.add(pamPosInHomology + i);
    }

    const codonStarts = new Set<number>();
    seedIndices.forEach(idx => {
         if(idx >= 0 && idx < listCopy.length) {
            codonStarts.add(Math.floor(idx/3)*3);
        }
    });

    const sortedCodonStarts = Array.from(codonStarts).sort((a,b)=>a-b);
    let totalMutations = 0;

    for (const codonStart of sortedCodonStarts) {
         if (codonStart + 3 > listCopy.length) continue;
         
         const currentCodon = listCopy.slice(codonStart, codonStart+3).join('').toUpperCase();
         const currentAA = codonToAA(currentCodon);
         if (!currentAA || currentAA === '*') continue;
         
         const synonyms = CODON_TABLE[currentAA] || [];
         
         let bestSynonym = null;
         let maxNewSeedChanges = 0;
         let bestTotalChanges = 0;

         for (const synonym of synonyms) {
             if (synonym === currentCodon) continue;
             if (codonToAA(synonym) !== currentAA) continue;

             let seedChanges = 0;
             let totalChanges = 0;
             for(let i=0; i<3; i++) {
                 if (synonym[i] !== currentCodon[i]) {
                     totalChanges++;
                     if (seedIndices.has(codonStart + i)) {
                         seedChanges++;
                     }
                 }
             }
             
             if (seedChanges > maxNewSeedChanges) {
                 maxNewSeedChanges = seedChanges;
                 bestTotalChanges = totalChanges;
                 bestSynonym = synonym;
             }
         }
         
         if (bestSynonym && maxNewSeedChanges > 0) {
             for(let i=0; i<3; i++) listCopy[codonStart+i] = bestSynonym[i];
             totalMutations += bestTotalChanges; 
         }
         
         if (totalMutations >= minMuts) break;
    }

    if (totalMutations >= minMuts) {
        return { sequence: listCopy, mutated: true, strategy: 'SEED_SILENT', mutationCount: totalMutations };
    }

    return { sequence: [], mutated: false, strategy: null, mutationCount: 0 };
}

export function generateRepairTemplates(
  geneSequence: string,
  cas9Sites: Cas9Site[],
  mutationPosition: number, // The explicit DNA index for the start of the target codon
  newAminoAcid: string,
  templateSize: number = 75,
  settings?: AdvancedSettings['crispr']
): RepairResult[] {
  const results: RepairResult[] = [];
  
  const verifPrimers = designVerificationPrimers(geneSequence, mutationPosition, settings);
  const disruptionStrategy = settings?.disruptionPriority || 'PAM'; // 'PAM', 'SEED', 'BOTH'
  const pamType = settings?.pamConstraint || 'NGG';
  
  // Asymmetry settings
  // If NoClo with integrated repair template is enabled, template size defaults to 100nt
  const effectiveTemplateSize = (settings?.nocloIntegratedRepair && settings?.cloningType === 'NoClo') ? 100 : templateSize;
  let upstreamLen = Math.floor(effectiveTemplateSize / 2);
  let downstreamLen = Math.floor(effectiveTemplateSize / 2) + (effectiveTemplateSize % 2);
  
  if (settings?.repairAsymmetry === 'UPSTREAM_SKEW') {
      upstreamLen = Math.floor(effectiveTemplateSize * 0.7);
      downstreamLen = effectiveTemplateSize - upstreamLen;
  } else if (settings?.repairAsymmetry === 'DOWNSTREAM_SKEW') {
      downstreamLen = Math.floor(effectiveTemplateSize * 0.7);
      upstreamLen = effectiveTemplateSize - downstreamLen;
  }

  for (const site of cas9Sites) {
    const cas9CutPosition = site.position + (settings?.guideLength || 20) - 3; // Approx cut 3bp from PAM
    const pamStart = site.position;

    const center = Math.floor((cas9CutPosition + mutationPosition) / 2);
    
    // Apply Asymmetry relative to the CENTER of the design
    const homologyStart = Math.max(0, center - upstreamLen);
    const homologyEnd = Math.min(geneSequence.length, center + downstreamLen);

    const originalHomologyRegion = geneSequence.substring(homologyStart, homologyEnd);
    const homologyList = originalHomologyRegion.split('');

    // --- Deletion Control ---
    const pamPosInHomology = pamStart - homologyStart;
    const deletionIndices = site.strand === 'forward'
        ? [pamPosInHomology + 21, pamPosInHomology + 22] // NGG indices
        : [pamPosInHomology, pamPosInHomology + 1];
    
    const deletionList = homologyList.filter((_, idx) => !deletionIndices.includes(idx));
    const deletionRepairTemplate = deletionList.join('');
    const deletionDnaDisplay = homologyList.map((char, idx) => deletionIndices.includes(idx) ? '-' : char).join('');

    // --- Deletion Protein ---
    const contextFlank = 150;
    const alignStart = Math.max(0, mutationPosition - contextFlank);
    const alignEnd = Math.min(geneSequence.length, mutationPosition + 3 + contextFlank);
    const originalLargeDna = geneSequence.substring(alignStart, alignEnd);
    const deletionLargeList = originalLargeDna.split('');
    const pamStartInLarge = pamStart - alignStart;
    
    const delIndicesLarge = site.strand === 'forward'
        ? [pamStartInLarge + 21, pamStartInLarge + 22]
        : [pamStartInLarge, pamStartInLarge + 1];

    const mutatedLargeList = deletionLargeList.filter((_, idx) => !delIndicesLarge.includes(idx));
    const deletionLargeDna = mutatedLargeList.join('');
    const frame = (mutationPosition - alignStart) % 3;
    const deletionProtein = translate(deletionLargeDna.substring(frame));

    // --- Desired Mutation Logic ---
    const codonStartInHomology = mutationPosition - homologyStart;
    if (codonStartInHomology >= 0 && codonStartInHomology < homologyList.length) {
      const originalCodon = homologyList.slice(codonStartInHomology, codonStartInHomology + 3).join('').toUpperCase();
      const newCodonOptions = CODON_TABLE[newAminoAcid.toUpperCase()];

      if (!newCodonOptions || newCodonOptions.length === 0) continue; 

      let newCodon = newCodonOptions[0];
      for (const opt of newCodonOptions) {
        if (opt !== originalCodon) {
          newCodon = opt;
          break;
        }
      }

      for (let i = 0; i < 3; i++) {
        homologyList[codonStartInHomology + i] = newCodon[i];
      }
    }

    let finalHomologyList = [...homologyList];
    let strategy: RepairResult['strategy'] | null = null;
    let silentMutationCount = 0;

    // Check if mutation naturally disrupts PAM
    const criticalIndices = site.strand === 'forward'
        ? [pamPosInHomology + 21, pamPosInHomology + 22]
        : [pamPosInHomology, pamPosInHomology + 1];
    
    let pamAlreadyDisrupted = false;
    for(const idx of criticalIndices) {
        if (idx >= 0 && idx < homologyList.length) {
            if (homologyList[idx].toUpperCase() !== originalHomologyRegion[idx].toUpperCase()) {
                pamAlreadyDisrupted = true;
                break;
            }
        }
    }

    if (pamAlreadyDisrupted) {
        strategy = 'PAM_DISRUPTED_BY_TARGET';
        silentMutationCount = 0;
    } else {
        // Strategy Selection
        let tryPam = disruptionStrategy === 'PAM' || disruptionStrategy === 'BOTH';
        let trySeed = disruptionStrategy === 'SEED' || disruptionStrategy === 'BOTH';
        
        let pamAttempt = { mutated: false, strategy: null, mutationCount: 0, sequence: [] as string[] };
        let seedAttempt = { mutated: false, strategy: null, mutationCount: 0, sequence: [] as string[] };

        if (tryPam) {
            pamAttempt = mutatePam(homologyList, site.strand, pamStart, homologyStart, pamType);
        }
        
        // Use PAM if successful
        if (pamAttempt.mutated && pamAttempt.strategy) {
            finalHomologyList = pamAttempt.sequence;
            strategy = pamAttempt.strategy;
            silentMutationCount = pamAttempt.mutationCount;
        } else if (trySeed) {
            // Fallback to Seed
            seedAttempt = mutateSeed(homologyList, site.strand, pamStart, homologyStart, settings);
            if (seedAttempt.mutated && seedAttempt.strategy) {
                finalHomologyList = seedAttempt.sequence;
                strategy = seedAttempt.strategy;
                silentMutationCount = seedAttempt.mutationCount;
            }
        }
    }

    if (!strategy) continue;

    const finalCasedList: string[] = [];
    for (let i = 0; i < finalHomologyList.length; i++) {
      const finalChar = finalHomologyList[i];
      const originalChar = originalHomologyRegion[i];
      if (finalChar.toUpperCase() !== originalChar.toUpperCase()) {
        finalCasedList.push(finalChar.toLowerCase());
      } else {
        finalCasedList.push(finalChar.toUpperCase());
      }
    }
    const mutatedHomology = finalCasedList.join('');

    const sgRNASeqWithPam = site.strand === 'reverse'
      ? reverseComplement(site.sequence)
      : site.sequence;
    const guideSeq = sgRNASeqWithPam.substring(0, settings?.guideLength || 20).toUpperCase(); 
    
    // Cloning Oligos
    let cloningOligoA = '';
    let cloningOligoB = '';
    const cloningType = settings?.cloningType || 'pML104';
    const isIntegratedNoClo = Boolean(cloningType === 'NoClo' && settings?.nocloIntegratedRepair);
    let integratedDeletionOligoA: string | undefined = undefined;
    let integratedDeletionOligoB: string | undefined = undefined;
    
    if (cloningType === 'NoClo') {
      if (isIntegratedNoClo) {
        // NoClo with Integrated Repair Template (All-in-One single sequence):
        // 5' -> 3':
        // 1. 5' Upstream Homology (100bp):
        //    "tgcctgtatatatatatacatgagaagaacggcatagtgcgtgtttatgcttaaatgcgtatatgtgttatgtagtatactctttcttcaacaattaaat"
        // 2. 100nt Repair Template (mutatedHomology)
        // 3. tRNA-Ribozyme Processing Linker (155bp):
        //    "ACTCTCGGTAGCCAAGTTGGTTTAAGGCGCAAGACTGTAATTTATCACTACGAAATCTTGAGATCGGGCGTTCGACTCGCCCCCGGGAGAgatggccggcatggtcccagcctcctcgctggcgccggctgggcaacaccttcgggtggcgaatg"
        // 4. sgRNA Target (20bp guideSeq)
        // 5. 3' sgRNA Scaffold & Terminator (100bp):
        //    "gttttagagctagaaatagcaagttaaaataaggctagtccgttatcaacttgaaaaagtggcaccgagtcggtgctttttttattttttgtcactattg"
        const nocloUpstream5 = "tgcctgtatatatatatacatgagaagaacggcatagtgcgtgtttatgcttaaatgcgtatatgtgttatgtagtatactctttcttcaacaattaaat";
        const nocloLinker = "ACTCTCGGTAGCCAAGTTGGTTTAAGGCGCAAGACTGTAATTTATCACTACGAAATCTTGAGATCGGGCGTTCGACTCGCCCCCGGGAGAgatggccggcatggtcccagcctcctcgctggcgccggctgggcaacaccttcgggtggcgaatg";
        const noclo3 = "gttttagagctagaaatagcaagttaaaataaggctagtccgttatcaacttgaaaaagtggcaccgagtcggtgctttttttattttttgtcactattg";

        cloningOligoA = `${nocloUpstream5}${mutatedHomology}${nocloLinker}${guideSeq.toUpperCase()}${noclo3}`;
        cloningOligoB = reverseComplement(cloningOligoA);

        integratedDeletionOligoA = `${nocloUpstream5}${deletionRepairTemplate}${nocloLinker}${guideSeq.toUpperCase()}${noclo3}`;
        integratedDeletionOligoB = reverseComplement(integratedDeletionOligoA);
      } else {
        // Standard NoClo homologous flanking sequences (100bp 5' and 100bp 3')
        const noclo5 = "tcttgagatcgggcgttcgactcgcccccgggagagatggccggcatggtcccagcctcctcgctggcgccggctgggcaacaccttcgggtggcgaatg";
        const noclo3 = "gttttagagctagaaatagcaagttaaaataaggctagtccgttatcaacttgaaaaagtggcaccgagtcggtgctttttttattttttgtcactattg";
        const targetLen = settings?.nocloHomologyLength ?? 100;
        
        const p5 = noclo5.substring(Math.max(0, noclo5.length - targetLen));
        const p3 = noclo3.substring(0, targetLen);
        
        cloningOligoA = `${p5}${guideSeq.toUpperCase()}${p3}`;
        cloningOligoB = reverseComplement(cloningOligoA);
      }
    } else {
      // Assuming pML104 structure (Standard)
      cloningOligoA = `gatc${guideSeq}gttttagagctag`;
      cloningOligoB = `ctagctctaaaac${reverseComplement(guideSeq).toUpperCase()}`;
    }

    // Verification
    const repairedLargeList = originalLargeDna.split('');
    const tempStartInLarge = homologyStart - alignStart;

    for (let i = 0; i < mutatedHomology.length; i++) {
        if (tempStartInLarge + i >= 0 && tempStartInLarge + i < repairedLargeList.length) {
            repairedLargeList[tempStartInLarge + i] = mutatedHomology[i];
        }
    }
    const repairedLargeDna = repairedLargeList.join('');
    const originalLargeAA = translate(originalLargeDna.substring(frame));
    const repairedLargeAA = translate(repairedLargeDna.substring(frame));

    let aaDiffCount = 0;
    const len = Math.min(originalLargeAA.length, repairedLargeAA.length);
    for(let k=0; k<len; k++) {
        if (originalLargeAA[k] !== repairedLargeAA[k]) aaDiffCount++;
    }

    if (aaDiffCount !== 1) continue;

    const score = site.context30 ? calculateScore(site.context30) : undefined;
    
    // Filter by Doench Score if set
    if (settings?.minDoenchScore && score !== undefined && score < settings.minDoenchScore) {
        continue;
    }

    results.push({
      site,
      cloningOligoA,
      cloningOligoB,
      repairTemplate: mutatedHomology,
      guideSeqWithPam: sgRNASeqWithPam,
      score,
      
      deletionRepairTemplate,
      deletionDnaDisplay,
      deletionProtein,

      originalRegion: originalHomologyRegion,
      homologyStart,
      mutationPosition,
      aaChangeStatus: 'success',
      aaChangesCount: aaDiffCount,
      dnaAlignment: {
          original: originalHomologyRegion.toUpperCase(),
          modified: mutatedHomology.toUpperCase(),
          matchString: generateSimpleAlignment(originalHomologyRegion.toUpperCase(), mutatedHomology.toUpperCase())
      },
      aaAlignment: {
          original: originalLargeAA,
          modified: repairedLargeAA,
          matchString: generateSimpleAlignment(originalLargeAA, repairedLargeAA)
      },
      strategy: strategy,
      silentMutationCount: silentMutationCount,
      verificationPrimers: verifPrimers, // Attach the designed primers
      isIntegratedNoClo,
      integratedOligoA: isIntegratedNoClo ? cloningOligoA : undefined,
      integratedOligoB: isIntegratedNoClo ? cloningOligoB : undefined,
      integratedDeletionOligoA,
      integratedDeletionOligoB
    });
  }

  // --- Sorting Logic Update ---
  results.sort((a, b) => {
    const guideLen = settings?.guideLength || 20;
    
    // Calculate cut position (3bp from PAM end of guide)
    const cutPosA = a.site.position + guideLen - 3;
    const cutPosB = b.site.position + guideLen - 3;
    
    // Calculate distance to mutation
    const distA = Math.abs(cutPosA - a.mutationPosition);
    const distB = Math.abs(cutPosB - b.mutationPosition);
    
    const isCloseA = distA < 15;
    const isCloseB = distB < 15;

    // Prioritize Close (<15)
    if (isCloseA && !isCloseB) return -1;
    if (!isCloseA && isCloseB) return 1;

    // If both are Close: Rank by Score Descending
    if (isCloseA && isCloseB) {
        if (a.score !== b.score && a.score !== undefined && b.score !== undefined) {
            return (b.score || 0) - (a.score || 0);
        }
        // Tie-break with distance
        return distA - distB;
    }

    // If both are Far: Rank by Distance Ascending (minimize distance)
    if (distA !== distB) {
        return distA - distB;
    }
    
    // Tie-break with Score
    return (b.score || 0) - (a.score || 0);
  });

  return results.slice(0, 5);
}
