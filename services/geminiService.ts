
import { Variant, Phenotype, AdvancedSettings } from '../types';

export interface VariantResidueAnnotations {
  ptms?: { category: string; description: string; color?: string; badge?: string }[];
  sites?: { category: string; label: string; name: string; description: string; ligand?: string; color?: string }[];
  interfaces?: { partnerSymbol: string; fullName?: string; bioGridCount: number; pdbIds: string[] }[];
  domains?: { name: string; color?: string }[];
}

export const generateExperimentalPlan = async (
  humanGene: string,
  yeastGene: string,
  phenotypes: Phenotype[],
  variants: Variant[],
  onUpdate: (text: string) => void,
  selectedVariants?: Variant[],
  selectedPhenotype?: string | null,
  settings?: AdvancedSettings['ai'],
  metrics?: {
    dioptScore?: number;
    percentIdentity?: number;
    percentSimilarity?: number;
  },
  structureImage?: string | null,
  annotationsMap?: Map<number, VariantResidueAnnotations>
): Promise<void> => {
  
  const phenoText = phenotypes.map(p => 
    `- ${p.phenotype} (Category: ${p.category || 'Unknown'}, Source: ${p.reference || 'Unknown'})`
  ).join("\n") || "None found.";
  const conservedCount = variants.filter(v => v.conservedStatus === 'Identical').length;

  let variantContext = `Total VUS Count: ${variants.length}. ${conservedCount} are at identical residues.`;
  
  if (selectedVariants && selectedVariants.length > 0) {
    variantContext += `\n\n*** FOCUS ANALYSIS ON SELECTED VARIANT(S): ***`;
    selectedVariants.forEach((sv, idx) => {
        const resNum = Number(sv.residue);
        const annot = (!isNaN(resNum) && annotationsMap) ? annotationsMap.get(resNum) : undefined;

        variantContext += `\n[Variant ${idx + 1}] Human ${sv.proteinChange} (Ref: ${sv.refAA} -> Mut: ${sv.targetAA}) which maps to Yeast Residue ${sv.yeastAA} at position ${sv.yeastPos} (Human Residue #${resNum}).`;
        if (sv.localHomologyScore !== undefined) {
          variantContext += `\n   - Local Homology Score: ${sv.localHomologyScore}% (Percent of identical/similar residues in a 13-aa window centered on variant).`;
        }
        if (sv.amScore !== null && sv.amScore !== undefined) {
          variantContext += `\n   - AlphaMissense Score: ${sv.amScore} (Scale 0-1. Interpret context: <0.34 Likely Benign, 0.34-0.56 Ambiguous, >0.56 Likely Pathogenic).`;
        }
        if (sv.clinicalSignificance) {
          variantContext += `\n   - ClinVar Clinical Significance: ${sv.clinicalSignificance}${sv.clinVarStars !== undefined ? ` (${sv.clinVarStars}★ Stars)` : ''}.`;
        }

        // Additional variant table Site, Domain, PTM, and Interface information at the variant position
        if (annot) {
          // 1. Protein Domains
          if (annot.domains && annot.domains.length > 0) {
            const domainNames = annot.domains.map(d => d.name).join(', ');
            variantContext += `\n   - Protein Domain at Position ${resNum}: ${domainNames}`;
          } else {
            variantContext += `\n   - Protein Domain at Position ${resNum}: None explicitly assigned (inter-domain loop / unstructured region)`;
          }

          // 2. Functional Sites & Motifs
          if (annot.sites && annot.sites.length > 0) {
            const siteDescriptions = annot.sites.map(s => {
              let label = s.name;
              if (s.category === 'ACTIVE_SITE') label = `Active Site (${s.name})`;
              else if (s.category === 'METAL_BINDING') label = `Metal Binding: ${s.ligand || s.name}`;
              else if (s.category === 'BINDING_SITE') label = `Binding Site: ${s.ligand || s.name}`;
              else if (s.category === 'SLIM_MOTIF') label = `SLiM Motif: ${s.label || s.name}`;
              
              if (s.description && s.description !== s.name) {
                label += ` - ${s.description}`;
              }
              return label;
            }).join('; ');
            variantContext += `\n   - Functional Site(s) at Position ${resNum}: ${siteDescriptions}`;
          } else {
            variantContext += `\n   - Functional Site(s) at Position ${resNum}: None specifically annotated`;
          }

          // 3. Post-Translational Modifications (PTMs)
          if (annot.ptms && annot.ptms.length > 0) {
            const ptmDescriptions = annot.ptms.map(p => {
              return p.description ? `${p.category} (${p.description})` : p.category;
            }).join('; ');
            variantContext += `\n   - Post-Translational Modification(s) (PTM) at Position ${resNum}: ${ptmDescriptions}`;
          }

          // 4. 3D Contact Interfaces
          if (annot.interfaces && annot.interfaces.length > 0) {
            const intfDescriptions = annot.interfaces.map(i => {
              const partner = i.partnerSymbol === 'Homomer (Self)' ? 'Homomer (Self-interaction)' : i.partnerSymbol;
              let desc = `Interface with ${partner}`;
              if (i.fullName) desc += ` (${i.fullName})`;
              if (i.bioGridCount > 0) desc += ` [${i.bioGridCount} BioGRID physical interaction reports]`;
              if (i.pdbIds && i.pdbIds.length > 0) desc += ` [PDB structures: ${i.pdbIds.slice(0, 3).join(', ')}]`;
              return desc;
            }).join('; ');
            variantContext += `\n   - 3D Contact Interface(s) at Position ${resNum}: ${intfDescriptions}`;
          }
        }
    });
  } else {
    variantContext += `\nNo specific variant selected; provide a general approach for the most conserved variants.`;
  }


  let metricsContext = "";
  if (metrics) {
      metricsContext = `
    CONSERVATION METRICS:
    - DIOPT Score: ${metrics.dioptScore ?? 'N/A'} (Score indicating orthology confidence)
    - Global Protein Percent Identity: ${metrics.percentIdentity ? metrics.percentIdentity.toFixed(1) + '%' : 'N/A'}
    - Global Protein Percent Similarity: ${metrics.percentSimilarity ? metrics.percentSimilarity.toFixed(1) + '%' : 'N/A'}
      `;
  }

  let phenotypeContext = `Yeast LOF Phenotypes: ${phenoText}`;
  if (selectedPhenotype) {
      const activeObj = phenotypes.find(p => p.phenotype === selectedPhenotype);
      const studyInfo = activeObj?.studyTypeLabel ? ` [Study Origin: ${activeObj.studyTypeLabel}]` : '';
      const refInfo = activeObj?.reference ? ` [Primary Reference: ${activeObj.reference}]` : '';
      phenotypeContext += `\n\n*** USER SELECTED PHENOTYPE: "${selectedPhenotype}"${studyInfo}${refInfo}. ***`;
      // Enhanced instruction for vague phenotypes
      phenotypeContext += `\n\n[MANDATORY SEARCH TASK]: The selected phenotype "${selectedPhenotype}" might be vague (e.g., "resistance to chemicals", "ionic stress", "decreased growth").\nYOU MUST USE GOOGLE SEARCH to cross-reference the yeast gene "${yeastGene}" with this "${selectedPhenotype}" to find specific details in primary scientific literature.\n- If the "${selectedPhenotype}" is "resistance to chemicals", find EXACTLY which chemicals (e.g., rapamycin, caffeine, hydroxyurea).\n- If "ionic stress", find which ions (e.g., Mn2+, Ca2+).\n- Update the Experimental Assay Proposal to use these SPECIFIC agents/conditions found in the literature. Include an in-line citation of the paper related to the phenotype.`;
  }

  // Advanced Context & Safety Logic
  let advancedContext = "";
  const safetyLevel = settings?.safetyLevel || 'CLASSROOM_SAFE'; // Default to safe if not provided

  if (settings) {
      if (settings.labResources && settings.labResources.length > 0) {
          advancedContext += `\nSPECIFIC LAB EQUIPMENT AVAILABLE: ${settings.labResources.join(', ')}. IF relevant to the phenotype, prioritize assays that use this equipment over generic ones.`;
      }
      if (settings.assayPreference !== 'ANY') {
          advancedContext += `\nPreferred Assay Type: ${settings.assayPreference}.`;
      }
  }

  // Define constraints based on Safety Level enviornment (teaching lab vs research lab)
  let safetyInstructions = "";
  let phenotypeInstructions = "";

  if (safetyLevel === 'CLASSROOM_SAFE') {
      safetyInstructions = `SAFETY CONSTRAINT: STRICT CLASSROOM SAFETY. Do not suggest assays involving highly toxic chemicals (e.g. Cadmium, Methotrexate, Cycloheximide) unless necessary and handleable with gloves/goggles in a teaching lab (or suggest a safer analog). If a specific toxic chemical is identified from the search task above, suggest a safer alternative if possible, or clearly state safety warnings. Toxicity to yeast is OK, but it should not be highly toxic to humans.`;
      
      if (selectedPhenotype) {
          phenotypeInstructions = `You must first evaluate if the selected phenotype "${selectedPhenotype}" (and any specific details found via web search) is practical (easy, cost-effective, safe) for a standard teaching lab. If it is NOT safe or practical, explain why and recommend a better, safer alternative from the phenotype list or a general growth assay. If it IS practical, design the assay for this phenotype.`;
      }
  } else {
      // STANDARD Research Lab
      const equipmentNote = settings?.labResources && settings.labResources.length > 0
        ? "incorporating the specific available equipment listed above where appropriate."
        : "assuming access to standard molecular biology equipment (PCR, Western Blot, Plate Reader, Fluorescence Microscopy).";

      safetyInstructions = `CONTEXT: STANDARD RESEARCH LAB. You may propose standard molecular biology assays including those using common research chemicals (e.g. drug sensitivity assays, stress tests), as long as they are relevant to the phenotype. You can assume standard equipment availability or use the specific list if provided: ${equipmentNote}`;
      
      if (selectedPhenotype) {
          phenotypeInstructions = `Design the experimental assay to specifically test the selected phenotype "${selectedPhenotype}" (incorporating specific agents found via web search). Since this is a research context, you may propose robust and rigorous assays (e.g. precise drug sensitivity, western blotting, microscopy, biochemical assays) appropriate for this phenotype.`;
      }
  }
  
  advancedContext += `\n${safetyInstructions}`;

  let imageContext = "";
  if (structureImage) {
      imageContext = `\n\nATTACHED IMAGE: A snapshot of the 3D protein structure overlay (Human in Grey/Purple, Yeast in Yellow/Red). Use this to assess structural conservation and potential impact of the variant.`;
  }

const prompt = `
    **SYSTEM ROLE & TONE:**
    You are an expert molecular biologist and bioinformatics consultant. Your task is to design a rigorous, actionable experimental laboratory plan based on the provided genetic and phenotypic context. 
    - Use precise, objective scientific language. 
    - Express appropriate uncertainty (e.g., "suggests", "hypothesized") when dealing with vague phenotypes, ambiguous AlphaMissense scores, or low DIOPT scores.
    - **MANDATORY GROUNDING:** You must use Web Search to cross-reference primary scientific literature. Always include complete, inline citations for specific findings, chemicals, and protocols.

    **INPUT CONTEXT:**
    - Human Gene: ${humanGene}
    - Yeast Ortholog: ${yeastGene}
    ${metricsContext}
    ${variantContext}
    ${phenotypeContext}
    ${advancedContext}
    ${imageContext}

    **REQUIRED OUTPUT STRUCTURE:**
    Generate the response using the following ALL CAPS sections, separated by horizontal rules (---).

    ### 1. GENE FUNCTION & UTILITY ASSESSMENT
    * **Human & Yeast Function:** Briefly summarize the human gene's function. In the next paragraph, concisely describe the yeast gene's function (noting if it is essential).
    * **Modeling Utility:** **Bold your assessment** of the utility of modeling this human variant in yeast. Base this strictly on protein identity/similarity, local homology, DIOPT score (Note: DIOPT of 1 is very low), and structural image data (if provided). If the data suggests poor conservation, explicitly advise against using the yeast model. Mention if literature indicates the human gene successfully complements the yeast null mutant.
    * **Variant Assessment:** Perform a web search on the specific variant of unknown significance (VUS). Summarize any found primary literature. If no literature is found, state this clearly. Conclude with a hypothesized impact of the VUS based on the AlphaMissense score, structural data, and the provided **Site and Domain annotations at the variant position** (evaluate if the mutation disrupts an annotated catalytic active site, metal/ligand-binding pocket, SLiM motif, post-translational modification, 3D interaction interface, or critical protein domain). 
    * **Rare Disease Context:** If your search associates the variant with a rare disease, briefly explain the disease in lay terms.

    ---
    ### 2. EXPERIMENTAL ASSAY PROPOSAL
    * **Methodology:** Exclusively propose assays evaluating the CRISPR-mediated knock-in of the variant at the native yeast locus. 
    * **Assay Design:** Select the most appropriate assay based on the Safety Constraints and Lab Context provided. ${phenotypeInstructions ? ` ${phenotypeInstructions}` : ' You MUST preferentially select "classical genetics" phenotypes over "large-scale survey" phenotypes.'} Integrate the variant's site and domain context (e.g., active site, interaction interface, ligand-binding, or PTM site) into your rationale for why the chosen phenotypic readout or assay conditions are mechanistically appropriate.
    * **Specific Conditions:** If web search revealed specific chemical agents, ions, or conditions related to the phenotype, explicitly state them and cite the source paper inline. Explicitly state the source reference for the chosen phenotype (e.g., "Based on Smith et al., 2010").

    ---
    ### 3. EXPECTED RESULTS & CONTROLS
    * **Expected Outcomes:** Briefly discuss the potential assay readouts and how to interpret them.
    * **Controls:** Explicitly define the controls. Use the CRISPR-generated 2bp PAM deletion mutant (frameshift/null) as the negative control, and the Wild Type strain as the positive control.

    ---
    ### 4. EXECUTIVE SUMMARY (TL;DR)
    Provide a 4-5 bullet point summary.
    * Bullet 1: The assessment of modeling utility in yeast.
    * Bullet 2: The predicted impact of the VUS on protein function, highlighting any affected functional site, domain, PTM, or interaction interface.
    * Bullets 3-5: Key takeaways regarding the assay and expected outcomes.

    ---
    ### 5. DISCLAIMER
    End your response with exactly this text: 
    "Disclaimer: This content is AI-generated. Strongly consider validating phenotype(s) and other provided information using primary literature. All experiments should be reviewed and overseen by a qualified scientist for safety and compliance with environmental health and safety regulations."
  `;

  const MAX_RETRIES = 1;
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    try {
      const parts: any[] = [{ text: prompt }];
      if (structureImage) {
          // Extract mimeType and base64 data from data URL
          const match = structureImage.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
          if (match) {
              parts.push({
                  inlineData: {
                      mimeType: match[1],
                      data: match[2]
                  }
              });
          } else {
              // Fallback if it's just base64 (though it shouldn't be based on App.tsx)
              const base64Data = structureImage.split(',')[1] || structureImage;
              parts.push({
                  inlineData: {
                      mimeType: "image/png",
                      data: base64Data
                  }
              });
          }
      }

      const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('firefox');
      let fullText = "";
      let collectedGroundingChunks: any[] = [];

      if (isFirefox) {
        // Fallback for Firefox: use non-streaming
        onUpdate("Loading AI experimental plan... (Firefox compatibility mode active). This may take a few minutes...");
        
        const response = await fetch('/api/generateExperimentalPlan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parts, stream: false })
        });
        
        if (!response.ok) {
           const errData = await response.json().catch(() => ({}));
           throw new Error(errData.message || "Failed to generate plan");
        }
        
        const data = await response.json();
        fullText = data.text || "";
        if (data.groundingChunks?.length) {
          collectedGroundingChunks.push(...data.groundingChunks);
        }
        onUpdate(fullText);
      } else {
        const response = await fetch('/api/generateExperimentalPlan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parts, stream: true })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || errData.error || "Failed to generate plan stream");
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (reader) {
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || "";
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (!dataStr.trim()) continue;
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.error) {
                                const errorMsg = typeof parsed.error === 'object' ? (parsed.error.message || JSON.stringify(parsed.error)) : parsed.error;
                                throw new Error(errorMsg);
                            }
                            if (parsed.text) fullText += parsed.text;
                            if (parsed.groundingChunks?.length) collectedGroundingChunks.push(...parsed.groundingChunks);
                            onUpdate(fullText);
                        } catch (e: any) {
                            if (e.message && (e.message.includes('Authentication') || e.message.includes('401') || e.message.includes('service account') || e.message.includes('Quota'))) {
                                throw e;
                            }
                            console.warn("Error parsing chunk", e, dataStr);
                        }
                    }
                }
            }
        }
      }

      // Append Grounding Sources at the end if available
      if (collectedGroundingChunks.length > 0) {
        const uniqueLinks = new Map<string, string>();
        collectedGroundingChunks.forEach((c: any) => {
          if (c.web?.uri && c.web?.title) {
            uniqueLinks.set(c.web.uri, c.web.title);
          }
        });
        
        if (uniqueLinks.size > 0) {
          fullText += `\n\n---\n### REFERENCES & SOURCES\n`;
          uniqueLinks.forEach((title, uri) => {
            fullText += `- [${title}](${uri})\n`;
          });
          onUpdate(fullText);
        }
      }

      // Break out of the retry loop if successful
      break;

    } catch (error: any) {
      console.error(`Gemini Error (Attempt ${attempt + 1}):`, error);
      const msg = String(error?.message || error || '');
      
      // Handle Quota Limits specifically (don't retry these)
      if (msg.includes("429") || error.status === 429 || msg.includes("RESOURCE_EXHAUSTED")) {
           throw new Error("Gemini API Quota Exceeded (429). Please wait a minute and try again, or use a paid API key.");
      }

      // Handle Authentication / Service Account errors (don't retry - these require user/GCP action)
      if (
        msg.includes("401") ||
        msg.includes("UNAUTHENTICATED") ||
        msg.includes("ACCOUNT_STATE_INVALID") ||
        msg.includes("service account is deleted or disabled") ||
        msg.includes("API_KEY_INVALID") ||
        msg.includes("API key not valid") ||
        msg.includes("Authentication Error")
      ) {
        throw error;
      }

      if (attempt < MAX_RETRIES) {
          attempt++;
          onUpdate(`⚠️ Network issue detected. Automatically retrying generation (Attempt ${attempt + 1}/${MAX_RETRIES + 1})...`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2 seconds
          continue;
      }
      
      throw error; // Re-throw if out of retries
    }
  }
};
