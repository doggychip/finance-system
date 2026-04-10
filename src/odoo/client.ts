import { createClient, createSecureClient } from 'xmlrpc';

export interface OdooConfig {
  url: string;       // e.g. https://mycompany.odoo.com
  db: string;        // database name
  username: string;  // login email
  password: string;  // password or API key
}

interface XmlRpcClient {
  methodCall(method: string, params: unknown[], callback: (err: Error | null, result: unknown) => void): void;
}

const RPC_TIMEOUT_MS = 120000; // 120 seconds

function rpcCall(client: XmlRpcClient, method: string, params: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`XML-RPC call "${method}" timed out after ${RPC_TIMEOUT_MS / 1000}s`));
    }, RPC_TIMEOUT_MS);

    client.methodCall(method, params, (err, result) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(result);
    });
  });
}

export class OdooClient {
  private config: OdooConfig;
  private uid: number | null = null;
  private clientOptions: { host: string; port: number; rejectUnauthorized: boolean };
  private createFn: typeof createClient;

  constructor(config: OdooConfig) {
    this.config = config;

    const urlObj = new URL(config.url);
    const isSecure = urlObj.protocol === 'https:';
    const port = urlObj.port ? parseInt(urlObj.port) : (isSecure ? 443 : 80);
    this.createFn = (isSecure ? createSecureClient : createClient) as typeof createClient;

    this.clientOptions = {
      host: urlObj.hostname,
      port,
      rejectUnauthorized: true,
    };
  }

  private makeClient(path: string): XmlRpcClient {
    return this.createFn({
      ...this.clientOptions,
      path,
    }) as unknown as XmlRpcClient;
  }

  async authenticate(): Promise<number> {
    const client = this.makeClient('/xmlrpc/2/common');
    const uid = await rpcCall(client, 'authenticate', [
      this.config.db,
      this.config.username,
      this.config.password,
      {},
    ]) as number;

    if (!uid || uid === 0) {
      throw new Error('Odoo authentication failed. Check your credentials (db, username, password/API key).');
    }

    this.uid = uid;
    return uid;
  }

  async execute(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.uid) {
      await this.authenticate();
    }

    const client = this.makeClient('/xmlrpc/2/object');
    return rpcCall(client, 'execute_kw', [
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
    const client = this.makeClient('/xmlrpc/2/common');
    return await rpcCall(client, 'version', []) as Record<string, unknown>;
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
