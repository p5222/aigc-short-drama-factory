export function saveCreditCsv(blob: Blob) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = "积分流水.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
