import { HttpSetup, HttpStart } from '../../../../src/core/public';

export class AssetService {
  private logoCache: string | null = null;
  private templateCache: string | null = null;

  setDependencies(http: HttpStart) {
    this.http = http;
  }

  constructor(private http: HttpSetup) {}

  async getLogo(): Promise<string> {
    if (this.logoCache) return this.logoCache;
    
    try {
      const response = await this.http.get<{ data: string }>(
        '/api/canvas_report_data_analyzer/assets/logo'
      );
      this.logoCache = response.data;
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch logo: ${message}`);
    }
  }

  async getTemplate(): Promise<string> {
    if (this.templateCache) return this.templateCache;
    
    try {
      const response = await this.http.get<{ data: string }>(
        '/api/canvas_report_data_analyzer/assets/template'
      );
      this.templateCache = response.data;
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch template: ${message}`);
    }
  }

  clearCache() {
    this.logoCache = null;
    this.templateCache = null;
  }
}