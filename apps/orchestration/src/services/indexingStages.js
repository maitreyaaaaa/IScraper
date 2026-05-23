const INDEXING_STAGES = {
  METADATA_READY: 'metadata_ready',
  TEXT_INDEXED: 'text_indexed',
  VISUAL_INDEXING: 'visual_indexing',
  VISUAL_INDEXED: 'visual_indexed',
  DEEP_INDEXED: 'deep_indexed',
  INDEX_FAILED: 'index_failed',
};

const FINAL_ENRICHED_STAGES = new Set([
  INDEXING_STAGES.VISUAL_INDEXED,
  INDEXING_STAGES.DEEP_INDEXED,
]);

function normalizeIndexingStage(value, fallback = INDEXING_STAGES.METADATA_READY) {
  return Object.values(INDEXING_STAGES).includes(value) ? value : fallback;
}

function initialIndexingStage(status = 'done') {
  return status === 'needs_review' ? INDEXING_STAGES.METADATA_READY : INDEXING_STAGES.TEXT_INDEXED;
}

function isEnrichedStage(stage) {
  return FINAL_ENRICHED_STAGES.has(stage);
}

module.exports = {
  INDEXING_STAGES,
  initialIndexingStage,
  isEnrichedStage,
  normalizeIndexingStage,
};
