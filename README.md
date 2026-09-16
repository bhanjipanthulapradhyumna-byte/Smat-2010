# SMAT — Scientific MATLAB-Compatible Workspace

SMAT runs MATLAB-compatible `.m` code on the server using **GNU Octave**.

## Important

This deployment does **not** contain licensed MATLAB. It uses GNU Octave, which supports a large subset of MATLAB syntax.

## Run locally

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

## Docker / Back4App

Use the supplied `Dockerfile`. It installs GNU Octave automatically.

The server starts with:

```text
npm start
```

and exposes:

```text
PORT=3000
```

The execution API is:

```text
POST /api/run
```

The health endpoint is:

```text
GET /api/health
```

It should report:

```json
{
  "ok": true,
  "engine": "GNU Octave",
  "octaveAvailable": true
}
```

## Supported examples

Basic MATLAB-compatible commands such as:

```matlab
clc;
A = [1 2; 3 4];
b = [5; 6];
x = A\b;
disp(x);
```

and:

```matlab
x = 0:0.1:10;
y = sin(x);
fprintf("Maximum: %.4f\n", max(y));
```

should execute through GNU Octave.

## Limitations

GNU Octave is not identical to MATLAB. Some MATLAB toolboxes, proprietary functions, Simulink models, and newer MATLAB-only features will not work.

For public deployment, arbitrary code execution should ideally be isolated in a separate worker/container with CPU, memory, filesystem, network, and timeout restrictions.
