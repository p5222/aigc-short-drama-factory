import type { AdminUserRow } from "@aifilm/shared";
import { requestJson } from "../lib/httpClient";

export function fetchAdminUserPage(input: { page: number; pageSize: number; keyword: string; role: string; status: string; sort: string; registeredFrom: string; registeredTo: string; membership?: string; commercial?: string }, signal?: AbortSignal) {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize), keyword: input.keyword, role: input.role, status: input.status, sort: input.sort });
  if (input.membership && input.membership !== "all") query.set("membership", input.membership);
  if (input.commercial && input.commercial !== "all") query.set("commercial", input.commercial);
  // Date pickers describe whole calendar days in the administrator's local timezone.
  if (input.registeredFrom) query.set("registeredFrom", new Date(`${input.registeredFrom}T00:00:00.000`).toISOString());
  if (input.registeredTo) query.set("registeredTo", new Date(`${input.registeredTo}T23:59:59.999`).toISOString());
  return requestJson<{ items: AdminUserRow[]; total: number; page: number; pageSize: number }>(`/admin/users/page?${query}`, { signal });
}
