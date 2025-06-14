# OpenSearch Dashboards Canvas Reports and Data Analyzer Plugin

## Overview

This OpenSearch Dashboards plugin provides two powerful capabilities:
1. Canvas-like PDF report generation with custom templates and branding
2. User-friendly Query Workspace for data analysis without Dev Tools knowledge

The plugin handles report storage, retrieval, filtering, distribution (download/email), and deletion through an intuitive UI while enforcing robust security measures across tenants.

---

## Installation

This is an example for OSD version 2.19.0

```
bin/opensearch-dashboards-plugin install https://github.com/geoloe/opensearch-dashboards-plugin-canvas-reports-data-analyzer/releases/download/2.19.0/canvasReportDataAnalyzer-2.19.0.zip
```

## Examples
![Sample Report 1](/external_assets/example1.pdf)  
*Sample Dashboard*

![Sample Report 2](/external_assets/example2.pdf)  
*Sample Dashboard*

![Sample Report 3](/external_assets/example3.pdf)  
*Sample Dashboard*

## Screenshots
![Sample Report 3](/external_assets/reports_view.png)  
*Reports View*

![Sample Report 3](/external_assets/email_view.png)  
*Email View*

![Sample Report 3](/external_assets/data_analysis_view.png)  
*Data Analysis View*

---

## Canvas Reporting Feature

### Core Functionality
- **On-Demand Report Generation**: 
  - Appears as "Generate PDF Report" button in dashboard navigation header
  - Button automatically appears/disappears when entering/exiting dashboards
  - Real-time progress modal shows each configuration phase during generation
  - Processing time varies based on dashboard visualization complexity

### Tenant-Specific Behavior
| Tenant Type | Behavior |
|-------------|----------|
| Global      | PDF downloads but not saved to report directory |
| Private     | PDF downloads but not saved to report directory |
| Custom      | PDF downloads AND saves to report directory (accessible in Reports menu) |

### Security Implementation
1. **File Isolation**:
   - PDFs contain tenant-specific metadata
   - Files stored with UUID names (e.g., `a1b2c3d4-5678-90ef-1234-567890abcdef.pdf`)
   - Backend authorization checks for all file operations

2. **Access Control**:
   - Requires `canvas_reporting` role (applies to all users including admin). This role can be empty. No index/cluster/tenant permissions are needed. Nevertheless, consider setting tenant read-only roles for your users.
   - Without role:
     - Generate PDF button appears disabled
     - Reports list hidden
     - Data Analysis tab shows warning message

### Configuration Options
```yaml
canvas_report_data_analyzer:
  enabled: true
  report_directory: "/var/tmp/osd-reports"      # Must be writable
  logo_path: "/path/to/logo.png"                # Required PNG
  report_template_path: "/path/to/template.pdf" # Required 2-page PDF
  allow_table_of_contents: false                # Enable/disable TOC
  smtp:
    host: "smtp.example.com"
    port: 587
    secure: false
    user: "user@example.com"
    pass: "password"
    from: "reports@example.com"
    organization: "Your Company Name"
    proxy: "http://your_proxy:8080"             # Optional
  text_positions_and_sizes:                     # x, y values are in millimeters
    tenant_name: 
      x: 20                                     # X position for tenant name text in the report
      y: 180                                    # Y position for tenant name text in the report
      size: 56                                  # Font size for tenant name text
    dashboard_name: 
      x: 20                                     # X position for dashboard name text in the report
      y: 120                                    # Y position for dashboard name text in the report
      size: 20                                  # Font size for dashboard name text
    timestamp:
      x: 20                                     # X position for timestamp text in the report
      y: 55                                     # Y position for timestamp text in the report
      size: 18                                  # Font size for timestamp text
```

### PDF Structure Details
1. **Template Requirements**:
   - Must be exactly 2 pages
   - First page becomes report cover
   - Second page becomes report back page

2. **Dynamic Elements**:
   - Three mandatory text injections on cover page:
     - Tenant name
     - Dashboard name
     - Generation timestamp
   - Positions and font sizes configurable via YAML

3. **Content Flow**:
   - Optional TOC (Table of Contents)
   - Main content sections show:
     - Dashboard title
     - Active time range at generation trigger
     - Visualizations with their corresponding titles. Enable the embedded title for a visualization and it will be used as the PDF visualizations title for that visualization. If no title is enabled, then '[No Title]' will be displayed.
     - Footer with:
       - Dashboard title
       - Organization name (can be defined in .yml seen above)
       - Date (e.g. DD.MM.YYYY)
       - Page numbers

4. **Visualization Layout**:
   - First content page: 1 visualization
   - Subsequent pages: 2 visualizations each
   - Final page: 1-2 visualizations as needed

### PDF Generation UI Views

![UI Top Navigation Buttons](/external_assets/report_generation_ui_3.png)  
*UI Top Navigation Buttons*

![Successful PDF Generation](/external_assets/report_generation_ui_1.png)  
*Successful PDF Generation*

![Unsuccessful PDF Generation](/external_assets/report_generation_ui_2.png)  
*Unsuccessful PDF Generation*


### PDF Visualizations
For Dashboards with more than 20 Visualizations the Table of Contents page will overflow. But all visualizations will render on the PDF Report. For these cases the `allow_table_of_contents` can be set to `false`, to completely remove a TOC page in Canvas PDF Reports.

Here as js array all covered Visualization Types with standardized dimensions regardless of window size of the browser. All other will still render but very small or big browser window sizes will have impact on rendered visualizations.
```javascript
const visualizationsWithStandardizedDimensions = [
  '.arcs',                    // Pie charts
  '.tvbVisTimeSeries',        // TSVB time series
  '.visAxis--y',              // Bar charts
  '.tvbVisTopN',              // Top N charts
  '.osdRedirectCrossAppLinks',// Trend metrics
  '.visChart.vgaVis',         // Map charts
  '.tvbSplitVis',             // TSVB metrics
  '.mtrVis',                  // Metric panels
  '.visualization.tableVis',  // Tables
  '.tgcChart'                 // Tag cloud
];

const visualizationsWithoutStandardizedDimensionsThatWillBeSkipped = [
  '[data-test-subj="tsvbMarkdown"]',  // Markdown
  '[data-test-subj="tableView"]'      // Discover tables
];
```

### Important Notes
- **Pie Charts**: If you set the option "Show Labels" the visualization will be represented in a table showing 2 columns. Label which will show all pie charts "pieces" Category Labels and Value containing each "pieces" percentage value.
- **Browser**: Supports all Browsers.
- **Theme**: Light mode recommended (dark mode produces dark backgrounds)
- **Window Size**: Responsive handling ensures consistent output across screen sizes

---

## Reports Management Interface

### Access Points
1. Top navigation: "Reports and Data Analysis" dropdown. Will display "Data Analysis" if role: `canvas_reporting` is not assigned to the user logged in.
2. Sidebar: "Reports/Data Analysis" menu item

### Features
- **Filtering**:
  - Search by report name
  - Time-based filtering
  - Sortable columns (Name, Creation Time)

- **Pagination**:
  - Adjustable rows per page
  - Page navigation controls

- **Report Actions**:
  | Action | Description |
  |--------|-------------|
  | Download | Immediate PDF download |
  | Delete | Permanent removal (tenant-auth enforced) |
  | Email | Send with customizable: |
  |        | - Recipients (multiple) |
  |        | - Subject |
  |        | - Body message |
  |        | - Live preview |
  |        | - Rate limited (10 min cooldown) |

---

## Data Analysis Feature

### Requirements
- `kibanaserver` user must have:
  - `all_access` cluster privilege
  - Full index permissions
  - Tenant access rights

### Functionality
1. **Index Selection**:
   - Only shows permitted index patterns
   - Time range selector (absolute/relative)

2. **Aggregation Builder**:
   - Visual interface for creating queries
   - No DSL knowledge required

3. **Output Options**:
   - Aggregation results (default)
   - "Preview Query": Shows raw query DSL
   - "Show Raw Data": Complete API response

---

## Troubleshooting

### Common Issues
| Symptom | Solution |
|---------|----------|
| Missing Generate PDF button | Create and assign `canvas_reporting` role to user(s) |
| Empty reports list | Check tenant type (Global/Private don't save) --> You can download and email reports for the tenant Private or Global. Generate PDFs directly from dashboards, but saving/deleting is disabled. |
| PDF generation fails | Verify template is exactly 2 pages long and make sure that the dashboard loads visualizations/data first before triggering the PDF generation |
| Visualization missing on PDF | Charts of Type: Raw Markdown and Discover Search Tables will be skipped |
| Email sending disabled | Wait 10 minutes after previous send --> Rate Limiting for 10 Minutes is enforced on all users to prevent missuse. |
| 'No valid index patterns available' on Data Analysis View | Assign `all_access` role to `kibanaserver` user

## Development Notes

### Schema Validation
```typescript
// Example validation logic:
const validateA4Position = (value: number, axis: 'x' | 'y') => {
  const max = axis === 'x' ? 210 : 297; // A4 dimensions in mm
  if (value < 0 || value > max) {
    throw new Error(`${axis.toUpperCase()}-axis position must be 0-${max}mm`);
  }
};
```
---
### Default Values
| Setting | Default |
|---------|---------|
| report_directory | `/var/tmp/osd-reports` |
| allow_table_of_contents | true |
| text_positions_and_sizes.tenant_name.x | 20 |
| text_positions_and_sizes.tenant_name.y | 140 |
| text_positions_and_sizes.tenant_name.size | 42 |
| text_positions_and_sizes.dashboard_name.x | 20 |
| text_positions_and_sizes.dashboard_name.y | 120 |
| text_positions_and_sizes.dashboard_name.size | 28 |
| text_positions_and_sizes.timestamp.x | 20 |
| text_positions_and_sizes.timestamp.y | 55 |
| text_positions_and_sizes.timestamp.size | 28 |
| smtp.url | `https://your-opensearch-dashboards-domain.org` |
| smtp.host | `smpt.mail.server` |
| smtp.port | 25 |
| smtp.secure | 25 |
| smtp.user | `mail_user` |
| smtp.pass | `password` |
| smtp.from | `our-email@organization.org` |
| smtp.organization | `Organization, Inc` |

### Note

The E-Mail template was forked from the [Reporting CLI Tool](https://github.com/opensearch-project/reporting-cli) from the Opensearch Project. 

All data presented in the PDF examples, Dashboards, logos and images displayed in the Sample PDFs belong to Opensearch. This applies for the external asset [Opensearch Logo](/external_assets/opensearch_mark_on_light.png)

The [report PDF Template](/external_assets/report_template.pdf) shown in the example Report PDFs is not meant as official template for the plugin, only as reference for other PDF templates. Not meant for use in Production Environments.

Please feel free to fork this project.