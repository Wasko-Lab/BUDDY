
import { GeneInfo, OrthologInfo, SequenceRecord, Variant, Phenotype, CodingExon, DiscordantSearchResult, DiscordantVariant, ProteinDomain, ProteinPtm, FunctionalSite, ProteinInterfaceData } from '../types';
import { AA_MAP, parseProteinChange, isSimilarAA } from '../utils/alignment';
import { orthologs } from '../data/DIOPT_Best2026';
import summaryTsv from '../data/YeastHuman_Orthologs_Summary.tsv?raw';

// Parse YeastHuman_Orthologs_Summary
const parsedSummary = summaryTsv
  .split('\n')
  .slice(1)
  .filter(line => line.trim())
  .map(line => {
    const [humanSymbol, yeastSymbol, dioptScore, bestScore, bestScoreReverse] = line.split('\t');
    return {
      humanSymbol: humanSymbol?.trim()?.toUpperCase(),
      yeastSymbol: yeastSymbol?.trim()?.toUpperCase(),
      dioptScore: parseInt(dioptScore?.trim() || '0', 10),
      bestScore: (bestScore?.trim()?.toLowerCase() === 'yes'),
      bestScoreReverse: (bestScoreReverse?.trim()?.toLowerCase() === 'yes'),
    };
  });

// --- MyGene.info ---
export const getHumanGeneInfo = async (symbol: string): Promise<GeneInfo> => {
  // If input is all digits, treat as Entrez ID
  const isEntrezId = /^\d+$/.test(symbol);
  let url = `https://mygene.info/v3/query?q=${symbol}&scopes=symbol,alias&fields=symbol,entrezgene,name,uniprot,type_of_gene&species=human`;
  
  if (isEntrezId) {
    url = `https://mygene.info/v3/gene/${symbol}?fields=symbol,entrezgene,name,uniprot,type_of_gene`;
  }

  const response = await fetch(url);
  const data = await response.json();
  
  let hit;
  if (isEntrezId) {
    hit = data;
  } else {
    if (!data.hits || data.hits.length === 0) {
      throw new Error("Gene not found in MyGene.info");
    }
    hit = data.hits[0];
  }

  // Check if protein coding
  if (hit.type_of_gene && hit.type_of_gene !== 'protein-coding') {
     throw new Error(`Gene '${hit.symbol}' is ${hit.type_of_gene}, not protein-coding. No UniProt ID available. Filter Orthologs to remove these.`);
  }

  let uniprotId = null;
  
  if (hit.uniprot) {
    if (typeof hit.uniprot === 'string') uniprotId = hit.uniprot;
    else if (hit.uniprot['Swiss-Prot']) uniprotId = Array.isArray(hit.uniprot['Swiss-Prot']) ? hit.uniprot['Swiss-Prot'][0] : hit.uniprot['Swiss-Prot'];
  }

  return {
    symbol: hit.symbol,
    name: hit.name,
    entrez_id: hit.entrezgene?.toString(),
    uniprot_id: uniprotId
  };
};

// --- YeastMine Helper ---
// Fallback for broad topics (e.g. "Aging", "Cancer") that MyGene.info might miss in Yeast
const searchYeastMine = async (term: string): Promise<any[]> => {
  try {
    const url = `https://yeastmine.yeastgenome.org/yeastmine/service/search?q=${encodeURIComponent(term)}&cat=Gene&species=Saccharomyces%20cerevisiae&format=json`;
    const response = await fetch(url);
    if (!response.ok) return [];
    
    const data = await response.json();
    if (!data.results) return [];

    // Extract Locus Tags (e.g. YDR001C)
    // We filter for standard ORF names (Y or Q followed by alphanumeric) to ensure quality hits
    const locusTags = data.results
        .map((r: any) => r.fields?.primaryIdentifier)
        .filter((id: any) => typeof id === 'string' && /^[YQ][A-Z0-9]{6}[A-Z0-9]?$/.test(id))
        .slice(0, 25);
    
    if (locusTags.length === 0) return [];

    // Resolve to Entrez via MyGene batch query
    const mgUrl = `https://mygene.info/v3/query?q=${locusTags.join(',')}&scopes=locus_tag&species=4932&fields=symbol,name,entrezgene,uniprot,locus_tag`;
    const mgResp = await fetch(mgUrl);
    const mgData = await mgResp.json();
    
    // Ensure array
    const hits = Array.isArray(mgData) ? mgData : [];

    return hits.map((hit: any) => ({
      symbol: hit.symbol || hit.locus_tag || hit.query,
      name: hit.name || 'Yeast Gene',
      entrez_id: hit.entrezgene?.toString(),
      hasUniprot: !!hit.uniprot
    })).filter((g: any) => g.entrez_id);

  } catch (e) {
    console.warn("YeastMine search failed", e);
    return [];
  }
};

// --- AI Topic Search ---
export const searchGenesByAi = async (topic: string, species: 'human' | 'yeast'): Promise<{ symbol: string; name: string; entrez_id: string }[]> => {
    const speciesName = species === 'human' ? 'Homo sapiens' : 'Saccharomyces cerevisiae (Budding Yeast)';
    
    // 1. Ask the backend API for the list
    const response = await fetch('/api/searchGenesByAi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, speciesName })
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch genes by AI");
    }

    const { text } = await response.json();
    const aiResults = JSON.parse(text || "[]");
    const symbols = aiResults.map((r: any) => r.symbol);

    if (symbols.length === 0) return [];

    // 2. Validate and Enrich with MyGene.info (Batch Query)
    // We use the batch query to turn symbols into Entrez IDs and official Names
    const taxId = species === 'human' ? '9606' : '4932,559292';
    const postBody = {
        q: symbols,
        scopes: species === 'human' ? 'symbol,alias' : 'symbol,alias,locus_tag',
        fields: 'symbol,name,entrezgene,uniprot,type_of_gene',
        species: taxId
    };

    const mgResponse = await fetch('https://mygene.info/v3/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody)
    });

    const mgData = await mgResponse.json();

    // 3. Merge AI Relevance with Official Data
    // We want to preserve the AI's ranking (order of input symbols), but use MyGene's official data
    const validGenes: any[] = [];
    const seenEntrez = new Set();

    // Iterate through the original symbol list to maintain order
    for (const aiHit of aiResults) {
        // Find corresponding MyGene hit(s)
        const mgHits = mgData.filter((m: any) => 
            m.query && m.query.toUpperCase() === aiHit.symbol.toUpperCase() && m.entrezgene
        );

        // Take the best hit (usually the first one if multiple due to alias matches)
        const bestHit = mgHits[0];

        if (bestHit && !seenEntrez.has(bestHit.entrezgene)) {
            // Strict filtering for Human searches: Must be protein-coding and have UniProt ID
            // This prevents "unknown" genes that can't be analyzed
            if (species === 'human') {
                const isProteinCoding = bestHit.type_of_gene === 'protein-coding';
                const hasUniprot = !!bestHit.uniprot;
                if (!isProteinCoding || !hasUniprot) continue;
            }

            seenEntrez.add(bestHit.entrezgene);
            validGenes.push({
                symbol: bestHit.symbol,
                // Append the AI reason to the name for context in the UI
                name: bestHit.name ? `${bestHit.name} (${aiHit.reason})` : aiHit.reason,
                entrez_id: bestHit.entrezgene.toString(),
                hasUniprot: !!bestHit.uniprot
            });
        }
    }

    return validGenes;
};

export const searchGenes = async (term: string, species: 'human' | 'yeast' = 'human'): Promise<{ symbol: string; name: string; entrez_id: string }[]> => {
  // For yeast, include 559292 (S288C) explicitly alongside 4932 to ensure strain-specific hits are caught
  const speciesQuery = species === 'human' ? 'human' : '4932,559292';
  
  // Fields to retrieve - added summary and GO for context (though mostly for search matching)
  const fields = 'symbol,name,entrezgene,uniprot,type_of_gene,alias,locus_tag,summary';
  
  // Construct filter suffix
  const typeFilter = species === 'human' ? ' AND type_of_gene:protein-coding' : '';
  
  // Strategy 1: Standard Search
  let url = `https://mygene.info/v3/query?q=${encodeURIComponent(term)}${encodeURIComponent(typeFilter)}&species=${speciesQuery}&size=100&fields=${fields}`;
  
  let response = await fetch(url);
  let data = await response.json();
  
  // Strategy 2: Prefix Wildcard (term*) - Good for "vacuol" -> "vacuole"
  if (!data.hits || data.hits.length === 0) {
      if (term.length > 2) {
          url = `https://mygene.info/v3/query?q=${encodeURIComponent(term)}*${encodeURIComponent(typeFilter)}&species=${speciesQuery}&size=100&fields=${fields}`;
          response = await fetch(url);
          data = await response.json();
      }
  }

  // Strategy 3: Surrogate/Contains Wildcard (*term*) - Helps with matching inside compound words or descriptions
  // This is aggressive but necessary for topics like "autophagy" where the term might be buried in a description or name
  if ((!data.hits || data.hits.length === 0) && term.length > 2) {
       url = `https://mygene.info/v3/query?q=*${encodeURIComponent(term)}*${encodeURIComponent(typeFilter)}&species=${speciesQuery}&size=100&fields=${fields}`;
       response = await fetch(url);
       data = await response.json();
  }

  // Strategy 4: Deep Topic Search (Explicit Fields)
  // Targets functional descriptions (GO, GeneRIF, Summary)
  if ((!data.hits || data.hits.length === 0) && term.length > 2) {
       const isPhrase = term.includes(' ');
       const searchVal = isPhrase ? `"${term}"` : `*${term}*`;
       const q = `(summary:${searchVal} OR go.BP.term:${searchVal} OR go.MF.term:${searchVal} OR generif.text:${searchVal} OR alias:${searchVal})${typeFilter}`;
       
       url = `https://mygene.info/v3/query?q=${encodeURIComponent(q)}&species=${speciesQuery}&size=100&fields=${fields}`;
       response = await fetch(url);
       data = await response.json();
  }

  // Strategy 5: YeastMine Fallback (SGD)
  // If we are searching yeast and still have no hits, try YeastMine directly.
  // This is crucial for broad terms like "Aging" or "Cancer" which are well-indexed in SGD but may not be in MyGene summaries.
  if (species === 'yeast' && (!data.hits || data.hits.length === 0)) {
      const yeastHits = await searchYeastMine(term);
      if (yeastHits.length > 0) {
          return yeastHits;
      }
  }

  if (!data.hits || data.hits.length === 0) {
    return [];
  }

  // Map and filter results.
  return data.hits.map((hit: any) => ({
    // Critical fix: Use locus_tag as symbol if standard symbol is missing (common in Yeast)
    symbol: hit.symbol || hit.locus_tag || hit.name || hit._id, 
    name: hit.name || 'Unknown Name',
    // Fallback to _id if entrezgene is missing (usually _id IS the entrez id)
    entrez_id: hit.entrezgene?.toString() || hit._id,
    hasUniprot: !!hit.uniprot,
    type_of_gene: hit.type_of_gene
  }))
  .filter((g: any) => {
      // Basic validity
      if (!g.symbol || !g.entrez_id) return false;
      
      // Strict filtering for Human searches to avoid "unknown/non-coding" noise
      if (species === 'human') {
          const isProteinCoding = g.type_of_gene === 'protein-coding';
          const hasUniprot = g.hasUniprot;
          return isProteinCoding && hasUniprot;
      }
      
      return true;
  }); 
};

// --- DIOPT Ortholog Lookup (Local Module Source) ---
export const getOrtholog = async (entrezId: string, sourceTax: string = '9606', targetTax: string = '4932', geneSymbol?: string): Promise<OrthologInfo | null> => {
  // Use imported orthologs directly. Structure: [YeastID, YeastSymbol, HumanID, HumanSymbol, Score]
  if (!orthologs || orthologs.length === 0) {
    console.warn("Orthology data not loaded.");
  }

  let matches: any[] = [];

  // Human (9606) -> Yeast (4932)
  if (sourceTax === '9606') {
      // Col 2 is HumanID (number)
      matches = orthologs?.filter(r => r[2].toString() === entrezId) || [];
      // Fallback to symbol if ID fails (Col 3)
      if (matches.length === 0 && geneSymbol) {
          const upperSym = geneSymbol.toUpperCase();
          matches = orthologs?.filter(r => (r[3] as string).toUpperCase() === upperSym) || [];
      }
      
      if (matches.length > 0) {
          // Sort by score descending (Col 4)
          matches.sort((a, b) => (b[4] as number) - (a[4] as number));
          const best = matches[0];
          return {
              id: best[0].toString(), // Yeast Entrez ID
              symbol: best[1] as string, // Yeast Symbol
              score: best[4] as number
          };
      }
  } 
  // Yeast (4932) -> Human (9606)
  else if (sourceTax === '4932') {
      // Col 0 is YeastID (number)
      matches = orthologs?.filter(r => r[0].toString() === entrezId) || [];
       // Fallback to symbol (Col 1)
       if (matches.length === 0 && geneSymbol) {
          const upperSym = geneSymbol.toUpperCase();
          matches = orthologs?.filter(r => (r[1] as string).toUpperCase() === upperSym) || [];
      }

      if (matches.length > 0) {
          matches.sort((a, b) => (b[4] as number) - (a[4] as number));
          const best = matches[0];
          return {
              id: best[2].toString(), // Human Entrez ID
              symbol: best[3] as string, // Human Symbol
              score: best[4] as number
          };
      }
  }

  // Fallback to parsedSummary
  if (geneSymbol && parsedSummary && parsedSummary.length > 0) {
      const upperSym = geneSymbol.toUpperCase();
      let summaryMatches: any[] = [];
      
      if (sourceTax === '9606') { // Human to Yeast
          summaryMatches = parsedSummary.filter(r => r.humanSymbol === upperSym && r.yeastSymbol);
      } else if (sourceTax === '4932') { // Yeast to Human
          summaryMatches = parsedSummary.filter(r => r.yeastSymbol === upperSym && r.humanSymbol);
      }

      if (summaryMatches.length > 0) {
          // Sort matches according to criteria:
          // Highest DIOPT Score -> Best Score -> Best Score Reverse -> Alphabetical
          summaryMatches.sort((a, b) => {
              if (b.dioptScore !== a.dioptScore) return b.dioptScore - a.dioptScore;
              if (b.bestScore !== a.bestScore) return b.bestScore ? 1 : -1;
              if (b.bestScoreReverse !== a.bestScoreReverse) return b.bestScoreReverse ? 1 : -1;
              const symA = sourceTax === '9606' ? a.yeastSymbol : a.humanSymbol;
              const symB = sourceTax === '9606' ? b.yeastSymbol : b.humanSymbol;
              return symA.localeCompare(symB);
          });

          const best = summaryMatches[0];
          const tiedMatches = summaryMatches.filter(m => 
              m.dioptScore === best.dioptScore && 
              m.bestScore === best.bestScore && 
              m.bestScoreReverse === best.bestScoreReverse
          );
          const targetSymbol = sourceTax === '9606' ? best.yeastSymbol : best.humanSymbol;
          const tiedSymbols = tiedMatches.length > 1 
              ? tiedMatches.map(m => sourceTax === '9606' ? m.yeastSymbol : m.humanSymbol).filter(sym => sym !== targetSymbol)
              : undefined;
          
          try {
             // We need to resolve the ID for the target symbol. Let's use searchGenes.
             const lookupTax = sourceTax === '9606' ? 'yeast' : 'human';
             const searchResults = await searchGenes(targetSymbol, lookupTax);
             if (searchResults && searchResults.length > 0) {
                 // Try exact match first
                 const exactMatch = searchResults.find((r: any) => r.symbol.toUpperCase() === targetSymbol.toUpperCase()) || searchResults[0];
                 return {
                     id: exactMatch.entrez_id,
                     symbol: exactMatch.symbol,
                     score: best.dioptScore,
                     tiedSymbols: tiedSymbols?.length ? tiedSymbols : undefined
                 };
             }
          } catch (e) {
             console.warn("Failed to lookup Entrez ID during fallback summary check:", e);
          }
      }
  }

  return null;
};

// --- Alliance of Genome Resources (AllianceMine Backup for Yeast DNA Sequence) ---
export const fetchYeastGeneAllianceMine = async (geneName: string): Promise<{ sequence: string; codingExons: CodingExon[]; source: string } | null> => {
  const cleanName = geneName.trim().toUpperCase();
  const cleanSgd = geneName.startsWith('SGD:') ? geneName : `SGD:${geneName}`;

  // Strategy 1: Server proxy route (/api/alliancemine/sequence)
  try {
    const res = await fetch(`/api/alliancemine/sequence?symbol=${encodeURIComponent(geneName)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.sequence && typeof data.sequence === 'string' && data.sequence.length > 0) {
        const seq = data.sequence.toUpperCase();
        return {
          sequence: seq,
          codingExons: [{ start: 0, end: seq.length, cumLengthBefore: 0 }],
          source: 'Alliance Genome (AllianceMine)'
        };
      }
    }
  } catch (proxyError) {
    console.warn("Server proxy for AllianceMine sequence failed, trying direct InterMine query:", proxyError);
  }

  // Strategy 2: Direct call to AllianceMine InterMine REST Web Service
  const ALLIANCEMINE_URL = "https://alliancemine.alliancegenome.org/alliancemine/service/query/results";

  const queries = [
    // 1. By Gene symbol
    `<query name="" model="genomic" view="Gene.primaryIdentifier Gene.secondaryIdentifier Gene.symbol Gene.sequence.residues Gene.length" sortOrder="Gene.symbol asc">
      <constraint path="Gene.symbol" op="=" value="${cleanName}"/>
      <constraint path="Gene.organism.taxonId" op="ONE OF"><value>4932</value><value>559292</value></constraint>
    </query>`,
    // 2. By secondaryIdentifier (systematic ORF name, e.g., YFL039C)
    `<query name="" model="genomic" view="Gene.primaryIdentifier Gene.secondaryIdentifier Gene.symbol Gene.sequence.residues Gene.length" sortOrder="Gene.symbol asc">
      <constraint path="Gene.secondaryIdentifier" op="=" value="${cleanName}"/>
      <constraint path="Gene.organism.taxonId" op="ONE OF"><value>4932</value><value>559292</value></constraint>
    </query>`,
    // 3. By primaryIdentifier (SGD ID)
    `<query name="" model="genomic" view="Gene.primaryIdentifier Gene.secondaryIdentifier Gene.symbol Gene.sequence.residues Gene.length" sortOrder="Gene.symbol asc">
      <constraint path="Gene.primaryIdentifier" op="=" value="${cleanSgd}"/>
    </query>`
  ];

  for (const xml of queries) {
    try {
      const url = `${ALLIANCEMINE_URL}?query=${encodeURIComponent(xml)}&format=json`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const residues = data.results[0][3];
          if (residues && typeof residues === 'string' && residues.length > 0) {
            const seq = residues.toUpperCase();
            return {
              sequence: seq,
              codingExons: [{ start: 0, end: seq.length, cumLengthBefore: 0 }],
              source: 'Alliance Genome (AllianceMine)'
            };
          }
        }
      }
    } catch (err) {
      console.warn("Direct AllianceMine query error:", err);
    }
  }

  return null;
};

// --- Ensembl with Alliance Genome (AllianceMine) Backup (Yeast DNA Sequence) ---
export const fetchYeastGeneSequence = async (geneSymbol: string): Promise<{ sequence: string; codingExons: CodingExon[]; source: string }> => {
    const ENSEMBL_BASE = "https://rest.ensembl.org";
    
    try {
        // 1. Resolve Symbol to ID
        const xrefResponse = await fetch(
          `${ENSEMBL_BASE}/xrefs/symbol/saccharomyces_cerevisiae/${encodeURIComponent(geneSymbol)}?content-type=application/json`
        );
        if (!xrefResponse.ok) throw new Error(`Yeast gene symbol lookup failed in Ensembl (status: ${xrefResponse.status})`);
        const xrefData = await xrefResponse.json();
        if (!xrefData.length) throw new Error(`Gene '${geneSymbol}' not found in Yeast Ensembl database.`);
      
        const id = xrefData[0].id;
      
        // 2. Get Gene info
        const lookupResp = await fetch(`${ENSEMBL_BASE}/lookup/id/${id}?expand=1&content-type=application/json`);
        if (!lookupResp.ok) throw new Error("Yeast gene info lookup failed in Ensembl");
        const geneInfo = await lookupResp.json();

        // Select canonical transcript
        let transcript = geneInfo.Transcript.find((t: any) => t.is_canonical);
        if (!transcript && geneInfo.Transcript.length > 0) {
            transcript = geneInfo.Transcript.sort((a: any, b: any) => {
                const lenA = a.Translation ? a.Translation.end - a.Translation.start : 0;
                const lenB = b.Translation ? b.Translation.end - b.Translation.start : 0;
                return lenB - lenA;
            })[0];
        }

        if (!transcript || !transcript.Translation) {
            throw new Error("No protein coding transcript found for this gene in Ensembl.");
        }

        const FLANK = 1000;
        const seqResponse = await fetch(
          `${ENSEMBL_BASE}/sequence/id/${id}?content-type=text/plain;expand_5prime=${FLANK};expand_3prime=${FLANK}`
        );
        if (!seqResponse.ok) throw new Error("Yeast sequence lookup failed in Ensembl");
        const sequence = await seqResponse.text();

        // 3. Map Coding Exons to String Indices
        const cdsStartGenomic = transcript.Translation.start;
        const cdsEndGenomic = transcript.Translation.end;
        const isForward = geneInfo.strand === 1;
        
        const codingExons: CodingExon[] = [];
        
        // Sort exons by genomic position to process 5'->3' correctly based on strand
        const sortedExons = transcript.Exon.sort((a: any, b: any) => {
            return isForward ? a.start - b.start : b.start - a.start; // Rev strand: genomic descending = 5'->3'
        });

        let cumLength = 0;

        for (const exon of sortedExons) {
            // Intersect Exon with CDS range
            const start = Math.max(exon.start, cdsStartGenomic);
            const end = Math.min(exon.end, cdsEndGenomic);

            if (start <= end) {
                // This exon contains coding sequence
                const genomicLen = end - start + 1;
                
                // Map genomic coordinates to string indices
                let strStart = -1;
                let strEnd = -1;

                if (isForward) {
                    strStart = start - geneInfo.start + FLANK;
                    strEnd = end - geneInfo.start + FLANK + 1; // +1 for exclusive
                } else {
                    strStart = (geneInfo.end + FLANK) - end;
                    strEnd = (geneInfo.end + FLANK) - start + 1;
                }

                codingExons.push({
                    start: strStart,
                    end: strEnd,
                    cumLengthBefore: cumLength
                });

                cumLength += genomicLen;
            }
        }

        return { sequence, codingExons, source: 'Ensembl' };
    } catch (ensemblError: any) {
        console.warn(`Ensembl failed for yeast gene '${geneSymbol}': ${ensemblError?.message || ensemblError}. Activating Alliance of Genome Resources (AllianceMine) backup...`);
        
        const allianceMineData = await fetchYeastGeneAllianceMine(geneSymbol);
        if (allianceMineData && allianceMineData.sequence) {
            console.log(`Successfully fetched ${allianceMineData.sequence.length} bp for '${geneSymbol}' from Alliance of Genome Resources (AllianceMine) backup.`);
            return allianceMineData;
        }

        throw new Error(`Failed to fetch yeast genomic sequence for '${geneSymbol}' from Ensembl (${ensemblError?.message || 'Error'}) and Alliance of Genome Resources backup.`);
    }
};

// --- UniProt ---
export const fetchSequence = async (id: string, isYeast = false): Promise<SequenceRecord> => {
  let url = `https://rest.uniprot.org/uniprotkb/${id}.fasta`;
  
  // Special handling for Yeast: supports SGD IDs and Entrez IDs (via search)
  if (isYeast) {
    const isSgdId = id.startsWith('SGD:') || /^S\d+$/.test(id);
    const isEntrezId = /^\d+$/.test(id);
    
    if (isSgdId) {
      const cleanId = id.replace('SGD:', '').trim();
      url = `https://rest.uniprot.org/uniprotkb/search?query=xref:sgd-${cleanId}&format=fasta&size=1`;
    } else if (isEntrezId) {
      // Map Entrez Gene ID to UniProt using search
      // Note: Yeast (S. cerevisiae) taxonomy is 4932 or 559292 (S288C)
      url = `https://rest.uniprot.org/uniprotkb/search?query=xref:geneid-${id}+AND+organism_id:559292&format=fasta&size=1`;
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch sequence for ${id} (Status: ${response.status})`);
  }
  
  const text = await response.text();
  if (!text || !text.trim()) {
     throw new Error(`No sequence data returned for ${id}`);
  }

  // Simple fasta parser
  const lines = text.trim().split('\n');
  const description = lines[0];
  const seq = lines.slice(1).join('').trim();
  
  return { id, description, seq };
};

// --- MyVariant.info ---
export interface ClinVarQueryOptions {
  excludeUncertain?: boolean;
  excludeConflicting?: boolean;
  minStars?: number;
}

export const fetchClinVarVariants = async (
  geneSymbol: string, 
  significanceTerms: string[] = [],
  options: ClinVarQueryOptions = {}
): Promise<any[]> => {
  // Request clinvar, dbsnp AND dbnsfp (for AlphaMissense scores), and gnomAD data
  // Default to VUS if no terms provided
  let sigQuery = "";
  if (significanceTerms.length > 0) {
    sigQuery = `(${significanceTerms.map(s => `clinvar.rcv.clinical_significance:"${s}"`).join(" OR ")})`;
  } else {
    sigQuery = `clinvar.rcv.clinical_significance:"Uncertain significance"`;
  }

  // If uncertain is not requested or explicitly excluded, strictly negate it from MyVariant query
  const shouldExcludeUncertain = options.excludeUncertain ?? (!significanceTerms.some(s => s.toLowerCase().includes('uncertain')));
  if (shouldExcludeUncertain) {
    sigQuery += ` AND -clinvar.rcv.clinical_significance:"Uncertain significance"`;
  }

  // If conflicting is not requested or explicitly excluded, negate it as well
  const shouldExcludeConflicting = options.excludeConflicting ?? (!significanceTerms.some(s => s.toLowerCase().includes('conflicting')));
  if (shouldExcludeConflicting) {
    sigQuery += ` AND -clinvar.rcv.clinical_significance:"Conflicting interpretations of pathogenicity" AND -clinvar.clinical_significance:"Conflicting interpretations of pathogenicity" AND -clinvar.rcv.review_status:"criteria provided, conflicting interpretations"`;
  }

  // Filter by ClinVar Review Status / Gold Stars if requested
  if (options.minStars && options.minStars > 0) {
    const starTerms: string[] = [];
    if (options.minStars <= 1) {
      starTerms.push('"criteria provided, single submitter"');
      starTerms.push('"criteria provided, conflicting interpretations"');
    }
    if (options.minStars <= 2) {
      starTerms.push('"criteria provided, multiple submitters, no conflicts"');
    }
    if (options.minStars <= 3) {
      starTerms.push('"reviewed by expert panel"');
    }
    if (options.minStars <= 4) {
      starTerms.push('"practice guideline"');
    }
    if (starTerms.length > 0) {
      sigQuery += ` AND (${starTerms.map(t => `clinvar.rcv.review_status:${t}`).join(" OR ")})`;
    }
  }

  const query = `clinvar.gene.symbol:${geneSymbol} AND ${sigQuery}`;
  const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(query)}&fields=clinvar,dbsnp,dbnsfp,gnomad_exome,gnomad_genome,hg19,hg38&size=1000`;
  
  const response = await fetch(url);
  const data = await response.json();
  return data.hits || [];
};

export interface GnomadV4Variant {
  variant_id: string;
  pos: number;
  ref: string;
  alt: string;
  exome?: { ac: number; an: number; af: number } | null;
  genome?: { ac: number; an: number; af: number } | null;
  joint?: { ac: number; an: number } | null;
}

// Fetch all gnomAD v4 (GRCh38) variants for a gene directly from the official Broad Institute GraphQL API
export const fetchGnomadV4GeneVariants = async (geneSymbol: string): Promise<Map<string, GnomadV4Variant>> => {
  try {
    const query = `{
      gene(gene_symbol: "${geneSymbol}", reference_genome: GRCh38) {
        variants(dataset: gnomad_r4) {
          variant_id
          pos
          ref
          alt
          exome { ac an af }
          genome { ac an af }
          joint { ac an }
        }
      }
    }`;
    const response = await fetch("https://gnomad.broadinstitute.org/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    if (!response.ok) return new Map();
    const json = await response.json();
    const list: GnomadV4Variant[] = json.data?.gene?.variants || [];
    const map = new Map<string, GnomadV4Variant>();
    for (const v of list) {
      // Key by pos-ref-alt e.g. "7675102-C-T"
      map.set(`${v.pos}-${v.ref}-${v.alt}`, v);
      map.set(v.variant_id, v);
    }
    return map;
  } catch (e) {
    console.warn("gnomAD v4 GraphQL fetch failed:", e);
    return new Map();
  }
};

// --- SGD ID Lookup (AGR) ---
export const getSgdId = async (symbol: string): Promise<string | null> => {
  try {
    const url = `https://mygene.info/v3/query?q=symbol:${encodeURIComponent(symbol)}&species=559292,4932&fields=all`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.hits && data.hits.length > 0) {
        if (data.hits[0].SGD) {
            const sgd = data.hits[0].SGD;
            return sgd.startsWith('SGD:') ? sgd : `SGD:${sgd}`;
        }
        else if (data.hits[0].AllianceGenome) {
            const sgd = data.hits[0].AllianceGenome;
            return sgd.startsWith('SGD:') ? sgd : `SGD:${sgd}`;
        }
    }
    return null;
  } catch (e) {
    console.warn("MyGene.info Search failed", e);
    return null;
  }
};

// --- Yeast Phenotypes ---
export const fetchYeastPhenotypes = async (yeastId: string, yeastSymbol?: string): Promise<Phenotype[]> => {
  // yeastId could be SGD:S000000001 or S000000001 or an Entrez ID.
  let sgdId = yeastId;
  
  if (/^\d+$/.test(sgdId) || sgdId.includes('NCBI_Gene:')) {
      // It's likely an Entrez ID rather than an SGD ID
      if (yeastSymbol) {
          const resolvedId = await getSgdId(yeastSymbol);
          if (resolvedId) {
              sgdId = resolvedId;
          } else {
              // We couldn't dynamically resolve the SGD ID, but we can STILL fall back to 
              // our /api/phenotypes endpoint which searches by symbol in the local database!
              console.warn(`Could not resolve SGD ID for symbol ${yeastSymbol}, falling back to symbol query.`);
              sgdId = sgdId; // Keep the original ID, server will ignore it or fallback to symbol
          }
      } else {
          console.warn(`Cannot fetch phenotypes for Entrez ID ${sgdId} without a symbol`);
          return [];
      }
  }

  if (!sgdId.startsWith('SGD:')) {
      sgdId = `SGD:${sgdId}`;
  }

  const url = `/api/phenotypes?sgdId=${encodeURIComponent(sgdId)}&symbol=${encodeURIComponent(yeastSymbol || '')}`;
  console.log(`Fetching phenotypes from: ${url}`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
        console.warn(`Phenotype fetch failed with status: ${response.status}`);
        return [];
    }
    
    const data = await response.json();
    console.log(`Phenotype data received from AGR. Has results? ${!!data.results}, Array? ${Array.isArray(data.results)}, Length: ${data.results?.length}`);
    
    if (!data.results || !Array.isArray(data.results)) {
        console.warn(`Phenotype data.results is not an array:`, data);
        return [];
    }
    
    const results: Phenotype[] = data.results
      .filter((r: any) => r.phenotypeStatement || r.phenotype)
      .map((r: any) => {
        const stmt = r.phenotypeStatement || r.phenotype;
        const pa = r.primaryAnnotations?.[0];
        
        // If already enriched by server
        if (r.studyType) {
          return {
            phenotype: stmt,
            category: r.category || r.experimentType || pa?.type || 'Unknown',
            studyType: r.studyType,
            studyTypeLabel: r.studyTypeLabel,
            studyTypeDescription: r.studyTypeDescription,
            experimentType: r.experimentType,
            reference: r.reference || pa?.evidenceItem?.shortCitation,
            pubmed_id: r.pubmed_id || pa?.evidenceItem?.referenceID?.replace('PMID:', ''),
            mutant_type: r.mutant_type || pa?.phenotypeAnnotationSubject?.alleleSymbol?.displayText || 'Unknown',
            note: r.note || pa?.conditionRelations?.[0]?.conditions?.map((c: any) => c.conditionSummary).join(', ') || '',
            hasClassic: !!r.hasClassic,
            hasHighThroughput: !!r.hasHighThroughput,
            allReferences: r.allReferences || []
          };
        }

        // Fallback for direct client-side classification
        const allele = pa?.phenotypeAnnotationSubject?.alleleSymbol?.displayText || '';
        const citation = pa?.evidenceItem?.shortCitation || '';
        const isTargeted = allele && !/(-|_)(\u0394|delta|\u03b4)$/i.test(allele) && allele.toLowerCase() !== 'null';
        const isClassic = isTargeted || pa?.type === 'classical genetics';
        const studyType = isClassic ? 'classic' : 'high-throughput';

        return {
          phenotype: stmt,
          category: pa?.type || (isClassic ? 'classical genetics' : 'systematic mutation set'),
          studyType,
          studyTypeLabel: isClassic ? 'Classic Genetic Targeted Study on Gene' : 'High-Throughput Study (e.g., Deletion Collection)',
          studyTypeDescription: isClassic 
            ? 'Discovered in a targeted, locus-specific study using dedicated mutant alleles or point mutations.'
            : 'Discovered in a systematic genome-wide survey (e.g., yeast deletion collection, barcode fitness profiling, or chemical-genomic screen).',
          experimentType: isClassic ? 'classical genetics' : 'systematic mutation set',
          reference: citation || 'SGD',
          pubmed_id: pa?.evidenceItem?.referenceID?.replace('PMID:', ''),
          mutant_type: allele || 'Unknown',
          note: pa?.conditionRelations?.[0]?.conditions?.map((c: any) => c.conditionSummary).join(', ') || '',
          hasClassic: isClassic,
          hasHighThroughput: !isClassic,
          allReferences: citation ? [{
            citation,
            pubmed_id: pa?.evidenceItem?.referenceID?.replace('PMID:', ''),
            studyType,
            experimentType: isClassic ? 'classical genetics' : 'systematic mutation set',
            allele
          }] : []
        };
      });
      
    // Deduplicate by phenotype statement, merging evidence and references
    const uniqueResultsMap = new Map<string, Phenotype>();
    for (const item of results) {
      const existing = uniqueResultsMap.get(item.phenotype);
      if (!existing) {
        uniqueResultsMap.set(item.phenotype, { ...item });
      } else {
        const hasClassic = existing.hasClassic || item.hasClassic;
        const hasHighThroughput = existing.hasHighThroughput || item.hasHighThroughput;
        const studyType: 'classic' | 'high-throughput' | 'both' = 
          hasClassic && hasHighThroughput ? 'both' : (hasClassic ? 'classic' : 'high-throughput');

        const studyTypeLabel = 
          studyType === 'both' ? 'Both Classic Targeted & High-Throughput Studies' :
          studyType === 'classic' ? 'Classic Genetic Targeted Study on Gene' :
          'High-Throughput Study (e.g., Deletion Collection)';

        const studyTypeDescription = 
          studyType === 'both' ? 'Corroborated across both classic targeted gene studies and genome-wide high-throughput deletion screens.' :
          studyType === 'classic' ? 'Discovered in a targeted, locus-specific study using dedicated mutant alleles or point mutations.' :
          'Discovered in a systematic genome-wide survey (e.g., yeast deletion collection, barcode fitness profiling, or chemical-genomic screen).';

        // Merge references without duplicate citations
        const mergedRefs = [...(existing.allReferences || [])];
        for (const ref of (item.allReferences || [])) {
          if (!mergedRefs.some(r => r.citation === ref.citation)) {
            mergedRefs.push(ref);
          }
        }

        // Prioritize classic reference for primary display
        const primaryRef = mergedRefs.find(r => r.studyType === 'classic') || mergedRefs[0];

        uniqueResultsMap.set(item.phenotype, {
          ...existing,
          studyType,
          studyTypeLabel,
          studyTypeDescription,
          hasClassic,
          hasHighThroughput,
          allReferences: mergedRefs,
          reference: primaryRef?.citation || existing.reference,
          pubmed_id: primaryRef?.pubmed_id || existing.pubmed_id,
          mutant_type: primaryRef?.allele && primaryRef.allele !== 'N/A' && primaryRef.allele !== 'Unknown' ? primaryRef.allele : existing.mutant_type
        });
      }
    }
    const uniqueResults = Array.from(uniqueResultsMap.values());
      
    // Sort so Classic Genetic Targeted Studies (and Both) are prioritized first
    return uniqueResults
      .sort((a, b) => {
        // Priority 1: Both > Classic > High-Throughput
        const priorityOrder: Record<string, number> = { 'both': 3, 'classic': 2, 'high-throughput': 1, 'unspecified': 0 };
        const pA = priorityOrder[a.studyType || ''] || 0;
        const pB = priorityOrder[b.studyType || ''] || 0;
        if (pA !== pB) return pB - pA;
        
        // Priority 2: Named mutant/allele availability over generic null
        const aHasAllele = a.mutant_type && !/(\u0394|delta|null|unknown)/i.test(a.mutant_type);
        const bHasAllele = b.mutant_type && !/(\u0394|delta|null|unknown)/i.test(b.mutant_type);
        if (aHasAllele && !bHasAllele) return -1;
        if (!aHasAllele && bHasAllele) return 1;

        // Priority 3: Alphabetical by phenotype name
        return a.phenotype.localeCompare(b.phenotype);
      });
  } catch (e) {
    console.warn("Phenotype fetch failed", e);
    return [];
  }
};

// --- Discordant Variants API Client ---
export interface DiscordantQueryParams {
  genes?: string | string[];
  type?: 'ALL' | 'BENIGN_AM_PATHOGENIC' | 'PATHOGENIC_AM_BENIGN' | 'RECURRENT_BENIGN';
  minStars?: number;
  minSubmissions?: number;
  onlyYeastHomologs?: boolean;
  minDioptScore?: number;
  minVariantsPerGene?: number;
  includePathogenic?: boolean;
  includeLikelyPathogenic?: boolean;
  includeBenign?: boolean;
  includeLikelyBenign?: boolean;
  searchQuery?: string;
  page?: number;
  pageSize?: number;
  sort?: 'delta_desc' | 'delta_asc' | 'gene_asc' | 'score_desc' | 'stars_desc' | 'submissions_desc' | 'gnomad_desc' | 'gnomad_asc';
  minAmPathScore?: number;
  maxAmBenignScore?: number;
  gnomadFilter?: 'ALL' | 'COMMON' | 'LOW_FREQUENCY' | 'RARE' | 'ULTRA_RARE';
}

export const fetchDiscordantVariants = async (params: DiscordantQueryParams = {}): Promise<DiscordantSearchResult> => {
  const response = await fetch('/api/discordant-variants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to fetch discordant variants');
  }
  return response.json();
};

// --- Protein Domains API Client ---
export const fetchProteinDomains = async (idOrSymbol: string, organism: 'human' | 'yeast' = 'human'): Promise<ProteinDomain[]> => {
  try {
    if (!idOrSymbol || idOrSymbol === 'N/A' || idOrSymbol === 'null') return [];
    const isId = /^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/i.test(idOrSymbol);
    const param = isId ? `id=${encodeURIComponent(idOrSymbol)}` : `symbol=${encodeURIComponent(idOrSymbol)}`;
    const orgParam = organism === 'yeast' ? '&organism=4932' : '&organism=9606';
    const response = await fetch(`/api/protein-domains?${param}${orgParam}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.domains || [];
  } catch (err) {
    console.warn("fetchProteinDomains error:", err);
    return [];
  }
};

// --- Post-Translational Modifications API Client ---
export const fetchProteinPtms = async (idOrSymbol: string, organism: 'human' | 'yeast' = 'human'): Promise<ProteinPtm[]> => {
  try {
    if (!idOrSymbol || idOrSymbol === 'N/A' || idOrSymbol === 'null') return [];
    const isId = /^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/i.test(idOrSymbol);
    const param = isId ? `id=${encodeURIComponent(idOrSymbol)}` : `symbol=${encodeURIComponent(idOrSymbol)}`;
    const orgParam = organism === 'yeast' ? '&organism=4932' : '&organism=9606';
    const response = await fetch(`/api/protein-ptms?${param}${orgParam}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.ptms || [];
  } catch (err) {
    console.warn("fetchProteinPtms error:", err);
    return [];
  }
};

// --- Functional Sites (Active, Metal, Ligand/Cofactor, SLiM Motifs) API Client ---
export const fetchFunctionalSites = async (idOrSymbol: string, organism: 'human' | 'yeast' = 'human'): Promise<FunctionalSite[]> => {
  try {
    if (!idOrSymbol || idOrSymbol === 'N/A' || idOrSymbol === 'null') return [];
    const isId = /^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/i.test(idOrSymbol);
    const param = isId ? `id=${encodeURIComponent(idOrSymbol)}` : `symbol=${encodeURIComponent(idOrSymbol)}`;
    const orgParam = organism === 'yeast' ? '&organism=4932' : '&organism=9606';
    const response = await fetch(`/api/protein-functional-sites?${param}${orgParam}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.sites || [];
  } catch (err) {
    console.warn("fetchFunctionalSites error:", err);
    return [];
  }
};

// --- BioGRID & PDBe-KB Protein Interfaces API Client ---
export const fetchProteinInterfaces = async (symbol: string, uniprotId?: string | null): Promise<ProteinInterfaceData | null> => {
  try {
    if (!symbol && !uniprotId) return null;
    const query = new URLSearchParams();
    if (symbol) query.append('symbol', symbol);
    if (uniprotId && uniprotId !== 'N/A') query.append('uniprotId', uniprotId);
    const response = await fetch(`/api/protein-interfaces?${query.toString()}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data;
  } catch (err) {
    console.warn("fetchProteinInterfaces error:", err);
    return null;
  }
};

