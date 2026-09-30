import { getLanguage } from '../i18n';

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

export function fieldName(category: string): string {
  return FIELD_NAMES[category]?.[getLanguage()] ?? category;
}
