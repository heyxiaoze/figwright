// Ambient declaration for the optional `ssh2-sftp-client` dependency.
// It is loaded via a dynamic `import()` in transfer.ts, so the server builds and typechecks
// without the package installed. Selecting SFTP mode without installing it yields a clear
// runtime error instead. Users opt in by running `pnpm --filter @figwright/mcp add ssh2-sftp-client`.
declare module 'ssh2-sftp-client' {
  interface ConnectOptions {
    host: string;
    port?: number;
    username: string;
    password: string;
    [key: string]: unknown;
  }

  class Client {
    connect(options: ConnectOptions): Promise<void>;
    end(): Promise<void>;
    mkdir(path: string, recursive?: boolean): Promise<void>;
    put(input: Buffer | NodeJS.ReadableStream, remotePath: string): Promise<void>;
    get(remotePath: string): Promise<Buffer | NodeJS.ReadableStream>;
    delete(remotePath: string): Promise<void>;
  }

  export default Client;
}
