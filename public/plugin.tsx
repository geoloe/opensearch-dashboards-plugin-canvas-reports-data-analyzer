import * as React from 'react';
import ReactDOM from 'react-dom';
import { CoreSetup, CoreStart, Plugin, AppMountParameters } from '../../../src/core/public';
import { CanvasReportDataAnalyzerPluginSetup, CanvasReportDataAnalyzerPluginStart, PluginStartDependencies, AppPluginStartDependencies } from './types';
import { ReportingService } from './services/reporting';
import { GeneratePdfReportsButton } from './components/generate_pdf_reports_button';
import { registerGlobalNavigation } from './components/global_navigation';
import { PLUGIN_ID } from '../common';
import { renderApp } from './application';
import { AssetService } from './services/fetch_assets';
/**
 * Main plugin class for Canvas Report Generator and Data Analyzer
 * @implements {Plugin<CanvasReportDataAnalyzerPluginSetup, CanvasReportDataAnalyzerPluginStart>}
 */
export class CanvasReportDataAnalyzerPlugin implements Plugin<CanvasReportDataAnalyzerPluginSetup, CanvasReportDataAnalyzerPluginStart> {
  // Region: Class Properties
  /* ---------------------------------- */
  private assetService?: AssetService;
  private reportingService: ReportingService;
  private coreSetup?: CoreSetup;
  private currentAppId: string | null = null;
  private cachedHasRole: boolean | null = null;
  private isAuthorized = false;
  private navControlUnregister?: void | (() => void);
  private currentElement: HTMLElement | null = null;

  /**
   * Constructs a new CanvasReportDataAnalyzerPlugin instance
   * @constructor
   */
  constructor() {
    /** @private @readonly Reporting service instance */
    this.assetService = new AssetService(undefined as any);
    this.reportingService = new ReportingService();
  }

  // Region: Plugin Lifecycle Methods
  /* ---------------------------------- */
  
  /**
   * Plugin setup phase (required by OpenSearch Dashboards plugin interface)
   * @param {CoreSetup} core - OpenSearch Dashboards core setup API
   * @returns {CanvasReportDataAnalyzerPluginSetup} Plugin setup contract
   * @public
   */
  public setup(core: CoreSetup): CanvasReportDataAnalyzerPluginSetup {
    core.application.register({
      id: PLUGIN_ID.toLocaleLowerCase(),
      title: 'Reports/Data Analysis',
      async mount(params: AppMountParameters) {
        // Get start services as specified in opensearch_dashboards.json
        const [coreStart, depsStart] = await core.getStartServices();
        // Render the application
        const unmount = renderApp(coreStart, depsStart as AppPluginStartDependencies, params);

        return () => {
          unmount();
        };
      },
    });
    this.coreSetup = core;
    if (!this.assetService) {
      this.assetService = new AssetService(undefined as any);
    }
    return {
      reportingService: this.reportingService,
      assetService: this.assetService as AssetService  // Expose asset service if needed
    };
  }

  /**
   * Plugin start phase (required by OpenSearch Dashboards plugin interface)
   * @param {CoreStart} core - OpenSearch Dashboards core start API
   * @param {PluginStartDependencies} plugins - Dependent plugin APIs
   * @returns {CanvasReportDataAnalyzerPluginStart} Plugin start contract
   * @public
   */
  public start(core: CoreStart, plugins: PluginStartDependencies): CanvasReportDataAnalyzerPluginStart {
    // Initialize the asset service with HTTP client
    this.assetService = new AssetService(core.http);
    
    // Initialize reporting service with all dependencies
    this.reportingService.setDependencies({
      dashboard: plugins.dashboard,
      embeddable: plugins.embeddable,
      notifications: core.notifications,
      http: core.http,
      assetService: this.assetService,
    });

    // Asynchronously register global navigation after auth check
    registerGlobalNavigation(core).catch(error => {
      console.error('Global navigation registration failed:', error);
    });

    /**
     * Track application navigation and manage UI controls
     * @listens application.currentAppId$
     */
    core.application.currentAppId$.subscribe(async (appId: string | undefined) => {
      this.currentAppId = appId || null;
      this.cachedHasRole = null;
      
      if (this.currentAppId === 'dashboards') {
        await this.handleDashboardAuthorization(core);
      } else {
        this.unregisterNavControl();
      }
    });    

    return {
      /**
       * Asset service instance for external access
       */
      assetService: this.assetService as AssetService,
      /**
       * Render method for external component access
       * @returns {JSX.Element} PDF report button component
       */
      showReportButton: () => (
        <GeneratePdfReportsButton 
          reportingService={this.reportingService} 
          disabled={!this.isAuthorized}
          assetService={this.assetService as AssetService}
          http={core.http}
        />
      ),
    };
  }

  /**
    * Track application navigation and manage UI controls
    * @param {CoreStart} core - OpenSearch Dashboards core API
    * @private
    */
  private async handleDashboardAuthorization(core: CoreStart) {
    try {
      this.isAuthorized = await this.checkUserRoles(core);
    } catch (error) {
      console.error('Authorization check failed:', error);
      this.isAuthorized = false;
    }
        
    this.registerNavControl(core);
  }  

  // Region: Authorization Management
  /* ---------------------------------- */
  
  /**
   * Checks and caches user authorization status
   * @param {CoreStart} core - OpenSearch Dashboards core API
   * @returns {Promise<boolean>} Authorization status
   * @private
   * @throws {Error} On API communication failure
   */
  private async checkUserRoles(core: CoreStart): Promise<boolean> {
    if (this.cachedHasRole !== null) return this.cachedHasRole;
    
    try {
      const response = await core.http.get<{ roles: string[] }>('/api/canvas_report_data_analyzer/user_roles');
      return this.cachedHasRole = response.roles.includes('canvas_reporting');
    } catch (error) {
      console.error('Error checking user roles:', error);
      return this.cachedHasRole = false;
    }
  }

  // Region: UI Control Management
  /* ---------------------------------- */
  
  /**
   * Registers navigation control in OpenSearch Dashboards chrome
   * @param {CoreStart} core - OpenSearch Dashboards core API
   * @private
   */
  private registerNavControl(core: CoreStart) {
    if (this.navControlUnregister) return;
  
    this.navControlUnregister = core.chrome.navControls.registerCenter({
      /**
       * Mount callback for navigation control
       * @param {HTMLElement} element - Target DOM element for mounting
       * @returns {() => void} Cleanup function for unmounting
       */
      mount: (element: HTMLElement): (() => void) => {
        if (this.currentElement) return () => {};
  
        const container = document.createElement('div');
        container.className = 'euiHeaderSectionItem';
        container.id = 'canvas-report-data-analyzer-button-container';
        element.appendChild(container);
  
        ReactDOM.render(
          <GeneratePdfReportsButton 
            reportingService={this.reportingService} 
            disabled={!this.isAuthorized}
            assetService={this.assetService as AssetService}
            http={core.http}
          />,
          container
        );
  
        this.currentElement = container;
  
        return () => {
          if (this.currentElement) {
            ReactDOM.unmountComponentAtNode(this.currentElement);
            this.currentElement.remove();
            this.currentElement = null;
          }
        };
      },
    });
  }

  /**
   * Unregisters navigation control and cleans up DOM elements
   * @private
   */
  private unregisterNavControl() {
    if (typeof this.navControlUnregister === 'function') {
      this.navControlUnregister();
    }
    this.navControlUnregister = undefined;
    if (this.currentElement) {
      ReactDOM.unmountComponentAtNode(this.currentElement);
      this.currentElement.remove();
      this.currentElement = null;
    }
  }

  /**
   * Plugin stop phase (required by OpenSearch Dashboards plugin interface)
   * @public
   */
  public stop() {
    this.unregisterNavControl();
  }
}