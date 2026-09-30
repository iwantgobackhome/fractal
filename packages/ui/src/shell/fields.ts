import { getLanguage } from '../i18n';
import type { ArxivCategory } from './hub-api';

/** Names for the arXiv categories researchers pick most often, per interface language. */
const FIELD_NAMES: Record<string, { ko: string; en: string }> = {
  'cs.AI': { ko: '인공지능', en: 'Artificial intelligence' },
  'cs.CL': { ko: '자연어 처리', en: 'Computation and language' },
  'cs.CV': { ko: '컴퓨터 비전', en: 'Computer vision' },
  'cs.LG': { ko: '기계 학습', en: 'Machine learning' },
  'cs.RO': { ko: '로보틱스', en: 'Robotics' },
  'cs.IR': { ko: '정보 검색', en: 'Information retrieval' },
  'cs.HC': { ko: '인간-컴퓨터 상호작용', en: 'Human-computer interaction' },
  'cs.CR': { ko: '보안', en: 'Security' },
  'cs.DC': { ko: '분산 컴퓨팅', en: 'Distributed computing' },
  'cs.SE': { ko: '소프트웨어 공학', en: 'Software engineering' },
  'cs.NE': { ko: '신경·진화 계산', en: 'Neural and evolutionary computing' },
  'cs.SD': { ko: '음향', en: 'Sound' },
  'cs.GR': { ko: '그래픽스', en: 'Graphics' },
  'stat.ML': { ko: '통계적 기계 학습', en: 'Statistical machine learning' },
  'eess.IV': { ko: '영상·비디오 처리', en: 'Image and video processing' },
  'eess.AS': { ko: '음성·오디오 처리', en: 'Audio and speech processing' },
  'eess.SP': { ko: '신호 처리', en: 'Signal processing' },
  'math.OC': { ko: '최적화·제어', en: 'Optimization and control' },
  'q-bio.NC': { ko: '신경과학', en: 'Neurons and cognition' },
  'q-bio.QM': { ko: '정량 생물학', en: 'Quantitative methods' },
  'physics.comp-ph': { ko: '계산 물리', en: 'Computational physics' },
  'cond-mat.mtrl-sci': { ko: '재료 과학', en: 'Materials science' },
  'quant-ph': { ko: '양자 물리', en: 'Quantum physics' },
};

export const COMMON_FIELDS = ['cs.LG', 'cs.CL', 'cs.CV', 'cs.AI', 'cs.RO', 'stat.ML', 'eess.IV', 'cs.IR', 'cs.HC', 'q-bio.NC', 'quant-ph', 'cond-mat.mtrl-sci'];

/** The full arXiv list once the hub has sent it; until then, the common fields above. */
const registry = new Map<string, ArxivCategory>();

export function registerCategories(categories: ArxivCategory[]): void {
  for (const category of categories) registry.set(category.code, category);
}

/** Every category this client knows, the hub's full list when it has arrived. */
export function knownCategories(): ArxivCategory[] {
  if (registry.size > 0) return [...registry.values()];
  return Object.entries(FIELD_NAMES).map(([code, name]) => ({ code, group: code.split('.')[0] ?? code, name }));
}

export function fieldName(category: string): string {
  return registry.get(category)?.name[getLanguage()] ?? FIELD_NAMES[category]?.[getLanguage()] ?? category;
}

function fold(value: string): string {
  return value.toLocaleLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** Categories matching what the reader typed, best first: code, then name starts, then contains. */
export function searchCategories(query: string, limit = 8): ArxivCategory[] {
  const q = fold(query);
  if (q === '') return [];
  const scored: { category: ArxivCategory; score: number }[] = [];
  for (const category of knownCategories()) {
    const code = fold(category.code);
    const names = [fold(category.name.ko), fold(category.name.en)];
    let score = 0;
    if (code === q) score = 100;
    else if (code.startsWith(q)) score = 80;
    else if (names.some((n) => n === q)) score = 90;
    else if (names.some((n) => n.startsWith(q))) score = 70;
    else if (names.some((n) => n.split(/[\s·,-]+/).some((word) => word.startsWith(q)))) score = 50;
    else if (names.some((n) => n.includes(q)) || code.includes(q)) score = 30;
    if (score > 0) scored.push({ category, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.category.code.localeCompare(b.category.code))
    .slice(0, limit)
    .map((s) => s.category);
}
