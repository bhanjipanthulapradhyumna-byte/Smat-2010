import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();
const DATA = path.join(ROOT, ".smat");
const RUNS = new Map();

await fs.mkdir(DATA, { recursive: true });
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(ROOT, "public")));

const upload = multer({
  dest: path.join(DATA, "uploads"),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 }
});

function matlabExecutable() {
  return process.env.MATLAB_COMMAND || "matlab";
}

async function runRealMatlab({ code, filename, projectFiles }) {
  const id = randomUUID();
  const work = path.join(DATA, "runs", id);
  await fs.mkdir(work, { recursive: true });

  const safeFilename = path.basename(filename || "main.m");
  await fs.writeFile(path.join(work, safeFilename), code, "utf8");

  for (const file of Array.isArray(projectFiles) ? projectFiles : []) {
    if (!file?.name || typeof file.content !== "string") continue;
    await fs.writeFile(path.join(work, path.basename(file.name)), file.content, "utf8");
  }

  const runner = `
try
    diary('smat_output.txt');
    run('${safeFilename.replaceAll("'", "''")}');
    disp('___SMAT_WORKSPACE_BEGIN___');
    whos;
    disp('___SMAT_WORKSPACE_END___');
    diary off;
    exit(0);
catch ME
    diary('smat_output.txt');
    disp(getReport(ME,'extended','hyperlinks','off'));
    diary off;
    exit(1);
end
`;
  await fs.writeFile(path.join(work, "__smat_runner__.m"), runner, "utf8");

  const started = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn(matlabExecutable(), ["-batch", "run('__smat_runner__.m')"], {
      cwd: work,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => stdout += d.toString());
    child.stderr.on("data", d => stderr += d.toString());

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ exitCode: -1, stdout, stderr: "Execution timed out after 30 seconds." });
    }, 30000);

    child.on("close", exitCode => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });

  let diary = "";
  try { diary = await fs.readFile(path.join(work, "smat_output.txt"), "utf8"); } catch {}

  const output = diary || result.stdout;
  const run = {
    id,
    filename: safeFilename,
    success: result.exitCode === 0,
    stdout: output,
    stderr: result.stderr,
    executionTime: (Date.now() - started) / 1000,
    variables: [],
    plots: [],
    createdAt: new Date().toISOString()
  };

  RUNS.set(id, run);
  return run;
}

function hasMatlab() {
  return Boolean(process.env.MATLAB_COMMAND) ||
    existsSync("/usr/local/MATLAB/R2024b/bin/matlab") ||
    existsSync("/usr/local/MATLAB/R2025a/bin/matlab") ||
    existsSync("/Applications/MATLAB_R2024b.app/bin/matlab") ||
    existsSync("/Applications/MATLAB_R2025a.app/bin/matlab");
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, matlabAvailable: hasMatlab() });
});

app.post("/api/run", async (req, res) => {
  const { code, filename = "main.m", projectFiles = [] } = req.body || {};
  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ error: "No MATLAB code supplied." });
  }

  if (!hasMatlab()) {
    const id = randomUUID();
    const run = {
      id,
      filename,
      success: false,
      stdout: "",
      stderr:
        "MATLAB is not connected to this server. Install MATLAB and set MATLAB_COMMAND to the MATLAB executable, then restart SMAT.",
      executionTime: 0,
      variables: [],
      plots: [],
      createdAt: new Date().toISOString()
    };
    RUNS.set(id, run);
    return res.status(503).json(run);
  }

  try {
    const run = await runRealMatlab({ code, filename, projectFiles });
    res.json(run);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/runs/:id", (req, res) => {
  const run = RUNS.get(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found." });
  res.json(run);
});

app.post("/api/upload", upload.array("files"), async (req, res) => {
  const files = [];
  for (const item of req.files || []) {
    const content = await fs.readFile(item.path, "utf8").catch(() => "");
    files.push({ name: item.originalname, size: item.size, content });
    await fs.unlink(item.path).catch(() => {});
  }
  res.json(files);
});

app.get("*splat", (_req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`SMAT: http://localhost:${PORT}`);
});
