const BASE = 'https://api.figma.com/v1';

function headers(token) {
  return { 'X-FIGMA-TOKEN': token };
}

async function get(token, path) {
  const res = await fetch(`${BASE}${path}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getFile(token, fileKey) {
  return get(token, `/files/${fileKey}`);
}

export async function getFileComponents(token, fileKey) {
  return get(token, `/files/${fileKey}/components`);
}

export async function getFileStyles(token, fileKey) {
  return get(token, `/files/${fileKey}/styles`);
}

export async function getNodes(token, fileKey, nodeIds) {
  const ids = Array.isArray(nodeIds) ? nodeIds.join(',') : nodeIds;
  return get(token, `/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`);
}

export async function getComponentScreenshot(token, fileKey, nodeId) {
  const data = await get(token, `/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`);
  const url = data.images?.[nodeId];
  if (!url) return null;
  const imgRes = await fetch(url);
  const buf = await imgRes.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

export async function getLocalVariables(token, fileKey) {
  const data = await get(token, `/files/${fileKey}/variables/local`);
  return data;
}

// Parse Figma color style node into a CSS hex value
export function figmaColorToHex(color) {
  if (!color) return null;
  const { r, g, b, a = 1 } = color;
  const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
  if (Math.abs(a - 1) > 0.001) {
    return `rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${a.toFixed(2)})`;
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// Extract tokens from Figma local variables (modern Variables API)
// Maps WEB code syntax `var(--foo)` → resolved hex value
export async function extractFigmaTokens(token, fileKey) {
  const data = await getLocalVariables(token, fileKey);
  const variables = data.meta?.variables ?? {};
  const collections = data.meta?.variableCollections ?? {};

  // Build a flat map: variableId → resolved value (follow VARIABLE_ALIAS chains)
  const resolvedCache = {};
  function resolveValue(varId, modeId) {
    const key = `${varId}@${modeId}`;
    if (resolvedCache[key] !== undefined) return resolvedCache[key];

    const variable = variables[varId];
    if (!variable) return null;

    // Find the right mode value — fall back to first available mode
    const coll = collections[variable.variableCollectionId];
    const mode = coll?.modes?.find(m => m.modeId === modeId) ?? coll?.modes?.[0];
    if (!mode) return null;

    const val = variable.valuesByMode?.[mode.modeId];
    if (!val) return null;

    if (val.type === 'VARIABLE_ALIAS') {
      // Recursively resolve — use target var's own collection's default mode
      const targetVar = variables[val.id];
      if (!targetVar) return null;
      const targetColl = collections[targetVar.variableCollectionId];
      const targetModeId = targetColl?.defaultModeId ?? targetColl?.modes?.[0]?.modeId;
      const resolved = resolveValue(val.id, targetModeId);
      resolvedCache[key] = resolved;
      return resolved;
    }

    resolvedCache[key] = val;
    return val;
  }

  const tokens = {};

  for (const [varId, variable] of Object.entries(variables)) {
    // Only include variables that have a WEB code syntax starting with `var(`
    const webSyntax = variable.codeSyntax?.WEB;
    if (!webSyntax || !webSyntax.startsWith('var(')) continue;

    const cssVar = webSyntax.slice(4, -1); // strip `var(` and `)`

    const coll = collections[variable.variableCollectionId];
    const modeId = coll?.defaultModeId ?? coll?.modes?.[0]?.modeId;
    const resolved = resolveValue(varId, modeId);
    if (!resolved) continue;

    if (variable.resolvedType === 'COLOR') {
      tokens[cssVar] = figmaColorToHex(resolved);
    } else if (variable.resolvedType === 'FLOAT') {
      tokens[cssVar] = `${resolved}px`;
    }
  }

  return tokens;
}

// Extract component property definitions from Figma component set nodes
export async function extractFigmaComponentProps(token, fileKey, componentNodeId) {
  const data = await getNodes(token, fileKey, [componentNodeId]);
  const node = data.nodes?.[componentNodeId]?.document;
  if (!node) return null;

  const props = {};

  // Component set — each child is a variant
  if (node.type === 'COMPONENT_SET') {
    const propDefs = node.componentPropertyDefinitions ?? {};
    for (const [propName, def] of Object.entries(propDefs)) {
      props[propName] = {
        type: def.type, // VARIANT, BOOLEAN, TEXT, INSTANCE_SWAP
        values: def.variantOptions ?? [],
        default: def.defaultValue,
      };
    }
  }

  return { nodeId: componentNodeId, name: node.name, props };
}

function styleToCssVar(name, styleType) {
  const prefix = styleType === 'FILL' ? '--color' :
                 styleType === 'TEXT' ? '--font' :
                 styleType === 'EFFECT' ? '--shadow' : '--token';
  return `${prefix}-${slugify(name.split('/').pop())}`;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
