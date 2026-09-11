import type { AdminUserRow } from "@aifilm/shared";
import { requestJson } from "../lib/httpClient";

export function fetchAdminUserPage(input: { page: number; keyword: string; role: string; status: string }, signal?: AbortSignal) {
  const query = new URLSearchParams({ page: String(input.page), pageSize: "25", keyword: input.keyword, role: input.role, status: input.status });
  return requestJson<{ items: AdminUserRow[]; total: number; page: number; pageSize: number }>(`/admin/users/page?${query}`, { signal });
}
