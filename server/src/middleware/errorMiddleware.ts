import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../utils/AppError.js';

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested UVGo API resource was not found.',
    },
  });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  void _next;
  if (error instanceof ZodError) {
    const fieldErrors = error.issues.reduce<Record<string, string[]>>((details, issue) => {
      const field = issue.path.join('.') || '_form';
      details[field] = [...(details[field] ?? []), issue.message];
      return details;
    }, {});

    response.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please correct the highlighted information.',
        details: fieldErrors,
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 422).json({
      error: {
        code: error.code,
        message: error.code === 'LIMIT_FILE_SIZE' ? 'Receipt images must be 5 MB or smaller.' : 'The receipt upload could not be accepted.',
      },
    });
    return;
  }

  console.error('Unhandled UVGo API error:', error);
  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'UVGo could not complete the request.',
    },
  });
};
