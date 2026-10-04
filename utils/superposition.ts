import { Matrix, SVD } from 'ml-matrix';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface TransformResult {
  rotation: Matrix;
  translationVector: Point3D; // The vector to move movingCentroid to fixedCentroid
  fixedCentroid: Point3D;
  movingCentroid: Point3D;
}

export type OverlayAlgorithmType = 
  | 'kabsch_global'     // 1. Standard Global All-Residue Superposition
  | 'pruned_core'       // 2. Iterative Outlier-Pruned Rigid Core (PyMOL-style)
  | 'conserved_anchors' // 3. Conserved Sequence & Homology Anchors
  | 'tm_weighted';      // 4. TM-score Distance-Decayed Soft Weighting

export interface AlignmentMetrics {
  algorithm: OverlayAlgorithmType;
  algorithmName: string;
  shortName: string;
  description: string;
  rmsd: number; // in Angstroms
  alignedPairsCount: number;
  totalPairsCount: number;
  corePercentage?: number;
}

export const OVERLAY_ALGORITHMS: { type: OverlayAlgorithmType; name: string; shortName: string; description: string }[] = [
  {
    type: 'pruned_core',
    name: 'Pruned Core (Outlier Rejection - Default)',
    shortName: 'Pruned Core',
    description: 'Iteratively filters out flexible loops, disordered tails, and divergent insertions to lock onto the rigid structural core.'
  },
  {
    type: 'kabsch_global',
    name: 'Global Kabsch (Full-Length)',
    shortName: 'Global Kabsch',
    description: 'Standard least-squares alignment minimizing global RMSD across all matched residue pairs.'
  },
  {
    type: 'conserved_anchors',
    name: 'Conserved Homology Anchors',
    shortName: 'Conserved Anchors',
    description: 'Superimposes structures using identical and strongly conserved amino acid motifs (active sites & functional core).'
  },
  {
    type: 'tm_weighted',
    name: 'TM-Weighted (Distance-Decayed)',
    shortName: 'TM-Weighted',
    description: 'Soft distance-decayed weights (Levitt-Gerstein / TM-score style) downweighting distant mobile loops without strict cutoff.'
  }
];

/**
 * Calculates the centroid (geometric center) of a set of points, optionally weighted.
 */
function getCentroid(points: Point3D[], weights?: number[]): Point3D {
  let x = 0, y = 0, z = 0, totalW = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    x += points[i].x * w;
    y += points[i].y * w;
    z += points[i].z * w;
    totalW += w;
  }
  const denom = totalW > 0 ? totalW : n;
  return { x: x / denom, y: y / denom, z: z / denom };
}

/**
 * Manually calculates the determinant of a 3x3 matrix.
 * Used to avoid runtime errors if library methods are unavailable in the bundle.
 */
function getDeterminant3x3(m: Matrix): number {
  const a00 = m.get(0, 0), a01 = m.get(0, 1), a02 = m.get(0, 2);
  const a10 = m.get(1, 0), a11 = m.get(1, 1), a12 = m.get(1, 2);
  const a20 = m.get(2, 0), a21 = m.get(2, 1), a22 = m.get(2, 2);

  return (
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20)
  );
}

/**
 * Calculates the weighted or unweighted Kabsch transform to align 'moving' points onto 'fixed' points.
 */
export function calculateWeightedKabsch(
  fixedPoints: Point3D[], 
  movingPoints: Point3D[],
  weights?: number[]
): TransformResult {
  if (fixedPoints.length !== movingPoints.length) {
    throw new Error("Point sets must have equal length");
  }
  if (fixedPoints.length < 3) {
    throw new Error("Need at least 3 points for alignment");
  }

  // 1. Calculate Centroids
  const fixedCentroid = getCentroid(fixedPoints, weights);
  const movingCentroid = getCentroid(movingPoints, weights);

  // 2. Center and weight the points
  const n = fixedPoints.length;
  const P = new Matrix(3, n); // Moving centered
  const Q = new Matrix(3, n); // Fixed centered

  for (let i = 0; i < n; i++) {
    const w = weights ? Math.sqrt(Math.max(weights[i], 0.0001)) : 1;
    P.set(0, i, (movingPoints[i].x - movingCentroid.x) * w);
    P.set(1, i, (movingPoints[i].y - movingCentroid.y) * w);
    P.set(2, i, (movingPoints[i].z - movingCentroid.z) * w);

    Q.set(0, i, (fixedPoints[i].x - fixedCentroid.x) * w);
    Q.set(1, i, (fixedPoints[i].y - fixedCentroid.y) * w);
    Q.set(2, i, (fixedPoints[i].z - fixedCentroid.z) * w);
  }

  // 3. Covariance Matrix H = P * Q^T
  const H = P.mmul(Q.transpose());

  // 4. SVD Decomposition
  const svd = new SVD(H);
  const V = svd.rightSingularVectors;
  const U = svd.leftSingularVectors;

  // 5. Calculate Rotation Matrix R = V * U^T
  const tempR = V.mmul(U.transpose());
  const det = getDeterminant3x3(tempR);
  
  let R: Matrix;
  if (det < 0) {
    // Reflection detected. Fix by multiplying the 3rd column of V by -1
    for (let i = 0; i < 3; i++) {
      V.set(i, 2, V.get(i, 2) * -1);
    }
    R = V.mmul(U.transpose());
  } else {
    R = tempR;
  }

  return {
    rotation: R,
    translationVector: { 
      x: fixedCentroid.x - movingCentroid.x,
      y: fixedCentroid.y - movingCentroid.y,
      z: fixedCentroid.z - movingCentroid.z
    },
    fixedCentroid,
    movingCentroid
  };
}

/**
 * Calculates the standard Kabsch transform to align 'moving' points onto 'fixed' points.
 */
export function calculateKabschTransform(
  fixedPoints: Point3D[], 
  movingPoints: Point3D[]
): TransformResult {
  return calculateWeightedKabsch(fixedPoints, movingPoints);
}

/**
 * Calculates Root Mean Square Deviation (RMSD) in Angstroms between fixed and transformed moving points.
 */
export function calculateRMSD(
  fixedPoints: Point3D[],
  movingPoints: Point3D[],
  transform: TransformResult,
  subsetIndices?: number[]
): number {
  const indices = subsetIndices || fixedPoints.map((_, i) => i);
  if (indices.length === 0) return 0;

  let sumSq = 0;
  for (const idx of indices) {
    const fixed = fixedPoints[idx];
    const trans = applyTransform(movingPoints[idx], transform);
    const dx = trans.x - fixed.x;
    const dy = trans.y - fixed.y;
    const dz = trans.z - fixed.z;
    sumSq += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(sumSq / indices.length);
}

/**
 * Algorithm 2: Iterative Outlier-Pruned Kabsch Superposition (Rigid Core).
 * Iteratively discards pairs with high deviation (e.g. flexible loops, tails, divergent insertions).
 */
export function calculatePrunedCoreTransform(
  fixedPoints: Point3D[],
  movingPoints: Point3D[],
  maxIterations = 5
): { transform: TransformResult; coreIndices: number[]; rmsd: number } {
  const n = fixedPoints.length;
  let activeIndices: number[] = Array.from({ length: n }, (_, i) => i);
  let currentTransform = calculateKabschTransform(fixedPoints, movingPoints);
  const minPoints = Math.max(6, Math.floor(n * 0.4)); // Keep at least 40% or 6 residues

  for (let iter = 0; iter < maxIterations; iter++) {
    if (activeIndices.length <= minPoints) break;

    // Calculate distance for all active indices
    const distList = activeIndices.map(idx => {
      const fixed = fixedPoints[idx];
      const trans = applyTransform(movingPoints[idx], currentTransform);
      const dist = Math.hypot(trans.x - fixed.x, trans.y - fixed.y, trans.z - fixed.z);
      return { idx, dist };
    });

    distList.sort((a, b) => a.dist - b.dist);

    // Dynamic cutoff: reject pairs > 3.8Å, or top 18% highest distances
    const cutoffDistance = 3.8;
    const targetKeep = Math.max(minPoints, Math.floor(activeIndices.length * 0.82));
    
    const nextIndices: number[] = [];
    for (let i = 0; i < distList.length; i++) {
      if (i < targetKeep || distList[i].dist <= cutoffDistance) {
        nextIndices.push(distList[i].idx);
      }
    }

    // Convergence check
    if (nextIndices.length === activeIndices.length) break;
    activeIndices = nextIndices;

    const subFixed = activeIndices.map(i => fixedPoints[i]);
    const subMoving = activeIndices.map(i => movingPoints[i]);
    currentTransform = calculateKabschTransform(subFixed, subMoving);
  }

  const rmsd = calculateRMSD(fixedPoints, movingPoints, currentTransform, activeIndices);
  return {
    transform: currentTransform,
    coreIndices: activeIndices,
    rmsd
  };
}

/**
 * Algorithm 3: Conserved Sequence & Homology Anchored Superposition.
 * Uses identical and strongly conserved evolutionary positions to guide the alignment.
 */
export function calculateAnchoredTransform(
  fixedPoints: Point3D[],
  movingPoints: Point3D[],
  isConservedFlags?: boolean[]
): { transform: TransformResult; anchorIndices: number[]; rmsd: number } {
  const n = fixedPoints.length;
  let anchorIndices: number[] = [];

  if (isConservedFlags && isConservedFlags.length === n) {
    anchorIndices = isConservedFlags
      .map((val, idx) => (val ? idx : -1))
      .filter(idx => idx !== -1);
  }

  // Fallback if too few sequence anchors exist: select top 40% pairs with lowest initial distance
  if (anchorIndices.length < 5) {
    const initTransform = calculateKabschTransform(fixedPoints, movingPoints);
    const dists = fixedPoints.map((pt, idx) => {
      const trans = applyTransform(movingPoints[idx], initTransform);
      return { idx, d: Math.hypot(trans.x - pt.x, trans.y - pt.y, trans.z - pt.z) };
    });
    dists.sort((a, b) => a.d - b.d);
    anchorIndices = dists.slice(0, Math.max(6, Math.floor(n * 0.45))).map(x => x.idx);
  }

  const subFixed = anchorIndices.map(i => fixedPoints[i]);
  const subMoving = anchorIndices.map(i => movingPoints[i]);
  const transform = calculateKabschTransform(subFixed, subMoving);
  const rmsd = calculateRMSD(fixedPoints, movingPoints, transform, anchorIndices);

  return {
    transform,
    anchorIndices,
    rmsd
  };
}

/**
 * Algorithm 4: TM-Score Distance-Decayed Soft Weighting Superposition.
 * Weight pairs using w_i = 1 / (1 + (d_i / d_0)^2), downweighting flexible regions smoothly.
 */
export function calculateTMWeightedTransform(
  fixedPoints: Point3D[],
  movingPoints: Point3D[],
  iterations = 4
): { transform: TransformResult; rmsd: number } {
  const n = fixedPoints.length;
  // Standard TM-score scale parameter d0
  const d0 = Math.max(1.5, Math.min(4.0, 1.24 * Math.cbrt(Math.max(16, n) - 15) - 1.8));

  let currentTransform = calculateKabschTransform(fixedPoints, movingPoints);

  for (let iter = 0; iter < iterations; iter++) {
    const weights: number[] = [];
    for (let i = 0; i < n; i++) {
      const fixed = fixedPoints[i];
      const trans = applyTransform(movingPoints[i], currentTransform);
      const dist = Math.hypot(trans.x - fixed.x, trans.y - fixed.y, trans.z - fixed.z);
      weights.push(1.0 / (1.0 + Math.pow(dist / d0, 2)));
    }
    currentTransform = calculateWeightedKabsch(fixedPoints, movingPoints, weights);
  }

  const rmsd = calculateRMSD(fixedPoints, movingPoints, currentTransform);
  return {
    transform: currentTransform,
    rmsd
  };
}

/**
 * Unified Superposition Dispatcher
 */
export function computeSuperposition(
  fixedPoints: Point3D[],
  movingPoints: Point3D[],
  algorithm: OverlayAlgorithmType,
  isConservedFlags?: boolean[]
): { transform: TransformResult; metrics: AlignmentMetrics } {
  const n = fixedPoints.length;

  if (algorithm === 'pruned_core') {
    const result = calculatePrunedCoreTransform(fixedPoints, movingPoints);
    const meta = OVERLAY_ALGORITHMS.find(a => a.type === 'pruned_core')!;
    return {
      transform: result.transform,
      metrics: {
        algorithm: 'pruned_core',
        algorithmName: meta.name,
        shortName: meta.shortName,
        description: meta.description,
        rmsd: result.rmsd,
        alignedPairsCount: result.coreIndices.length,
        totalPairsCount: n,
        corePercentage: Math.round((result.coreIndices.length / n) * 100)
      }
    };
  }

  if (algorithm === 'conserved_anchors') {
    const result = calculateAnchoredTransform(fixedPoints, movingPoints, isConservedFlags);
    const meta = OVERLAY_ALGORITHMS.find(a => a.type === 'conserved_anchors')!;
    return {
      transform: result.transform,
      metrics: {
        algorithm: 'conserved_anchors',
        algorithmName: meta.name,
        shortName: meta.shortName,
        description: meta.description,
        rmsd: result.rmsd,
        alignedPairsCount: result.anchorIndices.length,
        totalPairsCount: n,
        corePercentage: Math.round((result.anchorIndices.length / n) * 100)
      }
    };
  }

  if (algorithm === 'tm_weighted') {
    const result = calculateTMWeightedTransform(fixedPoints, movingPoints);
    const meta = OVERLAY_ALGORITHMS.find(a => a.type === 'tm_weighted')!;
    return {
      transform: result.transform,
      metrics: {
        algorithm: 'tm_weighted',
        algorithmName: meta.name,
        shortName: meta.shortName,
        description: meta.description,
        rmsd: result.rmsd,
        alignedPairsCount: n,
        totalPairsCount: n,
        corePercentage: 100
      }
    };
  }

  // Default: Global Kabsch
  const transform = calculateKabschTransform(fixedPoints, movingPoints);
  const rmsd = calculateRMSD(fixedPoints, movingPoints, transform);
  const meta = OVERLAY_ALGORITHMS.find(a => a.type === 'kabsch_global')!;

  return {
    transform,
    metrics: {
      algorithm: 'kabsch_global',
      algorithmName: meta.name,
      shortName: meta.shortName,
      description: meta.description,
      rmsd,
      alignedPairsCount: n,
      totalPairsCount: n,
      corePercentage: 100
    }
  };
}

/**
 * Applies the calculated rotation and centering translation to a point.
 * Formula: P_new = R * (P_old - Centroid_old) + Centroid_new
 */
export function applyTransform(
  point: Point3D, 
  transform: TransformResult
): Point3D {
  // 1. Shift to origin (relative to moving centroid)
  const x = point.x - transform.movingCentroid.x;
  const y = point.y - transform.movingCentroid.y;
  const z = point.z - transform.movingCentroid.z;

  // 2. Rotate
  // Matrix is 3x3. Vector is 3x1.
  const rx = transform.rotation.get(0, 0) * x + transform.rotation.get(0, 1) * y + transform.rotation.get(0, 2) * z;
  const ry = transform.rotation.get(1, 0) * x + transform.rotation.get(1, 1) * y + transform.rotation.get(1, 2) * z;
  const rz = transform.rotation.get(2, 0) * x + transform.rotation.get(2, 1) * y + transform.rotation.get(2, 2) * z;

  // 3. Translate to fixed centroid position
  return {
    x: rx + transform.fixedCentroid.x,
    y: ry + transform.fixedCentroid.y,
    z: rz + transform.fixedCentroid.z
  };
}