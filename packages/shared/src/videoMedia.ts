export function isPlayableVideoUrl(url?: string): url is string {
  if (!url) return false;
  const value = url.trim();
  return value.startsWith("http://")
    || value.startsWith("https://")
    || value.startsWith("/storage/")
    || value.startsWith("data:video/");
}
