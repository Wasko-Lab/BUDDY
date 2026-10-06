
import { AdvancedSettings } from '../types';

// Simple scoring matrix for proteins (BLOSUM62-ish simplified)
const AA_GROUPS = [
  new Set("VLIM"), new Set("FYW"), new Set("MILF"), new Set("MILV"), new Set("KRH"), new Set("DE"), 
  new Set("ST"), new Set("NQ"), new Set("HY"), new Set("NDEQ"), new Set("SGND"), new Set("STPA"), 
  new Set("STNK"), new Set("NEQK"), new Set("NHQK"), new Set("QHRK"), new Set("HFY"), new Set("FVLIM"), 
  new Set("CSA"), new Set("ATV"), new Set("SAG"), new Set("SNDEQK"), new Set("NDEQHK"), new Set("NEQHRK")
];

export const isSimilarAA = (aa1: string, aa2: string): boolean => {
  if (aa1 === aa2) return true;
  for (const group of AA_GROUPS) {
    if (group.has(aa1) && group.has(aa2)) return true;
  }
  return false;
};

// Simplified Alignment with Options
export const alignSequences = (
    seq1: string, 
    seq2: string, 
    settings?: AdvancedSettings['alignment']
): { aligned1: string, aligned2: string } => {
  const n = seq1.length;
  const m = seq2.length;
  
  // Defaults based on BLOSUM62 standard
  let MATCH = 5;
  let MISMATCH = -4;
  let GAP_OPEN = -10;
  let GAP_EXTEND = -1;
  let isLocal = false;

  if (settings) {
      GAP_OPEN = settings.gapOpen;
      GAP_EXTEND = settings.gapExtend;
      isLocal = settings.algorithm === 'LOCAL';
      
      // Adjust scoring based on Matrix choice (Simplified simulation)
      if (settings.matrix === 'BLOSUM45') {
          MATCH = 5;
          MISMATCH = -3; // More permissive
      } else if (settings.matrix === 'PAM250') {
          MATCH = 5;
          MISMATCH = -2; // Very permissive
      }
  }

  // Use a smaller max length to prevent browser freeze in this demo if seqs are massive
  if (n * m > 2500 * 2500) {
     console.warn("Sequences too long for client-side optimal alignment. Truncating for demo.");
  }

  // Score matrix
  const score = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  // Direction matrix: 1=diag, 2=up, 3=left
  const ptr = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  // Initialization
  if (!isLocal) {
      for (let i = 1; i <= n; i++) score[i][0] = GAP_OPEN + (i-1) * GAP_EXTEND;
      for (let j = 1; j <= m; j++) score[0][j] = GAP_OPEN + (j-1) * GAP_EXTEND;
  }

  let maxScore = -Infinity;
  let maxI = n;
  let maxJ = m;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const char1 = seq1[i - 1];
      const char2 = seq2[j - 1];
      
      // Calculate substitution score
      let similarityScore = MISMATCH;
      if (char1 === char2) similarityScore = MATCH;
      else if (isSimilarAA(char1, char2)) similarityScore = Math.max(MISMATCH + 2, 1); // Bonus for similarity

      const matchSub = score[i - 1][j - 1] + similarityScore;
      
      // Gap calculation (simplified affine)
      const gapUp = score[i - 1][j] + GAP_EXTEND; 
      const gapLeft = score[i][j - 1] + GAP_EXTEND;

      let cellScore = Math.max(matchSub, gapUp, gapLeft);
      
      if (isLocal) {
          cellScore = Math.max(0, cellScore);
      }

      score[i][j] = cellScore;

      if (cellScore === matchSub) ptr[i][j] = 1;
      else if (cellScore === gapUp) ptr[i][j] = 2;
      else ptr[i][j] = 3; // Left

      if (isLocal && cellScore > maxScore) {
          maxScore = cellScore;
          maxI = i;
          maxJ = j;
      }
    }
  }

  // Traceback
  let align1 = "";
  let align2 = "";
  let i = isLocal ? maxI : n;
  let j = isLocal ? maxJ : m;

  while ((isLocal ? (score[i][j] > 0) : (i > 0 || j > 0))) {
    if (i > 0 && j > 0 && ptr[i][j] === 1) {
      align1 = seq1[i - 1] + align1;
      align2 = seq2[j - 1] + align2;
      i--; j--;
    } else if (i > 0 && (j === 0 || ptr[i][j] === 2)) {
      align1 = seq1[i - 1] + align1;
      align2 = "-" + align2;
      i--;
    } else {
      align1 = "-" + align1;
      align2 = seq2[j - 1] + align2;
      j--;
    }
  }

  return { aligned1: align1, aligned2: align2 };
};

export const calculateLocalHomology = (
  seq1: string,
  seq2: string,
  index: number,
  windowRadius: number = 6
): number => {
  let matches = 0;
  let total = 0;
  
  const start = Math.max(0, index - windowRadius);
  const end = Math.min(seq1.length, index + windowRadius + 1);

  for (let i = start; i < end; i++) {
      const c1 = seq1[i];
      const c2 = seq2[i];
      
      // We consider the column valid if at least one sequence has a residue (usually standard pairwise alignment doesn't align gap to gap)
      if (c1 !== '-' || c2 !== '-') {
          total++;
          if (c1 !== '-' && c2 !== '-') {
              if (c1 === c2 || isSimilarAA(c1, c2)) {
                  matches++;
              }
          }
      }
  }
  
  return total === 0 ? 0 : Math.round((matches / total) * 100);
}

export const AA_MAP: Record<string, string> = {
  'Ala': 'A', 'Arg': 'R', 'Asn': 'N', 'Asp': 'D', 'Cys': 'C',
  'Gln': 'Q', 'Glu': 'E', 'Gly': 'G', 'His': 'H', 'Ile': 'I',
  'Leu': 'L', 'Lys': 'K', 'Met': 'M', 'Phe': 'F', 'Pro': 'P',
  'Ser': 'S', 'Thr': 'T', 'Trp': 'W', 'Tyr': 'Y', 'Val': 'V',
  'Ter': '*'
};

export const ONE_TO_THREE_AA: Record<string, string> = {
  'A': 'Ala', 'R': 'Arg', 'N': 'Asn', 'D': 'Asp', 'C': 'Cys',
  'Q': 'Gln', 'E': 'Glu', 'G': 'Gly', 'H': 'His', 'I': 'Ile',
  'L': 'Leu', 'K': 'Lys', 'M': 'Met', 'F': 'Phe', 'P': 'Pro',
  'S': 'Ser', 'T': 'Thr', 'W': 'Trp', 'Y': 'Tyr', 'V': 'Val',
  '*': 'Ter'
};

export interface ParsedProteinChange {
  ref: string; // 1-letter code, e.g. 'A'
  res: number; // 1-based position, e.g. 141
  target: string; // 1-letter code, e.g. 'T'
  clean3: string; // 3-letter standard, e.g. 'Ala141Thr'
}

export const parseProteinChange = (pChange: string): ParsedProteinChange | null => {
  if (!pChange || typeof pChange !== 'string') return null;
  const str = pChange.trim();

  // Format 1: 3-letter AA, e.g. p.Arg114Gln, Arg114Gln, NP_00123.1:p.Arg114Gln, (p.Arg114Gln)
  const match3 = str.match(/(?:^|[^a-zA-Z])p?\.?([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})(?:[^a-zA-Z]|$)/);
  if (match3) {
    const ref3 = match3[1];
    const res = parseInt(match3[2], 10);
    const tgt3 = match3[3];
    const ref = AA_MAP[ref3] || '?';
    const target = AA_MAP[tgt3] || '?';
    if (!isNaN(res) && res > 0) {
      return {
        ref,
        res,
        target,
        clean3: `${ref3}${res}${tgt3}`
      };
    }
  }

  // Format 2: 1-letter AA, e.g. p.R114Q, R114Q, p.A141T, NP_...:p.K715T
  const match1 = str.match(/(?:^|[^a-zA-Z])p?\.?([A-Z])(\d+)([A-Z])(?:[^a-zA-Z]|$)/);
  if (match1 && match1[1] !== match1[3]) {
    const ref = match1[1];
    const res = parseInt(match1[2], 10);
    const target = match1[3];
    const ref3 = ONE_TO_THREE_AA[ref] || ref;
    const tgt3 = ONE_TO_THREE_AA[target] || target;
    if (!isNaN(res) && res > 0) {
      return {
        ref,
        res,
        target,
        clean3: `${ref3}${res}${tgt3}`
      };
    }
  }

  return null;
};

export interface ResolvedClinVarProteinChange {
  raw: string; // Selected raw HGVS string, e.g. "NP_056281.1:p.Lys715Thr" or "NM_... (p.Ala136Thr)"
  cleanName: string; // e.g. "Ala136Thr"
  parsed: ParsedProteinChange;
  isSeqMatch: boolean; // Whether canonicalSeq[parsed.res - 1] === parsed.ref
  source: 'preferred_name' | 'clinvar_hgvs' | 'dbnsfp_hgvsp' | 'fallback';
}

/**
 * Robustly resolves a ClinVar hit to the transcript/isoform protein change
 * that accurately matches the canonical protein sequence (UniProt).
 * 
 * Prevents transcript-isoform residue offset bugs (e.g. where an alternative transcript
 * displays Ala171Thr, but canonical sequence has K at 171 and the actual mutation is Ala136Thr / Ala141Thr).
 */
export const resolveClinVarProteinChange = (
  hit: any,
  canonicalSeq?: string
): ResolvedClinVarProteinChange | null => {
  if (!hit) return null;
  const clinVarEntry = Array.isArray(hit.clinvar) ? hit.clinvar[0] : hit.clinvar;
  const rcvs = Array.isArray(clinVarEntry?.rcv) ? clinVarEntry.rcv : (clinVarEntry?.rcv ? [clinVarEntry.rcv] : []);

  const candidateMap = new Map<string, { raw: string; parsed: ParsedProteinChange; source: 'preferred_name' | 'clinvar_hgvs' | 'dbnsfp_hgvsp' }>();

  const addCandidate = (str: any, source: 'preferred_name' | 'clinvar_hgvs' | 'dbnsfp_hgvsp') => {
    if (!str || typeof str !== 'string') return;
    const trimmed = str.trim();
    if (!trimmed || trimmed === 'p.?' || candidateMap.has(trimmed)) return;
    const parsed = parseProteinChange(trimmed);
    if (!parsed) return;
    candidateMap.set(trimmed, { raw: trimmed, parsed, source });
  };

  // 1. RCV preferred_names (primary authoritative clinical transcript selected by ClinVar / MANE Select)
  for (const r of rcvs) {
    if (r?.preferred_name) {
      addCandidate(r.preferred_name, 'preferred_name');
      const m = String(r.preferred_name).match(/\((p\.[^\)]+)\)/);
      if (m) addCandidate(m[1], 'preferred_name');
    }
  }

  // 2. clinvar.hgvs.protein (all transcript-level RefSeq/Ensembl HGVS expressions)
  const clProt = clinVarEntry?.hgvs?.protein;
  const clProtList = (Array.isArray(clProt) ? clProt : [clProt]).filter(Boolean);
  for (const p of clProtList) {
    addCandidate(p, 'clinvar_hgvs');
  }

  // 3. dbnsfp.hgvsp (dbNSFP is computed directly against canonical UniProt sequences)
  const dbnsfpEntry = Array.isArray(hit.dbnsfp) ? hit.dbnsfp[0] : hit.dbnsfp;
  const dbProt = dbnsfpEntry?.hgvsp;
  const dbProtList = (Array.isArray(dbProt) ? dbProt : [dbProt]).filter(Boolean);
  for (const p of dbProtList) {
    addCandidate(p, 'dbnsfp_hgvsp');
  }

  const allCandidates = Array.from(candidateMap.values());
  if (allCandidates.length === 0) return null;

  // Evaluate each candidate against the canonical protein sequence
  const scored = allCandidates.map(c => {
    const isSeqMatch = !!(
      canonicalSeq &&
      c.parsed.res >= 1 &&
      c.parsed.res <= canonicalSeq.length &&
      canonicalSeq[c.parsed.res - 1] === c.parsed.ref
    );

    let score = 0;
    if (isSeqMatch) {
      // Prioritize candidates that match the displayed canonical protein sequence
      if (c.source === 'preferred_name') score = 1000;
      else if (c.source === 'clinvar_hgvs') score = 800;
      else if (c.source === 'dbnsfp_hgvsp') score = 600;
      else score = 500;
    } else {
      // Fallback ranking if no sequence match (e.g. sequence not provided or unique splice variant)
      if (c.source === 'preferred_name') score = 300;
      else if (c.source === 'clinvar_hgvs') score = 200;
      else if (c.source === 'dbnsfp_hgvsp') score = 100;
    }

    // Secondary heuristic: prefer 3-letter HGVS notation
    if (c.raw.includes('p.') && /[a-z]{2}/.test(c.raw)) score += 10;
    // Prefer RefSeq curated NP_ transcript if available in clinvar_hgvs
    if (c.raw.startsWith('NP_')) score += 5;

    return { ...c, isSeqMatch, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  return {
    raw: best.raw,
    cleanName: best.parsed.clean3,
    parsed: best.parsed,
    isSeqMatch: best.isSeqMatch,
    source: best.source
  };
};

