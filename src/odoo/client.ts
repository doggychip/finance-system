import { createClient } from 'xmlrpc';

export interface OdooConfig {
  url: string;       // e.g. https://mycompany.odoo.com
  db: string;        // database name
  username: string;  // login email
  password: string;  // password or API key
}

interface XmlRpcClient {
  methodCall(method: string, params: unknown[], callback: (err: Error | null, result: unknown) => void): void;
}

function rpcCall(client: XmlRpcClient, method: string, params: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

export class OdooClient {
  private config: OdooConfig;
  private uid: number | null = null;
  private commonClient: XmlRpcClient;
  private objectClient: XmlRpcClient;

  constructor(config: OdooConfig) {
    this.config = config;

    const urlObj = new URL(config.url);
    const isSecure = urlObj.protocol === 'https:';
    const port = urlObj.port ? parseInt(urlObj.port) : (isSecure ? 443 : 80);
    const createFn = isSecure ? require('xmlrpc').createSecureClient : createClient;

    this.commonClient = createFn({
      host: urlObj.hostname,
      port,
      path: '/xmlrpc/2/common',
    });

    this.objectClient = createFn({
      host: urlObj.hostname,
      port,
      path: '/xmlrpc/2/object',
    });
  }

  async authenticate(): Promise<number> {
    const uid = await rpcCall(this.commonClient, 'authenticate', [
      this.config.db,
      this.config.username,
      this.config.password,
      {},
    ]) as number;

    if (!uid || uid === 0) {
      throw new Error('Odoo authentication failed. Check your credentials.');
    }

    this.uid = uid;
    return uid;
  }

  async execute(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.uid) {
      await this.authenticate();
    }

    return rpcCall(this.objectClient, 'execute_kw', [
      this.config.db,
      this.uid,
      this.config.password,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  async search(model: string, domain: unknown[][], options: { limit?: number; offset?: number; order?: string } = {}): Promise<number[]> {
    return await this.execute(model, 'search', [domain], options) as number[];
  }

  async searchRead(
    model: string,
    domain: unknown[][],
    fields: string[],
    options: { limit?: number; offset?: number; order?: string } = {}
  ): Promise<Record<string, unknown>[]> {
    return await this.execute(model, 'search_read', [domain], {
      fields,
      ...options,
    }) as Record<string, unknown>[];
  }

  async read(model: string, ids: number[], fields: string[]): Promise<Record<string, unknown>[]> {
    return await this.execute(model, 'read', [ids], { fields }) as Record<string, unknown>[];
  }

  async searchCount(model: string, domain: unknown[][]): Promise<number> {
    return await this.execute(model, 'search_count', [domain]) as number;
  }

  async version(): Promise<Record<string, unknown>> {
    return await rpcCall(this.commonClient, 'version', []) as Record<string, unknown>;
  }

  getUid(): number | null {
    return this.uid;
  }
}

export function createOdooClient(): OdooClient {
  const url = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const username = process.env.ODOO_USERNAME;
  const password = process.env.ODOO_PASSWORD;

  if (!url || !db || !username || !password) {
    throw new Error(
      'Missing Odoo configuration. Set ODOO_URL, ODOO_DB, ODOO_USERNAME, and ODOO_PASSWORD environment variables.'
    );
  }

  return new OdooClient({ url, db, username, password });
}
