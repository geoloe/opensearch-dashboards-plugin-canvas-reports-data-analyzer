import { PluginConfigDescriptor, PluginInitializerContext } from '../../../src/core/server';
import { configSchema, CanvasReportDataAnalyzerConfig } from '../common/config';
import { CanvasReportDataAnalyzerPlugin } from './plugin';

export const config: PluginConfigDescriptor<CanvasReportDataAnalyzerConfig> = {
  schema: configSchema,
};

export function plugin(initializerContext: PluginInitializerContext) {
  return new CanvasReportDataAnalyzerPlugin(initializerContext);
}

export { CanvasReportDataAnalyzerPluginSetup, CanvasReportDataAnalyzerPluginStart } from './types';