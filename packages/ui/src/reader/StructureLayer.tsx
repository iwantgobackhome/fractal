import type { JSX } from 'react';
import type { CitationMarker, StructureItem } from '@fractal/shared';

const KIND_LABEL: Record<StructureItem['kind'], string> = { figure: '그림', table: '표', equation: '수식' };

interface Props {
  items: StructureItem[];
  markers: CitationMarker[];
  onExplain(item: StructureItem, anchor: DOMRect): void;
  onCitation(marker: CitationMarker, anchor: DOMRect): void;
}

const box = (b: { x: number; y: number; width: number; height: number }) => ({
  left: `${b.x * 100}%`,
  top: `${b.y * 100}%`,
  width: `${b.width * 100}%`,
  height: `${b.height * 100}%`,
});

/**
 * What Fractal recognised on one page. Figures, tables and equations show a thin frame
 * and a small 설명 tab only while the pointer is over them; citation numbers become
 * quiet targets that open the reference.
 */
export function StructureLayer({ items, markers, onExplain, onCitation }: Props): JSX.Element {
  return (
    <div className="structure-layer">
      {items.map((item) => (
        <div key={item.id} className={`structure-item structure-item--${item.kind}`} style={box(item.bbox)}>
          <button
            type="button"
            className="structure-item__explain"
            aria-label={`${item.label || KIND_LABEL[item.kind]} 설명`}
            onClick={(event) => onExplain(item, (event.currentTarget.parentElement ?? event.currentTarget).getBoundingClientRect())}
          >
            설명
          </button>
        </div>
      ))}
      {markers.map((marker) => (
        <button
          key={marker.id}
          type="button"
          className="citation-marker"
          style={box(marker.bbox)}
          aria-label={`참고문헌 ${marker.references.join(', ')}`}
          onClick={(event) => onCitation(marker, event.currentTarget.getBoundingClientRect())}
        />
      ))}
    </div>
  );
}

export { KIND_LABEL };
