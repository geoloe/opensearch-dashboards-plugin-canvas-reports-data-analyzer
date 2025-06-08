import React, { useState, useEffect } from 'react';
import { EuiButton, EuiModal, EuiOverlayMask, EuiProgress, EuiText, EuiFlexItem, EuiSpacer } from '@elastic/eui';
import { ReportingService } from '../services/reporting';
import { AssetService } from '../services/fetch_assets';
import { HttpSetup } from '../../../../src/core/public';
import { Cycle, InterfaceFileClipboardCheckCheckmarkEditTaskEditionChecklistCheckSuccessClipboardForm, Warningsign } from '../assets/assets';
import { TextPositions } from '../types';

interface GeneratePdfReportsButtonProps {
  reportingService: ReportingService;
  disabled: boolean;
  assetService?: AssetService;
  http: HttpSetup
}

interface ModalState {
  isVisible: boolean;
  message: string;
  type: 'loading' | 'error' | 'success';
  progress: number;
}

export const GeneratePdfReportsButton: React.FC<GeneratePdfReportsButtonProps> = ({ reportingService, disabled, assetService, http }) => {
  
  const [modalState, setModalState] = useState<ModalState>({
    isVisible: false,
    message: '',
    type: 'loading',
    progress: 0,
  });

  const [organization, setOrganization] = useState<string>("Your Organization");
  const [allowTableOfContents, setAllowTableOfContents] = useState<boolean>(true);
  const [textPositions, setTextPositions] = useState<TextPositions>({
    tenant_name: { x: 22, y: 140, size: 42 },
    dashboard_name: { x: 22, y: 120, size: 28 },
    timestamp: { x: 22, y: 55, size: 28 }
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const configResponse = await http.get('/api/canvas_report_data_analyzer/config');
        
        setOrganization(configResponse.organization || "Your Organization");
        
        setAllowTableOfContents(configResponse.allow_table_of_contents);
        
        setTextPositions({
          tenant_name: configResponse.text_positions_and_sizes?.tenant_name || { x: 22, y: 140, size: 42 },
          dashboard_name: configResponse.text_positions_and_sizes?.dashboard_name || { x: 22, y: 120, size: 28 },
          timestamp: configResponse.text_positions_and_sizes?.timestamp || { x: 22, y: 55, size: 28 }
        });
        
      } catch (error) {
        console.error("Failed to fetch configuration:", error);
        setAllowTableOfContents(true);
        setOrganization("Your Organization");
        setTextPositions({
          tenant_name: { x: 22, y: 140, size: 42 },
          dashboard_name: { x: 22, y: 120, size: 28 },
          timestamp: { x: 22, y: 55, size: 28 }
        });
      }
    };

    fetchConfig();
  }, [http]);

  useEffect(() => {
    reportingService.setModalHandlers({
      showModal: (message, type, progress = 0) => 
        setModalState(s => ({ ...s, isVisible: true, message, type, progress })),
      hideModal: () => setModalState(s => ({ ...s, isVisible: false }))
    });
  }, [reportingService]);

  const handleGenerateReport = async () => {
    setModalState({ isVisible: true, message: 'Initializing...', type: 'loading', progress: 0});
    try {
      if (!assetService) {
        throw new Error('AssetService is required to generate PDF reports.');
      }
      await reportingService.generatePdfReport(textPositions, allowTableOfContents, assetService, organization);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      setModalState({ isVisible: true, message: errorMessage, type: 'error', progress: 0});
    }
  };

  return (
    <>
      <EuiFlexItem
          grow={true}
          style={{
            padding: '0 8px',
          }}
        >
        <EuiButton 
          onClick={handleGenerateReport}
          disabled={disabled}
          title={disabled ? "You don't have permission to generate reports" : ""}
          iconType="document"
          aria-label='Click here to generate PDF Report'
          fill
          size='s'
        >
          Generate PDF Report
        </EuiButton>
      </EuiFlexItem>

      {modalState.isVisible && (
        <EuiOverlayMask>
          <EuiModal
            className="report-generation-modal"
            style={{ 
              width: 400, 
              padding: 24, 
              zIndex: 100000,
              position: 'relative' 
            }}
            onClose={() => setModalState(s => ({ ...s, isVisible: false }))}
          >
          <EuiText textAlign="center">
            <h2 style={{ marginBottom: 16 }}>
              {modalState.type === 'success' ? (
                InterfaceFileClipboardCheckCheckmarkEditTaskEditionChecklistCheckSuccessClipboardForm
                ({ width: 48, height: 48, style: { display: 'block', margin: '0 auto' } })
              ) : modalState.type === 'error' ? (
                Warningsign({ width: 48, height: 48, style: { display: 'block', margin: '0 auto' } })
              ) : (
                Cycle({ width: 48, height: 48, style: { display: 'block', margin: '0 auto' } })
              )}
            </h2>
              <p style={{ whiteSpace: 'pre-line' }}>
              {modalState.message}
              {modalState.type === 'loading' && (
                <>
                <div style={{ margin: '16px 0' }}>
                  <EuiSpacer size="s" />
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(1, 1fr)',
                    gap: 8,
                    fontSize: '0.85em'
                  }}>
                    <div>Progress</div>
                    <div>{modalState.progress.toFixed(2)}%</div>
                  </div>
                </div>
                <EuiProgress 
                  size="l"
                  color="#0055A6"
                  value={modalState.progress}
                  max={100}
                />
              </>
              )}
            </p>
          </EuiText>
        </EuiModal>
      </EuiOverlayMask>
    )}
  </>
  );
};