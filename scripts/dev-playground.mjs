import { execFileSync, spawn } from "node:child_process";

const DEFAULT_PORT = 5173;

function resolvePort() {
  const rawPort = process.env.PORT;
  const parsedPort = Number.parseInt(rawPort ?? "", 10);
  return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
}

function listPidsOnPort(port) {
  try {
    const output = execFileSync("lsof", ["-ti", `tcp:${port}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });

    return output
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0);
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function freePort(port) {
  const pids = [...new Set(listPidsOnPort(port))].filter((pid) => pid !== process.pid);
  if (pids.length === 0) {
    return;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore processes that already exited.
    }
  }

  await sleep(250);

  const remainingPids = [...new Set(listPidsOnPort(port))].filter((pid) => pid !== process.pid);
  for (const pid of remainingPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore processes that already exited.
    }
  }
}

async function main() {
  const port = resolvePort();
  await freePort(port);

  const child = spawn("pnpm", ["exec", "vite", ...process.argv.slice(2)], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
