import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), '../..');

// Parse CSS custom properties from tokens.css
export function parseTokensCSS(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const tokens = {};
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    tokens[`--${m[1]}`] = m[2].trim();
  }
  return tokens;
}

// Parse types.ts to extract variant/attribute definitions
export function parseTypesTS(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = { variants: {}, attributes: {}, slots: [] };

  // Extract union type aliases: export type UIButtonVariant = 'a' | 'b'
  // m[1] = full type name (UIButtonVariant), m[2] = value string ('a' | 'b')
  const typeRe = /export type (\w+)\s*=\s*([^;]+);/g;
  let m;
  while ((m = typeRe.exec(content)) !== null) {
    const values = m[2].match(/'([^']+)'/g)?.map(v => v.replace(/'/g, '')) ?? [];
    if (!values.length) continue;
    // Strip UIButton / UI prefix and lowercase → 'UIButtonVariant' → 'variant'
    const name = m[1].replace(/^UIButton/i, '').replace(/^UI/i, '').toLowerCase();
    if (name) result.variants[name] = values;
  }

  // Extract interface attributes
  const ifaceRe = /export interface UIButton\w+ \{([^}]+)\}/s;
  const ifaceMatch = content.match(ifaceRe);
  if (ifaceMatch) {
    const body = ifaceMatch[1];
    const attrRe = /(\w+)\??:\s*([^;]+);/g;
    let am;
    while ((am = attrRe.exec(body)) !== null) {
      result.attributes[am[1]] = am[2].trim();
    }
  }

  // Extract slot names from UIButtonSlots interface
  const slotsRe = /export interface UIButtonSlots \{([^}]+)\}/s;
  const slotsMatch = content.match(slotsRe);
  if (slotsMatch) {
    const slotRe = /'([^']+)':/g;
    let sm;
    while ((sm = slotRe.exec(slotsMatch[1])) !== null) {
      result.slots.push(sm[1]);
    }
  }

  return result;
}

// Diff tokens: figmaTokens vs codeTokens (both are { '--var': 'value' })
export function diffTokens(figmaTokens, codeTokens) {
  const diffs = [];
  const allKeys = new Set([...Object.keys(figmaTokens), ...Object.keys(codeTokens)]);

  for (const key of allKeys) {
    const figmaVal = figmaTokens[key];
    const codeVal = codeTokens[key];

    if (figmaVal === undefined) {
      diffs.push({ id: key, type: 'token', property: key, figmaValue: null, codeValue: codeVal, change: 'code-only' });
    } else if (codeVal === undefined) {
      diffs.push({ id: key, type: 'token', property: key, figmaValue: figmaVal, codeValue: null, change: 'figma-only' });
    } else if (normalizeColor(figmaVal) !== normalizeColor(codeVal)) {
      diffs.push({ id: key, type: 'token', property: key, figmaValue: figmaVal, codeValue: codeVal, change: 'modified' });
    }
  }
  return diffs;
}

// Diff component props: figmaProps vs codeProps
// Values are compared case-insensitively — Figma uses TitleCase, code uses lowercase
export function diffComponentProps(figmaProps, codeTypes) {
  const diffs = [];

  for (const [propName, def] of Object.entries(figmaProps)) {
    // BOOLEAN props (Icon Left / Icon Right) are tracked separately — skip variant diffing
    if (def.type === 'BOOLEAN') continue;

    const normalName = propName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const codeVariants = codeTypes.variants[normalName];

    if (!codeVariants) {
      diffs.push({
        id: `prop-${propName}`,
        type: 'variant',
        property: propName,
        figmaValue: def.values ?? [],
        codeValue: null,
        change: 'figma-only',
        figmaType: def.type,
      });
      continue;
    }

    // Normalize both sides to lowercase before comparing so 'Primary' === 'primary'
    const figmaLower = (def.values ?? []).map(v => v.toLowerCase());
    const codeLower  = codeVariants.map(v => v.toLowerCase());
    const figmaSet   = new Set(figmaLower);
    const codeSet    = new Set(codeLower);
    const added      = figmaLower.filter(v => !codeSet.has(v));
    const removed    = codeLower.filter(v => !figmaSet.has(v));

    if (added.length || removed.length) {
      diffs.push({
        id: `prop-${propName}`,
        type: 'variant',
        property: propName,
        figmaValue: def.values ?? [],     // keep original Figma casing for display
        codeValue: codeVariants,
        change: 'modified',
        added,
        removed,
      });
    }
    // No diff if sets match — intentional lowercase/titlecase difference is fine
  }

  return diffs;
}

// Diff icon usage: figmaIcons (array of { iconName, tag, usedIn }) vs code attributes
export function diffIconUsage(figmaIcons = [], codeAttributes = {}) {
  const diffs = [];
  for (const { iconName, tag, usedIn } of figmaIcons) {
    const attrName = usedIn === 'left' ? 'icon-left' : 'icon-right';
    const codeVal = codeAttributes[attrName];
    if (!codeVal) {
      diffs.push({
        id: `icon-${attrName}-${tag}`,
        type: 'icon',
        property: attrName,
        figmaValue: tag,
        codeValue: null,
        change: 'figma-only',
        iconName,
        usedIn,
      });
    } else if (codeVal !== tag && codeVal !== iconName) {
      diffs.push({
        id: `icon-${attrName}-${tag}`,
        type: 'icon',
        property: attrName,
        figmaValue: tag,
        codeValue: codeVal,
        change: 'modified',
        iconName,
        usedIn,
      });
    }
  }
  return diffs;
}

// Normalize color values for comparison (handles hex case, spacing)
function normalizeColor(val) {
  return val.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Generate updated tokens.css content from an approved set of token changes
export function applyTokenDiffs(currentCSS, approvedDiffs) {
  let content = currentCSS;

  for (const diff of approvedDiffs) {
    if (diff.type !== 'token') continue;
    const { property, figmaValue, change } = diff;

    const escapedProp = property.replace('--', '--').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (change === 'figma-only' && figmaValue) {
      // Add new token before the closing brace
      content = content.replace(/\n}[\s]*$/, `\n  ${property}: ${figmaValue};\n}`);
    } else if (change === 'modified' && figmaValue) {
      // Replace existing value
      const re = new RegExp(`(${escapedProp}\\s*:\\s*)[^;]+(;)`);
      content = content.replace(re, `$1${figmaValue}$2`);
    }
  }

  return content;
}

// Generate updated types.ts content from approved variant diffs.
// Values are lowercased to match CSS attribute conventions (e.g. 'primary' not 'Primary').
export function applyVariantDiffs(currentTS, approvedDiffs) {
  let content = currentTS;

  for (const diff of approvedDiffs) {
    if (diff.type !== 'variant') continue;

    // Always lowercase values to match CSS/HTML attribute conventions
    const values = diff.figmaValue.map(v => `'${v.toLowerCase()}'`).join(' | ');
    const typeName = `UIButton${capitalize(diff.property)}`;

    // Case-insensitive search for existing type declaration
    const existingRe = new RegExp(
      `(export type ${typeName}\\s*=\\s*)[^\n]+`,
      'i'
    );

    if (existingRe.test(content)) {
      // Replace existing declaration (handles both 'figma-only' and 'modified')
      content = content.replace(existingRe, `$1${values};`);
    } else {
      // Truly new type — insert before the slots interface
      const newType = `export type ${typeName} = ${values};\n`;
      content = content.replace(/(export interface UIButtonSlots)/, `${newType}\n$1`);
    }
  }

  return content;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
