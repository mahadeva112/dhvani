import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { config } from '../env.js';
import { cleanupFiles } from '../lib/media.js';

const UPLOAD_DIR = path.join(os.tmpdir(), 'dhvani-uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname) || ''}`),
});

/**
 * Uploads stream to disk rather than memory so a multi-hour recording does not
 * have to fit in the Node heap.
 */
export const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 25 },
});

/**
 * Deletes the request's temp uploads once the response is finished, whether it
 * succeeded or failed.
 */
export const cleanupUploads = (req, res, next) => {
  res.on('close', () => {
    const files = [req.file, ...(Array.isArray(req.files) ? req.files : [])].filter(Boolean);
    if (files.length > 0) cleanupFiles(...files.map((file) => file.path));
  });
  next();
};
