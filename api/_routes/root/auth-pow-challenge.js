import {
  createPowChallenge,
  getPowPublicPolicy,
} from '../../_lib/powChallenge.js';
import {
  rejectDisallowedBrowserOrigin
} from '../../_lib/http.js';

const ALLOWED_ACTIONS = new Set([
  'site_gate',
  'register',
  'password_reset',
  'account_recovery',
  'lottery_enter',
]);

function parseRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (rejectDisallowedBrowserOrigin(req, res, { methods: 'GET, POST, OPTIONS' })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      policy: getPowPublicPolicy(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = parseRequestBody(req);
  const action = String(body.action || 'site_gate').trim().toLowerCase();
  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid action',
    });
  }

  return res.status(200).json({
    success: true,
    challenge: createPowChallenge({ action }),
  });
}
