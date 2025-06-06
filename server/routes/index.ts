import { IRouter } from 'src/core/server';
import { schema } from '@osd/config-schema';
import { CanvasReportDataAnalyzerConfig } from '../../common/config';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import handlebars from 'handlebars';
import { FileReaderService } from '../file_reader';

const emailRateLimits = new Map<string, number>();
const DEFAULT_TENANT_NAME = '__user__';
const metadataCache = new Map<string, { tenant: string; originalName: string }>();

/**
 * Extracts metadata from a PDF file at the specified file path.
 *
 * This function reads the PDF file, parses it to extract the subject (used as the tenant)
 * and the title (used as the original name). If the title is not available, the file's base name is used.
 * The extracted metadata is cached to optimize repeated access.
 *
 * @param filePath - The absolute path to the PDF file from which to extract metadata.
 * @returns A promise that resolves to an object containing the `tenant` and `originalName` properties.
 *
 * @remarks
 * - Utilizes a cache (`metadataCache`) to avoid redundant parsing of the same file.
 * - Assumes the presence of the `fs`, `path`, and `PDFDocument` modules, as well as a `metadataCache` object.
 * - The returned metadata object has the following structure:
 *   - `tenant`: The subject of the PDF, or an empty string if not present.
 *   - `originalName`: The title of the PDF, or the file's base name if the title is not present.
 *
 * @throws Will throw an error if the file cannot be read or the PDF cannot be parsed.
 */
const extractPdfMetadata = async (filePath: string) => {
  if (metadataCache.has(filePath)) {
    return metadataCache.get(filePath)!;
  }

  const pdfBytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBytes));
  const metadata = {
    tenant: pdfDoc.getSubject() || '',
    originalName: pdfDoc.getTitle() || path.basename(filePath)
  };

  metadataCache.set(filePath, metadata);
  return metadata;
};

/**
 * Injects metadata into a PDF document.
 *
 * This function modifies the subject and title of the PDF document to include tenant and file name information.
 * It returns the modified PDF as a byte array.
 *
 * @param pdfBytes - The original PDF document as a byte array.
 * @param metadata - An object containing `tenant` and `fileName` to set as the subject and title of the PDF.
 * @returns A promise that resolves to a byte array of the modified PDF document.
 */
const injectPdfMetadata = async (pdfBytes: Uint8Array, metadata: { 
  tenant: string; 
  fileName: string 
}) => {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.setSubject(metadata.tenant);
  pdfDoc.setTitle(metadata.fileName);
  return await pdfDoc.save();
};

export function defineRoutes(router: IRouter, config: CanvasReportDataAnalyzerConfig, fileReader?: FileReaderService) {
  const REPORTS_DIRECTORY = path.join(config.report_directory, 'pdf_reports');

  const ensureDirectoryExists = () => {
    try {
      if (!fs.existsSync(REPORTS_DIRECTORY)) {
        fs.mkdirSync(REPORTS_DIRECTORY, { recursive: true });
        fs.chmodSync(REPORTS_DIRECTORY, 0o755);
      }
      fs.accessSync(REPORTS_DIRECTORY, fs.constants.W_OK);
    } catch (err) {
      throw new Error(`Directory ${REPORTS_DIRECTORY} not writable: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  router.post(
    {
      path: '/api/canvas_report_data_analyzer/save',
      options: {
        body: { maxBytes: 50 * 1024 * 1024, output: 'stream', parse: true },
      },
      validate: {
        query: schema.object({
          tenant: schema.maybe(schema.string()),
          dashboard: schema.maybe(schema.string()),
          fileName: schema.maybe(schema.string()),
        }),
        body: schema.any(),
      },
    },
    async (context, request, response) => {
      try {
        ensureDirectoryExists();

        const { body: authInfo } = await context.core.opensearch.client.asCurrentUser.transport.request({
          method: 'GET',
          path: '/_plugins/_security/authinfo',
        });

        const tenant = authInfo.user_requested_tenant || DEFAULT_TENANT_NAME;
        const fileName = request.query.fileName || `${tenant}_${Date.now()}.pdf`;
        const fileId = crypto.randomUUID();
        const filePath = path.join(REPORTS_DIRECTORY, `${fileId}.pdf`);

        const chunks: Uint8Array[] = [];
        for await (const chunk of request.body) {
          chunks.push(chunk);
        }
        const pdfBytes = new Uint8Array(Buffer.concat(chunks));

        const modifiedPdf = await injectPdfMetadata(pdfBytes, {
          tenant,
          fileName
        });

        fs.writeFileSync(filePath, modifiedPdf);
        fs.chmodSync(filePath, 0o644);

        return response.ok({ 
          body: { 
            success: true, 
            fileId,
            fileName 
          } 
        });
      } catch (error) {
        return response.customError({
          statusCode: 500,
          body: `Save failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  );

  router.get(
    {
      path: '/api/canvas_report_data_analyzer/reports',
      validate: false,
    },
    async (context, request, response) => {
      try {
        ensureDirectoryExists();

        const { body: authInfo } = await context.core.opensearch.client.asCurrentUser.transport.request({
          method: 'GET',
          path: '/_plugins/_security/authinfo',
        });

        const tenant = authInfo.user_requested_tenant || DEFAULT_TENANT_NAME;

        const files = fs.readdirSync(REPORTS_DIRECTORY);
        const reports = [];

        for (const file of files) {
          if (!file.endsWith('.pdf')) continue;
          
          const filePath = path.join(REPORTS_DIRECTORY, file);
          try {
            const { tenant: fileTenant, originalName } = await extractPdfMetadata(filePath);
            
            if (fileTenant === tenant) {
              reports.push({
                fileId: path.basename(file, '.pdf'),
                name: originalName,
                creationTime: fs.statSync(filePath).ctime.toISOString(),
              });
            }
          } catch (e) {
            console.error(`Error processing ${file}:`, e);
          }
        }

        return response.ok({ body: { reports } });
      } catch (error) {
        return response.customError({
          statusCode: 500,
          body: `Error fetching reports: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  );

  router.get(
    {
      path: '/api/canvas_report_data_analyzer/download/{fileId}',
      validate: {
        params: schema.object({ fileId: schema.string() }),
      },
    },
    async (context, request, response) => {
      try {
        ensureDirectoryExists();

        const { body: authInfo } = await context.core.opensearch.client.asCurrentUser.transport.request({
          method: 'GET',
          path: '/_plugins/_security/authinfo',
        });

        const tenant = authInfo.user_requested_tenant || DEFAULT_TENANT_NAME;
        const fileId = request.params.fileId;
        const filePath = path.join(REPORTS_DIRECTORY, `${fileId}.pdf`);

        if (!fs.existsSync(filePath)) {
          return response.notFound({ body: 'File not found' });
        }

        const { tenant: fileTenant } = await extractPdfMetadata(filePath);
        if (fileTenant !== tenant) {
          return response.forbidden({ body: 'Access denied' });
        }

        const fileStream = fs.createReadStream(filePath);
        return response.ok({
          body: fileStream,
          headers: {
            'Content-Disposition': `attachment; filename="${fileId}.pdf"`,
            'Content-Type': 'application/pdf',
          },
        });
      } catch (error) {
        return response.customError({
          statusCode: 500,
          body: `Download failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  );

  router.delete(
    {
      path: '/api/canvas_report_data_analyzer/delete/{fileId}',
      validate: {
        params: schema.object({ fileId: schema.string() }),
      },
    },
    async (context, request, response) => {
      try {
        ensureDirectoryExists();

        const { body: authInfo } = await context.core.opensearch.client.asCurrentUser.transport.request({
          method: 'GET',
          path: '/_plugins/_security/authinfo',
        });

        const tenant = authInfo.user_requested_tenant || DEFAULT_TENANT_NAME;
        const fileId = request.params.fileId;
        const filePath = path.join(REPORTS_DIRECTORY, `${fileId}.pdf`);

        if (!fs.existsSync(filePath)) {
          return response.notFound({ body: 'File not found' });
        }

        const { tenant: fileTenant } = await extractPdfMetadata(filePath);
        if (fileTenant !== tenant) {
          return response.forbidden({ body: 'Access denied' });
        }

        fs.unlinkSync(filePath);
        metadataCache.delete(filePath);

        return response.ok({ body: { success: true } });
      } catch (error) {
        return response.customError({
          statusCode: 500,
          body: `Delete failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  );

  router.get(
    {
      path: '/api/canvas_report_data_analyzer/tenant',
      validate: false,
    },
    async (context, request, response) => {
      try {
        const { body: authInfo } = await context.core.opensearch.client.asCurrentUser.transport.request({
          method: 'GET',
          path: '/_plugins/_security/authinfo',
        });
        const tenantName = authInfo.user_requested_tenant || DEFAULT_TENANT_NAME;
        const username = authInfo.user_name || '';
        return response.ok({ body: { tenant: tenantName, username } });
      } catch (error) {
        return response.customError({
          statusCode: 500,
          body: `Error getting tenant: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  );

  router.post(
    {
      path: '/api/canvas_report_data_analyzer/send_email/{fileId}',
      validate: {
        params: schema.object({ fileId: schema.string() }),
        body: schema.object({
          recipients: schema.string(),
          subject: schema.string(),
          body: schema.string(),
          organization: schema.string()
        }),
      },
    },
    async (context, request, response) => {
      try {
        ensureDirectoryExists();

        const { body: authInfo } = await context.core.opensearch.client.asCurrentUser.transport.request({
          method: 'GET',
          path: '/_plugins/_security/authinfo',
        });

        const tenant = authInfo.user_requested_tenant || DEFAULT_TENANT_NAME;
        const username = authInfo.user_name || 'unknown';
        const fileId = request.params.fileId;
        const filePath = path.join(REPORTS_DIRECTORY, `${fileId}.pdf`);
        const now = Date.now();
        const lastEmailTime = emailRateLimits.get(username) || 0;
        const tenMinutes = 10 * 60 * 1000;
        
        if (now - lastEmailTime < tenMinutes) {
          const nextAvailable = new Date(lastEmailTime + tenMinutes);
          return response.forbidden({
            body: `Email sending is rate limited. You can send again after ${nextAvailable.toLocaleString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            })}`
          });
        }

        if (!fs.existsSync(filePath)) {
          return response.notFound({ body: 'File not found' });
        }

        const { tenant: fileTenant, originalName: reportTitle } = await extractPdfMetadata(filePath);
        if (fileTenant !== tenant) {
          return response.forbidden({ body: 'Access denied' });
        }

        const logoBase64 = await fileReader!.readFileAsBase64(
          config.logo_path,
          'png'
        );
        const fileContent = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);
        const smtp = config.smtp;

        const transporterOptions: any = {
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: {
            user: smtp.user,
            pass: smtp.pass,
          },
          tls: {
            rejectUnauthorized: false
          }
        };
            
        if (smtp.proxy) {
          transporterOptions.proxy = smtp.proxy;
        }

        const transporter = nodemailer.createTransport(transporterOptions);
        const emailTemplate = handlebars.compile(EMAIL_TEMPLATE);

        const htmlContent = emailTemplate({
          REPORT_TITLE: reportTitle || fileName,
          NOTE: request.body.body,
          AUTHURL: smtp.url || 'https://your-dashboards-domain.com',
          LOGO_BASE64: `data:image/png;base64,${logoBase64}`,
          ORGANIZATION: request.body.organization
        });

        const info = await transporter.sendMail({
          from: `"${request.body.organization}" <${smtp.from || 'sender@gmail.com'}>`,
          to: request.body.recipients,
          subject: request.body.subject,
          html: htmlContent,
          attachments: [
            {
              filename: fileName,
              content: fileContent,
              contentType: 'application/pdf'
            }
          ]
        });

        emailRateLimits.set(username, now);

        return response.ok({ 
          body: { 
            success: true, 
            messageId: info.messageId,
            nextAvailable: new Date(now + tenMinutes).toISOString()
          } 
        });
      } catch (error) {
        return response.customError({
          statusCode: 500,
          body: `Email sending failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  );

  router.post(
    {
      path: '/api/canvas_report_data_analyzer/query',
      validate: {
        body: schema.object({
          index: schema.string(),
          query: schema.object({}, { unknowns: 'allow' })
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { index, query } = request.body;
        
        const client = context.core.opensearch.client.asCurrentUser;
        const result = await client.search({
          index,
          body: query
        });
        
        return response.ok({ body: result.body });
      } catch (error) {
        return response.customError({
          statusCode: (typeof error === 'object' && error !== null && 'statusCode' in error && typeof (error as any).statusCode === 'number')
            ? (error as any).statusCode
            : 500,
          body: {
            message: (typeof error === 'object' && error !== null && 'message' in error) ? (error as any).message : String(error),
            stack: (typeof error === 'object' && error !== null && 'stack' in error) ? (error as any).stack : undefined
          }
        });
      }
    }
  );

  router.get(
    {
      path: '/api/canvas_report_data_analyzer/index_patterns',
      validate: false,
    },
    async (context, request, response) => {
      try {
        const authInfoResponse = await context.core.opensearch.client.asCurrentUser.transport.request({
          method: 'GET',
          path: '/_plugins/_security/authinfo',
        });
        
        const authInfo = authInfoResponse.body;
        const userRoles = authInfo.roles || [];
        const uniquePatterns = new Set<string>();
        
        for (const role of userRoles) {
          try {
            const roleResponse = await context.core.opensearch.client.asInternalUser.transport.request({
              method: 'GET',
              path: `/_plugins/_security/api/roles/${encodeURIComponent(role)}`
            });
            
            const roleDef = roleResponse.body;
            if (roleDef[role]?.index_permissions) {
              for (const permission of roleDef[role].index_permissions) {
                if (permission.index_patterns) {
                  for (const pattern of permission.index_patterns) {
                    if (!pattern.includes('$') && 
                        !pattern.includes('{') && 
                        !pattern.includes('}')) {
                      uniquePatterns.add(pattern);
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.error(`Error fetching role ${role}:`, error);
          }
        }
        
        return response.ok({ body: { index_patterns: Array.from(uniquePatterns) } });
      } catch (error) {
        return response.customError({
          statusCode: 500,
          body: `Failed to get index patterns: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  );

  router.get(
    {
      path: '/api/canvas_report_data_analyzer/fields/{indexPattern}',
      validate: {
        params: schema.object({
          indexPattern: schema.string(),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { indexPattern } = request.params;
        const client = context.core.opensearch.client.asInternalUser;
        const existsResponse = await client.indices.exists({
          index: indexPattern,
        });
        
        if (!existsResponse.body) {
          return response.ok({ 
            body: { 
              fields: [],
              warning: `No indices found for pattern: ${indexPattern}`
            } 
          });
        }
        
        const mappingResponse = await client.indices.getMapping({
          index: indexPattern,
        });
        
        const fieldTypes: Record<string, string> = {};
        for (const index of Object.keys(mappingResponse.body)) {
          const properties = mappingResponse.body[index]?.mappings?.properties || {};
          const extractTypes = (obj: any, prefix = '') => {
            for (const [key, value] of Object.entries(obj)) {
              const fullPath = prefix ? `${prefix}.${key}` : key;
              if ((value as any).properties) {
                extractTypes((value as any).properties, fullPath);
              } else if ((value as any).type) {
                fieldTypes[fullPath] = (value as any).type;
              }
            }
          };
          extractTypes(properties);
        }

        const fields = Object.entries(fieldTypes).map(([name, type]) => ({
          name,
          type,
          exists: true
        }));

        return response.ok({ body: { fields } });
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'meta' in error &&
          typeof (error as any).meta === 'object' &&
          (error as any).meta !== null &&
          'body' in (error as any).meta &&
          typeof (error as any).meta.body === 'object' &&
          (error as any).meta.body !== null &&
          'error' in (error as any).meta.body &&
          typeof (error as any).meta.body.error === 'object' &&
          (error as any).meta.body.error !== null &&
          'type' in (error as any).meta.body.error &&
          (error as any).meta.body.error.type === 'index_not_found_exception'
        ) {
          return response.ok({ 
            body: { 
              fields: [],
              warning: `No indices found matching pattern: ${request.params.indexPattern}`
            } 
          });
        }
        
        if (
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          (error as any).statusCode === 403
        ) {
          return response.forbidden({
            body: `Insufficient permissions to access index pattern: ${request.params.indexPattern}`
          });
        }
        
        return response.customError({
          statusCode: 500,
          body: `Failed to get fields: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  );

  router.get(
    {
      path: '/api/canvas_report_data_analyzer/user_roles',
      validate: false,
    },
    async (context, request, response) => {
      try {
        // Fetch the logged-in user's info
        const { body: authInfo } = await context.core.opensearch.client.asCurrentUser.transport.request({
          method: 'GET',
          path: '/_plugins/_security/authinfo',
        });

        // Extract user roles
        const roles = authInfo.roles || [];

        return response.ok({
          body: {
            roles: roles,
          },
        });
      } catch (error) {
        return response.customError({
          statusCode: (typeof error === 'object' && error !== null && 'statusCode' in error && typeof (error as any).statusCode === 'number')
            ? (error as any).statusCode
            : 500,
          body: `Error fetching user roles: ${typeof error === 'object' && error !== null && 'message' in error ? (error as any).message : String(error)}`,
        });
      }
    }
  );

  router.get(
    {
      path: '/api/canvas_report_data_analyzer/assets/logo',
      validate: false,
    },
    async (context, request, response) => {
      try {
        const logoBase64 = await fileReader!.readFileAsBase64(
          config.logo_path,
          'png'
        );
        return response.ok({
          body: { data: logoBase64 },
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return response.badRequest({ body: errorMessage });
      }
    }
  );

  router.get(
    {
      path: '/api/canvas_report_data_analyzer/assets/template',
      validate: false,
    },
    async (context, request, response) => {
      try {
        const templateBase64 = await fileReader!.readFileAsBase64(
          config.report_template_path,
          'pdf'
        );
        return response.ok({
          body: { data: templateBase64 },
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return response.badRequest({ body: errorMessage });
      }
    }
  );

  const EMAIL_TEMPLATE = `
          <!doctype html>
          <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>OpenSearch Dashboards Report: {{{REPORT_TITLE}}}</title>
            <style>
              /* -------------------------------------
                GLOBAL RESETS
                ------------------------------------- */
              img {
                max-width: 100%;
                height: auto;
                border: none;
                -ms-interpolation-mode: bicubic;
              }

              body {
                background-color: #f6f6f6;
                font-family: "Open Sans", "Inter UI", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
                -webkit-font-smoothing: antialiased;
                font-size: 14px;
                line-height: 1.4;
                margin: 0;
                padding: 0;
                width: 100% !important;
                -ms-text-size-adjust: 100%;
                -webkit-text-size-adjust: 100%;
              }

              table {
                border-collapse: separate;
                mso-table-lspace: 0pt;
                mso-table-rspace: 0pt;
                width: 100%;
              }

              table td {
                font-family: inherit;
                font-size: 14px;
                vertical-align: top;
              }

              /* -------------------------------------
                BODY & CONTAINER
                ------------------------------------- */
              .body {
                background-color: #f6f6f6;
                width: 100%;
                margin: 0;
                padding: 0;
              }

              .container {
                display: block;
                margin: 0 auto !important;
                padding: 0;
                max-width: 600px;
                width: 100%;
              }

              .content {
                box-sizing: border-box;
                display: block;
                width: 100%;
                padding: 20px;
              }

              .content-cell {
                box-sizing: border-box;
                display: block;
                width: 100%;
                padding: 10px 10px 0 10px;
              }

              .brand {
                padding: 15px 20px;
                background-color: #ffffff;
                border-top-right-radius: 5px;
                border-top-left-radius: 5px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
              }

              .brand-header {
                display: flex;
                align-items: center;
                width: 100%;
                justify-content: space-between;
              }

              .logo-container {
                flex-shrink: 0;
              }

              .logo {
                max-width: 150px;
                height: auto;
                display: block;
              }

              .title-container {
                flex-grow: 1;
                padding-left: 15px;
              }

              .title {
                font-size: 20px;
                font-weight: 700;
                color: #000000;
                margin: 0;
                line-height: 1.2;
              }

              /* -------------------------------------
                HEADER, FOOTER, MAIN
                ------------------------------------- */
              .main {
                background-color: #fff;
                border: 1px solid #D3DAE6;
                box-shadow: 0 2px 2px -1px rgba(152, 162, 179, 0.3), 0 1px 5px -2px rgba(152, 162, 179, 0.3);
                border-radius: 6px;
                overflow: hidden;
              }

              .wrapper {
                display: block;
                box-sizing: border-box;
                width: 100%;
              }

              .footer {
                clear: both;
                width: 100%;
                display: block;
                padding: 15px 0;
                text-align: center;
              }

              .footer-content {
                max-width: 600px;
                margin: 0 auto;
                padding: 0 20px;
                text-align: center;
              }

              .footer p,
              .footer a {
                color: #666666;
                font-size: 12px;
                text-align: center;
                margin: 5px 0;
              }

              /* -------------------------------------
                TYPOGRAPHY
                ------------------------------------- */
              h1, h2, h3, h4 {
                color: #000000;
                font-weight: 400;
                line-height: 1.4;
                margin: 0 0 15px 0;
              }

              p,
              ul,
              ol,
              blockquote {
                font-size: 14px;
                font-weight: normal;
                margin: 0 0 15px 0;
              }

              p li,
              ul li,
              ol li {
                list-style-position: inside;
                margin-left: 5px;
              }

              a {
                text-decoration: underline;
                color: #005180;
              }

              blockquote {
                border-left: 2px solid #A9A9A9;
                padding: 10px 15px;
                margin: 20px 0;
                background-color: #f8f9fc;
                border-radius: 4px;
              }

              /* -------------------------------------
                BUTTONS
                ------------------------------------- */
              .btn-container {
                padding: 15px 0;
                text-align: center;
              }

              .btn {
                box-sizing: border-box;
                display: inline-block;
                background-color: #0a1f72;
                background-image: linear-gradient(180deg, #005180 0, #003b5c);
                border: none;
                border-radius: 5px;
                color: #ffffff !important;
                cursor: pointer;
                font-size: 14px;
                font-weight: bold;
                margin: 0;
                padding: 12px 25px;
                text-decoration: none;
                text-transform: none;
                text-shadow: rgba(0, 0, 0, .05) 0 1px 0;
                text-align: center;
              }

              .btn:hover {
                background-color: #005180 !important;
                background-image: linear-gradient(180deg, #0071b3 0, #005180) !important;
              }

              .preheader {
                color: transparent;
                display: none;
                height: 0;
                max-height: 0;
                max-width: 0;
                opacity: 0;
                overflow: hidden;
                mso-hide: all;
                visibility: hidden;
                width: 0;
              }

              hr {
                border: 0;
                border-bottom: 1px solid #D3DAE6;
                margin: 20px 0;
              }

              /* -------------------------------------
                RESPONSIVE AND MOBILE FRIENDLY STYLES
                ------------------------------------- */
              @media only screen and (max-width: 620px) {
                .container {
                  padding: 0 10px !important;
                }
                
                .content {
                  padding: 10px !important;
                }
                
                .brand {
                  padding: 15px !important;
                  flex-direction: column;
                  align-items: flex-start;
                }
                
                .brand-header {
                  flex-direction: column;
                  align-items: flex-start;
                }
                
                .logo-container {
                  margin-bottom: 10px;
                }
                
                .title-container {
                  padding-left: 0;
                  width: 100%;
                }
                
                .title {
                  font-size: 18px !important;
                }
                
                .btn {
                  display: block;
                  width: 100%;
                  box-sizing: border-box;
                }
                
                blockquote {
                  margin: 15px 0;
                  padding: 10px;
                }
                
                .footer-content {
                  padding: 0 15px;
                }
              }

              /* -------------------------------------
                PRESERVE THESE STYLES IN THE HEAD
                ------------------------------------- */
              @media all {
                .ExternalClass {
                  width: 100%;
                }

                .ExternalClass,
                .ExternalClass p,
                .ExternalClass span,
                .ExternalClass font,
                .ExternalClass td,
                .ExternalClass div {
                  line-height: 100%;
                }

                .apple-link a {
                  color: inherit !important;
                  font-family: inherit !important;
                  font-size: inherit !important;
                  font-weight: inherit !important;
                  line-height: inherit !important;
                  text-decoration: none !important;
                }

                #MessageViewBody a {
                  color: inherit;
                  text-decoration: none;
                  font-size: inherit;
                  font-family: inherit;
                  font-weight: inherit;
                  line-height: inherit;
                }
              }
            </style>
          </head>

          <body class="body">
            <span class="preheader">A new report is available</span>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="body">
              <tr>
                <td>
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="container">
                    <tr>
                      <td>
                        <!-- START CENTERED WHITE CONTAINER -->
                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="main">
                          <!-- START MAIN CONTENT AREA -->
                          <tr>
                            <td class="wrapper">
                              <!-- Brand Header -->
                              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                  <td class="brand">
                                    <div class="brand-header">
                                      <div class="title-container">
                                        <h1 class="title">{{{ORGANIZATION}}}</h1>
                                      </div>
                                      <div class="logo-container">
                                        <img src="{{{LOGO_BASE64}}}" alt="tseclogo" class="logo" width="50" height="50">
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              </table>
                              
                              <!-- Content -->
                              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                  <td class="content-cell">
                                    <p>You have received a report with the following note:</p>
                                    <blockquote>
                                      <p>
                                        {{{NOTE}}}
                                      </p>
                                    </blockquote>
                                  </td>
                                </tr>
                              </table>
                              
                              <!-- Button -->
                              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                  <td class="btn-container">
                                    <a href="{{{AUTHURL}}}" target="_blank" class="btn">Open in Dashboards</a>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                          <!-- END MAIN CONTENT AREA -->
                          <!-- Footer -->
                          <tr>
                            <td>
                              <div class="footer" width="100%">
                                <div class="footer-content">
                                  <p>Opensearch Dashboards.</p>
                                  <p><a href="{{{AUTHURL}}}">{{{ORGANIZATION}}}</a></p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>`;
}
