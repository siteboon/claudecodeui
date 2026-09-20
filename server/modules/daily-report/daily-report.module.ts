import { createDailyReportRouter } from './daily-report.routes.js';

/** Used by the server entrypoint to mount authenticated Daily Report endpoints. */
export const dailyReportRoutes = createDailyReportRouter();
