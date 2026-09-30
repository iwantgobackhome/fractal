/** Official arXiv category taxonomy: https://arxiv.org/category_taxonomy (checked 2026-09-30). */
export interface ArxivCategory {
  code: string;
  group: string;
  name: { en: string; ko: string };
}
export interface ArxivGroup {
  id: string;
  name: { en: string; ko: string };
}

export const arxivGroups: ArxivGroup[] = [
  ['cs', 'Computer Science', '컴퓨터 과학'],
  ['econ', 'Economics', '경제학'],
  ['eess', 'Electrical Engineering and Systems Science', '전기공학·시스템 과학'],
  ['math', 'Mathematics', '수학'],
  ['astro-ph', 'Astrophysics', '천체물리학'],
  ['cond-mat', 'Condensed Matter', '응집물질물리학'],
  ['gr-qc', 'General Relativity and Quantum Cosmology', '일반상대성이론·양자우주론'],
  ['hep-ex', 'High Energy Physics - Experiment', '고에너지물리학 실험'],
  ['hep-lat', 'High Energy Physics - Lattice', '고에너지물리학 격자'],
  ['hep-ph', 'High Energy Physics - Phenomenology', '고에너지물리학 현상론'],
  ['hep-th', 'High Energy Physics - Theory', '고에너지물리학 이론'],
  ['math-ph', 'Mathematical Physics', '수리물리학'],
  ['nlin', 'Nonlinear Sciences', '비선형 과학'],
  ['nucl-ex', 'Nuclear Experiment', '핵물리학 실험'],
  ['nucl-th', 'Nuclear Theory', '핵물리학 이론'],
  ['physics', 'Physics', '물리학'],
  ['quant-ph', 'Quantum Physics', '양자물리학'],
  ['q-bio', 'Quantitative Biology', '정량생물학'],
  ['q-fin', 'Quantitative Finance', '정량금융'],
  ['stat', 'Statistics', '통계학'],
].map(([id, en, ko]) => ({ id, name: { en, ko } }));

const rows = `
cs.AI|Artificial Intelligence|인공지능
cs.AR|Hardware Architecture|하드웨어 구조
cs.CC|Computational Complexity|계산 복잡도
cs.CE|Computational Engineering, Finance, and Science|계산 공학·금융·과학
cs.CG|Computational Geometry|계산기하학
cs.CL|Computation and Language|전산언어학
cs.CR|Cryptography and Security|암호학·보안
cs.CV|Computer Vision and Pattern Recognition|컴퓨터 비전·패턴 인식
cs.CY|Computers and Society|컴퓨터와 사회
cs.DB|Databases|데이터베이스
cs.DC|Distributed, Parallel, and Cluster Computing|분산·병렬·클러스터 컴퓨팅
cs.DL|Digital Libraries|디지털 도서관
cs.DM|Discrete Mathematics|이산수학
cs.DS|Data Structures and Algorithms|자료구조·알고리즘
cs.ET|Emerging Technologies|신기술
cs.FL|Formal Languages and Automata Theory|형식언어·오토마타 이론
cs.GL|General Literature|일반 문헌
cs.GR|Graphics|컴퓨터 그래픽스
cs.GT|Computer Science and Game Theory|컴퓨터 과학·게임 이론
cs.HC|Human-Computer Interaction|인간·컴퓨터 상호작용
cs.IR|Information Retrieval|정보 검색
cs.IT|Information Theory|정보 이론
cs.LG|Machine Learning|기계학습
cs.LO|Logic in Computer Science|컴퓨터 과학의 논리
cs.MA|Multiagent Systems|다중 에이전트 시스템
cs.MM|Multimedia|멀티미디어
cs.MS|Mathematical Software|수학 소프트웨어
cs.NA|Numerical Analysis|수치해석
cs.NE|Neural and Evolutionary Computing|신경·진화 컴퓨팅
cs.NI|Networking and Internet Architecture|네트워킹·인터넷 구조
cs.OH|Other Computer Science|기타 컴퓨터 과학
cs.OS|Operating Systems|운영체제
cs.PF|Performance|성능 분석
cs.PL|Programming Languages|프로그래밍 언어
cs.RO|Robotics|로봇공학
cs.SC|Symbolic Computation|기호 계산
cs.SD|Sound|음향
cs.SE|Software Engineering|소프트웨어 공학
cs.SI|Social and Information Networks|사회·정보 네트워크
cs.SY|Systems and Control|시스템·제어
econ.EM|Econometrics|계량경제학
econ.GN|General Economics|일반 경제학
econ.TH|Theoretical Economics|이론 경제학
eess.AS|Audio and Speech Processing|오디오·음성 처리
eess.IV|Image and Video Processing|영상·비디오 처리
eess.SP|Signal Processing|신호 처리
eess.SY|Systems and Control|시스템·제어
math.AC|Commutative Algebra|가환대수학
math.AG|Algebraic Geometry|대수기하학
math.AP|Analysis of PDEs|편미분방정식 해석
math.AT|Algebraic Topology|대수위상수학
math.CA|Classical Analysis and ODEs|고전해석학·상미분방정식
math.CO|Combinatorics|조합론
math.CT|Category Theory|범주론
math.CV|Complex Variables|복소변수론
math.DG|Differential Geometry|미분기하학
math.DS|Dynamical Systems|동역학계
math.FA|Functional Analysis|함수해석학
math.GM|General Mathematics|일반 수학
math.GN|General Topology|일반위상수학
math.GR|Group Theory|군론
math.GT|Geometric Topology|기하위상수학
math.HO|History and Overview|수학사·개관
math.IT|Information Theory|정보 이론
math.KT|K-Theory and Homology|K이론·호몰로지
math.LO|Logic|수리논리학
math.MG|Metric Geometry|거리기하학
math.MP|Mathematical Physics|수리물리학
math.NA|Numerical Analysis|수치해석
math.NT|Number Theory|정수론
math.OA|Operator Algebras|작용소대수
math.OC|Optimization and Control|최적화·제어
math.PR|Probability|확률론
math.QA|Quantum Algebra|양자대수학
math.RA|Rings and Algebras|환·대수
math.RT|Representation Theory|표현론
math.SG|Symplectic Geometry|심플렉틱 기하학
math.SP|Spectral Theory|스펙트럼 이론
math.ST|Statistics Theory|통계 이론
astro-ph.CO|Cosmology and Nongalactic Astrophysics|우주론·은하외 천체물리학
astro-ph.EP|Earth and Planetary Astrophysics|지구·행성 천체물리학
astro-ph.GA|Astrophysics of Galaxies|은하 천체물리학
astro-ph.HE|High Energy Astrophysical Phenomena|고에너지 천체 현상
astro-ph.IM|Instrumentation and Methods for Astrophysics|천체물리 관측 장비·방법
astro-ph.SR|Solar and Stellar Astrophysics|태양·항성 천체물리학
cond-mat.dis-nn|Disordered Systems and Neural Networks|무질서계·신경망
cond-mat.mes-hall|Mesoscale and Nanoscale Physics|중간척도·나노척도 물리학
cond-mat.mtrl-sci|Materials Science|재료과학
cond-mat.other|Other Condensed Matter|기타 응집물질
cond-mat.quant-gas|Quantum Gases|양자 기체
cond-mat.soft|Soft Condensed Matter|연성 응집물질
cond-mat.stat-mech|Statistical Mechanics|통계역학
cond-mat.str-el|Strongly Correlated Electrons|강상관 전자계
cond-mat.supr-con|Superconductivity|초전도
gr-qc|General Relativity and Quantum Cosmology|일반상대성이론·양자우주론
hep-ex|High Energy Physics - Experiment|고에너지물리학 실험
hep-lat|High Energy Physics - Lattice|고에너지물리학 격자
hep-ph|High Energy Physics - Phenomenology|고에너지물리학 현상론
hep-th|High Energy Physics - Theory|고에너지물리학 이론
math-ph|Mathematical Physics|수리물리학
nlin.AO|Adaptation and Self-Organizing Systems|적응·자기조직화 시스템
nlin.CD|Chaotic Dynamics|혼돈 동역학
nlin.CG|Cellular Automata and Lattice Gases|셀룰러 오토마타·격자 기체
nlin.PS|Pattern Formation and Solitons|패턴 형성·솔리톤
nlin.SI|Exactly Solvable and Integrable Systems|정확히 풀리는 적분가능계
nucl-ex|Nuclear Experiment|핵물리학 실험
nucl-th|Nuclear Theory|핵물리학 이론
physics.acc-ph|Accelerator Physics|가속기 물리학
physics.ao-ph|Atmospheric and Oceanic Physics|대기·해양 물리학
physics.app-ph|Applied Physics|응용물리학
physics.atm-clus|Atomic and Molecular Clusters|원자·분자 클러스터
physics.atom-ph|Atomic Physics|원자물리학
physics.bio-ph|Biological Physics|생물물리학
physics.chem-ph|Chemical Physics|화학물리학
physics.class-ph|Classical Physics|고전물리학
physics.comp-ph|Computational Physics|계산물리학
physics.data-an|Data Analysis, Statistics and Probability|데이터 분석·통계·확률
physics.ed-ph|Physics Education|물리 교육
physics.flu-dyn|Fluid Dynamics|유체역학
physics.gen-ph|General Physics|일반 물리학
physics.geo-ph|Geophysics|지구물리학
physics.hist-ph|History and Philosophy of Physics|물리학사·철학
physics.ins-det|Instrumentation and Detectors|측정 장비·검출기
physics.med-ph|Medical Physics|의학물리학
physics.optics|Optics|광학
physics.plasm-ph|Plasma Physics|플라스마 물리학
physics.pop-ph|Popular Physics|대중 물리학
physics.soc-ph|Physics and Society|물리학과 사회
physics.space-ph|Space Physics|우주공간 물리학
quant-ph|Quantum Physics|양자물리학
q-bio.BM|Biomolecules|생체분자
q-bio.CB|Cell Behavior|세포 행동
q-bio.GN|Genomics|유전체학
q-bio.MN|Molecular Networks|분자 네트워크
q-bio.NC|Neurons and Cognition|신경세포·인지
q-bio.OT|Other Quantitative Biology|기타 정량생물학
q-bio.PE|Populations and Evolution|개체군·진화
q-bio.QM|Quantitative Methods|정량적 방법
q-bio.SC|Subcellular Processes|세포내 과정
q-bio.TO|Tissues and Organs|조직·기관
q-fin.CP|Computational Finance|계산금융
q-fin.EC|Economics|경제학
q-fin.GN|General Finance|일반 금융
q-fin.MF|Mathematical Finance|수리금융
q-fin.PM|Portfolio Management|포트폴리오 관리
q-fin.PR|Pricing of Securities|증권 가격 결정
q-fin.RM|Risk Management|위험 관리
q-fin.ST|Statistical Finance|통계금융
q-fin.TR|Trading and Market Microstructure|거래·시장 미시구조
stat.AP|Applications|통계 응용
stat.CO|Computation|통계 계산
stat.ME|Methodology|통계 방법론
stat.ML|Machine Learning|기계학습
stat.OT|Other Statistics|기타 통계학
stat.TH|Statistics Theory|통계 이론
`;

export const arxivCategories: ArxivCategory[] = rows
  .trim()
  .split('\n')
  .map((row) => {
    const [code, en, ko] = row.split('|');
    return { code: code!, group: code!.split('.')[0]!, name: { en: en!, ko: ko! } };
  });
