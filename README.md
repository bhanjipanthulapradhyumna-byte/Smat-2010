# SMAT — Scientific MATLAB Workspace

This project preserves the SMAT-style editor layout and adds a real backend execution path.

## Run

1. Install Node.js 20+.
2. Open a terminal in this folder.
3. Run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000`.

## Real MATLAB execution

The frontend never executes MATLAB in the browser.

The server looks for MATLAB using:

- `MATLAB_COMMAND` environment variable, or
- common MATLAB installation paths.

Example Linux/macOS:

```bash
export MATLAB_COMMAND=/usr/local/MATLAB/R2025a/bin/matlab
npm start
```

Windows PowerShell example:

```powershell
$env:MATLAB_COMMAND="C:\Program Files\MATLAB\R2025a\bin\matlab.exe"
npm start
```

The Run button sends the current `.m` file and other project `.m` files to `/api/run`. The server executes MATLAB in a per-run working directory and sends the result to `/output.html?run=<runId>`.

If MATLAB is unavailable, SMAT shows an explicit backend-unavailable result; it does not pretend to have executed the code.

## Important production security

For public deployment, place MATLAB execution inside a dedicated isolated worker/container with CPU, memory, filesystem, process, and timeout limits. Do not expose a MATLAB host directly to arbitrary internet traffic.
