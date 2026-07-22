export function isPersistedPlayableVideoReference(url?: string): url is string {
  if (!url) return false;
  const value = url.trim();
  return value.startsWith("http://")
    || value.startsWith("https://")
    || value.startsWith("/storage/")
    || value.startsWith("data:video/");
}

export function isPublishableVideoUrl(url?: string): url is string {
  if (!url) return false;
  const value = url.trim();
  if (!value.startsWith("http://") && !value.startsWith("https://") && !value.startsWith("/storage/")) return false;
  return /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(value);
}
