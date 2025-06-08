import { PluginInitializerContext, CoreSetup, Plugin, Logger } from '../../../src/core/server';
import { CanvasReportDataAnalyzerConfig } from '../common/config';
import { FileReaderService } from './file_reader';
import { defineRoutes } from './routes';

export class CanvasReportDataAnalyzerPlugin implements Plugin {
  private readonly logger: Logger;
  private readonly initializerContext: PluginInitializerContext;
  private fileReader?: FileReaderService;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
    this.initializerContext = initializerContext;
  }

  public setup(core: CoreSetup) {
    const config$ = this.initializerContext.config.create<CanvasReportDataAnalyzerConfig>();
    let config: CanvasReportDataAnalyzerConfig;

    config$.subscribe(cfg => {
      config = cfg;
      this.logger.info(`Setting up Canvas Report Data Analyzer Plugin. Report directory: ${config.report_directory}`);
    });

    this.fileReader = new FileReaderService(this.logger);

    const router = core.http.createRouter();
    defineRoutes(router, config!, this.fileReader);

    router.get(
      { path: '/api/canvas_report_data_analyzer/config', validate: false },
      async (context, request, response) => {
        return response.ok({
          body: {
            report_directory: config.report_directory,
            organization: config.smtp.organization,
            allow_table_of_contents: config.allow_table_of_contents,
            text_positions_and_sizes: {
              tenant_name: config.text_positions_and_sizes.tenant_name,
              dashboard_name: config.text_positions_and_sizes.dashboard_name,
              timestamp: config.text_positions_and_sizes.timestamp
            }
          }
        });
      }
    );
  }

  public start() {
    this.logger.info('Starting Canvas Report Data Analyzer Plugin');
  }

  public stop() {
    this.logger.info('Stopping Canvas Report Data Analyzer Plugin');
  }
}
