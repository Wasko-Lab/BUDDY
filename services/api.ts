
import { GeneInfo, OrthologInfo, SequenceRecord, Variant, Phenotype, CodingExon, DiscordantSearchResult, DiscordantVariant, ProteinDomain, ProteinPtm, FunctionalSite, ProteinInterfaceData, ProteinComplex, ComplexSearchResult, ComplexVariantRecord, ComplexVariantsResponse, ClinicianSubmissionInput, VariantConservationResult, ClinicianSubmissionRecord, ClinicianModelEvaluationParams, ClinicianModelEvaluationResponse } from '../types';
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
  const cleanSymbol = symbol.trim();
  // If input is all digits, treat as Entrez ID
  const isEntrezId = /^\d+$/.test(cleanSymbol);
  let url = `https://mygene.info/v3/query?q=${encodeURIComponent(cleanSymbol)}&scopes=symbol,alias&fields=symbol,entrezgene,name,uniprot,type_of_gene&species=human`;
  
  if (isEntrezId) {
    url = `https://mygene.info/v3/gene/${encodeURIComponent(cleanSymbol)}?fields=symbol,entrezgene,name,uniprot,type_of_gene`;
  }

  const response = await fetch(url);
  const data = await response.json();
  
  let hit;
  if (isEntrezId) {
    hit = data;
  } else {
    if (!data.hits || data.hits.length === 0) {
      throw new Error(`Human gene '${cleanSymbol}' not found in MyGene.info`);
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

// --- Alliance of Genome Resources (AGR) Yeast Gene Search ---
// Primary fallback for broad biological topics (e.g. "Aging", "Vacuole", "Autophagy") in Yeast
const searchYeastAlliance = async (term: string): Promise<any[]> => {
  try {
    const cleanTerm = term.trim();
    if (!cleanTerm) return [];

    // Strategy 1: Server proxy route /api/alliance/search
    let data: any = null;
    try {
      const proxyRes = await fetch(`/api/alliance/search?q=${encodeURIComponent(cleanTerm)}&species=${encodeURIComponent('Saccharomyces cerevisiae')}&limit=50`);
      if (proxyRes.ok) {
        data = await proxyRes.json();
      }
    } catch (proxyErr) {
      console.warn("Server proxy for Alliance search failed, trying direct query:", proxyErr);
    }

    // Strategy 2: Direct call to Alliance of Genome Resources search API
    if (!data || !data.results) {
      const url = `https://www.alliancegenome.org/api/search?q=${encodeURIComponent(cleanTerm)}&category=gene_search_result&species=Saccharomyces%20cerevisiae&limit=50`;
      const response = await fetch(url);
      if (response.ok) {
        data = await response.json();
      }
    }

    if (!data || !data.results || !Array.isArray(data.results) || data.results.length === 0) {
      return [];
    }

    const mappedGenes: any[] = [];
    const missingEntrez: string[] = [];

    for (const r of data.results) {
      const symbol = r.symbol || r.systematicName;
      if (!symbol) continue;

      let entrezId: string | null = null;
      let hasUniprot = false;

      if (Array.isArray(r.crossReferences)) {
        for (const xref of r.crossReferences) {
          if (typeof xref === 'string') {
            if (xref.startsWith('NCBI_Gene:')) {
              entrezId = xref.replace('NCBI_Gene:', '').trim();
            } else if (xref.startsWith('UniProtKB:')) {
              hasUniprot = true;
            }
          }
        }
      }

      const locusTag = r.systematicName || null;
      const name = r.geneDescription || r.automatedGeneDescription || r.name || 'Yeast Gene';

      if (entrezId) {
        mappedGenes.push({
          symbol,
          name,
          entrez_id: entrezId,
          locus_tag: locusTag,
          hasUniprot,
          type_of_gene: r.soTermName === 'protein_coding_gene' ? 'protein-coding' : r.soTermName
        });
      } else {
        missingEntrez.push(locusTag || symbol);
      }
    }

    // Resolve any hits lacking an NCBI_Gene cross-reference in batch via MyGene
    if (missingEntrez.length > 0 && mappedGenes.length < 25) {
      try {
        const mgUrl = `https://mygene.info/v3/query?q=${encodeURIComponent(missingEntrez.slice(0, 25).join(','))}&scopes=symbol,locus_tag&species=4932,559292&fields=symbol,name,entrezgene,uniprot,locus_tag,type_of_gene`;
        const mgResp = await fetch(mgUrl);
        if (mgResp.ok) {
          const mgData = await mgResp.json();
          const hits = Array.isArray(mgData) ? mgData : [];
          for (const hit of hits) {
            if (hit.entrezgene && !mappedGenes.some(g => g.entrez_id === hit.entrezgene.toString())) {
              mappedGenes.push({
                symbol: hit.symbol || hit.locus_tag || hit.query,
                name: hit.name || 'Yeast Gene',
                entrez_id: hit.entrezgene.toString(),
                locus_tag: hit.locus_tag || null,
                hasUniprot: !!hit.uniprot,
                type_of_gene: hit.type_of_gene
              });
            }
          }
        }
      } catch (mgErr) {
        console.warn("MyGene fallback lookup for Alliance genes failed", mgErr);
      }
    }

    return mappedGenes;
  } catch (e) {
    console.warn("Alliance of Genome Resources yeast search failed", e);
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

export const searchGenes = async (term: string, species: 'human' | 'yeast' = 'human'): Promise<{ symbol: string; name: string; entrez_id: string; locus_tag?: string | null; hasUniprot?: boolean; type_of_gene?: string }[]> => {
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

  // Strategy 5: Alliance of Genome Resources (AGR) Fallback
  // If we are searching yeast and still have no hits, query Alliance Genome directly.
  // This is crucial for broad terms like "Aging", "Vacuole", or "Autophagy" that may not match standard MyGene symbols.
  if (species === 'yeast' && (!data.hits || data.hits.length === 0)) {
      const yeastHits = await searchYeastAlliance(term);
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
    type_of_gene: hit.type_of_gene,
    locus_tag: hit.locus_tag || null
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
  const cleanId = (id || '').trim();
  if (!cleanId) {
    throw new Error('No sequence identifier provided');
  }

  const isPureNumber = /^\d+$/.test(cleanId);
  const isSgdId = cleanId.startsWith('SGD:') || /^S\d+$/i.test(cleanId);
  // UniProt accession format: e.g. P12345, Q9Y261, P43246
  const isUniProtAcc = /^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/i.test(cleanId);
  
  const urlsToTry: string[] = [];

  if (isYeast) {
    if (isUniProtAcc) {
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/${cleanId}.fasta`);
    }

    if (isSgdId) {
      const bareSgd = cleanId.replace(/^SGD:/i, '').trim();
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/search?query=xref:sgd-${bareSgd}&format=fasta&size=1`);
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${bareSgd}+AND+organism_id:559292&format=fasta&size=1`);
    } else if (isPureNumber) {
      // Yeast Entrez ID (e.g. 854063 for MSH2)
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/search?query=xref:geneid-${cleanId}+AND+organism_id:559292&format=fasta&size=1`);
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/search?query=xref:geneid-${cleanId}+AND+taxonomy_id:4932&format=fasta&size=1`);
    } else {
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${cleanId}+AND+organism_id:559292+AND+reviewed:true&format=fasta&size=1`);
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${cleanId}+AND+organism_id:559292&format=fasta&size=1`);
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${cleanId}+AND+taxonomy_id:4932&format=fasta&size=1`);
    }
  } else {
    // Human
    if (isUniProtAcc) {
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/${cleanId}.fasta`);
    }

    if (isPureNumber) {
      // NCBI Entrez Gene ID (e.g. 4436 for MSH2, 7157 for TP53)
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/search?query=xref:geneid-${cleanId}+AND+organism_id:9606+AND+reviewed:true&format=fasta&size=1`);
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/search?query=xref:geneid-${cleanId}+AND+organism_id:9606&format=fasta&size=1`);
    } else {
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${cleanId}+AND+organism_id:9606+AND+reviewed:true&format=fasta&size=1`);
      urlsToTry.push(`https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${cleanId}+AND+organism_id:9606&format=fasta&size=1`);
    }
  }

  let lastStatus = 0;
  for (const url of urlsToTry) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        lastStatus = response.status;
        continue;
      }
      const text = await response.text();
      if (!text || !text.trim()) {
        continue;
      }
      const lines = text.trim().split('\n');
      const description = lines[0];
      const seq = lines.slice(1).join('').trim();
      if (seq.length > 0) {
        return { id: cleanId, description, seq };
      }
    } catch (e: any) {
      console.warn(`Fetch sequence attempt failed for url ${url}:`, e?.message);
    }
  }

  // Fallback 1: Resolve UniProt accession via MyGene.info if an ID or symbol was passed
  try {
    const mgQueryUrl = isPureNumber
      ? `https://mygene.info/v3/gene/${cleanId}?fields=uniprot,symbol`
      : `https://mygene.info/v3/query?q=${encodeURIComponent(cleanId)}&species=${isYeast ? '4932,559292' : '9606'}&fields=uniprot,symbol`;
    
    const mgRes = await fetch(mgQueryUrl);
    if (mgRes.ok) {
      const mgData = await mgRes.json();
      const targetHit = isPureNumber ? mgData : (mgData.hits && mgData.hits[0]);
      let resolvedAcc: string | null = null;
      if (targetHit?.uniprot) {
        if (typeof targetHit.uniprot === 'string') {
          resolvedAcc = targetHit.uniprot;
        } else if (targetHit.uniprot['Swiss-Prot']) {
          resolvedAcc = Array.isArray(targetHit.uniprot['Swiss-Prot'])
            ? targetHit.uniprot['Swiss-Prot'][0]
            : targetHit.uniprot['Swiss-Prot'];
        } else if (targetHit.uniprot['TrEMBL']) {
          resolvedAcc = Array.isArray(targetHit.uniprot['TrEMBL'])
            ? targetHit.uniprot['TrEMBL'][0]
            : targetHit.uniprot['TrEMBL'];
        }
      }

      if (resolvedAcc) {
        const fallbackFastUrl = `https://rest.uniprot.org/uniprotkb/${resolvedAcc}.fasta`;
        const fbRes = await fetch(fallbackFastUrl);
        if (fbRes.ok) {
          const fbText = await fbRes.text();
          if (fbText && fbText.trim()) {
            const lines = fbText.trim().split('\n');
            const description = lines[0];
            const seq = lines.slice(1).join('').trim();
            if (seq.length > 0) {
              return { id: resolvedAcc, description, seq };
            }
          }
        }
      }
    }
  } catch (mgErr: any) {
    console.warn("MyGene fallback lookup in fetchSequence failed:", mgErr?.message);
  }

  throw new Error(`Failed to fetch sequence for ${id} (Status: ${lastStatus || 404})`);
};

// --- MyVariant.info ---
export interface ClinVarQueryOptions {
  excludeUncertain?: boolean;
  excludeConflicting?: boolean;
  minStars?: number;
  conflictingPathBenignOnly?: boolean;
}

export interface ClinVarConflictResolution {
  variantId: string;
  hasPathogenic: boolean;
  hasLikelyPathogenic: boolean;
  hasBenign: boolean;
  hasLikelyBenign: boolean;
  hasVus: boolean;
  isPathBenignConflict: boolean;
  classifications: string[];
}

const conflictResolutionCache = new Map<string, ClinVarConflictResolution>();

/**
 * Resolves individual submitter clinical classifications for ClinVar Variation IDs
 * via NCBI ClinVar Variation Archive (VCV) XML.
 * Accurately determines if a conflicting variant has entries as BOTH
 * (Pathogenic OR Likely Pathogenic) AND (Benign OR Likely Benign),
 * strictly separating major clinical conflicts from benign + VUS conflicts.
 */
export const resolveClinVarConflictingSubmissions = async (
  variantIds: (number | string)[]
): Promise<Map<string, ClinVarConflictResolution>> => {
  const results = new Map<string, ClinVarConflictResolution>();
  if (!variantIds || variantIds.length === 0) return results;

  const toFetch: string[] = [];
  for (const rawId of variantIds) {
    const idStr = String(rawId).trim();
    if (!idStr) continue;
    if (conflictResolutionCache.has(idStr)) {
      results.set(idStr, conflictResolutionCache.get(idStr)!);
    } else {
      toFetch.push(idStr);
    }
  }

  if (toFetch.length === 0) return results;

  // Batch in chunks of 25 to avoid URL length constraints while maximizing speed
  const chunkSize = 25;
  for (let i = 0; i < toFetch.length; i += chunkSize) {
    const chunk = toFetch.slice(i, i + chunkSize);
    try {
      const vcvIds = chunk.map(id => `VCV${id.padStart(9, '0')}`).join(',');
      const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=clinvar&rettype=vcv&id=${vcvIds}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      const archives = text.match(/<VariationArchive[^>]*>[\s\S]*?<\/VariationArchive>/g) || [];
      for (const arch of archives) {
        const idMatch = arch.match(/VariationID="(\d+)"/);
        if (!idMatch) continue;
        const varId = idMatch[1];
        const classifications = [...arch.matchAll(/<Classification[^>]*>[\s\S]*?<GermlineClassification[^>]*>([^<]+)<\/GermlineClassification>/g)]
          .map(m => m[1].toLowerCase().trim());

        const hasExactPathogenic = classifications.some(c => (c === 'pathogenic' || c.startsWith('pathogenic') || c === 'pathogenic/likely pathogenic') && !c.startsWith('likely pathogenic'));
        const hasLikelyPathogenic = classifications.some(c => c.includes('likely pathogenic'));
        const hasExactBenign = classifications.some(c => (c === 'benign' || c.startsWith('benign') || c === 'benign/likely benign') && !c.startsWith('likely benign'));
        const hasLikelyBenign = classifications.some(c => c.includes('likely benign'));
        const hasVus = classifications.some(c => c.includes('uncertain'));

        const hasPathogenicAssertion = hasExactPathogenic || hasLikelyPathogenic;
        const hasBenignAssertion = hasExactBenign || hasLikelyBenign;
        const isPathBenignConflict = hasPathogenicAssertion && hasBenignAssertion;

        const record: ClinVarConflictResolution = {
          variantId: varId,
          hasPathogenic: hasExactPathogenic,
          hasLikelyPathogenic,
          hasBenign: hasExactBenign,
          hasLikelyBenign,
          hasVus,
          isPathBenignConflict,
          classifications
        };
        conflictResolutionCache.set(varId, record);
        results.set(varId, record);
      }
    } catch (e) {
      console.warn('[resolveClinVarConflictingSubmissions] Batch query error:', e);
    }
  }

  return results;
};

export const fetchClinVarVariants = async (
  geneSymbol: string, 
  significanceTerms: string[] = [],
  options: ClinVarQueryOptions = {}
): Promise<any[]> => {
  // If user requests conflicting variants with BOTH Pathogenic and Benign submissions:
  if (options.conflictingPathBenignOnly) {
    const fields = 'clinvar,dbsnp,dbnsfp,gnomad_exome,gnomad_genome,hg19,hg38';
    // 1. Direct multi-RCV hits where both Pathogenic and Benign appear across RCV entries
    const directQuery = `clinvar.gene.symbol:${geneSymbol} AND (clinvar.rcv.clinical_significance:"Pathogenic" OR clinvar.rcv.clinical_significance:"Likely pathogenic") AND (clinvar.rcv.clinical_significance:"Benign" OR clinvar.rcv.clinical_significance:"Likely benign")`;
    // 2. Conflicting interpretations hits to resolve via NCBI VCV submission records
    const conflictQuery = `clinvar.gene.symbol:${geneSymbol} AND clinvar.rcv.clinical_significance:"Conflicting interpretations of pathogenicity"`;

    try {
      const [directRes, conflictRes] = await Promise.all([
        fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(directQuery)}&fields=${fields}&size=500`).then(r => r.json()).catch(() => ({ hits: [] })),
        fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(conflictQuery)}&fields=${fields}&size=200`).then(r => r.json()).catch(() => ({ hits: [] }))
      ]);

      const directHits = directRes?.hits || [];
      const conflictHits = conflictRes?.hits || [];

      // Extract variant IDs from conflict hits to resolve via NCBI VCV assertions
      const conflictIds = conflictHits.map((h: any) => h.clinvar?.variant_id).filter(Boolean);
      const resolvedMap = await resolveClinVarConflictingSubmissions(conflictIds);

      const hitsMap = new Map<string, any>();
      for (const h of directHits) {
        if (h?._id) hitsMap.set(h._id, h);
      }
      for (const h of conflictHits) {
        const vid = String(h.clinvar?.variant_id || '');
        const resolution = resolvedMap.get(vid);
        if (resolution?.isPathBenignConflict) {
          h._conflictResolution = resolution;
          if (h?._id) hitsMap.set(h._id, h);
        }
      }
      return Array.from(hitsMap.values());
    } catch (err) {
      console.warn('[fetchClinVarVariants] conflictingPathBenignOnly fetch error:', err);
    }
  }

  // Request clinvar, dbsnp AND dbnsfp (for AlphaMissense scores), and gnomAD data
  let sigQuery = "";
  if (significanceTerms.length > 0) {
    sigQuery = `(${significanceTerms.map(s => `clinvar.rcv.clinical_significance:"${s}"`).join(" OR ")})`;
  } else {
    sigQuery = `clinvar.rcv.clinical_significance:"Uncertain significance"`;
  }

  // If uncertain is not requested or explicitly excluded, strictly negate it from MyVariant query (unless in conflictingPathBenignOnly mode)
  if (!options.conflictingPathBenignOnly) {
    const shouldExcludeUncertain = options.excludeUncertain ?? (!significanceTerms.some(s => s.toLowerCase().includes('uncertain')));
    if (shouldExcludeUncertain) {
      sigQuery += ` AND -clinvar.rcv.clinical_significance:"Uncertain significance"`;
    }

    // If conflicting is not requested or explicitly excluded, negate it as well
    const shouldExcludeConflicting = options.excludeConflicting ?? (!significanceTerms.some(s => s.toLowerCase().includes('conflicting')));
    if (shouldExcludeConflicting) {
      sigQuery += ` AND -clinvar.rcv.clinical_significance:"Conflicting interpretations of pathogenicity" AND -clinvar.clinical_significance:"Conflicting interpretations of pathogenicity" AND -clinvar.rcv.review_status:"criteria provided, conflicting interpretations"`;
    }
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

/**
 * Fetches all ClinVar variants across all clinical significance classifications
 * (Pathogenic, Likely Pathogenic, VUS, Conflicting, Likely Benign, Benign)
 * along with AlphaMissense (dbNSFP) scores and gnomAD frequencies.
 * 
 * Partitions queries across clinical classifications and runs them in parallel.
 * This prevents high-count categories (like Pathogenic or Conflicting interpretations)
 * from consuming Elasticsearch's 1,000-hit per-query limit and starving out Benign,
 * Likely Benign, or VUS variants in well-studied genes with thousands of entries (e.g., MSH2, TP53, BRCA1).
 */
export const fetchAllClinVarVariants = async (geneSymbol: string): Promise<any[]> => {
  const fields = 'clinvar,dbsnp,dbnsfp,gnomad_exome,gnomad_genome,hg19,hg38';
  
  const queryTier = async (termQuery: string, size = 1000): Promise<any[]> => {
    try {
      const q = `clinvar.gene.symbol:${geneSymbol} AND ${termQuery}`;
      const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(q)}&fields=${fields}&size=${size}`;
      const response = await fetch(url);
      if (!response.ok) return [];
      const data = await response.json();
      return data.hits || [];
    } catch (e) {
      console.warn(`[fetchAllClinVarVariants] Tier query failed for ${termQuery}:`, e);
      return [];
    }
  };

  const results = await Promise.all([
    queryTier('(clinvar.rcv.clinical_significance:"Pathogenic" OR clinvar.rcv.clinical_significance:"Likely pathogenic")'),
    queryTier('(clinvar.rcv.clinical_significance:"Benign" OR clinvar.rcv.clinical_significance:"Likely benign")'),
    queryTier('clinvar.rcv.clinical_significance:"Uncertain significance"'),
    queryTier('clinvar.rcv.clinical_significance:"Conflicting interpretations of pathogenicity"')
  ]);

  const seenIds = new Set<string>();
  const merged: any[] = [];
  for (const tierHits of results) {
    for (const hit of tierHits) {
      if (hit?._id && !seenIds.has(hit._id)) {
        seenIds.add(hit._id);
        merged.push(hit);
      }
    }
  }
  return merged;
};

/**
 * Directly looks up a specific variant residue position in a gene to retrieve
 * its exact AlphaMissense score, AlphaMissense prediction, ClinVar clinical significance,
 * review stars, and gnomAD population frequency.
 */
export const fetchSpecificVariantDetails = async (
  geneSymbol: string,
  parsedPos: number,
  parsedRef?: string,
  parsedTarget?: string
): Promise<{
  amScore: number | null;
  amPred: string | null;
  clinicalSignificance: string;
  clinVarStars: number;
  gnomadAf: number | null;
  rsid: string | null;
  variantId: string | null;
  found: boolean;
}> => {
  const emptyResult = {
    amScore: null,
    amPred: null,
    clinicalSignificance: 'Uncertain significance',
    clinVarStars: 0,
    gnomadAf: null,
    rsid: null,
    variantId: null,
    found: false
  };

  try {
    const cleanGene = geneSymbol.trim().toUpperCase();
    if (!cleanGene || !parsedPos) return emptyResult;

    const query = `clinvar.gene.symbol:${cleanGene} AND (clinvar.rcv.preferred_name:*${parsedPos}* OR dbnsfp.hgvsp:*${parsedPos}* OR dbnsfp.aa.pos:${parsedPos})`;
    const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(query)}&fields=clinvar,dbnsfp,gnomad_exome,gnomad_genome,dbsnp&size=50`;
    
    const res = await fetch(url);
    if (!res.ok) return emptyResult;
    const data = await res.json();
    const hits: any[] = data.hits || [];

    if (hits.length === 0) return emptyResult;

    // Helper to calculate ClinVar stars from review status string
    const getStars = (status?: string): number => {
      if (!status) return 0;
      const s = status.toLowerCase();
      if (s.includes('practice guideline')) return 4;
      if (s.includes('reviewed by expert panel')) return 3;
      if (s.includes('multiple submitters') && !s.includes('conflicting')) return 2;
      if (s.includes('single submitter') || s.includes('criteria provided')) return 1;
      return 0;
    };

    // Find best matching hit
    let bestHit: any = null;
    for (const h of hits) {
      const dbnsfpEntry = Array.isArray(h.dbnsfp) ? h.dbnsfp[0] : h.dbnsfp;
      const aaAlt = dbnsfpEntry?.aa?.alt;
      const aaRef = dbnsfpEntry?.aa?.ref;
      const aaPosList = dbnsfpEntry?.aa?.pos;
      const posMatch = Array.isArray(aaPosList) ? aaPosList.includes(parsedPos) : aaPosList === parsedPos;

      const clinEntry = Array.isArray(h.clinvar) ? h.clinvar[0] : h.clinvar;
      const prefName = String(clinEntry?.rcv?.[0]?.preferred_name || clinEntry?.rcv?.preferred_name || '');
      const hgvsProt = clinEntry?.hgvs?.protein;
      const protList = Array.isArray(hgvsProt) ? hgvsProt : [hgvsProt];

      const matchesTarget = parsedTarget ? (
        (Array.isArray(aaAlt) ? aaAlt.includes(parsedTarget) : aaAlt === parsedTarget) ||
        prefName.includes(parsedTarget) ||
        protList.some((p: any) => String(p).includes(parsedTarget))
      ) : true;

      if (posMatch && matchesTarget) {
        bestHit = h;
        break;
      }
      if (prefName.includes(String(parsedPos)) && matchesTarget) {
        bestHit = h;
        break;
      }
      if (!bestHit && (posMatch || prefName.includes(String(parsedPos)))) {
        bestHit = h;
      }
    }

    if (!bestHit) bestHit = hits[0];

    // Extract AlphaMissense score
    const dbnsfp = Array.isArray(bestHit.dbnsfp) ? bestHit.dbnsfp[0] : bestHit.dbnsfp;
    let amScore: number | null = null;
    let amPred: string | null = null;

    if (dbnsfp?.alphamissense?.score !== undefined) {
      const raw = dbnsfp.alphamissense.score;
      const parsedVal = parseFloat(Array.isArray(raw) ? raw[0] : raw);
      if (!isNaN(parsedVal)) amScore = Math.round(parsedVal * 1000) / 1000;
    }

    if (dbnsfp?.alphamissense?.pred) {
      const rawPred = Array.isArray(dbnsfp.alphamissense.pred) ? dbnsfp.alphamissense.pred[0] : dbnsfp.alphamissense.pred;
      if (rawPred === 'P') amPred = 'Likely Pathogenic';
      else if (rawPred === 'B') amPred = 'Likely Benign';
      else if (rawPred === 'A') amPred = 'Ambiguous';
      else amPred = String(rawPred);
    } else if (amScore !== null) {
      if (amScore >= 0.56) amPred = 'Likely Pathogenic';
      else if (amScore <= 0.34) amPred = 'Likely Benign';
      else amPred = 'Ambiguous';
    }

    // Extract ClinVar Clinical Significance
    const clinvar = Array.isArray(bestHit.clinvar) ? bestHit.clinvar[0] : bestHit.clinvar;
    const rcv = Array.isArray(clinvar?.rcv) ? clinvar.rcv[0] : clinvar?.rcv;
    const clnSig = rcv?.clinical_significance || clinvar?.clinical_significance || 'Uncertain significance';
    const stars = getStars(rcv?.review_status);

    // Population frequency
    let gnomadAf: number | null = null;
    const exomeAf = bestHit.gnomad_exome?.af?.af;
    const genomeAf = bestHit.gnomad_genome?.af?.af;
    if (exomeAf !== undefined) gnomadAf = typeof exomeAf === 'number' ? exomeAf : parseFloat(exomeAf);
    else if (genomeAf !== undefined) gnomadAf = typeof genomeAf === 'number' ? genomeAf : parseFloat(genomeAf);

    const rsid = bestHit.clinvar?.rsid || bestHit.dbsnp?.rsid || null;
    const variantId = bestHit.clinvar?.variant_id ? String(bestHit.clinvar.variant_id) : null;

    return {
      amScore,
      amPred,
      clinicalSignificance: clnSig,
      clinVarStars: stars,
      gnomadAf,
      rsid,
      variantId,
      found: true
    };
  } catch (err) {
    console.warn('[fetchSpecificVariantDetails] error:', err);
    return emptyResult;
  }
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
export const fetchProteinDomains = async (idOrSymbol: string, organism: 'human' | 'yeast' = 'human', fallbackSymbol?: string): Promise<ProteinDomain[]> => {
  try {
    if (!idOrSymbol || idOrSymbol === 'N/A' || idOrSymbol === 'null') return [];
    const cleanId = idOrSymbol.split('-')[0].trim();
    const isId = /^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/i.test(cleanId);
    const query = new URLSearchParams();
    if (isId) {
      query.append('id', cleanId);
      if (fallbackSymbol && fallbackSymbol !== 'N/A') query.append('symbol', fallbackSymbol);
    } else {
      query.append('symbol', idOrSymbol.trim());
    }
    query.append('organism', organism === 'yeast' ? '4932' : '9606');
    const response = await fetch(`/api/protein-domains?${query.toString()}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.domains || [];
  } catch (err) {
    console.warn("fetchProteinDomains error:", err);
    return [];
  }
};

// --- Post-Translational Modifications API Client ---
export const fetchProteinPtms = async (idOrSymbol: string, organism: 'human' | 'yeast' = 'human', fallbackSymbol?: string): Promise<ProteinPtm[]> => {
  try {
    if (!idOrSymbol || idOrSymbol === 'N/A' || idOrSymbol === 'null') return [];
    const cleanId = idOrSymbol.split('-')[0].trim();
    const isId = /^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/i.test(cleanId);
    const query = new URLSearchParams();
    if (isId) {
      query.append('id', cleanId);
      if (fallbackSymbol && fallbackSymbol !== 'N/A') query.append('symbol', fallbackSymbol);
    } else {
      query.append('symbol', idOrSymbol.trim());
    }
    query.append('organism', organism === 'yeast' ? '4932' : '9606');
    const response = await fetch(`/api/protein-ptms?${query.toString()}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.ptms || [];
  } catch (err) {
    console.warn("fetchProteinPtms error:", err);
    return [];
  }
};

// --- Functional Sites (Active, Metal, Ligand/Cofactor, SLiM Motifs) API Client ---
export const fetchFunctionalSites = async (idOrSymbol: string, organism: 'human' | 'yeast' = 'human', fallbackSymbol?: string): Promise<FunctionalSite[]> => {
  try {
    if (!idOrSymbol || idOrSymbol === 'N/A' || idOrSymbol === 'null') return [];
    const cleanId = idOrSymbol.split('-')[0].trim();
    const isId = /^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/i.test(cleanId);
    const query = new URLSearchParams();
    if (isId) {
      query.append('id', cleanId);
      if (fallbackSymbol && fallbackSymbol !== 'N/A') query.append('symbol', fallbackSymbol);
    } else {
      query.append('symbol', idOrSymbol.trim());
    }
    query.append('organism', organism === 'yeast' ? '4932' : '9606');
    const response = await fetch(`/api/protein-functional-sites?${query.toString()}`);
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
    if (symbol && symbol !== 'N/A') query.append('symbol', symbol.trim());
    if (uniprotId && uniprotId !== 'N/A' && uniprotId !== 'null') {
      const cleanId = uniprotId.split('-')[0].trim();
      query.append('uniprotId', cleanId);
    }
    const response = await fetch(`/api/protein-interfaces?${query.toString()}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data;
  } catch (err) {
    console.warn("fetchProteinInterfaces error:", err);
    return null;
  }
};

// --- Protein Complexes (Complex Portal) API Clients ---
export const searchProteinComplexes = async (params: {
  q?: string;
  species?: 'all' | 'human' | 'yeast';
  assembly?: string;
  page?: number;
  pageSize?: number;
}): Promise<ComplexSearchResult> => {
  try {
    const query = new URLSearchParams();
    if (params.q) query.append('q', params.q.trim());
    if (params.species && params.species !== 'all') query.append('species', params.species);
    if (params.assembly && params.assembly !== 'all') query.append('assembly', params.assembly);
    if (params.page) query.append('page', String(params.page));
    if (params.pageSize) query.append('pageSize', String(params.pageSize));

    const res = await fetch(`/api/complexes/search?${query.toString()}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch complexes: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    console.warn("searchProteinComplexes error:", err);
    return {
      total: 0,
      returned: 0,
      page: 1,
      pageSize: 20,
      complexes: [],
      assemblyCounts: {},
      speciesCounts: { human: 0, yeast: 0 }
    };
  }
};

export const fetchGeneComplexes = async (gene: string): Promise<ProteinComplex[]> => {
  try {
    if (!gene || gene === 'N/A' || gene === 'null') return [];
    const res = await fetch(`/api/complexes/gene/${encodeURIComponent(gene.trim())}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.complexes || [];
  } catch (err) {
    console.warn("fetchGeneComplexes error:", err);
    return [];
  }
};

export const fetchComplexById = async (complexId: string): Promise<ProteinComplex | null> => {
  try {
    if (!complexId) return null;
    const res = await fetch(`/api/complexes/${encodeURIComponent(complexId.trim())}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("fetchComplexById error:", err);
    return null;
  }
};

export const fetchComplexVariants = async (complexId: string): Promise<ComplexVariantsResponse | null> => {
  try {
    if (!complexId) return null;
    const res = await fetch(`/api/complexes/${encodeURIComponent(complexId.trim())}/variants`);
    if (!res.ok) {
      throw new Error(`Failed to load complex variants: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    console.warn("fetchComplexVariants error:", err);
    return null;
  }
};

// --- Clinician Variant Submission Portal API Client ---
export const submitClinicianVariant = async (payload: ClinicianSubmissionInput & { conservation: VariantConservationResult }): Promise<{
  success: boolean;
  submissionId: string;
  recipientEmail: string;
  emailSent: boolean;
  emailError?: string;
  mailtoUrl: string;
  record: ClinicianSubmissionRecord;
}> => {
  const response = await fetch('/api/clinician-submission', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Submission failed with status ${response.status}`);
  }
  return await response.json();
};

export const evaluateClinicianVariantModel = async (
  params: ClinicianModelEvaluationParams
): Promise<ClinicianModelEvaluationResponse> => {
  const response = await fetch('/api/clinician-model-evaluation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Evaluation request failed with status ${response.status}`);
  }
  return await response.json();
};




