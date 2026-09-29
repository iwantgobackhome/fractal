/** Korean names for the arXiv categories researchers pick most often. */
export const FIELD_NAMES: Record<string, string> = {
  'cs.AI': '인공지능',
  'cs.CL': '자연어 처리',
  'cs.CV': '컴퓨터 비전',
  'cs.LG': '기계 학습',
  'cs.RO': '로보틱스',
  'cs.IR': '정보 검색',
  'cs.HC': '인간-컴퓨터 상호작용',
  'cs.CR': '보안',
  'cs.DC': '분산 컴퓨팅',
  'cs.SE': '소프트웨어 공학',
  'cs.NE': '신경·진화 계산',
  'cs.SD': '음향',
  'cs.GR': '그래픽스',
  'stat.ML': '통계적 기계 학습',
  'eess.IV': '영상·비디오 처리',
  'eess.AS': '음성·오디오 처리',
  'eess.SP': '신호 처리',
  'math.OC': '최적화·제어',
  'q-bio.NC': '신경과학',
  'q-bio.QM': '정량 생물학',
  'physics.comp-ph': '계산 물리',
  'cond-mat.mtrl-sci': '재료 과학',
  'quant-ph': '양자 물리',
};

export const COMMON_FIELDS = ['cs.LG', 'cs.CL', 'cs.CV', 'cs.AI', 'cs.RO', 'stat.ML', 'eess.IV', 'cs.IR', 'cs.HC', 'q-bio.NC', 'quant-ph', 'cond-mat.mtrl-sci'];

export function fieldName(category: string): string {
  return FIELD_NAMES[category] ?? category;
}
