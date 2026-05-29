const BASE = 'https://api.github.com';

function headers(token) {
  return {
    'Authorization': `token ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github.v3+json',
  };
}

async function req(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

export async function getDefaultBranch(token, owner, repo) {
  const data = await req(token, 'GET', `/repos/${owner}/${repo}`);
  return data.default_branch;
}

export async function getBranchSha(token, owner, repo, branch) {
  const data = await req(token, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  return data.object.sha;
}

export async function createBranch(token, owner, repo, branchName, fromSha) {
  return req(token, 'POST', `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branchName}`,
    sha: fromSha,
  });
}

export async function getFileSha(token, owner, repo, path, branch) {
  try {
    const data = await req(token, 'GET', `/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);
    return data.sha;
  } catch {
    return null; // file doesn't exist yet
  }
}

export async function upsertFile(token, owner, repo, path, content, message, branch, sha) {
  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;
  return req(token, 'PUT', `/repos/${owner}/${repo}/contents/${path}`, body);
}

export async function createPR(token, owner, repo, head, base, title, body) {
  return req(token, 'POST', `/repos/${owner}/${repo}/pulls`, {
    title,
    body,
    head,
    base,
  });
}

// High-level: create a PR with multiple file changes
export async function openSyncPR({ token, owner, repo, branchName, files, prTitle, prBody }) {
  const defaultBranch = await getDefaultBranch(token, owner, repo);
  const baseSha = await getBranchSha(token, owner, repo, defaultBranch);

  await createBranch(token, owner, repo, branchName, baseSha);

  for (const { path, content, message } of files) {
    const sha = await getFileSha(token, owner, repo, path, branchName);
    await upsertFile(token, owner, repo, path, content, message, branchName, sha);
  }

  const pr = await createPR(token, owner, repo, branchName, defaultBranch, prTitle, prBody);
  return pr.html_url;
}
