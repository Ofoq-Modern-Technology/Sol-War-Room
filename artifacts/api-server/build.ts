/**
 * build.ts — builds the SOL_WAR_ROOM API server for distribution.
 *
 * Usage:
 *   pnpm run build                 # server.cjs (requires Node.js ≥ 20)
 *   pnpm run build:binary          # standalone executables (no Node.js needed)
 *   pnpm run build:binary linux    # linux-x64 only
 *   pnpm run build:binary win      # windows-x64 only
 *   pnpm run build:binary mac      # macos-x64 + macos-arm64
 */

import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execFile } from "child_process";
import { promisify } from "util";
import { build as esbuild } from "esbuild";
import { rm, readFile, writeFile, cp, mkdir } from "fs/promises";
import { readFileSync, existsSync } from "fs";

const execFileAsync = promisify(execFile);
const _require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── CLI flags ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const BINARY_MODE = args.includes("--binary");
const PLATFORM_FILTER = args.find((a) => !a.startsWith("--")) ?? "all"; // linux | win | mac | all

// ── Packages bundled directly into server.cjs ───────────────────────────────
// sql.js is bundled (WASM embedded separately below); no native addons.
const bundleInline = [
  "bcryptjs",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "jsonwebtoken",
  "nanoid",
  "uuid",
  "ws",
  "zod",
  "zod-validation-error",
  "axios",
  "sql.js",
  // bs58 is ESM-only: require("bs58") returns { default: { encode, decode } }
  // instead of { encode, decode }, so bs58.encode is undefined at runtime.
  // Bundling inline lets esbuild handle the ESM→CJS interop correctly.
  "bs58",
];

// ── Binary targets (node version, os, arch) → output filename ───────────────
interface Target { nodeVersion: string; os: string; arch: string; out: string }
const ALL_TARGETS: Target[] = [
  { nodeVersion: "24", os: "linux",   arch: "x64",   out: "solwarroom-linux-x64"   },
  { nodeVersion: "24", os: "linux",   arch: "arm64", out: "solwarroom-linux-arm64" },
  { nodeVersion: "24", os: "win",     arch: "x64",   out: "solwarroom-win-x64.exe" },
  { nodeVersion: "24", os: "macos",   arch: "x64",   out: "solwarroom-macos-x64"   },
  { nodeVersion: "24", os: "macos",   arch: "arm64", out: "solwarroom-macos-arm64" },
];

function selectTargets(): Target[] {
  if (PLATFORM_FILTER === "all") return ALL_TARGETS;
  return ALL_TARGETS.filter((t) => t.os.startsWith(PLATFORM_FILTER));
}

// ── Build ────────────────────────────────────────────────────────────────────
async function buildAll() {
  const distDir = path.resolve(__dirname, "dist");
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  // ── Step 1: esbuild — JS bundle ──────────────────────────────────────────
  console.log("Building backend JS bundle…");

  const pkgPath = path.resolve(__dirname, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter(
    (dep) =>
      !bundleInline.includes(dep) &&
      !(pkg.dependencies?.[dep]?.startsWith("workspace:")),
  );

  const outCjs = path.resolve(distDir, "server.cjs");
  await esbuild({
    entryPoints: [path.resolve(__dirname, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: outCjs,
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // ── Step 2: embed sql.js WASM as base64 in server.cjs ───────────────────
  // This makes server.cjs fully self-contained — no external .wasm file needed.
  // The DB module reads globalThis.__SQLJS_WASM_B64__ at startup.
  const sqlJsDistDir = path.dirname(_require.resolve("sql.js"));
  const wasmPath = path.join(sqlJsDistDir, "sql-wasm.wasm");
  const wasmBase64 = readFileSync(wasmPath).toString("base64");
  const wasmHeader = `globalThis.__SQLJS_WASM_B64__=${JSON.stringify(wasmBase64)};\n`;

  const bundleContent = await readFile(outCjs, "utf-8");
  await writeFile(outCjs, wasmHeader + bundleContent);
  console.log(`WASM (${Math.round(wasmBase64.length * 0.75 / 1024)} KB) embedded in server.cjs`);

  // ── Step 3: frontend ─────────────────────────────────────────────────────
  // Always (re)build the Vite frontend so the binary includes the latest UI.
  // This ensures a plain `pnpm run build:binary linux` after `git pull` works
  // without a separate `pnpm --filter @workspace/sol-war build` step.
  console.log("Building frontend (Vite)…");
  const repoRoot = path.resolve(__dirname, "../..");
  try {
    await execFileAsync(
      "pnpm",
      ["--filter", "@workspace/sol-war", "run", "build"],
      { cwd: repoRoot },
    );
    console.log("Frontend built ✓");
  } catch (err) {
    console.error("Frontend build failed:", (err as Error).message.slice(0, 200));
    process.exit(1);
  }

  const viteDist = path.resolve(__dirname, "../sol-war/dist/public");
  try {
    await cp(viteDist, path.resolve(distDir, "public"), { recursive: true });
    console.log("Frontend assets copied → dist/public/");
  } catch {
    console.error("⚠  Frontend dist not found even after build — aborting.");
    process.exit(1);
  }

  if (!BINARY_MODE) {
    // ── Node.js mode: write start scripts and release package.json ──────
    // These packages are NOT bundled inline by esbuild and must be present
    // at runtime (e.g. for Docker: npm install --omit=dev in the dist/ dir).
    const RUNTIME_EXTERNAL_DEPS = [
      "@noble/ed25519",
      "@noble/hashes",
      "@solana/web3.js",
      "bip39",
      "cookie-parser",
      "ed25519-hd-key",
      "tweetnacl",
    ];
    const runtimeDeps: Record<string, string> = {};
    for (const dep of RUNTIME_EXTERNAL_DEPS) {
      const ver = (pkg.dependencies as Record<string, string>)?.[dep];
      if (ver) runtimeDeps[dep] = ver;
    }

    const releasePkg = {
      name: "solwarroom",
      version: pkg.version ?? "1.0.0",
      description: "SOL_WAR_ROOM — self-hosted Solana trading panel",
      main: "server.cjs",
      scripts: { start: "node server.cjs" },
      dependencies: runtimeDeps,
      engines: { node: ">=20" },
    };
    await writeFile(
      path.resolve(distDir, "package.json"),
      JSON.stringify(releasePkg, null, 2),
    );

    await writeFile(
      path.resolve(distDir, "start.sh"),
      [
        "#!/usr/bin/env bash",
        "set -e",
        'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
        'cd "$SCRIPT_DIR"',
        'echo "Starting SOL_WAR_ROOM on port ${PORT:-8080}…"',
        "node server.cjs",
      ].join("\n") + "\n",
    );
    await writeFile(
      path.resolve(distDir, "start.bat"),
      ["@echo off", "cd /d %~dp0", "echo Starting SOL_WAR_ROOM...", "node server.cjs"].join(
        "\r\n",
      ) + "\r\n",
    );

    console.log("\n✅  Build complete → dist/");
    console.log("   server.cjs is self-contained (WASM embedded, no npm install needed)");
    console.log("   Requires: Node.js ≥ 20 on the target machine");
    console.log("   To run:   node dist/server.cjs");
    return;
  }

  // ── Step 4: pkg — standalone executables ─────────────────────────────────
  console.log("\nBuilding standalone binaries (this downloads Node.js runtimes once)…");

  const targets = selectTargets();
  const pkgBin = path.resolve(__dirname, "node_modules/.bin/pkg");
  // Fallback to workspace-level pkg if not found locally
  const pkgBinFallback = path.resolve(
    __dirname,
    "../../node_modules/.bin/pkg",
  );
  const pkgExe = existsSync(pkgBin) ? pkgBin : pkgBinFallback;

  for (const t of targets) {
    const targetStr = `node${t.nodeVersion}-${t.os}-${t.arch}`;
    const outPath = path.resolve(distDir, t.out);
    console.log(`  Building ${t.out} (${targetStr})…`);
    try {
      await execFileAsync(pkgExe, [
        outCjs,
        "--targets",
        targetStr,
        "--output",
        outPath,
        "--compress",
        "GZip",
      ]);
      console.log(`  ✓ ${t.out}`);
    } catch (err) {
      console.error(`  ✗ ${t.out} failed:`, (err as Error).message.split("\n")[0]);
    }
  }

  console.log("\n✅  Standalone binaries built → dist/");
  console.log("   No Node.js installation required on the target machine.");
  console.log("   Linux:   ./solwarroom-linux-x64");
  console.log("   Windows: solwarroom-win-x64.exe");
  console.log("   macOS:   ./solwarroom-macos-arm64");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
