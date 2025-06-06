import React, { useEffect, useState } from 'react';
import {
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem,
  EuiHeaderSectionItem,
} from '@elastic/eui';
import { CoreStart } from 'src/core/public';
import { PLUGIN_ID } from '../../common/index';

interface ReportsDataAnalyzerButtonProps {
  coreStart: CoreStart;
}

export const ReportsDataAnalyzerButton: React.FC<ReportsDataAnalyzerButtonProps> = ({ coreStart }) => {
  const handleNavigation = () => {
    coreStart.application.navigateToApp(PLUGIN_ID.toLocaleLowerCase());
  };

  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  

  useEffect(() => {
    const fetchAuthorization = async () => {
      try {
        const response = await coreStart.http.get<{ roles: string[] }>('/api/canvas_report_data_analyzer/user_roles');
        setIsAuthorized(response.roles.includes('canvas_reporting'));
      } catch (error) {
        console.error("Failed to fetch role:", error);
        setIsAuthorized(false);
      }
    };
  
    fetchAuthorization();
  }, [coreStart.http]);

  return (
    <EuiHeaderSectionItem>
      <EuiFlexGroup
        direction="row"
        gutterSize="s"
        alignItems="center"
        justifyContent="flexStart"
        responsive={false}
        style={{ flexWrap: 'nowrap' }}
      >
        <EuiFlexItem
          grow={true}
          style={{
            padding: '0 8px',
          }}
        >
          { isAuthorized && (
            <EuiButton
              onClick={handleNavigation}
              size="s"
              iconType="reportingApp"
              iconSide="left"
              aria-label='Click here to go to the reports and data analysis views'
            >
              Reports and Data Analysis
            </EuiButton>
          )}
          { !isAuthorized && (
          <EuiButton
            onClick={handleNavigation}
            size="s"
            iconType="reportingApp"
            iconSide="left"
            aria-label='Click here to go to the data analysis views'
          >
            Data Analysis
          </EuiButton>
          )}
        </EuiFlexItem>
      </EuiFlexGroup>
    </EuiHeaderSectionItem>
  );
};