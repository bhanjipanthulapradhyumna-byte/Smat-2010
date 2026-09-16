import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const ROOT = process.cwd();
const DATA = path.join(ROOT, ".smat");

const RUNS = new Map();

// --------------------------------------------------
// Create required directories
// --------------------------------------------------

await fs.mkdir(DATA, { recursive: true });
await fs.mkdir(path.join(DATA, "uploads"), { recursive: true });
await fs.mkdir(path.join(DATA, "runs"), { recursive: true });

// --------------------------------------------------
// Middleware
// --------------------------------------------------

app.use(express.json({ limit: "5mb" }));

// Website files are in the repository root
app.use(express.static(ROOT));

// --------------------------------------------------
// File upload configuration
// --------------------------------------------------

const upload = multer({
  dest: path.join(DATA, "uploads"),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 20
  }
});

// --------------------------------------------------
// MATLAB executable
// --------------------------------------------------

function matlabExecutable() {
  return process.env.MATLAB_COMMAND || "matlab";
}

// --------------------------------------------------
// Check whether MATLAB exists
// --------------------------------------------------

function hasMatlab() {
  if (process.env.MATLAB_COMMAND) {
    return true;
  }

  const possiblePaths = [
    "/usr/local/MATLAB/R2024b/bin/matlab",
    "/usr/local/MATLAB/R2025a/bin/matlab",
    "/usr/local/MATLAB/R2025b/bin/matlab",
    "/Applications/MATLAB_R2024b.app/bin/matlab",
    "/Applications/MATLAB_R2025a.app/bin/matlab"
  ];

  return possiblePaths.some((file) => existsSync(file));
}

// --------------------------------------------------
// Run real MATLAB
// --------------------------------------------------

async function runRealMatlab({
  code,
  filename,
  projectFiles
}) {
  const id = randomUUID();

  const work = path.join(
    DATA,
    "runs",
    id
  );

  await fs.mkdir(work, {
    recursive: true
  });

  // Prevent directory traversal
  const safeFilename = path.basename(
    filename || "main.m"
  );

  // Write main MATLAB file
  await fs.writeFile(
    path.join(work, safeFilename),
    code,
    "utf8"
  );

  // Write additional project files
  for (
    const file of Array.isArray(projectFiles)
      ? projectFiles
      : []
  ) {
    if (
      !file?.name ||
      typeof file.content !== "string"
    ) {
      continue;
    }

    const safeProjectFilename =
      path.basename(file.name);

    await fs.writeFile(
      path.join(
        work,
        safeProjectFilename
      ),
      file.content,
      "utf8"
    );
  }

  // Escape filename for MATLAB
  const matlabFilename =
    safeFilename.replaceAll("'", "''");

  // MATLAB runner
  const runner = `
try
    diary('smat_output.txt');

    run('${matlabFilename}');

    disp('___SMAT_WORKSPACE_BEGIN___');
    whos;
    disp('___SMAT_WORKSPACE_END___');

    diary off;
    exit(0);

catch ME

    diary('smat_output.txt');

    disp(
        getReport(
            ME,
            'extended',
            'hyperlinks',
            'off'
        )
    );

    diary off;
    exit(1);

end
`;

  await fs.writeFile(
    path.join(
      work,
      "__smat_runner__.m"
    ),
    runner,
    "utf8"
  );

  const started = Date.now();

  const result = await new Promise(
    (resolve) => {

      const child = spawn(
        matlabExecutable(),
        [
          "-batch",
          "run('__smat_runner__.m')"
        ],
        {
          cwd: work,
          stdio: [
            "ignore",
            "pipe",
            "pipe"
          ]
        }
      );

      let stdout = "";
      let stderr = "";

      child.stdout.on(
        "data",
        (data) => {
          stdout += data.toString();
        }
      );

      child.stderr.on(
        "data",
        (data) => {
          stderr += data.toString();
        }
      );

      const timeout =
        setTimeout(() => {

          child.kill("SIGKILL");

          resolve({
            exitCode: -1,
            stdout,
            stderr:
              "Execution timed out after 30 seconds."
          });

        }, 30000);

      child.on(
        "close",
        (exitCode) => {

          clearTimeout(timeout);

          resolve({
            exitCode,
            stdout,
            stderr
          });

        }
      );

      child.on(
        "error",
        (error) => {

          clearTimeout(timeout);

          resolve({
            exitCode: -1,
            stdout,
            stderr: error.message
          });

        }
      );
    }
  );

  // Read MATLAB diary output
  let diary = "";

  try {
    diary = await fs.readFile(
      path.join(
        work,
        "smat_output.txt"
      ),
      "utf8"
    );
  } catch {
    diary = "";
  }

  const output =
    diary || result.stdout;

  const run = {
    id,

    filename: safeFilename,

    success:
      result.exitCode === 0,

    stdout: output,

    stderr: result.stderr,

    executionTime:
      (Date.now() - started) / 1000,

    variables: [],

    plots: [],

    createdAt:
      new Date().toISOString()
  };

  RUNS.set(id, run);

  return run;
}

// --------------------------------------------------
// Health endpoint
// --------------------------------------------------

app.get(
  "/api/health",
  (_req, res) => {

    res.json({
      ok: true,
      service: "SMAT",
      matlabAvailable:
        hasMatlab()
    });

  }
);

// --------------------------------------------------
// MATLAB execution endpoint
// --------------------------------------------------

app.post(
  "/api/run",
  async (req, res) => {

    const {
      code,
      filename = "main.m",
      projectFiles = []
    } = req.body || {};

    if (
      typeof code !== "string" ||
      !code.trim()
    ) {
      return res.status(400).json({
        error:
          "No MATLAB code supplied."
      });
    }

    // MATLAB isn't installed in the
    // normal Node Docker image.
    if (!hasMatlab()) {

      const id = randomUUID();

      const run = {

        id,

        filename,

        success: false,

        stdout: "",

        stderr:
          "MATLAB is not connected to this server. The SMAT web server is running, but this container does not contain MATLAB. Set MATLAB_COMMAND to a valid MATLAB executable in an environment that has MATLAB installed.",

        executionTime: 0,

        variables: [],

        plots: [],

        createdAt:
          new Date().toISOString()

      };

      RUNS.set(id, run);

      return res
        .status(503)
        .json(run);
    }

    try {

      const run =
        await runRealMatlab({
          code,
          filename,
          projectFiles
        });

      res.json(run);

    } catch (error) {

      console.error(
        "MATLAB execution error:",
        error
      );

      res.status(500).json({
        error:
          error?.message ||
          "MATLAB execution failed."
      });

    }
  }
);

// --------------------------------------------------
// Retrieve previous run
// --------------------------------------------------

app.get(
  "/api/runs/:id",
  (req, res) => {

    const run =
      RUNS.get(
        req.params.id
      );

    if (!run) {

      return res
        .status(404)
        .json({
          error:
            "Run not found."
        });

    }

    res.json(run);
  }
);

// --------------------------------------------------
// File upload endpoint
// --------------------------------------------------

app.post(
  "/api/upload",
  upload.array("files"),
  async (req, res) => {

    try {

      const files = [];

      for (
        const item of req.files || []
      ) {

        const content =
          await fs.readFile(
            item.path,
            "utf8"
          ).catch(() => "");

        files.push({

          name:
            item.originalname,

          size:
            item.size,

          content

        });

        await fs.unlink(
          item.path
        ).catch(() => {});

      }

      res.json(files);

    } catch (error) {

      res.status(500).json({
        error:
          error?.message ||
          "File upload failed."
      });

    }
  }
);

// --------------------------------------------------
// Frontend fallback
// --------------------------------------------------

app.get(
  "*splat",
  (_req, res) => {

    res.sendFile(
      path.join(
        ROOT,
        "index.html"
      )
    );

  }
);

// --------------------------------------------------
// Start server
// --------------------------------------------------

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `SMAT server running on port ${PORT}`
    );

    console.log(
      `MATLAB available: ${hasMatlab()}`
    );

  }
);
