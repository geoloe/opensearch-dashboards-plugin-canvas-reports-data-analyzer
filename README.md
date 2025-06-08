# OpenSearch Dashboards Canvas Reports and Data Analyzer Plugin

## Overview

This OpenSearch Dashboards plugin provides two powerful capabilities:
1. Canvas-like PDF report generation with custom templates and branding
2. User-friendly Query Workspace for data analysis without Dev Tools knowledge

The plugin handles report storage, retrieval, filtering, distribution (download/email), and deletion through an intuitive UI while enforcing robust security measures across tenants.

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
   - Requires `canvas_reporting` role (applies to all users including admin)
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
  text_positions_and_sizes:                     # x, y values are in points
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
   - Optional TOC (disabled for dashboards with >20 visualizations)
   - Main content sections show:
     - Dashboard title
     - Active time range
     - Visualizations with titles
     - Footer with:
       - Dashboard title
       - Organization name
       - Date
       - Page numbers

4. **Visualization Layout**:
   - First content page: 1 visualization
   - Subsequent pages: 2 visualizations each
   - Final page: 1-2 visualizations as needed

### Visualizations with Standardized Dimensions
For Dashboards with more than 20 Visualizations the Table of Contents page will overflow. But all visualizations will render on the PDF Report. You can set for these cases the `allow_table_of_contents` allowed option to `false`
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

const visualizationsWithoutStandardizedDimensions = [
  '[data-test-subj="tsvbMarkdown"]',  // Markdown
  '[data-test-subj="tableView"]'      // Discover tables
];
```

### Important Notes
- **Pie Charts**: Require "show labels" enabled for proper rendering
- **Browser**: Supports Chrome, Firefox, Edge
- **Theme**: Light mode recommended (dark mode produces dark backgrounds)
- **Window Size**: Responsive handling ensures consistent output across screen sizes

---

## Reports Management Interface

### Access Points
1. Top navigation: "Reports and Data Analysis" dropdown
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
| Missing Generate PDF button | Assign `canvas_reporting` role |
| Empty reports list | Check tenant type (Global/Private don't save) |
| PDF generation fails | Verify template is exactly 2 pages |
| Visualization missing | Raw Markdown and Discover Search Tables will be skipped |
| Email sending disabled | Wait 10 minutes after previous send |

---

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

### Notes

I want to mention that the E-Mail template was forked from the Reporting CLI Tool from the Opensearch Project.

All logos and images displayed in the Sample PDFs belong Opensearch