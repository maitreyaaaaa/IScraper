const CONTENT_TYPE_OPTIONS = [
  'instagram',
  'pinterest',
  'web_pages_links',
  'screenshots',
  'documents_pdfs',
  'voice_notes',
  'notes',
  'inspiration_ideas',
  'videos_social_posts',
];

const REFERRAL_SOURCE_OPTIONS = [
  'whatsapp_friend',
  'instagram',
  'youtube',
  'tiktok',
  'x_twitter',
  'reddit',
  'linkedin',
  'google_search',
  'product_hunt',
  'school_college',
  'other',
];

const CONTENT_TYPE_SET = new Set(CONTENT_TYPE_OPTIONS);
const REFERRAL_SOURCE_SET = new Set(REFERRAL_SOURCE_OPTIONS);

function validateOnboardingInput(input = {}) {
  const contentTypes = Array.isArray(input.contentTypes)
    ? [...new Set(input.contentTypes.map((value) => String(value || '').trim()).filter(Boolean))]
    : [];
  const referralSource = String(input.referralSource || '').trim();
  const skipped = input.skipped === true;

  if (contentTypes.length > CONTENT_TYPE_OPTIONS.length) {
    throw Object.assign(new Error('Choose fewer onboarding options.'), { statusCode: 400 });
  }
  for (const value of contentTypes) {
    if (!CONTENT_TYPE_SET.has(value)) {
      throw Object.assign(new Error('Choose a valid onboarding option.'), { statusCode: 400 });
    }
  }
  if (referralSource && !REFERRAL_SOURCE_SET.has(referralSource)) {
    throw Object.assign(new Error('Choose a valid referral source.'), { statusCode: 400 });
  }

  return {
    contentTypes,
    referralSource,
    skipped,
  };
}

function publicOnboardingPreferences(row) {
  if (!row) return null;
  return {
    userId: row.userId,
    contentTypes: Array.isArray(row.contentTypes) ? row.contentTypes : [],
    referralSource: row.referralSource || '',
    completedAt: row.completedAt || null,
    skippedAt: row.skippedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

module.exports = {
  CONTENT_TYPE_OPTIONS,
  REFERRAL_SOURCE_OPTIONS,
  publicOnboardingPreferences,
  validateOnboardingInput,
};
