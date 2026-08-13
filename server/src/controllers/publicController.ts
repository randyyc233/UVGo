import type { Request, Response } from 'express';
import { getPublicDepartures, getPublicRoutes } from '../services/publicService.js';

export async function departures(_request: Request, response: Response) {
  response.status(200).json(await getPublicDepartures());
}

export async function routes(_request: Request, response: Response) {
  response.status(200).json(await getPublicRoutes());
}

