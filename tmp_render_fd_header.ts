import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDocx } from './packages/ooxml-core/src/index.ts';
import { buildDocModel } from './packages/doc-model/src/index.ts';
import { DocxEditorViewer, useDocxEditor } from './packages/react-viewer/src/editor.tsx';

function ImportedViewer({ model }: { model: Awaited<ReturnType<typeof buildDocModel>> }) {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, { editor, mode: 'read-only' });
}

(async () => {
  const zip = readFileSync('/Users/andrewluo/Documents/DOCX testing/2026-04-03_14-45-42/fd29deb939afe8b33f66f2431738a90cac3b1c1de79d6aa0da4a227c40d7322b.docx');
  const pkg = await parseDocx(zip);
  const model = buildDocModel(pkg);
  const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
  const idx = html.indexOf('width:5px');
  console.log(html.slice(Math.max(0, idx - 1000), Math.min(html.length, idx + 1600)));
})();
