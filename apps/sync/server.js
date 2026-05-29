import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import {
  extractFigmaTokens,
  extractFigmaComponentProps,
  getComponentScreenshot,
} from './figma.js';

import {
  parseTokensCSS,
  parseTypesTS,
  diffTokens,
  diffComponentProps,
  applyTokenDiffs,
  applyVariantDiffs,
} from './differ.js';

import { screenshotComponent } from './screenshotter.js';
import { openSyncPR } from './github.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const CONFIG_PATH = path.join(__dirname, 'sync.config.json');
const TOKENS_CSS = path.join(ROOT, 'packages/tokens/tokens.css');

const app = express();
app.use(express.json());

// Serve static files from /public (sync UI)
app.use(express.static(path.join(__dirname, 'public')));

// Serve monorepo files (for preview.html to load tokens.css)
app.use('/packages', express.static(path.join(ROOT, 'packages')));

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// GET /api/config
app.get('/api/config', (req, res) => {
  try {
    res.json(loadConfig());
  } catch {
    res.json({ figmaFileKey: '', components: {} });
  }
});

// POST /api/config  — save Figma file key
app.post('/api/config', (req, res) => {
  const cfg = loadConfig();
  if (req.body.figmaFileKey) cfg.figmaFileKey = req.body.figmaFileKey;
  saveConfig(cfg);
  res.json({ ok: true });
});

// GET /api/components — list all mapped components
app.get('/api/components', (req, res) => {
  const cfg = loadConfig();
  res.json(Object.entries(cfg.components).map(([name, meta]) => ({ name, ...meta })));
});

// GET /api/check/:component — run full diff for one component
app.get('/api/check/:component', async (req, res) => {
  const cfg = loadConfig();
  const token = process.env.FIGMA_TOKEN;
  const fileKey = cfg.figmaFileKey;
  const meta = cfg.components[req.params.component];

  if (!meta) return res.status(404).json({ error: 'Component not found in config' });
  if (!fileKey) return res.status(400).json({ error: 'Figma file key not set' });

  try {
    const [figmaTokens, figmaProps] = await Promise.all([
      extractFigmaTokens(token, fileKey),
      meta.figmaNodeId ? extractFigmaComponentProps(token, fileKey, meta.figmaNodeId) : Promise.resolve({ props: {} }),
    ]);

    const codeTokens = parseTokensCSS(TOKENS_CSS);
    const codeTypes = parseTypesTS(path.join(ROOT, meta.typesFile));

    const tokenDiffs = diffTokens(figmaTokens, codeTokens);
    const variantDiffs = diffComponentProps(figmaProps.props ?? {}, codeTypes);
    const allDiffs = [...tokenDiffs, ...variantDiffs];

    // Screenshots (non-blocking — return null on error)
    let figmaScreenshot = null;
    let codeScreenshot = null;

    if (meta.figmaNodeId) {
      figmaScreenshot = await getComponentScreenshot(token, fileKey, meta.figmaNodeId).catch(() => null);
    }

    const previewUrl = `http://localhost:${process.env.PORT || 3333}/packages/components/${req.params.component}/preview.html`;
    codeScreenshot = await screenshotComponent(previewUrl).catch(() => null);

    res.json({
      component: req.params.component,
      figmaScreenshot,
      codeScreenshot,
      diffs: allDiffs,
      hasDiffs: allDiffs.length > 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/approve — apply approved diffs and open GitHub PR
app.post('/api/approve', async (req, res) => {
  const { component, approvedDiffs } = req.body;
  if (!approvedDiffs?.length) return res.json({ ok: true, message: 'Nothing to apply' });

  const cfg = loadConfig();
  const meta = cfg.components[component];
  if (!meta) return res.status(404).json({ error: 'Component not found' });

  try {
    const currentTokensCSS = fs.readFileSync(TOKENS_CSS, 'utf8');
    const typesPath = path.join(ROOT, meta.typesFile);
    const currentTypesTS = fs.readFileSync(typesPath, 'utf8');

    const newTokensCSS = applyTokenDiffs(currentTokensCSS, approvedDiffs);
    const newTypesTS = applyVariantDiffs(currentTypesTS, approvedDiffs);

    const branchName = `sync/${component}-${Date.now()}`;
    const tokenDiffs = approvedDiffs.filter(d => d.type === 'token');
    const variantDiffs = approvedDiffs.filter(d => d.type === 'variant');

    const files = [];
    if (tokenDiffs.length) {
      files.push({
        path: 'packages/tokens/tokens.css',
        content: newTokensCSS,
        message: `sync(tokens): apply ${tokenDiffs.length} Figma token update(s)`,
      });
    }
    if (variantDiffs.length) {
      files.push({
        path: meta.typesFile,
        content: newTypesTS,
        message: `sync(${component}): update variant types from Figma`,
      });
    }

    const parts = [];
    if (tokenDiffs.length) parts.push(`${tokenDiffs.length} token change(s)`);
    if (variantDiffs.length) parts.push(`${variantDiffs.length} variant change(s)`);

    const prUrl = await openSyncPR({
      token: process.env.GITHUB_TOKEN,
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      branchName,
      files,
      prTitle: `sync(${component}): ${parts.join(', ')} from Figma`,
      prBody: buildPRBody(component, approvedDiffs),
    });

    res.json({ ok: true, prUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/preview/:component — serve preview page info
app.get('/api/preview/:component', (req, res) => {
  const previewUrl = `/packages/components/${req.params.component}/preview.html`;
  res.json({ url: previewUrl });
});

function buildPRBody(component, diffs) {
  const tokenLines = diffs
    .filter(d => d.type === 'token')
    .map(d => `| \`${d.property}\` | \`${d.codeValue ?? '—'}\` | \`${d.figmaValue ?? '—'}\` |`)
    .join('\n');

  const variantLines = diffs
    .filter(d => d.type === 'variant')
    .map(d => `| \`${d.property}\` | \`${(d.codeValue ?? []).join(', ') || '—'}\` | \`${(d.figmaValue ?? []).join(', ')}\` |`)
    .join('\n');

  return [
    `## Figma → Code sync for \`${component}\``,
    '',
    tokenLines ? ['### Token changes', '| Property | Code | Figma |', '|---|---|---|', tokenLines, ''].join('\n') : '',
    variantLines ? ['### Variant changes', '| Property | Code | Figma |', '|---|---|---|', variantLines, ''].join('\n') : '',
    '> Generated by the design system sync app.',
  ].join('\n');
}

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`Sync app running at http://localhost:${PORT}`);
});
