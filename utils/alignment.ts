
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

export const parseProteinChange = (pChange: string): { ref: string, res: number, target: string } | null => {
  // Format p.Arg114Gln
  const regex = /p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})/;
  const match = pChange.match(regex);
  if (match) {
    return {
      ref: AA_MAP[match[1]] || '?',
      res: parseInt(match[2]),
      target: AA_MAP[match[3]] || '?'
    };
  }
  return null;
};
