"use strict";

const fs = require("fs");
const path = require("path");

const KNOWLEDGE_ROOT = path.join(__dirname, "../../data/sage-football-knowledge");
const MODULE_ROOT = path.join(KNOWLEDGE_ROOT, "modules");
const SOURCE_ROOT = path.join(KNOWLEDGE_ROOT, "sources");

const CLASS_WEIGHT = {
  FACT: 1.0,
  VALIDATED_INSIGHT: 1.0,
  CONCEPT: 0.9,
  HISTORICAL_KNOWLEDGE: 0.8,
  EXPERIENCE_NOTE: 0.55,
  HYPOTHESIS: 0.35
};

function words(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function jsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(dir, name));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizeEntry(entry, moduleName, moduleFile) {
  return {
    ...entry,
    module: moduleName,
    moduleFile,
    knowledgeClass: entry.knowledgeClass || "CONCEPT",
    status: entry.status || "needs-source",
    confidence: entry.confidence || "not-rated",
    provenance: Array.isArray(entry.provenance) ? entry.provenance : []
  };
}

function loadKnowledge() {
  const entries = [];
  const sources = new Map();

  [...jsonFiles(MODULE_ROOT), ...jsonFiles(SOURCE_ROOT)].forEach((file) => {
    const doc = readJson(file);
    (doc.sources || []).forEach((source) => {
      if (source && source.id) sources.set(source.id, source);
    });
    (doc.entries || []).forEach((entry) => {
      entries.push(normalizeEntry(entry, doc.module || path.basename(file, ".json"), path.relative(KNOWLEDGE_ROOT, file)));
    });
  });

  return { entries, sources };
}

function searchableText(entry) {
  return [
    entry.title,
    entry.summary,
    ...(entry.domain || []),
    ...(entry.principles || []),
    ...(entry.indicators || []),
    ...(entry.limitations || []),
    ...(entry.relationships || []),
    ...(entry.fantasyImplications || [])
  ].join(" ");
}

function retrieveFootballKnowledge(query, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 20));
  const includeHypotheses = options.includeHypotheses !== false;
  const queryWords = [...new Set(words(query))];
  const { entries, sources } = loadKnowledge();

  const ranked = entries
    .filter((entry) => includeHypotheses || entry.knowledgeClass !== "HYPOTHESIS")
    .map((entry) => {
      const haystack = searchableText(entry).toLowerCase();
      const matches = queryWords.filter((word) => haystack.includes(word));
      const phraseBonus = String(entry.title || "").toLowerCase().includes(String(query || "").toLowerCase()) ? 2 : 0;
      const classWeight = CLASS_WEIGHT[entry.knowledgeClass] || 0.5;
      const score = (matches.length + phraseBonus) * classWeight;
      return { entry, score, matches };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.entry.title).localeCompare(String(b.entry.title)))
    .slice(0, limit)
    .map(({ entry, score, matches }) => ({
      ...entry,
      retrieval: { score: Number(score.toFixed(3)), matchedTerms: matches },
      resolvedProvenance: entry.provenance.map((p) => {
        if (!p || !p.sourceId) return p;
        return { ...p, source: sources.get(p.sourceId) || null };
      }),
      productionUse: entry.knowledgeClass === "VALIDATED_INSIGHT"
        ? "eligible-after-production-validation"
        : entry.knowledgeClass === "HYPOTHESIS"
          ? "research-only"
          : "explanation-and-reasoning-only"
    }));

  return {
    query,
    resultCount: ranked.length,
    guardrail: "Retrieved football knowledge may support explanation/reasoning. HYPOTHESIS is research-only and must not change production rankings. Only separately validated production logic may affect rankings.",
    results: ranked
  };
}

module.exports = { loadKnowledge, retrieveFootballKnowledge };
