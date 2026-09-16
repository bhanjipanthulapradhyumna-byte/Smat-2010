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

await fs.mkdir(path.join(DATA, "uploads"), { recursive: true });
await fs.mkdir(path.join(DATA, "runs"), { recursive: true });

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(ROOT, "public")));

const upload = multer({
  dest: path.join(DATA, "uploads"),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 }
});

function octaveExecutable() {
  return process.env.OCTAVE_COMMAND || "octave-cli";
}

function hasOctave() {
  return Boolean(process.env.OCTAVE_COMMAND) ||
    existsSync("/usr/bin/octave-cli") ||
    existsSync("/usr/local/bin/octave-cli");
}

async function runOctave({ code, filename, projectFiles }) {
  const id = randomUUID();
  const work = path.join(DATA, "runs", id);
  await fs.mkdir(work, { recursive: true });

  const safeFilename = path.basename(filename || "main.m");
  await fs.writeFile(path.join(work, safeFilename), code, "utf8");

  for (const file of Array.isArray(projectFiles) ? projectFiles : []) {
    if (!file?.name || typeof file.content !== "string") continue;
    await fs.writeFile(path.join(work, path.basename(file.name)), file.content, "utf8");
  }

  // Octave-compatible runner. MATLAB code that is also supported by GNU Octave
  // can be executed here without requiring a paid MATLAB installation.
  const escaped = safeFilename.replaceAll("'", "''");
  const runner = `
try
    diary('smat_output.txt');
    run('${escaped}');
    disp('___SMAT_WORKSPACE_BEGIN___');
    whos;
    disp('___SMAT_WORKSPACE_END___');
    diary off;
    exit(0);
catch ME
    diary('smat_output.txt');
    fprintf(2, 'SMAT execution error: %s\\\\n', ME.message);
    if isfield(ME, 'stack')
        for k = 1:numel(ME.stack)
            fprintf(2, '  at %s (line %d)\\\\n', ME.stack(k).name, ME.stack(k).line);
        end
    end
    diary off;
    exit(1);
end
`;
  await fs.writeFile(path.join(work, "__smat_runner__.m"), runner, "utf8");

  const started = Date.now();

  const result = await new Promise((resolve) => {
    const child = spawn(
      octaveExecutable(),
      ["--no-gui", "--quiet", "--eval", "run('__smat_runner__.m')"],
      { cwd: work, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };

    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        exitCode: -1,
        stdout,
        stderr: "Execution timed out after 30 seconds."
      });
    }, 30000);

    child.on("error", error => {
      finish({
        exitCode: -1,
        stdout,
        stderr: `Could not start GNU Octave: ${error.message}`
      });
    });

    child.on("close", exitCode => {
      finish({ exitCode, stdout, stderr });
    });
  });

  let diary = "";
  try {
    diary = await fs.readFile(path.join(work, "smat_output.txt"), "utf8");
  } catch {}

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
    engine: "GNU Octave",
    createdAt: new Date().toISOString()
  };

  RUNS.set(id, run);
  return run;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    engine: "GNU Octave",
    octaveAvailable: hasOctave()
  });
});

app.post("/api/run", async (req, res) => {
  const { code, filename = "main.m", projectFiles = [] } = req.body || {};

  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ error: "No MATLAB/Octave code supplied." });
  }

  if (!hasOctave()) {
    const id = randomUUID();
    const run = {
      id,
      filename,
      success: false,
      stdout: "",
      stderr:
        "GNU Octave is not installed on this server. The deployment must use the supplied Dockerfile so octave-cli is installed.",
      executionTime: 0,
      variables: [],
      plots: [],
      engine: "GNU Octave",
      createdAt: new Date().toISOString()
    };
    RUNS.set(id, run);
    return res.status(503).json(run);
  }

  try {
    const run = await runOctave({ code, filename, projectFiles });
    res.status(run.success ? 200 : 422).json(run);
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

// Express 5 wildcard syntax
app.get("/*splat", (_req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`SMAT: http://localhost:${PORT}`);
  console.log(`Execution engine: GNU Octave (${hasOctave() ? "available" : "NOT FOUND"})`);
});
