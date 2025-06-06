import React, { useState, useEffect } from 'react';
import { CoreStart } from '../../../../src/core/public';
import {
  EuiPanel,
  EuiTitle,
  EuiSpacer,
  EuiForm,
  EuiFormRow,
  EuiButton,
  EuiCodeBlock,
  EuiFlexGroup,
  EuiFlexItem,
  EuiDatePicker,
  EuiSelect,
  EuiCallOut,
  EuiText,
  EuiFieldNumber,
  EuiSwitch,
  EuiButtonIcon,
  EuiPopover,
  EuiContextMenu,
  EuiLoadingSpinner,
  EuiComboBox,
  EuiToolTip
} from '@elastic/eui';
import moment, { Moment } from 'moment';

interface DataAnalysisProps {
  coreStart: CoreStart;
}

interface IndexPatternOption {
  label: string;
  value: string;
}

interface FieldOption {
  name: string;
  type: string;
  exists: boolean;
}

interface Aggregation {
  id: number;
  type: string;
  field: string;
  size: number;
  enabled: boolean;
}

interface QueryResponse {
  aggregations?: Record<string, any>;
  hits?: {
      hits: any[];
      [key: string]: any;
  };
  [key: string]: any;
}

const AGGREGATION_TYPES = [
  { value: 'terms', text: 'Group by (Categories)' },
  { value: 'date_histogram', text: 'Group by (Time intervals)' },
  { value: 'avg', text: 'Average' },
  { value: 'sum', text: 'Sum' },
  { value: 'min', text: 'Minimum' },
  { value: 'max', text: 'Maximum' },
  { value: 'cardinality', text: 'Count distinct' }
];

const TIME_RANGE_OPTIONS = [
  { value: 'none', text: 'No time filter' },
  { value: 'last15m', text: 'Last 15 minutes' },
  { value: 'last1h', text: 'Last 1 hour' },
  { value: 'last24h', text: 'Last 24 hours' },
  { value: 'last7d', text: 'Last 7 days' },
  { value: 'last30d', text: 'Last 30 days' },
  { value: 'custom', text: 'Custom range' }
];

export const DataAnalysis: React.FC<DataAnalysisProps> = ({ 
  coreStart
}) => {
  const [indexName, setIndexName] = useState('');
  const [timeField, setTimeField] = useState('@timestamp');
  const [timeRange, setTimeRange] = useState('last30d');
  const [customStart, setCustomStart] = useState<Moment>(moment().subtract(30, 'days'));
  const [customEnd, setCustomEnd] = useState<Moment>(moment());
  const [size, setSize] = useState(0);
  const [indexPatternOptions, setIndexPatternOptions] = useState<IndexPatternOption[]>([]);
  const [isLoadingIndexPatterns, setIsLoadingIndexPatterns] = useState(true);
  const [fields, setFields] = useState<FieldOption[]>([]);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [aggregations, setAggregations] = useState<Aggregation[]>([
    { id: 1, type: 'terms', field: '', size: 10, enabled: true }
  ]);
  const [responseData, setResponseData] = useState<QueryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRawData, setShowRawData] = useState(false);
  const [isQueryPreviewOpen, setIsQueryPreviewOpen] = useState(false);
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  
  useEffect(() => {
    const fetchIndexPatterns = async () => {
      try {
        setIsLoadingIndexPatterns(true);
        const response = await coreStart.http.get('/api/canvas_report_data_analyzer/index_patterns');
        const patterns: string[] = response.index_patterns || [];
        const options: IndexPatternOption[] = patterns.map((pattern: string) => ({
          label: pattern,
          value: pattern
        }));
        
        setIndexPatternOptions(options);
        
        if (options.length > 0) {
          setIndexName(options[0].value);
        } else {
          setError('No valid index patterns available');
        }
      } catch (error) {
        console.error('Error fetching index patterns:', error);
        setError('Failed to load index patterns');
      } finally {
        setIsLoadingIndexPatterns(false);
      }
    };
    
    fetchIndexPatterns();
  }, [coreStart.http]);

  useEffect(() => {
    const fetchFields = async () => {
      if (!indexName) return;
      
      try {
        setIsLoadingFields(true);
        const response = await coreStart.http.get(
          `/api/canvas_report_data_analyzer/fields/${encodeURIComponent(indexName)}`
        );
        
        const filteredFields = response.fields.filter(
          (field: FieldOption) => field.type !== 'object' && field.type !== 'nested'
        );
        
        setFields(filteredFields);
        
        const dateFields: FieldOption[] = filteredFields.filter((f: FieldOption) => f.type === 'date');
        
        if (dateFields.length > 0) {
          const timestampField = dateFields.find(f => f.name === '@timestamp');
          setTimeField(timestampField ? '@timestamp' : dateFields[0].name);
        } else {
          setTimeField('');
          setTimeRange('none');
        }
      } catch (error) {
        console.error('Error fetching fields:', error);
        setError('Failed to load fields for index pattern');
        setFields([]);
        setTimeField('');
        setTimeRange('none');
      } finally {
        setIsLoadingFields(false);
      }
    };
    
    fetchFields();
  }, [indexName, coreStart.http]);

  const addAggregation = () => {
    setAggregations([
      ...aggregations,
      { 
        id: aggregations.length + 1, 
        type: 'terms', 
        field: '', 
        size: 10, 
        enabled: true 
      }
    ]);
  };

  const removeAggregation = (id: number) => {
    setAggregations(aggregations.filter(agg => agg.id !== id));
  };

  const updateAggregation = (id: number, field: string, value: any) => {
    setAggregations(aggregations.map(agg => 
      agg.id === id ? { ...agg, [field]: value } : agg
    ));
  };

  const generateQuery = () => {
    const query: any = {
      size: size,
      query: {
        bool: {
          must: []
        }
      },
      aggs: {}
    };
    
    if (timeRange !== 'none') {
      let gte, lte;
      
      switch (timeRange) {
        case 'last15m':
          gte = 'now-15m';
          lte = 'now';
          break;
        case 'last1h':
          gte = 'now-1h';
          lte = 'now';
          break;
        case 'last24h':
          gte = 'now-24h';
          lte = 'now';
          break;
        case 'last7d':
          gte = 'now-7d';
          lte = 'now';
          break;
        case 'last30d':
          gte = 'now-30d';
          lte = 'now';
          break;
        case 'custom':
          gte = customStart.toISOString();
          lte = customEnd.toISOString();
          break;
        default:
          gte = 'now-30d';
          lte = 'now';
      }
      
      query.query.bool.must.push({
        range: {
          [timeField]: {
            gte,
            lte,
            format: timeRange === 'custom' ? "strict_date_optional_time" : undefined
          }
        }
      });
    }
    
    aggregations
      .filter(agg => agg.enabled && agg.field)
      .forEach((agg, index) => {
        const aggName = `agg${index + 1}`;
        
        switch (agg.type) {
          case 'terms':
            const isTextField = fields.find(f => f.name === agg.field)?.type === 'text';
            const fieldName = isTextField ? `${agg.field}.keyword` : agg.field;
            
            query.aggs[aggName] = {
              terms: {
                field: fieldName,
                size: agg.size
              }
            };
            break;
          case 'date_histogram':
            query.aggs[aggName] = {
              date_histogram: {
                field: timeField,
                calendar_interval: '1d'
              }
            };
            break;
          case 'avg':
          case 'sum':
          case 'min':
          case 'max':
          case 'cardinality':
            query.aggs[aggName] = {
              [agg.type]: { field: agg.field }
            };
            break;
        }
      });
    
    return query;
  };

  const formatJsonPreview = (data: any) => {
    if (!data) return '';
    return JSON.stringify(data, null, 2);
  };

  const renderResults = () => {
    if (!responseData) return null;

    const hasAggregations = responseData.aggregations && Object.keys(responseData.aggregations).length > 0;
    const hasHits = responseData.hits && responseData.hits.hits.length > 0;

      if (showRawData) {
        return (
          <EuiPanel paddingSize="m">
            <EuiFlexGroup alignItems="center" justifyContent="spaceBetween">
              <EuiFlexItem grow={false}>
                <EuiTitle size="s"><h3>Raw Data Analysis</h3></EuiTitle>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiButtonIcon
                  iconType="cross"
                  aria-label="Close raw data view"
                  onClick={() => setShowRawData(false)}
                />
              </EuiFlexItem>
            </EuiFlexGroup>
            
            <EuiSpacer size="s" />
            
            <EuiCallOut
              title="Full Response Data"
              iconType="document"
              color="primary"
            >
              <p>
                Showing complete query response including both aggregations and raw data hits
              </p>
            </EuiCallOut>
            
            <EuiSpacer size="s" />
            
            <EuiCodeBlock
              language="json"
              fontSize="m"
              paddingSize="m"
              overflowHeight={300}
              isCopyable
            >
              {JSON.stringify(responseData, null, 2)}
            </EuiCodeBlock>
          </EuiPanel>
        );
      }

    return (
      <EuiPanel paddingSize="m">
        <EuiFlexGroup alignItems="center" justifyContent="spaceBetween">
          <EuiFlexItem grow={false}>
            <EuiTitle size="s"><h3>Analysis Results</h3></EuiTitle>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText color="subdued">
              {hasAggregations ? "Summary of grouped data" : "Raw data results"}
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer size="s" />
        
        {hasAggregations ? (
          <>
            <EuiCallOut
              title="Grouped Data Analysis"
              iconType="aggregate"
              color="success"
            >
              <p>
                This summary shows how your data is grouped based on the analysis steps you created. 
                It helps you see patterns and trends in your data.
              </p>
            </EuiCallOut>
            <EuiSpacer size="s" />
            <EuiCodeBlock
              language="json"
              fontSize="m"
              paddingSize="m"
              overflowHeight={300}
              isCopyable
            >
              {JSON.stringify(responseData.aggregations, null, 2)}
            </EuiCodeBlock>
          </>
        ) : (
          <EuiCodeBlock
            language="json"
            fontSize="m"
            paddingSize="m"
            overflowHeight={300}
            isCopyable
          >
            {JSON.stringify(responseData, null, 2)}
          </EuiCodeBlock>
        )}
        
        {hasAggregations && hasHits && (
          <>
            <EuiSpacer size="m" />
            <EuiCallOut
              title="Raw Data Available"
              iconType="document"
              color="primary"
            >
              <p>
                Raw data results are also available but hidden to focus on the grouped analysis. 
                You can view the full response by clicking "Show Raw Data Analysis" in the actions menu.
              </p>
            </EuiCallOut>
          </>
        )}
      </EuiPanel>
    );
  };

  const renderAggregationItems = () => {
    return aggregations.map((agg) => {
      let filteredFields = fields;
      if (agg.type === 'terms') {
        filteredFields = fields.filter(f => f.type === 'text' || f.type === 'keyword');
      } else if (agg.type === 'date_histogram') {
        filteredFields = fields.filter(f => f.type === 'date');
      } else if (['avg', 'sum', 'min', 'max'].includes(agg.type)) {
        filteredFields = fields.filter(f => [
          'long', 'integer', 'short', 'byte', 
          'double', 'float', 'half_float', 'scaled_float'
        ].includes(f.type));
      }

      return (
        <EuiPanel key={agg.id} paddingSize="s" style={{ marginBottom: '15px' }}>
          <EuiFlexGroup alignItems="center">
            <EuiFlexItem grow={false}>
              <EuiSwitch
                label="Enabled"
                checked={agg.enabled}
                onChange={(e) => updateAggregation(agg.id, 'enabled', e.target.checked)}
                compressed
              />
            </EuiFlexItem>
            
            <EuiFlexItem>
              <EuiFormRow label="Analysis Type" fullWidth>
                <EuiSelect
                  options={AGGREGATION_TYPES}
                  value={agg.type}
                  onChange={(e) => updateAggregation(agg.id, 'type', e.target.value)}
                  fullWidth
                />
              </EuiFormRow>
            </EuiFlexItem>
            
            <EuiFlexItem>
              <EuiFormRow label="Field" fullWidth>
                {isLoadingFields ? (
                  <EuiSelect
                    isLoading={true}
                    options={[]}
                    placeholder="Loading fields..."
                    fullWidth
                  />
                ) : (
                  <EuiSelect
                    options={filteredFields.map(field => ({
                      value: field.name,
                      text: `${field.name} (${field.type})`
                    }))}
                    value={agg.field}
                    onChange={(e) => updateAggregation(agg.id, 'field', e.target.value)}
                    fullWidth
                    placeholder={`Select a ${agg.type === 'terms' ? 'category' : 'value'} field`}
                  />
                )}
              </EuiFormRow>
            </EuiFlexItem>
            
            {agg.type === 'terms' && (
              <EuiFlexItem grow={false}>
                <EuiFormRow label="Max Groups" fullWidth>
                  <EuiFieldNumber
                    placeholder="Max groups"
                    value={agg.size}
                    onChange={(e) => updateAggregation(agg.id, 'size', parseInt(e.target.value) || 0)}
                    min={1}
                    max={100}
                    style={{ width: '100px' }}
                  />
                </EuiFormRow>
              </EuiFlexItem>
            )}
            
            <EuiFlexItem grow={false}>
              <EuiToolTip content="Remove this analysis step">
                <EuiButtonIcon
                  iconType="trash"
                  color="danger"
                  aria-label="Remove aggregation"
                  onClick={() => removeAggregation(agg.id)}
                />
              </EuiToolTip>
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiText size="xs" color="subdued">
            {getAggregationDescription(agg)}
          </EuiText>
        </EuiPanel>
      );
    });
  };

  const getAggregationDescription = (agg: Aggregation) => {
    if (!agg.field) return "Select a field to see description";
    
    switch (agg.type) {
      case 'terms': 
        return `Group results by the '${agg.field}' field and show top ${agg.size} groups`;
      case 'date_histogram':
        return `Group results by daily intervals based on '${agg.field}'`;
      case 'avg':
        return `Calculate average value of '${agg.field}'`;
      case 'sum':
        return `Calculate total sum of '${agg.field}'`;
      case 'min':
        return `Find minimum value in '${agg.field}'`;
      case 'max':
        return `Find maximum value in '${agg.field}'`;
      case 'cardinality':
        return `Count distinct values in '${agg.field}'`;
      default:
        return `Perform ${agg.type} on '${agg.field}'`;
    }
  };

  const actionItems = [
    {
      name: 'Preview Query',
      icon: 'inspect',
      onClick: () => {
        setIsActionsOpen(false);
        setIsQueryPreviewOpen(true);
      },
    },
    {
      name: 'Show Raw Data Analysis',
      icon: 'document',
      onClick: () => {
        setIsActionsOpen(false);
        setShowRawData(true);
      },
    }
  ];

  const executeQuery = async () => {
    if (!indexName) {
      setError('Please select a dataset first');
      return;
    }
    setShowRawData(false);
    setResponseData(null);
    
    setIsLoading(true);
    setError(null);
    
    try {
      const query = generateQuery();
      const response = await coreStart.http.post('/api/canvas_report_data_analyzer/query', {
        body: JSON.stringify({ index: indexName, query })
      });
      
      setResponseData(response);
    } catch (err: any) {
      setError('Query failed: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <EuiPanel paddingSize="l" style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <EuiTitle size="m"><h2>Data Analysis</h2></EuiTitle>
      <EuiText color="subdued">
        <p>Analyze your data without writing code. Select a dataset, define your analysis steps, and view results.</p>
      </EuiText>
      <EuiSpacer size="m" />
      
      {error && (
        <EuiCallOut color="danger" title={error} iconType="alert" />
      )}
      
      <EuiForm>
        <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
          <EuiTitle size="s"><h3>1. Select Dataset</h3></EuiTitle>
          <EuiSpacer size="s" />
          <EuiFlexGroup>
            <EuiFlexItem>
              <EuiFormRow label="Dataset" fullWidth helpText="Select the data you want to analyze">
                {isLoadingIndexPatterns ? (
                  <EuiFlexGroup alignItems="center" gutterSize="s">
                    <EuiFlexItem grow={false}>
                      <EuiLoadingSpinner size="s" />
                    </EuiFlexItem>
                    <EuiFlexItem>
                      <EuiText size="s">Loading datasets...</EuiText>
                    </EuiFlexItem>
                  </EuiFlexGroup>
                ) : (
                  <EuiComboBox
                    placeholder="Select a dataset"
                    singleSelection={{ asPlainText: true }}
                    options={indexPatternOptions}
                    selectedOptions={
                      indexPatternOptions.filter(opt => opt.value === indexName)
                    }
                    onChange={(selected) => {
                      if (selected.length > 0) {
                        setIndexName(String(selected[0].value));
                      } else {
                        setIndexName('');
                      }
                    }}
                    fullWidth
                    isClearable={false}
                  />
                )}
              </EuiFormRow>
            </EuiFlexItem>
            
            <EuiFlexItem>
              <EuiFormRow label="Time Field" fullWidth helpText="Field containing timestamp information">
                {isLoadingFields ? (
                  <EuiSelect
                    isLoading={true}
                    options={[]}
                    placeholder="Loading fields..."
                    fullWidth
                  />
                ) : (
                  <EuiSelect
                    options={fields
                      .filter(f => f.type === 'date')
                      .map(field => ({
                        value: field.name,
                        text: field.name
                      }))}
                    value={timeField}
                    onChange={(e) => setTimeField(e.target.value)}
                    fullWidth
                    placeholder="Select a time field"
                  />
                )}
              </EuiFormRow>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiPanel>
        
        <EuiSpacer />
        
        <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
          <EuiTitle size="s"><h3>2. Set Time Range</h3></EuiTitle>
          <EuiSpacer size="s" />
          <EuiFlexGroup>
            <EuiFlexItem>
              <EuiFormRow 
                label="Time Range" 
                fullWidth 
                helpText={timeField ? "Select the time period to analyze" : "No date fields found in index"}
                isInvalid={!timeField}
                error={!timeField ? "Time filtering requires a date field" : undefined}
              >
                <EuiSelect
                  options={TIME_RANGE_OPTIONS}
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  fullWidth
                  disabled={!timeField}
                />
              </EuiFormRow>
            </EuiFlexItem>
            
            {timeRange === 'custom' && timeField && (
              <>
                <EuiFlexItem>
                  <EuiFormRow label="Start Date" fullWidth>
                    <EuiDatePicker
                      selected={customStart}
                      onChange={date => date && setCustomStart(date)}
                      showTimeSelect
                      dateFormat="YYYY-MM-DD HH:mm"
                      fullWidth
                    />
                  </EuiFormRow>
                </EuiFlexItem>
                
                <EuiFlexItem>
                  <EuiFormRow label="End Date" fullWidth>
                    <EuiDatePicker
                      selected={customEnd}
                      onChange={date => date && setCustomEnd(date)}
                      showTimeSelect
                      dateFormat="YYYY-MM-DD HH:mm"
                      fullWidth
                    />
                  </EuiFormRow>
                </EuiFlexItem>
              </>
            )}
            
            <EuiFlexItem grow={false}>
              <EuiFormRow label="Max Results" fullWidth helpText="Number of raw results to show (0 for analysis only)">
                <EuiFieldNumber
                  value={size}
                  onChange={(e) => setSize(parseInt(e.target.value) || 0)}
                  min={0}
                  max={10000}
                  style={{ width: '100px' }}
                />
              </EuiFormRow>
            </EuiFlexItem>
          </EuiFlexGroup>
          
          {/* Warning when no date fields */}
          {!timeField && !isLoadingFields && (
            <>
              <EuiSpacer size="s" />
              <EuiCallOut
                title="No date fields found"
                color="warning"
                iconType="alert"
              >
                <p>
                  The selected index pattern has no date fields. Time filtering is disabled.
                </p>
              </EuiCallOut>
            </>
          )}
        </EuiPanel>
        
        <EuiSpacer />
        
        <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
          <EuiFlexGroup alignItems="center" justifyContent="spaceBetween">
            <EuiFlexItem grow={false}>
              <EuiTitle size="s"><h3>3. Analyze Data</h3></EuiTitle>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButton 
                onClick={addAggregation}
                iconType="plusInCircle"
                size="s"
              >
                Add Analysis Step
              </EuiButton>
            </EuiFlexItem>
          </EuiFlexGroup>
          
          <EuiSpacer size="s" />
          <EuiText size="s" color="subdued">
            <p>Add steps to group, summarize, or calculate values from your data</p>
          </EuiText>
          
          <EuiSpacer size="m" />
          
          {renderAggregationItems()}
        </EuiPanel>
        
        <EuiSpacer />
        
        <EuiFlexGroup justifyContent="flexEnd">
          <EuiFlexItem grow={false}>
            <EuiPopover
              button={
                <EuiButton
                  iconType="arrowDown"
                  iconSide="right"
                  onClick={() => setIsActionsOpen(!isActionsOpen)}
                >
                  Additional Actions
                </EuiButton>
              }
              isOpen={isActionsOpen}
              closePopover={() => setIsActionsOpen(false)}
              panelPaddingSize="none"
            >
              <EuiContextMenu
                initialPanelId="mainMenu"
                panels={[
                  {
                    id: 'mainMenu',
                    title: 'Actions',
                    items: actionItems,
                  },
                ]}
              />
            </EuiPopover>
          </EuiFlexItem>
          
          <EuiFlexItem grow={false}>
            <EuiButton 
              onClick={executeQuery} 
              fill
              isLoading={isLoading}
              iconType="play"
            >
              Run Analysis
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiForm>
      
      <EuiSpacer size="l" />

      {isLoading && (
        <EuiFlexGroup justifyContent="center">
          <EuiFlexItem grow={false}>
            <EuiLoadingSpinner size="xl" />
            <EuiSpacer size="s" />
            <EuiText textAlign="center">
              <p>Analyzing data...</p>
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
      )}
      
      {responseData && !isLoading && renderResults()}
      
      {/* Query Preview Popover */}
      {isQueryPreviewOpen && (
        <EuiPopover
          ownFocus
          button={(
            <EuiButton onClick={() => setIsQueryPreviewOpen(false)} style={{ display: 'none' }}>
              Preview
            </EuiButton>
          )}
          isOpen={isQueryPreviewOpen}
          closePopover={() => setIsQueryPreviewOpen(false)}
          anchorPosition="downCenter"
          panelPaddingSize="l"
          style={{ width: '80%', maxWidth: '1000px' }}
        >
          <div style={{ width: '800px' }}>
            <EuiTitle size="s"><h3>Generated Query Preview</h3></EuiTitle>
            <EuiSpacer size="s" />
            <EuiCodeBlock
              language="json"
              fontSize="m"
              paddingSize="m"
              overflowHeight={500}
              isCopyable
              whiteSpace="pre"
            >
              {formatJsonPreview(generateQuery())}
            </EuiCodeBlock>
          </div>
        </EuiPopover>
      )}
    </EuiPanel>
  );
};