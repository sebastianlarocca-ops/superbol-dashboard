import { ErrorRequestHandler, RequestHandler } from 'express';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('[error]', err);
  const status = typeof err.status === 'number' ? err.status : 500;
  res.status(status).json({
    error: err.message ?? 'Internal server error',
  });
};
