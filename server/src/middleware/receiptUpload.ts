import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export const receiptDirectory = resolve(env.UPLOAD_DIR);
mkdirSync(receiptDirectory, { recursive: true });

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const storage = multer.diskStorage({
  destination: receiptDirectory,
  filename(_request, file, callback) {
    const extension = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg';
    callback(null, `receipt-${Date.now()}-${randomUUID()}${extension}`);
  },
});

export const receiptUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_request, file, callback) {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new AppError(422, 'INVALID_RECEIPT_TYPE', 'Receipt must be a JPG, JPEG, PNG, or WEBP image.'));
      return;
    }
    callback(null, true);
  },
});
