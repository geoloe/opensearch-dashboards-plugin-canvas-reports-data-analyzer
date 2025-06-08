import React, { useEffect, useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { CoreStart } from '../../../src/core/public';
import { AssetService } from './services/fetch_assets';
import {
  EuiBasicTable,
  EuiLink,
  EuiPage,
  EuiPageBody,
  EuiPageContent,
  EuiTitle,
  EuiSpacer,
  EuiFieldSearch,
  EuiButtonIcon,
  EuiTabbedContent,
  EuiText,
  EuiBadge,
  EuiCallOut,
  EuiLoadingSpinner,
  EuiFlexGroup,
  EuiFlexItem,
  EuiModal,
  EuiModalBody,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiModalFooter,
  EuiButton,
  EuiButtonEmpty,
  EuiForm,
  EuiFormRow,
  EuiFieldText,
  EuiTextArea,
  EuiPanel,
  EuiAccordion,
  EuiPopover,
  EuiContextMenu
} from '@elastic/eui';
import { DataAnalysis } from './components/data_analysis';
import { usePluginContext, PluginProvider } from './components/plugin_context'

interface Report {
  fileId: string;
  name: string;
  creationTime: string;
}

export const renderApp = (
  coreStart: CoreStart,
  depsStart: any,
  { element }: { element: HTMLElement }
) => {
  const assetService = new AssetService(coreStart.http);
  const CanvasReportDataAnalyzerApp = () => {
    const [reports, setReports] = useState<Report[]>([]);
    const [filteredReports, setFilteredReports] = useState<Report[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [pageIndex, setPageIndex] = useState(0);
    const [pageSize, setPageSize] = useState(10);
    const [sortField, setSortField] = useState<keyof Report>('creationTime');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [config, setConfig] = useState<{ report_directory?: string, organization?: string }>({});
    const [organization, setOrganization] = useState<string>("Your Organization");
    const [latestReportTime, setLatestReportTime] = useState<string | null>(null);
    const [selectedTimeFilter, setSelectedTimeFilter] = useState<string>('week');
    const [accessLevel, setAccessLevel] = useState<'none' | 'view' | 'full'>('none');
    const [accessError, setAccessError] = useState<string | null>(null);
    const [tenantName, setTenantName] = useState<string>('');
    const [hasReportRole, setHasReportRole] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
      isVisible: boolean;
      report?: Report;
    }>({ isVisible: false });
    const [emailModal, setEmailModal] = useState<{
      isVisible: boolean;
      report?: Report;
    }>({ isVisible: false });
    const [emailRecipients, setEmailRecipients] = useState<string>('');
    const [emailSubject, setEmailSubject] = useState<string>('');
    const [emailBody, setEmailBody] = useState<string>('');
    const [emailErrors, setEmailErrors] = useState<Record<string, string>>({});
    const [isSending, setIsSending] = useState<boolean>(false);
    const [nextEmailTime, setNextEmailTime] = useState<string | null>(null);
    const [username, setUsername] = useState<string>('');
    const [activeMainTab, setActiveMainTab] = useState<'reports' | 'query'>('reports');
    const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
    const [actionsMenuReport, setActionsMenuReport] = useState<Report | null>(null);


    useEffect(() => {
      const fetchOrganization = async () => {
        try {
          const configResponse = await coreStart.http.get('/api/canvas_report_data_analyzer/config');
          setOrganization(configResponse.organization || "Your Organization");
        } catch (error) {
          console.error("Failed to fetch organization:", error);
          setOrganization("Your Organization"); // Fallback
        }
      };

      fetchOrganization();
    }, [coreStart.http]);

    const isValidEmail = (email: string): boolean => {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    };

    const validateEmailForm = (): boolean => {
      const errors: Record<string, string> = {};
      
      if (!emailRecipients.trim()) {
        errors.recipients = 'Recipients are required';
      } else {
        const emails = emailRecipients.split(',').map(e => e.trim()).filter(Boolean);
        
        if (emails.length === 0) {
          errors.recipients = 'At least one valid email is required';
        } else {
          for (const email of emails) {
            if (!isValidEmail(email)) {
              errors.recipients = `Invalid email format: ${email}`;
              break;
            }
          }
        }
      }
      
      if (!emailSubject.trim()) {
        errors.subject = 'Subject is required';
      }
      
      if (!emailBody.trim()) {
        errors.body = 'Email body is required';
      }
      
      setEmailErrors(errors);
      return Object.keys(errors).length === 0;
    };

    const handleEmailClick = (report: Report) => {
      if (nextEmailTime) {
        const nextTime = new Date(nextEmailTime);
        if (nextTime > new Date()) {
          coreStart.notifications.toasts.addWarning({
            title: 'Email sending limited',
            text: `You can send another email after ${nextTime.toLocaleString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            })}`
          });
          return;
        } else {
          setNextEmailTime(null);
        }
      }
      
      setEmailModal({ isVisible: true, report });
      setEmailSubject(`Report: ${report.name}`);
      setEmailRecipients('');
      setEmailBody(`Please find the attached report from ${organization}.`);
    };

    const closeEmailModal = () => {
      setEmailModal({ isVisible: false });
      setEmailErrors({});
    };

    const sendEmail = async () => {
      if (!validateEmailForm() || !emailModal.report) return;
      
      setIsSending(true);
      
      try {
        const response = await coreStart.http.post(`/api/canvas_report_data_analyzer/send_email/${emailModal.report.fileId}`, {
          body: JSON.stringify({
            recipients: emailRecipients,
            subject: emailSubject,
            body: emailBody,
            organization: organization
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (response.nextAvailable && username) {
          const rateLimitData = {
            expires: response.nextAvailable,
            setAt: new Date().toISOString()
          };
          
          localStorage.setItem(
            `emailRateLimit-${username}`, 
            JSON.stringify(rateLimitData)
          );
          
          setNextEmailTime(response.nextAvailable);
        }
        
        coreStart.notifications.toasts.addSuccess({
          title: 'Email sent',
          text: `Report sent to ${emailRecipients}`,
        });
        
        closeEmailModal();
      } catch (error) {
        if (error instanceof Error && error.message.includes('rate limited')) {
          const match = error.message.match(/after (.+)$/);
          if (match && match[1] && username) {
            const nextAvailable = new Date(match[1]).toISOString();
            
            const rateLimitData = {
              expires: nextAvailable,
              setAt: new Date().toISOString()
            };
            
            localStorage.setItem(
              `emailRateLimit-${username}`, 
              JSON.stringify(rateLimitData)
            );
            
            setNextEmailTime(nextAvailable);
          }
          
          coreStart.notifications.toasts.addWarning({
            title: 'Email sending limited',
            text: error.message
          });
        } else {
          coreStart.notifications.toasts.addDanger({
            title: 'Email failed',
            text: `Failed to send email: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      } finally {
        setIsSending(false);
      }
    };

    const handleDeleteClick = (report: Report) => {
      setDeleteConfirmModal({ isVisible: true, report });
    };

    const closeDeleteModal = () => {
      setDeleteConfirmModal({ isVisible: false });
    };

    const confirmDelete = async () => {
      if (!deleteConfirmModal.report) return;
      
      setIsDeleting(true);
      
      try {
        await coreStart.http.delete(`/api/canvas_report_data_analyzer/delete/${deleteConfirmModal.report.fileId}`);
        
        const updatedReports = reports.filter(r => r.fileId !== deleteConfirmModal.report?.fileId);
        setReports(updatedReports);
        
        coreStart.notifications.toasts.addSuccess({
          title: 'Report deleted',
          text: `${deleteConfirmModal.report.name} was successfully removed`,
        });
      } catch (error) {
        coreStart.notifications.toasts.addDanger({
          title: 'Delete failed',
          text: `Could not delete report: ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        setIsDeleting(false);
        closeDeleteModal();
      }
    };

    const timeFilters = useMemo(() => [
      { id: 'all', name: 'All Reports', threshold: 0 },
      { id: 'week', name: 'Last 1 week', threshold: 7 },
      { id: 'month', name: 'Last 1 month', threshold: 30 },
      { id: 'sixMonths', name: 'Last 6 months', threshold: 180 }
    ], []);

    const fetchTenantAndUser = async () => {
      try {
        const response = await coreStart.http.get<{ 
          tenant: string, 
          username: string
        }>('/api/canvas_report_data_analyzer/tenant');
        
        setTenantName(response.tenant || '');
        setUsername(response.username || '');
        return response;
      } catch (error) {
        console.error('Error fetching tenant info:', error);
        setAccessError('Failed to fetch tenant information');
        return { tenant: '', username: '' };
      }
    };

    const checkTenantAccess = async () => {
      try {
        const currentTenant = await fetchTenantAndUser();
        if (!currentTenant) {
          setAccessLevel('none');
          setAccessError('Tenant information not available');
          return 'none';
        }

        const [customRolesResponse] = await Promise.all([
          coreStart.http.get<{ roles: string[] }>('/api/canvas_report_data_analyzer/user_roles')
        ]);
        
        const customRoles = customRolesResponse.roles || [];

        const hasReportRole = customRoles.includes('canvas_reporting');
        setHasReportRole(hasReportRole);

        const hasPrivateorGlobalMatch = currentTenant.tenant.toLowerCase() === '__user__' || currentTenant.tenant.toLowerCase() === '';      

        let access: 'none' | 'view' | 'full' = 'none';

        if (hasPrivateorGlobalMatch) {
          setTenantName('Private or Global');
          access = 'view';
        } 
        else if (!hasReportRole) {
          access = 'none';
          setAccessError(`You have currently no access to reports.`);
        }
        else {
          access = 'full';
        }
        
        setAccessLevel(access);
        return access;
      } catch (error) {
        console.error('Error checking backend roles:', error);
        setAccessError('Failed to verify access permissions');
        setAccessLevel('none');
        return 'none';
      }
    };

    useEffect(() => {
      const initialize = async () => {
        setIsLoading(true);
        try {
          const accessLevel = await checkTenantAccess();
          const configResponse = await coreStart.http.get('/api/canvas_report_data_analyzer/config');
          setConfig({
            report_directory: configResponse.report_directory,
            organization: configResponse.organization
          });
          
          if (accessLevel !== 'none') {
            const reportsResponse = await coreStart.http.get<{ reports: Report[] }>('/api/canvas_report_data_analyzer/reports');
            const fetchedReports = reportsResponse.reports || [];
            
            const sortedReports = [...fetchedReports].sort((a, b) =>
              new Date(b.creationTime).getTime() - new Date(a.creationTime).getTime()
            );
            
            if (sortedReports.length > 0) {
              setLatestReportTime(sortedReports[0].creationTime);
            } else {
              setLatestReportTime(null);
            }
            
            setReports(sortedReports);
          }
        } catch (error) {
          console.error('Initialization error:', error);
          setAccessError('Failed to load reports data');
        } finally {
          setIsLoading(false);
        }
      };
      
      initialize();
    }, []);

    useEffect(() => {
      if (!username) return;
      
      const storedLimit = localStorage.getItem(`emailRateLimit-${username}`);
      if (storedLimit) {
        const { expires } = JSON.parse(storedLimit);
        if (new Date(expires) > new Date()) {
          setNextEmailTime(expires);
        } else {
          localStorage.removeItem(`emailRateLimit-${username}`);
        }
      }
    }, [username]);

    useEffect(() => {
      if (accessLevel === 'none') return;
      
      const now = new Date();
      const selectedFilter = timeFilters.find(f => f.id === selectedTimeFilter);
      
      let timeFilteredReports = reports;
      
      if (selectedFilter && selectedFilter.threshold > 0) {
        const thresholdDate = new Date();
        thresholdDate.setDate(now.getDate() - selectedFilter.threshold);
        
        timeFilteredReports = reports.filter(report => {
          const reportDate = new Date(report.creationTime);
          return reportDate >= thresholdDate;
        });
      }

      const lowerCaseQuery = searchQuery.toLowerCase();
      const searchFiltered = timeFilteredReports.filter(report => 
        report.name.toLowerCase().includes(lowerCaseQuery)
      );

      const sorted = [...searchFiltered].sort((a, b) => {
        const aValue = a[sortField];
        const bValue = b[sortField];

        if (aValue === undefined || bValue === undefined) return 0;
        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });

      setFilteredReports(sorted);
      setPageIndex(0);
    }, [searchQuery, reports, sortField, sortDirection, selectedTimeFilter, timeFilters, accessLevel]);

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    };

    const handleTableChange = ({ page, sort }: { page?: any; sort?: any }) => {
      if (page) {
        setPageIndex(page.index);
        setPageSize(page.size);
      }

      if (sort) {
        setSortField(sort.field);
        setSortDirection(sort.direction);
      }
    };

    const handleDownload = async (fileId: string, fileName: string) => {
      try {
        const url = `/api/canvas_report_data_analyzer/download/${fileId}`;
        const response = await fetch(url);
        
        if (!response.ok) throw new Error('Download failed');
        
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        link.href = downloadUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (error) {
        console.error('Download error:', error);
      }
    };

    const getReportActions = (report: Report) => [
      {
        name: 'Email',
        icon: 'email',
        onClick: () => {
          setIsActionsMenuOpen(false);
          handleEmailClick(report);
        },
        disabled: !(accessLevel === 'view' || accessLevel === 'full'),
      },
      {
        name: 'Delete',
        icon: 'trash',
        onClick: () => {
          setIsActionsMenuOpen(false);
          handleDeleteClick(report);
        },
        disabled: !(accessLevel === 'full' && !isDeleting),
      },
      {
        name: 'Download',
        icon: 'download',
        onClick: () => {
          setIsActionsMenuOpen(false);
          handleDownload(report.fileId, report.name);
        },
      }
    ];

    const columns = [
      {
        field: 'name',
        name: 'Report Name',
        sortable: true,
        render: (name: string, report: Report) => (
          <div>
            <EuiLink onClick={() => handleDownload(report.fileId, name)}>
              {name}
            </EuiLink>
            {latestReportTime === report.creationTime && (
              <EuiBadge color="primary" style={{ marginLeft: '8px' }}>Latest</EuiBadge>
            )}
          </div>
        ),
      },
      {
        field: 'creationTime',
        name: 'Creation Time',
        sortable: true,
        render: (time: string) => {
          const parsedDate = new Date(time);
          return isNaN(parsedDate.getTime()) ? 'N/A' : parsedDate.toLocaleString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          });
        },
      },
      {
        name: 'Actions',
        render: (report: Report) => (
            <EuiPopover
            button={
              <EuiButtonIcon
              iconType="boxesHorizontal"
              aria-label="Actions"
              onClick={() => {
                if (isActionsMenuOpen && actionsMenuReport?.fileId === report.fileId) {
                setIsActionsMenuOpen(false);
                setActionsMenuReport(null);
                } else {
                setActionsMenuReport(report);
                setIsActionsMenuOpen(true);
                }
              }}
              />
            }
            isOpen={isActionsMenuOpen && actionsMenuReport?.fileId === report.fileId}
            closePopover={() => setIsActionsMenuOpen(false)}
            anchorPosition="downCenter"
            >
            <EuiContextMenu
              initialPanelId="mainMenu"
              onClick={() => setIsActionsMenuOpen(false)}
              panels={[
              {
                id: 'mainMenu',
                title: 'Actions',
                items: getReportActions(report),
              },
              ]}
            />
            </EuiPopover>
        ),
      }
    ];

    const paginatedReports = filteredReports.slice(
      pageIndex * pageSize,
      (pageIndex + 1) * pageSize
    );

    const tabs = timeFilters.map(filter => ({
      id: filter.id,
      name: filter.name,
      content: (
        <>
          <EuiSpacer size="m" />
          <EuiBasicTable<Report>
            items={paginatedReports}
            columns={columns}
            pagination={{
              pageIndex,
              pageSize,
              totalItemCount: filteredReports.length,
              pageSizeOptions: [5, 10, 20, 50],
            }}
            sorting={{
              sort: { field: sortField, direction: sortDirection },
            }}
            onChange={handleTableChange}
          />
        </>
      )
    }));

    const renderDeleteModal = () => {
      if (!deleteConfirmModal.isVisible || !deleteConfirmModal.report) return null;

      return (
        <EuiModal onClose={closeDeleteModal}>
          <EuiModalHeader>
            <EuiModalHeaderTitle>Confirm Deletion</EuiModalHeaderTitle>
          </EuiModalHeader>

          <EuiModalBody>
            <EuiText>
              <p>
                Are you sure you want to permanently delete this report? 
                This action cannot be undone.
              </p>
              <EuiAccordion
                id="reportDetailsAccordion"
                buttonContent="Report details"
                paddingSize="s"
              >
                <div style={{ padding: 16, background: '#f8f9fc' }}>
                  <p><strong>Report:</strong> {deleteConfirmModal.report.name}</p>
                  <p><strong>Created:</strong> {new Date(deleteConfirmModal.report.creationTime).toLocaleString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  })}</p>
                </div>
              </EuiAccordion>
            </EuiText>
          </EuiModalBody>

          <EuiModalFooter>
            <EuiButtonEmpty onClick={closeDeleteModal}>Cancel</EuiButtonEmpty>
            <EuiButton 
              onClick={confirmDelete} 
              fill 
              color="danger"
              isLoading={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete Report'}
            </EuiButton>
          </EuiModalFooter>
        </EuiModal>
      );
    };

    const useLogo = () => {
      const [logoUri, setLogoUri] = useState<string>('');
      const { assetService } = usePluginContext();

      useEffect(() => {
        const fetchLogo = async () => {
          try {
            const logoBase64 = await assetService.getLogo();
            setLogoUri(`data:image/png;base64,${logoBase64}`);
          } catch (error) {
            console.error('Failed to load logo:', error);
            setLogoUri('');
          }
        };

        fetchLogo();
      }, [assetService]);

      return logoUri;
    };

    const logoUri = useLogo();
    const renderEmailModal = () => {
      if (!emailModal.isVisible || !emailModal.report) return null;
      
      // Check if user is rate limited
      const isRateLimited = nextEmailTime && new Date(nextEmailTime) > new Date();

      return (
        <EuiModal onClose={closeEmailModal} style={{ maxWidth: 800 }}>
          <EuiModalHeader>
            <EuiModalHeaderTitle>Email Report</EuiModalHeaderTitle>
          </EuiModalHeader>

          <EuiModalBody>
            {isRateLimited ? (
              <EuiCallOut 
                title="Email sending is currently limited" 
                color="warning" 
                iconType="clock"
              >
                <p>
                  You can send another email after {new Date(nextEmailTime!).toLocaleString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  })}
                </p>
                <EuiSpacer />
                <p>
                  This limit helps prevent email abuse and ensures system stability.
                </p>
              </EuiCallOut>
            ) : (
              <>
                <EuiText>
                  <h3>Sending: {emailModal.report.name}</h3>
                  <p>Created: {new Date(emailModal.report.creationTime).toLocaleString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  })}
                  </p>
                </EuiText>
                <EuiSpacer size="l" />
                
                <EuiForm>
                  <EuiFormRow
                    label="Recipients"
                    helpText="Enter email addresses separated by commas"
                    isInvalid={!!emailErrors.recipients}
                    error={emailErrors.recipients}
                    fullWidth
                  >
                    <EuiFieldText
                      placeholder="recipient1@example.com, recipient2@example.com"
                      value={emailRecipients}
                      onChange={(e) => setEmailRecipients(e.target.value)}
                      isInvalid={!!emailErrors.recipients}
                      fullWidth
                    />
                  </EuiFormRow>

                  <EuiSpacer size="m" />

                  <EuiFormRow
                    label="Subject"
                    isInvalid={!!emailErrors.subject}
                    error={emailErrors.subject}
                    fullWidth
                  >
                    <EuiFieldText
                      placeholder="Email subject"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      isInvalid={!!emailErrors.subject}
                      fullWidth
                    />
                  </EuiFormRow>

                  <EuiSpacer size="m" />

                  <EuiFormRow
                    label="Message"
                    helpText="This will appear as the note in the email"
                    isInvalid={!!emailErrors.body}
                    error={emailErrors.body}
                    fullWidth
                  >
                    <EuiTextArea
                      placeholder="Add a note for the recipients..."
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      isInvalid={!!emailErrors.body}
                      fullWidth
                      rows={5}
                    />
                  </EuiFormRow>

                  <EuiSpacer size="m" />
                  
                  <EuiCallOut
                    title="Email Preview"
                    iconType="eye"
                    color="primary"
                  >
                    <div style={{ 
                      backgroundColor: '#f6f6f6', 
                      padding: '20px', 
                      borderRadius: '6px',
                      border: '1px solid #D3DAE6',
                      maxHeight: '500px',
                      overflowY: 'auto',
                      minHeight: '200px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {logoUri ? (
                        <div dangerouslySetInnerHTML={{ 
                          __html: emailTemplate
                            .replace('%%LOGO_URI%%', logoUri || 'No logo provided')
                            .replace('%%REPORT_TITLE%%', emailSubject || 'No subject provided')
                            .replace('%%NOTE%%', emailBody || 'No note provided')
                            .replace('%%AUTHURL%%', window.location.origin)
                            .replace('%%ORGANIZATION%%', config.organization || 'Your Organization')
                        }} />
                      ) : (
                        <EuiFlexGroup justifyContent="center" alignItems="center">
                          <EuiFlexItem grow={false}>
                            <EuiLoadingSpinner size="m" />
                            <EuiSpacer size="s" />
                            <EuiText textAlign="center">
                              <small>Loading company logo...</small>
                            </EuiText>
                          </EuiFlexItem>
                        </EuiFlexGroup>
                      )}
                    </div>
                  </EuiCallOut>
                </EuiForm>
              </>
            )}
          </EuiModalBody>

          <EuiModalFooter>
            <EuiButtonEmpty onClick={closeEmailModal} isDisabled={isSending}>
              Cancel
            </EuiButtonEmpty>
            
            {!isRateLimited && (
              <EuiButton 
                onClick={sendEmail} 
                fill 
                color="primary"
                isLoading={isSending}
                isDisabled={isSending}
              >
                {isSending ? 'Sending...' : 'Send Email'}
              </EuiButton>
            )}
          </EuiModalFooter>
        </EuiModal>
      );
    };

    const EMAIL_TEMPLATE = `
    <div style="font-family: 'Open Sans', 'Inter UI', sans-serif; background-color: #f6f6f6; padding: 20px; border-radius: 6px;">
      <div style="background-color: #fff; border-radius: 6px; padding: 20px; box-shadow: 0 2px 2px -1px rgba(0,0,0,0.1), 0 1px 5px -2px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 20px;">
          <h1 style="font-size: 20px; font-weight: 700; color: #000000; margin: 0;">%%ORGANIZATION%%</h1>
          <div style="background-color: #ffffff; color: white; padding: 5px 10px; border-radius: 4px; font-weight: bold;">
            <img src="%%LOGO_URI%%" alt="tseclogo" class="logo" width="50" height="50">
          </div>
        </div>
        
        <div style="margin-bottom: 20px;">
          <h2 style="font-size: 18px; color: #333; margin-bottom: 10px;">%%REPORT_TITLE%%</h2>
          <p style="margin-bottom: 15px;">You have received a report with the following note:</p>
          <div style="background-color: #f8f9fc; border-left: 3px solid #0a1f72; padding: 15px; margin-bottom: 20px;">
            <p style="margin: 0; font-style: italic;">%%NOTE%%</p>
          </div>
        </div>
        
        <div style="text-align: center; margin: 25px 0;">
          <a href="%%AUTHURL%%" style="
            display: inline-block; 
            background-color: #0a1f72; 
            background-image: linear-gradient(180deg, #005180 0, #003b5c);
            color: white; 
            padding: 12px 25px; 
            text-decoration: none; 
            border-radius: 5px; 
            font-weight: bold;
          ">
            Open in Dashboards
          </a>
        </div>
        
        <div style="border-top: 1px solid #eee; padding-top: 15px; font-size: 12px; color: #666; text-align: center;">
          <p>Opensearch Dashboards. <a href="%%AUTHURL%%" style="color: #0a1f72;">%%ORGANIZATION%%</a></p>
        </div>
      </div>
    </div>
    `;

    const emailTemplate = EMAIL_TEMPLATE.replace(
      "%%ORGANIZATION%%",
      organization
    );

    if (isLoading) {
      return (
        <EuiPage paddingSize="l">
          <EuiPageBody>
            <EuiPageContent>
              <EuiTitle size="l">
                <h1>Reports</h1>
              </EuiTitle>
              <EuiSpacer size="xxl" />
              <EuiFlexGroup justifyContent="center" alignItems="center">
                <EuiFlexItem grow={false}>
                  <EuiLoadingSpinner size="xl" />
                </EuiFlexItem>
              </EuiFlexGroup>
              <EuiSpacer size="s" />
              <EuiText textAlign="center">
                <p>Verifying access permissions and loading reports...</p>
              </EuiText>
            </EuiPageContent>
          </EuiPageBody>
        </EuiPage>
      );
    }

    let mainTabs: { id: string; name: string; content: React.ReactNode }[] = [];
    if (accessLevel === 'none'){
      mainTabs = [
        {
          id: 'query',
          name: 'Data Analysis',
          content: (
            <>
              <EuiCallOut color="warning" iconType="clock" title={accessError + ' Please contact your administrator to get the necessary permissions.'} />
              <DataAnalysis 
                coreStart={coreStart}
              />
            </>
          )
        }
      ]
    }
    else {
      mainTabs = [
        {
          id: 'reports',
          name: 'Reports',
          content: (
            <>
            <EuiPanel paddingSize="l">
              <EuiTitle size="l">
                <h1>Reports</h1>
              </EuiTitle>
              <EuiSpacer size='s'></EuiSpacer>
              {config.report_directory && (
                <EuiText color="subdued" size="s">                
                  {accessLevel === 'full' && (
                    <p>
                      Here you can download, email or delete your generated reports for the tenant: <strong>{tenantName}</strong>. 
                    </p>
                  )}

                  {accessLevel === 'view' && (
                    <p>
                      You can download and email reports for the tenant <strong>{tenantName}</strong>. 
                      Generate PDFs directly from dashboards, but saving/deleting is disabled.
                    </p>
                  )}
      
                </EuiText>
              )}
              <EuiSpacer size="m" />
              <EuiFieldSearch
                placeholder="Search reports"
                value={searchQuery}
                onChange={handleSearch}
                isClearable
                aria-label="Search reports"
              />
              <EuiSpacer size="m" />
              <EuiTabbedContent
                tabs={tabs}
                selectedTab={tabs.find(t => t.id === selectedTimeFilter) || tabs[1]}
                onTabClick={(tab) => setSelectedTimeFilter(tab.id)}
              />
            </EuiPanel>
            </>
          )
        },
        {
          id: 'query',
          name: 'Data Analysis',
          content: (
            <DataAnalysis 
              coreStart={coreStart}
            />
          )
        }
      ];
    }

    return (
      <EuiPage paddingSize="l">
        <EuiPageBody>
          <EuiTabbedContent
            tabs={mainTabs}
            selectedTab={mainTabs.find(t => t.id === activeMainTab)}
            onTabClick={tab => setActiveMainTab(tab.id as 'reports' | 'query')}
          />
          {renderDeleteModal()}
          {renderEmailModal()}
        </EuiPageBody>
      </EuiPage>
    );
  };

  const AppWithContext = () => (
    <PluginProvider value={{ assetService }}>
      <CanvasReportDataAnalyzerApp />
    </PluginProvider>
  );

  ReactDOM.render(<AppWithContext />, element);
  return () => ReactDOM.unmountComponentAtNode(element);
};
