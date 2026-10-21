import { Router } from 'express';
import { PlanController, ProblemController } from '../controllers/catalog.controller.js';

// Catalog data (problems/plans) is read-only metadata with no user data attached, so it's public.
// This lets the /challenges page show what's on offer before someone signs up.
export const problemRoutes = Router();
problemRoutes.get('/', ProblemController.list);
problemRoutes.get('/:id', ProblemController.getById);
problemRoutes.get('/:id/judge', ProblemController.judgeDetail);

export const planRoutes = Router();
planRoutes.get('/', PlanController.list);
planRoutes.get('/:id', PlanController.getById);
