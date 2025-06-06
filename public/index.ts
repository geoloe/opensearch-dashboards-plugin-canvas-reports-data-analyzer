import './index.scss';

import { CanvasReportDataAnalyzerPlugin } from './plugin';

export function plugin() {
  return new CanvasReportDataAnalyzerPlugin();
}
export { CanvasReportDataAnalyzerPluginSetup, CanvasReportDataAnalyzerPluginStart } from './types';
