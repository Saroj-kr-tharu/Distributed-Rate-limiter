import express from 'express';

import { pingHandler } from '../../controllers/app.controller';
import {
  changePasswordCtrl,
  checkTokenCtrl,
  loginCtrl,
  updateUserCtrl,
  userCreate,
} from '../../controllers/user.controller';
import { validateHeaders, validateRequestBody } from '../../validators';
// import { pingSchema } from '../../validators/ping.validator';
import {
  ChangePassword,
  CheckToken,
  createUser,
  loginUser,
  updateUser,
} from '../../validators/user.validator';
import { healthCtrl, metricsCtrl } from '../../controllers/metric.controller';
import { checkRateLimitCtrl } from '../../controllers/rateLimiter.controller';
const appRouter = express.Router();

// appRouter.get('/ping', validateRequestBody(pingSchema), pingHandler);
appRouter.get('/ping',  pingHandler) ;
appRouter.get('/metrics', metricsCtrl );
appRouter.get('/health', healthCtrl );

// user router
appRouter.post('/auth/register', validateRequestBody(createUser), userCreate);
appRouter.post('/auth/login', validateRequestBody(loginUser), loginCtrl);
appRouter.get('/auth/token', validateHeaders(CheckToken), checkTokenCtrl);
appRouter.patch(
  '/auth/update',
  validateHeaders(CheckToken),
  validateRequestBody(updateUser),
  updateUserCtrl,
);
appRouter.post(
  '/auth/changepassword',
  validateHeaders(CheckToken),
  validateRequestBody(ChangePassword),
  changePasswordCtrl,
);

appRouter.post('/rate-limit/check', checkRateLimitCtrl);




export default appRouter;
