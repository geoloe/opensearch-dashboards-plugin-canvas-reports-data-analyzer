import { DashboardStart } from '../../../src/plugins/dashboard/public';
import { EmbeddableStart } from '../../../src/plugins/embeddable/public';
import { ReportingService } from './services/reporting';
import { CoreStart, HttpStart } from '../../../src/core/public';
import { AssetService } from './services/fetch_assets';
import React from 'react';

/** 
 * Main application state container for dashboard reporting
 * @interface
 */
export interface DashboardState {
  title: string;
  timeRange: string;
  visualizations: VisualizationData[];
  timestamp: string;
}

/** 
 * Configuration for text positions in the report
 * @interface
 */
export interface TextPositions {
  tenant_name: { x: number; y: number; size: number };
  dashboard_name: { x: number; y: number; size: number };
  timestamp: { x: number; y: number; size: number };
}

/** 
 * Data structure for individual visualization capture results
 * @interface
 */
export interface VisualizationData {
  id: string;
  title: string;
  type: string;
  data: string;
}

/** 
 * Dependencies required for reporting functionality
 * @interface
 */
export interface ReportingDependencies {
  dashboard: DashboardStart;
  embeddable: EmbeddableStart;
  http: HttpStart;
  notifications: CoreStart['notifications'];
  assetService: AssetService;
}

/** 
 * Modal display management interface
 * @interface
 */
export interface ModalHandlers {
  /** 
   * Displays modal dialog
   * @param message - Content to display
   * @param type - Visual style variant
   * @param progress - Completion percentage (0-100)
   */
  showModal: (message: string, type: 'loading' | 'error' | 'success', progress: number) => void;
  hideModal: () => void;
}

/** 
 * Plugin setup configuration interface
 * @interface
 */
export interface CanvasReportDataAnalyzerPluginSetup {
  reportingService: ReportingService;
  assetService: AssetService;
}

/** 
 * Plugin runtime interface
 * @interface
 */
export interface CanvasReportDataAnalyzerPluginStart {
  assetService: AssetService;
  showReportButton: () => React.ReactElement;
}

/** 
 * Phase tracking metadata container
 * @interface
 */
export interface PhaseTracking {
  readonly phase: string;
  readonly startTime: number;
  readonly historicalDurations: number[];
}

/** 
* Configuration for a report generation phase
* @interface
*/
export interface PhaseMessage {
 message: string;
 isSuccess: boolean;
}

/** 
 * Defines callback signature for progress update notifications
 * @typedef {Function} ProgressCallback
 */
export type ProgressCallback = () => void;

export interface PluginStartDependencies {
  dashboard: DashboardStart;
  embeddable: EmbeddableStart;
  notifications: CoreStart['notifications'];
}

export interface AppPluginStartDependencies {
  dashboard: DashboardStart;
  embeddable: EmbeddableStart;
  notifications: CoreStart['notifications'];
}