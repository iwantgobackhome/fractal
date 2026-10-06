import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource-variable/source-serif-4';
import '../../src/design/tokens.css';
import '../../src/styles.css';
import '../../src/design/reader.css';
import { PrintView } from '../../src/reader/PrintView';
import { setLanguage } from '../../src/i18n';
import type { Block, Translation } from '@fractal/shared';
import type { PDFDocumentProxy } from '../../src/lib/pdf';

// Real KoreanPageView and print layout, with a deterministic raster source instead of PDF I/O.
const parameters = new URLSearchParams(location.search);
const mode = parameters.get('mode') === 'translation' ? 'translation' : 'split';
const count = Number(parameters.get('paragraphs') ?? 12);
setLanguage('ko');
const blocks: Block[] = [];
const translations: Translation[] = [];
for (let page = 1; page <= 2; page++) {
  for (let column = 0; column < 2; column++) {
    for (let index = 0; index < count; index++) {
      const blockId = `${page}-${column}-${index}`;
      blocks.push({
        blockId,
        paperKey: 'fixture',
        order: blocks.length,
        kind: 'paragraph',
        sourceText: 'Source paragraph',
        sourceHash: blockId,
        regions: [{ page, x: column === 0 ? 0.08 : 0.54, y: 0.1 + index * 0.02, width: 0.38, height: 0.02 }],
        alignment: 'exact',
        translatable: true,
        fontFamily: 'sans',
        fontWeight: 'normal',
        fontSize: 0.016,
        pageOrdinal: index,
      });
      translations.push({
        blockId,
        sourceHash: blockId,
        modelId: 'fixture',
        promptVersion: 'fixture',
        status: 'completed',
        text: `${page}쪽 ${column + 1}열 ${index + 1}문단. ` + '번역이 원문보다 길어지는 경우에도 모든 문단을 빠짐없이 읽을 수 있어야 합니다. '.repeat(5),
        error: null,
        completedAt: null,
      });
    }
  }
}
const doc = {
  getPage: async (page: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: ({ canvasContext, viewport }: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
      canvasContext.fillStyle = '#fff';
      canvasContext.fillRect(0, 0, viewport.width, viewport.height);
      canvasContext.fillStyle = '#222';
      canvasContext.font = `${viewport.width / 30}px sans-serif`;
      canvasContext.fillText(`Original source page ${page}`, viewport.width * 0.08, viewport.height * 0.12);
      return { promise: Promise.resolve(), cancel() {} };
    },
  }),
} as unknown as PDFDocumentProxy;
createRoot(document.getElementById('root')!).render(
  <PrintView
    mode={mode}
    doc={doc}
    pageCount={2}
    blocks={blocks}
    translations={translations}
    pageIntrinsicSize={() => ({ width: 595, height: 842 })}
    onReady={() => {
      document.body.dataset.printReady = 'true';
    }}
  />,
);
