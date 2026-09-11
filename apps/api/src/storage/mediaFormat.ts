/** Inspect bytes instead of trusting a CDN's MIME type or file extension. */
export function mediaExtension(bytes: Buffer, bucket: "images" | "videos"): string {
  if (bucket === "images") {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
    if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "gif";
    if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  } else {
    if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") return "mp4";
    if (bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) return "webm";
    if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "AVI ") return "avi";
  }
  throw new Error(bucket === "images" ? "素材内容不是受支持的图片" : "素材内容不是受支持的视频");
}
