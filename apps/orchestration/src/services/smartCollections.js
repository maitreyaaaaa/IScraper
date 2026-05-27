const MIN_AUTO_COLLECTION_ITEMS = 2;
const MAX_GENERATED_COLLECTIONS = 30;
const DEFAULT_VISIBLE_COLLECTIONS_LIMIT = 12;

const CATEGORY_RULES = [
  {
    slug: 'fashion-clothes',
    name: 'Fashion / clothes',
    description: 'Outfits, clothing, accessories, style references, and wardrobe ideas.',
    terms: ['fashion', 'clothes', 'clothing', 'outfit', 'wardrobe', 'style', 'dress', 'shirt', 'jacket', 'jeans', 'sneakers', 'shoes', 'accessory', 'accessories', 'bag', 'watch', 'jewelry'],
  },
  {
    slug: 'products',
    name: 'Products',
    description: 'Products, shopping research, comparisons, and things you may want to buy later.',
    terms: ['product', 'products', 'shop', 'shopping', 'buy', 'price', 'deal', 'review', 'comparison', 'amazon', 'etsy', 'store', 'cart', 'gadget', 'gear'],
  },
  {
    slug: 'ui-inspiration',
    name: 'UI inspiration',
    description: 'Screens, layouts, components, and interface ideas you saved.',
    terms: ['ui', 'ux', 'interface', 'dashboard', 'landing page', 'component', 'design system', 'web design', 'app design', 'layout', 'figma', 'tailwind', 'react'],
  },
  {
    slug: 'recipes',
    name: 'Recipes',
    description: 'Food ideas, recipes, restaurants, and cooking references.',
    terms: ['recipe', 'food', 'cooking', 'meal', 'restaurant', 'dinner', 'lunch', 'breakfast', 'pasta', 'ramen', 'kitchen', 'bake'],
  },
  {
    slug: 'product-ideas',
    name: 'Product ideas',
    description: 'Product concepts, market examples, and business ideas.',
    terms: ['product', 'startup', 'saas', 'business', 'pricing', 'growth', 'market', 'customer', 'launch', 'mvp', 'founder'],
  },
  {
    slug: 'design-tools',
    name: 'Design tools',
    description: 'Design, editing, creative, and workflow tools.',
    terms: ['tool', 'tools', 'figma', 'canva', 'photoshop', 'illustrator', 'framer', 'webflow', 'plugin', 'template'],
  },
  {
    slug: 'video-research',
    name: 'Video research',
    description: 'Videos, clips, transcripts, and watch-later research.',
    terms: ['youtube', 'tiktok', 'video', 'reel', 'shorts', 'transcript', 'clip', 'podcast', 'watch'],
    platformKeys: ['youtube', 'tiktok'],
  },
  {
    slug: 'social-inspiration',
    name: 'Social inspiration',
    description: 'Posts and creators saved from social platforms.',
    terms: ['instagram', 'pinterest', 'twitter', 'x', 'linkedin', 'reddit', 'creator', 'post', 'thread'],
    platformKeys: ['instagram', 'pinterest', 'twitter', 'x', 'linkedin', 'reddit'],
  },
  {
    slug: 'research-notes',
    name: 'Research notes',
    description: 'Articles, notes, references, and material worth revisiting.',
    terms: ['research', 'article', 'reference', 'notes', 'paper', 'study', 'guide', 'tutorial', 'docs', 'documentation'],
  },
];

function now() {
  return new Date().toISOString();
}

function cleanText(value, max = 120) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function slugify(value) {
  return cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function unique(values = []) {
  return [...new Set(values.map((value) => cleanText(value, 80)).filter(Boolean))];
}

function itemSearchText(item) {
  const analysis = item.analysis || {};
  return [
    item.platform,
    item.platformKey,
    item.sourceTitle,
    item.sourceDescription,
    item.sourceAuthor,
    item.caption,
    item.note?.body,
    ...(item.hashtags || []),
    ...(item.collections || []),
    analysis.title,
    analysis.summary,
    analysis.visualDescription,
    analysis.ocrText,
    ...(analysis.tags || []),
    ...(analysis.topics || []),
    ...(analysis.brandsMentioned || []),
    ...(analysis.toolsMentioned || []),
    ...(analysis.peopleMentioned || []),
    ...(analysis.reposMentioned || []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function eligibleItems(items = []) {
  return items.filter((item) => item && item.status !== 'needs_review' && item.status !== 'failed' && item.status !== 'paused');
}

function addCandidate(candidates, slug, input) {
  if (!slug) return;
  const existing = candidates.get(slug) || {
    slug,
    name: cleanText(input.name || slug, 80),
    description: cleanText(input.description || '', 220),
    sourceType: input.sourceType || 'auto',
    generationMetadata: input.generationMetadata || {},
    items: new Map(),
  };
  const current = existing.items.get(input.item.id);
  if (!current || input.confidence > current.confidence) {
    existing.items.set(input.item.id, {
      itemId: input.item.id,
      confidence: Number(input.confidence || 0.5),
      reason: cleanText(input.reason || `Matched ${existing.name}.`, 220),
      source: 'auto',
    });
  }
  candidates.set(slug, existing);
}

function buildRuleCandidates(candidates, item) {
  const text = itemSearchText(item);
  for (const rule of CATEGORY_RULES) {
    const termMatches = rule.terms.filter((term) => text.includes(term));
    const platformMatch = rule.platformKeys?.includes(String(item.platformKey || '').toLowerCase());
    if (!termMatches.length && !platformMatch) continue;
    addCandidate(candidates, rule.slug, {
      item,
      name: rule.name,
      description: rule.description,
      sourceType: 'rule',
      confidence: Math.min(0.95, 0.58 + termMatches.length * 0.08 + (platformMatch ? 0.12 : 0)),
      reason: platformMatch
        ? `Saved from ${item.platform || 'a matching platform'}.`
        : `Matched ${termMatches.slice(0, 3).join(', ')}.`,
      generationMetadata: { rule: rule.slug },
    });
  }
}

function buildEntityCandidates(candidates, item) {
  const analysis = item.analysis || {};
  const entityGroups = [
    ['topic', analysis.topics || []],
    ['tag', analysis.tags || []],
    ['brand', analysis.brandsMentioned || []],
    ['tool', analysis.toolsMentioned || []],
    ['person', analysis.peopleMentioned || []],
  ];
  for (const [sourceType, values] of entityGroups) {
    for (const value of unique(values).slice(0, 8)) {
      const slug = `${sourceType}-${slugify(value)}`;
      addCandidate(candidates, slug, {
        item,
        name: value,
        description: `Saves related to ${value}.`,
        sourceType,
        confidence: sourceType === 'topic' || sourceType === 'tag' ? 0.74 : 0.68,
        reason: `AI analysis found ${value}.`,
        generationMetadata: { sourceType, value },
      });
    }
  }
}

function buildManualCollectionCandidates(candidates, item) {
  for (const value of unique(item.collections || []).slice(0, 5)) {
    if (/^(unsorted|notes)$/i.test(value)) continue;
    addCandidate(candidates, `saved-${slugify(value)}`, {
      item,
      name: value,
      description: `Saves that started in ${value}.`,
      sourceType: 'saved_collection',
      confidence: 0.62,
      reason: `Originally saved in ${value}.`,
      generationMetadata: { collection: value },
    });
  }
}

function buildPlatformCandidates(candidates, item) {
  const platform = cleanText(item.platform || '', 80);
  if (!platform || /^iscraper/i.test(platform)) return;
  addCandidate(candidates, `platform-${slugify(platform)}`, {
    item,
    name: `${platform} saves`,
    description: `Everything saved from ${platform}.`,
    sourceType: 'platform',
    confidence: 0.55,
    reason: `Saved from ${platform}.`,
    generationMetadata: { platform },
  });
}

function generateSmartCollectionCandidates(items = []) {
  const candidates = new Map();
  for (const item of eligibleItems(items)) {
    buildRuleCandidates(candidates, item);
    buildEntityCandidates(candidates, item);
    buildManualCollectionCandidates(candidates, item);
    buildPlatformCandidates(candidates, item);
  }

  return [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      items: [...candidate.items.values()].sort((a, b) => b.confidence - a.confidence || String(a.itemId).localeCompare(String(b.itemId))),
    }))
    .filter((candidate) => candidate.items.length >= MIN_AUTO_COLLECTION_ITEMS)
    .sort((a, b) => b.items.length - a.items.length || String(a.name).localeCompare(String(b.name)))
    .slice(0, MAX_GENERATED_COLLECTIONS);
}

function publicSmartCollection(collection, memberships = [], itemById = new Map()) {
  const excluded = new Set(memberships.filter((entry) => entry.source === 'manual_exclude').map((entry) => entry.itemId));
  const activeByItem = new Map();
  for (const entry of memberships) {
    if (entry.source === 'manual_exclude' || excluded.has(entry.itemId)) continue;
    const current = activeByItem.get(entry.itemId);
    if (!current || Number(entry.confidence || 0) > Number(current.confidence || 0)) activeByItem.set(entry.itemId, entry);
  }
  const activeMemberships = [...activeByItem.values()];
  const items = activeMemberships
    .map((entry) => itemById.get(entry.itemId))
    .filter(Boolean);
  return {
    id: collection.id,
    userId: collection.userId,
    name: collection.name,
    description: collection.description || '',
    slug: collection.slug,
    sourceType: collection.sourceType || 'auto',
    pinned: Boolean(collection.pinned),
    hidden: Boolean(collection.hidden),
    generationMetadata: collection.generationMetadata || {},
    itemCount: activeMemberships.length,
    previewItems: items.slice(0, 3),
    updatedAt: collection.updatedAt,
    createdAt: collection.createdAt,
  };
}

function sortSmartCollections(collections = []) {
  return [...collections].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    if ((b.itemCount || 0) !== (a.itemCount || 0)) return (b.itemCount || 0) - (a.itemCount || 0);
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.name).localeCompare(String(b.name));
  });
}

module.exports = {
  DEFAULT_VISIBLE_COLLECTIONS_LIMIT,
  generateSmartCollectionCandidates,
  publicSmartCollection,
  sortSmartCollections,
  slugify,
  now,
};
