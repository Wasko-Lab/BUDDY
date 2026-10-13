import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import Database from 'better-sqlite3';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';

interface TsvRecord {
  Gene_Name: string;
  Experiment_Type: string;
  Mutant_Type: string;
  Phenotype: string;
  Chemical: string;
  Condition: string;
  Details: string;
  [key: string]: string;
}

let db: any = null;
try {
  const dbPath = path.join(process.cwd(), 'sgd_phenotypes.db');
  if (fs.existsSync(dbPath)) {
    db = new Database(dbPath, { readonly: true });
    console.log("Local SQLite database connected.");
  } else {
    console.log("Local SQLite database not found, skipping local DB initialization.");
  }
} catch (error) {
  console.error("Failed to initialize SQLite database. Local queries will be disabled.", error);
}

let tsvDb: TsvRecord[] | null = null;
try {
  // Support both lowercase 'data' and uppercase 'Data' folder casing
  const possiblePaths = [
    path.join(process.cwd(), 'data', 'SGDphenotypes.tsv'),
    path.join(process.cwd(), 'Data', 'SGDphenotypes.tsv')
  ];
  const tsvPath = possiblePaths.find(p => fs.existsSync(p));

  if (tsvPath) {
    const fileContent = fs.readFileSync(tsvPath, 'utf-8');
    const lines = fileContent.split(/\r?\n/);
    if (lines.length > 1) {
      const headers = lines[0].split('\t').map(h => h.trim());
      tsvDb = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const vals = lines[i].split('\t');
        const record: any = {};
        for (let j = 0; j < headers.length; j++) {
          let val = vals[j] ? vals[j].trim() : '';
          val = val.replace(/^"+|"+$/g, '').trim(); // Remove wrapping quotes
          record[headers[j] || `col_${j}`] = val;
        }
        tsvDb.push(record as TsvRecord);
      }
      console.log(`Loaded ${tsvDb.length} backup records from ${tsvPath}`);
    }
  } else {
    console.log("Backup TSV database (data/SGDphenotypes.tsv) not found.");
  }
} catch (error) {
  console.error("Failed to load TSV database.", error);
}

// In-memory orthology mapping for Discordant Variant search and Complex subunit mapping
const orthologMap = new Map<string, { symbol: string; dioptScore: number }>();
const yeastToHumanOrthologMap = new Map<string, string[]>();
try {
  const orthPath = path.join(process.cwd(), 'data', 'YeastHuman_Orthologs_Summary.tsv');
  if (fs.existsSync(orthPath)) {
    const content = fs.readFileSync(orthPath, 'utf-8');
    const lines = content.split(/\r?\n/).slice(1);
    for (const line of lines) {
      if (!line.trim()) continue;
      const [h, y, sc] = line.split('\t');
      if (!h || !y) continue;
      const hUpper = h.trim().toUpperCase();
      const yUpper = y.trim().toUpperCase();
      const score = parseInt(sc || '0', 10);
      if (!orthologMap.has(hUpper) || (orthologMap.get(hUpper)?.dioptScore ?? 0) < score) {
        orthologMap.set(hUpper, { symbol: yUpper, dioptScore: score });
      }
      if (!yeastToHumanOrthologMap.has(yUpper)) {
        yeastToHumanOrthologMap.set(yUpper, []);
      }
      const existing = yeastToHumanOrthologMap.get(yUpper)!;
      if (!existing.includes(hUpper)) existing.push(hUpper);
    }
    console.log(`Loaded ${orthologMap.size} yeast-human ortholog mappings and ${yeastToHumanOrthologMap.size} reverse mappings.`);
  }
} catch (e) {
  console.warn("Failed to load ortholog summary TSV in server.ts:", e);
}

// --- Complex Portal Database & Indexing ---
interface ComplexParticipantRecord {
  identifier: string;
  symbol: string;
  stoichiometry: number;
  allGeneNames?: string[];
}

interface ProteinComplexRecord {
  complexId: string;
  name: string;
  aliases: string[];
  taxonomyId: string;
  species: 'human' | 'yeast';
  assembly: string;
  assemblyCategory: 'Dimer' | 'Trimer' | 'Tetramer' | 'Pentamer' | 'Hexamer' | 'Heptamer' | 'Octamer' | 'Multimer' | 'Other';
  totalSubunits: number;
  distinctSubunits: number;
  participants: ComplexParticipantRecord[];
  description: string;
  properties: string;
  goAnnotations: string[];
  crossReferences: string[];
  evidence: string;
}

const allComplexes: ProteinComplexRecord[] = [];
const complexGeneIndex = new Map<string, ProteinComplexRecord[]>();
const complexIdMap = new Map<string, ProteinComplexRecord>();

function categorizeAssembly(assembly: string, totalSubunits: number): 'Dimer' | 'Trimer' | 'Tetramer' | 'Pentamer' | 'Hexamer' | 'Heptamer' | 'Octamer' | 'Multimer' | 'Other' {
  const norm = (assembly || '').toLowerCase().trim();
  if (norm.includes('dimer') || totalSubunits === 2) return 'Dimer';
  if (norm.includes('trimer') || totalSubunits === 3) return 'Trimer';
  if (norm.includes('tetramer') || norm.includes('teramer') || totalSubunits === 4) return 'Tetramer';
  if (norm.includes('pentamer') || totalSubunits === 5) return 'Pentamer';
  if (norm.includes('hexamer') || totalSubunits === 6) return 'Hexamer';
  if (norm.includes('heptamer') || totalSubunits === 7) return 'Heptamer';
  if (norm.includes('octamer') || norm.includes('octomer') || totalSubunits === 8) return 'Octamer';
  if (norm.includes('dodecamer') || norm.includes('nonamer') || norm.includes('decamer') || norm.includes('oligomer') || norm.includes('-mer') || norm.includes(' mer') || totalSubunits > 8) return 'Multimer';
  return 'Other';
}

try {
  let proteinSymbolsMap: Record<string, any> = {};
  const mapPath = path.join(process.cwd(), 'data', 'complex_protein_symbols.json');
  if (fs.existsSync(mapPath)) {
    proteinSymbolsMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
  }

  function parseComplexesFile(fname: string, species: 'human' | 'yeast', taxId: string) {
    const filePath = path.join(process.cwd(), 'data', fname);
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
    const records: ProteinComplexRecord[] = [];
    for (const line of lines) {
      const cols = line.split('\t');
      const complexId = cols[0]?.trim();
      if (!complexId) continue;
      const name = cols[1]?.trim() || '';
      const aliases = cols[2] && cols[2] !== '-' ? cols[2].split('|').map(s => s.trim()) : [];
      const rawParticipants = cols[4] || '';
      const parts = rawParticipants.split('|');
      const participants: ComplexParticipantRecord[] = [];
      let totalSubunits = 0;
      for (const p of parts) {
        const m = p.match(/^([A-Za-z0-9_-]+)(?:\((\d+)\))?$/);
        if (m) {
          const id = m[1];
          const stoich = parseInt(m[2] || '0', 10);
          totalSubunits += stoich;
          const entry = proteinSymbolsMap[id];
          participants.push({
            identifier: id,
            symbol: entry?.symbol || id,
            allGeneNames: entry?.allGenes || [],
            stoichiometry: stoich
          });
        }
      }
      const rawAssembly = cols[11]?.trim() || '-';
      const effectiveSubunits = totalSubunits > 0 ? totalSubunits : participants.length;
      let assembly = rawAssembly !== '-' ? rawAssembly : '';
      if (!assembly || assembly === '-') {
        if (effectiveSubunits === 2) assembly = participants.length === 1 ? 'Homodimer' : 'Heterodimer';
        else if (effectiveSubunits === 3) assembly = participants.length === 1 ? 'Homotrimer' : 'Heterotrimer';
        else if (effectiveSubunits === 4) assembly = participants.length === 1 ? 'Homotetramer' : 'Heterotetramer';
        else if (effectiveSubunits === 5) assembly = 'Heteropentamer';
        else if (effectiveSubunits === 6) assembly = 'Heterohexamer';
        else if (effectiveSubunits > 6) assembly = 'Heteromultimer';
        else assembly = '-';
      }
      const assemblyCat = categorizeAssembly(assembly, effectiveSubunits);
      
      const record: ProteinComplexRecord = {
        complexId,
        name,
        aliases,
        taxonomyId: taxId,
        species,
        assembly,
        assemblyCategory: assemblyCat,
        totalSubunits: effectiveSubunits,
        distinctSubunits: participants.length,
        participants,
        description: cols[9]?.trim() || '',
        properties: cols[10]?.trim() || '',
        goAnnotations: cols[7] && cols[7] !== '-' ? cols[7].split('|').map(s => s.trim()) : [],
        crossReferences: cols[8] && cols[8] !== '-' ? cols[8].split('|').map(s => s.trim()) : [],
        evidence: cols[5]?.trim() || ''
      };
      records.push(record);
    }
    return records;
  }

  const yeast = parseComplexesFile('YeastCOMPLEXportal559292.tsv', 'yeast', '559292');
  const human = parseComplexesFile('HumanCOMPLEXportal9606.tsv', 'human', '9606');
  allComplexes.push(...human, ...yeast);

  for (const c of allComplexes) {
    complexIdMap.set(c.complexId.toUpperCase(), c);
    for (const p of c.participants) {
      const keys = new Set([
        p.symbol.toUpperCase(),
        ...(p.allGeneNames || []).map(g => g.toUpperCase()),
        p.identifier.toUpperCase()
      ]);
      for (const k of keys) {
        if (!complexGeneIndex.has(k)) complexGeneIndex.set(k, []);
        complexGeneIndex.get(k)!.push(c);
      }
    }
  }

  console.log(`Loaded ${allComplexes.length} Protein Complexes (Human: ${human.length}, Yeast: ${yeast.length}). Indexed ${complexGeneIndex.size} gene symbols/identifiers.`);
} catch (e) {
  console.warn("Failed to load Complex Portal TSVs:", e);
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1); // Trust the reverse proxy
  const PORT = 3000;

  // Increase payload limit for base64 structure images
  app.use(express.json({ limit: '50mb' }));
  
  // Helper to dynamically load env file if present (.env or .env.local)
  const loadLocalEnv = () => {
    try {
      if (fs.existsSync('.env.local')) {
        process.loadEnvFile('.env.local');
      } else if (fs.existsSync('.env')) {
        process.loadEnvFile('.env');
      }
    } catch {
      // Ignore if files are absent or unreadable
    }
  };
  loadLocalEnv();

  // Initialize Gemini via genai SDK dynamically (no stale caching)
  const getAi = () => {
    loadLocalEnv();
    const rawKey = process.env.GEMINI_API_KEY;
    const key = rawKey ? rawKey.trim().replace(/^['"]|['"]$/g, '') : undefined;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing. Please add a valid Gemini API Key in the AI Studio Settings (Secrets) menu.");
    }
    return new GoogleGenAI({ apiKey: key });
  };

  // Restrict CORS policy to only trusted origins
  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (e.g., server-to-server), 
      // or from explicitly trusted domains.
      if (!origin || 
          origin.endsWith('.run.app') || 
          origin.endsWith('wasko.org') ||
          origin === 'https://ai.studio' || 
          origin.startsWith('http://localhost:')) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    }
  }));

  // Setup rate limiter for API routes
  const apiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 15 minutes
    max: 50, // Limit each IP to 50 requests per `window` (here, per 60 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
  });

  // Apply the rate limiting middleware to API calls
  app.use('/api/', apiLimiter);

// Helper functions for classifying Phenotype Study Origins
function isTargetedAllele(allele?: string): boolean {
  if (!allele) return false;
  const a = allele.trim();
  // Standard whole-gene knockout / deletion collection formats: act1-Δ, act1-delta, act1_delta, act1Δ, null, etc.
  if (/(-|_)(\u0394|delta|\u03b4)$/i.test(a) || /^[a-z0-9]+(\u0394|delta|\u03b4)$/i.test(a) || a.toLowerCase() === 'null') {
    return false;
  }
  return true;
}

const HT_KEYWORDS = [
  'giaever', 'breslow', 'winzeler', 'hillenmeyer', 'costanzo', 'tong', 'qian',
  'douglas', 'yoshikawa', 'svensson', 'davey', 'lussier', 'sopko', 'huang',
  'chakrabortee', 'simmons', 'st john', 'stirling', 'deutschbauer', 'deuschbauer',
  'niu', 'stevenson', 'choy', 'freimoser', 'michaillat', 'ratnakumar', 'north',
  'pir', 'el harati', 'göransson', 'goransson', 'dudley', 'dill', 'ohya',
  'genome-wide', 'genomewide', 'high-throughput', 'systematic', 'collection',
  'barcode', 'profiling', 'screen', 'array', 'fitness', 'competitive', 'haploinsufficient'
];

function classifyPhenotypeAnnotation(allele?: string, citation?: string, condition?: string, expType?: string): {
  studyType: 'classic' | 'high-throughput';
  experimentType: string;
} {
  const normCit = (citation || '').toLowerCase();
  const normCond = (condition || '').toLowerCase();
  const normType = (expType || '').toLowerCase();

  // 1. Direct SGD experiment type match
  if (normType === 'classical genetics') {
    return { studyType: 'classic', experimentType: 'classical genetics' };
  }
  if (/systematic|competitive|large-scale|large scale|survey/i.test(normType)) {
    return { studyType: 'high-throughput', experimentType: expType || 'systematic mutation set' };
  }

  // 2. Targeted allele check (specific point mutations, ts-alleles, truncation alleles)
  const targeted = isTargetedAllele(allele);
  if (targeted) {
    return { studyType: 'classic', experimentType: 'classical genetics (targeted allele)' };
  }

  // 3. Known high-throughput publications or assay keywords
  const isHt = HT_KEYWORDS.some(kw => normCit.includes(kw) || normCond.includes(kw));
  if (isHt) {
    return { studyType: 'high-throughput', experimentType: 'high-throughput screen / deletion collection' };
  }

  // 4. Knockout deletion or competitive growth condition
  if (/(-|_)(\u0394|delta|\u03b4)$/i.test(allele || '') || normCond.includes('competitive')) {
    return { studyType: 'high-throughput', experimentType: 'deletion collection (null mutant)' };
  }

  // Default to classic
  return { studyType: 'classic', experimentType: 'classical genetics' };
}

// In-memory cache for mapping ORF names / SGD IDs to standard yeast symbols for backup TSV lookup
const yeastSymbolCache = new Map<string, string>();
const resolveYeastSymbolForBackup = async (identifier: string): Promise<string | null> => {
  const clean = identifier.replace(/^SGD:/i, '').trim().toUpperCase();
  if (!clean || clean === 'UNKNOWN') return null;
  if (yeastSymbolCache.has(clean)) return yeastSymbolCache.get(clean)!;
  try {
    const url = `https://mygene.info/v3/query?q=${encodeURIComponent(clean)}&species=559292,4932&fields=symbol`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data.hits?.[0];
    if (hit?.symbol) {
      yeastSymbolCache.set(clean, hit.symbol);
      return hit.symbol;
    }
  } catch (e) {
    console.warn(`[resolveYeastSymbolForBackup] Lookup error for ${identifier}:`, e);
  }
  return null;
};

  // Proxy /api/phenotypes
  // Uses Alliance of Genome Resources (AGR) as primary sustainable API (since SGD yeastgenome.org is being absorbed into AGR),
  // with fallback to local SGDphenotypes.tsv / SQLite database.
  app.get('/api/phenotypes', async (req, res) => {
    try {
      const { sgdId, symbol } = req.query as { sgdId: string; symbol?: string };
      if (!sgdId && !symbol) return res.status(400).json({ error: "Missing sgdId or symbol" });

      // 1. Try hitting the external Alliance Genome Resources (AGR) API
      // Note: We use alliancegenome.org (sustainable long-term repository), NOT direct yeastgenome.org calls.
      if (sgdId && sgdId !== "UNKNOWN") {
          const cleanedSgdId = sgdId.startsWith('SGD:') ? sgdId : `SGD:${sgdId}`;
          const url = `https://www.alliancegenome.org/api/gene/${encodeURIComponent(cleanedSgdId)}/phenotypes?limit=150`;
          console.log(`Querying AGR API (Alliance Genome): ${url}`);
          
          try {
              const agrRes = await fetch(url);
              if (agrRes.ok) {
                  const data = await agrRes.json();
                  if (data.results && data.results.length > 0) {
                     console.log(`Found ${data.results.length} phenotypes from AGR for ${cleanedSgdId}`);

                     // Classify and enrich each AGR phenotype result
                     const enrichedResults = data.results.map((r: any) => {
                       const primaryAnnotations = r.primaryAnnotations || [];
                       
                       const classifiedAnnotations = primaryAnnotations.map((pa: any) => {
                         const allele = pa.phenotypeAnnotationSubject?.alleleSymbol?.displayText || '';
                         const citation = pa.evidenceItem?.shortCitation || '';
                         const pmid = pa.evidenceItem?.referenceID?.replace('PMID:', '') || '';
                         const condition = pa.conditionRelations?.[0]?.conditions?.map((c: any) => c.conditionSummary).join(', ') || '';
                         const classification = classifyPhenotypeAnnotation(allele, citation, condition, pa.type);

                         return {
                           citation: citation || (pmid ? `PMID:${pmid}` : 'Alliance of Genome Resources'),
                           pubmed_id: pmid,
                           studyType: classification.studyType,
                           experimentType: classification.experimentType,
                           allele: allele || 'N/A',
                           condition
                         };
                       });

                       const hasClassic = classifiedAnnotations.some((a: any) => a.studyType === 'classic');
                       const hasHighThroughput = classifiedAnnotations.some((a: any) => a.studyType === 'high-throughput');

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

                       // Prioritize classic annotation for primary display reference if available
                       const primaryAnnot = classifiedAnnotations.find((a: any) => a.studyType === 'classic') || classifiedAnnotations[0] || {};

                       return {
                         phenotypeStatement: r.phenotypeStatement,
                         studyType,
                         studyTypeLabel,
                         studyTypeDescription,
                         experimentType: primaryAnnot.experimentType || (studyType === 'classic' ? 'classical genetics' : 'systematic mutation set'),
                         category: primaryAnnot.experimentType || (studyType === 'classic' ? 'classical genetics' : 'systematic mutation set'),
                         reference: primaryAnnot.citation || r.references?.[0]?.shortCitation || 'Alliance of Genome Resources',
                         pubmed_id: primaryAnnot.pubmed_id || r.references?.[0]?.referenceID?.replace('PMID:', ''),
                         mutant_type: primaryAnnot.allele || 'Unknown',
                         note: primaryAnnot.condition || '',
                         hasClassic,
                         hasHighThroughput,
                         allReferences: classifiedAnnotations,
                         primaryAnnotations: r.primaryAnnotations
                       };
                     });

                     return res.json({ results: enrichedResults });
                  } else {
                     console.log(`AGR query returned empty results, falling back to local DB/TSV`);
                  }
              } else {
                  console.warn(`AGR return status ${agrRes.status}`);
              }
          } catch (e) {
              console.warn(`Failed to fetch from AGR`, e);
          }
      }

      console.log(`Checking local DB/TSV as backup source for phenotypes.`);
      // 2. BACKUP SOURCE: If primary AGR API returned no records, query local SQLite or SGDphenotypes.tsv
      let localRecords: any[] = [];
      if (db) {
        if (symbol) {
          localRecords = db.prepare('SELECT * FROM phenotypes WHERE Gene_Name = ? OR Feature_Name = ?').all(symbol, symbol) as any[];
        }
        if (localRecords.length === 0 && sgdId && sgdId !== "UNKNOWN") {
          const cleanedSgdId = sgdId.startsWith('SGD:') ? sgdId : `SGD:${sgdId}`;
          localRecords = db.prepare('SELECT * FROM phenotypes WHERE SGDID = ? OR SGDID = ?').all(cleanedSgdId, sgdId.replace('SGD:', '')) as any[];
        }
      }

      // Check SGDphenotypes.tsv as backup source
      if (localRecords.length === 0 && tsvDb) {
        let querySymbol = (symbol || '').toUpperCase().trim();
        const cleanedId = (sgdId || '').replace(/^SGD:/i, '').trim().toUpperCase();

        if (querySymbol) {
          localRecords = tsvDb.filter((r) => r.Gene_Name && r.Gene_Name.toUpperCase() === querySymbol);
        }
        if (localRecords.length === 0 && cleanedId && cleanedId !== "UNKNOWN") {
          localRecords = tsvDb.filter((r) => 
            (r.Gene_Name && r.Gene_Name.toUpperCase() === cleanedId)
          );
        }

        // If not found yet and symbol/sgdId is an ORF name (e.g. YAL038W) or SGD ID (S00000...),
        // dynamically resolve to standard yeast gene symbol via MyGene.info
        if (localRecords.length === 0 && (querySymbol || cleanedId)) {
          const lookupTerm = querySymbol || cleanedId;
          const resolvedSymbol = await resolveYeastSymbolForBackup(lookupTerm);
          if (resolvedSymbol) {
            console.log(`Resolved ${lookupTerm} to standard yeast symbol ${resolvedSymbol} for backup SGDphenotypes.tsv lookup`);
            localRecords = tsvDb.filter((r) => r.Gene_Name && r.Gene_Name.toUpperCase() === resolvedSymbol.toUpperCase());
          }
        }
      }

      if (localRecords.length > 0) {
        console.log(`Found ${localRecords.length} records in backup SGDphenotypes.tsv for ${symbol || sgdId}`);

        // Group local records by phenotype statement to consolidate classic vs high-throughput studies
        const grouped = new Map<string, {
          statement: string;
          hasClassic: boolean;
          hasHighThroughput: boolean;
          records: any[];
        }>();

        for (const row of localRecords) {
          const chem = row.Chemical && row.Chemical !== '""""""' ? row.Chemical.trim() : '';
          const detail = row.Details && row.Details !== '""""""' ? row.Details.trim() : '';
          const pheno = row.Phenotype && row.Phenotype !== '""""""' ? row.Phenotype.trim() : '';
          const cond = row.Condition && row.Condition !== '""""""' ? row.Condition.trim() : '';
          const mutantType = row.Mutant_Type && row.Mutant_Type !== '""""""' ? row.Mutant_Type.trim() : '';

          const parts: string[] = [];
          if (detail) parts.push(detail);
          if (chem) parts.push(chem);
          if (parts.length === 0 && pheno) parts.push(pheno);
          if (parts.length === 0 && cond) parts.push(`Condition: ${cond}`);

          let phenotypeStatement = parts.length > 0 ? parts.join(' - ') : 'Observed phenotype';
          if (mutantType && !phenotypeStatement.toLowerCase().startsWith(mutantType.toLowerCase())) {
            const capitalizedMutantType = mutantType.charAt(0).toUpperCase() + mutantType.slice(1);
            phenotypeStatement = `${capitalizedMutantType}: ${phenotypeStatement}`;
          }

          const isClassic = (row.Experiment_Type || '').toLowerCase() === 'classical genetics';
          const isHt = !isClassic;

          if (!grouped.has(phenotypeStatement)) {
            grouped.set(phenotypeStatement, {
              statement: phenotypeStatement,
              hasClassic: isClassic,
              hasHighThroughput: isHt,
              records: [row]
            });
          } else {
            const entry = grouped.get(phenotypeStatement)!;
            if (isClassic) entry.hasClassic = true;
            if (isHt) entry.hasHighThroughput = true;
            entry.records.push(row);
          }
        }

        const mappedResults = Array.from(grouped.values()).map(group => {
          const studyType: 'classic' | 'high-throughput' | 'both' = 
            group.hasClassic && group.hasHighThroughput ? 'both' : (group.hasClassic ? 'classic' : 'high-throughput');

          const studyTypeLabel = 
            studyType === 'both' ? 'Both Classic Targeted & High-Throughput Studies' :
            studyType === 'classic' ? 'Classic Genetic Targeted Study on Gene' :
            'High-Throughput Study (e.g., Deletion Collection)';

          const studyTypeDescription = 
            studyType === 'both' ? 'Corroborated across both classic targeted gene studies and genome-wide high-throughput deletion screens.' :
            studyType === 'classic' ? 'Discovered in a targeted, locus-specific study using dedicated mutant alleles or point mutations.' :
            'Discovered in a systematic genome-wide survey (e.g., yeast deletion collection, barcode fitness profiling, or chemical-genomic screen).';

          // Prioritize classic record for primary display
          const primaryRow = group.records.find(r => (r.Experiment_Type || '').toLowerCase() === 'classical genetics') || group.records[0];

          const allReferences = group.records.map(r => ({
            citation: r.Reference || `SGD Curated Record (${r.Experiment_Type || 'Phenotype Assay'})`,
            pubmed_id: r.PubMed_ID || r.PMID || '',
            studyType: (r.Experiment_Type || '').toLowerCase() === 'classical genetics' ? ('classic' as const) : ('high-throughput' as const),
            experimentType: r.Experiment_Type || 'Unknown',
            allele: r.Phenotype || r.Mutant_Type || r.Allele || 'Unknown',
            condition: [r.Condition, r.Details].filter(Boolean).join(" | ") || ''
          }));

          return {
            phenotypeStatement: group.statement,
            studyType,
            studyTypeLabel,
            studyTypeDescription,
            experimentType: primaryRow.Experiment_Type || (studyType === 'classic' ? 'classical genetics' : 'systematic mutation set'),
            category: primaryRow.Experiment_Type || (studyType === 'classic' ? 'classical genetics' : 'systematic mutation set'),
            reference: primaryRow.Reference || `SGD Curated Record (${primaryRow.Experiment_Type || 'classical genetics'})`,
            pubmed_id: primaryRow.PubMed_ID || primaryRow.PMID || '',
            mutant_type: primaryRow.Phenotype || primaryRow.Mutant_Type || primaryRow.Allele || 'Unknown',
            note: [primaryRow.Condition, primaryRow.Details].filter(Boolean).join(" | ") || '',
            hasClassic: group.hasClassic,
            hasHighThroughput: group.hasHighThroughput,
            allReferences,
            primaryAnnotations: [{
              type: primaryRow.Experiment_Type || 'Unknown',
              evidenceItem: {
                shortCitation: primaryRow.Reference || 'SGD Curated Record',
                referenceID: primaryRow.Reference || 'SGD'
              },
              phenotypeAnnotationSubject: {
                alleleSymbol: {
                  displayText: primaryRow.Phenotype || primaryRow.Mutant_Type || primaryRow.Allele || 'Unknown'
                }
              },
              conditionRelations: [{
                conditions: [{
                  conditionSummary: [primaryRow.Condition, primaryRow.Details].filter(Boolean).join(" | ") || ''
                }]
              }]
            }]
          };
        });

        return res.json({ results: mappedResults });
      }

      return res.json({ results: [] });

    } catch (err: any) {
      console.error("Error fetching phenotypes:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Proxy /api/alliance/search
  // Searches genes using the official Alliance of Genome Resources (AGR) API
  app.get('/api/alliance/search', async (req, res) => {
    try {
      const { q, species = 'Saccharomyces cerevisiae', limit = '50' } = req.query as { q?: string; species?: string; limit?: string };
      if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });

      const url = `https://www.alliancegenome.org/api/search?q=${encodeURIComponent(q)}&category=gene_search_result&species=${encodeURIComponent(species)}&limit=${encodeURIComponent(limit)}`;
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(response.status).json({ error: "Alliance Genome search API failed" });
      }
      const data = await response.json();
      return res.json(data);
    } catch (e: any) {
      console.warn("Alliance Genome search proxy error:", e);
      return res.status(500).json({ error: e.message || "Failed to search Alliance Genome" });
    }
  });

  // Proxy /api/alliancemine/sequence (Alliance of Genome Resources AllianceMine backup for yeast sequence)
  app.get('/api/alliancemine/sequence', async (req, res) => {
    try {
      const { symbol } = req.query as { symbol?: string };
      if (!symbol) return res.status(400).json({ error: "Missing symbol parameter" });

      const cleanSymbol = symbol.trim().toUpperCase();
      const cleanSgd = symbol.startsWith("SGD:") ? symbol : `SGD:${symbol}`;
      const ALLIANCEMINE_URL = "https://alliancemine.alliancegenome.org/alliancemine/service/query/results";

      // Query 1: By symbol
      const xmlSymbol = `<query name="" model="genomic" view="Gene.primaryIdentifier Gene.secondaryIdentifier Gene.symbol Gene.sequence.residues Gene.length" sortOrder="Gene.symbol asc">
        <constraint path="Gene.symbol" op="=" value="${cleanSymbol}"/>
        <constraint path="Gene.organism.taxonId" op="ONE OF"><value>4932</value><value>559292</value></constraint>
      </query>`;

      let resp = await fetch(`${ALLIANCEMINE_URL}?query=${encodeURIComponent(xmlSymbol)}&format=json`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.results && data.results.length > 0) {
          const row = data.results[0];
          return res.json({
            primaryIdentifier: row[0],
            secondaryIdentifier: row[1],
            symbol: row[2],
            sequence: row[3],
            length: row[4],
            source: 'Alliance Genome (AllianceMine)'
          });
        }
      }

      // Query 2: By secondaryIdentifier (systematic ORF name, e.g. YFL039C)
      const xmlSecondary = `<query name="" model="genomic" view="Gene.primaryIdentifier Gene.secondaryIdentifier Gene.symbol Gene.sequence.residues Gene.length" sortOrder="Gene.symbol asc">
        <constraint path="Gene.secondaryIdentifier" op="=" value="${cleanSymbol}"/>
        <constraint path="Gene.organism.taxonId" op="ONE OF"><value>4932</value><value>559292</value></constraint>
      </query>`;

      resp = await fetch(`${ALLIANCEMINE_URL}?query=${encodeURIComponent(xmlSecondary)}&format=json`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.results && data.results.length > 0) {
          const row = data.results[0];
          return res.json({
            primaryIdentifier: row[0],
            secondaryIdentifier: row[1],
            symbol: row[2],
            sequence: row[3],
            length: row[4],
            source: 'Alliance Genome (AllianceMine)'
          });
        }
      }

      // Query 3: By primaryIdentifier (SGD ID)
      const xmlPrimary = `<query name="" model="genomic" view="Gene.primaryIdentifier Gene.secondaryIdentifier Gene.symbol Gene.sequence.residues Gene.length" sortOrder="Gene.symbol asc">
        <constraint path="Gene.primaryIdentifier" op="=" value="${cleanSgd}"/>
      </query>`;

      resp = await fetch(`${ALLIANCEMINE_URL}?query=${encodeURIComponent(xmlPrimary)}&format=json`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.results && data.results.length > 0) {
          const row = data.results[0];
          return res.json({
            primaryIdentifier: row[0],
            secondaryIdentifier: row[1],
            symbol: row[2],
            sequence: row[3],
            length: row[4],
            source: 'Alliance Genome (AllianceMine)'
          });
        }
      }

      return res.status(404).json({ error: `Gene '${symbol}' not found in AllianceMine` });
    } catch (err: any) {
      console.error("AllianceMine sequence proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Helper for ClinVar Review Stars ---
  function getClinVarStarsFromStatus(status?: string | string[]): number {
    if (!status) return 0;
    const s = Array.isArray(status) ? status.join(" ").toLowerCase() : status.toLowerCase();
    if (s.includes('practice guideline')) return 4;
    if (s.includes('reviewed by expert panel')) return 3;
    if (s.includes('multiple submitters') && !s.includes('conflicting')) return 2;
    if (s.includes('criteria provided') || s.includes('single submitter')) return 1;
    return 0;
  }

  // --- Process MyVariant hit into DiscordantVariant ---
  function processDiscordantHit(
    h: any, 
    requestedType: string, 
    minStars: number, 
    onlyYeastHomologs: boolean,
    minAmPathScore: number = 0.56,
    maxAmBenignScore: number = 0.34,
    minDioptScore: number = 0,
    includePathogenic: boolean = true,
    includeLikelyPathogenic: boolean = true,
    includeBenign: boolean = true,
    includeLikelyBenign: boolean = true,
    minSubmissions: number = 0,
    gnomadFilter: string = 'ALL'
  ): any | null {
    const clin = Array.isArray(h.clinvar) ? h.clinvar[0] : h.clinvar;
    if (!clin) return null;

    const dbnsfp = Array.isArray(h.dbnsfp) ? h.dbnsfp[0] : h.dbnsfp;

    let gene = (
      clin?.gene?.symbol || 
      (Array.isArray(clin?.gene) ? clin.gene[0]?.symbol : "") || 
      (Array.isArray(dbnsfp?.genename) ? dbnsfp.genename[0] : dbnsfp?.genename) ||
      h.dbsnp?.gene?.symbol ||
      ""
    ).toUpperCase();
    if (!gene && h._id) {
      gene = clin?.gene || "";
    }
    if (!gene) return null;

    // Check yeast ortholog if required
    const yeastOrth = orthologMap.get(gene) || null;
    if ((onlyYeastHomologs || minDioptScore > 0) && !yeastOrth) return null;
    if (minDioptScore > 0 && yeastOrth && yeastOrth.dioptScore < minDioptScore) return null;

    // AlphaMissense Score: evaluate all transcripts/isoforms
    let rawScore = dbnsfp?.alphamissense?.score;
    const allScores: number[] = [];
    if (Array.isArray(rawScore)) {
      for (const s of rawScore) {
        const parsed = parseFloat(s);
        if (!isNaN(parsed)) allScores.push(parsed);
      }
    } else if (rawScore !== undefined && rawScore !== null) {
      const parsed = parseFloat(rawScore);
      if (!isNaN(parsed)) allScores.push(parsed);
    }
    if (allScores.length === 0) return null;

    // ClinVar significance
    const rcvs = Array.isArray(clin?.rcv) ? clin.rcv : (clin?.rcv ? [clin.rcv] : []);
    if (rcvs.length === 0) return null;

    // Submission and submitter counts from ClinVar
    let totalSubmissions = 0;
    let totalSubmitters = 0;
    for (const r of rcvs) {
      const subs = typeof r.number_submissions === 'number' && r.number_submissions > 0 ? r.number_submissions : null;
      const subms = typeof r.number_submitters === 'number' && r.number_submitters > 0 ? r.number_submitters : 1;
      totalSubmitters += subms;
      totalSubmissions += (subs ?? subms);
    }
    totalSubmissions = Math.max(totalSubmissions, rcvs.length);
    totalSubmitters = Math.max(totalSubmitters, rcvs.length);

    if (minSubmissions > 0 && Math.max(totalSubmissions, totalSubmitters) < minSubmissions) return null;

    // gnomAD Frequency extraction
    const ex = h?.gnomad_exome;
    const gen = h?.gnomad_genome;
    const rawExomeAf = ex?.af?.af ?? ex?.af;
    const rawGenomeAf = gen?.af?.af ?? gen?.af;
    const gnomadExomeAf = typeof rawExomeAf === 'number' ? rawExomeAf : (parseFloat(rawExomeAf) || null);
    const gnomadGenomeAf = typeof rawGenomeAf === 'number' ? rawGenomeAf : (parseFloat(rawGenomeAf) || null);
    const gnomadExomeAc = typeof ex?.ac?.ac === 'number' ? ex.ac.ac : (typeof ex?.ac === 'number' ? ex.ac : null);
    const gnomadExomeAn = typeof ex?.an?.an === 'number' ? ex.an.an : (typeof ex?.an === 'number' ? ex.an : null);
    const gnomadGenomeAc = typeof gen?.ac?.ac === 'number' ? gen.ac.ac : (typeof gen?.ac === 'number' ? gen.ac : null);
    const gnomadGenomeAn = typeof gen?.an?.an === 'number' ? gen.an.an : (typeof gen?.an === 'number' ? gen.an : null);

    const gnomadAf = gnomadExomeAf !== null && gnomadGenomeAf !== null 
      ? Math.max(gnomadExomeAf, gnomadGenomeAf) 
      : (gnomadExomeAf ?? gnomadGenomeAf ?? null);

    // gnomAD Category
    let gnomadCategory: 'COMMON' | 'LOW_FREQUENCY' | 'RARE' | 'ULTRA_RARE' = 'ULTRA_RARE';
    if (gnomadAf !== null) {
      if (gnomadAf >= 0.01) gnomadCategory = 'COMMON';
      else if (gnomadAf >= 0.001) gnomadCategory = 'LOW_FREQUENCY';
      else if (gnomadAf > 0) gnomadCategory = 'RARE';
      else gnomadCategory = 'ULTRA_RARE';
    }

    if (gnomadFilter === 'COMMON' && gnomadCategory !== 'COMMON') return null;
    if (gnomadFilter === 'LOW_FREQUENCY' && gnomadCategory !== 'LOW_FREQUENCY' && gnomadCategory !== 'COMMON') return null;
    if (gnomadFilter === 'RARE' && gnomadCategory !== 'RARE') return null;
    if (gnomadFilter === 'ULTRA_RARE' && gnomadCategory !== 'ULTRA_RARE') return null;

    // gnomAD Link generation
    let gnomadLink: string | null = null;
    let gnomadLinkV4: string | null = null;
    const rawChrom = clin?.chrom || (h?._id?.startsWith('chr') ? h._id.match(/chr([0-9XYM]+)/i)?.[1] : null);
    const chrom = rawChrom ? String(rawChrom).replace(/^chr/i, '') : null;
    const ref = clin?.ref;
    const alt = clin?.alt;
    const hg38Start = clin?.hg38?.start || h?.hg38?.start;
    const hg19Start = clin?.hg19?.start || h?.hg19?.start;

    // gnomAD v4 link (GRCh38)
    if (chrom && hg38Start && ref && alt) {
      gnomadLinkV4 = `https://gnomad.broadinstitute.org/variant/${chrom}-${hg38Start}-${ref}-${alt}?dataset=gnomad_r4`;
    }

    // Primary link: points directly to gnomAD v2.1.1 (where the displayed frequency & AC/AN counts reside)
    if (chrom && hg19Start && ref && alt) {
      gnomadLink = `https://gnomad.broadinstitute.org/variant/${chrom}-${hg19Start}-${ref}-${alt}?dataset=gnomad_r2_1`;
    } else if (ex?.chrom && ex?.pos && ex?.ref && ex?.alt) {
      const exChrom = String(ex.chrom).replace(/^chr/i, '');
      gnomadLink = `https://gnomad.broadinstitute.org/variant/${exChrom}-${ex.pos}-${ex.ref}-${ex.alt}?dataset=gnomad_r2_1`;
    } else if (gen?.chrom && gen?.pos && gen?.ref && gen?.alt) {
      const genChrom = String(gen.chrom).replace(/^chr/i, '');
      gnomadLink = `https://gnomad.broadinstitute.org/variant/${genChrom}-${gen.pos}-${gen.ref}-${gen.alt}?dataset=gnomad_r2_1`;
    } else if (h?._id && typeof h._id === 'string' && h._id.startsWith('chr')) {
      const m = h._id.match(/chr([0-9XYM]+):g\.(\d+)([A-Z]+)>([A-Z]+)/i);
      if (m) {
        gnomadLink = `https://gnomad.broadinstitute.org/variant/${m[1]}-${m[2]}-${m[3]}-${m[4]}?dataset=gnomad_r2_1`;
      }
    } else if (gnomadLinkV4) {
      gnomadLink = gnomadLinkV4;
    }

    if (!gnomadLink) {
      const rs = clin?.rsid || (Array.isArray(h?.dbsnp?.rsid) ? h.dbsnp.rsid[0] : h?.dbsnp?.rsid);
      if (rs) {
        const rsClean = String(rs).startsWith('rs') ? rs : `rs${rs}`;
        gnomadLink = `https://gnomad.broadinstitute.org/search?q=${encodeURIComponent(rsClean)}`;
      }
    }

    // Check all RCVs for conflicting or uncertain
    const allSigStrings: string[] = [];
    let bestReviewStatus = '';
    let maxStars = 0;
    for (const r of rcvs) {
      const sigStr = String(r?.clinical_significance || '').toLowerCase();
      allSigStrings.push(sigStr);
      const st = getClinVarStarsFromStatus(r?.review_status);
      if (st > maxStars) {
        maxStars = st;
        bestReviewStatus = r?.review_status || '';
      }
    }
    if (!bestReviewStatus && rcvs[0]?.review_status) {
      bestReviewStatus = rcvs[0].review_status;
    }

    if (minStars > 0 && maxStars < minStars) return null;

    const hasUncertain = allSigStrings.some(s => s.includes('uncertain'));
    const hasConflicting = allSigStrings.some(s => s.includes('conflicting'));
    const hasExactBenign = allSigStrings.some(s => s.includes('benign') && !s.includes('likely'));
    const hasLikelyBenign = allSigStrings.some(s => s.includes('likely benign'));
    const hasExactPathogenic = allSigStrings.some(s => s.includes('pathogenic') && !s.includes('likely'));
    const hasLikelyPathogenic = allSigStrings.some(s => s.includes('likely pathogenic'));

    const hasAnyBenign = hasExactBenign || hasLikelyBenign;
    const hasAnyPathogenic = hasExactPathogenic || hasLikelyPathogenic;

    // Active conflicting interpretations or simultaneous benign and pathogenic assertions reject the hit
    if (hasConflicting) return null;
    if (hasAnyBenign && hasAnyPathogenic) return null;

    // Check if an authoritative consensus (2★ Multiple submitters no conflicts, 3★ Expert panel, or 4★ Practice guideline) exists
    const hasAuthoritativeConsensus = maxStars >= 2;

    // If an uncertain significance assertion exists in history, only reject if there is NO 2★+ authoritative consensus overriding it
    if (hasUncertain && !hasAuthoritativeConsensus) return null;

    const isBenignAllowed = (includeBenign && hasExactBenign) || (includeLikelyBenign && hasLikelyBenign);
    const isPathogenicAllowed = (includePathogenic && hasExactPathogenic) || (includeLikelyPathogenic && hasLikelyPathogenic);

    let discType: 'BENIGN_AM_PATHOGENIC' | 'PATHOGENIC_AM_BENIGN' | 'RECURRENT_BENIGN' | null = null;
    let amScore = 0;
    let delta = 0;
    let clinVarSignificance = '';

    if (requestedType === 'RECURRENT_BENIGN') {
      if (!hasAnyBenign || !isBenignAllowed) return null;
      discType = 'RECURRENT_BENIGN';
      amScore = allScores[0] ?? 0;
      delta = amScore;
      clinVarSignificance = hasExactBenign ? 'Benign' : 'Likely benign';
    } else {
      if (hasAnyBenign && isBenignAllowed) {
        const maxScore = Math.max(...allScores);
        if (maxScore >= minAmPathScore) {
          discType = 'BENIGN_AM_PATHOGENIC';
          amScore = maxScore;
          delta = amScore; // e.g. 0.85 -> delta 0.85
          clinVarSignificance = hasExactBenign ? 'Benign' : 'Likely benign';
        }
      } 
      
      if (!discType && hasAnyPathogenic && isPathogenicAllowed) {
        const minScore = Math.min(...allScores);
        if (minScore <= maxAmBenignScore) {
          discType = 'PATHOGENIC_AM_BENIGN';
          amScore = minScore;
          delta = 1.0 - amScore; // e.g. 0.15 -> delta 0.85
          clinVarSignificance = hasExactPathogenic ? 'Pathogenic' : 'Likely pathogenic';
        }
      }
    }

    if (!discType) return null;
    if (requestedType !== 'ALL' && discType !== requestedType) return null;

    // HGVS protein: prioritize ClinVar official preferred_name (e.g. "NM_... (p.Lys715Thr)")
    // and dbnsfp.hgvsp which maps directly to the canonical UniProt protein sequence
    let pChange = '';
    for (const r of rcvs) {
      if (r?.preferred_name) {
        const m = String(r.preferred_name).match(/\((p\.[A-Za-z0-9_]+)\)/);
        if (m) { pChange = m[1]; break; }
        const m2 = String(r.preferred_name).match(/p\.[A-Z][a-z]{2}\d+[A-Z][a-z]{2}/);
        if (m2) { pChange = m2[0]; break; }
      }
    }

    if (!pChange) {
      const dbHgvs = dbnsfp?.hgvsp || h.dbnsfp?.hgvsp;
      const dbList = (Array.isArray(dbHgvs) ? dbHgvs : [dbHgvs]).filter(Boolean);
      const match3 = dbList.find((s: string) => /p\.[A-Z][a-z]{2}\d+[A-Z][a-z]{2}/.test(s));
      if (match3) pChange = match3;
      else if (dbList.length > 0) pChange = dbList[0];
    }

    if (!pChange) {
      const clProt = clin?.hgvs?.protein;
      const clList = (Array.isArray(clProt) ? clProt : [clProt]).filter(Boolean);
      if (clList.length > 0) pChange = clList[0];
    }

    if (!pChange) pChange = clin?.variant_id ? `Variant ${clin.variant_id}` : 'p.?';

    // Strictly enforce missense only: reject Termination (Ter / * / X) and frameshifts / indels
    if (
      /\bTer\b/i.test(pChange) ||
      pChange.includes('*') ||
      /\bdel\b/i.test(pChange) ||
      /\bins\b/i.test(pChange) ||
      /\bdup\b/i.test(pChange) ||
      /\bfs\b/i.test(pChange) ||
      /\bext\b/i.test(pChange)
    ) {
      return null;
    }

    let cleanHgvs = pChange;
    const hgvsMatch = cleanHgvs.match(/p\.([A-Z][a-z]{2}\d+[A-Z][a-z]{2})/);
    if (hgvsMatch) {
      cleanHgvs = hgvsMatch[1];
    } else if (cleanHgvs.includes(':')) {
      cleanHgvs = cleanHgvs.split(':')[1];
    }

    // Condition
    const primaryRcv = rcvs[0];
    const diseaseName = primaryRcv?.conditions?.name || primaryRcv?.conditions?.[0]?.name || clin?.phenotype || 'Not specified';

    // Unique variant ID
    const clinVarVariantId = clin?.variant_id || h._id;
    const id = `${gene}_${cleanHgvs}_${clinVarVariantId}`;

    const uniprotId = clin?.uniprot || dbnsfp?.uniprot?.acc || h.dbnsfp?.uniprot?.acc || (Array.isArray(dbnsfp?.uniprot) ? dbnsfp.uniprot[0]?.acc : undefined);

    let amClass: 'Likely Benign' | 'Likely Pathogenic' | 'Ambiguous' = 'Ambiguous';
    if (amScore >= minAmPathScore) amClass = 'Likely Pathogenic';
    else if (amScore <= maxAmBenignScore) amClass = 'Likely Benign';

    return {
      id,
      gene,
      hgvsProtein: cleanHgvs,
      hgvsCdna: clin?.hgvs?.coding || undefined,
      rsid: h.dbsnp?.rsid || undefined,
      clinVarVariantId,
      clinVarSignificance,
      clinVarStars: maxStars,
      clinVarReviewStatus: bestReviewStatus || 'criteria provided',
      clinVarSubmissions: totalSubmissions,
      clinVarSubmitters: totalSubmitters,
      amScore,
      amClass,
      discordanceType: discType,
      discordanceDelta: Math.round(delta * 1000) / 1000,
      diseaseOrCondition: typeof diseaseName === 'string' ? diseaseName : 'Not specified',
      gnomadAf,
      gnomadExomeAf,
      gnomadGenomeAf,
      gnomadExomeAc,
      gnomadExomeAn,
      gnomadGenomeAc,
      gnomadGenomeAn,
      gnomadCategory,
      gnomadLink,
      gnomadLinkV4,
      yeastOrtholog: yeastOrth,
      uniprotId: uniprotId || undefined
    };
  }

  // In-memory cache for discordant gene facets across genome
  const discordantFacetCache = new Map<string, { timestamp: number; counts: Map<string, number> }>();
  const FACET_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  async function getDiscordantGeneFacetCounts(
    type: string,
    bQuery: string,
    pQuery: string,
    rQuery: string,
    cacheKey: string
  ): Promise<Map<string, number>> {
    const cached = discordantFacetCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < FACET_CACHE_TTL)) {
      return cached.counts;
    }

    const counts = new Map<string, number>();
    try {
      if (type === 'ALL') {
        const [bRes, pRes] = await Promise.all([
          fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(bQuery)}&facets=dbnsfp.genename&facet_size=1000&size=0`)
            .then(r => r.ok ? r.json() : { facets: {} })
            .catch(() => ({ facets: {} })),
          fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(pQuery)}&facets=dbnsfp.genename&facet_size=1000&size=0`)
            .then(r => r.ok ? r.json() : { facets: {} })
            .catch(() => ({ facets: {} }))
        ]);

        for (const t of (bRes.facets?.["dbnsfp.genename"]?.terms || [])) {
          const sym = String(t.term || '').toUpperCase();
          if (sym) counts.set(sym, (counts.get(sym) || 0) + (t.count || 0));
        }
        for (const t of (pRes.facets?.["dbnsfp.genename"]?.terms || [])) {
          const sym = String(t.term || '').toUpperCase();
          if (sym) counts.set(sym, (counts.get(sym) || 0) + (t.count || 0));
        }
      } else if (type === 'BENIGN_AM_PATHOGENIC') {
        const res = await fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(bQuery)}&facets=dbnsfp.genename&facet_size=1000&size=0`)
          .then(r => r.ok ? r.json() : { facets: {} })
          .catch(() => ({ facets: {} }));
        for (const t of (res.facets?.["dbnsfp.genename"]?.terms || [])) {
          const sym = String(t.term || '').toUpperCase();
          if (sym) counts.set(sym, (counts.get(sym) || 0) + (t.count || 0));
        }
      } else if (type === 'PATHOGENIC_AM_BENIGN') {
        const res = await fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(pQuery)}&facets=dbnsfp.genename&facet_size=1000&size=0`)
          .then(r => r.ok ? r.json() : { facets: {} })
          .catch(() => ({ facets: {} }));
        for (const t of (res.facets?.["dbnsfp.genename"]?.terms || [])) {
          const sym = String(t.term || '').toUpperCase();
          if (sym) counts.set(sym, (counts.get(sym) || 0) + (t.count || 0));
        }
      } else if (type === 'RECURRENT_BENIGN') {
        const res = await fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(rQuery)}&facets=dbnsfp.genename&facet_size=1000&size=0`)
          .then(r => r.ok ? r.json() : { facets: {} })
          .catch(() => ({ facets: {} }));
        for (const t of (res.facets?.["dbnsfp.genename"]?.terms || [])) {
          const sym = String(t.term || '').toUpperCase();
          if (sym) counts.set(sym, (counts.get(sym) || 0) + (t.count || 0));
        }
      }

      discordantFacetCache.set(cacheKey, { timestamp: Date.now(), counts });
    } catch (err: any) {
      console.warn("Failed to fetch discordant gene facets:", err?.message);
    }
    return counts;
  }

  // --- /api/discordant-variants (Search ClinVar ⇄ AlphaMissense Discordant Variants) ---
  const handleDiscordantVariantsRequest = async (req: express.Request, res: express.Response) => {
    try {
      const body = req.method === 'POST' ? req.body : req.query;
      let { 
        genes, 
        type = 'ALL', 
        minStars = 0, 
        minSubmissions = 0,
        onlyYeastHomologs = false, 
        minDioptScore = 0,
        minVariantsPerGene = 0,
        includePathogenic = true,
        includeLikelyPathogenic = true,
        includeBenign = true,
        includeLikelyBenign = true,
        searchQuery = '', 
        page = 1, 
        pageSize = 100, 
        sort = 'delta_desc',
        minAmPathScore = 0.56,
        maxAmBenignScore = 0.34,
        gnomadFilter = 'ALL'
      } = body;

      minStars = parseInt(minStars, 10) || 0;
      minSubmissions = Math.max(0, parseInt(minSubmissions, 10) || 0);
      minDioptScore = Math.max(0, parseInt(minDioptScore, 10) || 0);
      minVariantsPerGene = Math.max(0, parseInt(minVariantsPerGene, 10) || 0);
      page = Math.max(1, parseInt(page, 10) || 1);
      pageSize = Math.min(1000, Math.max(10, parseInt(pageSize, 10) || 100));
      onlyYeastHomologs = String(onlyYeastHomologs) === 'true' || minDioptScore > 0;
      includePathogenic = String(includePathogenic) !== 'false';
      includeLikelyPathogenic = String(includeLikelyPathogenic) !== 'false';
      includeBenign = String(includeBenign) !== 'false';
      includeLikelyBenign = String(includeLikelyBenign) !== 'false';
      minAmPathScore = parseFloat(minAmPathScore) || 0.56;
      maxAmBenignScore = parseFloat(maxAmBenignScore) || 0.34;

      // Parse genes list
      let parsedGenes: string[] = [];
      if (Array.isArray(genes)) {
        parsedGenes = genes.map((g: any) => String(g).trim().toUpperCase()).filter(Boolean);
      } else if (typeof genes === 'string' && genes.trim() && genes.trim().toUpperCase() !== 'ALL') {
        parsedGenes = genes.split(/[\s,;]+/).map(g => g.trim().toUpperCase()).filter(Boolean);
      }

      const isAllGenes = parsedGenes.length === 0;

      // Construct Core Query with user-selected significance sub-tiers
      const benignTerms: string[] = [];
      if (includeBenign) benignTerms.push(`clinvar.rcv.clinical_significance:"Benign"`);
      if (includeLikelyBenign) benignTerms.push(`clinvar.rcv.clinical_significance:"Likely benign"`);

      const pathogenicTerms: string[] = [];
      if (includePathogenic) pathogenicTerms.push(`clinvar.rcv.clinical_significance:"Pathogenic"`);
      if (includeLikelyPathogenic) pathogenicTerms.push(`clinvar.rcv.clinical_significance:"Likely pathogenic"`);

      let benignClause = "";
      if (benignTerms.length > 0) {
        benignClause = `((${benignTerms.join(" OR ")}) AND dbnsfp.alphamissense.score:>=${minAmPathScore})`;
      }

      let pathogenicClause = "";
      if (pathogenicTerms.length > 0) {
        pathogenicClause = `((${pathogenicTerms.join(" OR ")}) AND dbnsfp.alphamissense.score:<=${maxAmBenignScore})`;
      }

      let recurrentBenignClause = "";
      if (benignTerms.length > 0) {
        recurrentBenignClause = `(${benignTerms.join(" OR ")})`;
      }

      let coreFilter = "";
      if (type === 'BENIGN_AM_PATHOGENIC') {
        coreFilter = benignClause || `((clinvar.rcv.clinical_significance:"Benign" OR clinvar.rcv.clinical_significance:"Likely benign") AND dbnsfp.alphamissense.score:>=${minAmPathScore})`;
      } else if (type === 'PATHOGENIC_AM_BENIGN') {
        coreFilter = pathogenicClause || `((clinvar.rcv.clinical_significance:"Pathogenic" OR clinvar.rcv.clinical_significance:"Likely pathogenic") AND dbnsfp.alphamissense.score:<=${maxAmBenignScore})`;
      } else if (type === 'RECURRENT_BENIGN') {
        coreFilter = recurrentBenignClause || `(clinvar.rcv.clinical_significance:"Benign" OR clinvar.rcv.clinical_significance:"Likely benign")`;
      } else {
        if (benignClause && pathogenicClause) {
          coreFilter = `(${benignClause} OR ${pathogenicClause})`;
        } else if (benignClause) {
          coreFilter = benignClause;
        } else if (pathogenicClause) {
          coreFilter = pathogenicClause;
        } else {
          coreFilter = `(((clinvar.rcv.clinical_significance:"Benign" OR clinvar.rcv.clinical_significance:"Likely benign") AND dbnsfp.alphamissense.score:>=${minAmPathScore}) OR ((clinvar.rcv.clinical_significance:"Pathogenic" OR clinvar.rcv.clinical_significance:"Likely pathogenic") AND dbnsfp.alphamissense.score:<=${maxAmBenignScore}))`;
        }
      }

      // Star filter
      let starFilter = "";
      if (minStars === 1) {
        starFilter = ` AND (clinvar.rcv.review_status:"criteria provided, single submitter" OR clinvar.rcv.review_status:"criteria provided, multiple submitters, no conflicts" OR clinvar.rcv.review_status:"reviewed by expert panel" OR clinvar.rcv.review_status:"practice guideline")`;
      } else if (minStars === 2) {
        starFilter = ` AND (clinvar.rcv.review_status:"criteria provided, multiple submitters, no conflicts" OR clinvar.rcv.review_status:"reviewed by expert panel" OR clinvar.rcv.review_status:"practice guideline")`;
      } else if (minStars >= 3) {
        starFilter = ` AND (clinvar.rcv.review_status:"reviewed by expert panel" OR clinvar.rcv.review_status:"practice guideline")`;
      }

      // Submissions filter: push down to Elasticsearch index
      let submissionFilter = "";
      if (minSubmissions > 1) {
        submissionFilter = ` AND clinvar.rcv.number_submitters:>=${minSubmissions}`;
      }

      const negation = ` AND -clinvar.rcv.clinical_significance:"Conflicting interpretations" AND -clinvar.rcv.clinical_significance:"conflicting interpretations of pathogenicity"`;

      let allRawHits: any[] = [];
      let totalCountEstimate = 0;
      let totalBenignEstimate = 0;
      let totalPathogenicEstimate = 0;
      let totalRecurrentEstimate = 0;

      const requestedFields = "clinvar,dbnsfp,dbsnp,gnomad_exome.af.af,gnomad_genome.af.af,hg19,hg38";

      const bQuery = `${benignClause || `((clinvar.rcv.clinical_significance:"Benign" OR clinvar.rcv.clinical_significance:"Likely benign") AND dbnsfp.alphamissense.score:>=${minAmPathScore})`}${negation}${starFilter}${submissionFilter}`;
      const pQuery = `${pathogenicClause || `((clinvar.rcv.clinical_significance:"Pathogenic" OR clinvar.rcv.clinical_significance:"Likely pathogenic") AND dbnsfp.alphamissense.score:<=${maxAmBenignScore})`}${negation}${starFilter}${submissionFilter}`;
      const rQuery = `${recurrentBenignClause || `(clinvar.rcv.clinical_significance:"Benign" OR clinvar.rcv.clinical_significance:"Likely benign")`} AND _exists_:dbnsfp.alphamissense.score${negation}${starFilter}${submissionFilter}`;

      // In All Genes mode, fetch genome-wide discordant gene facet counts to accurately determine variant counts per gene
      const facetCacheKey = `${type}_${minStars}_${minSubmissions}_${minAmPathScore}_${maxAmBenignScore}_${includeBenign}_${includeLikelyBenign}_${includePathogenic}_${includeLikelyPathogenic}`;
      let geneFacetCounts = new Map<string, number>();
      if (isAllGenes) {
        geneFacetCounts = await getDiscordantGeneFacetCounts(type, bQuery, pQuery, rQuery, facetCacheKey);
      }

      if (isAllGenes) {
        if (minVariantsPerGene > 0) {
          // Identify all genes that meet/exceed minVariantsPerGene across the full database
          let qualifiedGenes = [...geneFacetCounts.entries()]
            .filter(([_, count]) => count > minVariantsPerGene)
            .sort((a, b) => b[1] - a[1])
            .map(([gene]) => gene);

          // If user searched for a specific gene/term in text search, ensure it's filtered or included
          if (searchQuery && searchQuery.trim()) {
            const sq = searchQuery.trim().toUpperCase();
            const matching = qualifiedGenes.filter(g => g.includes(sq));
            if (matching.length > 0) {
              qualifiedGenes = matching;
            }
          }

          // Query the top qualified genes in chunks to fetch their variants
          const targetGenes = qualifiedGenes.slice(0, 60);
          const CHUNK_SIZE = 30;
          const chunks: string[][] = [];
          for (let i = 0; i < targetGenes.length; i += CHUNK_SIZE) {
            chunks.push(targetGenes.slice(i, i + CHUNK_SIZE));
          }

          const chunkPromises = chunks.map(async (geneChunk) => {
            const geneGroup = geneChunk.join(" OR ");
            if (type === 'ALL') {
              const bChunkQuery = `(clinvar.gene.symbol:(${geneGroup}) OR dbnsfp.genename:(${geneGroup})) AND ${bQuery}`;
              const pChunkQuery = `(clinvar.gene.symbol:(${geneGroup}) OR dbnsfp.genename:(${geneGroup})) AND ${pQuery}`;

              const [bResp, pResp] = await Promise.all([
                fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(bChunkQuery)}&fields=${requestedFields}&size=1000`).then(r => r.ok ? r.json() : { hits: [] }).catch(() => ({ hits: [] })),
                fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(pChunkQuery)}&fields=${requestedFields}&size=1000`).then(r => r.ok ? r.json() : { hits: [] }).catch(() => ({ hits: [] }))
              ]);
              return [...(bResp.hits || []), ...(pResp.hits || [])];
            } else {
              const chunkQuery = `(clinvar.gene.symbol:(${geneGroup}) OR dbnsfp.genename:(${geneGroup})) AND ${coreFilter}${type === 'RECURRENT_BENIGN' ? ' AND _exists_:dbnsfp.alphamissense.score' : ''}${negation}${starFilter}${submissionFilter}`;
              const chunkUrl = `https://myvariant.info/v1/query?q=${encodeURIComponent(chunkQuery)}&fields=${requestedFields}&size=1000`;
              const resp = await fetch(chunkUrl);
              if (!resp.ok) return [];
              const data = await resp.json();
              return data.hits || [];
            }
          });

          const chunkResults = await Promise.all(chunkPromises);
          allRawHits = chunkResults.flat();
          totalCountEstimate = qualifiedGenes.reduce((sum, g) => sum + (geneFacetCounts.get(g) || 0), 0) || allRawHits.length;
        } else {
          // Standard genome-wide streaming sample for page
          if (type === 'ALL') {
            const halfSize = Math.max(25, Math.ceil(pageSize / 2));
            const fromOffset = (page - 1) * halfSize;

            const [bRes, pRes] = await Promise.all([
              fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(bQuery)}&fields=${requestedFields}&size=1000&from=${fromOffset}`).then(r => r.json()).catch(() => ({ hits: [], total: 0 })),
              fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(pQuery)}&fields=${requestedFields}&size=1000&from=${fromOffset}`).then(r => r.json()).catch(() => ({ hits: [], total: 0 }))
            ]);

            totalBenignEstimate = bRes.total || 0;
            totalPathogenicEstimate = pRes.total || 0;
            totalCountEstimate = totalBenignEstimate + totalPathogenicEstimate;
            allRawHits = [...(bRes.hits || []), ...(pRes.hits || [])];
          } else if (type === 'BENIGN_AM_PATHOGENIC') {
            const queryUrl = `https://myvariant.info/v1/query?q=${encodeURIComponent(bQuery)}&fields=${requestedFields}&size=1000&from=${(page - 1) * pageSize}`;
            const mvRes = await fetch(queryUrl);
            const mvData = mvRes.ok ? await mvRes.json() : { hits: [], total: 0 };
            allRawHits = mvData.hits || [];
            totalBenignEstimate = mvData.total || allRawHits.length;
            totalCountEstimate = totalBenignEstimate;
          } else if (type === 'RECURRENT_BENIGN') {
            const queryUrl = `https://myvariant.info/v1/query?q=${encodeURIComponent(rQuery)}&fields=${requestedFields}&size=1000&from=${(page - 1) * pageSize}`;
            const mvRes = await fetch(queryUrl);
            const mvData = mvRes.ok ? await mvRes.json() : { hits: [], total: 0 };
            allRawHits = mvData.hits || [];
            totalRecurrentEstimate = mvData.total || allRawHits.length;
            totalCountEstimate = totalRecurrentEstimate;
          } else {
            const queryUrl = `https://myvariant.info/v1/query?q=${encodeURIComponent(pQuery)}&fields=${requestedFields}&size=1000&from=${(page - 1) * pageSize}`;
            const mvRes = await fetch(queryUrl);
            const mvData = mvRes.ok ? await mvRes.json() : { hits: [], total: 0 };
            allRawHits = mvData.hits || [];
            totalPathogenicEstimate = mvData.total || allRawHits.length;
            totalCountEstimate = totalPathogenicEstimate;
          }
        }
      } else {
        // Chunk gene list in groups of up to 60 genes to avoid URL limits
        const CHUNK_SIZE = 60;
        const chunks: string[][] = [];
        for (let i = 0; i < parsedGenes.length; i += CHUNK_SIZE) {
          chunks.push(parsedGenes.slice(i, i + CHUNK_SIZE));
        }

        const chunkPromises = chunks.map(async (geneChunk) => {
          const geneGroup = geneChunk.join(" OR ");
          if (type === 'ALL') {
            const bChunkQuery = `(clinvar.gene.symbol:(${geneGroup}) OR dbnsfp.genename:(${geneGroup})) AND ${bQuery}`;
            const pChunkQuery = `(clinvar.gene.symbol:(${geneGroup}) OR dbnsfp.genename:(${geneGroup})) AND ${pQuery}`;

            const [bResp, pResp] = await Promise.all([
              fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(bChunkQuery)}&fields=${requestedFields}&size=1000`).then(r => r.ok ? r.json() : { hits: [] }).catch(() => ({ hits: [] })),
              fetch(`https://myvariant.info/v1/query?q=${encodeURIComponent(pChunkQuery)}&fields=${requestedFields}&size=1000`).then(r => r.ok ? r.json() : { hits: [] }).catch(() => ({ hits: [] }))
            ]);
            return [...(bResp.hits || []), ...(pResp.hits || [])];
          } else {
            const chunkQuery = `(clinvar.gene.symbol:(${geneGroup}) OR dbnsfp.genename:(${geneGroup})) AND ${coreFilter}${type === 'RECURRENT_BENIGN' ? ' AND _exists_:dbnsfp.alphamissense.score' : ''}${negation}${starFilter}${submissionFilter}`;
            const chunkUrl = `https://myvariant.info/v1/query?q=${encodeURIComponent(chunkQuery)}&fields=${requestedFields}&size=1000`;
            const resp = await fetch(chunkUrl);
            if (!resp.ok) return [];
            const data = await resp.json();
            return data.hits || [];
          }
        });

        const chunkResults = await Promise.all(chunkPromises);
        allRawHits = chunkResults.flat();
        totalCountEstimate = allRawHits.length;
      }

      // Process and normalize hits
      let processed: any[] = [];
      const seenIds = new Set<string>();

      for (const h of allRawHits) {
        const item = processDiscordantHit(
          h, 
          type, 
          minStars, 
          onlyYeastHomologs, 
          minAmPathScore, 
          maxAmBenignScore, 
          minDioptScore,
          includePathogenic,
          includeLikelyPathogenic,
          includeBenign,
          includeLikelyBenign,
          minSubmissions,
          gnomadFilter
        );
        if (!item) continue;
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);

        // Optional search filter
        if (searchQuery && searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const matchesGene = item.gene.toLowerCase().includes(q);
          const matchesVar = item.hgvsProtein.toLowerCase().includes(q);
          const matchesDisease = item.diseaseOrCondition.toLowerCase().includes(q);
          const matchesYeast = item.yeastOrtholog?.symbol.toLowerCase().includes(q);
          if (!matchesGene && !matchesVar && !matchesDisease && !matchesYeast) continue;
        }

        processed.push(item);
      }

      // Count variants per gene in current response
      const geneVariantCounts = new Map<string, number>();
      for (const v of processed) {
        geneVariantCounts.set(v.gene, (geneVariantCounts.get(v.gene) || 0) + 1);
      }

      // Annotate each variant with authoritative gene variant count from facets or current batch
      for (const v of processed) {
        const facetCount = geneFacetCounts.get(v.gene.toUpperCase());
        const localCount = geneVariantCounts.get(v.gene) || 0;
        v.geneVariantCount = (typeof facetCount === 'number' && facetCount > 0) ? facetCount : (localCount || 1);
      }

      // Optional gene-level variant frequency filter: only show genes with > minVariantsPerGene variants
      if (minVariantsPerGene > 0) {
        processed = processed.filter(v => (v.geneVariantCount || 0) > minVariantsPerGene);
      }

      // Compute statistics
      let benignAmPathCount = 0;
      let pathogenicAmBenignCount = 0;
      let recurrentBenignCount = 0;
      const uniqueGenes = new Set<string>();

      for (const v of processed) {
        if (v.discordanceType === 'BENIGN_AM_PATHOGENIC') benignAmPathCount++;
        if (v.discordanceType === 'PATHOGENIC_AM_BENIGN') pathogenicAmBenignCount++;
        if (v.discordanceType === 'RECURRENT_BENIGN') recurrentBenignCount++;
        uniqueGenes.add(v.gene);
      }

      // Sort
      processed.sort((a, b) => {
        if (sort === 'delta_desc') return b.discordanceDelta - a.discordanceDelta;
        if (sort === 'delta_asc') return a.discordanceDelta - b.discordanceDelta;
        if (sort === 'gene_asc') return a.gene.localeCompare(b.gene);
        if (sort === 'score_desc') return b.amScore - a.amScore;
        if (sort === 'stars_desc') return b.clinVarStars - a.clinVarStars;
        if (sort === 'submissions_desc') return (b.clinVarSubmissions || 0) - (a.clinVarSubmissions || 0);
        if (sort === 'gnomad_desc') return (b.gnomadAf ?? -1) - (a.gnomadAf ?? -1);
        if (sort === 'gnomad_asc') {
          if (a.gnomadAf === null && b.gnomadAf === null) return 0;
          if (a.gnomadAf === null) return -1;
          if (b.gnomadAf === null) return 1;
          return a.gnomadAf - b.gnomadAf;
        }
        return b.discordanceDelta - a.discordanceDelta;
      });

      // Pagination for multi-gene lists
      const paginatedVariants = isAllGenes 
        ? processed 
        : processed.slice((page - 1) * pageSize, page * pageSize);

      // Check if user refined the dataset beyond raw genome index
      const isRefined = onlyYeastHomologs || minDioptScore > 0 || minVariantsPerGene > 0 || minSubmissions > 0 || gnomadFilter !== 'ALL' || !!(searchQuery && searchQuery.trim());
      const effectiveTotal = isAllGenes && !isRefined ? totalCountEstimate : processed.length;

      return res.json({
        total: effectiveTotal,
        rawTotalEstimate: totalCountEstimate,
        returned: paginatedVariants.length,
        page,
        pageSize,
        benignAmPathCount: isAllGenes && !isRefined ? totalBenignEstimate : benignAmPathCount,
        pathogenicAmBenignCount: isAllGenes && !isRefined ? totalPathogenicEstimate : pathogenicAmBenignCount,
        recurrentBenignCount,
        genesCount: uniqueGenes.size,
        variants: paginatedVariants
      });

    } catch (err: any) {
      console.error("Discordant variants endpoint error:", err);
      res.status(500).json({ error: err.message });
    }
  };

  app.get('/api/discordant-variants', handleDiscordantVariantsRequest);
  app.post('/api/discordant-variants', handleDiscordantVariantsRequest);

  // Helper to fetch UniProt entry with canonical accession normalization and symbol fallback
  async function fetchUniProtEntry(id?: any, symbol?: any, organism?: any): Promise<any> {
    const rawId = (typeof id === 'string' && id !== 'N/A' && id !== 'null') ? id.trim() : '';
    const cleanId = rawId ? rawId.split('-')[0].trim() : '';
    const cleanSymbol = (typeof symbol === 'string' && symbol !== 'N/A' && symbol !== 'null') ? symbol.trim() : '';
    const orgId = (organism === 'yeast' || organism === '4932' || organism === '559292') ? '4932' : '9606';

    let data: any = null;

    // 1. Try canonical UniProt ID if provided
    if (cleanId) {
      try {
        const uResp = await fetch(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(cleanId)}.json`, {
          signal: AbortSignal.timeout(6000)
        });
        if (uResp.ok) {
          const json = await uResp.json();
          if (json && (json.features || json.sequence)) data = json;
        }
      } catch {}
    }

    // 2. Fall back to Gene Symbol search if no entry or no features found
    if ((!data || !data.features || data.features.length === 0) && cleanSymbol) {
      try {
        const qReviewed = `(gene_exact:${encodeURIComponent(cleanSymbol)}+OR+gene:${encodeURIComponent(cleanSymbol)})+AND+(taxonomy_id:${orgId}+OR+organism_id:${orgId})+AND+reviewed:true&size=1`;
        const sResp = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=${qReviewed}`, {
          signal: AbortSignal.timeout(6000)
        });
        if (sResp.ok) {
          const sData = await sResp.json();
          if (sData.results && sData.results.length > 0) {
            data = sData.results[0];
          }
        }
        // If still not found, try unreviewed/any
        if (!data) {
          const qAny = `(gene_exact:${encodeURIComponent(cleanSymbol)}+OR+gene:${encodeURIComponent(cleanSymbol)})+AND+(taxonomy_id:${orgId}+OR+organism_id:${orgId})&size=1`;
          const aResp = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=${qAny}`, {
            signal: AbortSignal.timeout(6000)
          });
          if (aResp.ok) {
            const aData = await aResp.json();
            if (aData.results && aData.results.length > 0) {
              data = aData.results[0];
            }
          }
        }
      } catch {}
    }

    return data;
  }

  // --- /api/protein-domains (Proxy and extract UniProt protein domain annotations) ---
  const domainCache = new Map<string, any[]>();
  app.get('/api/protein-domains', async (req, res) => {
    try {
      const { id, symbol, organism = '9606' } = req.query;
      const cacheKey = `${id || symbol}_${organism}`;
      if (domainCache.has(cacheKey)) {
        return res.json({ domains: domainCache.get(cacheKey) });
      }

      const data = await fetchUniProtEntry(id, symbol, organism);
      if (!data) {
        return res.json({ domains: [] });
      }

      const rawFeatures = data.features || [];
      const domains: any[] = [];
      const seen = new Set<string>();

      // Distinct domain colors
      const domainColors = [
        '#6366f1', // indigo
        '#059669', // emerald
        '#d97706', // amber
        '#9333ea', // purple
        '#e11d48', // rose
        '#0284c7', // sky
        '#4f46e5', // violet
        '#0d9488', // teal
        '#ea580c'  // orange
      ];

      let colorIdx = 0;

      for (const f of rawFeatures) {
        const type = f.type;
        const desc = f.description || type;
        const start = f.location?.start?.value;
        const end = f.location?.end?.value;
        if (!start || !end || start > end) continue;

        let isDomain = false;
        if (["Domain", "Zinc finger", "Coiled coil", "Repeat", "DNA binding"].includes(type)) {
          isDomain = true;
        } else if (type === "Region") {
          const lower = desc.toLowerCase();
          if (
            !lower.startsWith("disordered") &&
            !lower.startsWith("interaction with") &&
            !lower.startsWith("required for interaction") &&
            !lower.includes("conflict") &&
            (end - start) >= 5
          ) {
            isDomain = true;
          }
        } else if (type === "Motif" && (end - start) >= 5) {
          isDomain = true;
        }

        if (isDomain) {
          const key = `${desc}_${start}_${end}`;
          if (seen.has(key)) continue;
          seen.add(key);

          domains.push({
            id: `dom_${start}_${end}`,
            name: desc,
            type,
            start,
            end,
            color: domainColors[colorIdx % domainColors.length]
          });
          colorIdx++;
        }
      }

      // Fallback: If no sub-domains, check if there is a Chain feature
      if (domains.length === 0) {
        const chain = rawFeatures.find((f: any) => f.type === 'Chain');
        if (chain && chain.location?.start?.value && chain.location?.end?.value) {
          domains.push({
            id: `dom_chain`,
            name: chain.description || `${symbol || 'Protein'} core`,
            type: 'Chain',
            start: chain.location.start.value,
            end: chain.location.end.value,
            color: domainColors[0]
          });
        }
      }

      domainCache.set(cacheKey, domains);
      return res.json({ domains });
    } catch (err: any) {
      console.warn("Domain fetch error:", err.message);
      return res.json({ domains: [] });
    }
  });

  // --- /api/protein-ptms (Proxy and extract UniProt Post-Translational Modifications) ---
  const ptmCache = new Map<string, any[]>();
  app.get('/api/protein-ptms', async (req, res) => {
    try {
      const { id, symbol, organism = '9606' } = req.query;
      const cacheKey = `${id || symbol}_${organism}`;
      if (ptmCache.has(cacheKey)) {
        return res.json({ ptms: ptmCache.get(cacheKey) });
      }

      const data = await fetchUniProtEntry(id, symbol, organism);
      if (!data) {
        return res.json({ ptms: [] });
      }

      const rawFeatures = data.features || [];
      const ptms: any[] = [];
      const seen = new Set<string>();
      const proteinSeq = data.sequence?.value || '';

      const categorizePtm = (f: any) => {
        const desc = f.description || '';
        const type = f.type || '';
        const lower = desc.toLowerCase();

        if (type === 'Modified residue') {
          if (lower.includes('phospho')) return { category: 'Phosphorylation', badge: 'P', color: '#f59e0b' };
          if (lower.includes('acetyl')) return { category: 'Acetylation', badge: 'Ac', color: '#06b6d4' };
          if (lower.includes('methyl')) return { category: 'Methylation', badge: 'Me', color: '#ec4899' };
          if (lower.includes('ubiquitin')) return { category: 'Ubiquitination', badge: 'Ub', color: '#8b5cf6' };
          if (lower.includes('sumo')) return { category: 'SUMOylation', badge: 'Su', color: '#a855f7' };
          if (lower.includes('succinyl')) return { category: 'Other', badge: 'Suc', color: '#14b8a6' };
          if (lower.includes('hydroxy')) return { category: 'Other', badge: 'OH', color: '#64748b' };
          if (lower.includes('citrullin')) return { category: 'Other', badge: 'Cit', color: '#eab308' };
          return { category: 'Other', badge: 'Mod', color: '#64748b' };
        }
        if (type === 'Glycosylation') return { category: 'Glycosylation', badge: 'Gl', color: '#10b981' };
        if (type === 'Disulfide bond') return { category: 'Disulfide', badge: 'S-S', color: '#f97316' };
        if (type === 'Lipidation') return { category: 'Lipidation', badge: 'Lip', color: '#3b82f6' };
        if (type === 'Cross-link') {
          if (lower.includes('ubiquitin') || lower.includes('glycyl')) return { category: 'Ubiquitination', badge: 'Ub', color: '#8b5cf6' };
          if (lower.includes('sumo')) return { category: 'SUMOylation', badge: 'Su', color: '#a855f7' };
          return { category: 'Other', badge: 'Xl', color: '#8b5cf6' };
        }
        return null;
      };

      for (const f of rawFeatures) {
        const cat = categorizePtm(f);
        if (!cat) continue;
        const start = f.location?.start?.value;
        const end = f.location?.end?.value || start;
        if (!start) continue;

        const key = `${cat.category}_${start}_${end}_${f.description || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const aa = (proteinSeq && start > 0 && start <= proteinSeq.length) ? proteinSeq[start - 1] : undefined;

        ptms.push({
          id: `ptm_${cat.badge}_${start}_${end}`,
          type: f.type,
          category: cat.category,
          badge: cat.badge,
          color: cat.color,
          description: f.description || `${cat.category} site`,
          start,
          end,
          aminoAcid: aa,
          source: (organism === 'yeast' || organism === '4932' || organism === '559292') ? 'yeast' : 'human',
          evidenceCount: Array.isArray(f.evidences) ? f.evidences.length : 1
        });
      }

      // Sort by residue position ascending
      ptms.sort((a, b) => a.start - b.start);

      ptmCache.set(cacheKey, ptms);
      return res.json({ ptms });
    } catch (err: any) {
      console.warn("PTM fetch error:", err.message);
      return res.json({ ptms: [] });
    }
  });

  // --- /api/protein-functional-sites (UniProt Active Sites, Metal/Ligand Binding, SLiMs) ---
  const functionalSitesCache = new Map<string, any[]>();
  app.get('/api/protein-functional-sites', async (req, res) => {
    try {
      const { id, symbol, organism = '9606' } = req.query;
      const cacheKey = `${id || symbol}_${organism}`;
      if (functionalSitesCache.has(cacheKey)) {
        return res.json({ sites: functionalSitesCache.get(cacheKey) });
      }

      let data: any = null;
      if (id && typeof id === 'string' && id !== 'N/A' && id !== 'null') {
        const uResp = await fetch(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(id)}.json`);
        if (uResp.ok) data = await uResp.json();
      }

      if (!data && symbol && typeof symbol === 'string') {
        const isYeast = organism === 'yeast' || organism === '4932' || organism === '559292';
        const queryStr = isYeast
          ? `(gene_exact:${encodeURIComponent(symbol)}+OR+gene:${encodeURIComponent(symbol)})+AND+(taxonomy_id:559292+OR+taxonomy_id:4932)&size=1`
          : `gene_exact:${encodeURIComponent(symbol)}+AND+taxonomy_id:9606+AND+reviewed:true&size=1`;
        
        const sResp = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=${queryStr}`);
        if (sResp.ok) {
          const sData = await sResp.json();
          if (sData.results && sData.results.length > 0) {
            data = sData.results[0];
          }
        }
      }

      if (!data) {
        return res.json({ sites: [] });
      }

      const rawFeatures = data.features || [];
      const sites: any[] = [];
      const seen = new Set<string>();
      const proteinSeq = data.sequence?.value || '';

      const categorizeFunctionalSite = (f: any) => {
        const type = f.type || '';
        const desc = f.description || '';
        const lower = desc.toLowerCase();
        const lig = f.ligand?.name || '';
        const ligLower = lig.toLowerCase();

        // 1. Active / Catalytic Site (ACT_SITE)
        if (type === 'Active site' || lower.includes('catalytic') || lower.includes('active site')) {
          return {
            category: 'ACTIVE_SITE',
            name: 'Active / Catalytic Site',
            label: 'ACT',
            color: '#e11d48',
            description: desc || 'Catalytic residue directly performing enzymatic chemistry'
          };
        }

        // 2. Metal Binding (METAL)
        const isMetalLigand = ligLower.includes('zn') || ligLower.includes('mg') || ligLower.includes('ca') || 
                              ligLower.includes('fe') || ligLower.includes('cu') || ligLower.includes('mn') || 
                              ligLower.includes('ni') || ligLower.includes('co') || ligLower.includes('metal') ||
                              lower.includes('zinc') || lower.includes('magnesium') || lower.includes('iron') || lower.includes('calcium');
        if (type === 'Metal binding' || (type === 'Binding site' && isMetalLigand)) {
          let metalName = lig || (lower.includes('zinc') ? 'Zn(2+)' : lower.includes('magnesium') ? 'Mg(2+)' : lower.includes('iron') ? 'Fe' : 'Metal');
          let label = 'Met';
          if (metalName.includes('Zn') || lower.includes('zinc')) label = 'Zn';
          else if (metalName.includes('Mg') || lower.includes('magnesium')) label = 'Mg';
          else if (metalName.includes('Ca') || lower.includes('calcium')) label = 'Ca';
          else if (metalName.includes('Fe') || lower.includes('iron')) label = 'Fe';
          
          return {
            category: 'METAL_BINDING',
            name: `Metal Binding (${metalName})`,
            label,
            color: '#0d9488',
            description: desc ? `${desc}${lig ? ` (${lig})` : ''}` : (lig ? `Coordinates ${lig}${f.ligand?.note ? ` (${f.ligand.note})` : ''}` : 'Metal coordination site')
          };
        }

        // 3. Ligand & Cofactor Binding (BINDING)
        if (type === 'Binding site') {
          let label = 'Lig';
          if (ligLower.includes('atp') || lower.includes('atp')) label = 'ATP';
          else if (ligLower.includes('gtp') || lower.includes('gtp')) label = 'GTP';
          else if (ligLower.includes('nad') || lower.includes('nad')) label = 'NAD';
          else if (ligLower.includes('fad') || lower.includes('fad')) label = 'FAD';
          else if (ligLower.includes('dna') || lower.includes('dna')) label = 'DNA';
          else if (ligLower.includes('rna') || lower.includes('rna')) label = 'RNA';

          return {
            category: 'BINDING_SITE',
            name: `Binding Site (${lig || 'Substrate / Cofactor'})`,
            label,
            color: '#2563eb',
            description: desc ? `${desc}${lig ? ` (${lig})` : ''}` : (lig ? `Binds ${lig}${f.ligand?.note ? ` (${f.ligand.note})` : ''}` : 'Substrate / cofactor binding site')
          };
        }

        // 4. Short Linear Motifs (SLiMs) (MOTIF, NLS, NES, Degron)
        const isSlim = type === 'Motif' || (type === 'Region' && (
          lower.includes('nls') || lower.includes('nes') || lower.includes('nuclear') || 
          lower.includes('degron') || lower.includes('destruction') || lower.includes('ken box') || 
          lower.includes('d-box') || lower.includes('pest') || lower.includes('motif')
        ));
        if (isSlim) {
          let label = 'SLiM';
          let name = 'Short Linear Motif (SLiM)';
          let color = '#9333ea';

          if (lower.includes('nuclear localization') || lower.includes('nls')) {
            label = 'NLS';
            name = 'Nuclear Localization Signal (NLS)';
            color = '#7c3aed';
          } else if (lower.includes('nuclear export') || lower.includes('nes')) {
            label = 'NES';
            name = 'Nuclear Export Signal (NES)';
            color = '#a855f7';
          } else if (lower.includes('degron') || lower.includes('destruction') || lower.includes('ken box') || lower.includes('d-box')) {
            label = 'DEG';
            name = 'Degron / Destruction Box';
            color = '#ea580c';
          }

          return {
            category: 'SLIM_MOTIF',
            name,
            label,
            color,
            description: desc || name
          };
        }

        // 5. General Functional Sites (SITE)
        if (type === 'Site') {
          return {
            category: 'OTHER_SITE',
            name: 'Functional Site',
            label: 'Site',
            color: '#d97706',
            description: desc || 'Functionally characterized site'
          };
        }

        return null;
      };

      for (const f of rawFeatures) {
        const cat = categorizeFunctionalSite(f);
        if (!cat) continue;
        const start = f.location?.start?.value;
        const end = f.location?.end?.value || start;
        if (!start) continue;

        const key = `${cat.category}_${start}_${end}_${cat.label}_${cat.description}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const aa = (proteinSeq && start > 0 && start <= proteinSeq.length)
          ? proteinSeq.slice(start - 1, end <= proteinSeq.length ? end : start)
          : undefined;

        sites.push({
          id: `site_${cat.category}_${start}_${end}_${sites.length}`,
          type: f.type,
          category: cat.category,
          label: cat.label,
          name: cat.name,
          color: cat.color,
          description: cat.description,
          ligand: f.ligand?.name,
          start,
          end,
          aminoAcid: aa,
          source: (organism === 'yeast' || organism === '4932' || organism === '559292') ? 'yeast' : 'human',
          evidenceCount: Array.isArray(f.evidences) ? f.evidences.length : 1
        });
      }

      sites.sort((a, b) => a.start - b.start);
      functionalSitesCache.set(cacheKey, sites);
      return res.json({ sites });
    } catch (err: any) {
      console.warn("Functional sites fetch error:", err.message);
      return res.json({ sites: [] });
    }
  });

  // --- /api/protein-interfaces (BioGRID Interacting Partners & PDBe-KB 3D Interface Residues) ---
  const interfaceCache = new Map<string, any>();
  const BIOGRID_ACCESS_KEY = process.env.BIOGRID_API_KEY || 'ff6d48bbb2f1de4a5d2297d0d56dbb46';

  app.get('/api/protein-interfaces', async (req, res) => {
    try {
      const { symbol, uniprotId } = req.query;
      if (!symbol && !uniprotId) {
        return res.status(400).json({ error: "Missing symbol or uniprotId" });
      }

      const cacheKey = `${symbol || ''}_${uniprotId || ''}`;
      if (interfaceCache.has(cacheKey)) {
        return res.json(interfaceCache.get(cacheKey));
      }

      // 1. Resolve UniProt ID and Sequence if missing
      let targetUniProt = (uniprotId && typeof uniprotId === 'string' && uniprotId !== 'N/A') ? uniprotId : null;
      let targetSymbol = (symbol && typeof symbol === 'string') ? symbol : '';
      let targetSequence = '';

      if (!targetUniProt && targetSymbol) {
        try {
          const uResp = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${encodeURIComponent(targetSymbol)}+AND+taxonomy_id:9606+AND+reviewed:true&size=1`, {
            signal: AbortSignal.timeout(5000)
          });
          if (uResp.ok) {
            const uData = await uResp.json();
            if (uData.results && uData.results.length > 0) {
              targetUniProt = uData.results[0].primaryAccession;
              targetSequence = uData.results[0].sequence?.value || '';
            }
          }
        } catch {}
      } else if (targetUniProt && !targetSequence) {
        try {
          const uResp = await fetch(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(targetUniProt)}.json`, {
            signal: AbortSignal.timeout(5000)
          });
          if (uResp.ok) {
            const uData = await uResp.json();
            targetSequence = uData.sequence?.value || '';
            if (!targetSymbol) {
              targetSymbol = uData.genes?.[0]?.geneName?.value || targetUniProt;
            }
          }
        } catch {}
      }

      // 2 & 3. Query BioGRID and PDBe-KB in PARALLEL
      const [bgData, pdbeData] = await Promise.all([
        (async () => {
          if (!targetSymbol) return null;
          try {
            const bgUrl = `https://webservice.thebiogrid.org/interactions/?searchNames=true&geneList=${encodeURIComponent(targetSymbol)}&includeInteractors=true&taxId=9606&format=json&accessKey=${BIOGRID_ACCESS_KEY}&max=100`;
            const bgRes = await fetch(bgUrl, { signal: AbortSignal.timeout(6000) });
            if (bgRes.ok) return await bgRes.json();
          } catch (e: any) {
            console.warn("BioGRID fetch warning:", e.message);
          }
          return null;
        })(),
        (async () => {
          if (!targetUniProt) return null;
          try {
            const pdbeUrl = `https://www.ebi.ac.uk/pdbe/graph-api/uniprot/interface_residues/${encodeURIComponent(targetUniProt)}`;
            const pdbeRes = await fetch(pdbeUrl, { signal: AbortSignal.timeout(6000) });
            if (pdbeRes.ok) {
              const j = await pdbeRes.json();
              return j[targetUniProt] || null;
            }
          } catch (e: any) {
            console.warn("PDBe-KB fetch warning:", e.message);
          }
          return null;
        })()
      ]);

      const partnersMap = new Map<string, { partner: string; count: number; exps: Set<string>; pubmeds: Set<string> }>();
      if (bgData) {
        for (const k of Object.keys(bgData)) {
          const it = bgData[k];
          const partner = (it.OFFICIAL_SYMBOL_A === targetSymbol) ? it.OFFICIAL_SYMBOL_B : it.OFFICIAL_SYMBOL_A;
          if (!partner || partner === targetSymbol) continue;
          const cur = partnersMap.get(partner) || { partner, count: 0, exps: new Set(), pubmeds: new Set() };
          cur.count++;
          if (it.EXPERIMENTAL_SYSTEM) cur.exps.add(it.EXPERIMENTAL_SYSTEM);
          if (it.PUBMED_ID) cur.pubmeds.add(String(it.PUBMED_ID));
          partnersMap.set(partner, cur);
        }
      }

      // 4. Resolve partner UniProt IDs to Gene Symbols from PDBe-KB
      const isUniProtAcc = (acc: string) => /^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/i.test(acc);
      const rawAccessions = Array.from(new Set(
        (pdbeData?.data || []).map((d: any) => d.accession).filter((a: string) => a && a !== 'DNA' && a !== 'Other' && a !== targetUniProt && isUniProtAcc(a))
      )) as string[];

      const geneMap: Record<string, { gene: string; fullName?: string }> = {};
      if (rawAccessions.length > 0) {
        try {
          const uRes = await fetch(`https://rest.uniprot.org/uniprotkb/accessions?accessions=${rawAccessions.slice(0, 40).join(',')}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (uRes.ok) {
            const uData = await uRes.json();
            for (const r of uData.results || []) {
              const gene = r.genes?.[0]?.geneName?.value || r.proteinDescription?.recommendedName?.fullName?.value || r.primaryAccession;
              geneMap[r.primaryAccession] = {
                gene,
                fullName: r.proteinDescription?.recommendedName?.fullName?.value
              };
            }
          }
        } catch (e: any) {
          console.warn("UniProt partner batch resolution warning:", e.message);
        }
      }

      // 5. Structure partner interfaces and residues
      const interfacePartners: any[] = [];
      const residueMap = new Map<number, any>();
      const allInterfaceIndices = new Set<number>();

      for (const item of (pdbeData?.data || [])) {
        const isHomomer = item.accession === targetUniProt;
        const isNucleicAcid = item.accession === 'DNA' || item.accession === 'RNA';
        const partnerSymbol = isHomomer 
          ? 'Homomer (Self)' 
          : isNucleicAcid 
          ? item.accession 
          : (geneMap[item.accession]?.gene || item.accession);
        
        const partnerFullName = isHomomer 
          ? 'Self-oligomerization (Homomer interface)' 
          : isNucleicAcid 
          ? `${item.accession} Binding Interface` 
          : (geneMap[item.accession]?.fullName || partnerSymbol);

        const bgInfo = partnersMap.get(partnerSymbol);

        const resSet = new Set<number>();
        const pdbSet = new Set<string>();

        for (const r of (item.residues || [])) {
          const rawIdx = r.startIndex;
          const idx = typeof rawIdx === 'number' ? rawIdx : parseInt(rawIdx, 10);
          if (!isNaN(idx) && idx > 0) {
            resSet.add(idx);
            allInterfaceIndices.add(idx);
            if (Array.isArray(r.interactingPDBEntries)) {
              r.interactingPDBEntries.forEach((p: any) => {
                if (p.pdbId) pdbSet.add(String(p.pdbId).toUpperCase());
              });
            }

            const existing = residueMap.get(idx) || {
              residue: idx,
              aminoAcid: (targetSequence && idx <= targetSequence.length) ? targetSequence[idx - 1] : r.startCode,
              partners: []
            };
            existing.partners.push({
              partnerSymbol,
              partnerUniProt: item.accession,
              partnerFullName,
              pdbIds: Array.isArray(r.interactingPDBEntries) ? r.interactingPDBEntries.map((p: any) => String(p.pdbId).toUpperCase()) : [],
              isHomomer,
              isNucleicAcid,
              bioGridCount: bgInfo?.count || 0
            });
            residueMap.set(idx, existing);
          }
        }

        if (resSet.size > 0) {
          interfacePartners.push({
            partnerSymbol,
            partnerUniProt: item.accession,
            partnerFullName,
            residueCount: resSet.size,
            residues: Array.from(resSet).sort((a, b) => a - b),
            pdbIds: Array.from(pdbSet).slice(0, 12),
            bioGridCount: bgInfo?.count || 0,
            bioGridExps: bgInfo ? Array.from(bgInfo.exps) : [],
            isHomomer,
            isNucleicAcid
          });
        }
      }

      // Sort partners by BioGRID evidence and 3D residue count
      interfacePartners.sort((a, b) => {
        const scoreA = (a.bioGridCount * 10) + a.residueCount + (a.isHomomer ? 50 : 0);
        const scoreB = (b.bioGridCount * 10) + b.residueCount + (b.isHomomer ? 50 : 0);
        return scoreB - scoreA;
      });

      // BioGRID partners summary
      const partnersList = Array.from(partnersMap.values())
        .map(p => ({
          partner: p.partner,
          count: p.count,
          experimentalSystems: Array.from(p.exps),
          pubmedIds: Array.from(p.pubmeds).slice(0, 10),
          hasStructure: interfacePartners.some(ip => ip.partnerSymbol === p.partner)
        }))
        .sort((a, b) => b.count - a.count);

      // Flatten interface residues list
      const interfaceResidues = Array.from(residueMap.values()).sort((a, b) => a.residue - b.residue);

      const responsePayload = {
        symbol: targetSymbol,
        uniprotId: targetUniProt || '',
        partners: partnersList,
        interfacePartners,
        interfaceResidues,
        allInterfaceResidueIndices: Array.from(allInterfaceIndices).sort((a, b) => a - b)
      };

      interfaceCache.set(cacheKey, responsePayload);
      return res.json(responsePayload);
    } catch (err: any) {
      console.warn("Protein interfaces fetch error:", err.message);
      return res.json({
        symbol: '',
        uniprotId: '',
        partners: [],
        interfacePartners: [],
        interfaceResidues: [],
        allInterfaceResidueIndices: []
      });
    }
  });

  // --- Protein Complexes (Complex Portal - Human 9606 & Yeast 559292) API Routes ---
  app.get('/api/complexes/search', (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const species = typeof req.query.species === 'string' ? req.query.species.toLowerCase() : 'all';
      const assembly = typeof req.query.assembly === 'string' ? req.query.assembly : 'all';
      const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string || '20', 10)));

      const normQ = q.toLowerCase();
      const upperQ = q.toUpperCase();

      const assemblyCounts: Record<string, number> = {};
      let humanCount = 0;
      let yeastCount = 0;

      const matched: { complex: ProteinComplexRecord; score: number }[] = [];

      for (const c of allComplexes) {
        if (species !== 'all' && c.species !== species) continue;
        if (assembly !== 'all' && c.assemblyCategory.toLowerCase() !== assembly.toLowerCase()) continue;

        if (c.species === 'human') humanCount++;
        else if (c.species === 'yeast') yeastCount++;
        assemblyCounts[c.assemblyCategory] = (assemblyCounts[c.assemblyCategory] || 0) + 1;

        if (!normQ) {
          matched.push({ complex: c, score: 0 });
          continue;
        }

        let score = 0;
        // 1. Exact or partial complex ID match
        if (c.complexId.toUpperCase() === upperQ) {
          score += 1000;
        } else if (c.complexId.toLowerCase().includes(normQ)) {
          score += 200;
        }

        // 2. Participant exact gene symbol match (highest priority for gene queries like MSH2)
        const exactParticipant = c.participants.some(p => 
          p.symbol.toUpperCase() === upperQ || 
          p.identifier.toUpperCase() === upperQ ||
          p.allGeneNames?.some(g => g.toUpperCase() === upperQ)
        );
        if (exactParticipant) {
          score += 600;
        } else {
          const partialParticipant = c.participants.some(p => 
            p.symbol.toLowerCase().includes(normQ) || 
            p.identifier.toLowerCase().includes(normQ) ||
            p.allGeneNames?.some(g => g.toLowerCase().includes(normQ))
          );
          if (partialParticipant) score += 180;
        }

        // 3. Complex name match
        if (c.name.toLowerCase() === normQ) {
          score += 350;
        } else if (c.name.toLowerCase().includes(normQ)) {
          score += 120;
        }

        // 4. Aliases match
        if (c.aliases.some(a => a.toLowerCase() === normQ)) {
          score += 150;
        } else if (c.aliases.some(a => a.toLowerCase().includes(normQ))) {
          score += 70;
        }

        // 5. Assembly match (e.g., user searches 'dimer', 'heterotrimer', 'tetramer')
        if (c.assembly.toLowerCase().includes(normQ) || c.assemblyCategory.toLowerCase().includes(normQ)) {
          score += 90;
        }

        // 6. Description & GO annotations
        if (c.description.toLowerCase().includes(normQ)) {
          score += 25;
        }
        if (c.goAnnotations.some(g => g.toLowerCase().includes(normQ))) {
          score += 15;
        }

        if (score > 0) {
          matched.push({ complex: c, score });
        }
      }

      // Sort by relevance score desc, then distinct subunits desc
      matched.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.complex.distinctSubunits - a.complex.distinctSubunits;
      });

      const total = matched.length;
      const startIndex = (page - 1) * pageSize;
      const paginated = matched.slice(startIndex, startIndex + pageSize).map(m => m.complex);

      return res.json({
        total,
        returned: paginated.length,
        page,
        pageSize,
        complexes: paginated,
        assemblyCounts,
        speciesCounts: { human: humanCount, yeast: yeastCount }
      });
    } catch (e: any) {
      console.error("Complexes search error:", e);
      return res.status(500).json({ error: e.message || 'Internal error searching complexes' });
    }
  });

  app.get('/api/complexes/gene/:gene', (req, res) => {
    try {
      const gene = req.params.gene?.trim();
      if (!gene) return res.status(400).json({ error: 'Missing gene parameter' });
      const upperGene = gene.toUpperCase();
      const hits = complexGeneIndex.get(upperGene) || [];
      const seen = new Set<string>();
      const uniqueHits = hits.filter(h => {
        if (seen.has(h.complexId)) return false;
        seen.add(h.complexId);
        return true;
      });
      return res.json({
        gene,
        count: uniqueHits.length,
        complexes: uniqueHits
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/complexes/:complexId', (req, res) => {
    try {
      const cid = req.params.complexId?.trim().toUpperCase();
      if (!cid) return res.status(400).json({ error: 'Missing complexId' });
      const found = complexIdMap.get(cid);
      if (!found) return res.status(404).json({ error: `Complex ${cid} not found` });
      return res.json(found);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // --- Search All Variants Across a Whole Protein Complex ---
  const complexVariantsCache = new Map<string, any>();
  const AA3_TO_1: Record<string, string> = {
    Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G',
    His: 'H', Ile: 'I', Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S',
    Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V', Ter: '*'
  };

  app.get('/api/complexes/:complexId/variants', async (req, res) => {
    try {
      const cid = req.params.complexId?.trim().toUpperCase();
      if (!cid) return res.status(400).json({ error: 'Missing complexId' });
      const complex = complexIdMap.get(cid);
      if (!complex) return res.status(404).json({ error: `Complex ${cid} not found` });

      if (complexVariantsCache.has(cid)) {
        return res.json(complexVariantsCache.get(cid));
      }

      // Determine subunit genes to search
      interface SubunitTarget {
        queryGene: string;
        displayGene: string;
        yeastGene?: string;
        identifier: string;
      }
      const targetSubunits: SubunitTarget[] = [];
      const seenGenes = new Set<string>();

      if (complex.species === 'human') {
        for (const p of complex.participants) {
          const gUpper = p.symbol.toUpperCase();
          if (!seenGenes.has(gUpper)) {
            seenGenes.add(gUpper);
            targetSubunits.push({
              queryGene: p.symbol,
              displayGene: p.symbol,
              identifier: p.identifier
            });
          }
        }
      } else {
        // Yeast complex: Map to human orthologs so user can model the whole complex's variants in yeast
        for (const p of complex.participants) {
          const yUpper = p.symbol.toUpperCase();
          const humanOrthologs = yeastToHumanOrthologMap.get(yUpper) || [];
          if (humanOrthologs.length > 0) {
            for (const h of humanOrthologs.slice(0, 2)) {
              if (!seenGenes.has(h)) {
                seenGenes.add(h);
                targetSubunits.push({
                  queryGene: h,
                  displayGene: h,
                  yeastGene: p.symbol,
                  identifier: p.identifier
                });
              }
            }
          } else {
            if (!seenGenes.has(yUpper)) {
              seenGenes.add(yUpper);
              targetSubunits.push({
                queryGene: p.symbol,
                displayGene: p.symbol,
                yeastGene: p.symbol,
                identifier: p.identifier
              });
            }
          }
        }
      }

      // ClinVar API key from environment (kept securely on the server)
      const clinVarApiKey = (process.env.ClinVarAPI || process.env.CLINVAR_API_KEY || process.env.NCBI_API_KEY || '').trim();

      // Query MyVariant.info for all subunits in parallel
      const fields = 'clinvar,dbnsfp.alphamissense,gnomad_genome.af,gnomad_exome.af';
      const subunitResults = await Promise.all(targetSubunits.map(async (sub) => {
        try {
          const url = `https://myvariant.info/v1/query?q=clinvar.gene.symbol:${encodeURIComponent(sub.queryGene)}&fields=${fields}&size=400`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
          if (!resp.ok) return { sub, hits: [] };
          const data = await resp.json();
          return { sub, hits: (data.hits || []) as any[] };
        } catch (e: any) {
          console.warn(`Failed to fetch variants for complex subunit ${sub.queryGene}:`, e.message);
          return { sub, hits: [] };
        }
      }));

      // Parse and normalize variants
      const allVariants: any[] = [];
      const seenVariantIds = new Set<string>();
      const conflictVcvIds: string[] = [];

      for (const { sub, hits } of subunitResults) {
        for (const hit of hits) {
          const cv = hit.clinvar;
          if (!cv) continue;
          const varId = String(cv.variant_id || hit._id || '');
          if (!varId || seenVariantIds.has(varId)) continue;
          seenVariantIds.add(varId);

          const rcvs: any[] = Array.isArray(cv.rcv) ? cv.rcv : (cv.rcv ? [cv.rcv] : []);
          
          // Determine protein change
          let rawProtein = '';
          for (const r of rcvs) {
            if (r?.preferred_name && r.preferred_name.includes('p.')) {
              rawProtein = r.preferred_name;
              break;
            }
          }
          if (!rawProtein) {
            const hgvsProt = cv.hgvs?.protein;
            if (Array.isArray(hgvsProt) && hgvsProt.length > 0) rawProtein = hgvsProt[0];
            else if (typeof hgvsProt === 'string') rawProtein = hgvsProt;
          }
          if (!rawProtein && hit._id) rawProtein = hit._id;

          let proteinChange = 'N/A';
          let residue = 0;
          let refAA = '-';
          let targetAA = '-';

          const pMatch = rawProtein.match(/p\.([A-Za-z]{3}|\b[A-Z]\b)(\d+)([A-Za-z]{3}|\b[A-Z]\b|\*|=|\w+fs)/);
          if (pMatch) {
            const ref3 = pMatch[1];
            const resNum = parseInt(pMatch[2], 10);
            const tgt3 = pMatch[3];
            // Reject termination and frameshift mutations
            if (ref3 === 'Ter' || tgt3 === 'Ter' || tgt3 === '*' || tgt3.includes('fs') || tgt3 === '=') {
              continue;
            }
            residue = resNum;
            refAA = ref3.length === 3 ? (AA3_TO_1[ref3] || ref3) : ref3;
            targetAA = tgt3.length === 3 ? (AA3_TO_1[tgt3] || tgt3) : tgt3;
            if (refAA === '*' || targetAA === '*' || refAA === targetAA) {
              continue;
            }
            proteinChange = `p.${ref3}${resNum}${tgt3}`;
          } else {
            // If it doesn't match standard missense pattern, discard
            continue;
          }

          // Clinical significance terms
          const allSigTerms: string[] = [];
          let maxStars = 0;
          let topReviewStatus = '';
          let primaryRcvId = '';

          for (const r of rcvs) {
            if (r?.clinical_significance) {
              if (Array.isArray(r.clinical_significance)) {
                r.clinical_significance.forEach((s: any) => allSigTerms.push(String(s).toLowerCase().trim()));
              } else {
                allSigTerms.push(String(r.clinical_significance).toLowerCase().trim());
              }
            }
            if (r?.accession && !primaryRcvId) primaryRcvId = r.accession;
            const status = String(r?.review_status || '');
            if (status) {
              let stars = 0;
              const sLow = status.toLowerCase();
              if (sLow.includes('practice guideline')) stars = 4;
              else if (sLow.includes('expert panel')) stars = 3;
              else if (sLow.includes('multiple submitters') && !sLow.includes('conflicting')) stars = 2;
              else if (sLow.includes('criteria provided') || sLow.includes('single submitter')) stars = 1;

              if (stars > maxStars) {
                maxStars = stars;
                topReviewStatus = status;
              } else if (!topReviewStatus) {
                topReviewStatus = status;
              }
            }
          }

          if (allSigTerms.length === 0 && cv.clinical_significance) {
            if (Array.isArray(cv.clinical_significance)) {
              cv.clinical_significance.forEach((s: any) => allSigTerms.push(String(s).toLowerCase().trim()));
            } else {
              allSigTerms.push(String(cv.clinical_significance).toLowerCase().trim());
            }
          }

          const hasExactPathogenic = allSigTerms.some(s => (s === 'pathogenic' || s.startsWith('pathogenic') || s === 'pathogenic/likely pathogenic') && !s.startsWith('likely pathogenic'));
          const hasLikelyPathogenic = allSigTerms.some(s => s.includes('likely pathogenic'));
          const hasExactBenign = allSigTerms.some(s => (s === 'benign' || s.startsWith('benign') || s === 'benign/likely benign') && !s.startsWith('likely benign'));
          const hasLikelyBenign = allSigTerms.some(s => s.includes('likely benign'));
          const hasUncertain = allSigTerms.some(s => s.includes('uncertain'));
          const hasConflicting = allSigTerms.some(s => s.includes('conflicting'));

          const isPathBenignConflict = (hasExactPathogenic || hasLikelyPathogenic) && (hasExactBenign || hasLikelyBenign);
          const isConflicted = hasConflicting || isPathBenignConflict || (hasUncertain && (hasExactPathogenic || hasLikelyPathogenic || hasExactBenign || hasLikelyBenign));

          if (hasConflicting && cv.variant_id) {
            conflictVcvIds.push(String(cv.variant_id));
          }

          let clinicalSignificance = 'Unknown';
          if (isConflicted) clinicalSignificance = 'Conflicting';
          else if (hasExactPathogenic) clinicalSignificance = 'Pathogenic';
          else if (hasLikelyPathogenic) clinicalSignificance = 'Likely Pathogenic';
          else if (hasExactBenign) clinicalSignificance = 'Benign';
          else if (hasLikelyBenign) clinicalSignificance = 'Likely Benign';
          else if (hasUncertain) clinicalSignificance = 'VUS';

          // AlphaMissense Score
          let amScore: number | null = null;
          let amClassification: 'Pathogenic' | 'Benign' | 'Ambiguous' | null = null;
          const amRaw = hit.dbnsfp?.alphamissense?.score;
          if (amRaw !== undefined && amRaw !== null) {
            if (Array.isArray(amRaw)) {
              const nums = amRaw.map(Number).filter(n => !isNaN(n));
              if (nums.length > 0) amScore = parseFloat((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4));
            } else {
              const num = parseFloat(amRaw);
              if (!isNaN(num)) amScore = parseFloat(num.toFixed(4));
            }
          }
          if (amScore !== null) {
            if (amScore >= 0.564) amClassification = 'Pathogenic';
            else if (amScore <= 0.34) amClassification = 'Benign';
            else amClassification = 'Ambiguous';
          }

          // gnomAD Allele Frequency
          let gnomadFreq: number | null = null;
          const gRaw = hit.gnomad_genome?.af || hit.gnomad_exome?.af;
          if (gRaw !== undefined && gRaw !== null) {
            const gNum = parseFloat(Array.isArray(gRaw) ? gRaw[0] : gRaw);
            if (!isNaN(gNum)) gnomadFreq = gNum;
          }

          allVariants.push({
            id: varId,
            gene: sub.displayGene,
            yeastGene: sub.yeastGene,
            uniprotId: sub.identifier,
            proteinChange,
            residue,
            refAA,
            targetAA,
            hgvs: hit._id || '',
            clinicalSignificance,
            isConflictingPathBenign: isPathBenignConflict,
            conflictingSummary: isPathBenignConflict ? `${hasExactPathogenic ? 'Path' : 'Likely Path'} vs ${hasExactBenign ? 'Benign' : 'Likely Benign'}${hasUncertain ? ' (+VUS)' : ''}` : undefined,
            reviewStatus: topReviewStatus || 'criteria provided',
            clinVarStars: maxStars,
            clinVarId: primaryRcvId || '',
            clinVarVariantId: cv.variant_id ? String(cv.variant_id) : undefined,
            amScore,
            amClassification,
            gnomadFreq
          });
        }
      }

      // If conflicting variants exist and ClinVarAPI key is present, resolve detailed assertions for any conflicting variants
      if (conflictVcvIds.length > 0 && clinVarApiKey && conflictVcvIds.length <= 40) {
        try {
          const vcvIdsFormatted = conflictVcvIds.slice(0, 40).map(id => `VCV${id.padStart(9, '0')}`).join(',');
          const vcvUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=clinvar&rettype=vcv&id=${vcvIdsFormatted}&api_key=${encodeURIComponent(clinVarApiKey)}`;
          const vcvRes = await fetch(vcvUrl, { signal: AbortSignal.timeout(6000) });
          if (vcvRes.ok) {
            const vcvXml = await vcvRes.text();
            const archives = vcvXml.match(/<VariationArchive[^>]*>[\s\S]*?<\/VariationArchive>/g) || [];
            for (const arch of archives) {
              const idMatch = arch.match(/VariationID="(\d+)"/);
              if (!idMatch) continue;
              const vid = idMatch[1];
              const classifications = [...arch.matchAll(/<Classification[^>]*>[\s\S]*?<GermlineClassification[^>]*>([^<]+)<\/GermlineClassification>/g)]
                .map(m => m[1].toLowerCase().trim());
              const hasP = classifications.some(c => c.includes('pathogenic') && !c.startsWith('likely'));
              const hasLp = classifications.some(c => c.includes('likely pathogenic'));
              const hasB = classifications.some(c => c.includes('benign') && !c.startsWith('likely'));
              const hasLb = classifications.some(c => c.includes('likely benign'));
              const hasU = classifications.some(c => c.includes('uncertain'));
              const isPbConflict = (hasP || hasLp) && (hasB || hasLb);

              const matching = allVariants.find(v => v.clinVarVariantId === vid);
              if (matching) {
                matching.isConflictingPathBenign = isPbConflict;
                if (isPbConflict) {
                  matching.conflictingSummary = `${hasP ? 'Path' : 'Likely Path'} vs ${hasB ? 'Benign' : 'Likely Benign'}${hasU ? ' (+VUS)' : ''}`;
                }
              }
            }
          }
        } catch (e: any) {
          console.warn("Complex VCV batch resolve note:", e.message);
        }
      }

      // Sort variants: Pathogenic & Conflicting first, then residue order
      const sigOrder: Record<string, number> = {
        'Pathogenic': 1,
        'Likely Pathogenic': 2,
        'Conflicting': 3,
        'VUS': 4,
        'Likely Benign': 5,
        'Benign': 6,
        'Unknown': 7
      };
      allVariants.sort((a, b) => {
        const orderA = sigOrder[a.clinicalSignificance] || 9;
        const orderB = sigOrder[b.clinicalSignificance] || 9;
        if (orderA !== orderB) return orderA - orderB;
        if (a.gene !== b.gene) return a.gene.localeCompare(b.gene);
        return a.residue - b.residue;
      });

      // Calculate subunit statistics
      const subunitsStats = targetSubunits.map(sub => {
        const subVars = allVariants.filter(v => v.gene === sub.displayGene);
        return {
          symbol: sub.displayGene,
          yeastSymbol: sub.yeastGene,
          identifier: sub.identifier,
          variantCount: subVars.length,
          pathCount: subVars.filter(v => v.clinicalSignificance === 'Pathogenic' || v.clinicalSignificance === 'Likely Pathogenic').length,
          vusCount: subVars.filter(v => v.clinicalSignificance === 'VUS').length,
          benignCount: subVars.filter(v => v.clinicalSignificance === 'Benign' || v.clinicalSignificance === 'Likely Benign').length,
          conflictCount: subVars.filter(v => v.clinicalSignificance === 'Conflicting').length
        };
      });

      // Aggregate significance counts
      const significanceCounts: Record<string, number> = {};
      for (const v of allVariants) {
        significanceCounts[v.clinicalSignificance] = (significanceCounts[v.clinicalSignificance] || 0) + 1;
      }

      const responsePayload = {
        complexId: complex.complexId,
        name: complex.name,
        assembly: complex.assembly,
        species: complex.species,
        subunits: subunitsStats,
        totalVariants: allVariants.length,
        variants: allVariants,
        significanceCounts
      };

      complexVariantsCache.set(cid, responsePayload);
      return res.json(responsePayload);
    } catch (err: any) {
      console.error("Failed to fetch complex variants:", err);
      return res.status(500).json({ error: err.message || 'Internal error searching complex variants' });
    }
  });

  // --- Clinician Variant Submission Portal API (Dr. Wasko VUS Intake) ---
  const submissionsFilePath = path.join(process.cwd(), 'clinician_submissions.json');
  const portalConfigPath = path.join(process.cwd(), 'clinician_portal.config.json');

  const getPortalRecipientEmail = (): string => {
    try {
      if (fs.existsSync(portalConfigPath)) {
        const cfg = JSON.parse(fs.readFileSync(portalConfigPath, 'utf-8'));
        if (cfg?.recipientEmail) return cfg.recipientEmail.trim();
      }
    } catch {}
    return (process.env.CLINICIAN_PORTAL_RECIPIENT || 'VUS@wasko.org').trim();
  };

  const loadSubmissions = (): any[] => {
    try {
      if (fs.existsSync(submissionsFilePath)) {
        return JSON.parse(fs.readFileSync(submissionsFilePath, 'utf-8'));
      }
    } catch {}
    return [];
  };

  const saveSubmission = (sub: any) => {
    try {
      const all = loadSubmissions();
      all.unshift(sub);
      fs.writeFileSync(submissionsFilePath, JSON.stringify(all, null, 2), 'utf-8');
    } catch (e: any) {
      console.warn("Failed to write to clinician_submissions.json:", e.message);
    }
  };

  // PubMed Variant Search Helper for Grounded Scientific Literature
  const searchPubMedForVariant = async (
    geneSymbol: string,
    missenseAllele: string,
    pos?: number,
    ref?: string,
    target?: string
  ): Promise<Array<{
    pmid: string;
    title: string;
    authors: string;
    source: string;
    pubdate: string;
    doi?: string;
    url: string;
  }>> => {
    const articles: Array<any> = [];
    try {
      const gene = geneSymbol.trim();
      const terms: string[] = [];
      if (ref && pos && target) {
        terms.push(`"${ref}${pos}${target}"`);
      }
      const cleanAllele = missenseAllele.replace(/^p\./, '').trim();
      if (cleanAllele) {
        terms.push(`"${cleanAllele}"`);
      }
      if (pos) {
        terms.push(`"${pos}"`);
      }

      const queryTerm = terms.length > 0
        ? `${gene} AND (${terms.slice(0, 3).join(' OR ')})`
        : `${gene} AND "${missenseAllele}"`;

      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(queryTerm)}&retmode=json&retmax=4`;
      const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(4000) });
      if (!searchRes.ok) return [];
      const searchData = await searchRes.json();
      const idList: string[] = searchData?.esearchresult?.idlist || [];

      if (idList.length === 0) return [];

      const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${idList.join(',')}&retmode=json`;
      const summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(4000) });
      if (!summaryRes.ok) return [];
      const summaryData = await summaryRes.json();
      const results = summaryData?.result || {};

      for (const pmid of idList) {
        const doc = results[pmid];
        if (!doc) continue;
        const authors = Array.isArray(doc.authors) && doc.authors.length > 0
          ? `${doc.authors[0].name}${doc.authors.length > 1 ? ' et al.' : ''}`
          : 'Authors not listed';
        const title = doc.title || 'Untitled publication';
        const source = doc.source || doc.fulljournalname || '';
        const pubdate = doc.pubdate || doc.sortpubdate?.slice(0, 4) || '';
        const doi = doc.articleids?.find((a: any) => a.idtype === 'doi')?.value;

        articles.push({
          pmid,
          title: title.replace(/\.$/, ''),
          authors,
          source,
          pubdate,
          doi,
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
        });
      }
    } catch (err: any) {
      console.warn('[PubMed Search] Note:', err?.message || err);
    }
    return articles;
  };

  app.post('/api/clinician-submission', async (req, res) => {
    try {
      const {
        clinicianName,
        clinicianEmail,
        clinicianInstitution,
        geneSymbol,
        missenseAllele,
        notes,
        conservation,
        clinicianEvaluation,
        physicianEvaluation
      } = req.body;

      if (!geneSymbol || !missenseAllele) {
        return res.status(400).json({ error: 'Missing required submission fields (geneSymbol, missenseAllele)' });
      }

      const recipientEmail = getPortalRecipientEmail();
      const submissionId = `SUB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const timestamp = new Date().toISOString();
      const evalText = clinicianEvaluation || physicianEvaluation;

      const record = {
        id: submissionId,
        timestamp,
        clinicianName: clinicianName ? String(clinicianName).trim() : 'Clinician (Portal Submitter)',
        clinicianEmail: clinicianEmail ? String(clinicianEmail).trim() : 'vus-intake@wasko.org',
        clinicianInstitution: clinicianInstitution ? String(clinicianInstitution).trim() : undefined,
        geneSymbol: String(geneSymbol).trim().toUpperCase(),
        missenseAllele: String(missenseAllele).trim(),
        notes: notes ? String(notes).trim() : undefined,
        clinicianEvaluation: evalText ? String(evalText).trim() : undefined,
        physicianEvaluation: evalText ? String(evalText).trim() : undefined,
        conservation: conservation || {},
        recipientEmail,
        emailSent: false
      };

      // Email dispatch
      let emailResult = { sent: false, error: '' };
      const smtpHost = process.env.SMTP_HOST;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);

      const emailSubject = `[Conserved VUS Submission] ${record.geneSymbol} ${record.missenseAllele}`;
      const emailBodyText = `CLINICIAN VARIANT SUBMISSION (BUDDY)
=====================================
Submission ID: ${submissionId}
Timestamp: ${timestamp}

SUBMITTED VARIANT:
- Human Gene: ${record.geneSymbol}
- Missense Allele: ${record.missenseAllele}

CONSERVATION IN YEAST (S. cerevisiae):
- Status: ${conservation?.conservationStatus || 'Conserved'}
- Yeast Ortholog: ${conservation?.yeastGene || 'N/A'} (DIOPT Score: ${conservation?.dioptScore ?? 'N/A'})
- Aligned Yeast Residue: ${conservation?.yeastAA || ''}${conservation?.yeastPos || ''}
- Local Homology: ${conservation?.localHomologyScore !== undefined ? `${conservation.localHomologyScore}%` : 'N/A'}

${record.clinicianEvaluation ? `AI CLINICIAN MODELING EVALUATION (GEMINI PRO):
=====================================
${record.clinicianEvaluation}
=====================================
\n` : ''}ADDITIONAL NOTES:
${record.notes || 'None provided.'}

=====================================
Automated notification from the BUDDY Clinician Variant Submission Portal.
Target recipient: ${recipientEmail}`;

      if (smtpHost && smtpUser && smtpPass) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass }
          });
          await transporter.sendMail({
            from: `"BUDDY Clinician Portal" <${smtpUser}>`,
            to: recipientEmail,
            replyTo: record.clinicianEmail,
            subject: emailSubject,
            text: emailBodyText
          });
          emailResult = { sent: true, error: '' };
          record.emailSent = true;
        } catch (e: any) {
          console.warn("[Clinician Portal] SMTP send error:", e.message);
          emailResult = { sent: false, error: e.message };
        }
      } else {
        console.log(`[Clinician Portal] Submission ${submissionId} recorded for ${recipientEmail}. (Saved to clinician_submissions.json).`);
      }

      saveSubmission(record);

      const mailtoUrl = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBodyText)}`;

      return res.json({
        success: true,
        submissionId,
        recipientEmail,
        emailSent: emailResult.sent,
        emailError: emailResult.error || undefined,
        mailtoUrl,
        record
      });
    } catch (e: any) {
      console.error("Submission processing error:", e);
      return res.status(500).json({ error: e.message || 'Internal server error processing submission' });
    }
  });

  app.get('/api/clinician-submissions', (req, res) => {
    try {
      const submissions = loadSubmissions();
      return res.json({ count: submissions.length, submissions });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // Clinician Variant Model Evaluation using Gemini Pro with Grounded Search & AM Score Review
  app.post('/api/clinician-model-evaluation', async (req, res) => {
    try {
      const {
        geneSymbol,
        missenseAllele,
        clinicalNotes,
        alignmentInfo,
        variantInfo,
        phenotypes,
        structureImage
      } = req.body;

      if (!geneSymbol || !missenseAllele) {
        return res.status(400).json({ error: 'Missing geneSymbol or missenseAllele for clinician evaluation.' });
      }

      // Grounded PubMed search for specific variant
      const pubmedArticles = await searchPubMedForVariant(
        geneSymbol,
        missenseAllele,
        alignmentInfo?.pos,
        alignmentInfo?.canonicalRefAA || alignmentInfo?.refAA,
        alignmentInfo?.targetAA
      );

      const pubmedSummary = pubmedArticles.length > 0
        ? pubmedArticles.map((a, idx) => `[${idx + 1}] "${a.title}" - ${a.authors} (${a.source}, ${a.pubdate}). PMID: ${a.pmid}. DOI: ${a.doi || 'N/A'}`).join('\n')
        : 'No variant-specific publications directly cataloged for this exact codon in PubMed index.';

      const phenoList = Array.isArray(phenotypes) && phenotypes.length > 0
        ? phenotypes.slice(0, 8).map((p: any) => `- ${p.phenotype}${p.category ? ` (Category: ${p.category})` : ''}`).join('\n')
        : 'No specific phenotype anomalies logged in SGD.';

      const alignmentSnippetText = alignmentInfo?.alignmentSnippet
        ? `Alignment Window:\n  Human: ${alignmentInfo.alignmentSnippet.humanSeq}\n  Match: ${alignmentInfo.alignmentSnippet.matchLine}\n  Yeast: ${alignmentInfo.alignmentSnippet.yeastSeq}`
        : 'N/A';

      const amScoreVal = variantInfo?.amScore !== undefined && variantInfo?.amScore !== null ? variantInfo.amScore : null;
      const amPredVal = variantInfo?.amPred || (amScoreVal !== null ? (amScoreVal >= 0.56 ? 'Likely Pathogenic' : amScoreVal <= 0.34 ? 'Likely Benign' : 'Ambiguous') : null);
      const amScoreDisplay = amScoreVal !== null ? `${amScoreVal} (${amPredVal || 'Prediction'})` : 'Score not available for this variant';

      const promptText = `You are a clinical genomics and yeast functional biology consultant assisting a clinician / clinical geneticist.
Evaluate whether Saccharomyces cerevisiae (budding yeast) is an informative experimental model system to characterize this patient variant of uncertain significance (VUS).

CLINICAL VARIANT PROFILE:
- Human Gene: ${geneSymbol}
- Missense Allele: ${missenseAllele}
- Additional Notes: ${clinicalNotes || 'Variant under investigation.'}

ALPHASENSE & CLINICAL PREDICTIONS (CRITICAL FOR REVIEW):
- AlphaMissense In Silico Score: ${amScoreDisplay} (Interpretation threshold: >0.56 Likely Pathogenic, <0.34 Likely Benign, 0.34-0.56 Ambiguous)
- ClinVar Classification: ${variantInfo?.clinicalSignificance || 'Uncertain significance'} ${variantInfo?.clinVarStars !== undefined ? `(${variantInfo.clinVarStars}★)` : ''}
- gnomAD Population Frequency: ${variantInfo?.gnomadAf !== undefined && variantInfo?.gnomadAf !== null ? variantInfo.gnomadAf : 'Rare / Absent'}

EVOLUTIONARY CONSERVATION & ORTHOLOGY (BUDDY PIPELINE):
- Yeast Ortholog: ${alignmentInfo?.yeastGene || 'S. cerevisiae ortholog'} (DIOPT Score: ${alignmentInfo?.dioptScore ?? 'N/A'}/16)
- Residue Mapping: Human ${alignmentInfo?.canonicalRefAA || ''}${alignmentInfo?.pos || ''} -> Yeast ${alignmentInfo?.yeastAA || ''}${alignmentInfo?.yeastPos || ''}
- Conservation Status: ${alignmentInfo?.conservationStatus || 'Evaluated'}
- Local Homology Score: ${alignmentInfo?.localHomologyScore !== undefined ? `${alignmentInfo.localHomologyScore}%` : 'N/A'}
- ${alignmentSnippetText}

YEAST PHENOTYPES FOR ORTHOLOG (SGD):
${phenoList}

GROUNDED PUBMED LITERATURE SEARCH ON THIS VARIANT:
${pubmedSummary}

${structureImage ? 'A 2D rendering of the 3D structural superposition of the human protein and its yeast ortholog (with the variant highlighted) is attached.' : ''}

TASK FOR GEMINI:
Write an exceptionally CONCISE, direct, plain-English clinical evaluation for the attending clinician.
Do NOT write long disclaimers. Do NOT include a #4 paragraph. Output EXACTLY these 3 numbered sections:

### 1. Clinician Executive Verdict: Yeast Model Feasibility
- Direct bottom line & recommendation: State clearly whether prospective modeling in yeast is **STRONGLY RECOMMENDED**, **POTENTIALLY INFORMATIVE**, or **UNNECESSARY / NOT RECOMMENDED** for ${geneSymbol} ${missenseAllele}.
- Crucial clinical evidence check: In your decision whether to recommend modeling or not in yeast, consider existing evidence. If solid, definitive data already exists (e.g., well-established pathogenic or benign classification in ClinVar with multiple submitters/expert review, deep mutational scanning [DMS / MaveDB] datasets, or clear published functional literature), there is LESS clinical need to model in yeast. Conversely, if the variant lacks functional literature and sits at a conserved position, prospective yeast functional modeling has high clinical value.
- 1-2 punchy sentences summarizing the verdict.

### 2. Biological Conservation & AlphaMissense Review
- Explicitly review the AlphaMissense (AM) score (${amScoreDisplay}). Clarify if it predicts pathogenic, benign, or ambiguous, and evaluate whether yeast evolutionary conservation (${alignmentInfo?.conservationStatus || 'Evaluated'}, local homology: ${alignmentInfo?.localHomologyScore !== undefined ? `${alignmentInfo.localHomologyScore}%` : 'N/A'}) corroborates this in silico prediction.
- Grounded PubMed literature: mention whether published PubMed literature exists for this variant (${pubmedArticles.length > 0 ? `found ${pubmedArticles.length} relevant PubMed paper(s)` : 'no literature characterization in PubMed for this codon, highlighting the clinical need for prospective functional modeling'}).

### 3. Feasible Yeast Assays & Phenotypic Readouts
- Direct experimental strategy (e.g. humanized cDNA rescue of null strain vs CRISPR-Cas9 editing of orthologous locus).
- Specific yeast functional readout(s) available to distinguish pathogenic loss-of-function from benign variation (e.g. mutator assay, auxotrophic growth on selective/stress plates, temperature sensitivity).

Tone: Sharp, professional, accessible to clinicians and medical geneticists. Total length: under 200 words. Absolutely no #4 section.
Typography rule: Do NOT bold all text. Write standard regular weight text. Never wrap full sentences, entire bullet points, or paragraphs in double asterisks (**). Bold ONLY the bottom-line verdict status (e.g. **STRONGLY RECOMMENDED**, **POTENTIALLY INFORMATIVE**, or **UNNECESSARY / NOT RECOMMENDED**). All other descriptions and sentences must be in normal plain font.`;

      const parts: any[] = [{ text: promptText }];

      if (structureImage && typeof structureImage === 'string') {
        const match = structureImage.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2]
            }
          });
        }
      }

      const ai = getAi();
      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          contents: { parts },
          config: {
            tools: [{ googleSearch: {} }]
          }
        });
      } catch (proErr: any) {
        const formatted = formatGeminiError(proErr);
        if (formatted.statusCode === 401) throw proErr;
        console.warn("gemini-3.1-pro-preview failed with search tool, falling back to gemini-3.8-flash:", proErr.message);
        try {
          response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: { parts },
            config: {
              tools: [{ googleSearch: {} }]
            }
          });
        } catch (flashErr: any) {
          response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: { parts }
          });
        }
      }

      const evaluationText = response?.text || 'Evaluation generated successfully.';
      return res.json({
        success: true,
        evaluationText,
        pubmedArticles
      });
    } catch (err: any) {
      console.error("Clinician Model Evaluation Error:", err);
      const { message, statusCode } = formatGeminiError(err);
      return res.status(statusCode).json({ error: message, message, status: statusCode });
    }
  });

// Helper to format Gemini API errors into clean, actionable messages
function formatGeminiError(err: any): { message: string; statusCode: number } {
  let rawMsg = String(err?.message || err || 'Gemini API Error');
  let statusCode = err?.status || 500;

  // Try to parse nested JSON error if present in err.message
  try {
    const jsonMatch = rawMsg.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.error?.message) {
        rawMsg = parsed.error.message;
      }
      if (parsed?.error?.code) {
        statusCode = parsed.error.code;
      }
    }
  } catch {
    // Keep rawMsg as is
  }

  if (rawMsg.includes('ACCOUNT_STATE_INVALID') || rawMsg.includes('The bound service account is deleted or disabled')) {
    return {
      message: 'Gemini Authentication Error (401): The Google Cloud service account bound to your GEMINI_API_KEY has been deleted or disabled in Google Cloud Console. To fix this:\n1. Open Google Cloud Console (console.cloud.google.com) > "IAM & Admin" > "Service Accounts" and re-enable any disabled service accounts (e.g. default compute/app engine service account).\n2. Or generate a fresh API key at aistudio.google.com/apikey (or in GCP Credentials) and update your GEMINI_API_KEY secret / environment variable.',
      statusCode: 401
    };
  }

  if (rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('API key not valid') || rawMsg.includes('API_KEY_MISSING')) {
    const rawKey = process.env.GEMINI_API_KEY?.trim() || '';
    const masked = rawKey.length > 8 ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}` : '(none)';
    console.warn(`[Security Diagnostic] Server is currently using key: [${masked}]`);
    return {
      message: `Gemini Authentication Error (401): The configured Gemini API key is invalid or revoked. If you recently updated your secret in AI Studio, please refresh the AI Studio browser tab or reopen the app so the server environment picks up your new secret, and confirm the Generative Language API is enabled on your Google Cloud project.`,
      statusCode: 401
    };
  }

  if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) {
    return {
      message: 'Gemini Quota Exceeded (429): Rate limit or quota reached. Please wait a minute and retry, or use a paid API key.',
      statusCode: 429
    };
  }

  return { message: rawMsg, statusCode };
}

  // Proxy /api/searchGenesByAi
  app.post('/api/searchGenesByAi', async (req, res) => {
    try {
      const { topic, speciesName } = req.body;
      const ai = getAi();
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Identify the top 30 most scientifically relevant ${speciesName} genes associated with the topic: "${topic}". Return strictly a JSON list of gene symbols.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        symbol: { type: Type.STRING },
                        reason: { type: Type.STRING, description: "Very brief (5 words) reason for relevance." }
                    }
                }
            }
        }
      });
      res.json({ text: response.text });
    } catch (err: any) {
      console.error("Gemini Search Error:", err);
      const { message, statusCode } = formatGeminiError(err);
      res.status(statusCode).json({ error: message, message, status: statusCode });
    }
  });

  // Proxy /api/generateExperimentalPlan
  app.post('/api/generateExperimentalPlan', async (req, res) => {
      try {
          const { parts, stream } = req.body;
          const ai = getAi();
          
          if (stream === false) {
             let response;
             try {
                response = await ai.models.generateContent({
                   model: 'gemini-3.1-pro-preview', 
                   contents: { parts },
                   config: { tools: [{ googleSearch: {} }] },
                });
             } catch (proErr: any) {
                const formatted = formatGeminiError(proErr);
                // If 401 auth error, fail immediately without trying another model
                if (formatted.statusCode === 401) throw proErr;
                console.warn("gemini-3.1-pro-preview failed, attempting fallback to gemini-3.8-flash:", proErr.message);
                response = await ai.models.generateContent({
                   model: 'gemini-3.8-flash', 
                   contents: { parts },
                   config: { tools: [{ googleSearch: {} }] },
                });
             }
             
             let groundingChunks = [];
             if (response.candidates?.[0]?.groundingMetadata?.groundingChunks) {
                groundingChunks = response.candidates[0].groundingMetadata.groundingChunks;
             }
             return res.json({ text: response.text, groundingChunks });
             
          } else {
             // Streaming logic
             let responseStream;
             try {
                responseStream = await ai.models.generateContentStream({
                   model: 'gemini-3.1-pro-preview', 
                   contents: { parts },
                   config: { tools: [{ googleSearch: {} }] },
                });
             } catch (proErr: any) {
                const formatted = formatGeminiError(proErr);
                // If 401 auth error, fail immediately without trying another model
                if (formatted.statusCode === 401) throw proErr;
                console.warn("gemini-3.1-pro-preview stream failed, falling back to gemini-3.8-flash:", proErr.message);
                responseStream = await ai.models.generateContentStream({
                   model: 'gemini-3.8-flash', 
                   contents: { parts },
                   config: { tools: [{ googleSearch: {} }] },
                });
             }
             
             res.setHeader('Content-Type', 'text/event-stream');
             res.setHeader('Cache-Control', 'no-cache');
             res.setHeader('Connection', 'keep-alive');
             
             for await (const chunk of responseStream) {
                let groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
                const payload = { text: chunk.text, groundingChunks };
                res.write(`data: ${JSON.stringify(payload)}\n\n`);
             }
             res.end();
          }
      } catch (err: any) {
          console.error("Gemini Request Error:", err);
          const { message, statusCode } = formatGeminiError(err);
          
          // If headers haven't been sent, return JSON.
          if (!res.headersSent) {
              res.status(statusCode).json({ message, error: message, status: statusCode });
          } else {
              res.write(`data: ${JSON.stringify({ error: message, status: statusCode })}\n\n`);
              res.end();
          }
      }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get(['/VUS', '/VUS/*', '/vus', '/vus/*'], (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
