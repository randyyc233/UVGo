import { Router } from 'express';
import { departures, routes } from '../controllers/publicController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const publicRouter = Router();

publicRouter.get('/departures', asyncHandler(departures));
publicRouter.get('/routes', asyncHandler(routes));

