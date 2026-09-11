export function firstAdminRefreshFailure(results: PromiseSettledResult<unknown>[]): Error | undefined {
  for (const result of results) {
    if (result.status === "rejected") {
      return result.reason instanceof Error ? result.reason : new Error("后台部分数据读取失败，请刷新重试。");
    }
  }
  return undefined;
}
