import assert from "node:assert/strict";
import test from "node:test";
import { downloadPublicMedia, isPublicAddress } from "./remoteDownload.js";

test("media requests reject every local, mapped and reserved network family", () => {
  for (const address of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.1.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fe80::1", "fc00::1", "2001:db8::1"]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
});

test("untrusted downloads reject private hosts and non-HTTP protocols before requesting", async () => {
  for (const url of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "file:///etc/passwd"]) await assert.rejects(downloadPublicMedia(url, 1024));
});
