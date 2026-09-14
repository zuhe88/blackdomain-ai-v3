const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { test } = require("node:test");
const express = require("express");
const { registerBrandLandingRoutes } = require("../routes/brandLanding");

test("Android download route delivers the verified APK and member instructions", async () => {
  const root = path.join(__dirname, "..", "public", "assistant", "android");
  const release = JSON.parse(fs.readFileSync(path.join(root, "release.json"), "utf8").replace(/^\uFEFF/, ""));
  const apk = fs.readFileSync(path.join(root, release.filename));
  assert.equal(apk.subarray(0, 2).toString(), "PK", "APK must be a ZIP archive");
  assert.equal(crypto.createHash("sha256").update(apk).digest("hex"), release.sha256);
  assert.match(fs.readFileSync(path.join(root, `${release.filename}.sha256`), "utf8"), new RegExp(`^${release.sha256}  ${release.filename}`));
  const app = express();
  registerBrandLandingRoutes(app);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${origin}/assistant/android/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const copy of ["下載 Android 安裝檔", "顯示在其他應用程式上層", "縮小", "3A 帳號", release.filename]) {
      assert.ok(html.includes(copy), `Missing member instruction: ${copy}`);
    }
    const download = await fetch(`${origin}/assistant/android/${release.filename}`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-type"), /application\/vnd\.android\.package-archive/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), apk);
    const installer = await fetch(`${origin}/assistant/`);
    assert.ok((await installer.text()).includes('/assistant/android/'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
