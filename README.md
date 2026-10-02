# BUDDY 🧬
### Bioinformatic Utility for Diagnostic Discovery in Yeast

**BUDDY** is an advanced, production-grade bioinformatics platform designed to bridge human medical genetics and yeast (*Saccharomyces cerevisiae*) model organism research. It streamlines the functional characterization of human **Variants of Uncertain Significance (VUS)** and **ClinVar ⇄ AlphaMissense discordant variants** by mapping them to yeast orthologs, overlaying 3D structural conservation, mapping biological functional sites, designing CRISPR editing strategies, and synthesizing AI-assisted experimental protocols.

![React](https://img.shields.io/badge/built%20with-React-61DAFB.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-38B2AC?logo=tailwind-css&logoColor=white)
![Gemini](https://img.shields.io/badge/AI-Google%20Gemini-8E75B2.svg)

---

## 🌟 Key Features & Workflows

### 1. Orthology & Evolutionary Conservation
* **DIOPT Integration:** Automated mapping of Human genes to Yeast orthologs (and vice-versa) powered by DRSC DIOPT scores (integrating Ensembl Compara, Homologene, Inparanoid, OMA, OrthoFinder, OrthoMCL, PANTHER, PhylomeDB, and TreeFam).
* **Pairwise Sequence Alignment:** High-performance Needleman-Wunsch (global) and Smith-Waterman (local) alignment with customizable scoring matrices (**BLOSUM62**, **BLOSUM45**, **PAM250**) and gap penalties.
* **Local Homology Scoring:** Sliding-window local homology calculation around each variant residue to evaluate regional sequence conservation.
* **Boxshade Shading:** Toggleable traditional Boxshade representation highlighting identical residues (dark shade) and biochemically similar residues (light shade).

---

### 2. Multi-Track Sequence Alignment Annotations
The sequence alignment viewer features an interactive, multi-layer annotation track system stacked above and below the human and yeast sequences:

* **Protein Domains (`Domain`):** UniProt/Pfam domain boundaries with color bars (defaults to OFF for clean alignment viewing; toggleable).
* **Functional Sites & Motifs (`Site (H)` & `Site (Y)`):**
  * Displays catalytic active sites, binding sites, metal-coordinating residues (e.g. Zn²⁺, Mg²⁺, Fe-S clusters), ligand contacts, and Short Linear Motifs (SLiMs).
  * Styled in distinctive purple with interactive legend chips, category filtering, and deep-dive inspection.
* **Post-Translational Modifications (`PTM (H)` & `PTM (Y)`):**
  * UniProt- and PhosphoSitePlus-mapped PTMs including Phosphorylation (`P`), Acetylation (`A`), Methylation (`M`), Ubiquitination (`U`), SUMOylation (`S`), Glycosylation (`G`), Disulfide bonds (`D`), and Lipidation (`L`).
  * Filter pills by category, modification counts, and detailed modification descriptions.
* **3D Structural Contact Interfaces (`Intf (H)`):**
  * Integrates **BioGRID** interaction networks and **PDBe-KB** 3D structural interface coordinates.
  * Residues in contact with partner proteins, homomers, DNA, or RNA are mapped directly onto the alignment using 1-letter partner indicators and multi-partner hub glyphs (`*`).
  * Interactive partner chips showing residue counts and BioGRID empirical interaction evidence.
  * Direct alerts for ClinVar mutations that structurally disrupt known protein-protein interaction interfaces.
  * Typography is rendered clean and flat without box borders.
* **VUS / Variant Track (`VUS / Var`):** Positioned immediately adjacent to the human sequence for direct visual comparison with amino acid conservation.
* **Export Options:** One-click export of alignment views to high-resolution PNG images or formatted text files.

---

### 3. Filtered Variants Table & Deep Functional Annotation
The **Filtered Variants Table** organizes variants with comprehensive clinical, predictive, and structural data:

* **Sites / PTM / Interface Column:**
  * **PTM Badges:** Highlights residues undergoing post-translational modifications (e.g., *Phosphorylated*, *Acetylated*, *Ubiquitinated*).
  * **Functional Site Badges:** Indicates *Active Site*, *Metal Binding (Zn2+)*, *Binding Site (ATP)*, or *SLiM Motif* contacts.
  * **Interface Badges:** Details interacting partners (e.g., *MDM2 Interaction*, *TP53BP1 Interaction*, *Homomer Interface*, *DNA Interface*) with BioGRID report counts and PDB complex IDs.
* **Interactive Multi-Column Sorting:**
  * Sort by **Residue Position**, **AlphaMissense Score**, **Local Homology**, **ClinVar Review Stars**, **Submitters**, **gnomAD Frequency**, or **Sites / PTM / Interface Annotations** (surfacing functionally critical residues).
* **Multi-Tier Filtering:** Filter variants by ClinVar significance (**VUS**, **Pathogenic**, **Likely Pathogenic**, **Benign**, **Likely Benign**, **Conflicting**, **Discordant**), star ratings, and homology thresholds.
* **Smart gnomAD Linking:**
  * Extracts population allele frequencies across exomes and genomes.
  * Uses coordinate-aware linking: resolves directly to **gnomAD v4** (`dataset=gnomad_r4`) for GRCh38 coordinates, **gnomAD v2.1.1** (`dataset=gnomad_r2_1`) for GRCh37/hg19 variants, or universal search for rsIDs, avoiding "Variant not found" routing errors.

---

### 4. ClinVar ⇄ AlphaMissense Discordant Variants Explorer
A dedicated engine to investigate conflicting signals between machine-learning predictions and clinical interpretations:

* **Discordance Modes:**
  * **Benign in ClinVar, Pathogenic in AlphaMissense:** Highlights variants that computational models predict as deleterious despite benign clinical classifications (useful for identifying low-penetrance alleles, cell-type specific defects, or clinical misclassifications).
  * **Pathogenic in ClinVar, Benign in AlphaMissense:** Identifies variants classified clinically as pathogenic but predicted benign by structural models (useful for identifying regulatory changes, protein-protein interaction disruptions, or gain-of-function phenotypes).
  * **Recurrent Benign Variants:** High-confidence benign controls with multiple independent submissions.
* **Refined Filtering:** Filter by minimum ClinVar stars (1★ to 4★), minimum submission counts, DIOPT orthology score, and gnomAD frequency tiers (Common ≥1%, Low-Frequency 0.1%–1%, Rare <0.1%, Ultra-Rare / Absent).
* **Actions:** One-click CSV export and seamless transfer directly into the BUDDY experimental pipeline.

---

### 5. 3D Molecular Structure Visualization
* Powered by **3Dmol.js** with AlphaFold and RCSB PDB structures.
* Highlights mutated residues, functional domains, and interface boundaries.
* Dual-structure view with superposition for comparing human and yeast conformations.

---

### 6. Automated CRISPR/Cas9 Guide & Oligo Design
BUDDY automates the design of CRISPR/Cas9 guides, repair templates, and verification primers for precise genome engineering in yeast:

* **Dual Cloning & Delivery Systems:**
  * **pML104 Vector Cloning:** Generates forward and reverse oligos with cohesive 5' `gatc` and 3' `gttttagagctag` overhangs for BsmBI-mediated insertion into pML104 (or similar vectors).
  * **NoClo (Cloning-Free In Vivo Homology):**
    * Eliminates in vitro cloning steps by relying on in vivo homologous recombination.
    * **Homology Length Control:** Configurable homology length slider (20 bp to 100 bp per end; default 100 bp) flanking the 20 bp sgRNA sequence for gap repair.
    * **All-in-One Integrated Repair Template Option:** Users can check **"Integrate Repair Template onto Same Sequence"** to synthesize a single, contiguous ~478 nt oligo carrying both the repair donor and the sgRNA expression cassette.
* **Architecture of NoClo All-in-One Integrated Oligo (5' → 3'):**
  1. **5' Upstream Homology Arm (101 bp):**
     `tgcctgtatatatatatacatgagaagaacggcatagtgcgtgtttatgcttaaatgcgtatatgtgttatgtagtatactctttcttcaacaattaaat`
  2. **100 nt Repair Donor Template:**
     Contains the intended missense mutation (or deletion control) flanked by symmetric/asymmetric homology arms.
  3. **tRNA/Ribozyme Self-Cleaving Linker (155 bp):**
     `ACTCTCGGTAGCCAAGTTGGTTTAAGGCGCAAGACTGTAATTTATCACTACGAAATCTTGAGATCGGGCGTTCGACTCGCCCCCGGGAGAgatggccggcatggtcccagcctcctcgctggcgccggctgggcaacaccttcgggtggcgaatg`
  4. **sgRNA Target Sequence (20 nt):**
     High-efficiency gRNA spacer targeting the cut site.
  5. **3' sgRNA Scaffold & Terminator (102 bp):**
     `gttttagagctagaaatagcaagttaaaataaggctagtccgttatcaacttgaaaaagtggcaccgagtcggtgctttttttattttttgtcactattg`
* **Intelligent PAM & Seed Disruption:**
  * Automatically scans for synonymous codons within the cut window to ablate the PAM (`NGG` / `NNGRRT` / `TTTV` / `NG`) or mutate seed residues, preventing Cas9 re-cleavage of the repaired allele.
* **Deletion Control & Verification Primers:**
  * Synthesizes an accompanying deletion/null control oligo on the fly to provide an empirical knockout phenotype comparator.
  * In silico PCR verification primer pair with computed annealing temperatures ($T_m$), GC content, and expected amplicon size.
* **Instant Export:** One-click copy for forward, reverse complement, and deletion control sequences.

---

### 7. AI-Assisted Experimental Protocol Generator
* Powered by **Google Gemini models** with Google Search grounding.
* Ingests curated null, hypomorphic, and overexpression phenotypes from the **Alliance of Genome Resources (AGR)** and **SGD**.
* Generates step-by-step wet-lab protocols tailored to available lab resources (e.g. plate readers, fluorescence microscopy, spot assays) with positive/negative control recommendations.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** (v18 or higher recommended)
* **npm** or **bun**
* **Google Gemini API Key** (from [Google AI Studio](https://aistudio.google.com/))

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/buddy-pipeline.git
   cd buddy-pipeline
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   Create a `.env` file in the project root:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   PORT=3000
   ```

4. **Start the Development Server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. **Production Build:**
   ```bash
   npm run build
   npm start
   ```

---

## 🧬 Biological Data Sources & APIs

| Resource | Usage in BUDDY |
| :--- | :--- |
| **DRSC DIOPT** | Human-yeast ortholog mapping and confidence scores |
| **UniProt KB** | Protein sequences, topological features, domains, PTMs, and catalytic sites |
| **MyVariant.info** | ClinVar clinical significance, review status, submitters, dbSNP rsIDs, and gnomAD frequencies |
| **AlphaMissense** | Deep learning missense pathogenicity predictions |
| **gnomAD (v2 & v4)** | Population allele frequencies with build-aware coordinate linking |
| **BioGRID** | Empirical protein-protein physical interaction networks |
| **PDBe-KB** | 3D complex structural contact interface residues and PDB IDs |
| **Ensembl REST** | Genomic DNA coordinates, intron/exon boundaries, and yeast loci |
| **SGD / AGR** | Yeast gene nomenclature, systematic names, phenotypes, and study citations |
| **AlphaFold / PDB** | Computed and empirical 3D coordinates for molecular rendering |
| **Google Gemini** | Contextual assay design and literature-grounded experimental protocols |

---

## ⚙️ Advanced Configuration Options

Click the **Settings (gear icon)** in the navigation bar to customize pipeline parameters:

* **CRISPR & Oligo Design:**
  * **Cloning Strategy:** `pML104` (plasmid cloning) or `NoClo` (in vivo gap repair).
  * **NoClo Homology Length:** Configurable from 20 bp to 100 bp flanking the sgRNA sequence (Default: 100 bp).
  * **NoClo Integrated Repair Template:** Opt-in checkbox to synthesize the complete All-in-One single sequence carrying the 5' homology, 100nt repair donor, 155bp tRNA/ribozyme linker, sgRNA, and 3' terminator.
  * **PAM Constraints:** `NGG` (SpCas9), `NNGRRT` (SaCas9), `TTTV` (Cas12a/Cpf1), or `NG` (SpG).
  * **Disruption Priority:** PAM site only, seed region only, or both.
  * **Repair Template:** Symmetric or asymmetric arm length (upstream/downstream skew).
  * **Primer Design:** Minimum/maximum Tm, primer product length, and GC clamp enforcement.
* **Pairwise Alignment:**
  * **Scoring Matrices:** BLOSUM62, BLOSUM45, PAM250.
  * **Penalties:** Configurable gap open and gap extend values.
  * **Algorithm:** Global (Needleman-Wunsch) or Local (Smith-Waterman).
* **Variant Filtering:**
  * Minimum ClinVar stars (0 to 4★).
  * Clinical significance classification filters.
  * AlphaMissense pathogenicity score cutoffs.
  * Minimum local homology thresholds.

---

## ⚠️ Disclaimers

* **For Research Use Only:** BUDDY is an academic and research utility. Experimental plans, guide designs, and predictive scores are generated algorithmically and with generative models. They are not intended for direct clinical diagnostics or treatment decisions without independent experimental validation.
* **Laboratory Safety:** Always verify guide RNAs, oligos, and growth assay conditions including using primary literature. Verify all experiments are performed in accordance with federal, state, and institutional biosafety guidelines.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
