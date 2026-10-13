import { VariantConservationResult } from '../types';
import { getHumanGeneInfo, getOrtholog, fetchSequence } from '../services/api';
import { alignSequences, parseProteinChange, isSimilarAA, calculateLocalHomology } from './alignment';

export interface SequenceContextCache {
  humanSymbol?: string;
  humanEntrezId?: string;
  humanSeq?: string;
  orthologSymbol?: string;
  orthologId?: string;
  dioptScore?: number;
  yeastSeq?: string;
  aligned1?: string;
  aligned2?: string;
}

/**
 * Checks conservation in yeast (S. cerevisiae) for a single human missense variant.
 * Reuses cached sequence and pairwise alignment if checking multiple alleles for the same gene.
 */
export const checkSingleVariantConservation = async (
  geneSymbol: string,
  allele: string,
  cache?: SequenceContextCache
): Promise<{ result: VariantConservationResult; updatedCache: SequenceContextCache }> => {
  const cleanGene = geneSymbol.trim().toUpperCase();
  const cleanAllele = allele.trim();

  const ctx: SequenceContextCache = { ...cache };

  // 1. Parse missense allele
  const parsed = parseProteinChange(cleanAllele);
  if (!parsed) {
    return {
      result: {
        allele: cleanAllele,
        parsedRef: '',
        parsedPos: 0,
        parsedTarget: '',
        humanRefMatchesSeq: false,
        canonicalRefAA: '',
        hasOrtholog: false,
        conservationStatus: 'Invalid_Position',
        isConserved: false,
        explanation: `Unable to parse missense allele '${cleanAllele}'. Please use standard notation such as 'p.Arg534Leu', 'Arg534Leu', or 'R534L'.`
      },
      updatedCache: ctx
    };
  }

  // 2. Resolve Human Gene Info & Sequence
  if (!ctx.humanSeq || ctx.humanSymbol !== cleanGene) {
    const humanInfo = await getHumanGeneInfo(cleanGene);
    if (!humanInfo || !humanInfo.entrez_id) {
      throw new Error(`Human gene '${cleanGene}' not found in MyGene.info or NCBI database.`);
    }
    ctx.humanSymbol = humanInfo.symbol;
    ctx.humanEntrezId = humanInfo.entrez_id;

    // Prefer UniProt accession (e.g. P43246), then Entrez ID (4436), then gene symbol (MSH2)
    const targetHumanId = humanInfo.uniprot_id || humanInfo.entrez_id || cleanGene;
    const seqRecord = await fetchSequence(targetHumanId, false);
    if (!seqRecord || !seqRecord.seq) {
      throw new Error(`Unable to fetch canonical protein sequence for human gene '${cleanGene}'.`);
    }
    ctx.humanSeq = seqRecord.seq;
  }

  const humanSeq = ctx.humanSeq!;

  // 3. Verify position boundaries & reference amino acid
  if (parsed.res < 1 || parsed.res > humanSeq.length) {
    return {
      result: {
        allele: cleanAllele,
        parsedRef: parsed.ref,
        parsedPos: parsed.res,
        parsedTarget: parsed.target,
        humanRefMatchesSeq: false,
        canonicalRefAA: '',
        hasOrtholog: false,
        conservationStatus: 'Invalid_Position',
        isConserved: false,
        explanation: `Position ${parsed.res} is outside the canonical protein boundaries of ${ctx.humanSymbol} (length: ${humanSeq.length} aa).`
      },
      updatedCache: ctx
    };
  }

  const canonicalRefAA = humanSeq[parsed.res - 1];
  const humanRefMatches = canonicalRefAA === parsed.ref;

  if (!humanRefMatches) {
    return {
      result: {
        allele: cleanAllele,
        parsedRef: parsed.ref,
        parsedPos: parsed.res,
        parsedTarget: parsed.target,
        humanRefMatchesSeq: false,
        canonicalRefAA,
        hasOrtholog: false,
        conservationStatus: 'Invalid_Position',
        isConserved: false,
        explanation: `Residue mismatch: In the canonical human ${ctx.humanSymbol} sequence, position ${parsed.res} is '${canonicalRefAA}', but '${parsed.ref}' was submitted. Please verify the transcript/isoform numbering.`
      },
      updatedCache: ctx
    };
  }

  // 4. Resolve Yeast Ortholog
  if (ctx.orthologSymbol === undefined) {
    const ortholog = await getOrtholog(ctx.humanEntrezId!);
    if (!ortholog || ortholog.score === 0 || !ortholog.id) {
      ctx.orthologSymbol = '';
      ctx.dioptScore = 0;
    } else {
      ctx.orthologSymbol = ortholog.symbol;
      ctx.orthologId = ortholog.id;
      ctx.dioptScore = ortholog.score;
    }
  }

  if (!ctx.orthologSymbol || !ctx.orthologId) {
    return {
      result: {
        allele: cleanAllele,
        parsedRef: parsed.ref,
        parsedPos: parsed.res,
        parsedTarget: parsed.target,
        humanRefMatchesSeq: true,
        canonicalRefAA,
        hasOrtholog: false,
        dioptScore: 0,
        conservationStatus: 'No_Ortholog',
        isConserved: false,
        explanation: `Human gene ${ctx.humanSymbol} has no identified functional ortholog in Saccharomyces cerevisiae (DIOPT score < 2). Yeast functional modeling cannot be performed.`
      },
      updatedCache: ctx
    };
  }

  // 5. Fetch Yeast Sequence & Align
  if (!ctx.aligned1 || !ctx.aligned2) {
    const yeastTargetId = ctx.orthologId || ctx.orthologSymbol;
    const yeastSeqRec = await fetchSequence(yeastTargetId!, true);
    if (!yeastSeqRec || !yeastSeqRec.seq) {
      throw new Error(`Unable to fetch protein sequence for yeast ortholog '${ctx.orthologSymbol}'.`);
    }
    ctx.yeastSeq = yeastSeqRec.seq;

    const alignRes = alignSequences(humanSeq, yeastSeqRec.seq);
    ctx.aligned1 = alignRes.aligned1;
    ctx.aligned2 = alignRes.aligned2;
  }

  const { aligned1, aligned2 } = ctx;

  // 6. Locate residue coordinate in alignment
  let hPos = 0;
  let yPos = 0;
  let targetCol = -1;
  let yChar = '-';
  let yeastPosNumber = 0;

  for (let i = 0; i < aligned1.length; i++) {
    if (aligned1[i] !== '-') hPos++;
    if (aligned2[i] !== '-') yPos++;

    if (hPos === parsed.res && targetCol === -1) {
      targetCol = i;
      yChar = aligned2[i];
      yeastPosNumber = aligned2[i] !== '-' ? yPos : 0;
      break;
    }
  }

  // 7. Calculate conservation status
  let status: 'Identical' | 'Similar' | 'Mismatch' | 'Gap' = 'Mismatch';
  if (yChar === '-') {
    status = 'Gap';
  } else if (canonicalRefAA === yChar) {
    status = 'Identical';
  } else if (isSimilarAA(canonicalRefAA, yChar)) {
    status = 'Similar';
  } else {
    status = 'Mismatch';
  }

  const isConserved = status === 'Identical' || status === 'Similar';
  const localScore = targetCol !== -1 ? calculateLocalHomology(aligned1, aligned2, targetCol) : 0;

  // 8. Generate visual alignment snippet
  let alignmentSnippet = undefined;
  if (targetCol !== -1) {
    const start = Math.max(0, targetCol - 8);
    const end = Math.min(aligned1.length, targetCol + 9);
    const subH = aligned1.substring(start, end);
    const subY = aligned2.substring(start, end);
    let matchLine = '';
    for (let k = start; k < end; k++) {
      if (k === targetCol) matchLine += '▼';
      else if (aligned1[k] === aligned2[k] && aligned1[k] !== '-') matchLine += '|';
      else if (isSimilarAA(aligned1[k], aligned2[k])) matchLine += ':';
      else matchLine += ' ';
    }
    alignmentSnippet = {
      humanSeq: subH,
      yeastSeq: subY,
      matchLine,
      startPos: start,
      targetIndex: targetCol - start
    };
  }

  // 9. Biological explanation
  let explanation = '';
  if (status === 'Identical') {
    explanation = `100% Identically Conserved: Position ${canonicalRefAA}${parsed.res} in human ${ctx.humanSymbol} aligns to identical residue ${yChar}${yeastPosNumber} in yeast ${ctx.orthologSymbol}. Highly eligible for direct orthologous CRISPR modeling.`;
  } else if (status === 'Similar') {
    explanation = `Functionally Conserved: Position ${canonicalRefAA}${parsed.res} in human ${ctx.humanSymbol} aligns to chemically similar residue ${yChar}${yeastPosNumber} in yeast ${ctx.orthologSymbol} (conservative substitution). Suitable for functional modeling.`;
  } else if (status === 'Gap') {
    explanation = `Not Conserved (Gap): Position ${canonicalRefAA}${parsed.res} in human ${ctx.humanSymbol} falls within an evolutionary insertion that is absent in S. cerevisiae (${ctx.orthologSymbol}). Standard yeast missense modeling is not feasible.`;
  } else {
    explanation = `Not Conserved (Mismatch): Position ${canonicalRefAA}${parsed.res} in human ${ctx.humanSymbol} aligns to a non-conserved residue '${yChar}' (position ${yeastPosNumber}) in S. cerevisiae (${ctx.orthologSymbol}). Yeast naturally carries '${yChar}', preventing direct missense phenotyping.`;
  }

  return {
    result: {
      allele: cleanAllele,
      parsedRef: parsed.ref,
      parsedPos: parsed.res,
      parsedTarget: parsed.target,
      humanRefMatchesSeq: true,
      canonicalRefAA,
      hasOrtholog: true,
      yeastGene: ctx.orthologSymbol,
      yeastEntrezId: ctx.orthologId,
      dioptScore: ctx.dioptScore,
      yeastAA: yChar,
      yeastPos: yeastPosNumber > 0 ? yeastPosNumber : '-',
      conservationStatus: status,
      isConserved,
      localHomologyScore: localScore,
      alignmentSnippet,
      explanation
    },
    updatedCache: ctx
  };
};

/**
 * Checks conservation for a list of missense variants of a human gene.
 */
export const checkMultipleVariantsConservation = async (
  geneSymbol: string,
  rawAlleles: string
): Promise<VariantConservationResult[]> => {
  // Split by comma, semicolon, or newlines
  const tokens = rawAlleles
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (tokens.length === 0) return [];

  let cache: SequenceContextCache = {};
  const results: VariantConservationResult[] = [];

  for (const allele of tokens) {
    try {
      const { result, updatedCache } = await checkSingleVariantConservation(geneSymbol, allele, cache);
      cache = updatedCache;
      results.push(result);
    } catch (err: any) {
      if (!cache.humanSeq || !cache.aligned1) {
        throw err;
      }
      results.push({
        allele,
        parsedRef: '',
        parsedPos: 0,
        parsedTarget: '',
        humanRefMatchesSeq: false,
        canonicalRefAA: '',
        hasOrtholog: false,
        conservationStatus: 'Mismatch',
        isConserved: false,
        explanation: err?.message || 'Error checking conservation for this variant.'
      });
    }
  }

  return results;
};
