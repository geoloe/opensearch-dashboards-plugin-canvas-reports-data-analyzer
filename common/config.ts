import { schema, TypeOf } from '@osd/config-schema';

export const configSchema = schema.object({
  enabled: schema.boolean({ defaultValue: false }),
  report_directory: schema.string({
    defaultValue: '/var/tmp/osd-reports',
    validate: value => {
      if (!value.trim()) return 'Report directory cannot be empty';
    },
  }),
  logo_path: schema.string({
    defaultValue: '/path/to/logo.png',
    validate: value => {
      if (!value.trim()) return 'Logo path cannot be empty';
      if (!value.endsWith('.png')) return 'Logo must be a PNG file';
    },
  }),
  report_template_path: schema.string({
    defaultValue: '/path/to/template.pdf',
    validate: value => {
      if (!value.trim()) return 'Template path cannot be empty';
      if (!value.endsWith('.pdf')) return 'Template must be a PDF file';
    },
  }),
  allow_table_of_contents: schema.boolean({
    defaultValue: true
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