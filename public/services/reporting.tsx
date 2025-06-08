import React from 'react';
import { PDFDocument, rgb } from 'pdf-lib';
import { pdf } from '@react-pdf/renderer';
import { i18n } from '@osd/i18n';
import { DashboardState, VisualizationData, ReportingDependencies, ModalHandlers, PhaseMessage, PhaseTracking, ProgressCallback } from '../types';
import { PdfDocument } from '../components/pdf_document';
import { AssetService } from './fetch_assets';
import { TextPositions } from '../types';

/** 
 * Phase weight configuration for progress calculation
 * @constant
 * @type {Record<PhaseKey, number>}
 */
const PHASE_CONFIG = {
  initialization: 0.05,
  data_gathering: 0.65,
  info_retrieval: 0.20,
  pdf_generation: 0.05,
  success: 0.05
} as const;

const DEFAULT_TENANT_NAME = 'Private';
const MAX_TENANT_NAME_LENGTH = 29;

const DASHBOARD_TITLE_STYLES = `
  font-family: 'Arial', sans-serif;
  font-size: 48px;        
  font-weight: 900;
  color: #000000;
  text-align: center;
  padding: 40px 0;
  margin: 0 auto;
  width: 100%;
  background: white;
  letter-spacing: 1px;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.1);
`;

const PROFESSIONAL_TABLE_STYLES = {
  table: `
    width: 100% !important;
    height: auto !important;
    min-height: 50px !important;
    opacity: 1 !important;
    transform: none !important;
    position: relative !important;
    background-color: #ffffff !important;
  `,
  header: `
    background-color: #f8f9fa;
    padding: 12px;
    text-align: left;
    font-weight: 600;
    color: #495057;
    border-bottom: 2px solid #dee2e6;
  `,
  cell: `
    padding: 12px;
    color: #6c757d;
    border-bottom: 1px solid #dee2e6;
    transition: background-color 0.2s;
  `,
  rowHover: `background-color:rgb(255, 255, 255);`
};

type PhaseKey = keyof typeof PHASE_CONFIG;

type OriginalStyles = {
  top?: string;
  left?: string;
  width?: string;
  height?: string;
  position?: string;
  visibility?: string;
};

/**
 * Main service handling PDF report generation with multi-phase progress tracking,
 * error handling, and PDF template merging capabilities.
 * @class
 */
export class ReportingService {
  private dependencies?: ReportingDependencies;
  private modalHandlers?: ModalHandlers;
  private phaseTracker!: PhaseTracking;
  private phaseHistory = new Map<PhaseKey, number[]>();
  private lastPhaseProgress = 0;
  private tenantName = 'Organization ID';
  private completeName = this.tenantName;
  private dashboardName = 'Dashboard';

  /** 
   * Localized phase messages with user-friendly content
   * @readonly
   */
  private readonly phaseMessages: Record<PhaseKey, PhaseMessage> = {
    initialization: { 
      message: i18n.translate('pdfReport.initialization', {
        defaultMessage: 'Starting report generation...'
      }), 
      isSuccess: false 
    },
    data_gathering: { 
      message: i18n.translate('pdfReport.gatheringData', {
        defaultMessage: 'Hang tight! We’re gathering your dashboard data... \n\nThis might take a moment – why not grab a coffee in the meantime?\n\nPlease keep the window open while we finish creating your PDF report.'
      }), 
      isSuccess: false 
    },
    info_retrieval: { 
      message: i18n.translate('pdfReport.infoRetrieval', {
        defaultMessage: 'Retrieving information...'
      }), 
      isSuccess: false 
    },
    pdf_generation: { 
      message: i18n.translate('pdfReport.generatingPDF', {
        defaultMessage: 'Generating PDF content...'
      }), 
      isSuccess: false 
    },
    success: { 
      message: i18n.translate('pdfReport.success', {
        defaultMessage: 'Report generated successfully!'
      }), 
      isSuccess: true 
    }
  };


  private get dashboard() { return this.dependencies?.dashboard }
  private get embeddable() { return this.dependencies?.embeddable }
  private get notification() { return this.dependencies?.notifications }
  private get showModal() { return this.modalHandlers?.showModal ?? this.noop }
  private get hideModal() { return this.modalHandlers?.hideModal ?? this.noop }
  private readonly noop = () => {};

  /**
   * Sets required service dependencies
   * @param {ReportingDependencies} dependencies - Services needed for report generation
   */
  setDependencies(dependencies: ReportingDependencies): void {
    this.dependencies = dependencies;
  }

  /**
   * Registers modal display handlers
   * @param {ModalHandlers} handlers - Modal control interface
   */
  setModalHandlers(handlers: ModalHandlers): void {
    this.modalHandlers = handlers;
  }

  /**
   * Main entry point for PDF report generation
   * @async
   * @param {AssetService} assetService - Service for fetching assets like templates and logos
   * @param {boolean} allowTableOfContents - Flag to include table of contents in the report
   * @param {string} organization - Organization name for report context
   * @throws {Error} When dependencies are missing, DOM elements not found, or PDF generation fails
   * @returns {Promise<void>}
   * @example
   * // Initialize and generate report
   * const service = new ReportingService();
   * service.setDependencies(dependencies);
   * service.setModalHandlers(modalHandlers);
   * await service.generatePdfReport();
   */
  async generatePdfReport(textPositions: TextPositions, allowTableOfContents: boolean, assetService: AssetService, organization: string): Promise<void> {
    try {
      await this.executePhase('initialization', this.handleInitialization);
      const dashboardState = await this.executePhase('data_gathering', () => this.handleDataCollection(organization, allowTableOfContents));
      await this.executePhase('info_retrieval', this.handleInformationRetrieval);
      await this.executePhase('pdf_generation', () => this.handlePdfGeneration(textPositions, allowTableOfContents, assetService, dashboardState));
      await this.executePhase('success', this.handleSuccess);
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  // region Phase Handlers
  /**
   * Handles initialization phase - shows initial progress modal
   * @private
   * @returns {Promise<void>}
   */
  private handleInitialization = async (): Promise<void> => {
    this.showModal(
      this.phaseMessages.initialization.message,
      'loading',
      this.calculateProgress('initialization', 0)
    );
  };

  /**
   * Handles data collection phase - gathers dashboard state and visualizations
   * @private
   * @param {string} organization - Organization name for report context
   * @param {boolean} allowTableOfContents - Flag to include table of contents in the report
   * @returns {Promise<DashboardState>} Complete dashboard snapshot with visualizations
   * @throws {Error} If dashboard elements not found or data retrieval fails
   */
  private handleDataCollection = async (organization: string, allowTableOfContents: boolean): Promise<DashboardState> => {
    const panelElements = this.getPanelElements();
    const progressHandler = this.createProgressHandler('data_gathering', 2 + panelElements.length);
    return this.getDashboardState(allowTableOfContents, organization, progressHandler);
  };

  /**
   * Handles information retrieval phase - collects tenant/organization name/dashboard title info
   * @private
   * @returns {Promise<void>}
   * @throws {Error} If DOM elements not found or information retrieval fails
   */
  private handleInformationRetrieval = async (): Promise<void> => {
    const progressHandler = this.createProgressHandler('info_retrieval', 3);
    await Promise.all([
      this.retrieveTenantInfo(progressHandler),
      this.retrieveOrganizationNameInfo(progressHandler),
      this.retrieveDashboardInfo(progressHandler)
    ]);
  };

  /**
   * Checks tenant access using backend roles
   * @private
   * @returns {Promise<boolean>} True if tenant access is granted, false otherwise
   * @throws {Error} If HTTP service is unavailable or tenant roles cannot be fetched
   */
  private async checkTenantAccess(): Promise<boolean> {

    const fetchTenantAndUser = async () => {
      try {
        if (!this.dependencies?.http) {
          throw new Error('HTTP service unavailable');
        }
        const response = await this.dependencies.http.get<{ 
          tenant: string, 
          username: string
        }>('/api/canvas_report_data_analyzer/tenant');
        
        return response.tenant || '__user__';
      } catch (error) {
        console.error('Error fetching tenant info:', error);
        return '__user__' ;
      }
    };
    try {
      if (!this.dependencies?.http) {
        console.error('HTTP service unavailable');
        return false;
      }

      const tenantName = await fetchTenantAndUser();
      
      if (!tenantName) {
        console.error('Tenant name not available');
        return false;
      }
      
      const hasPrivateorGlobalMatch = tenantName.toLowerCase() === '__user__' || tenantName.toLowerCase() === '';
      
      if (hasPrivateorGlobalMatch) {
        console.warn('Tenant access is private or global, no specific tenant access required');
        return true;
      }
      else {  
        return false;
      }
      
    } catch (error) {
      console.error('Error checking tenant access:', error);
      return false;
    }
  }


  /**
   * Handles PDF generation phase - creates and merges PDF documents
   * @param {TextPositions} textPositions - Positions for tenant name, dashboard name, and timestamp
   * @param {DashboardState} dashboardState - Collected dashboard data
   * @param {AssetService} assetService - Service for fetching assets like templates and logos
   * @param {boolean} allowTableOfContents - Flag to include table of contents in the report
   * @private
   * @returns {Promise<void>}
   * @throws {Error} If PDF generation or merging fails
   */
  private handlePdfGeneration = async (textPositions: TextPositions, allowTableOfContents: boolean, assetService: AssetService, dashboardState: DashboardState): Promise<void> => {
    const progressHandler = this.createProgressHandler(
      'pdf_generation',
      dashboardState.visualizations.length
    );
    
    const mergedPdfBytes = await this.generateAndMergePdf(
      textPositions,
      allowTableOfContents,
      assetService,
      dashboardState.visualizations,
      progressHandler
    );
    
    const hasTenantAccess = await this.checkTenantAccess();
    
    if (!hasTenantAccess) {
      await this.savePdfReport(mergedPdfBytes, dashboardState.title);
      this.finalizePdfDownload(mergedPdfBytes, dashboardState.title);
      setTimeout(() => {
        window.location.reload();
      }, 3500); 
    } else {
      this.finalizePdfDownload(mergedPdfBytes, dashboardState.title);
      setTimeout(() => {
        window.location.reload();
      }, 3500); 
    }
  };

  /**
   * Finalizes PDF download process
   * @param {Uint8Array} pdfBytes - PDF content bytes
   * @param {string} title - Base filename for download
   * @private
   */
  private finalizePdfDownload(pdfBytes: Uint8Array, title: string): void {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.href = url;
    link.download = `${title.replace(/\s+/g, '_')}_${this.getFormattedTimestamp(true)}.pdf`;
    link.click();

    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.contains(link) && document.body.removeChild(link);
    }, 100);
  }

  /**
   * Handles success phase - shows final success message
   * @private
   * @returns {Promise<void>}
   */
  private handleSuccess = async (): Promise<void> => {
    this.showModal(this.phaseMessages.success.message, 'success', 100);
    this.scheduleModalDismissal(3000);
  };
  // endregion

  // region PDF Generation
  /**
   * Saves the generated PDF report to the server
   * @async
   * @param {Uint8Array} pdfBytes - PDF content bytes to save
   * @param {string} title - Base filename for the report
   * @throws {Error} If HTTP service is unavailable or saving fails
   * @returns {Promise<void>}
   */
  private async savePdfReport(pdfBytes: Uint8Array, title: string): Promise<void> {
    if (!this.dependencies?.http) {
      throw new Error('HTTP service unavailable');
    }

    try {
      const fileName = `${title.replace(/\s+/g, '_')}_${this.getFormattedTimestamp(true)}.pdf`;
      
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      
      const file = new File([blob], fileName, { type: 'application/pdf' });
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tenant', this.tenantName);
      formData.append('dashboard', this.dashboardName);

      await this.dependencies.http.post('/api/canvas_report_data_analyzer/save', {
        body: formData,
        query: {
          fileName,
          tenant: this.tenantName,
          dashboard: this.dashboardName,
        },
      });

      this.notification?.toasts.addSuccess(
        i18n.translate('pdfReport.saveMessageTitle', {
          defaultMessage: 'Your report was saved.',
        })
      );
    } catch (error) {
      this.notification?.toasts.addError(error as Error, {
        title: i18n.translate('pdfReport.saveErrorTitle', {
          defaultMessage: 'Failed to save report',
        }),
      });
    }
  }

  /**
   * Generates and merges PDF documents from template and report content
   * @param {TextPositions} textPositions - Positions for tenant name, dashboard name, and timestamp
   * @param {boolean} allowTableOfContents - Flag to include table of contents in the report
   * @param {AssetService} assetService - Service for fetching assets like templates and logos
   * @param {VisualizationData[]} visualizations - Dashboard visualizations to include
   * @param {ProgressCallback} progressHandler - Progress update callback
   * @returns {Promise<Uint8Array>} Merged PDF bytes
   * @private
   * @throws {Error} If PDF loading, merging, or saving fails
   */
  private async generateAndMergePdf(
    textPositions: TextPositions,
    allowTableOfContents: boolean,
    assetService: AssetService,
    visualizations: VisualizationData[],
    progressHandler: ProgressCallback
  ): Promise<Uint8Array> {
    const [templatePdf, reportPdf] = await Promise.all([
      this.loadTemplatePdf(assetService).then(pdf => {
        progressHandler(); // Update after template load
        return pdf;
      }),
      this.generateReportPdf(allowTableOfContents, assetService, visualizations).then(pdf => {
        progressHandler(); // Update after report generation
        return pdf;
      })
    ]);

    const mergedPdf = await PDFDocument.create();
    await this.mergePdfContent(textPositions, mergedPdf, templatePdf, reportPdf);

    // Simulate visualization processing
    for (const _ of visualizations) {
      progressHandler();
      await this.delay(50);
    }

    return mergedPdf.save();
  }

  /**
   * Generates the main report PDF document
   * @param {boolean} allowTableOfContents - Flag to include table of contents in the report
   * @param {VisualizationData[]} visualizations - Visualizations to render
   * @param {AssetService} assetService - Service for fetching assets like templates and logos
   * @returns {Promise<PDFDocument>} Generated report PDF document
   * @private
   * @throws {Error} If PDF rendering fails
   */
  private async generateReportPdf(allowTableOfContents: boolean, assetService: AssetService, visualizations: VisualizationData[]): Promise<PDFDocument> {

    const logoBase64 = await assetService.getLogo();
    const logoDataUri = `data:image/png;base64,${logoBase64}`;
    const reportBlob = await pdf(
      <PdfDocument allowTableOfContents={allowTableOfContents} visualizations={visualizations} logo={logoDataUri} />
    ).toBlob();
    return PDFDocument.load(await reportBlob.arrayBuffer());
  }

  /**
   * Merges template and report content into final PDF
   * @param {TextPositions} textPositions - Positions for tenant name, dashboard name, and timestamp
   * @param {PDFDocument} mergedPdf - Target PDF document
   * @param {PDFDocument} template - Template PDF with cover/final pages
   * @param {PDFDocument} report - Generated report content PDF
   * @param {ProgressCallback} [progressCallback] - Optional progress update callback
   * @returns {Promise<void>}
   * @private
   * @throws {Error} If PDF operations fail
   */
  private async mergePdfContent(
    textPositions: TextPositions,
    mergedPdf: PDFDocument,
    template: PDFDocument,
    report: PDFDocument,
    progressCallback?: () => void
  ): Promise<void> {
    await this.addCoverPage(textPositions, mergedPdf, template);
    progressCallback?.();
    await this.addReportPages(mergedPdf, report);
    progressCallback?.();
    await this.addFinalPage(mergedPdf, template);
    progressCallback?.();
  }

  /**
   * Adds cover page content to merged PDF
   * @param {TextPositions} textPositions - Positions for tenant name, dashboard name, and timestamp
   * @param {PDFDocument} mergedPdf - Target PDF document
   * @param {PDFDocument} template - Source template PDF
   * @returns {Promise<void>}
   * @private
   * @throws {Error} If font embedding or page drawing fails
   */
  private async addCoverPage(textPositions: TextPositions, mergedPdf: PDFDocument, template: PDFDocument): Promise<void> {
    const [coverPage] = await mergedPdf.copyPages(template, [0]);
    const page = mergedPdf.addPage(coverPage);
    
    const mmToPoints = (mm: number) => mm * 2.83465;
    const [fontBold, fontRegular] = await Promise.all([
      mergedPdf.embedFont('Helvetica-Bold'),
      mergedPdf.embedFont('Helvetica')
    ]);

    page.drawText(this.completeName, {
      x: mmToPoints(textPositions.tenant_name.x),
      y: mmToPoints(textPositions.tenant_name.y),
      size: textPositions.tenant_name.size,
      color: rgb(0, 0, 0),
      font: fontBold,
    });

    page.drawText(this.dashboardName, {
      x: mmToPoints(textPositions.dashboard_name.x),
      y: mmToPoints(textPositions.dashboard_name.y),
      size: textPositions.dashboard_name.size,
      color: rgb(0, 0, 0),
      font: fontBold,
    });

    page.drawText(this.getFormattedTimestamp(), {
      x: mmToPoints(textPositions.timestamp.x),
      y: mmToPoints(textPositions.timestamp.y),
      size: textPositions.timestamp.size,
      color: rgb(0, 0, 0),
      font: fontRegular,
    });
  }
  // endregion

  // region DOM Interactions
  /**
   * Retrieves tenant information from UI elements
   * @param {ProgressCallback} progressHandler - Progress update callback
   * @private
   * @throws {Error} If user menu or tenant name element not found
   */
  private async retrieveTenantInfo(progressHandler: ProgressCallback): Promise<void> {
    try {
      await this.clickElement('actionsMenu');
      await this.delay(100);

      const tenantName = this.getElementText('tenantName', DEFAULT_TENANT_NAME, true);
      this.tenantName = this.capitalizeFirstLetter(tenantName);
      this.completeName = this.tenantName;
      
      progressHandler();
    } catch (error) {
      throw new Error('Tenant information retrieval failed', { cause: error });
    }
  }

  /**
   * Retrieves Organization Name if given from details panel
   * @private
   * @throws {Error} If details panel or organization info element not found
   */
  private async retrieveOrganizationNameInfo(progressHandler: ProgressCallback): Promise<void> {
    try {
      await this.toggleDetailsPanel();
      await this.delay(100);

      const organizationText = this.getElementText(
        '[data-test-subj="tableDocViewRow-organization.name-value"] span',
        this.tenantName,
        false
      );
      
      this.completeName = this.formatOrganizationName(organizationText);
      progressHandler();
    } catch (error) {
      throw new Error('Organization information retrieval failed', { cause: error });
    }
  }

  /**
   * Retrieves product information from dashboard viewport
   * @private
   * @throws {Error} If product element not found or data attribute missing
   */
  private async retrieveDashboardInfo(progressHandler: ProgressCallback): Promise<void> {
    try {
      const dashboardTitle = document.querySelector('.dshDashboardViewport');
      this.dashboardName = dashboardTitle?.getAttribute('data-title')|| await this.getDashboardTitleText();
      
      await this.delay(100);
      progressHandler();
    } catch (error) {
      throw new Error('Product information retrieval failed', { cause: error });
    }
  }


  /**
   * Toggles details panel open/closed state
   * @private
   * @throws {Error} If no valid expand button found
   */
  private async toggleDetailsPanel(): Promise<void> {
    const selector = '[aria-label="Toggle row details"], [aria-label="Inspect document details"]';
    const element = document.querySelector<HTMLElement>(selector);
    element?.click();
  }
  // endregion

  // region Helpers
  /**
   * Retrieves all dashboard panel elements matching the embeddable selector
   * @returns {NodeListOf<Element>} List of panel elements
   * @private
   */
  private getPanelElements(): NodeListOf<Element> {
    return document.querySelectorAll('[data-test-embeddable-id]');
  }

  /**
   * Creates a progress handler function for a specific phase
   * @param {PhaseKey} phase - Target phase for progress tracking
   * @param {number} totalSteps - Total number of expected progress steps
   * @returns {ProgressCallback} Configured progress handler function
   * @private
   */
  private createProgressHandler(
    phase: PhaseKey,
    totalSteps: number
  ): ProgressCallback {
    let currentStep = 0;
    
    return () => {
      currentStep++;
      this.lastPhaseProgress = this.calculateProgress(
        phase,
        currentStep / totalSteps
      );
      this.updateModalProgress();
    };
  }

  /**
   * Loads template PDF from base64 encoded string
   * @param {AssetService} assetService - Service for fetching assets like templates and logos
   * @returns {Promise<PDFDocument>} Initialized PDF document
   * @private
   */
  private async loadTemplatePdf(assetService: AssetService): Promise<PDFDocument> {
    const templatePdfBase64 = await assetService.getTemplate();
    const bytes = Uint8Array.from(atob(templatePdfBase64), c => c.charCodeAt(0));
    return PDFDocument.load(bytes);
  }

  /**
   * Formats organization name with line breaks for PDF display
   * @param {string} fullText - Raw organization name from DOM
   * @returns {string} Formatted name with line breaks
   * @private
   */
  private formatOrganizationName(fullText: string): string {
    const sanitized = fullText.replace(/[^a-zA-Z0-9äüöÄÜÖß.\s]/g, '');
    if (sanitized.length <= MAX_TENANT_NAME_LENGTH) return sanitized;

    const lastSpaceIndex = sanitized.lastIndexOf(' ', MAX_TENANT_NAME_LENGTH);
    return lastSpaceIndex === -1 
      ? sanitized 
      : `${sanitized.slice(0, lastSpaceIndex)}\n${sanitized.slice(lastSpaceIndex + 1)}`;
  }

  /**
   * Generates localized timestamp string
   * @param {boolean} [fileSafe=false] - Flag for filename-safe formatting
   * @returns {string} Formatted timestamp string
   * @private
   */
  private getFormattedTimestamp(fileSafe = false): string {
    const now = new Date();
    const date = now.toLocaleDateString('de-DE', { 
      year: 'numeric', month: '2-digit', day: '2-digit' 
    }).replace(/\./g, '.');
    
    const time = now.toLocaleTimeString('de-DE', { 
      hour12: false, hour: '2-digit', minute: '2-digit' 
    }).replace(/:/g, fileSafe ? '-' : ':');

    return fileSafe ? `${date}_${time}` : `${date} @ ${time}`;
  }

  /**
   * Capitalizes the first letter of a string
   * @param {string} str - Input string
   * @returns {string} Capitalized string
   * @private
   */
  private capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  /**
   * Creates a delay promise
   * @param {number} ms - Delay duration in milliseconds
   * @returns {Promise<void>} Delay promise
   * @private
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  // endregion

  // region Progress Management
  /**
   * Executes a report generation phase with time tracking and error handling
   * @template T
   * @param {PhaseKey} phase - Phase identifier to execute
   * @param {() => Promise<T>} operation - Async function containing phase logic
   * @returns {Promise<T>} Result of the phase operation
   * @private
   * @throws {Error} Propagates any errors from phase operations
   */
  private async executePhase<T>(phase: PhaseKey, operation: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    this.phaseTracker = { phase, startTime, historicalDurations: this.getPhaseHistory(phase) };

    try {
      this.updateProgress(phase, 0);
      const result = await operation();
      this.updateProgress(phase, 1);
      this.updatePhaseHistory(phase, Date.now() - startTime);
      return result;
    } catch (error) {
      this.updatePhaseHistory(phase, Date.now() - startTime);
      throw error;
    }
  }
  // endregion

  // region PDF Operations
  
  /**
   * Adds report content pages to merged PDF
   * @param {PDFDocument} mergedPdf - Target PDF document
   * @param {PDFDocument} reportDoc - Generated report PDF document
   * @returns {Promise<void>}
   * @private
   */
  private async addReportPages(mergedPdf: PDFDocument, reportDoc: PDFDocument): Promise<void> {
    const reportPages = await mergedPdf.copyPages(reportDoc, reportDoc.getPageIndices());
    reportPages.forEach(page => mergedPdf.addPage(page));
  }
  
  /**
   * Adds final template page to merged PDF
   * @param {PDFDocument} mergedPdf - Target PDF document
   * @param {PDFDocument} templateDoc - Template PDF document
   * @returns {Promise<void>}
   * @private
   */
  private async addFinalPage(mergedPdf: PDFDocument, templateDoc: PDFDocument): Promise<void> {
    const [finalPage] = await mergedPdf.copyPages(templateDoc, [1]);
    mergedPdf.addPage(finalPage);
  }
  // endregion

  // region DOM Helpers
  /**
   * Simulates click on specified element
   * @param {string} selector - DOM element ID
   * @throws {Error} If element not found
   * @private
   */
  private async clickElement(selector: string): Promise<void> {
    const element = document.getElementById(selector);
    if (!element) throw new Error(`Element not found: ${selector}`);
    element.click();
  }
  
  /**
   * Retrieves sanitized text content from DOM element
   * @param {string} selector - DOM element selector
   * @param {string} defaultValue - Fallback value if element not found
   * @param {boolean} isTenant - Source verification flag
   * @returns {string} Sanitized text content
   * @private
   */
  private getElementText(selector: string, defaultValue: string, isTenant: boolean): string {
    if (isTenant) {
      const tenantNameElement = document.getElementById('tenantName');
      this.tenantName = tenantNameElement?.textContent?.trim() || DEFAULT_TENANT_NAME;
      this.capitalizeFirstLetter(this.tenantName);
      return this.tenantName;
    }
    return document.querySelector(selector)?.textContent?.trim() || defaultValue;
  }
  // endregion

  // region Progress Management
  /**
   * Updates internal progress state and triggers modal update
   * @param {PhaseKey} phase - Current active phase
   * @param {number} phaseProgress - Phase completion ratio (0-1)
   * @private
   */
  private updateProgress(phase: PhaseKey, phaseProgress: number): void {
    this.lastPhaseProgress = this.calculateProgress(phase, phaseProgress);
    this.updateModalProgress();
  }
  /**
   * Updates modal progress display with current phase information
   * @private
   */
  private updateModalProgress(): void {
    if (!this.modalHandlers) return;
    
    const currentProgress = Math.max(0, Math.min(100, this.lastPhaseProgress));
    const { message, isSuccess } = this.phaseMessages[this.phaseTracker.phase as PhaseKey];
    
    this.modalHandlers.showModal(message, isSuccess ? 'success' : 'loading', currentProgress);
  }

  /**
   * Retrieves historical duration data for a phase
   * @param {PhaseKey} phase - Target phase
   * @returns {number[]} Array of historical durations in milliseconds
   * @private
   */
  private getPhaseHistory(phase: PhaseKey): number[] {
    return this.phaseHistory.get(phase) || [];
  }

  /**
   * Updates phase history with new duration data
   * @param {PhaseKey} phase - Target phase
   * @param {number} duration - Execution duration in milliseconds
   * @private
   */
  private updatePhaseHistory(phase: PhaseKey, duration: number) {
    const history = this.getPhaseHistory(phase);
    if (history.length >= 10) history.shift();
    history.push(duration);
    this.phaseHistory.set(phase, history);
  }
  // endregion

  /**
   * Calculates overall progress percentage based on phase weights
   * @param {PhaseKey} phase - Current active phase
   * @param {number} phaseProgress - Completion ratio (0-1) within current phase
   * @returns {number} Calculated percentage (0-100) clamped to valid range
   * @private
   */
  private calculateProgress(phase: PhaseKey, phaseProgress: number): number {
    const phaseKeys = Object.keys(PHASE_CONFIG) as PhaseKey[];
    const currentIndex = phaseKeys.indexOf(phase);
    
    const accumulated = phaseKeys
      .slice(0, currentIndex)
      .reduce((sum, key) => sum + PHASE_CONFIG[key], 0);

    const currentContribution = PHASE_CONFIG[phase] * Math.min(1, Math.max(0, phaseProgress));
    return Math.round((accumulated + currentContribution) * 100);
  }

  // region Error Handling
  private handleError(error: Error): void {
    console.error('PDF generation failed:', error);
    const message = error.message || this.phaseMessages.data_gathering.message;
    this.showModal(message, 'error', 0);
    this.scheduleModalDismissal(3000);
  }

  private scheduleModalDismissal(delayMs: number): void {
    this.hideModal && setTimeout(this.hideModal, delayMs);
  }
  // endregion

  // region Panel Resizing Helpers
  /**
   * Temporarily resizes panels to standardized dimensions
   * @param {Element[]} panels - Array of panel elements to process
   * @returns {Promise<() => void>} Cleanup function to restore original styles
   */
  private async preparePanelDimensions(panels: Element[]): Promise<() => void> {
    const chartPanels = panels.filter(panel => panel.querySelector('.visChart'));

    const pieChartPanels = chartPanels.filter(panel => panel.querySelector('.arcs'));
    const tsvbPanels = chartPanels.filter(panel => panel.querySelector('.tvbVisTimeSeries'));
    const barCharts = chartPanels.filter(panel => panel.querySelector('.visAxis--y'));
    const topNCharts = chartPanels.filter(panel => panel.querySelector('.tvbVisTopN'));
    const trendMetrics = chartPanels.filter(panel => panel.querySelector('.osdRedirectCrossAppLinks'));
    const tsvbMetrics = chartPanels.filter(panel => panel.querySelector('.tvbSplitVis'));
    const mapCharts = chartPanels.filter(panel => panel.querySelector('.visChart.vgaVis'));
    const tvbSplitVis = chartPanels.filter(panel => panel.querySelector('.tvbSplitVis'));
    const tvbTableView = chartPanels.filter(panel => panel.querySelector('[data-test-subj="tableView"]'));
    

    const metricPanels = panels.filter(panel => panel.querySelector('.mtrVis'));
    
    const tablePanels = panels.filter(panel => panel.querySelector('.visualization.tableVis'));

    const cloudPanels = panels.filter(panel => panel.querySelector('.tgcChart'));

    const markdownTsvbPanels = panels.filter(panel => panel.querySelector('[data-test-subj="tsvbMarkdown"]'));

    const originalStyles: Map<HTMLElement, OriginalStyles> = new Map();

    const storeAndApplyStyles = (
      panel: Element,
      rootStyles: Partial<CSSStyleDeclaration>,
      embPanelStyles: Partial<CSSStyleDeclaration>
    ) => {
      const root = panel.closest('.react-grid-item') as HTMLElement;
      const embPanel = panel.closest('.embPanel') as HTMLElement;
      if (root && embPanel) {
        originalStyles.set(root, {
          top: root.style.top,
          left: root.style.left,
          width: root.style.width,
          height: root.style.height,
          position: root.style.position,
          visibility: root.style.visibility
        });
        originalStyles.set(embPanel, {
          width: embPanel.style.width,
          height: embPanel.style.height
        });
        Object.assign(root.style, rootStyles);
        Object.assign(embPanel.style, embPanelStyles);
      }
    };

    tsvbPanels.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '540px',
        left: '964px',
        width: '948px',
        height: '384px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    barCharts.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '540px',
        left: '964px',
        width: '948px',
        height: '384px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    pieChartPanels.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '540px',
        left: '964px',
        width: '640px',
        height: '440px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    topNCharts.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '540px',
        left: '964px',
        width: '640px',
        height: '440px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    trendMetrics.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '260px',
        left: '637px',
        width: '318px',
        height: '340px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    tsvbMetrics.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '320px',
        left: '637px',
        width: '637px',
        height: '200px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    metricPanels.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '700px',
        left: '637px',
        width: '637px',
        height: '220px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    tablePanels.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '1600px',
        left: '955px',
        width: '955px',
        height: '540px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    tvbSplitVis.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '1600px',
        left: '955px',
        width: '955px',
        height: '540px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    tvbTableView.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '1600px',
        left: '955px',
        width: '955px',
        height: '540px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    cloudPanels.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '540px',
        left: '964px',
        width: '948px',
        height: '384px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    mapCharts.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '540px',
        left: '964px',
        width: '948px',
        height: '384px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    markdownTsvbPanels.forEach(panel => {
      storeAndApplyStyles(panel, {
        top: '540px',
        left: '964px',
        width: '948px',
        height: '384px',
        position: 'absolute',
        visibility: 'hidden'
      }, {
        width: '100%',
        height: '100%'
      });
    });

    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          await new Promise(r => setTimeout(r, 300));
          resolve(undefined);
        });
      });
    });

    return () => {
      originalStyles.forEach((styles, element) => {
        Object.assign(element.style, styles);
      });
    };
  }
  // endregion

  // region Dashboard State Management
  /**
   * Retrieves the current dashboard state including title, time range, and visualizations
   * @param progressCallback - Optional callback to report progress
   * @param organization - Organization name for report context
   * @param {boolean} allowTableOfContents - Flag to include table of contents in the report
   * @returns Promise resolving to DashboardState
   * @throws Error when dashboard services are not available
   */
  private async getDashboardState(allowTableOfContents: boolean, organization: string, progressCallback?: () => void): Promise<DashboardState> {
    this.validateDashboardServices();
    
    const dashboardTitle = await this.getDashboardTitleText();
    const timeRange = await this.getTimeRange(progressCallback);

    return {
      title: dashboardTitle,
      timeRange,
      visualizations: await this.getVisualizationData(allowTableOfContents, organization, progressCallback),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validates required dashboard services are available
   * @throws Error when services are missing
   */
  private validateDashboardServices(): void {
    if (!this.dashboard || !this.embeddable || !this.notification) {
      throw new Error('Dashboard services not available');
    }
  }

  /**
   * Extracts time range from DOM and validates dashboard selection
   * @param progressCallback - Optional progress callback
   * @returns Promise resolving to time range string
   * @throws Error when no dashboard is selected
   */
  private async getTimeRange(progressCallback?: () => void): Promise<string> {
    const timeRangeSelector = '[data-test-subj="dataSharedTimefilterDuration"]';
    const timeRangeElement = document.querySelector(timeRangeSelector);
    const timeRange = timeRangeElement?.textContent?.trim() || 'Unknown Time Range';
    
    await this.reportProgress(progressCallback);
    
    if (!timeRangeElement) {
      this.handleDashboardSelectionError();
      throw new Error('No Dashboard selected. Please go to your Dashboard and try again.');
    }
    
    return timeRange;
  }

  /**
   * Handles dashboard selection error notifications
   */
  private handleDashboardSelectionError(): void {
    this.notification?.toasts.addDanger(
      i18n.translate('pdfReportPlugin.noDashboardSelected', {
        defaultMessage: 'PDF creation not possible.',
      })
    );
    this.showModal(`No Dashboard selected. Please go to your Dashboard and try again.`, 'error', 0);
  }

  /**
   * Universal progress reporting with delay
   * @param progressCallback - Optional callback to execute
   */
  private async reportProgress(progressCallback?: () => void): Promise<void> {
    progressCallback?.();
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  // endregion

  // region Visualization Data Processing
  /**
   * Processes and aggregates all visualization data for PDF reporting
   * @param progressCallback - Optional progress reporting callback
   * @param {boolean} allowTableOfContents - Flag to include table of contents in the report
   * @param organization - Organization name for report context 
   * @returns Promise resolving to complete visualization data array
   */
  private async getVisualizationData(
    allowTableOfContents: boolean,
    organization: string,
    progressCallback?: () => void
  ): Promise<VisualizationData[]> {
    const panels = this.getValidPanels();

    // If no valid panels found, throw an error
    if (panels.length === 0) {
      throw new Error(i18n.translate('pdfReport.noValidPanels', {
        defaultMessage: 'No report content available. The dashboard contains only empty or unsupported visualizations.'
      }));
    }

    // Show positive UI message
    this.notification?.toasts.addSuccess(
      i18n.translate('pdfReportPlugin.DashboardSelected', {
        defaultMessage: 'PDF creation possible.',
      })
    );
    
    // Prepare panel imensions and get cleanup function
    const restoreLayout = await this.preparePanelDimensions(panels);

    try {
      const { titleText, dashboardTitleImage } = await this.processDashboardTitle(progressCallback);
      const timeRangeImage = await this.captureTimeRange(progressCallback);
      const panelVisualizations = await this.processVisualizationPanels(panels, progressCallback);
      
      const validPanels = this.validatePanels(panels);
      const totalPages = this.calculateTotalPages(validPanels.length);
      const footerImages = await this.createFooterImages(allowTableOfContents, organization, titleText, totalPages, progressCallback);

      return this.assembleFinalVisualizations(
        dashboardTitleImage,
        timeRangeImage,
        panelVisualizations,
        footerImages,
        validPanels,
        totalPages
      );
    } finally {
      // Restore original layout even if errors occur
      restoreLayout();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  // endregion

  // region Validation Helpers
  /**
   * Validates and extracts panel titles
   * @param panels - Raw panel elements
   * @returns Filtered panels with titles
   */
  private validatePanels(
    panels: Element[]
  ): Array<{ panel: Element; title: string }> {
    return panels
      .map(panel => {
        const title =
          panel.querySelector('[data-title]')?.getAttribute('data-title') ||
          panel.querySelector('.embPanel__titleText')?.textContent?.trim() || '[No Title]';
        return title ? { panel, title } : null;
      })
      .filter((entry): entry is { panel: Element; title: string } => entry !== null);
  }

  /**
   * Calculates total PDF pages
   * @param validCount - Number of valid panels
   * @returns Total page count
   */
  private calculateTotalPages(validCount: number): number {
    const visualizationsPerPage = 2;
    let contentPages = 0;
    if (validCount > 0) {
      contentPages = 1 + Math.ceil((validCount - 1) / visualizationsPerPage);
    }
    return 3 + contentPages;
  }
  // endregion

  // region Dashboard Title Processing
  /**
   * Processes and captures dashboard title visualization
   * @param progressCallback - Progress reporting callback
   * @returns Object containing title text and captured image
   */
  private async processDashboardTitle(progressCallback?: () => void): Promise<{
    titleText: string;
    dashboardTitleImage: string;
  }> {
    const titleText = this.getDashboardTitleText();
    const titleElement = this.createDashboardTitleElement(titleText);
    const tempWrapper = this.createOffscreenWrapper(titleElement, {
      width: '794px',
      padding: '30px 0'
    });

    document.body.appendChild(tempWrapper);
    
    try {
      const dashboardTitleImage = await this.capturePanelScreenshot(
        tempWrapper,
        progressCallback,
        2,
        'DashboardTitle'
      );
      return { titleText, dashboardTitleImage };
    } catch (error) {
      console.error('Dashboard title capture failed:', error);
      return { titleText, dashboardTitleImage: '' };
    } finally {
      document.body.removeChild(tempWrapper);
    }
  }

  /**
   * Creates styled dashboard title element
   * @param titleText - Text content for the title
   * @returns Configured HTMLDivElement
   */
  private createDashboardTitleElement(titleText: string): HTMLDivElement {
    const titleContainer = document.createElement('div');
    titleContainer.innerHTML = `
      <div style="${DASHBOARD_TITLE_STYLES}">
        ${titleText}
      </div>
    `;
    return titleContainer;
  }
  // endregion

  // region Panel Processing
  /**
   * Processes all valid panels into visualization data
   * @param panels - Array of panel elements to process
   * @param progressCallback - Progress reporting callback
   * @returns Promise resolving to array of visualization data arrays
   */
  private async processVisualizationPanels(
    panels: Element[],
    progressCallback?: () => void
  ): Promise<VisualizationData[][]> {
    return Promise.all(
      panels.map(async (panelElement, index) => {
        const panelId = this.getPanelId(panelElement);
        const title = this.getPanelTitle(panelElement);
        const screenshot = await this.capturePanelScreenshot(panelElement, progressCallback);
        progressCallback?.(); // Explicit update after screenshot
        
        const visualizations: VisualizationData[] = [];
        const dataTitleViz = await this.createDataTitleVisualization(panelElement, panelId);
        if (dataTitleViz) visualizations.push(dataTitleViz);

        visualizations.push(this.createMainVisualization(panelId, title, screenshot));
        this.addPageBreaks(visualizations, index, panels.length);

        return visualizations;
      })
    );
  }

  /**
   * Creates data title visualization if present in panel
   * @param panelElement - Panel element to check
   * @param panelId - Unique panel identifier
   * @returns Promise resolving to optional visualization data
   */
  private async createDataTitleVisualization(
    panelElement: Element,
    panelId: string
  ): Promise<VisualizationData | null> {
    const dataTitle = panelElement.querySelector('[data-title]')?.getAttribute('data-title') || '[No Title]';

    const tempTitle = this.createDataTitleElement(dataTitle);
    document.body.appendChild(tempTitle);

    try {
      const titleScreenshot = await this.capturePanelScreenshot(tempTitle);
      return {
        id: `${panelId}-title`,
        title: dataTitle,
        type: "visualizationTitle",
        data: titleScreenshot,
      };
    } catch (error) {
      console.error('Title capture failed:', error);
      return null;
    } finally {
      document.body.removeChild(tempTitle);
    }
  }

  /**
   * Creates styled data title element for capture
   * @param dataTitle - Text content for data title
   * @returns Configured HTMLDivElement
   */
  private createDataTitleElement(dataTitle: string): HTMLDivElement {
    const PDF_CONTENT_WIDTH_PX = 794 - 60; // Calculated from constants
    const tempTitle = document.createElement('div');
    
    Object.assign(tempTitle.style, {
      position: 'absolute',
      left: '-9999px',
      top: '-9999px',
      color: '#000',
      fontFamily: 'Arial, sans-serif',
      margin: '0',
      width: `${PDF_CONTENT_WIDTH_PX}px`,
      maxWidth: `${PDF_CONTENT_WIDTH_PX}px`,
      whiteSpace: 'pre-line',
      fontSize: '28px',
      wordWrap: 'break-word',
      lineHeight: '1.4',
      textAlign: 'left',
      backgroundColor: '#ffffff',
      boxSizing: 'border-box',
      zIndex: '1',
      background: 'linear-gradient(to right, rgba(255,255,255,1) 0%, rgba(255,255,255,1) 100%)'
    });

    tempTitle.textContent = dataTitle;
    return tempTitle;
  }
  // endregion

  // region Helper Methods
  /**
   * Creates main visualization data object
   * @param panelId - Unique panel identifier
   * @param title - Human-readable panel title
   * @param screenshot - Captured image data
   * @returns Configured VisualizationData object
   */
  private createMainVisualization(
    panelId: string,
    title: string,
    screenshot: string
  ): VisualizationData {
    return {
      id: panelId,
      title,
      type: "Visualization",
      data: screenshot,
    };
  }

  /**
   * Adds page break markers to visualization array
   * @param visualizations - Array to modify
   * @param index - Current panel index
   * @param totalPanels - Total number of panels
   */
  private addPageBreaks(
    visualizations: VisualizationData[],
    index: number,
    totalPanels: number
  ): void {
    if ((index + 1) % 2 === 0 && index !== totalPanels - 1) {
      visualizations.push({
        id: `page-break-${index}`,
        type: "PageBreak",
        title: "",
        data: ""
      });
    }
  }

  /**
   * Extracts panel title from element
   * @param panelElement - DOM element containing panel
   * @returns Cleaned title text
   */
  private getPanelTitle(panelElement: Element): string {
    return panelElement.querySelector('.embPanel__titleText')?.textContent?.trim() || 'Untitled Panel';
  }

  /**
   * Extracts panel ID from element
   * @param panelElement - DOM element containing panel
   * @returns Panel ID or 'unknown'
   */
  private getPanelId(panelElement: Element): string {
    return panelElement.getAttribute('data-test-embeddable-id') || 'unknown';
  }

  /**
   * Filters and validates panel elements
   * @returns Array of valid panel elements
   */
  private getValidPanels(): Element[] {
    return Array.from(document.querySelectorAll('[data-test-embeddable-id]'))
      .filter(panel => this.isValidPanel(panel));
  }

  /**
   * Determines if panel should be included in processing
   * @param panel - Panel element to validate
   * @returns True if panel should be included
   */
  private isValidPanel(panel: Element): boolean {
    return !this.isExcludedPanelType(panel) && 
          !this.isEmptyPanel(panel) && 
          !this.hasNoDataMessage(panel);
  }

  /**
   * Checks for excluded panel types
   * @param panel - Panel element to check
   * @returns True if panel matches excluded types
   */
  private isExcludedPanelType(panel: Element): boolean {
    const excludedSelectors = [
      '.visualization.markdownVis',
      '[data-test-subj="discoverTable"]',
      '.icvContainer'
    ];
    return excludedSelectors.some(selector => panel.querySelector(selector));
  }

  /**
   * Checks for empty data panels
   * @param panel - Panel element to check
   * @returns True if panel contains empty data indicators
   */
  private isEmptyPanel(panel: Element): boolean {
    const emptyContainer = panel.querySelector(
      '.visualization > .visChart__container.osd-resetFocusState > .visChart > .tvbVis'
    );
    return !!emptyContainer && !emptyContainer.hasChildNodes();
  }

  /**
   * Checks for no data messages
   * @param panel - Panel element to check
   * @returns True if panel contains no data messages
   */
  private hasNoDataMessage(panel: Element): boolean {
    const messages = ['No data to display for the selected metrics', 'No results found'];
    return Array.from(panel.querySelectorAll('p'))
      .some(el => messages.includes(el.textContent?.trim() || ''));
  }
  // endregion

  // region Final Assembly
  /**
   * Assembles final visualization array with all components
   * @param dashboardTitleImage - Captured title image
   * @param timeRangeImage - Captured time range image
   * @param panelVisualizations - Processed panel data
   * @param footerImages - Generated footer images
   * @returns Complete array of visualization data
   */
  private async assembleFinalVisualizations(
    dashboardTitleImage: string,
    timeRangeImage: string,
    panelVisualizations: VisualizationData[][],
    footerImages: string[],
    validPanels: Array<{ panel: Element; title: string }>,
    totalPages: number
  ): Promise<VisualizationData[]> {
    const tocImage = await this.processTableOfContents(validPanels, totalPages);
    const flattened = panelVisualizations.flat();

    return [
      this.createTocVisualization(tocImage),
      ...this.createPageFooters(footerImages),
      this.createDashboardTitleVisualization(dashboardTitleImage),
      this.createTimeRangeVisualization(timeRangeImage),
      ...flattened
    ];
  }
  // endregion

  // region Table of Contents Processing
  /**
   * Processes and captures table of contents
   * @returns Promise resolving to captured image
   */
  private async processTableOfContents(
    validPanels: Array<{ panel: Element; title: string }>,
    totalPages: number
  ): Promise<string> {
    const tocElement = this.createTableOfContentsElement(validPanels, totalPages);
    document.body.appendChild(tocElement);

    try {
      return await this.capturePanelScreenshot(
        tocElement,
        undefined,
        2,
        'TableOfContents'
      );
    } catch (error) {
      console.error('TOC capture failed:', error);
      return '';
    } finally {
      document.body.removeChild(tocElement);
    }
  }
  // endregion

  // region Visualization Object Creation
  /**
   * Creates TOC visualization data object
   * @param tocImage - Captured TOC image
   * @returns Configured VisualizationData
   */
  private createTocVisualization(tocImage: string): VisualizationData {
    return {
      id: 'report-toc',
      title: 'Table of Contents',
      type: 'TableOfContents',
      data: tocImage,
    };
  }

  /**
   * Creates dashboard title visualization data object
   * @param image - Captured title image
   * @returns Configured VisualizationData
   */
  private createDashboardTitleVisualization(image: string): VisualizationData {
    return {
      id: 'dashboard-title',
      title: 'Dashboard Title',
      type: 'DashboardTitle',
      data: image,
    };
  }

  /**
   * Creates time range visualization data object
   * @param image - Captured time range image
   * @returns Configured VisualizationData
   */
  private createTimeRangeVisualization(image: string): VisualizationData {
    return {
      id: 'time-range',
      title: 'Time Range',
      type: 'Header',
      data: image,
    };
  }

  /**
   * Creates page footer visualization objects
   * @param images - Array of footer images
   * @returns Array of VisualizationData
   */
  private createPageFooters(images: string[]): VisualizationData[] {
    return images.map((img, index) => ({
      id: `footer-page-${index+1}`,
      title: 'Page Footer',
      type: 'PageFooter',
      data: img,
      pageNumber: index + 1
    }));
  }
  // endregion



  // region Missing Method Implementations
  /**
   * Captures time range visualization
   * @param progressCallback - Progress reporting callback
   * @returns Promise resolving to captured image
   */
  private async captureTimeRange(progressCallback?: () => void): Promise<string> {
    const element = document.querySelector('.euiDatePickerRange.euiDatePickerRange--inGroup');
    if (!element) return '';
    
    return this.capturePanelScreenshot(
      element,
      progressCallback,
      2,
      'Header'
    );
  }

  /**
   * Creates offscreen wrapper element for capture
   * @param content - Element to wrap
   * @param styles - Additional styles to apply
   * @returns Configured wrapper element
   */
  private createOffscreenWrapper(
    content: HTMLElement,
    styles: Partial<CSSStyleDeclaration>
  ): HTMLDivElement {
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      position: 'absolute',
      left: '-9999px',
      top: '-9999px',
      background: 'white',
      boxSizing: 'border-box',
      ...styles
    });
    wrapper.appendChild(content);
    return wrapper;
  }

  /**
   * Gets dashboard title text from DOM
   * @returns Cleaned title text
   */
  private getDashboardTitleText(): string {
    try {
      const selector = '[data-test-subj="breadcrumb last"].euiBreadcrumb.euiBreadcrumb--last';
      const breadcrumb = document.querySelector<HTMLSpanElement>(selector);
      
      if (!breadcrumb) {
        console.warn('Dashboard breadcrumb element not found');
        return 'Dashboard Report';
      }
      
      const title = breadcrumb.textContent?.trim() || 'Dashboard Report';
      
      return title;
    } catch (error) {
      console.error('Error retrieving dashboard title:', error);
      return 'Dashboard Report';
    }
  }

  /**
   * Creates table of contents element with validation
   * @param validPanels - Filtered panel data
   * @param totalPages - Calculated total pages
   * @returns Configured TOC element
   */
  private createTableOfContentsElement(
    validPanels: Array<{ panel: Element; title: string }>, 
    totalPages: number
  ): HTMLElement {
    const tocWrapper = document.createElement('div');
    Object.assign(tocWrapper.style, {
      position: 'absolute',
      left: '-9999px',
      top: '-9999px',
      width: '794px', // Match PDF width
      height: '1123px', // Match PDF height (A4)
      padding: '50px',
      backgroundColor: '#ffffff',
      boxSizing: 'border-box',
      fontFamily: 'Arial, sans-serif',
    });
  

    tocWrapper.innerHTML = `
      <div style="margin-bottom: 40px;">
        <h1 style="font-size: 32px; color: #0055A6; border-bottom: 1px solid #0055A6; 
            padding-bottom: 8px; margin-bottom: 24px;">
          Report Contents
        </h1>
        <div style="margin-top: 30px;">
          ${this.generateTocItems(validPanels, totalPages)}
        </div>
      </div>
    `;

    return tocWrapper;
  }
  // endregion

  // region Footer Image Generation

  /**
   * Generates footer images for each page of the PDF report
   * @param {boolean} allowTableOfContents - Flag to include table of contents in the report
   * @param {string} title - The dashboard title to display in the footer
   * @param {number} totalPages - Total number of pages in the final PDF
   * @param {string} organization - Organization name for footer context
   * @param {() => void} [progressCallback] - Optional callback to report progress
   * @returns {Promise<string[]>} Array of base64-encoded footer images indexed by page number
   * @description Creates temporary footer elements, captures screenshots, and cleans up DOM elements
   */
  private async createFooterImages(allowTableOfContents: boolean, organization: string, title: string, totalPages: number, progressCallback?: () => void): Promise<string[]> {
      const footerImages: string[] = [];
      
      for (let page = 0; page <= totalPages; page++) {
        const footerElement = document.createElement('div');
        const displayPage = allowTableOfContents ? page : page - 1;
        const displayTotalPages = allowTableOfContents ? totalPages : totalPages - 1;

        footerElement.innerHTML = `
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 794px;  /* Full A4 width */
          height: 40px;
          padding: 0 40px;
          background-color: #f8f8f8;
          box-sizing: border-box;
          font-family: Arial, sans-serif;
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          margin: 0 auto;  /* Centering magic */
        ">
          <div style="display: flex; gap: 8px; font-size: 10px; color: #555; align-items: center;">
            <span>${title}</span>
            <span style="color: #ccc">|</span>
            <span>${organization}</span>
            <span style="color: #ccc">|</span>
            <span>${new Date().toLocaleDateString('de-DE')}</span>
          </div>
          <div style="font-size: 10px; color: #888;">
            Page ${displayPage} of ${displayTotalPages}
          </div>
        </div>
            `;
    
        Object.assign(footerElement.style, {
          position: 'absolute',
          left: '-9999px',
          top: '-9999px',
          width: '794px',
          height: '40px',
          overflow: 'hidden'
        });
    
        document.body.appendChild(footerElement);
        
        try {
          const footerImage = await this.capturePanelScreenshot(footerElement, undefined, 2);
          footerImages.push(footerImage);
          progressCallback?.();
        } finally {
          document.body.removeChild(footerElement);
        }
      }
      
      return footerImages;
  }

  /**
   * Generates HTML content for the Table of Contents items
   * @param {Array<{panel: Element, title: string}>} validPanels - Filtered list of panels with titles
   * @param {number} totalPages - Calculated total number of pages in the report
   * @returns {string} HTML string containing the formatted Table of Contents items
   * @description Creates a hierarchical structure with special formatting for first/last items
   */
  private generateTocItems(
    validPanels: Array<{ panel: Element; title: string }>, 
    totalPages: number
  ): string {
    const sections = [
      { title: 'Cover Page', page: 1 },
      { title: 'Report Contents', page: 2 },
      ...validPanels.map((validPanel, index) => ({
        title: validPanel.title,
        page: 3 + Math.floor((index + 1) / 2)
      })),
      { title: 'Appendix', page: totalPages }
    ];
  
    return sections.map((section, idx, arr) => `
      <div style="margin: ${idx <= 1 || idx === arr.length - 1 ? '24px' : '8px'} 0; font-size: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: ${idx <= 1 || idx === arr.length - 1 ? '#0055A6' : '#444'};
                ${idx <= 1 || idx === arr.length - 1 ? 'font-weight: 600;' : ''}">
            ${section.title}
          </span>
          <div style="flex-grow: 1; border-bottom: 1px dotted #ddd; margin: 0 12px;"></div>
          <span style="color: #666; min-width: 40px; text-align: right;">
            ${section.page}
          </span>
        </div>
        ${idx > 1 && idx !== arr.length - 1 ? '<div style="border-bottom: 1px solid #eee; margin: 8px 0;"></div>' : ''}
      </div>
    `).join('');
  }
  // endregion


  /**
   * Creates a professional table from HTMLDetailsElement
   * @param details - HTMLDetailsElement containing the original table
   * @returns Configured HTMLTableElement
   */
  private createProfessionalTableFromDetails(details: HTMLDetailsElement): HTMLTableElement {
    const originalTable = details.querySelector('table');
    if (!originalTable) return document.createElement('table');

    const table = document.createElement('table');
    table.style.cssText = PROFESSIONAL_TABLE_STYLES.table;

    const thead = originalTable.querySelector('thead');
    if (thead) {
      const newThead = table.createTHead();
      const headerRow = newThead.insertRow();
      
      Array.from(thead.querySelectorAll('th')).forEach((th, index) => {
        const newTh = headerRow.insertCell();
        newTh.textContent = th.textContent;
        newTh.style.cssText = PROFESSIONAL_TABLE_STYLES.header;
        if (index === 0) {
          newTh.style.borderRadius = '4px 0 0 0';
        } else if (index === headerRow.cells.length - 1) {
          newTh.style.borderRadius = '0 4px 0 0';
        }
      });
    }

    const tbody = originalTable.querySelector('tbody');
    if (tbody) {
      const newTbody = table.createTBody();
      
      Array.from(tbody.querySelectorAll('tr')).forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('td'));
        const hasNA = cells.some(cell => cell.textContent?.includes('N/A'));
        if (hasNA) return;

        const newRow = newTbody.insertRow();
        newRow.style.cssText = rowIndex % 2 === 0 ? PROFESSIONAL_TABLE_STYLES.rowHover : '';
        
        cells.forEach((cell, cellIndex) => {
          const newCell = newRow.insertCell();
          newCell.textContent = cell.textContent;
          newCell.style.cssText = PROFESSIONAL_TABLE_STYLES.cell;
          
          newRow.addEventListener('mouseenter', () => {
            newRow.style.backgroundColor = '#f8f9fa';
          });
          newRow.addEventListener('mouseleave', () => {
            newRow.style.backgroundColor = rowIndex % 2 === 0 ? '#f8f9fa' : 'transparent';
          });
        });
      });
    }

    const container = document.createElement('div');
    container.style.overflowX = 'auto';
    container.appendChild(table);

    return table;
  }

  private replaceDetailsWithTables(element: HTMLElement) {
    element.querySelectorAll('details').forEach(details => {
      const tableContainer = this.createProfessionalTableFromDetails(details);
      const wrapper = document.createElement('div');
      
      Object.assign(wrapper.style, {
        position: 'relative',
        width: '100%',
        height: 'auto',
        minHeight: '50px',
        overflow: 'visible',
        zIndex: '9999',
        pointerEvents: 'auto',
        backgroundColor: '#ffffff'
      });
      
      wrapper.appendChild(tableContainer);
      details.replaceWith(wrapper);
    });
  }

  // region Screenshot Capture Utilities
  /**
   * Captures screenshot of a DOM element with proper cleanup
   * @param element - Element to capture
   * @param onProgress - Progress callback
   * @param scale - Rendering scale
   * @param visualizationType - Type of visualization for special handling
   * @returns Promise resolving to data URL
   */
  private async capturePanelScreenshot(
    element: Element,
    onProgress?: () => void,
    scale: number = 1.5,
    visualizationType?: string
  ): Promise<string> {
    if (!element || element === undefined || element === null) {
      console.error('Screenshot capture failed: Element is undefined or null.');
      return '';
    }
    const { default: html2canvas } = await import('html2canvas');
    const original = element as HTMLElement;
    let originalVisibility = '';
    let clonedElement: HTMLElement | null = null;
  
    try {
      const rect = original.getBoundingClientRect();
      originalVisibility = original.style.visibility;

      const hasArcElements = original.querySelectorAll('.arcs').length > 0;

      original.style.visibility = 'hidden';
  
      clonedElement = original.cloneNode(true) as HTMLElement;
      
      const originalCanvases = original.querySelectorAll('canvas');
      const clonedCanvases = clonedElement.querySelectorAll('canvas');
      originalCanvases.forEach((originalCanvas, index) => {
        const clonedCanvas = clonedCanvases[index];
        if (!clonedCanvas) return;
        
        clonedCanvas.width = originalCanvas.width;
        clonedCanvas.height = originalCanvas.height;
        const ctx = clonedCanvas.getContext('2d');
        if (originalCanvas) {
          ctx?.drawImage(originalCanvas, 0, 0);
        }
      });
  
      const isTimeSeriesChart = !!clonedElement.querySelector('.tvbVisTimeSeries');
      const hasMetrics = !!clonedElement.querySelector(
        '.tvbVis[style*="background-color: rgb(226, 0, 116)"], ' +
        '.tvbVis[style*="background-color: rgb(255, 154, 30)"], ' +
        '.tvbVis[style*="background-color: rgb(255, 211, 41)"], ' +
        '.tvbVis[style*="background-color: rgb(27, 173, 162)"]'
      );  
      this.preProcessHTMLObject(clonedElement, visualizationType);

      Object.assign(clonedElement.style, {
        position: 'fixed',
        left: '-9999px',
        top: '0',
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        visibility: 'visible',
        zIndex: '-1',
        contain: 'strict',
        pointerEvents: 'none'
      });
  
      document.body.appendChild(clonedElement);
      await new Promise(resolve => setTimeout(resolve, 500));
  
      this.hideUnwantedElements(clonedElement);
  
      let canvas;
      if (hasArcElements) {

        clonedElement = original.cloneNode(true) as HTMLElement;
        this.replaceDetailsWithTables(clonedElement);
        
        clonedElement.querySelectorAll('[data-test-embeddable-id] figcaption.embPanel__header').forEach(el => {
          el.remove();
        });

        document.body.appendChild(clonedElement);
        
        try {
          Object.assign(clonedElement.style, {
            position: 'fixed',
            left: '-9999px',
            top: '0',
            width: `${rect.width}px`,
            height: 'auto',
            minHeight: '50px',
            visibility: 'visible',
            zIndex: '9999',
            contain: 'none',
            pointerEvents: 'auto',
            backgroundColor: '#ffffff'
          });

          canvas = await html2canvas(clonedElement, {
          useCORS: true,
          scale: 2,
          logging: true,
          backgroundColor: null,
          allowTaint: true,
          onclone: (clonedDocument, clonedElement) => {
              element.querySelectorAll('.sibling-container details').forEach(details => {
                details.replaceWith(this.createProfessionalTableFromDetails(details as HTMLDetailsElement));
              });
              clonedDocument.body.offsetHeight;
            },
          foreignObjectRendering: false
          });
        } finally {
          document.body.removeChild(clonedElement);
          original.style.visibility = 'hidden';
        }
      } else if (isTimeSeriesChart) {
        canvas = await html2canvas(clonedElement, {
          useCORS: true,
          scale: 1.5,
          logging: false,
          backgroundColor: '#ffffff',
          windowWidth: document.documentElement.scrollWidth,
          windowHeight: document.documentElement.scrollHeight
        });
      } else if (hasMetrics) {
        canvas = await html2canvas(clonedElement, {
          useCORS: true,
          scale: scale,
          logging: true,
          backgroundColor: '#ffffff',
          ignoreElements: (el) => {
            return el.classList.contains('brush') || 
                   el.classList.contains('echHighlighter');
          },
          onclone: (doc, element) => {
            element.querySelectorAll('.tvbVisMetric__inner').forEach(el => {
              const style = window.getComputedStyle(el);
              (el as HTMLElement).style.transform = style.transform;
            });
            element.querySelectorAll('.echLegendItem').forEach(item => {
              (item as HTMLElement).style.opacity = '1';
            });
          }
        });
      } else {
        canvas = await html2canvas(clonedElement, {
          useCORS: true,
          scale: scale,
          logging: false,
          backgroundColor: '#ffffff',
          windowWidth: document.documentElement.scrollWidth,
          windowHeight: document.documentElement.scrollHeight
        });
  
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 240 && data[i+1] > 240 && data[i+2] > 240) {
              data[i] = data[i+1] = data[i+2] = 255;
            }
          }
          ctx.putImageData(imageData, 0, 0);
        }
      }
  
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      throw error;
    } finally {
      this.cleanupCaptureElements(clonedElement, original, originalVisibility);
      onProgress?.();
    }
  }

  /**
   * Cleans up temporary capture elements
   */
  private cleanupCaptureElements(
    clonedElement: HTMLElement | null,
    original: HTMLElement,
    originalVisibility: string
  ): void {
    if (clonedElement?.parentElement) {
      document.body.removeChild(clonedElement);
    }
    original.style.visibility = originalVisibility;
  }
  // endregion

  // region DOM Processing Utilities
  /**
   * Removes or hides unwanted elements from a DOM subtree
   * @param {HTMLElement} context - Root element to clean up
   * @description Performs three main operations:
   * 1. Sets chart backgrounds to white
   * 2. Removes specific UI elements (headers, pagination, legends)
   * 3. Hides temporary expansion buttons
   * 4. Sets up MutationObserver to handle dynamic content
   * @example
   * // Removes all .euiPagination elements under dashboard element
   * hideUnwantedElements(dashboardContainer);
   */
  private hideUnwantedElements(context: HTMLElement) {
      const hideElements = (selector: string) => {
      context.querySelectorAll(selector).forEach(el => {
        (el as HTMLElement).style.display = 'none';
      });
    };
  
    const deleteElements = (selector: string) => {
      context.querySelectorAll(selector).forEach(el => {
        el.parentNode?.removeChild(el);
      });
    };

    const setElementStyle = (selector: string, styles: Record<string, string>) => {
      context.querySelectorAll(selector).forEach(el => {
        Object.assign((el as HTMLElement).style, styles);
      });
    };

    setElementStyle('.echChartBackground', {
      backgroundColor: '#ffffff',
      backgroundImage: 'none'
    });
  
    deleteElements('[data-test-embeddable-id] figcaption.embPanel__header');
    deleteElements('.sibling-container');
    deleteElements('.euiPagination');
    deleteElements('#dataTableExportData');
    deleteElements('.visLib__legend');
  
    hideElements('.euiDataGridRowCell__expandButton');
  
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node instanceof HTMLElement) {
            const selectorsToRemove = [
              '.euiPagination',
              '.euiDataGridRowCell__expandButton',
              '[data-test-embeddable-id] figcaption.embPanel__header',
              '.sibling-container',
              '#dataTableExportData',
              '.visLib__legend'
            ];
            
            selectorsToRemove.forEach(selector => {
              node.querySelectorAll(selector).forEach(el => el.remove());
            });
          }
        });
      });
    });
  
    observer.observe(context, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Applies type-specific preprocessing to HTML elements before capture
   * @param {HTMLElement} element - Target element to modify
   * @param {string} [visualizationType] - Type of visualization for special handling
   * @description Handles four specific cases:
   * - TableOfContents: Improves typography and separator styling
   * - Header: Centralizes time picker buttons and removes redundant text
   * - DashboardTitle: Applies large title formatting
   * - Visualization: Constrains dimensions for PDF layout
   * @example
   * // Applies dashboard title styles to header element
   * preProcessHTMLObject(titleElement, 'DashboardTitle');
   */
  private preProcessHTMLObject(
    element: HTMLElement,
    visualizationType?: string,
  ) {
    if (visualizationType === 'TableOfContents') {
      element.style.fontFamily = "'Helvetica Neue', Arial, sans-serif";
      element.querySelectorAll('h1').forEach(heading => {
        heading.style.fontWeight = '600';
        heading.style.letterSpacing = '-0.5px';
      });
      
      element.querySelectorAll('div[style*="dotted"]').forEach(line => {
        (line as HTMLElement).style.borderBottom = '2px dotted #0055A6';
        (line as HTMLElement).style.margin = '0 15px';
      });
      return;
    }
  
    if (visualizationType === 'Header') {
      const buttons = element.querySelectorAll('button.euiSuperDatePicker__prettyFormat');
      buttons.forEach(button => {
        (button as HTMLElement).style.cssText = `
          display: flex !important;
          justify-content: center !important;
          align-items: center !important;
          text-align: center !important;
          width: 100% !important;
        `;
        
        button.querySelectorAll('span.euiSuperDatePicker__prettyFormatLink').forEach(span => {
          if (span.textContent?.trim().toLowerCase() === 'show dates') {
            span.remove();
          }
        });
      });
  
      element.style.cssText = `
        overflow: visible !important;
        white-space: nowrap !important;
        text-align: center !important;
        display: flex !important;
        justify-content: center !important;
      `;
      return;
    }
  
    if (visualizationType === 'DashboardTitle') {
      element.style.cssText = `
        font-size: 108px !important;
        font-weight: 900 !important;
        text-align: center !important;
        padding: 40px 0 !important;
        z-index: -1 !important;
      `;
      return;
    }
  
    if (visualizationType === 'Visualization') {
      const styleRules = [
        'max-height: 300pt !important',
        'height: 300pt !important',
        'width: 100% !important',
        'margin: 0 auto !important'
      ];
      element.style.cssText = styleRules.join('; ');
    }
  }
  // endregion
}