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
  const typeRe = /export type \w+(\w+)\s*=\s*([^;]+);/g;
  let m;
  while ((m = typeRe.exec(content)) !== null) {
    const name = m[1].toLowerCase();
    const values = m[2].match(/'([^']+)'/g)?.map(v => v.replace(/'/g, '')) ?? [];
    if (values.length) result.variants[name] = values;
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
export function diffComponentProps(figmaProps, codeTypes) {
  const diffs = [];

  for (const [propName, def] of Object.entries(figmaProps)) {
    const normalName = propName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const codeVariants = codeTypes.variants[normalName];

    if (!codeVariants) {
      diffs.push({
        id: `prop-${propName}`,
        type: 'variant',
        property: propName,
        figmaValue: def.values,
        codeValue: null,
        change: 'figma-only',
        figmaType: def.type,
      });
      continue;
    }

    const figmaSet = new Set(def.values);
    const codeSet = new Set(codeVariants);
    const added = [...figmaSet].filter(v => !codeSet.has(v));
    const removed = [...codeSet].filter(v => !figmaSet.has(v));

    if (added.length || removed.length) {
      diffs.push({
        id: `prop-${propName}`,
        type: 'variant',
        property: propName,
        figmaValue: def.values,
        codeValue: codeVariants,
        change: 'modified',
        added,
        removed,
      });
    }
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

// Generate updated types.ts content from approved variant diffs
export function applyVariantDiffs(currentTS, approvedDiffs) {
  let content = currentTS;

  for (const diff of approvedDiffs) {
    if (diff.type !== 'variant') continue;
    const values = diff.figmaValue.map(v => `'${v}'`).join(' | ');
    const typeName = `UIButton${capitalize(diff.property)}`;

    if (diff.change === 'figma-only') {
      // Append new type before the slots interface
      const newType = `export type ${typeName} = ${values};\n`;
      content = content.replace(/(export interface UIButtonSlots)/, `${newType}\n$1`);
    } else if (diff.change === 'modified') {
      const re = new RegExp(`(export type ${typeName}\\s*=\\s*)[^\n]+`);
      content = content.replace(re, `$1${values};`);
    }
  }

  return content;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
