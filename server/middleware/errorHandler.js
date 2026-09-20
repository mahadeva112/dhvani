import multer from 'multer';
import { ApiError } from '../errors.js';
import { config } from '../env.js';
import { logger } from '../logger.js';

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
export const errorHandler = (err, req, res, _next) => {
  if (res.headersSent) {
    logger.error(`Error after response started on ${req.method} ${req.path}: ${err?.message}`);
    return res.end();
  }

  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    logger.warn(`Upload rejected on ${req.path}: ${err.code}`);
    return res.status(413).json(
      new ApiError(
        tooBig
          ? `That file exceeds the ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB upload limit. ` +
            'Raise MAX_UPLOAD_MB in your .env file, or split the recording.'
          : `Upload failed: ${err.message}`,
        { status: 413, code: tooBig ? 'payload_too_large' : 'upload_error' }
      ).toJSON()
    );
  }

  if (err instanceof ApiError) {
    logger.warn(`${req.method} ${req.path} -> ${err.status} ${err.code}: ${err.message}`);
    return res.status(err.status).json(err.toJSON());
  }

  logger.error(`Unhandled error on ${req.method} ${req.path}:`, err?.stack || err?.message || err);
  return res.status(500).json(
    new ApiError(err?.message || 'An unexpected server error occurred.', {
      status: 500,
      code: 'internal_error',
    }).toJSON()
  );
};

export const notFoundHandler = (req, res) =>
  res.status(404).json(
    new ApiError(`No route matches ${req.method} ${req.originalUrl}.`, {
      status: 404,
      code: 'not_found',
    }).toJSON()
  );
