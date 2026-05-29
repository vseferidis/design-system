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

// Extract tokens from Figma local styles in a file
export async function extractFigmaTokens(token, fileKey) {
  const stylesData = await getFileStyles(token, fileKey);
  const styleIds = stylesData.meta?.styles?.map(s => s.node_id) ?? [];
  if (!styleIds.length) return {};

  const nodesData = await getNodes(token, fileKey, styleIds);
  const tokens = {};

  for (const style of stylesData.meta.styles) {
    const node = nodesData.nodes?.[style.node_id]?.document;
    if (!node) continue;

    const name = style.name; // e.g. "Color/Primary"
    const cssName = styleToCssVar(name, style.style_type);

    if (style.style_type === 'FILL' && node.fills?.[0]?.type === 'SOLID') {
      tokens[cssName] = figmaColorToHex(node.fills[0].color);
    } else if (style.style_type === 'TEXT') {
      if (node.style?.fontSize) tokens[`--font-size-${slugify(name)}`] = `${node.style.fontSize}px`;
      if (node.style?.fontWeight) tokens[`--font-weight-${slugify(name)}`] = String(node.style.fontWeight);
    } else if (style.style_type === 'EFFECT') {
      // shadow effects
      const shadow = node.effects?.find(e => e.type === 'DROP_SHADOW');
      if (shadow) {
        const { offset, radius, color } = shadow;
        const c = figmaColorToHex(color);
        tokens[`--shadow-${slugify(name)}`] = `${offset.x}px ${offset.y}px ${radius}px ${c}`;
      }
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
