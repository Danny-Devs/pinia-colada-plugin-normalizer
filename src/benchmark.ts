/**
 * Benchmark suite for pinia-colada-plugin-normalizer.
 *
 * Measures performance of normalize, denormalize, and entity store operations
 * across varying dataset sizes (1K, 5K, 10K entities).
 *
 * Run: npx tsx src/benchmark.ts
 */

import { performance } from "node:perf_hooks";
import { normalize, denormalize } from "./plugin";
import { createEntityStore } from "./store";
import type { EntityDefinition, EntityRecord } from "./types";

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

const SIZES = [1_000, 5_000, 10_000];
const ITERATIONS = 10; // Average over N runs for stability

const entityDefs: Record<string, EntityDefinition> = {
  contact: { idField: "contactId" },
  org: { idField: "orgId" },
};
const defaultIdField = "id";

// ─────────────────────────────────────────────
// Synthetic Data Generation
// ─────────────────────────────────────────────

function generateContacts(count: number): EntityRecord[] {
  const contacts: EntityRecord[] = [];
  // Each contact has a nested org. ~10 contacts per org to simulate realistic data.
  for (let i = 0; i < count; i++) {
    const orgIndex = Math.floor(i / 10);
    contacts.push({
      contactId: String(i),
      name: `Contact ${i}`,
      email: `c${i}@test.com`,
      org: {
        orgId: `org-${orgIndex}`,
        name: `Org ${orgIndex}`,
      },
    });
  }
  return contacts;
}

// ─────────────────────────────────────────────
// Benchmark Helpers
// ─────────────────────────────────────────────

interface BenchResult {
  name: string;
  size: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  opsPerSec: number;
}

function bench(name: string, size: number, fn: () => void): BenchResult {
  const times: number[] = [];

  // Warmup
  fn();

  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  return {
    name,
    size,
    avgMs: avg,
    minMs: min,
    maxMs: max,
    opsPerSec: 1000 / avg,
  };
}

// ─────────────────────────────────────────────
// Reactivity Trigger Counter
// ─────────────────────────────────────────────

/**
 * Count shallowRef assignments during entity store operations.
 * We instrument the store by wrapping set/setMany and counting
 * how many times the subscribe callback fires (one per entity write).
 */
function countReactivityTriggers(
  fn: (store: ReturnType<typeof createEntityStore>) => void,
): number {
  const store = createEntityStore();
  let triggerCount = 0;
  store.subscribe(() => {
    triggerCount++;
  });
  fn(store);
  return triggerCount;
}

// ─────────────────────────────────────────────
// Benchmarks
// ─────────────────────────────────────────────

function runBenchmarks(): BenchResult[] {
  const results: BenchResult[] = [];

  for (const size of SIZES) {
    const contacts = generateContacts(size);

    // 1. Benchmark normalize
    results.push(
      bench(`normalize`, size, () => {
        normalize(contacts, entityDefs, defaultIdField);
      }),
    );

    // Pre-normalize for denormalize benchmark
    const { normalized, entities } = normalize(contacts, entityDefs, defaultIdField);

    // 2. Benchmark denormalize (with a populated store)
    const storeForDenorm = createEntityStore();
    storeForDenorm.setMany(entities);

    results.push(
      bench(`denormalize`, size, () => {
        denormalize(normalized, storeForDenorm);
      }),
    );

    // 3. Benchmark denormalize with cache (structural sharing)
    results.push(
      bench(`denormalize (cached)`, size, () => {
        const cache = new Map();
        denormalize(normalized, storeForDenorm, cache);
      }),
    );

    // 4. Benchmark entity store set() — individual calls
    results.push(
      bench(`store.set() x${size}`, size, () => {
        const store = createEntityStore();
        for (const entity of entities) {
          store.set(entity.entityType, entity.id, entity.data);
        }
      }),
    );

    // 5. Benchmark entity store setMany() — batch
    results.push(
      bench(`store.setMany()`, size, () => {
        const store = createEntityStore();
        store.setMany(entities);
      }),
    );

    // 6. Benchmark entity store get() — reads after population
    const storeForGet = createEntityStore();
    storeForGet.setMany(entities);

    results.push(
      bench(`store.get() x${size}`, size, () => {
        for (const entity of entities) {
          storeForGet.get(entity.entityType, entity.id);
        }
      }),
    );

    // 7. Benchmark store.set() updates (merge path, entities already exist)
    const storeForUpdate = createEntityStore();
    storeForUpdate.setMany(entities);
    // Modify data slightly so hasChangedFields returns true
    const updatedEntities = entities.map((e) => ({
      ...e,
      data: { ...e.data, updatedAt: Date.now() },
    }));

    results.push(
      bench(`store.set() updates x${size}`, size, () => {
        for (const entity of updatedEntities) {
          storeForUpdate.set(entity.entityType, entity.id, entity.data);
        }
      }),
    );
  }

  return results;
}

// ─────────────────────────────────────────────
// Reactivity Trigger Analysis
// ─────────────────────────────────────────────

interface ReactivityResult {
  operation: string;
  size: number;
  triggers: number;
  triggersPerEntity: string;
}

function runReactivityAnalysis(): ReactivityResult[] {
  const results: ReactivityResult[] = [];

  for (const size of SIZES) {
    const contacts = generateContacts(size);
    const { entities } = normalize(contacts, entityDefs, defaultIdField);

    // Count triggers for individual set() calls
    const setTriggers = countReactivityTriggers((store) => {
      for (const entity of entities) {
        store.set(entity.entityType, entity.id, entity.data);
      }
    });

    results.push({
      operation: "set() individual",
      size,
      triggers: setTriggers,
      triggersPerEntity: (setTriggers / entities.length).toFixed(2),
    });

    // Count triggers for batch setMany()
    const setManyTriggers = countReactivityTriggers((store) => {
      store.setMany(entities);
    });

    results.push({
      operation: "setMany() batch",
      size,
      triggers: setManyTriggers,
      triggersPerEntity: (setManyTriggers / entities.length).toFixed(2),
    });

    // Count triggers for updates (entities already exist)
    const updateTriggers = countReactivityTriggers((store) => {
      store.setMany(entities);
      // Now update with changed data
      const updated = entities.map((e) => ({
        ...e,
        data: { ...e.data, updatedAt: Date.now() },
      }));
      for (const entity of updated) {
        store.set(entity.entityType, entity.id, entity.data);
      }
    });
    // Subtract initial setMany triggers
    const initialTriggers = countReactivityTriggers((store) => {
      store.setMany(entities);
    });

    results.push({
      operation: "set() updates",
      size,
      triggers: updateTriggers - initialTriggers,
      triggersPerEntity: ((updateTriggers - initialTriggers) / entities.length).toFixed(2),
    });

    // Count triggers for no-op set() (same data, should be 0)
    const noopTriggers = countReactivityTriggers((store) => {
      store.setMany(entities);
      // Set same data again — should skip
      for (const entity of entities) {
        store.set(entity.entityType, entity.id, entity.data);
      }
    });

    results.push({
      operation: "set() no-op",
      size,
      triggers: noopTriggers - initialTriggers,
      triggersPerEntity: ((noopTriggers - initialTriggers) / entities.length).toFixed(2),
    });
  }

  return results;
}

// ─────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────

function printBenchTable(results: BenchResult[]): void {
  console.log("\n╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                     PERFORMANCE BENCHMARKS                                  ║");
  console.log("╠══════════════════════════════════════════════════════════════════════════════╣");
  console.log(
    "║ " +
      "Operation".padEnd(28) +
      "│ " +
      "Size".padEnd(7) +
      "│ " +
      "Avg (ms)".padEnd(11) +
      "│ " +
      "Min (ms)".padEnd(11) +
      "│ " +
      "Max (ms)".padEnd(11) +
      "│ " +
      "ops/s".padEnd(8) +
      "║",
  );
  console.log("╠════════════════════════════════╪═════════╪═════════════╪═════════════╪═════════════╪══════════╣");

  for (const r of results) {
    const sizeStr = r.size >= 1000 ? `${r.size / 1000}K` : String(r.size);
    console.log(
      "║ " +
        r.name.padEnd(28) +
        "│ " +
        sizeStr.padEnd(7) +
        "│ " +
        r.avgMs.toFixed(3).padStart(9) +
        "  │ " +
        r.minMs.toFixed(3).padStart(9) +
        "  │ " +
        r.maxMs.toFixed(3).padStart(9) +
        "  │ " +
        r.opsPerSec.toFixed(1).padStart(7) +
        " ║",
    );
  }

  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
}

function printReactivityTable(results: ReactivityResult[]): void {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                  REACTIVITY TRIGGER ANALYSIS                ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(
    "║ " +
      "Operation".padEnd(22) +
      "│ " +
      "Size".padEnd(7) +
      "│ " +
      "Triggers".padEnd(10) +
      "│ " +
      "Per Entity".padEnd(12) +
      "║",
  );
  console.log("╠════════════════════════╪═════════╪════════════╪══════════════╣");

  for (const r of results) {
    const sizeStr = r.size >= 1000 ? `${r.size / 1000}K` : String(r.size);
    console.log(
      "║ " +
        r.operation.padEnd(22) +
        "│ " +
        sizeStr.padEnd(7) +
        "│ " +
        String(r.triggers).padStart(8) +
        "  │ " +
        r.triggersPerEntity.padStart(10) +
        "  ║",
    );
  }

  console.log("╚══════════════════════════════════════════════════════════════╝");
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

console.log("pinia-colada-plugin-normalizer benchmark");
console.log(`Iterations per benchmark: ${ITERATIONS}`);
console.log(`Dataset sizes: ${SIZES.map((s) => `${s / 1000}K`).join(", ")} contacts (each with nested org)`);

const benchResults = runBenchmarks();
printBenchTable(benchResults);

const reactivityResults = runReactivityAnalysis();
printReactivityTable(reactivityResults);

// Summary
console.log("\nKey observations:");
const norm1k = benchResults.find((r) => r.name === "normalize" && r.size === 1000);
const norm10k = benchResults.find((r) => r.name === "normalize" && r.size === 10000);
if (norm1k && norm10k) {
  console.log(`  - normalize scales ${(norm10k.avgMs / norm1k.avgMs).toFixed(1)}x from 1K to 10K entities`);
}
const set1k = benchResults.find((r) => r.name.startsWith("store.set() x") && r.size === 1000);
const setMany1k = benchResults.find((r) => r.name === "store.setMany()" && r.size === 1000);
if (set1k && setMany1k) {
  console.log(
    `  - setMany() is ${(set1k.avgMs / setMany1k.avgMs).toFixed(1)}x faster than individual set() at 1K`,
  );
}
const noopResult = reactivityResults.find((r) => r.operation === "set() no-op" && r.size === 1000);
if (noopResult) {
  console.log(`  - No-op writes trigger ${noopResult.triggers} reactivity updates (should be 0)`);
}
