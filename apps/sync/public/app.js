// State
const state = {
  config: null,
  components: [],
  checkResults: {}, // component name -> diff result
  decisions: {},    // diff id -> 'accept' | 'reject' | null
};

// Init
async function init() {
  state.config = await fetch('/api/config').then(r => r.json());
  state.components = await fetch('/api/components').then(r => r.json());

  if (state.config.figmaFileKey) {
    document.getElementById('setup-banner').classList.add('hidden');
    document.getElementById('figma-key-display').textContent = `File: ${state.config.figmaFileKey.slice(0, 8)}…`;
  }

  renderComponents();
}

async function saveFileKey() {
  const val = document.getElementById('figma-key-input').value.trim();
  if (!val) return;
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ figmaFileKey: val }),
  });
  document.getElementById('setup-banner').classList.add('hidden');
  document.getElementById('figma-key-display').textContent = `File: ${val.slice(0, 8)}…`;
  state.config.figmaFileKey = val;
  toast('Figma file key saved.', 'success');
}

function renderComponents() {
  const list = document.getElementById('components-list');
  list.innerHTML = state.components.map(c => componentCard(c)).join('');
}

function componentCard(comp) {
  const result = state.checkResults[comp.name];
  const statusClass = !result ? '' : result.hasDiffs ? 'diffs' : 'synced';
  const checking = state.checkResults[comp.name + '_loading'];
  const dotClass = checking ? 'checking' : statusClass;

  return `
    <div class="component-card" id="card-${comp.name}">
      <div class="component-header" onclick="toggleCard('${comp.name}')">
        <div class="status-dot ${dotClass}"></div>
        <span class="component-name">${capitalize(comp.name)}</span>
        <span class="component-tag">&lt;${comp.tag}&gt;</span>
        ${result ? `<span style="font-size:12px;color:var(--text-muted)">${result.hasDiffs ? result.diffs.length + ' diff' + (result.diffs.length > 1 ? 's' : '') : 'In sync'}</span>` : ''}
      </div>
      <div class="component-body ${result || checking ? '' : 'hidden'}" id="body-${comp.name}">
        ${renderCardBody(comp.name, result, checking)}
      </div>
    </div>
  `;
}

function renderCardBody(name, result, checking) {
  if (checking) {
    return `<div class="check-area"><div class="status-dot checking"></div> Checking Figma for changes…</div>`;
  }

  if (!result) {
    return `<div class="check-area">
      <p style="color:var(--text-muted)">Compare this component with its Figma definition.</p>
      <button class="btn-primary" onclick="checkComponent('${name}')">Check for changes</button>
    </div>`;
  }

  if (!result.hasDiffs) {
    return `<div class="no-diffs">✓ Component is in sync with Figma</div>
      <div style="padding:16px;text-align:right">
        <button class="btn-ghost" onclick="checkComponent('${name}')">Re-check</button>
      </div>`;
  }

  return renderDiffView(name, result);
}

function renderDiffView(name, result) {
  const decisions = state.decisions[name] || {};
  const tokenDiffs = result.diffs.filter(d => d.type === 'token');
  const variantDiffs = result.diffs.filter(d => d.type === 'variant');
  const acceptedCount = Object.values(decisions).filter(v => v === 'accept').length;

  return `
    <div class="diff-container">
      <div class="screenshot-row">
        <div class="screenshot-pane">
          <div class="screenshot-pane-label">Figma</div>
          ${result.figmaScreenshot
            ? `<img src="data:image/png;base64,${result.figmaScreenshot}" alt="Figma component">`
            : `<div class="screenshot-placeholder">No Figma node ID set in sync.config.json</div>`}
        </div>
        <div class="screenshot-pane">
          <div class="screenshot-pane-label">Code</div>
          ${result.codeScreenshot
            ? `<img src="data:image/png;base64,${result.codeScreenshot}" alt="Code component">`
            : `<div class="screenshot-placeholder">Screenshot unavailable</div>`}
        </div>
      </div>

      <div class="diff-list">
        ${tokenDiffs.length ? `<div class="diff-group-label">Tokens</div>${tokenDiffs.map(d => diffRow(d, decisions[d.id])).join('')}` : ''}
        ${variantDiffs.length ? `<div class="diff-group-label">Variants / Props</div>${variantDiffs.map(d => diffRow(d, decisions[d.id])).join('')}` : ''}
      </div>

      <div class="diff-footer">
        <span class="diff-summary">
          <strong>${acceptedCount}</strong> of <strong>${result.diffs.length}</strong> changes accepted
        </span>
        <div style="display:flex;gap:8px">
          <button class="btn-ghost" onclick="acceptAll('${name}')">Accept all</button>
          <button class="btn-ghost" onclick="rejectAll('${name}')">Reject all</button>
          <button class="btn-ghost" onclick="checkComponent('${name}')">Re-check</button>
          <button class="btn-primary" onclick="applyApproved('${name}')"
            ${acceptedCount === 0 ? 'disabled' : ''}>
            Open PR (${acceptedCount})
          </button>
        </div>
      </div>
    </div>
  `;
}

function diffRow(diff, decision) {
  const isNew = diff.change === 'figma-only';
  const isToken = diff.type === 'token';

  const codeVal = isToken
    ? colorCell(diff.codeValue, 'Code')
    : `<span class="diff-val-code">${Array.isArray(diff.codeValue) ? diff.codeValue.join(', ') : diff.codeValue ?? '—'}</span>`;

  const figmaVal = isToken
    ? colorCell(diff.figmaValue, 'Figma')
    : `<span class="diff-val-figma">${Array.isArray(diff.figmaValue) ? diff.figmaValue.join(', ') : diff.figmaValue ?? '—'}</span>`;

  return `
    <div class="diff-row" id="row-${diff.id.replace(/[^a-z0-9]/gi, '-')}">
      <div class="diff-cell diff-prop">
        ${diff.property}
        ${isNew ? '<span class="tag-new">NEW</span>' : ''}
      </div>
      <div class="diff-cell diff-val-code">${codeVal}</div>
      <div class="diff-cell diff-val-figma">${figmaVal}</div>
      <div class="diff-cell diff-actions">
        <button class="btn-accept ${decision === 'accept' ? 'active' : ''}"
          onclick="decide('${diff.property}', '${diff.id}', 'accept')">✓</button>
        <button class="btn-reject ${decision === 'reject' ? 'active' : ''}"
          onclick="decide('${diff.property}', '${diff.id}', 'reject')">✕</button>
      </div>
    </div>
  `;
}

function colorCell(val, _label) {
  if (!val) return `<span style="color:var(--text-dim)">—</span>`;
  const isColor = /^#[0-9a-fA-F]{3,8}$|^rgb|^hsl/.test(val.trim());
  const swatch = isColor ? `<span class="diff-swatch" style="background:${val}"></span>` : '';
  return `${swatch}<span style="font-family:monospace;font-size:12px">${val}</span>`;
}

// Actions
function toggleCard(name) {
  const body = document.getElementById(`body-${name}`);
  if (body.classList.contains('hidden')) {
    body.classList.remove('hidden');
    if (!state.checkResults[name]) checkComponent(name);
  } else {
    body.classList.add('hidden');
  }
}

async function checkComponent(name) {
  state.checkResults[name + '_loading'] = true;
  delete state.checkResults[name];
  state.decisions[name] = {};
  refreshCard(name);

  try {
    const result = await fetch(`/api/check/${name}`).then(r => r.json());
    if (result.error) throw new Error(result.error);
    state.checkResults[name] = result;
  } catch (err) {
    toast(`Check failed: ${err.message}`, 'error');
    state.checkResults[name] = { hasDiffs: false, diffs: [], error: err.message };
  } finally {
    delete state.checkResults[name + '_loading'];
    refreshCard(name);
  }
}

function decide(componentName_unused, diffId, decision) {
  // Find which component owns this diff
  for (const [name, result] of Object.entries(state.checkResults)) {
    if (name.endsWith('_loading')) continue;
    if (result?.diffs?.find(d => d.id === diffId)) {
      if (!state.decisions[name]) state.decisions[name] = {};
      const current = state.decisions[name][diffId];
      state.decisions[name][diffId] = current === decision ? null : decision;
      refreshCard(name);
      return;
    }
  }
}

function acceptAll(name) {
  const result = state.checkResults[name];
  if (!result) return;
  state.decisions[name] = {};
  result.diffs.forEach(d => { state.decisions[name][d.id] = 'accept'; });
  refreshCard(name);
}

function rejectAll(name) {
  const result = state.checkResults[name];
  if (!result) return;
  state.decisions[name] = {};
  result.diffs.forEach(d => { state.decisions[name][d.id] = 'reject'; });
  refreshCard(name);
}

async function applyApproved(name) {
  const result = state.checkResults[name];
  const decisions = state.decisions[name] || {};
  const approved = result.diffs.filter(d => decisions[d.id] === 'accept');

  if (!approved.length) return;

  try {
    const res = await fetch('/api/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ component: name, approvedDiffs: approved }),
    }).then(r => r.json());

    if (res.error) throw new Error(res.error);

    toast(`PR created: <a href="${res.prUrl}" target="_blank">View on GitHub →</a>`, 'success');
    // Clear the result so the user re-checks after merging
    delete state.checkResults[name];
    state.decisions[name] = {};
    refreshCard(name);
  } catch (err) {
    toast(`Failed to create PR: ${err.message}`, 'error');
  }
}

function refreshCard(name) {
  const comp = state.components.find(c => c.name === name);
  if (!comp) return;
  const card = document.getElementById(`card-${name}`);
  if (!card) return;
  card.outerHTML = componentCard(comp);
  // Re-bind: the card was replaced, no event bindings needed (inline onclick)
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Toast
let toastTimeout;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.innerHTML = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { el.className = `toast ${type}`; }, 5000);
}

// ---- Rebind icons modal ----
const REBIND_SCRIPT = `
// DS Icon Rebind — run this in Figma Plugin API (Plugins > Development > Console)
// Finds every Phosphor icon instance across all pages and rebinds its stroke/fill
// from Phosphor's remote variable to the DS color/icon/current variable.

const PHOSPHOR_VAR_ID = 'VariableID:e18a3822f9ee297f896af84384cefdd5a2c0f1b2/729:97';
const DS_ICON_VAR_ID  = 'VariableID:18:3'; // color/icon/current

async function run() {
  const dsVar = await figma.variables.getVariableByIdAsync(DS_ICON_VAR_ID);
  if (!dsVar) { console.error('DS icon variable not found'); return; }

  let total = 0;

  for (const page of figma.root.children) {
    await figma.setCurrentPageAsync(page);

    const instances = page.findAllWithCriteria({ types: ['INSTANCE'] });
    for (const inst of instances) {
      if (!inst.mainComponent?.remote) continue; // skip non-library instances

      function rebind(node) {
        // Rebind strokes
        if ('strokes' in node && node.strokes?.length) {
          const bv = node.boundVariables;
          if (bv?.strokes?.some(b => b?.id === PHOSPHOR_VAR_ID)) {
            node.strokes = node.strokes.map(s =>
              s.type === 'SOLID'
                ? figma.variables.setBoundVariableForPaint(s, 'color', dsVar)
                : s
            );
            total++;
          }
        }
        // Rebind fills (for Fill-weight icons)
        if ('fills' in node && node.fills?.length) {
          const bv = node.boundVariables;
          if (bv?.fills?.some(b => b?.id === PHOSPHOR_VAR_ID)) {
            node.fills = node.fills.map(f =>
              f.type === 'SOLID'
                ? figma.variables.setBoundVariableForPaint(f, 'color', dsVar)
                : f
            );
            total++;
          }
        }
        if ('children' in node) node.children.forEach(rebind);
      }

      rebind(inst);
    }
  }

  return 'Rebound ' + total + ' vector(s) across all pages.';
}
return run();
`.trim();

function showRebindScript() {
  document.getElementById('rebind-code').textContent = REBIND_SCRIPT;
  document.getElementById('rebind-modal').style.display = 'flex';
}

function copyRebindScript() {
  navigator.clipboard.writeText(REBIND_SCRIPT).then(() => toast('Script copied to clipboard', 'success'));
}

init();
