# Inference Model Playground

A Next.js App Router request editor written in TypeScript. Each model row has three concept buttons:

- **architecture** opens an editable model architecture code editor
- **playground** opens a two-column cURL request and response editor
- **kernels** opens an editable Triton kernel code editor

## Features

- Next.js App Router with TypeScript
- Model catalog with search
- Straight-edged block interface
- Editable cURL request editor
- Model-specific sample request bodies
- Request execution from the browser
- Streaming support for `stream: true` chat requests
- Response formatting and raw response inspection
- Editable Triton kernel code for each model

## Run locally

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Production build

```bash
npm run build
npm start
```

## TypeScript

```bash
npm run typecheck
```

## Browser CORS requirement

Requests are sent directly from the browser. Your inference endpoint must include CORS headers such as:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Allow-Methods: GET, POST, OPTIONS
```

If a request reports a network or CORS error, enable CORS on the inference service or add a Next.js route handler as a backend proxy.
