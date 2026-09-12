export function adminPageRange(total: number, requestedPage = 1, pageSize = 20) {
  const size = Math.max(1, Math.floor(pageSize));
  const count = Math.max(0, Math.floor(total));
  const pages = Math.max(1, Math.ceil(count / size));
  const page = Math.max(1, Math.min(pages, Math.floor(requestedPage) || 1));
  const start = count ? (page - 1) * size : 0;
  return { page, pages, pageSize: size, start, end: Math.min(count, start + size), total: count };
}
