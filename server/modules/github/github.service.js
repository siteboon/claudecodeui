import crypto from 'crypto';

const GITHUB_API = 'https://api.github.com';

function headers(token) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
    };
}

async function githubFetch(token, method, urlPath, body = null) {
    const opts = { method, headers: headers(token) };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${GITHUB_API}${urlPath}`, opts);
    if (res.status === 204) return null;
    const json = await res.json();
    if (!res.ok) {
        throw new Error(`GitHub ${method} ${urlPath} → ${res.status}: ${json.message || JSON.stringify(json)}`);
    }
    return json;
}

export async function createIssue(token, owner, repo, { title, body = '', labels = [] }) {
    return githubFetch(token, 'POST', `/repos/${owner}/${repo}/issues`, { title, body, labels });
}

export async function updateIssue(token, owner, repo, number, patch) {
    return githubFetch(token, 'PATCH', `/repos/${owner}/${repo}/issues/${number}`, patch);
}

export async function getIssue(token, owner, repo, number) {
    return githubFetch(token, 'GET', `/repos/${owner}/${repo}/issues/${number}`);
}

export async function listIssues(token, owner, repo, state = 'open') {
    return githubFetch(token, 'GET', `/repos/${owner}/${repo}/issues?state=${state}&per_page=100`);
}

export async function testConnection(token, owner, repo) {
    return githubFetch(token, 'GET', `/repos/${owner}/${repo}`);
}

export function verifyWebhookSignature(secret, rawBody, signature) {
    if (!signature) return false;
    try {
        const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
}
