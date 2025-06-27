import { cleanupStaleActions } from '../../modules/maintenance/cleanup-stale-actions.js';

export default async function handler(req, res) {
  try {
    const result = await cleanupStaleActions();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
