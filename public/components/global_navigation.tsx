import React from 'react';
import { CoreStart } from '../../../../src/core/public';
import { ReportsDataAnalyzerButton } from './reports_data_analyzer_button';
import { render, unmountComponentAtNode } from 'react-dom';

export const registerGlobalNavigation = async (coreStart: CoreStart) => {
  try {
    coreStart.chrome.navControls.registerCenter({
      mount: (element) => {
        render(<ReportsDataAnalyzerButton coreStart={coreStart} />, element);
        return () => unmountComponentAtNode(element);
      },
    });
  } catch (error) {
    console.error('Failed to register global navigation:', error);
  }
};