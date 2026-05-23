const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const DATA_IMAGE_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/i;

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function validateProfileInput({ username, avatarUrl = '' }) {
  const normalizedUsername = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalizedUsername)) {
    throw Object.assign(new Error('Username must be 3-24 characters using lowercase letters, numbers, or underscores.'), { statusCode: 400 });
  }

  const normalizedAvatarUrl = String(avatarUrl || '').trim();
  if (normalizedAvatarUrl) {
    const isHttpUrl = /^https:\/\/[^\s]+$/i.test(normalizedAvatarUrl);
    const isSmallDataImage = normalizedAvatarUrl.length <= 350000 && DATA_IMAGE_PATTERN.test(normalizedAvatarUrl);
    if (!isHttpUrl && !isSmallDataImage) {
      throw Object.assign(new Error('Profile picture must be an HTTPS image URL or a small PNG/JPEG/WebP upload.'), { statusCode: 400 });
    }
  }

  return {
    username: normalizedUsername,
    avatarUrl: normalizedAvatarUrl,
  };
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    userId: profile.userId,
    username: profile.username,
    avatarUrl: profile.avatarUrl || '',
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

module.exports = {
  normalizeUsername,
  publicProfile,
  validateProfileInput,
};
