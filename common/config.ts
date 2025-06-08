import { schema, TypeOf } from '@osd/config-schema';

const validateA4Position = (value: number, axis: 'x' | 'y') => {
  const max = axis === 'x' ? 210 : 297;
  if (value < 0 || value > max) {
    return `${axis.toUpperCase()}-axis position must be between 0 and ${max}mm for A4`;
  }
};

export const configSchema = schema.object({
  enabled: schema.boolean({ defaultValue: false }),
  report_directory: schema.string({
    defaultValue: '/var/tmp/osd-reports',
    validate: value => {
      if (!value.trim()) return 'Report directory cannot be empty';
    },
  }),
  logo_path: schema.string({
    validate: value => {
      if (!value.trim()) return 'Logo path cannot be empty';
      if (!value.endsWith('.png')) return 'Logo must be a PNG file';
    },
  }),
  report_template_path: schema.string({
    validate: value => {
      if (!value.trim()) return 'Template path cannot be empty';
      if (!value.endsWith('.pdf')) return 'Template must be a PDF file';
    },
  }),
  allow_table_of_contents: schema.boolean({
    defaultValue: true
  }),
  text_positions_and_sizes: schema.object({
    tenant_name: schema.object({
      x: schema.number({
        defaultValue: 20,
        validate: value => validateA4Position(value, 'x')
      }),
      y: schema.number({
        defaultValue: 140,
        validate: value => validateA4Position(value, 'y')
      }),
      size: schema.number({
        defaultValue: 42,
        validate: value => {
          if (value < 8 || value > 102) {
            return 'Font size must be between 8 and 102';
          }
        }
      })
    }),
    dashboard_name: schema.object({
      x: schema.number({
        defaultValue: 20,
        validate: value => validateA4Position(value, 'x')
      }),
      y: schema.number({
        defaultValue: 120,
        validate: value => validateA4Position(value, 'y')
      }),
      size: schema.number({
        defaultValue: 28,
        validate: value => {
          if (value < 8 || value > 102) {
            return 'Font size must be between 8 and 102';
          }
        }
      })
    }),
    timestamp: schema.object({
      x: schema.number({
        defaultValue: 20,
        validate: value => validateA4Position(value, 'x')
      }),
      y: schema.number({
        defaultValue: 55,
        validate: value => validateA4Position(value, 'y')
      }),
      size: schema.number({
        defaultValue: 28,
        validate: value => {
          if (value < 8 || value > 102) {
            return 'Font size must be between 8 and 102';
          }
        }
      })
    })
  }),
  smtp: schema.object({
    url: schema.string({ defaultValue: 'https://your-opensearch-dashboards-domain.org' }),
    host: schema.string({ defaultValue: 'smtp.mail.server' }),
    port: schema.number({ defaultValue: 25 }),
    secure: schema.boolean({ defaultValue: false }),
    user: schema.string({ defaultValue: 'mail_user' }),
    pass: schema.string({ defaultValue: 'mail_password' }),
    from: schema.string({ defaultValue: 'your-email@organization.org' }),
    organization: schema.string({ defaultValue: 'Organization, Inc' }),
    proxy: schema.maybe(schema.string()),
  }),
});

export type CanvasReportDataAnalyzerConfig = TypeOf<typeof configSchema>;
export type PublicConfigSchema = Omit<CanvasReportDataAnalyzerConfig, 'enabled'>;