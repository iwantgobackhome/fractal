import { arxivCategories } from './arxiv';

export interface FieldNewsKeywords {
  en: string[];
  ko: string[];
}

/** Short phrases used for news discovery and relevance, separate from arXiv's formal names. */
export const arxivNewsKeywords: Record<string, FieldNewsKeywords> = {
  'cs.AI': { en: ['artificial intelligence', 'generative AI'], ko: ['인공지능', '생성형 AI'] },
  'cs.CL': { en: ['natural language processing', 'language model'], ko: ['자연어 처리', '언어 모델'] },
  'cs.CR': { en: ['cybersecurity', 'computer security'], ko: ['사이버 보안', '정보 보안'] },
  'cs.CV': { en: ['computer vision', 'image recognition'], ko: ['컴퓨터 비전', '영상 인식'] },
  'cs.HC': { en: ['human computer interaction', 'user interface'], ko: ['인간 컴퓨터 상호작용', '사용자 인터페이스'] },
  'cs.LG': { en: ['machine learning', 'deep learning'], ko: ['기계 학습', '머신러닝'] },
  'cs.RO': { en: ['robotics', 'robot'], ko: ['로봇', '로보틱스'] },
  'cs.SE': { en: ['software engineering', 'software development'], ko: ['소프트웨어 공학', '소프트웨어 개발'] },
  'eess.IV': { en: ['image processing', 'video processing'], ko: ['영상 처리', '이미지 처리'] },
  'q-bio.GN': { en: ['genomics', 'genome research'], ko: ['유전체', '유전체 연구'] },
  'quant-ph': { en: ['quantum physics', 'quantum computing'], ko: ['양자 물리', '양자 컴퓨팅'] },
  'stat.ML': { en: ['machine learning', 'statistical learning'], ko: ['기계 학습', '통계 학습'] },
};

export function newsKeywordsForCategory(code: string): FieldNewsKeywords {
  const curated = arxivNewsKeywords[code];
  if (curated) return curated;
  const category = arxivCategories.find((item) => item.code === code);
  if (!category) return { en: [code], ko: [code] };
  const shortenedEnglish = category.name.en.split(/,| and | - /i)[0]!.trim();
  const shortenedKorean = category.name.ko.split(/[·ㆍ,]/)[0]!.trim();
  return { en: [shortenedEnglish], ko: [shortenedKorean] };
}
