export { augmentCliPath } from './ai/cli-paths';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Block, Paper } from '@fractal/shared';
import { PaperStore } from './store/index';
import { SqlitePaperStore } from './store/sqlite';
import { configureLibrarySearch } from './library/search';
import { JobManager } from './jobs/state';
import { CodexTranslator, createOfficialRpcFactory } from './codex/index';
import { startOfficialRpc } from './codex/runtime';
import { CodexProvider } from './ai/codex';
import { ClaudeProvider } from './ai/claude';
import { AccountManager, type AccountCli } from './ai/accounts';
import { ProviderInstallManager } from './ai/install';
import { ProviderRegistry } from './ai/registry';
import { JsonSettingsStore } from './ai/settings';
import { FtsLibrarySearch } from './ai/library-search';
import { RegistryLegacyAdapter } from './ai/legacy-adapter';
import { JsonUsageStore } from './ai/usage';
import { TranslationPipeline, type PipelineLogEvent } from './translation/index';
import { LOOPBACK, createApiServer, type ApiLogEvent, type ApiServer, type PaperAcquirer } from './api/index';
import { acquirePaper, resolveArxiv } from './arxiv/acquire';
import { normalizeArxiv } from './arxiv/index';
import { extractPublication, identifyPublication, loadPublication } from './publication/index';
import type { PublicNetworkOptions } from './publication/network';
import { extractPdf, inferTitle } from './pdf/index';
import { JsonDeviceStore } from './pairing/store';
import { PairingSessions } from './pairing/session';
import { NetworkManager } from './net/manager';
import { FeedService } from './feed/index';
import { hostname } from 'node:os';

/**
 * App-owned data folder. Deliberately outside the source tree and outside the
 * browser's storage, so clearing the browser cache never loses a translation.
 */
export function defaultDataDirectory(): string {
  const base =
    process.env.FRACTAL_DATA ??
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'News Papers')
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'news-papers'));
  return resolve(base);
}

/**
 * arXiv revisions and public HTTPS PDF URLs use separate immutable identities.
 *
 * `resolve` pins the arXiv revision or the public PDF URL and content hash.
 * `acquire` extracts afterwards and rejects bytes that changed since resolve.
 * Input is validated as an identifier or a public URL, never a command string.
 */
export function realAcquirer(directory: string, publicationOptions: PublicNetworkOptions = {}): PaperAcquirer {
  const isPublicationUrl = (input: string) =>
    /^https?:\/\//i.test(input.trim()) && !/^https?:\/\/(?:arxiv\.org|export\.arxiv\.org)(?:[/:]|$)/i.test(input.trim());
  return {
    identify(input: string): string | null {
      const publicationKey = identifyPublication(input.trim());
      if (publicationKey !== null) return publicationKey;
      try {
        const id = normalizeArxiv(input);
        return id.version === null ? null : id.paperKey;
      } catch {
        return null;
      }
    },
    async resolve(input: string): Promise<Paper> {
      if (isPublicationUrl(input)) return (await loadPublication(input, publicationOptions)).paper;
      return resolveArxiv(input);
    },
    async acquire(paperKey: string, input: string): Promise<{ paper: Paper; blocks: Block[]; pdf: Buffer }> {
      if (identifyPublication(paperKey) !== null) return extractPublication(await loadPublication(input, publicationOptions), paperKey);
      // Re-resolving from the pinned key keeps the revision fixed even when the
      // user typed a version-less address.
      const result = await acquirePaper(paperKey, { directory });
      const pdf = readFileSync(result.pdfPath);
      // arXiv metadata wins; the page-1 heading only fills a title the entry did not give.
      return { paper: { ...result.paper, title: result.paper.title ?? inferTitle(result.blocks) }, blocks: result.blocks, pdf };
    },
    async reextract(paper: Paper, pdf: Buffer): Promise<{ paper: Paper; blocks: Block[] }> {
      const { blocks, coverage, extractionVersion } = await extractPdf(pdf, paper.paperKey);
      return {
        blocks,
        paper: {
          ...paper,
          title: paper.title ?? inferTitle(blocks),
          pageCount: coverage.totalPages,
          coverage,
          extractionVersion,
          status:
            coverage.textPages === 0
              ? 'unsupported'
              : coverage.unsupportedPages.length || blocks.some((block) => block.kind === 'unsupported')
                ? 'partial'
                : 'ready',
        },
      };
    },
  };
}

/**
 * Stored revisions from before titles were kept show their paper key in the library. Give
 * each readable one without a title the page-1 heading, once, at start. Real metadata is not
 * fetched here: this touches no network and never overwrites a stored title.
 */
export function backfillTitles(store: PaperStore): number {
  let updated = 0;
  for (const key of store.listPapers()) {
    const paper = store.getPaper(key);
    if (paper === null || paper.title !== null) continue;
    if (paper.status !== 'ready' && paper.status !== 'partial') continue;
    const title = inferTitle(store.listBlocks(key));
    if (title === null) continue;
    try {
      store.savePaper({ ...paper, title });
      updated += 1;
    } catch {
      /* a title is a convenience; a storage fault surfaces on the paper's own routes */
    }
  }
  return updated;
}

export type ServiceLogEvent =
  ApiLogEvent | PipelineLogEvent | { event: 'service.port-busy'; port: number; source: 'persisted' | 'default'; code: 'EADDRINUSE' };

export interface ServiceOptions {
  dataDirectory?: string;
  port?: number;
  /** Reuse the data directory's port when no explicit port is supplied. */
  persistPort?: boolean;
  /** Absolute path to the client entry document, when one should be served. */
  indexHtml?: string;
  log?: (event: ServiceLogEvent) => void;
  bindAddresses?: string[];
  /** Tests default to no real CLI subprocesses; opt in only for an explicit integration probe. */
  allowRealCli?: boolean;
  /** Tests default to no scheduled feed refresh. */
  startBackground?: boolean;
  /** Injected network for shutdown tests and offline integrations. */
  fetcher?: typeof fetch;
}

export interface Service {
  server: ApiServer;
  store: PaperStore;
  jobs: JobManager;
  url: string;
  token: string;
  dataDirectory: string;
  pairing: PairingSessions;
  network: NetworkManager;
  stop(): Promise<void>;
}

/**
 * Bring up the whole local service: storage, job state, the official Codex
 * translator, the sequential pipeline and the loopback HTTP API.
 *
 * Interrupted jobs are recovered inside `listen`, before the first request is
 * answered, so a hard kill never leaves a job claiming to be running.
 */
/**
 * Serves the built client's asset files from one directory.
 *
 * Path containment is explicit: only a single flat name is accepted, and the
 * resolved path must still sit inside the asset directory. A request can never
 * reach an app data file, a source file, or anything outside the build output.
 */
export function servedAssets(assetDirectory: string) {
  const root = resolve(assetDirectory);
  const types: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.png': 'image/png',
  };
  return async (segments: string[]): Promise<{ body: Buffer; contentType: string } | null> => {
    if (segments.length !== 1) return null;
    const name = segments[0]!;
    if (name === '' || name === '.' || name === '..' || /[\\/]/.test(name)) return null;
    const target = resolve(root, name);
    if (target !== join(root, name)) return null;
    const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
    const contentType = types[extension];
    if (contentType === undefined) return null;
    try {
      return { body: await readFile(target), contentType };
    } catch {
      return null;
    }
  };
}

export async function startService(options: ServiceOptions = {}): Promise<Service> {
  const inTest = process.env.VITEST !== undefined || process.env.NODE_ENV === 'test';
  const serviceShutdown = new AbortController();
  const allowRealCli = options.allowRealCli ?? !inTest;
  const startBackground = options.startBackground ?? !inTest;
  const disabledCli: AccountCli = {
    probe: async () => {
      throw new Error('CLI probes are disabled in tests');
    },
    login: async () => {
      throw new Error('CLI login is disabled in tests');
    },
  };
  const dataDirectory = options.dataDirectory ?? defaultDataDirectory();
  const legacyDirectory =
    process.env.PAPERREAD_DATA ??
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'PaperRead')
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'paperread'));
  const store = new SqlitePaperStore(dataDirectory, legacyDirectory);
  store.ensureRoot();
  configureLibrarySearch(store);
  backfillTitles(store);
  const jobs = new JobManager(store);
  // The official process uses the same Codex login as the user's terminal.
  let aiRegistry: ProviderRegistry;
  let translator: CodexTranslator;
  let pipeline: TranslationPipeline;
  let aiAdapter: RegistryLegacyAdapter;
  const accounts = new AccountManager(
    store,
    dataDirectory,
    async (provider) => {
      pipeline.abortAll();
      const deadline = Date.now() + 30_000;
      while (jobs.currentActive() && pipeline.isRunning(jobs.currentActive()!.jobId)) {
        if (Date.now() > deadline) throw Object.assign(new Error('Translation is still stopping'), { code: 'BUSY' });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await aiRegistry.waitIdle(provider);
      if (provider === 'codex') await aiAdapter.waitIdle();
      if (provider === 'codex') await translator.disconnect();
    },
    allowRealCli ? undefined : disabledCli,
    allowRealCli
      ? undefined
      : async () => {
          throw new Error('Claude usage is disabled in tests');
        },
  );
  const installer = new ProviderInstallManager();
  const official = createOfficialRpcFactory(() =>
    allowRealCli
      ? startOfficialRpc(accounts.activeEnvironment('codex'), serviceShutdown.signal)
      : Promise.reject(Object.assign(new Error('Codex CLI is disabled in tests'), { code: 'UNSAFE_RUNTIME' })),
  );
  translator = new CodexTranslator(official);
  const claude = new ClaudeProvider(
    allowRealCli
      ? undefined
      : () => {
          throw new Error('Claude CLI is disabled in tests');
        },
    allowRealCli
      ? undefined
      : async () => {
          throw new Error('Claude CLI is disabled in tests');
        },
    () => accounts.activeEnvironment('claude'),
    serviceShutdown.signal,
  );
  claude.onRateLimit = (event) => accounts.observeClaude(accounts.active('claude').id, event);
  aiRegistry = new ProviderRegistry(
    [new CodexProvider(translator, undefined, serviceShutdown.signal), claude],
    new JsonSettingsStore(dataDirectory),
    undefined,
    new JsonUsageStore(dataDirectory),
  );
  aiRegistry.onUsageRecorded = (provider) => accounts.requestRefresh(accounts.active(provider).id, true);
  aiAdapter = new RegistryLegacyAdapter(aiRegistry, translator);
  const log = options.log ?? ((event) => process.stdout.write(`${JSON.stringify(event)}\n`));
  // Isolation evidence that outlived its turn still ends the process (CodexTranslator); here it is
  // also recorded, with the path only — never any provider text.
  translator.onLateBreach = (path) => log({ event: 'codex', action: 'late-breach', path, code: 'UNSAFE_RUNTIME' });
  pipeline = new TranslationPipeline({ store, jobs, translator: aiAdapter, log });
  const devices = new JsonDeviceStore(dataDirectory);
  let apiServer: ApiServer | undefined;
  const network = new NetworkManager(
    dataDirectory,
    () => apiServer?.address()?.port ?? options.port ?? 0,
    (addresses) => apiServer!.bind(addresses),
  );
  const pairing = new PairingSessions(devices, hostname(), () => {
    const port = apiServer?.address()?.port ?? options.port ?? 0;
    // The QR advertises only enabled remote listeners.
    return network.statusSyncUrls(port);
  });

  const acquirer = realAcquirer(join(dataDirectory, '.pdf-cache'));
  const feed = new FeedService(store, acquirer, aiRegistry, options.fetcher ?? fetch, undefined, undefined, dataDirectory);

  const server = createApiServer({
    store,
    jobs,
    translator: aiAdapter,
    pipeline,
    // The same official process answers the reader's paper questions, on its own tool-less
    // threads; the translation pipeline never receives this path.
    paperChat: aiAdapter,
    aiRegistry,
    accounts,
    installer: allowRealCli ? installer : undefined,
    librarySearch: new FtsLibrarySearch(store),
    acquirer,
    feed,
    log,
    devices,
    pairing,
    network,
    clientHtml: options.indexHtml === undefined ? undefined : () => readFileSync(options.indexHtml!, 'utf8'),
    clientAssets: options.indexHtml === undefined ? undefined : servedAssets(join(dirname(resolve(options.indexHtml)), 'assets')),
  });
  apiServer = server;

  const portPath = join(dataDirectory, 'hub-port.json');
  const persistPort = options.persistPort === true && options.port === undefined;
  let port = options.port ?? 0;
  let source: 'persisted' | 'default' = 'default';
  if (persistPort) {
    port = 7327;
    try {
      const saved = JSON.parse(await readFile(portPath, 'utf8')) as { port?: number };
      if (Number.isSafeInteger(saved.port) && saved.port! > 0 && saved.port! <= 65535) {
        port = saved.port!;
        source = 'persisted';
      }
    } catch {
      // Missing or invalid settings use the CLI's default port.
    }
  }
  const address = await server.listen(port, LOOPBACK).catch(async (cause: unknown) => {
    if (!persistPort || (cause as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw cause;
    log({ event: 'service.port-busy', port, source, code: 'EADDRINUSE' });
    return server.listen(0, LOOPBACK);
  });
  if (persistPort) {
    const temporary = `${portPath}.tmp`;
    await writeFile(temporary, JSON.stringify({ port: address.port }) + '\n');
    await rename(temporary, portPath);
  }
  if (options.bindAddresses !== undefined) network.configureExplicit(options.bindAddresses);
  await network.apply();
  if (startBackground) feed.start();
  return {
    server,
    store,
    jobs,
    url: `http://${LOOPBACK}:${address.port}`,
    token: server.token,
    dataDirectory,
    pairing,
    network,
    async stop() {
      serviceShutdown.abort();
      const accountsStopped = accounts.stop();
      await feed.stop();
      await accountsStopped;
      await server.close();
      installer.stop();
      await translator.disconnect();
      store.db.close();
    },
  };
}

/** Stable embedding API used by Electron and other local hosts. */
export async function startHub(options: ServiceOptions = {}): Promise<{ url: string; close(): Promise<void>; service: Service }> {
  const service = await startService({ ...options, persistPort: options.persistPort ?? true });
  return { url: service.url, close: () => service.stop(), service };
}

/** True when this module is the process entry point (not an import from a test). */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return resolve(entry) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const port = Number(process.env.PAPERREAD_PORT ?? 7327);
  startService({
    port: Number.isSafeInteger(port) && port >= 0 ? port : 7327,
    indexHtml: process.env.PAPERREAD_INDEX ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/dist/index.html'),
  })
    .then((service) => {
      process.stdout.write(`${JSON.stringify({ event: 'service.ready', url: service.url, dataDirectory: service.dataDirectory })}\n`);
      const stop = () => {
        void service.stop().finally(() => process.exit(0));
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((cause) => {
      process.stderr.write(`${JSON.stringify({ event: 'service.failed', message: (cause as Error).message })}\n`);
      process.exit(1);
    });
}

export default startService;
